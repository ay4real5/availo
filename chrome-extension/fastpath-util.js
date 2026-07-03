// Pure, DOM-free helpers for Fast-Path — kept separate from fastpath-content.js
// so they can be unit-tested headlessly (chrome-extension/test/). Loaded as a
// plain script (global) before fastpath-content.js, and also require()-able.

// Is the local vault complete enough to autofill the DVSA login? Licence number
// and booking reference are the two the login form needs.
function availoVaultComplete(vault) {
  if (!vault) return false;
  return Boolean(
    typeof vault.licence === "string" && vault.licence.trim().length >= 5 &&
    typeof vault.bookingRef === "string" && vault.bookingRef.trim().length >= 3,
  );
}

// Of a list of {centre, datetime} slots, return ALL that match the user's target
// (reuses availoMatchesTarget), sorted earliest-first — the natural "best" order
// for cancellation-hunting. Empty array if none qualify. This is what lets the
// caller offer a "next-best" the instant the top one vanishes.
function availoRankMatches(slots, prefs) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  return slots
    .filter((s) => availoMatchesTarget(s, prefs))
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
}

// The single earliest qualifying slot, or null. Thin wrapper over the ranking so
// existing callers are unchanged.
function availoEarliestMatch(slots, prefs) {
  return availoRankMatches(slots, prefs)[0] ?? null;
}

if (typeof module !== "undefined" && module.exports) {
  // In Node tests, availoMatchesTarget comes from watch-match.js.
  if (typeof availoMatchesTarget === "undefined") {
    global.availoMatchesTarget = require("./watch-match.js").availoMatchesTarget;
  }
  module.exports = { availoVaultComplete, availoEarliestMatch, availoRankMatches };
}
