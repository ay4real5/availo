// Pure, DOM-free matching logic — kept separate from watch-content.js so it can
// be unit tested headlessly (see chrome-extension/test/watch-match.test.js)
// without needing a browser. Loaded as a plain script before watch-content.js
// in manifest.json, so it also runs fine as a page-context global.

// Canonicalise a test-centre name so a slightly different spelling on the live
// DVSA page (from `#chosen-test-centre h1`) still matches the centre the user
// saved from the autocomplete. Lowercase, collapse inner whitespace, drop a
// trailing parenthetical qualifier (e.g. "Chorley (Euxton)" -> "chorley"), and
// strip stray punctuation. Deliberately conservative: it only removes noise, so
// two genuinely different centres never collapse to the same string.
function availoNormalizeCentre(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")   // drop "(Euxton)"-style qualifiers
    .replace(/[.,]/g, " ")       // stray punctuation -> space
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim();
}

function availoMatchesTarget(slot, prefs) {
  if (!slot || !prefs) return false;
  if (!slot.centre || !prefs.centre) return false;
  if (availoNormalizeCentre(slot.centre) !== availoNormalizeCentre(prefs.centre)) return false;
  if (!prefs.targetDate) return true;
  const slotTime = new Date(slot.datetime).getTime();
  const targetTime = new Date(prefs.targetDate).getTime();
  if (Number.isNaN(slotTime) || Number.isNaN(targetTime)) return false;
  return slotTime < targetTime;
}

// Alert-once logic extracted from watch-content.js so we can test it.
// Given ranked slots (earliest first) and a Set of already-alerted keys
// ("centre|datetime"), returns the soonest slot we should alert on, or null.
// We re-alert when the soonest slot changes — either it got taken and the next
// one is now first, or a new even-earlier slot appeared — but never repeatedly
// for the same key.
function availoPickSoonestUnalerted(rankedSlots, alertedKeys) {
  if (!Array.isArray(rankedSlots) || rankedSlots.length === 0) return null;
  const set = alertedKeys instanceof Set ? alertedKeys : new Set(alertedKeys);
  return rankedSlots.find((s) => !set.has(`${s.centre}|${s.datetime}`)) || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { availoMatchesTarget, availoPickSoonestUnalerted, availoNormalizeCentre };
}
