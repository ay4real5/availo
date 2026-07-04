importScripts("refresh-schedule.js"); // provides nextRefreshDelay()

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
// Watch state is kept in chrome.storage.session (keyed ws_<tabId>) so "leave it
// running" survives MV3 service-worker suspension. detections/notificationTabs
// are transient UI state — fine to keep in memory.
const detections = new Map(); // tabId -> { slotId, test_centre, slot_datetime }
const notificationTabs = new Map(); // notificationId -> tabId

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function getBackendUrl() {
  const { backendUrl } = await getStored();
  return backendUrl || DEFAULT_BACKEND_URL;
}

// The vault (licence/booking-ref/search) lives only in chrome.storage.local and
// is never sent to the backend.
async function getVault() {
  const r = await chrome.storage.local.get("availoVault");
  return r.availoVault || null;
}

// Auto-refresh setting (see options page). Default: on, conservative cadence.
async function getAutoRefresh() {
  const r = await chrome.storage.local.get("availoAutoRefresh");
  const s = r.availoAutoRefresh || {};
  return { enabled: s.enabled !== false, baseSeconds: Math.max(45, Number(s.baseSeconds) || 90) };
}

// --- watch state (storage.session-backed) ---
async function getWatch(tabId) {
  if (tabId == null) return null;
  const r = await chrome.storage.session.get(`ws_${tabId}`);
  return r[`ws_${tabId}`] || null;
}
async function setWatch(tabId, data) {
  await chrome.storage.session.set({ [`ws_${tabId}`]: data });
}
async function clearWatch(tabId) {
  await chrome.storage.session.remove(`ws_${tabId}`);
}
async function allWatches() {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith("ws_"))
    .map(([k, v]) => ({ tabId: Number(k.slice(3)), ...v }));
}

// --- fast-path active flag (unchanged) ---
async function setFastpathActive(tabId, active) {
  const key = `fp_${tabId}`;
  if (active) await chrome.storage.session.set({ [key]: true });
  else await chrome.storage.session.remove(key);
}
async function isFastpathActive(tabId) {
  if (tabId == null) return false;
  const r = await chrome.storage.session.get(`fp_${tabId}`);
  return Boolean(r[`fp_${tabId}`]);
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const { backendUrl, token } = await getStored();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch(`${(backendUrl || DEFAULT_BACKEND_URL)}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
        const watch = await getWatch(message.tabId);
        const { token, email } = await getStored();
        const autoRefresh = await getAutoRefresh();
        sendResponse({
          ok: true,
          signedIn: Boolean(token),
          email: email || null,
          watching: Boolean(watch),
          watch,
          detection: detections.get(message.tabId) || null,
          autoRefresh,
        });
        break;
      }

      case "WATCH_RESUME_QUERY": {
        // A watched tab reloaded and is asking whether to resume.
        const watch = await getWatch(sender.tab?.id);
        sendResponse(watch ? { watching: true, centre: watch.centre, targetDate: watch.targetDate } : { watching: false });
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

        await setWatch(tabId, {
          sessionId: session.id,
          centre: prefs.centre,
          targetDate: prefs.current_test_date || null,
          nextRefreshAt: Date.now() + 90000,
        });
        detections.delete(tabId);

        await chrome.tabs.sendMessage(tabId, {
          type: "WATCH_START",
          centre: prefs.centre,
          targetDate: prefs.current_test_date || null,
        }).catch(() => {});

        ensureWatchAlarm();
        sendResponse({ ok: true, session });
        break;
      }

      case "STOP_WATCH": {
        await stopWatch(message.tabId);
        sendResponse({ ok: true });
        break;
      }

      case "USER_CLICKED_HOLD": {
        const tabId = message.tabId;
        await chrome.tabs.update(tabId, { active: true });
        await chrome.tabs.sendMessage(tabId, { type: "REVEAL_SLOT" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // -- Fast-Path --------------------------------------------------------
      case "ARM_FASTPATH": {
        const tabId = message.tabId;
        await setFastpathActive(tabId, true);
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        await chrome.tabs.sendMessage(tabId, { type: "FASTPATH_RUN" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case "FASTPATH_WHATNOW": {
        const vault = await getVault();
        const active = await isFastpathActive(sender.tab?.id);
        let prefs = null;
        if (active) {
          try {
            const p = await apiFetch("/api/auth/preferences");
            if (p) prefs = { centre: p.centre, targetDate: p.current_test_date || null };
          } catch { /* passive autofill still works without prefs */ }
        }
        sendResponse({ ok: true, active, vault, prefs });
        break;
      }

      case "FASTPATH_DONE":
      case "FASTPATH_BLOCKED": {
        await setFastpathActive(sender.tab?.id, false);
        sendResponse({ ok: true });
        break;
      }

      // -- messages from watch-content.js (sender.tab is set) --
      case "SLOT_DETECTED": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
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

      case "HOLD_CLICKED":
      case "HOLD_RESULT": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        const detection = detections.get(tabId);
        const body = message.type === "HOLD_CLICKED"
          ? {
              event_type: "hold_clicked",
              watch_session_id: watch.sessionId,
              slot_id: detection?.slotId || null,
              test_centre: message.test_centre,
              slot_datetime: message.slot_datetime,
            }
          : {
              event_type: "hold_result",
              watch_session_id: watch.sessionId,
              slot_id: detection?.slotId || null,
              outcome: message.outcome,
              message: message.message || null,
            };
        await apiFetch("/api/watch/events", { method: "POST", body });
        sendResponse({ ok: true });
        break;
      }

      case "BLOCKED": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
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
        // Content stopped itself on a block; drop our state so we don't refresh into it.
        await clearWatch(tabId);
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
  const watch = await getWatch(tabId);
  await clearWatch(tabId);
  detections.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "WATCH_STOP" }).catch(() => {});
  if (!watch) return;
  try {
    await apiFetch(`/api/watch/sessions/${watch.sessionId}/stop`, { method: "POST" });
  } catch { /* best-effort — staleness check covers it */ }
}

function notifyDetection(tabId, centre, slotDatetime) {
  const when = new Date(slotDatetime).toLocaleString();
  const notificationId = `availo-slot-${tabId}-${Date.now()}`;
  notificationTabs.set(notificationId, tabId);
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Earlier driving test slot!",
    message: `${centre} — ${when}. Open DVSA now and click Book — we've highlighted it for you.`,
    priority: 2,
    requireInteraction: true,
    buttons: [{ title: "Take me to the slot" }],
  });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e0932a" });
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex !== 0) return;
  const tabId = notificationTabs.get(notificationId);
  if (tabId == null) return;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: "REVEAL_SLOT" }).catch(() => {});
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const tabId = notificationTabs.get(notificationId);
  if (tabId == null) return;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopWatch(tabId);
  setFastpathActive(tabId, false);
});

// One alarm drives heartbeat + rescan + gentle auto-refresh. chrome.alarms fires
// even when the tab is backgrounded and after the SW was suspended — the reliable
// way to keep "leave it running" alive (a page setInterval gets throttled).
function ensureWatchAlarm() {
  chrome.alarms.get("watch-tick", (alarm) => {
    if (!alarm) chrome.alarms.create("watch-tick", { periodInMinutes: 1 });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "watch-tick") return;
  const watches = await allWatches();
  if (watches.length === 0) return;

  const { enabled: autoRefreshOn, baseSeconds } = await getAutoRefresh();
  const now = Date.now();

  for (const watch of watches) {
    // Keep the backend session fresh.
    try {
      await apiFetch(`/api/watch/sessions/${watch.sessionId}/heartbeat`, { method: "POST" });
    } catch { /* next tick retries */ }

    // Gentle auto-refresh so new cancellations surface — slow, jittered, and the
    // content script refuses to refresh into a block. Otherwise just re-scan.
    if (autoRefreshOn && watch.nextRefreshAt && now >= watch.nextRefreshAt) {
      await chrome.tabs.sendMessage(watch.tabId, { type: "REFRESH_PAGE" }).catch(() => {});
      const delay = nextRefreshDelay(baseSeconds * 1000, 30000);
      await setWatch(watch.tabId, { ...watch, nextRefreshAt: now + delay });
    } else {
      await chrome.tabs.sendMessage(watch.tabId, { type: "RESCAN" }).catch(() => {});
    }
  }
});
