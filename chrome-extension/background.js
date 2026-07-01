const DEFAULT_BACKEND_URL = "http://localhost:4000";

// -- legacy passive telemetry path (unchanged) --------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SEND_METRICS") {
    getBackendUrl().then((backendUrl) => {
      fetch(`${backendUrl}/api/sessions/behaviour`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.payload),
      })
        .then((res) => res.json())
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    });
    return true; // keep channel open for async response
  }

  handleWatchMessage(message, sender, sendResponse);
  return true;
});

// -- Watch & Assist -----------------------------------------------------------
// watchedTabs: tabId -> { sessionId, centre, targetDate }
// detections: tabId -> { slotId, test_centre, slot_datetime } (latest live banner)
const watchedTabs = new Map();
const detections = new Map();
const notificationTabs = new Map(); // notificationId -> tabId

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function getBackendUrl() {
  const { backendUrl } = await getStored();
  return backendUrl || DEFAULT_BACKEND_URL;
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const { backendUrl, token } = await getStored();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch(`${(backendUrl || DEFAULT_BACKEND_URL)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `request_failed_${res.status}`);
  return data;
}

async function handleWatchMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case "GET_TAB_STATE": {
        const tabId = message.tabId;
        const watch = watchedTabs.get(tabId) || null;
        const { token, email } = await getStored();
        sendResponse({
          ok: true,
          signedIn: Boolean(token),
          email: email || null,
          watching: Boolean(watch),
          watch,
          detection: detections.get(tabId) || null,
        });
        break;
      }

      case "START_WATCH": {
        const tabId = message.tabId;
        const tab = await chrome.tabs.get(tabId);
        const prefs = await apiFetch("/api/auth/preferences");
        if (!prefs) throw new Error("no_preferences_set");

        const session = await apiFetch("/api/watch/sessions", {
          method: "POST",
          body: {
            centre: prefs.centre,
            target_date: prefs.current_test_date || null,
            tab_url: tab.url || null,
            extension_version: chrome.runtime.getManifest().version,
          },
        });

        watchedTabs.set(tabId, { sessionId: session.id, centre: prefs.centre, targetDate: prefs.current_test_date });
        detections.delete(tabId);

        await chrome.tabs.sendMessage(tabId, {
          type: "WATCH_START",
          sessionId: session.id,
          centre: prefs.centre,
          targetDate: prefs.current_test_date,
        }).catch(() => {});

        ensureHeartbeatAlarm();
        sendResponse({ ok: true, session });
        break;
      }

      case "STOP_WATCH": {
        const tabId = message.tabId;
        await stopWatch(tabId);
        sendResponse({ ok: true });
        break;
      }

      case "USER_CLICKED_HOLD": {
        const tabId = message.tabId;
        await chrome.tabs.update(tabId, { active: true });
        await chrome.tabs.sendMessage(tabId, { type: "PERFORM_HOLD_CLICK" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // -- messages from watch-content.js (sender.tab is set) --
      case "SLOT_DETECTED": {
        const tabId = sender.tab?.id;
        const watch = tabId != null ? watchedTabs.get(tabId) : null;
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }

        const result = await apiFetch("/api/watch/events", {
          method: "POST",
          body: {
            event_type: "slot_detected",
            watch_session_id: watch.sessionId,
            test_centre: message.test_centre,
            slot_datetime: message.slot_datetime,
            page_url: message.page_url || null,
          },
        });

        detections.set(tabId, {
          slotId: result.slot_id,
          test_centre: message.test_centre,
          slot_datetime: message.slot_datetime,
        });

        notifyDetection(tabId, message.test_centre, message.slot_datetime);
        sendResponse({ ok: true, slotId: result.slot_id });
        break;
      }

      case "HOLD_CLICKED": {
        const tabId = sender.tab?.id;
        const watch = tabId != null ? watchedTabs.get(tabId) : null;
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        const detection = detections.get(tabId);
        await apiFetch("/api/watch/events", {
          method: "POST",
          body: {
            event_type: "hold_clicked",
            watch_session_id: watch.sessionId,
            slot_id: detection?.slotId || null,
            test_centre: message.test_centre,
            slot_datetime: message.slot_datetime,
          },
        });
        sendResponse({ ok: true });
        break;
      }

      case "HOLD_RESULT": {
        const tabId = sender.tab?.id;
        const watch = tabId != null ? watchedTabs.get(tabId) : null;
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        const detection = detections.get(tabId);
        await apiFetch("/api/watch/events", {
          method: "POST",
          body: {
            event_type: "hold_result",
            watch_session_id: watch.sessionId,
            slot_id: detection?.slotId || null,
            outcome: message.outcome,
            message: message.message || null,
          },
        });
        sendResponse({ ok: true });
        break;
      }

      case "BLOCKED": {
        const tabId = sender.tab?.id;
        const watch = tabId != null ? watchedTabs.get(tabId) : null;
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        await apiFetch("/api/watch/events", {
          method: "POST",
          body: {
            event_type: "blocked",
            watch_session_id: watch.sessionId,
            reason: message.reason || null,
            page_url: message.page_url || null,
          },
        });
        // Detection stopped itself on the content-script side; drop our local state too.
        watchedTabs.delete(tabId);
        detections.delete(tabId);
        sendResponse({ ok: true });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function stopWatch(tabId) {
  const watch = watchedTabs.get(tabId);
  watchedTabs.delete(tabId);
  detections.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "WATCH_STOP" }).catch(() => {});
  if (!watch) return;
  try {
    await apiFetch(`/api/watch/sessions/${watch.sessionId}/stop`, { method: "POST" });
  } catch {
    // best-effort — a stale session will just show as inactive via the heartbeat check
  }
}

function notifyDetection(tabId, centre, slotDatetime) {
  const when = new Date(slotDatetime).toLocaleString();
  const notificationId = `availo-slot-${tabId}-${Date.now()}`;
  notificationTabs.set(notificationId, tabId);
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Availo: earlier slot found!",
    message: `${centre} — ${when}. Open the tab and click Hold to secure it yourself.`,
    priority: 2,
    requireInteraction: true,
    buttons: [{ title: "Hold this slot" }],
  });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d4351c" });
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex !== 0) return;
  const tabId = notificationTabs.get(notificationId);
  if (tabId == null) return;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: "PERFORM_HOLD_CLICK" }).catch(() => {});
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const tabId = notificationTabs.get(notificationId);
  if (tabId == null) return;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
});

// Best-effort cleanup when a watched tab is closed — the MV3 service worker can
// be killed mid-request, so the heartbeat staleness check (backend + dashboard)
// is the reliable fallback if this doesn't complete.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (watchedTabs.has(tabId)) stopWatch(tabId);
});

// chrome.alarms (not setInterval) survives MV3 service-worker suspension, which
// is required for heartbeats to keep flowing during a long watch session.
function ensureHeartbeatAlarm() {
  chrome.alarms.get("watch-heartbeat", (alarm) => {
    if (!alarm) chrome.alarms.create("watch-heartbeat", { periodInMinutes: 1 });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "watch-heartbeat") return;
  if (watchedTabs.size === 0) return;
  for (const [tabId, watch] of watchedTabs.entries()) {
    try {
      await apiFetch(`/api/watch/sessions/${watch.sessionId}/heartbeat`, { method: "POST" });
    } catch {
      // a single failed heartbeat isn't fatal — the next alarm tick retries
    }
  }
});
