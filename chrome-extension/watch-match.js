// Pure, DOM-free matching logic — kept separate from watch-content.js so it can
// be unit tested headlessly (see chrome-extension/test/watch-match.test.js)
// without needing a browser. Loaded as a plain script before watch-content.js
// in manifest.json, so it also runs fine as a page-context global.
function availoMatchesTarget(slot, prefs) {
  if (!slot || !prefs) return false;
  if (!slot.centre || !prefs.centre) return false;
  if (slot.centre.trim().toLowerCase() !== prefs.centre.trim().toLowerCase()) return false;
  if (!prefs.targetDate) return true;
  const slotTime = new Date(slot.datetime).getTime();
  const targetTime = new Date(prefs.targetDate).getTime();
  if (Number.isNaN(slotTime) || Number.isNaN(targetTime)) return false;
  return slotTime < targetTime;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { availoMatchesTarget };
}
