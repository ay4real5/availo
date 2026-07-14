// ============================================================================
// vault.js — single-user storage for licence/booking-ref/search details.
//
// Everything here lives ONLY in chrome.storage.local on this device and is
// never sent to Availo's servers. It is loaded both in the service worker
// (via importScripts) and in the options/popup pages (via <script>), so it
// attaches its API to whichever global object exists.
// ============================================================================

const VAULT_KEY = "availoVault";
const LEGACY_ROSTER_KEY = "availoRoster";
const LEGACY_ACTIVE_KEY = "availoActivePersonId";

function emptyVault() {
  return { name: "", licence: "", bookingRef: "", centre: "", dateFrom: "", dateTo: "" };
}

// Normalise a vault record into the canonical shape.
function normaliseVault(v) {
  return {
    name: (v?.name || "").trim(),
    licence: (v?.licence || "").trim().toUpperCase(),
    bookingRef: (v?.bookingRef || "").trim(),
    centre: (v?.centre || "").trim(),
    dateFrom: v?.dateFrom || "",
    dateTo: v?.dateTo || "",
  };
}

async function vaultGet() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  if (r[VAULT_KEY]) return normaliseVault(r[VAULT_KEY]);

  // One-time migration from the old multi-person roster, if present: take the
  // active person (or the first one) so nobody loses details they'd already
  // saved during earlier roster-mode testing.
  const legacy = await chrome.storage.local.get([LEGACY_ROSTER_KEY, LEGACY_ACTIVE_KEY]);
  const roster = Array.isArray(legacy[LEGACY_ROSTER_KEY]) ? legacy[LEGACY_ROSTER_KEY] : [];
  if (roster.length) {
    const activeId = legacy[LEGACY_ACTIVE_KEY];
    const person = roster.find((p) => p.id === activeId) || roster[0];
    const migrated = normaliseVault({
      name: person.name,
      licence: person.licence,
      bookingRef: person.bookingRef,
      centre: (person.centres && person.centres[0]) || "",
      dateFrom: person.dateFrom,
      dateTo: person.dateTo,
    });
    await chrome.storage.local.set({ [VAULT_KEY]: migrated });
    return migrated;
  }

  return emptyVault();
}

async function vaultSave(v) {
  const clean = normaliseVault(v);
  await chrome.storage.local.set({ [VAULT_KEY]: clean });
  return clean;
}

// Ready once the two fields Fast-Path needs to fill the DVSA sign-in form are set.
function vaultReady(v) {
  return Boolean(v && (v.licence || "").length >= 5 && (v.bookingRef || "").length >= 3);
}

const AvailoVault = {
  emptyVault,
  normalise: normaliseVault,
  get: vaultGet,
  save: vaultSave,
  ready: vaultReady,
};

if (typeof self !== "undefined") self.AvailoVault = AvailoVault;
if (typeof window !== "undefined") window.AvailoVault = AvailoVault;
if (typeof module !== "undefined" && module.exports) module.exports = AvailoVault;
