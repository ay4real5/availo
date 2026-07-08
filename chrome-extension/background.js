// Chrome: service worker → importScripts. Firefox (esp. Android) loads these as
// event-page scripts listed in background.scripts (see build.mjs), so the globals
// are already defined and importScripts doesn't exist — guard for both.
// roster.js provides AvailoRoster; refresh-schedule.js provides nextRefreshDelay().
if (typeof importScripts === "function") importScripts("refresh-schedule.js", "roster.js");

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

const DEFAULT_BACKEND_URL = "https://availo-backend-4dbx.onrender.com";

// Single key holding the roster rotation state (chrome.storage.session so it
// survives MV3 service-worker suspension but resets when Chrome restarts).
const ROTATION_KEY = "availoRotation";

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
// is never sent to the backend. It's derived from the currently ACTIVE roster
// person, so Fast-Path fills whoever we're watching right now.
async function getVault() {
  const person = await AvailoRoster.getActivePerson();
  return AvailoRoster.personToVault(person);
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

// --- roster rotation state (storage.session-backed) ---
// Only ONE person is ever signed in at a time. The rotation object tracks who
// we're on, when to move to the next person, and whether a slot found for the
// current person has paused the cycle so it stays put.
//
// Shape: { tabId, order:[personId], index, phase:"watching"|"cooldown"|"break",
//          phaseUntil:ms, paused:bool }
async function getRotation() {
  const r = await chrome.storage.session.get(ROTATION_KEY);
  return r[ROTATION_KEY] || null;
}
async function setRotation(state) {
  if (state) await chrome.storage.session.set({ [ROTATION_KEY]: state });
  else await chrome.storage.session.remove(ROTATION_KEY);
}

// Begin (or restart) watching the person at rotation.index: create a backend
// watch session for them, prime Fast-Path to fill their details, and notify the
// user to sign in as them. Returns the person, or null if the roster is empty.
async function beginPersonWatch(rotation) {
  const roster = await AvailoRoster.get();
  const person = roster.find((p) => p.id === rotation.order[rotation.index]);
  if (!person) return null;

  await AvailoRoster.setActiveId(person.id);
  const pacing = await AvailoRoster.getPacing();

  // Fresh backend session for this person's primary centre. We alert only on
  // slots EARLIER than their current test date (targetDate); empty = any slot.
  const centre = (person.centres && person.centres[0]) || "unknown";
  const targetDate = person.currentTestDate || null;
  let session = null;
  try {
    const tab = await chrome.tabs.get(rotation.tabId);
    session = await apiFetch("/api/watch/sessions", {
      method: "POST",
      body: {
        centre,
        person_name: person.name || null,
        target_date: targetDate,
        tab_url: tab.url || null,
        extension_version: chrome.runtime.getManifest().version,
      },
    });
  } catch { /* backend session is best-effort; local watch still runs */ }

  await setWatch(rotation.tabId, {
    sessionId: session?.id || null,
    personId: person.id,
    personName: person.name || null,
    centre,
    centres: person.centres || [],
    targetDate,
    nextRefreshAt: Date.now() + 90000,
  });
  detections.delete(rotation.tabId);

  // Prime Fast-Path so the sign-in page auto-fills this person's details, and
  // tell the content script the new watch target.
  await chrome.tabs.sendMessage(rotation.tabId, {
    type: "WATCH_START",
    centre,
    centres: person.centres || [],
    targetDate,
  }).catch(() => {});
  await setFastpathActive(rotation.tabId, false); // passive fill only, user signs in

  notifySwitchPerson(rotation.tabId, person, rotation.index, rotation.order.length, pacing.watchMinutes);
  ensureWatchAlarm();
  return person;
}

// Move the rotation forward one phase when its timer is up. Called from the
// watch-tick alarm. Returns the (possibly updated) rotation.
async function advanceRotation(rotation, now) {
  if (!rotation || rotation.paused) return rotation;
  if (now < rotation.phaseUntil) return rotation; // still within the current phase

  const pacing = await AvailoRoster.getPacing();

  if (rotation.phase === "watching") {
    // Time's up for this person — end their watch and start a short cooldown.
    await endCurrentWatch(rotation.tabId);
    rotation.phase = "cooldown";
    rotation.phaseUntil = now + pacing.cooldownSeconds * 1000;
    notifyCooldown(rotation.tabId);
    await setRotation(rotation);
    return rotation;
  }

  if (rotation.phase === "cooldown") {
    rotation.index += 1;
    if (rotation.index >= rotation.order.length) {
      // Full cycle complete — take a long break before looping.
      rotation.index = 0;
      rotation.phase = "break";
      rotation.phaseUntil = now + pacing.breakMinutes * 1000 * 60;
      notifyBreak(rotation.tabId, pacing.breakMinutes);
      await setRotation(rotation);
      return rotation;
    }
    rotation.phase = "watching";
    rotation.phaseUntil = now + pacing.watchMinutes * 1000 * 60;
    await setRotation(rotation);
    await beginPersonWatch(rotation);
    return rotation;
  }

  if (rotation.phase === "break") {
    // Break over — start the cycle again from the top.
    rotation.index = 0;
    rotation.phase = "watching";
    rotation.phaseUntil = now + pacing.watchMinutes * 1000 * 60;
    await setRotation(rotation);
    await beginPersonWatch(rotation);
    return rotation;
  }

  return rotation;
}

// End the active watch for a tab WITHOUT tearing down rotation state.
async function endCurrentWatch(tabId) {
  const watch = await getWatch(tabId);
  await clearWatch(tabId);
  detections.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "WATCH_STOP" }).catch(() => {});
  if (watch?.sessionId) {
    try { await apiFetch(`/api/watch/sessions/${watch.sessionId}/stop`, { method: "POST" }); } catch { /* best-effort */ }
  }
}

// Fully stop rotation and any active watch.
async function stopRotation() {
  const rotation = await getRotation();
  if (rotation) await endCurrentWatch(rotation.tabId);
  await setRotation(null);
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
        const rotation = await getRotation();
        const roster = await AvailoRoster.get();
        sendResponse({
          ok: true,
          signedIn: Boolean(token),
          email: email || null,
          watching: Boolean(watch),
          watch,
          detection: detections.get(message.tabId) || null,
          autoRefresh,
          rotation: rotation && rotation.tabId === message.tabId ? summariseRotation(rotation, roster) : null,
          rosterCount: roster.length,
          rosterReady: roster.filter((p) => AvailoRoster.personReady(p)).length,
        });
        break;
      }

      // -- Roster rotation --------------------------------------------------
      case "START_ROTATION": {
        const tabId = message.tabId;
        const roster = await AvailoRoster.get();
        const ready = roster.filter((p) => AvailoRoster.personReady(p));
        if (ready.length === 0) { sendResponse({ ok: false, error: "no_people_ready" }); break; }

        const pacing = await AvailoRoster.getPacing();
        const rotation = {
          tabId,
          order: ready.map((p) => p.id),
          index: 0,
          phase: "watching",
          phaseUntil: Date.now() + pacing.watchMinutes * 60 * 1000,
          paused: false,
        };
        await setRotation(rotation);
        await beginPersonWatch(rotation);
        sendResponse({ ok: true, rotation: summariseRotation(rotation, roster) });
        break;
      }

      case "STOP_ROTATION": {
        await stopRotation();
        sendResponse({ ok: true });
        break;
      }

      case "PAUSE_ROTATION": {
        const rotation = await getRotation();
        if (rotation) { rotation.paused = true; await setRotation(rotation); }
        sendResponse({ ok: true });
        break;
      }

      case "RESUME_ROTATION": {
        const rotation = await getRotation();
        if (rotation) {
          rotation.paused = false;
          // Give the current person a fresh full window on resume.
          const pacing = await AvailoRoster.getPacing();
          if (rotation.phase === "watching") rotation.phaseUntil = Date.now() + pacing.watchMinutes * 60 * 1000;
          await setRotation(rotation);
        }
        sendResponse({ ok: true });
        break;
      }

      case "SKIP_PERSON": {
        const rotation = await getRotation();
        if (!rotation) { sendResponse({ ok: false, error: "not_rotating" }); break; }
        // Jump straight into cooldown so the normal advance path moves us on.
        rotation.paused = false;
        rotation.phase = "cooldown";
        rotation.phaseUntil = 0; // due immediately
        await setRotation(rotation);
        const advanced = await advanceRotation(rotation, Date.now());
        const roster = await AvailoRoster.get();
        sendResponse({ ok: true, rotation: summariseRotation(advanced, roster) });
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

        // A slot for the current person — freeze the rotation so we DON'T cycle
        // away from them mid-booking. The user can resume/skip from the popup.
        const rotation = await getRotation();
        if (rotation && !rotation.paused) { rotation.paused = true; await setRotation(rotation); }

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

      case "QUEUED": {
        // DVSA/Queue-it waiting room. This is NOT a block — hold position and
        // wait. Freeze the rotation timer so we don't cycle this person away
        // while they're queuing, and let the user know they're in line.
        const tabId = sender.tab?.id;
        const watch = await getWatch(tabId);
        if (!watch) { sendResponse({ ok: false, error: "not_watching" }); break; }
        const rotation = await getRotation();
        if (rotation && rotation.tabId === tabId && !rotation.paused) {
          rotation.paused = true;
          await setRotation(rotation);
        }
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
        // A block stops the whole rotation — we never try to push past DVSA's
        // defences. Tell the user and stand down.
        const rotation = await getRotation();
        if (rotation && rotation.tabId === tabId) await setRotation(null);
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

async function stopWatch(tabId) {
  const watch = await getWatch(tabId);
  await clearWatch(tabId);
  detections.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "WATCH_STOP" }).catch(() => {});
  if (!watch || !watch.sessionId) return;
  try {
    await apiFetch(`/api/watch/sessions/${watch.sessionId}/stop`, { method: "POST" });
  } catch { /* best-effort — staleness check covers it */ }
}

// Compact rotation view for the popup: who's active, position, phase, and how
// long is left in the current phase.
function summariseRotation(rotation, roster) {
  if (!rotation) return null;
  const person = roster.find((p) => p.id === rotation.order[rotation.index]) || null;
  const nextId = rotation.order[(rotation.index + 1) % rotation.order.length];
  const next = roster.find((p) => p.id === nextId) || null;
  return {
    phase: rotation.phase,
    paused: Boolean(rotation.paused),
    index: rotation.index,
    total: rotation.order.length,
    personName: person?.name || "This person",
    centre: (person?.centres && person.centres[0]) || null,
    nextName: rotation.order.length > 1 ? (next?.name || "next person") : null,
    secondsLeft: Math.max(0, Math.round((rotation.phaseUntil - Date.now()) / 1000)),
  };
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

// Roster rotation notifications ------------------------------------------------

// It's this person's turn — the user needs to sign in as them.
function notifySwitchPerson(tabId, person, index, total, watchMinutes) {
  const name = person.name || "the next person";
  chrome.notifications.create(`availo-switch-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: total > 1 ? `Now watching ${name} (${index + 1} of ${total})` : `Now watching ${name}`,
    message: `Sign in to DVSA as ${name} — their details are pre-filled. We'll watch for about ${watchMinutes} min, then it's the next person's turn.`,
    priority: 2,
    requireInteraction: true,
  });
  chrome.action.setBadgeText({ tabId, text: `${index + 1}` });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2f6f62" });
}

// Short pause between people so the same IP isn't logging in back-to-back.
function notifyCooldown(tabId) {
  chrome.notifications.create(`availo-cooldown-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Switching to the next person",
    message: "Please sign out of DVSA. We'll tell you who's next in a moment.",
    priority: 1,
  });
  chrome.action.setBadgeText({ tabId, text: "…" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#67766c" });
}

// Full cycle done — take a long break before looping.
function notifyBreak(tabId, breakMinutes) {
  chrome.notifications.create(`availo-break-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Taking a break",
    message: `Everyone's had a turn. We'll rest for about ${breakMinutes} min so DVSA sees normal, human activity — then start again. You can sign out and step away.`,
    priority: 1,
  });
  chrome.action.setBadgeText({ tabId, text: "z" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#67766c" });
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
  const now = Date.now();

  // Advance the roster rotation first — its timer may end the current watch or
  // start the next person before we do the per-tab heartbeat/refresh below.
  const rotation = await getRotation();
  if (rotation) await advanceRotation(rotation, now);

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
      const delay = nextRefreshDelay(baseSeconds * 1000, 30000);
      await setWatch(watch.tabId, { ...watch, nextRefreshAt: now + delay });
    } else {
      await chrome.tabs.sendMessage(watch.tabId, { type: "RESCAN" }).catch(() => {});
    }
  }
});
