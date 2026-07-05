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
  const BANNER_ID = "availo-watch-banner";
  const HIGHLIGHT_CLASS = "availo-slot-highlight";

  let watching = false;
  let prefs = null; // { centre, targetDate }
  let observer = null;
  let rescanTimer = null;
  let alertedKeys = new Set();
  let activeSelectElement = null;
  let activeSlotInfo = null; // { datetime, centre }
  let loggedOutReported = false;
  let queuedReported = false;

  ensureHighlightStyle();

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
    const soonest = ranked[0];
    if (soonest && !alertedKeys.has(`${soonest.centre}|${soonest.datetime}`)) {
      offerSlot(soonest, { count: ranked.length });
    }
  }

  function offerSlot(rowInfo, { count = 1 } = {}) {
    alertedKeys.add(`${rowInfo.centre}|${rowInfo.datetime}`);
    activeSelectElement = rowInfo.selectEl || rowInfo.el;
    activeSlotInfo = { centre: rowInfo.centre, datetime: rowInfo.datetime };

    chrome.runtime.sendMessage({
      type: "SLOT_DETECTED",
      test_centre: rowInfo.centre,
      slot_datetime: new Date(rowInfo.datetime).toISOString(),
      page_url: window.location.href,
    });

    // Our own banner + highlight writes must not wake the MutationObserver —
    // otherwise they feed straight back into scanForSlots and, with two or more
    // matching slots, ping-pong into a notification storm.
    withObserverPaused(() => {
      showBanner(rowInfo.centre, rowInfo.datetime, { count });
      // Auto-highlight the moment we detect it, so someone who remotes in / comes
      // back sees it already ringed and is one click from Select. (Highlight only —
      // the extension still never clicks it.)
      highlight(activeSelectElement);
    });
  }

  function showBanner(centre, datetime, { count = 1 } = {}) {
    removeBanner();
    const many = count > 1 ? `${count} earlier slots — here's the soonest` : "Availo: earlier slot found";
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
      <div style="margin-bottom:12px;">${centre} — ${new Date(datetime).toLocaleString()}</div>
      <button id="availo-reveal-btn" style="width:100%;padding:10px;font-weight:700;background:#2f6f62;color:#fff;border:none;border-radius:999px;cursor:pointer;">Show me the slot</button>
      <p style="margin:8px 0 0;font-size:12px;color:#67766c;">We'll scroll to it and highlight it — you click Select to secure it.</p>
    `;
    document.body.appendChild(banner);
    document.getElementById("availo-reveal-btn").addEventListener("click", revealSlot);
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

  // The extension's ONLY interaction with the slot control: bring it into view
  // and ring it. It does not click it — the human does. Confidence pre-check:
  // re-verify the offered slot is still live at THIS instant; if it vanished in
  // the seconds since we alerted, jump to the next-best still-present match
  // instead of sending the user to a dead row.
  function revealSlot() {
    if (!activeSlotInfo) return;

    let target = findSlotRow(activeSlotInfo.centre, activeSlotInfo.datetime);
    let replaced = false;
    if (!target) {
      target = currentRankedRows()[0] || null; // next-best still present
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
    alertedKeys.add(`${target.centre}|${target.datetime}`);

    chrome.runtime.sendMessage({
      type: "HOLD_CLICKED", // telemetry: "user is going for this slot"
      test_centre: activeSlotInfo.centre,
      slot_datetime: new Date(activeSlotInfo.datetime).toISOString(),
    });

    withObserverPaused(() => {
      highlight(activeSelectElement);

      if (replaced) {
        infoBanner(`<strong>That one just went.</strong> We've highlighted the next earliest instead:<br>${target.centre} — ${new Date(target.datetime).toLocaleString()}<br><span style="color:#67766c;">Click <strong>Select</strong> on it to secure your test.</span>`);
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

    watching = true;
    prefs = newPrefs;
    alertedKeys = new Set();
    activeSelectElement = null;
    activeSlotInfo = null;
    loggedOutReported = false;
    queuedReported = false;

    observer = new MutationObserver(() => scanForSlots());
    observer.observe(document.body, { childList: true, subtree: true });
    rescanTimer = setInterval(scanForSlots, RESCAN_INTERVAL_MS);
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
          startWatching({ centre: res.centre, targetDate: res.targetDate });
        }
      });
    } catch { /* background asleep; it will re-arm on next alarm tick */ }
  }

  function stopWatchingLocally() {
    watching = false;
    prefs = null;
    activeSelectElement = null;
    activeSlotInfo = null;
    if (observer) { observer.disconnect(); observer = null; }
    if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null; }
    removeBanner();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "WATCH_START") {
      startWatching({ centre: message.centre, targetDate: message.targetDate });
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
      if (AvailoResolve.page(document) !== "results") return;
      window.location.reload();
    } else if (message.type === "DIAGNOSE") {
      // The popup's "Check this page" self-test — report what we can read.
      sendResponse(AvailoResolve.diagnose(document));
      return true;
    }
  });

  resumeIfWatched();
})();
