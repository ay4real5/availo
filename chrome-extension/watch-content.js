(() => {
  // NON-GOAL, read before touching this file: it must never try to bypass a
  // CAPTCHA, spoof headers/UA, retry around a block, or otherwise evade DVSA's
  // own defenses, and it must never click the slot's Select/Confirm/Pay control
  // itself. It only reads the page the user already has open, and on the user's
  // explicit click it highlights + scrolls the real DVSA control into view so
  // THEY can click it. If DVSA challenges or blocks this tab, we stop and tell
  // the user (reportBlocked). See docs/ARCHITECTURE.md §9.
  //
  // Page elements are found by AvailoResolve (selectors.js), which auto-detects
  // the real DVSA GOV.UK markup — loaded before this file in manifest.json.

  const RESCAN_INTERVAL_MS = 4000;
  const SCAN_DEBOUNCE_MS = 300;       // coalesce bursts of DOM mutations into one scan
  const OFFER_REFRESH_HOLD_MS = 180000; // don't auto-reload out from under a live offer (cap 3 min)
  const BANNER_ID = "availo-watch-banner";
  const HIGHLIGHT_CLASS = "availo-slot-highlight";

  let watching = false;
  let prefs = null; // { centre, targetDate }
  let observer = null;
  let rescanTimer = null;
  let scanDebounceTimer = null;
  let alertedKeys = new Set();
  let activeSelectElement = null;
  let activeSlotInfo = null; // { datetime, centre }
  let offerActiveSince = 0;  // ms timestamp the current slot was offered/revealed
  let loggedOutReported = false;
  let queuedReported = false;
  let serviceClosedState = false; // DVSA's overnight closure, tracked for transitions
  let activeHighlightedKey = null; // which offered slot is currently ringed IN VIEW

  ensureHighlightStyle();

  // Tell the background when this tab becomes hidden/visible so it can ease the
  // refresh cadence while nobody's looking (fewer requests, gentler on DVSA).
  function reportVisibility() {
    if (!watching) return;
    try {
      chrome.runtime.sendMessage({ type: "VISIBILITY", hidden: document.hidden }).catch(() => {});
    } catch { /* background asleep / context gone; next change re-reports */ }
  }
  document.addEventListener("visibilitychange", reportVisibility);

  // Fresh scan of the live DOM → ranked, still-present matching rows (earliest
  // first). Everything reads current reality, never a stale cached row — that's
  // the confidence pre-check that stops us pointing at a ghost slot.
  function currentRankedRows() {
    // A real DVSA results page shows one centre's dates, so rows carry no
    // per-row centre — attribute them to the centre we're watching. (The fixture
    // does tag per-row centre, which is respected.)
    const rows = AvailoResolve.resultRows(document).map((r) => ({
      el: r.el,
      selectEl: r.selectEl,
      centre: r.centre || (prefs && prefs.centre) || "",
      datetime: r.datetime,
    }));

    const ranked = availoRankMatches(
      rows.map(({ centre, datetime }) => ({ centre, datetime })),
      prefs,
    );
    return ranked
      .map((m) => rows.find((r) => r.centre === m.centre && r.datetime === m.datetime))
      .filter(Boolean);
  }

  function findSlotRow(centre, datetime) {
    return currentRankedRows().find((r) => r.centre === centre && r.datetime === datetime) || null;
  }

  function scanForSlots() {
    if (!watching) return;

    if (AvailoResolve.blocked(document)) {
      reportBlocked("challenge_or_block_marker_present");
      stopWatchingLocally();
      return;
    }

    // DVSA's scheduled overnight closure ("back at 6 am"). NOT a block — pause
    // slot-scanning and keep watching so we auto-resume when it reopens (the
    // gentle re-check is allowed in the REFRESH_PAGE handler). Report the
    // transition (both ways) so the background can notify + slow the cadence.
    const closedNow = AvailoResolve.serviceClosed(document);
    if (closedNow !== serviceClosedState) {
      serviceClosedState = closedNow;
      chrome.runtime.sendMessage({ type: "SERVICE_CLOSED", closed: closedNow, reopen: closedNow ? AvailoResolve.reopenTime(document) : null });
      if (closedNow) {
        const when = AvailoResolve.reopenTime(document);
        infoBanner(`<strong>DVSA is closed for the night.</strong><br>The booking service is down${when ? ` until ${when}` : " overnight"}. Availo has paused and will resume automatically when it reopens.`);
      } else {
        removeBanner();
      }
    }
    if (closedNow) return;

    // In a DVSA queue / waiting room? This is NOT a block — hold position and
    // wait. Never refresh (that loses your place). Alert once; keep watching so
    // we pick straight back up when we're through the queue.
    if (AvailoResolve.queued(document)) {
      if (!queuedReported) {
        queuedReported = true;
        chrome.runtime.sendMessage({ type: "QUEUED", page_url: window.location.href });
        infoBanner("<strong>You're in the DVSA queue.</strong><br>Stay on this page and wait — <strong>don't refresh</strong>, or you'll lose your place. Availo is paused until you're through.");
      }
      return;
    }
    queuedReported = false; // through the queue — re-arm

    // Signed out? Don't silently watch a login page — alert the user (once) and
    // wait. Watching stays active so it resumes automatically once they sign in.
    if (AvailoResolve.loggedOut(document)) {
      if (!loggedOutReported) {
        loggedOutReported = true;
        chrome.runtime.sendMessage({ type: "SIGNED_OUT", page_url: window.location.href });
        infoBanner("<strong>DVSA signed you out.</strong><br>Your details are filled in — click <strong>Sign in</strong> to keep Availo watching.");
      }
      return;
    }
    loggedOutReported = false; // back on a real page — re-arm for a future sign-out

    const ranked = currentRankedRows();
    // Forget slots that have left the page so a genuine re-appearance can alert
    // again — but never re-offer a slot we've already alerted for on this page.
    const presentKeys = new Set(ranked.map((r) => `${r.centre}|${r.datetime}`));
    for (const key of [...alertedKeys]) if (!presentKeys.has(key)) alertedKeys.delete(key);
    // Only ever alert on the SOONEST matching slot, and only once. We re-alert
    // when the soonest changes — it got taken and a later one is now first, or a
    // new even-earlier slot appeared — never repeatedly for slots already seen.
    const soonest = availoPickSoonestUnalerted(ranked, alertedKeys);
    if (soonest) {
      offerSlot(soonest, { count: ranked.length });
    }

    // If we've already offered a slot that was in another month, and the user has
    // now navigated to that month (its cell just became visible), ring it — so
    // "switch to October" actually pays off without re-alerting.
    if (activeSlotInfo) {
      const key = `${activeSlotInfo.centre}|${activeSlotInfo.datetime}`;
      const cell = findSlotRow(activeSlotInfo.centre, activeSlotInfo.datetime);
      const el = cell && (cell.selectEl || cell.el);
      if (el && isVisible(el)) {
        if (activeHighlightedKey !== key) {
          activeSelectElement = el;
          withObserverPaused(() => {
            highlight(el);
            showBanner(activeSlotInfo.centre, activeSlotInfo.datetime, { count: ranked.length, visible: true });
          });
          activeHighlightedKey = key;
        }
      } else {
        activeHighlightedKey = null; // navigated away / not on screen
      }
    }

    reportStatus(ranked);
  }

  // Lightweight status for the popup: how many dates this month's page shows,
  // how many are inside the user's window (+ the earliest one), which month and
  // centre the page is for, and when we last looked.
  function reportStatus(ranked) {
    try {
      const allRows = AvailoResolve.resultRows(document);
      const total = allRows.length;
      const inWindow = ranked.length;
      const earliest = ranked[0] ? ranked[0].datetime : null;
      // Soonest available at this centre regardless of the user's window — lets
      // the popup nudge "nothing in your window, but soonest anywhere is X".
      const soonestOverall = total ? allRows.map((r) => r.datetime).sort()[0] : null;
      const centre = typeof AvailoResolve.pageCentre === "function" ? AvailoResolve.pageCentre(document) : null;
      const monthEl = document.querySelector(".BookingCalendar-currentMonth");
      const yearEl = document.querySelector(".BookingCalendar-currentYear");
      const month = monthEl
        ? (monthEl.textContent.trim() + (yearEl ? " " + yearEl.textContent.trim() : "")).trim()
        : null;
      chrome.runtime.sendMessage({ type: "WATCH_STATUS", total, inWindow, earliest, soonestOverall, month, centre, at: Date.now() });
    } catch { /* status is best-effort */ }
  }

  // True while a detected slot is still on the page and recent enough that the
  // user may be acting on it — used to hold off an auto-refresh that would reload
  // the page out from under them (and reset the scroll/highlight). Self-clears
  // once the slot leaves the DOM or the cap elapses, so watching never freezes.
  function offerHoldActive() {
    if (!activeSlotInfo || !offerActiveSince) return false;
    if (Date.now() - offerActiveSince > OFFER_REFRESH_HOLD_MS) return false;
    return !!findSlotRow(activeSlotInfo.centre, activeSlotInfo.datetime);
  }

  function offerSlot(rowInfo, { count = 1 } = {}) {
    alertedKeys.add(`${rowInfo.centre}|${rowInfo.datetime}`);
    activeSelectElement = rowInfo.selectEl || rowInfo.el;
    activeSlotInfo = { centre: rowInfo.centre, datetime: rowInfo.datetime };
    offerActiveSince = Date.now();

    chrome.runtime.sendMessage({
      type: "SLOT_DETECTED",
      test_centre: rowInfo.centre,
      slot_datetime: new Date(rowInfo.datetime).toISOString(),
      page_url: window.location.href,
    });

    // Our own banner + highlight writes must not wake the MutationObserver —
    // otherwise they feed straight back into scanForSlots and, with two or more
    // matching slots, ping-pong into a notification storm.
    const visible = isVisible(activeSelectElement);
    withObserverPaused(() => {
      showBanner(rowInfo.centre, rowInfo.datetime, { count, visible });
      // Ring it immediately IF it's in the month on screen. If it's in another
      // month (present in the DOM but hidden), we can't visibly ring it — the
      // banner tells the user which month to switch to; scanForSlots re-rings it
      // automatically once they navigate there.
      if (visible) { highlight(activeSelectElement); activeHighlightedKey = `${rowInfo.centre}|${rowInfo.datetime}`; }
      else { activeHighlightedKey = null; }
    });
  }

  function showBanner(centre, datetime, { count = 1, visible = true } = {}) {
    removeBanner();
    const many = count > 1 ? `${count} matching slots — here's the soonest` : "Availo: matching slot found";
    const guidance = visible
      ? "We'll scroll to it and highlight it — you click Select to secure it."
      : `It's in <strong>${monthName(datetime)}</strong> — a different month than the one on screen. Click the <strong>›</strong> arrow to ${monthName(datetime)} and Availo will ring it for you.`;
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
      "background:#fbf0dd", "border:2px solid #e0932a", "border-radius:12px",
      "padding:16px 18px", "box-shadow:0 6px 20px rgba(35,42,34,0.22)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:14px", "color:#232a22", "max-width:320px",
    ].join(";");
    banner.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">${many}</div>
      <div style="margin-bottom:12px;">${centre} — ${niceDate(datetime)}</div>
      ${visible ? `<button id="availo-reveal-btn" style="width:100%;padding:10px;font-weight:700;background:#2f6f62;color:#fff;border:none;border-radius:999px;cursor:pointer;">Show me the slot</button>` : ""}
      <p style="margin:8px 0 0;font-size:12px;color:#67766c;">${guidance}</p>
    `;
    document.body.appendChild(banner);
    const revealBtn = document.getElementById("availo-reveal-btn");
    if (revealBtn) revealBtn.addEventListener("click", revealSlot);
  }

  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function infoBanner(html) {
    removeBanner();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#e4f0ec;border:2px solid #2f6f62;border-radius:12px;padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;max-width:300px;color:#232a22;";
    banner.innerHTML = html;
    document.body.appendChild(banner);
  }

  function highlight(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(HIGHLIGHT_CLASS);
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
  }

  // Is the element actually rendered? A slot in a NON-displayed calendar month is
  // present in the DOM but hidden (the SlotPicker only shows one month), so
  // scrolling/ringing it would be invisible. offsetWidth/Height + client rects
  // are all zero for a display:none-ancestor element.
  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
  }

  // Friendly date + the full month name, for banners/guidance.
  function niceDate(datetime) {
    return new Date(datetime).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }
  function monthName(datetime) {
    return new Date(datetime).toLocaleDateString(undefined, { month: "long" });
  }

  // The extension's ONLY interaction with the slot control: bring it into view
  // and ring it. It does not click it — the human does. Confidence pre-check:
  // re-verify the offered slot is still live at THIS instant; if it vanished in
  // the seconds since we alerted, jump to the next-best still-present match
  // instead of sending the user to a dead row.
  function revealSlot() {
    if (!activeSlotInfo) return;

    // One scan of current reality, reused for both the exact match and the
    // next-best fallback (avoids scanning the DOM twice).
    const ranked = currentRankedRows();
    let target = ranked.find((r) => r.centre === activeSlotInfo.centre && r.datetime === activeSlotInfo.datetime) || null;
    let replaced = false;
    if (!target) {
      target = ranked[0] || null; // next-best still present
      replaced = true;
    }

    if (!target) {
      infoBanner("That slot just went, and there's no earlier one right now. We're still watching — you'll hear from us the moment another appears.");
      activeSelectElement = null;
      activeSlotInfo = null;
      chrome.runtime.sendMessage({ type: "HOLD_RESULT", outcome: "unknown", message: "Offered slot vanished; nothing else qualifies right now." });
      return;
    }

    activeSlotInfo = { centre: target.centre, datetime: target.datetime };
    activeSelectElement = target.selectEl || target.el;
    offerActiveSince = Date.now();
    alertedKeys.add(`${target.centre}|${target.datetime}`);

    chrome.runtime.sendMessage({
      type: "HOLD_CLICKED", // telemetry: "user is going for this slot"
      test_centre: activeSlotInfo.centre,
      slot_datetime: new Date(activeSlotInfo.datetime).toISOString(),
    });

    // If the slot is in a month that isn't on screen, we can't scroll to it —
    // guide the user to switch months instead of silently doing nothing.
    if (!isVisible(activeSelectElement)) {
      activeHighlightedKey = null;
      infoBanner(`<strong>${niceDate(target.datetime)}</strong> is in <strong>${monthName(target.datetime)}</strong>, a different month than the one on screen.<br>Click the <strong>›</strong> (next month) arrow on the calendar until you reach ${monthName(target.datetime)} — Availo will ring it automatically when you get there.`);
      chrome.runtime.sendMessage({ type: "HOLD_RESULT", outcome: "attempted", message: "Slot is in a non-displayed month; guided the user to navigate there." });
      return;
    }

    withObserverPaused(() => {
      highlight(activeSelectElement);
      activeHighlightedKey = `${target.centre}|${target.datetime}`;

      if (replaced) {
        infoBanner(`<strong>That one just went.</strong> We've highlighted the next earliest instead:<br>${target.centre} — ${niceDate(target.datetime)}<br><span style="color:#67766c;">Click <strong>Select</strong> on it to secure your test.</span>`);
      } else {
        removeBanner();
      }
    });

    chrome.runtime.sendMessage({
      type: "HOLD_RESULT",
      outcome: "attempted",
      message: replaced
        ? "Original vanished; highlighted the next-earliest still-present slot for the user."
        : "Highlighted the Select control; the user clicks it themselves.",
    });
  }

  function ensureHighlightStyle() {
    if (document.getElementById("availo-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "availo-highlight-style";
    style.textContent = `.${HIGHLIGHT_CLASS}{outline:3px solid #e0932a !important;outline-offset:3px !important;border-radius:6px;animation:availoPulse 1.2s ease-in-out 3;}
@keyframes availoPulse{0%,100%{box-shadow:0 0 0 0 rgba(224,147,42,0.5);}50%{box-shadow:0 0 0 8px rgba(224,147,42,0);}}`;
    document.head.appendChild(style);
  }

  function reportBlocked(reason) {
    chrome.runtime.sendMessage({ type: "BLOCKED", reason, page_url: window.location.href });
    removeBanner();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#fbeae6;border:2px solid #c24e3a;border-radius:12px;padding:14px 16px;font-family:sans-serif;font-size:13px;max-width:300px;color:#232a22;";
    banner.textContent = "Availo Watch stopped: DVSA showed a challenge or block on this page. Please continue manually.";
    document.body.appendChild(banner);
  }

  // Coalesce a burst of DOM mutations into a single scan shortly after they
  // settle, instead of scanning on every mutation. Cuts redundant work on a busy
  // page; the 4s safety timer still guarantees a scan even if mutations stop.
  function scheduleScan() {
    if (scanDebounceTimer) return;
    scanDebounceTimer = setTimeout(() => {
      scanDebounceTimer = null;
      scanForSlots();
    }, SCAN_DEBOUNCE_MS);
  }

  // Run a DOM write with the MutationObserver detached, so Availo's own banner /
  // highlight edits don't retrigger scanForSlots (which caused a detection loop).
  function withObserverPaused(fn) {
    if (observer) observer.disconnect();
    try {
      fn();
    } finally {
      if (observer && watching) observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function startWatching(newPrefs) {
    // Guard against double-init (initial WATCH_START vs a resume after reload).
    if (observer) observer.disconnect();
    if (rescanTimer) clearInterval(rescanTimer);
    if (scanDebounceTimer) { clearTimeout(scanDebounceTimer); scanDebounceTimer = null; }

    watching = true;
    prefs = newPrefs;
    alertedKeys = new Set();
    activeSelectElement = null;
    activeSlotInfo = null;
    activeHighlightedKey = null;
    offerActiveSince = 0;
    loggedOutReported = false;
    queuedReported = false;
    serviceClosedState = false;

    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    rescanTimer = setInterval(scanForSlots, RESCAN_INTERVAL_MS);
    reportVisibility(); // seed the background with the current hidden/visible state
    scanForSlots();
  }

  // After the page reloads (auto-refresh or a manual reload) the content script
  // restarts fresh — ask the background whether this tab is still being watched
  // and, if so, resume so watching survives refreshes without user action.
  function resumeIfWatched() {
    try {
      chrome.runtime.sendMessage({ type: "WATCH_RESUME_QUERY" }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.watching) {
          startWatching({ centre: res.centre, targetDate: res.targetDate, dateFrom: res.dateFrom, dateTo: res.dateTo });
        }
      });
    } catch { /* background asleep; it will re-arm on next alarm tick */ }
  }

  function stopWatchingLocally() {
    watching = false;
    prefs = null;
    activeSelectElement = null;
    activeSlotInfo = null;
    activeHighlightedKey = null;
    offerActiveSince = 0;
    if (observer) { observer.disconnect(); observer = null; }
    if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null; }
    if (scanDebounceTimer) { clearTimeout(scanDebounceTimer); scanDebounceTimer = null; }
    removeBanner();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "WATCH_START") {
      startWatching({ centre: message.centre, targetDate: message.targetDate, dateFrom: message.dateFrom, dateTo: message.dateTo });
    } else if (message.type === "WATCH_STOP") {
      stopWatchingLocally();
    } else if (message.type === "REVEAL_SLOT") {
      revealSlot();
    } else if (message.type === "RESCAN") {
      // Background alarm nudges us to re-check (survives background-tab throttling).
      scanForSlots();
    } else if (message.type === "REFRESH_PAGE") {
      // Gentle auto-refresh so new cancellations surface. Never refresh into a
      // block — if DVSA is challenging us, stop instead of hammering it. And only
      // ever reload an actual DVSA page, never wherever the user has browsed to.
      if (!watching) return;
      if (AvailoResolve.blocked(document)) {
        reportBlocked("challenge_or_block_before_refresh");
        stopWatchingLocally();
        return;
      }
      // Never refresh while queuing — a reload sends you to the back of the line.
      if (AvailoResolve.queued(document)) return;
      // During DVSA's overnight closure the page isn't "results", but we DO want
      // to reload it (gently, paced by the background) so we notice the moment it
      // reopens and can resume — a prime time for fresh slots.
      if (AvailoResolve.serviceClosed(document)) { window.location.reload(); return; }
      if (AvailoResolve.page(document) !== "results") return;
      // Don't reload the page out from under a slot the user is actively acting
      // on — it would reset the scroll/highlight mid-click. Self-clears once the
      // slot is gone or the hold cap elapses, so watching resumes on its own.
      if (offerHoldActive()) return;
      window.location.reload();
    } else if (message.type === "DIAGNOSE") {
      // The popup's "Check this page" self-test — report what we can read.
      sendResponse(AvailoResolve.diagnose(document));
      return true;
    }
  });

  resumeIfWatched();
})();
