// ============================================================================
// roster.js — shared roster + pacing storage for "watch a few people from one
// laptop" mode.
//
// Everything here lives ONLY in chrome.storage.local on this device and is
// never sent to Availo's servers (same privacy boundary as the old single
// vault). It is loaded both in the service worker (via importScripts) and in
// the options/popup pages (via <script>), so it attaches its API to whichever
// global object exists.
//
// Design decisions (see .windsurf/plans/recommended-user-count-*.md):
//   • ONE laptop, ONE home IP, no proxies.
//   • A hard cap of 3 people so a single IP never logs into many accounts.
//   • Each person may keep up to 3 test centres (their current one + the
//     nearest they'd accept a transfer to).
//   • Only ONE person is ever signed in at a time — the extension cycles
//     through them with slow, human pacing and tells you when to switch.
// ============================================================================

const ROSTER_KEY = "availoRoster";
const ACTIVE_KEY = "availoActivePersonId";
const PACING_KEY = "availoPacing";
const LEGACY_VAULT_KEY = "availoVault";

// Hard limits — deliberately not user-configurable.
const MAX_PEOPLE = 3;
const MAX_CENTRES = 3;

// Pacing floors keep behaviour human even if someone edits storage directly.
const PACING_FLOORS = { watchMinutes: 5, cooldownSeconds: 30, breakMinutes: 15 };
const PACING_DEFAULTS = { watchMinutes: 15, cooldownSeconds: 60, breakMinutes: 30 };

function rosterNewId() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

function emptyPerson() {
  return { id: rosterNewId(), name: "", licence: "", bookingRef: "", centres: [], currentTestDate: "", dateFrom: "", dateTo: "" };
}

// Normalise one person record into the canonical shape.
function normalisePerson(p) {
  const centres = Array.isArray(p.centres)
    ? p.centres.map((c) => (c || "").trim()).filter(Boolean).slice(0, MAX_CENTRES)
    : (p.centre ? [String(p.centre).trim()] : []);
  return {
    id: p.id || rosterNewId(),
    name: (p.name || "").trim(),
    licence: (p.licence || "").trim().toUpperCase(),
    bookingRef: (p.bookingRef || "").trim(),
    centres,
    // The person's CURRENT booked test date. We only alert on slots earlier
    // than this. Empty = alert on any slot at their centre(s).
    currentTestDate: p.currentTestDate || "",
    dateFrom: p.dateFrom || "",
    dateTo: p.dateTo || "",
  };
}

async function rosterGet() {
  const r = await chrome.storage.local.get([ROSTER_KEY, LEGACY_VAULT_KEY]);
  let roster = r[ROSTER_KEY];

  // One-time migration from the old single-vault model.
  if (!Array.isArray(roster)) {
    const v = r[LEGACY_VAULT_KEY];
    if (v && (v.licence || v.bookingRef)) {
      roster = [normalisePerson({
        name: "Me",
        licence: v.licence,
        bookingRef: v.bookingRef,
        centres: v.centre ? [v.centre] : [],
        dateFrom: v.dateFrom,
        dateTo: v.dateTo,
      })];
      await chrome.storage.local.set({ [ROSTER_KEY]: roster });
    } else {
      roster = [];
    }
  }
  return roster.map(normalisePerson).slice(0, MAX_PEOPLE);
}

async function rosterSave(roster) {
  const clean = (Array.isArray(roster) ? roster : []).map(normalisePerson).slice(0, MAX_PEOPLE);
  await chrome.storage.local.set({ [ROSTER_KEY]: clean });
  return clean;
}

// A person is "ready" once they have the two fields Fast-Path needs to fill the
// DVSA sign-in form.
function personReady(p) {
  return Boolean(p && (p.licence || "").length >= 5 && (p.bookingRef || "").length >= 3);
}

async function rosterGetActiveId() {
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  return r[ACTIVE_KEY] || null;
}

async function rosterSetActiveId(id) {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

async function rosterGetActivePerson() {
  const [roster, id] = await Promise.all([rosterGet(), rosterGetActiveId()]);
  if (!roster.length) return null;
  return roster.find((p) => p.id === id) || roster[0];
}

async function rosterGetPacing() {
  const r = await chrome.storage.local.get(PACING_KEY);
  const s = r[PACING_KEY] || {};
  return {
    watchMinutes: Math.max(PACING_FLOORS.watchMinutes, Number(s.watchMinutes) || PACING_DEFAULTS.watchMinutes),
    cooldownSeconds: Math.max(PACING_FLOORS.cooldownSeconds, Number(s.cooldownSeconds) || PACING_DEFAULTS.cooldownSeconds),
    breakMinutes: Math.max(PACING_FLOORS.breakMinutes, Number(s.breakMinutes) || PACING_DEFAULTS.breakMinutes),
  };
}

async function rosterSavePacing(p) {
  const clean = {
    watchMinutes: Math.max(PACING_FLOORS.watchMinutes, Number(p.watchMinutes) || PACING_DEFAULTS.watchMinutes),
    cooldownSeconds: Math.max(PACING_FLOORS.cooldownSeconds, Number(p.cooldownSeconds) || PACING_DEFAULTS.cooldownSeconds),
    breakMinutes: Math.max(PACING_FLOORS.breakMinutes, Number(p.breakMinutes) || PACING_DEFAULTS.breakMinutes),
  };
  await chrome.storage.local.set({ [PACING_KEY]: clean });
  return clean;
}

// Convert a roster person into the vault shape that fastpath-content.js expects.
// The primary (first) centre is used for the search form.
function rosterPersonToVault(person) {
  if (!person) return null;
  return {
    licence: person.licence || "",
    bookingRef: person.bookingRef || "",
    centre: (person.centres && person.centres[0]) || "",
    dateFrom: person.dateFrom || "",
    dateTo: person.dateTo || "",
  };
}

// Pure rotation state machine. Given the current rotation, the clock, and the
// pacing, decide the next phase — with NO side effects, so it's unit-testable.
// Phases: watching → cooldown → (next person) watching → … → break → loop.
// `action` tells the caller (background.js) which side effect to run:
//   "none"        — still within the phase, or paused (queue); do nothing
//   "toCooldown"  — this person's turn ended; end their watch + short cooldown
//   "toWatching"  — start the next person (or loop back after a break)
//   "toBreak"     — everyone's had a turn; take a long break before looping
function rosterNextPhase(rotation, now, pacing) {
  const keep = (action) => ({
    phase: rotation.phase, index: rotation.index, phaseUntil: rotation.phaseUntil, action,
  });
  if (!rotation || rotation.paused) return keep("none");
  if (now < rotation.phaseUntil) return keep("none");

  const order = rotation.order || [];
  const min = 60 * 1000;

  if (rotation.phase === "watching") {
    return { phase: "cooldown", index: rotation.index, phaseUntil: now + pacing.cooldownSeconds * 1000, action: "toCooldown" };
  }
  if (rotation.phase === "cooldown") {
    const index = rotation.index + 1;
    if (index >= order.length) {
      return { phase: "break", index: 0, phaseUntil: now + pacing.breakMinutes * min, action: "toBreak" };
    }
    return { phase: "watching", index, phaseUntil: now + pacing.watchMinutes * min, action: "toWatching" };
  }
  if (rotation.phase === "break") {
    return { phase: "watching", index: 0, phaseUntil: now + pacing.watchMinutes * min, action: "toWatching" };
  }
  return keep("none");
}

const AvailoRoster = {
  MAX_PEOPLE,
  MAX_CENTRES,
  PACING_FLOORS,
  PACING_DEFAULTS,
  newId: rosterNewId,
  emptyPerson,
  normalisePerson,
  personReady,
  get: rosterGet,
  save: rosterSave,
  getActiveId: rosterGetActiveId,
  setActiveId: rosterSetActiveId,
  getActivePerson: rosterGetActivePerson,
  getPacing: rosterGetPacing,
  savePacing: rosterSavePacing,
  personToVault: rosterPersonToVault,
  nextPhase: rosterNextPhase,
};

if (typeof self !== "undefined") self.AvailoRoster = AvailoRoster;
if (typeof window !== "undefined") window.AvailoRoster = AvailoRoster;
if (typeof module !== "undefined" && module.exports) module.exports = AvailoRoster;
