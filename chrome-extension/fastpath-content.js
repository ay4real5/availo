(() => {
  // Fast-Path executor. Two modes:
  //   • Passive  — whenever the user lands on a DVSA login/search page and has a
  //     vault saved, fill the fields (their own details / a read-only query).
  //     Never auto-submits; the user clicks. Like a password manager.
  //   • Active   — after the user explicitly arms Fast-Path (popup button or the
  //     "Take me there" alert action), also submit login → submit search →
  //     land on results and REVEAL the earliest matching slot (scroll + ring).
  //     It never clicks Select/Confirm/Pay — those stay the human's.
  //
  // Selectors come from selectors.js; matching from fastpath-util.js /
  // watch-match.js. All loaded before this file in manifest.json.

  const S = AVAILO_SELECTORS;
  const BANNER_ID = "availo-fastpath-banner";

  function fillField(sel, value) {
    if (!value) return false;
    const el = document.querySelector(sel);
    if (!el || el.value) return false; // don't clobber anything the user typed
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function fillLogin(vault) {
    let any = fillField(S.login.licenceField, vault.licence);
    any = fillField(S.login.bookingRefField, vault.bookingRef) || any;
    return any;
  }

  function fillSearch(vault) {
    let any = fillField(S.search.centreField, vault.centre);
    any = fillField(S.search.dateFromField, vault.dateFrom) || any;
    any = fillField(S.search.dateToField, vault.dateTo) || any;
    return any;
  }

  // Clicking "Sign in" (the user's own credentials) and "Search" (a read-only
  // query) is exactly what the human does and reserves nothing. This is the
  // only place Fast-Path clicks anything, and never the slot's Select control.
  function clickSubmit(sel) {
    const btn = document.querySelector(sel);
    if (!btn) return false;
    btn.click();
    return true;
  }

  // Fresh scan → ranked still-present matches (earliest first). Confidence
  // pre-check + next-best both fall out of always reading the live DOM here.
  function currentRankedRows(prefs) {
    const rows = [...document.querySelectorAll(S.results.slotRow)]
      .map((el) => ({
        el,
        centre: el.getAttribute(S.results.slotCentreAttr),
        datetime: el.getAttribute(S.results.slotDatetimeAttr),
      }))
      .filter((r) => r.centre && r.datetime);

    return availoRankMatches(rows.map(({ centre, datetime }) => ({ centre, datetime })), prefs)
      .map((m) => rows.find((r) => r.centre === m.centre && r.datetime === m.datetime))
      .filter(Boolean);
  }

  function revealMatch(prefs) {
    const ranked = currentRankedRows(prefs);
    const target = ranked[0]; // best still-present match at THIS instant
    if (!target) {
      showGone();
      return false;
    }
    const control = target.el.querySelector(S.results.slotSelectButton) || target.el;
    control.scrollIntoView({ behavior: "smooth", block: "center" });
    control.style.outline = "3px solid #e0932a";
    control.style.outlineOffset = "3px";
    try { control.focus({ preventScroll: true }); } catch { /* not focusable */ }
    showBanner({ centre: target.centre, datetime: target.datetime }, { count: ranked.length });
    return true;
  }

  function showGone() {
    document.getElementById(BANNER_ID)?.remove();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#e4f0ec;border:2px solid #2f6f62;border-radius:12px;padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;max-width:300px;color:#232a22;";
    banner.textContent = "The earlier slot just went before we could show it. We're still watching — you'll get another alert the moment one appears.";
    document.body.appendChild(banner);
  }

  function showBanner(match, { count = 1 } = {}) {
    const lead = count > 1 ? `You're one click away (soonest of ${count})` : "You're one click away";
    document.getElementById(BANNER_ID)?.remove();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
      "background:#e4f0ec", "border:2px solid #2f6f62", "border-radius:12px",
      "padding:16px 18px", "box-shadow:0 6px 20px rgba(35,42,34,0.22)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:14px", "color:#232a22", "max-width:320px",
    ].join(";");
    banner.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">${lead}</div>
      <div style="margin-bottom:6px;">${match.centre} — ${new Date(match.datetime).toLocaleString()}</div>
      <p style="margin:0;font-size:12px;color:#67766c;">We filled everything and highlighted the slot. Click <strong>Select</strong> on it to secure your test.</p>
    `;
    document.body.appendChild(banner);
  }

  async function run() {
    let ctx;
    try {
      ctx = await chrome.runtime.sendMessage({ type: "FASTPATH_WHATNOW" });
    } catch { return; }
    if (!ctx || !ctx.ok) return;

    const { active, vault, prefs } = ctx;

    // A block/challenge stops Fast-Path outright — never evade it.
    if (document.querySelector(S.results.blockedMarker)) {
      chrome.runtime.sendMessage({ type: "FASTPATH_BLOCKED", page_url: window.location.href });
      chrome.runtime.sendMessage({ type: "FASTPATH_DONE" });
      return;
    }

    const page = availoDetectPage();
    if (!page || !vault) return;

    if (page === "login") {
      fillLogin(vault);
      if (active) clickSubmit(S.login.submitButton);
    } else if (page === "search") {
      fillSearch(vault);
      if (active) clickSubmit(S.search.submitButton);
    } else if (page === "results") {
      if (active) {
        revealMatch(prefs);
        chrome.runtime.sendMessage({ type: "FASTPATH_DONE" }); // race compressed; hand off to the human
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "FASTPATH_RUN") run();
  });

  // Content scripts run at document_idle, but DVSA pages may hydrate fields
  // slightly later — run now and once more shortly after.
  run();
  setTimeout(run, 600);
})();
