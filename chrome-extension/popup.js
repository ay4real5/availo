const appEl = document.getElementById("app");

// Dev-only constants come from build-config.js (empty in packaged store builds,
// so shipped code carries no dev origins and hides the local Practice rehearsal).
const PRACTICE_URL = typeof AVAILO_PRACTICE_URL !== "undefined" ? AVAILO_PRACTICE_URL : "";
const DEV_HOST_MATCH = typeof AVAILO_DEV_HOST_MATCH !== "undefined" ? AVAILO_DEV_HOST_MATCH : "";
const IS_PACKAGED = typeof AVAILO_PACKAGED !== "undefined" && AVAILO_PACKAGED;

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url) {
  if (!url) return false;
  const re = DEV_HOST_MATCH ? new RegExp(`gov\\.uk|${DEV_HOST_MATCH}`) : /gov\.uk/;
  return re.test(url);
}

function formatAgo(at) {
  if (!at) return "just now";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

function fmtDay(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// One line telling the user exactly which dates Availo will alert on.
function describeWindow(watch) {
  const from = fmtDay(watch && watch.dateFrom);
  const to = fmtDay(watch && (watch.dateTo || watch.targetDate));
  if (from && to) return `Window: ${from} – ${to}`;
  if (to) return `Alerting on dates before ${to}`;
  if (from) return `Alerting from ${from} onwards`;
  return "Alerting on any date at this centre";
}

// Live "what's happening" line for the watching view. The page holds EVERY
// month's availability at once (not just the one on screen), so "total" is a
// whole-calendar figure — say so, and lead with the number that matters (how
// many are in the user's window).
function describeStatus(status) {
  if (!status) return "Starting up — checking the page…";
  let win;
  if (status.inWindow > 0) {
    const earliest = fmtDay(status.earliest);
    win = earliest ? `${status.inWindow} in your window (soonest ${earliest})` : `${status.inWindow} in your window`;
  } else {
    // Nothing in the window — nudge with the soonest slot that DOES exist, so an
    // over-narrow window (e.g. an August window at a centre with none) is obvious.
    const soon = fmtDay(status.soonestOverall);
    win = soon
      ? `0 in your window — soonest anywhere is ${soon} (widen your window to catch it)`
      : "0 in your window";
  }
  const total = `${status.total} available across the whole calendar`;
  const month = status.month ? `showing ${status.month} · ` : "";
  return `${month}checked ${formatAgo(status.at)} · ${win} · ${total}`;
}

// True when the page's own centre differs from the one the user is set to watch,
// using the same normalisation the matcher uses (handles "(Euxton)"-style
// qualifiers). Either name missing => no warning (we can't tell).
function centreMismatch(pageCentre, savedCentre) {
  if (!pageCentre || !savedCentre) return false;
  if (typeof availoNormalizeCentre !== "function") {
    return pageCentre.trim().toLowerCase() !== savedCentre.trim().toLowerCase();
  }
  return availoNormalizeCentre(pageCentre) !== availoNormalizeCentre(savedCentre);
}

function practiceLink() {
  const btn = document.createElement("button");
  btn.className = "link";
  btn.textContent = "Practice run (safe rehearsal)";
  btn.addEventListener("click", async () => {
    const tab = await chrome.tabs.create({ url: PRACTICE_URL });
    await sendToBackground({ type: "ARM_FASTPATH", tabId: tab.id });
    window.close();
  });
  return btn;
}

// Plain-language summary of what the extension can see on the current page —
// so a non-technical user can confirm it's working without any DevTools.
function describeDiagnosis(d, savedCentre) {
  if (!d) return "Couldn't check this page. Try reloading it, then check again.";
  if (d.queued) return "⏳ You're in the DVSA queue. Wait here — don't refresh, or you'll lose your place. Availo pauses until you're through.";
  if (d.blocked) return "⚠ DVSA is showing a challenge or error here. Availo pauses on these pages — please continue manually.";
  if (d.page === "results") {
    if (d.rowCount === 0) return "This looks like the results page, but Availo can't see any available dates yet.";
    const soon = fmtDay(d.soonest);
    let msg = `✓ Availo can read this page${d.centre ? ` at ${d.centre}` : ""}`;
    if (soon) msg += ` — soonest available slot is ${soon}`;
    msg += `. It sees ${d.rowCount} available date${d.rowCount === 1 ? "" : "s"} across the whole calendar (all months, not just the one on screen).`;
    if (centreMismatch(d.centre, savedCentre)) {
      msg += ` ⚠ Heads up: you're set to watch ${savedCentre}, but this page is ${d.centre} — so watching here won't alert for ${savedCentre}. To watch ${d.centre}, set it as your centre in options.`;
    }
    return msg;
  }
  if (d.page === "login") {
    const ok = d.login.licence && d.login.bookingRef;
    return ok
      ? "✓ This is the sign-in page. Availo can fill your licence and booking reference for you."
      : "This looks like the sign-in page, but Availo couldn't find both fields to fill.";
  }
  if (d.page === "search") return "✓ This is the find-a-test page. Availo can fill your search.";
  return "This doesn't look like the DVSA change-test pages yet. Open your list of available tests, then check again.";
}

function diagnosticControls(tab, savedCentre) {
  const container = document.createElement("div");
  const btn = document.createElement("button");
  btn.className = "link";
  btn.textContent = "Check this page";
  const result = document.createElement("div");
  result.className = "status idle";
  result.style.display = "none";
  result.style.marginTop = "8px";
  btn.addEventListener("click", async () => {
    result.style.display = "block";
    result.textContent = "Checking…";
    let d = null;
    try { d = await chrome.tabs.sendMessage(tab.id, { type: "DIAGNOSE" }); } catch { d = null; }
    result.textContent = describeDiagnosis(d, savedCentre);
  });
  container.appendChild(btn);
  container.appendChild(result);
  return container;
}

async function render() {
  const tab = await getCurrentTab();
  if (!tab) { appEl.textContent = "No active tab."; return; }

  const state = await sendToBackground({ type: "GET_TAB_STATE", tabId: tab.id });

  appEl.innerHTML = "";

  if (!state?.signedIn) {
    appEl.innerHTML = `
      <p>Sign in to get alerts and fill your booking details automatically.</p>
      <button class="primary" id="openOptions">Sign in &amp; add details</button>
    `;
    document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  if (!isSupported(tab.url)) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>Open the DVSA "change your driving test" page, then come back here.</p>
      <p class="status idle">Not on a supported page</p>
    `;
    if (!state.vaultReady) {
      const addBtn = document.createElement("button");
      addBtn.className = "primary";
      addBtn.textContent = "Add your details";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
    }
    if (!IS_PACKAGED) wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // On a supported page and signed in but not yet watching.
  if (!state.watching) {
    const wrap = document.createElement("div");

    if (!state.vaultReady) {
      wrap.innerHTML = `<p>Add your licence and booking reference before you start.</p>`;
      const addBtn = document.createElement("button");
      addBtn.className = "primary";
      addBtn.textContent = "Add your details";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
      wrap.appendChild(diagnosticControls(tab, state.savedCentre));
      if (!IS_PACKAGED) wrap.appendChild(practiceLink());
      appEl.appendChild(wrap);
      return;
    }

    wrap.innerHTML = `<p>Availo will watch this tab, highlight an earlier slot, and alert you. Nothing is ever booked, held, or paid automatically.</p>`;

    const startBtn = document.createElement("button");
    startBtn.className = "primary";
    startBtn.textContent = "Start watching this tab";
    startBtn.addEventListener("click", async () => {
      appEl.innerHTML = "<p>Starting…</p>";
      const res = await sendToBackground({ type: "START_WATCH", tabId: tab.id });
      if (!res.ok) {
        appEl.innerHTML = `<p class="status idle">Couldn't start: ${res.error === "no_preferences_set" ? "set your centre and test date first." : res.error}</p>`;
        return;
      }
      render();
    });
    wrap.appendChild(startBtn);

    const fpBtn = document.createElement("button");
    fpBtn.className = "accent";
    fpBtn.textContent = "Fast-Path now (fill & jump to slot)";
    fpBtn.addEventListener("click", async () => {
      await sendToBackground({ type: "ARM_FASTPATH", tabId: tab.id });
      window.close();
    });
    wrap.appendChild(fpBtn);

    const manageBtn = document.createElement("button");
    manageBtn.className = "link";
    manageBtn.textContent = "Manage your details";
    manageBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
    wrap.appendChild(manageBtn);

    wrap.appendChild(diagnosticControls(tab, state.savedCentre));
    if (!IS_PACKAGED) wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // Watching.
  const wrap = document.createElement("div");
  const detail = state.detection
    ? `<div class="status watching"><strong>Slot found:</strong> ${state.detection.test_centre} — ${new Date(state.detection.slot_datetime).toLocaleString()}</div>`
    : "";
  // If the page's real centre differs from the one we're matching against, this
  // tab will never alert — surface that loudly instead of watching in silence.
  const pageCentre = state.status && state.status.centre;
  const mismatchNote = centreMismatch(pageCentre, state.watch && state.watch.centre)
    ? `<div class="status" style="background:#fbeae6;color:#7a2718;font-size:12px;margin-top:6px;">⚠ This page is <strong>${pageCentre}</strong>, but you're watching for <strong>${state.watch.centre}</strong> — no alerts will fire here. Open a ${state.watch.centre} tab, or change your centre in options.</div>`
    : "";
  wrap.innerHTML = `
    <p class="status watching">Watching this tab${state.watch?.centre ? ` (${state.watch.centre})` : ""}.</p>
    <p class="status idle" style="font-size:12px;margin-top:4px;">${describeStatus(state.status)}</p>
    <p class="status idle" style="font-size:12px;margin-top:2px;">${describeWindow(state.watch)}</p>
    ${mismatchNote}${detail}`;

  if (state.detection) {
    const revealBtn = document.createElement("button");
    revealBtn.className = "accent";
    revealBtn.textContent = "Show me the slot";
    revealBtn.addEventListener("click", async () => {
      await sendToBackground({ type: "USER_CLICKED_HOLD", tabId: tab.id });
      window.close();
    });
    wrap.appendChild(revealBtn);
  }

  const stopBtn = document.createElement("button");
  stopBtn.className = "stop";
  stopBtn.textContent = "Stop watching";
  stopBtn.addEventListener("click", async () => {
    appEl.innerHTML = "<p>Stopping…</p>";
    await sendToBackground({ type: "STOP_WATCH", tabId: tab.id });
    render();
  });
  wrap.appendChild(stopBtn);

  wrap.appendChild(diagnosticControls(tab, state.savedCentre));
  if (!IS_PACKAGED) wrap.appendChild(practiceLink());
  appEl.appendChild(wrap);
}

render();
