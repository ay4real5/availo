const appEl = document.getElementById("app");

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isDvsaish(url) {
  if (!url) return false;
  return /gov\.uk|localhost:8000/.test(url);
}

async function render() {
  const tab = await getCurrentTab();
  if (!tab) { appEl.textContent = "No active tab."; return; }

  const state = await sendToBackground({ type: "GET_TAB_STATE", tabId: tab.id });

  if (!state?.signedIn) {
    appEl.innerHTML = `
      <p>Sign in to start watching for earlier driving test slots.</p>
      <button class="primary" id="openOptions">Sign in</button>
    `;
    document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  if (!isDvsaish(tab.url)) {
    appEl.innerHTML = `
      <p>Open the real DVSA "change your driving test" page, then come back here to start watching.</p>
      <p class="status idle">Not on a supported page</p>
    `;
    return;
  }

  if (!state.watching) {
    appEl.innerHTML = `
      <p>Watch this tab for earlier slots. Nothing is ever booked or held automatically — you'll get an alert and click through yourself.</p>
      <button class="primary" id="start">Start watching this tab</button>
    `;
    document.getElementById("start").addEventListener("click", async () => {
      appEl.innerHTML = "<p>Starting…</p>";
      const res = await sendToBackground({ type: "START_WATCH", tabId: tab.id });
      if (!res.ok) {
        appEl.innerHTML = `<p class="status idle">Couldn't start: ${res.error === "no_preferences_set" ? "set your centre/target date on the Availo dashboard first." : res.error}</p>`;
        return;
      }
      render();
    });
    return;
  }

  const detectionHtml = state.detection
    ? `<div id="detection" style="display:block">
         <strong>Slot found:</strong> ${state.detection.test_centre} — ${new Date(state.detection.slot_datetime).toLocaleString()}
         <button class="hold" id="hold">Hold this slot</button>
       </div>`
    : "";

  appEl.innerHTML = `
    <p class="status watching">Watching for: ${state.watch.centre}</p>
    ${detectionHtml}
    <button class="stop" id="stop">Stop watching</button>
  `;

  document.getElementById("stop").addEventListener("click", async () => {
    appEl.innerHTML = "<p>Stopping…</p>";
    await sendToBackground({ type: "STOP_WATCH", tabId: tab.id });
    render();
  });

  const holdBtn = document.getElementById("hold");
  if (holdBtn) {
    holdBtn.addEventListener("click", async () => {
      await sendToBackground({ type: "USER_CLICKED_HOLD", tabId: tab.id });
      window.close();
    });
  }
}

render();
