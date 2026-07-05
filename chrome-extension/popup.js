const appEl = document.getElementById("app");

// The local practice fixture (served over http, see chrome-extension/dev-fixture).
// Rehearse the exact fill → advance → highlight → click sequence with zero risk,
// against a page that mimics the real DVSA journey but never touches DVSA.
const PRACTICE_URL = "http://localhost:5555/login.html";

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url) {
  if (!url) return false;
  return /gov\.uk|localhost:8000|localhost:5555/.test(url);
}

function fmtMinsSecs(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m <= 0) return `${sec}s`;
  return `${m} min`;
}

// A human sentence describing the current rotation phase.
function describeRotation(r) {
  if (!r) return "";
  if (r.paused) {
    return `Paused on <strong>${r.personName}</strong>${r.centre ? ` (${r.centre})` : ""}. Book their slot, then resume or skip.`;
  }
  if (r.phase === "watching") {
    const next = r.nextName ? ` · next: ${r.nextName}` : "";
    return `Watching <strong>${r.personName}</strong>${r.centre ? ` (${r.centre})` : ""} · ~${fmtMinsSecs(r.secondsLeft)} left${next}`;
  }
  if (r.phase === "cooldown") return "Switching over — please sign out of DVSA.";
  if (r.phase === "break") return `Taking a break (~${fmtMinsSecs(r.secondsLeft)} left) so activity looks human.`;
  return "";
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
function describeDiagnosis(d) {
  if (!d) return "Couldn't check this page. Try reloading it, then check again.";
  if (d.queued) return "⏳ You're in the DVSA queue. Wait here — don't refresh, or you'll lose your place. Availo pauses until you're through.";
  if (d.blocked) return "⚠ DVSA is showing a challenge or error here. Availo pauses on these pages — please continue manually.";
  if (d.page === "results") {
    return d.rowCount > 0
      ? `✓ Availo can read this page — it can see ${d.rowCount} available date${d.rowCount === 1 ? "" : "s"}.`
      : "This looks like the results page, but Availo can't see any available dates yet.";
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

function diagnosticControls(tab) {
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
    result.textContent = describeDiagnosis(d);
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

  const readyCount = state.rosterReady || 0;
  const totalCount = state.rosterCount || 0;

  if (!isSupported(tab.url)) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>Open the DVSA "change your driving test" page, then come back here.</p>
      <p class="status idle">Not on a supported page</p>
    `;
    if (readyCount === 0) {
      const addBtn = document.createElement("button");
      addBtn.className = "primary";
      addBtn.textContent = "Add the people you're watching for";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
    }
    wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // On a supported page and signed in but not yet rotating.
  if (!state.rotation) {
    const wrap = document.createElement("div");

    if (readyCount === 0) {
      wrap.innerHTML = `<p>Add at least one person (their licence and booking reference) before you start.</p>`;
      const addBtn = document.createElement("button");
      addBtn.className = "primary";
      addBtn.textContent = "Add people";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
      wrap.appendChild(diagnosticControls(tab));
      wrap.appendChild(practiceLink());
      appEl.appendChild(wrap);
      return;
    }

    const many = readyCount > 1;
    wrap.innerHTML = `<p>Ready to watch for <strong>${readyCount}</strong> ${many ? "people" : "person"}. Availo signs in as one at a time, watches, then tells you when to switch. Nothing is ever booked, held, or paid automatically.</p>`;

    const startBtn = document.createElement("button");
    startBtn.className = "primary";
    startBtn.textContent = many ? "Start watching everyone (in turn)" : "Start watching";
    startBtn.addEventListener("click", async () => {
      appEl.innerHTML = "<p>Starting…</p>";
      const res = await sendToBackground({ type: "START_ROTATION", tabId: tab.id });
      if (!res.ok) {
        appEl.innerHTML = `<p class="status idle">Couldn't start: ${res.error === "no_people_ready" ? "add someone's details first." : res.error}</p>`;
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

    if (totalCount < 3) {
      const addBtn = document.createElement("button");
      addBtn.className = "link";
      addBtn.textContent = "Manage people";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
    }

    wrap.appendChild(diagnosticControls(tab));
    wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // Rotating.
  const r = state.rotation;
  const wrap = document.createElement("div");
  const detail = state.detection
    ? `<div class="status watching"><strong>Slot found:</strong> ${state.detection.test_centre} — ${new Date(state.detection.slot_datetime).toLocaleString()}</div>`
    : "";
  const posText = r.total > 1 ? `Person ${r.index + 1} of ${r.total} · ` : "";
  wrap.innerHTML = `<p class="status watching">${posText}${describeRotation(r)}</p>${detail}`;

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

  // Pause / resume cycling.
  const pauseBtn = document.createElement("button");
  pauseBtn.className = "link";
  pauseBtn.textContent = r.paused ? "Resume cycling" : "Pause on this person";
  pauseBtn.addEventListener("click", async () => {
    await sendToBackground({ type: r.paused ? "RESUME_ROTATION" : "PAUSE_ROTATION", tabId: tab.id });
    render();
  });
  wrap.appendChild(pauseBtn);

  // Skip to next person (only if more than one).
  if (r.total > 1) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "link";
    skipBtn.textContent = "Skip to next person";
    skipBtn.addEventListener("click", async () => {
      appEl.innerHTML = "<p>Switching…</p>";
      await sendToBackground({ type: "SKIP_PERSON", tabId: tab.id });
      await new Promise((r) => setTimeout(r, 1500)); // keep "Switching…" visible briefly
      render();
    });
    wrap.appendChild(skipBtn);
  }

  const stopBtn = document.createElement("button");
  stopBtn.className = "stop";
  stopBtn.textContent = "Stop watching everyone";
  stopBtn.addEventListener("click", async () => {
    appEl.innerHTML = "<p>Stopping…</p>";
    await sendToBackground({ type: "STOP_ROTATION", tabId: tab.id });
    render();
  });
  wrap.appendChild(stopBtn);

  wrap.appendChild(diagnosticControls(tab));
  wrap.appendChild(practiceLink());
  appEl.appendChild(wrap);
}

render();
