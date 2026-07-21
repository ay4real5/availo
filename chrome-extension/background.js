// Chrome: service worker → importScripts. Firefox (esp. Android) loads these as
// event-page scripts listed in background.scripts (see build.mjs), so the globals
// are already defined and importScripts doesn't exist — guard for both.
// vault.js provides AvailoVault; refresh-schedule.js provides nextRefreshDelay().
if (typeof importScripts === "function") importScripts("refresh-schedule.js", "vault.js");

// Firefox Android may not support notifications/action badges. Stub them to no-ops
// if absent so the six notify functions and their top-level listener registrations
// never throw there — the in-page banner + backend push are the real mobile alerts.
if (!chrome.notifications) {
  chrome.notifications = {
    create() {}, clear() {},
    onClicked: { addListener() {} },
    onButtonClicked: { addListener() {} },
  };
}
if (!chrome.action) {
  chrome.action = { setBadgeText() {}, setBadgeBackgroundColor() {} };
}
// chrome.alarms may be missing/limited on iOS Safari. Stub it so the background
// scripts and top-level listeners don't throw; watching then degrades to scanning
// while the DVSA tab is foregrounded (iOS suspends background work anyway).
if (!chrome.alarms) {
  chrome.alarms = { get(_n, cb) { if (cb) cb(null); }, create() {}, clear() {}, onAlarm: { addListener() {} } };
}

const DEFAULT_BACKEND_URL = "https://availo-backend-4dbx.onrender.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleWatchMessage(message, sender, sendResponse);
  return true;
});

// -- Watch & Assist -----------------------------------------------------------
// Watch state is kept in chrome.storage.session (keyed ws_<tabId>) so "leave it
// running" survives MV3 service-worker suspension. detections/notificationTabs
// are transient UI state — fine to keep in memory.
const detections = new Map(); // tabId -> { slotId, test_centre, slot_datetime }
const notificationTabs = new Map(); // notificationId -> tabId
const statuses = new Map(); // tabId -> { total, inWindow, month, at } (live watch status for the popup)

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
  return AvailoVault.get();
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
          status: statuses.get(message.tabId) || null,
          autoRefresh,
          vaultReady: AvailoVault.ready(await AvailoVault.get()),
        });
        break;
      }

      case "WATCH_RESUME_QUERY": {
        // A watched tab reloaded and is asking whether to resume.
        const watch = await getWatch(sender.tab?.id);
        sendResponse(watch
          ? { watching: true, centre: watch.centre, targetDate: watch.targetDate, dateFrom: watch.dateFrom, dateTo: watch.dateTo }
          : { watching: false });
        break;
      }

      case "WATCH_STATUS": {
        // Lightweight per-scan status from the content script, for the popup.
        const tabId = sender.tab?.id;
        if (tabId != null) {
          statuses.set(tabId, {
            total: message.total || 0,
            inWindow: message.inWindow || 0,
            month: message.month || null,
            at: message.at || Date.now(),
          });
        }
        sendResponse({ ok: true });
        break;
      }

      case "START_WATCH": {
        const tabId = message.tabId;
        const tab = await chrome.tabs.get(tabId);
        const prefs = await apiFetch("/api/auth/preferences");
        if (!prefs) throw new Error("no_preferences_set");
        // The wanted date window lives device-side in the vault (options page:
        // "Alert from" / "Alert until"). Only alert for slots inside it.
        const vault = await getVault();

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
          dateFrom: vault.dateFrom || null,
          dateTo: vault.dateTo || null,
          nextRefreshAt: Date.now() + 90000,
        });
        detections.delete(tabId);
        statuses.delete(tabId);

        await chrome.tabs.sendMessage(tabId, {
          type: "WATCH_START",
          centre: prefs.centre,
          targetDate: prefs.current_test_date || null,
          dateFrom: vault.dateFrom || null,
          dateTo: vault.dateTo || null,
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
        await revealSlotInTab(message.tabId);
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

        let slotId = null;
        if (watch.sessionId) {
          try {
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
            slotId = result.slot_id;
          } catch { /* on-device alert still fires below */ }
        }

        detections.set(tabId, {
          slotId,
          test_centre: message.test_centre,
          slot_datetime: message.slot_datetime,
        });

        notifyDetection(tabId, message.test_centre, message.slot_datetime, watch.personName);
        sendResponse({ ok: true, slotId });
        break;
      }

      case "HOLD_CLICKED":
      case "HOLD_RESULT": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        if (!watch.sessionId) { sendResponse({ ok: true }); break; }
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
        try { await apiFetch("/api/watch/events", { method: "POST", body }); } catch { /* best-effort */ }
        sendResponse({ ok: true });
        break;
      }

      case "SIGNED_OUT": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        // Tell the user (they may be away) — desktop + phone/email via backend.
        notifySignedOut(tabId, watch.centre);
        if (watch.sessionId) {
          try {
            await apiFetch("/api/watch/events", {
              method: "POST",
              body: { event_type: "signed_out", watch_session_id: watch.sessionId },
            });
          } catch { /* alert already shown on-device; backend push is best-effort */ }
        }
        sendResponse({ ok: true });
        break;
      }

      case "VISIBILITY": {
        // The watched tab reports whether it's currently hidden, so the refresh
        // cadence can ease off while nobody's looking (see the alarm handler).
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (watch) await setWatch(tabId, { ...watch, hidden: Boolean(message.hidden) });
        sendResponse({ ok: true });
        break;
      }

      case "QUEUED": {
        // DVSA/Queue-it waiting room. This is NOT a block — hold position and
        // wait, and let the user know they're in line.
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        if (watch.sessionId) {
          try {
            await apiFetch("/api/watch/events", {
              method: "POST",
              body: { event_type: "queued", watch_session_id: watch.sessionId, page_url: message.page_url || null },
            });
          } catch { /* best-effort — on-device banner already covers it */ }
        }
        notifyQueued(tabId, watch.personName);
        sendResponse({ ok: true });
        break;
      }

      case "BLOCKED": {
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        if (watch.sessionId) {
          try {
            await apiFetch("/api/watch/events", {
              method: "POST",
              body: {
                event_type: "blocked",
                watch_session_id: watch.sessionId,
                reason: message.reason || null,
                page_url: message.page_url || null,
              },
            });
          } catch { /* best-effort */ }
        }
        // We never try to push past DVSA's defences. Tell the user and stand down.
        await clearWatch(tabId);
        detections.delete(tabId);
        notifyBlocked(tabId);
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

// Jump the user straight onto the highlighted slot as fast as possible: focus
// the browser window, activate the tab, and tell the content script to scroll
// to + re-highlight the slot (re-verifying it's still live). Every second counts
// when a cancellation can vanish.
async function revealSlotInTab(tabId) {
  if (tabId == null) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  } catch { /* tab may be gone */ }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: "REVEAL_SLOT" }).catch(() => {});
}

async function stopWatch(tabId) {
  const watch = await getWatch(tabId);
  await clearWatch(tabId);
  detections.delete(tabId);
  statuses.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "WATCH_STOP" }).catch(() => {});
  if (!watch || !watch.sessionId) return;
  try {
    await apiFetch(`/api/watch/sessions/${watch.sessionId}/stop`, { method: "POST" });
  } catch { /* best-effort — staleness check covers it */ }
}

function notifyDetection(tabId, centre, slotDatetime, personName) {
  const when = new Date(slotDatetime).toLocaleString();
  const who = personName ? `${personName}: ` : "";
  // Stable per-tab id so repeat detections update the same toast in place
  // instead of stacking dozens of separate notifications.
  const notificationId = `availo-slot-${tabId}`;
  notificationTabs.set(notificationId, tabId);
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: personName ? `Earlier slot for ${personName}!` : "Earlier driving test slot!",
    message: `${who}${centre} — ${when}. Open DVSA now and click Book — we've highlighted it for you.`,
    priority: 2,
    requireInteraction: true,
    buttons: [{ title: "Take me to the slot" }],
  });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e0932a" });
}

function notifySignedOut(tabId, centre) {
  chrome.notifications.create(`availo-signedout-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Availo stopped watching — you were signed out",
    message: `DVSA signed you out${centre ? ` (${centre})` : ""}. Sign back in to keep watching — your details are already filled in.`,
    priority: 2,
    requireInteraction: true,
  });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#c24e3a" });
}

// DVSA queue/waiting room — wait it out, don't stop.
function notifyQueued(tabId, personName) {
  const who = personName ? ` for ${personName}` : "";
  chrome.notifications.create(`availo-queued-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "You're in the DVSA queue",
    message: `DVSA has put you in a waiting room${who}. Stay on this page and wait — don't refresh, or you'll lose your place. Watching is paused until you're through.`,
    priority: 2,
    requireInteraction: true,
  });
  chrome.action.setBadgeText({ tabId, text: "Q" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e0932a" });
}

// DVSA challenge/block — stand down completely.
function notifyBlocked(tabId) {
  chrome.notifications.create(`availo-blocked-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Availo has stopped — DVSA showed a challenge",
    message: "DVSA is showing a security check or error. We've stopped watching to keep the account safe. Take a long break and try again later.",
    priority: 2,
    requireInteraction: true,
  });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#c24e3a" });
}

// Tapping the notification anywhere — the body OR the "Take me to the slot"
// button — jumps straight to the highlighted slot. (Some platforms/mobile don't
// surface the button, so the body tap must work too.)
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex !== 0) return;
  await revealSlotInTab(notificationTabs.get(notificationId));
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  await revealSlotInTab(notificationTabs.get(notificationId));
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
  const now = Date.now();

  const watches = await allWatches();
  if (watches.length === 0) return;

  const { enabled: autoRefreshOn, baseSeconds } = await getAutoRefresh();

  for (const watch of watches) {
    // Keep the backend session fresh (only if we have one).
    if (watch.sessionId) {
      try {
        await apiFetch(`/api/watch/sessions/${watch.sessionId}/heartbeat`, { method: "POST" });
      } catch { /* next tick retries */ }
    }

    // Gentle auto-refresh so new cancellations surface — slow, jittered, and the
    // content script refuses to refresh into a block. Otherwise just re-scan.
    if (autoRefreshOn && watch.nextRefreshAt && now >= watch.nextRefreshAt) {
      await chrome.tabs.sendMessage(watch.tabId, { type: "REFRESH_PAGE" }).catch(() => {});
      // Ease off while the tab is hidden: stretch the gap to cut total requests
      // (fewer CAPTCHA triggers) during long unattended stretches. This is load
      // reduction — NOT pattern-hiding — and the content script still refuses to
      // refresh into a block regardless.
      const hiddenMultiplier = watch.hidden ? 1.5 : 1;
      const delay = nextRefreshDelay(baseSeconds * 1000 * hiddenMultiplier, 30000);
      await setWatch(watch.tabId, { ...watch, nextRefreshAt: now + delay });
    } else {
      await chrome.tabs.sendMessage(watch.tabId, { type: "RESCAN" }).catch(() => {});
    }
  }
});
