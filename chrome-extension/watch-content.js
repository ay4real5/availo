(() => {
  // NON-GOAL, read before touching this file: it must never try to bypass a
  // CAPTCHA, spoof headers/UA, retry around a block, or otherwise evade DVSA's
  // own defenses. It only reads the page the user already has open and only
  // acts when the user clicks something. If DVSA challenges or blocks this
  // tab, we stop and tell the user (reportBlocked) — we do not route around
  // it. That boundary is the entire reason this feature is safe to ship; see
  // docs/ARCHITECTURE.md §9 for why server-side DVSA automation is not.

  // TODO(spike): these selectors are UNVERIFIED placeholders, written against
  // the local dev fixture (chrome-extension/dev-fixture/change-test-slots.html)
  // only. Confirm the real DVSA "change your driving test" markup before this
  // ships, and update this one object — nothing else in the file should need
  // to change.
  const SELECTORS = {
    slotRow: '[data-testid="availo-slot-row"]',
    slotDatetimeAttr: "data-slot-datetime",
    slotCentreAttr: "data-slot-centre",
    slotHoldButton: '[data-testid="availo-slot-hold"]',
    blockedMarker: '[data-testid="availo-blocked"]',
  };

  const RESCAN_INTERVAL_MS = 4000;
  const BANNER_ID = "availo-watch-banner";

  let watching = false;
  let prefs = null; // { centre, targetDate }
  let observer = null;
  let rescanTimer = null;
  let lastDetectionKey = null;
  let activeHoldElement = null;
  let activeSlotInfo = null; // { datetime, centre }

  function scanForSlots() {
    if (!watching) return;

    if (document.querySelector(SELECTORS.blockedMarker)) {
      reportBlocked("challenge_or_block_marker_present");
      stopWatchingLocally();
      return;
    }

    const rows = document.querySelectorAll(SELECTORS.slotRow);
    for (const row of rows) {
      const datetime = row.getAttribute(SELECTORS.slotDatetimeAttr);
      const centre = row.getAttribute(SELECTORS.slotCentreAttr);
      if (!datetime || !centre) continue;

      if (!availoMatchesTarget({ datetime, centre }, prefs)) continue;

      const key = `${centre}|${datetime}`;
      if (key === lastDetectionKey) continue; // already alerted for this exact slot
      lastDetectionKey = key;

      const holdBtn = row.querySelector(SELECTORS.slotHoldButton);
      activeHoldElement = holdBtn || null;
      activeSlotInfo = { datetime, centre };

      chrome.runtime.sendMessage({
        type: "SLOT_DETECTED",
        test_centre: centre,
        slot_datetime: new Date(datetime).toISOString(),
        page_url: window.location.href,
      });

      showBanner(centre, datetime);
      break; // one alert at a time is plenty — avoid spamming on a busy page
    }
  }

  function showBanner(centre, datetime) {
    removeBanner();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
      "background:#fff7bf", "border:2px solid #ffdd00", "border-radius:8px",
      "padding:14px 16px", "box-shadow:0 4px 12px rgba(0,0,0,0.25)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:14px", "color:#0b0c0c", "max-width:300px",
    ].join(";");
    banner.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;">Availo: earlier slot found</div>
      <div style="margin-bottom:10px;">${centre} — ${new Date(datetime).toLocaleString()}</div>
      <button id="availo-hold-btn" style="width:100%;padding:8px;font-weight:bold;background:#00703c;color:#fff;border:none;border-radius:4px;cursor:pointer;">Hold this slot</button>
    `;
    document.body.appendChild(banner);
    document.getElementById("availo-hold-btn").addEventListener("click", performHoldClick);
  }

  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function performHoldClick() {
    if (!activeHoldElement || !activeSlotInfo) return;

    chrome.runtime.sendMessage({
      type: "HOLD_CLICKED",
      test_centre: activeSlotInfo.centre,
      slot_datetime: new Date(activeSlotInfo.datetime).toISOString(),
    });

    // The one and only action this file ever takes against the real page: the
    // exact click a human would make on DVSA's own control. Never a raw HTTP
    // request constructed by us.
    activeHoldElement.click();
    removeBanner();

    // Best-effort, advisory-only follow-up — we cannot reliably confirm DVSA
    // accepted the hold, so this is never used to mark anything "booked".
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "HOLD_RESULT",
        outcome: "attempted",
        message: "Clicked the hold control; user must confirm on DVSA's own page.",
      });
    }, 1500);
  }

  function reportBlocked(reason) {
    chrome.runtime.sendMessage({
      type: "BLOCKED",
      reason,
      page_url: window.location.href,
    });
    removeBanner();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#f3f2f1;border:2px solid #d4351c;border-radius:8px;padding:12px 16px;font-family:sans-serif;font-size:13px;max-width:280px;color:#0b0c0c;";
    banner.textContent = "Availo Watch stopped: DVSA showed a challenge/block on this page. Please continue manually.";
    document.body.appendChild(banner);
  }

  function startWatching(newPrefs) {
    watching = true;
    prefs = newPrefs;
    lastDetectionKey = null;
    activeHoldElement = null;
    activeSlotInfo = null;

    observer = new MutationObserver(() => scanForSlots());
    observer.observe(document.body, { childList: true, subtree: true });

    rescanTimer = setInterval(scanForSlots, RESCAN_INTERVAL_MS);
    scanForSlots();
  }

  function stopWatchingLocally() {
    watching = false;
    prefs = null;
    activeHoldElement = null;
    activeSlotInfo = null;
    if (observer) { observer.disconnect(); observer = null; }
    if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null; }
    removeBanner();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "WATCH_START") {
      startWatching({ centre: message.centre, targetDate: message.targetDate });
    } else if (message.type === "WATCH_STOP") {
      stopWatchingLocally();
    } else if (message.type === "PERFORM_HOLD_CLICK") {
      performHoldClick();
    }
  });
})();
