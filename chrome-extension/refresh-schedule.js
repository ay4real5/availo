// Pure, testable jitter helper for the gentle auto-refresh cadence. Kept slow
// and jittered on purpose — fast/fixed refreshing is what trips DVSA's rate
// limits and flags accounts. Loaded into the service worker via importScripts,
// and require()-able for unit tests.

// Returns a delay in ms: baseMs ± up to jitterMs, floored at a safe minimum so
// it can never accidentally become aggressive.
function nextRefreshDelay(baseMs, jitterMs, rnd = Math.random) {
  const base = Number(baseMs) || 90000;
  const jitter = Math.max(0, Number(jitterMs) || 0);
  const delta = (rnd() * 2 - 1) * jitter; // [-jitter, +jitter]
  const MIN = 45000; // never faster than ~45s, whatever the inputs
  return Math.max(MIN, Math.round(base + delta));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { nextRefreshDelay };
}
