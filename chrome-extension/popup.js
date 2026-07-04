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

async function vaultComplete() {
  const { availoVault: v } = await chrome.storage.local.get("availoVault");
  return Boolean(v && (v.licence || "").trim().length >= 5 && (v.bookingRef || "").trim().length >= 3);
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

  const hasVault = await vaultComplete();

  if (!isSupported(tab.url)) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>Open the DVSA "change your driving test" page, then come back here.</p>
      <p class="status idle">Not on a supported page</p>
    `;
    if (!hasVault) {
      const addBtn = document.createElement("button");
      addBtn.className = "primary";
      addBtn.textContent = "Add your booking details";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
    }
    wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // On a supported page and signed in.
  if (!state.watching) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<p>Watch this tab for earlier slots, or use Fast-Path to fill your details and jump to the slot. Nothing is ever booked, held, or paid automatically.</p>`;

    const startBtn = document.createElement("button");
    startBtn.className = "primary";
    startBtn.textContent = "Start watching this tab";
    startBtn.addEventListener("click", async () => {
      appEl.innerHTML = "<p>Starting…</p>";
      const res = await sendToBackground({ type: "START_WATCH", tabId: tab.id });
      if (!res.ok) {
        appEl.innerHTML = `<p class="status idle">Couldn't start: ${res.error === "no_preferences_set" ? "set your centre/target date on the Availo dashboard first." : res.error}</p>`;
        return;
      }
      render();
    });
    wrap.appendChild(startBtn);

    if (hasVault) {
      const fpBtn = document.createElement("button");
      fpBtn.className = "accent";
      fpBtn.textContent = "Fast-Path now (fill & jump to slot)";
      fpBtn.addEventListener("click", async () => {
        await sendToBackground({ type: "ARM_FASTPATH", tabId: tab.id });
        window.close();
      });
      wrap.appendChild(fpBtn);
    } else {
      const addBtn = document.createElement("button");
      addBtn.className = "link";
      addBtn.textContent = "Add booking details to enable Fast-Path";
      addBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      wrap.appendChild(addBtn);
    }

    wrap.appendChild(diagnosticControls(tab));
    wrap.appendChild(practiceLink());
    appEl.appendChild(wrap);
    return;
  }

  // Watching.
  const wrap = document.createElement("div");
  const detail = state.detection
    ? `<div class="status watching"><strong>Slot found:</strong> ${state.detection.test_centre} — ${new Date(state.detection.slot_datetime).toLocaleString()}</div>`
    : "";
  wrap.innerHTML = `<p class="status watching">Watching for: ${state.watch.centre}</p>${detail}`;

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

  wrap.appendChild(diagnosticControls(tab));
  wrap.appendChild(practiceLink());
  appEl.appendChild(wrap);
}

render();
