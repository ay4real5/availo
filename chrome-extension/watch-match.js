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

// A slot qualifies when it's at the watched centre AND falls inside the user's
// wanted date window. The window has two optional bounds:
//   • dateFrom — earliest date you'd accept (inclusive). Empty = no lower bound.
//   • dateTo   — latest date you'd accept (inclusive, covers the whole day).
// If dateTo isn't set we fall back to targetDate ("strictly earlier than my
// current test date") so the change-a-booking use case is unchanged. With no
// bounds at all, any date at the centre qualifies (first-time booker).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function availoMatchesTarget(slot, prefs) {
  if (!slot || !prefs) return false;
  if (!slot.centre || !prefs.centre) return false;
  if (availoNormalizeCentre(slot.centre) !== availoNormalizeCentre(prefs.centre)) return false;

  const slotTime = new Date(slot.datetime).getTime();
  if (Number.isNaN(slotTime)) return false;

  if (prefs.dateFrom) {
    const from = new Date(prefs.dateFrom).getTime();
    if (!Number.isNaN(from) && slotTime < from) return false;
  }

  if (prefs.dateTo) {
    // Inclusive of the whole dateTo day: reject only from the NEXT midnight on.
    const to = new Date(prefs.dateTo).getTime();
    if (!Number.isNaN(to) && slotTime >= to + ONE_DAY_MS) return false;
  } else if (prefs.targetDate) {
    const target = new Date(prefs.targetDate).getTime();
    if (Number.isNaN(target)) return false;
    if (slotTime >= target) return false;
  }

  return true;
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
