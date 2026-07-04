const test = require("node:test");
const assert = require("node:assert");
const { nextRefreshDelay } = require("../refresh-schedule.js");

test("stays within base ± jitter for a mid random value", () => {
  assert.equal(nextRefreshDelay(90000, 30000, () => 0.5), 90000); // rnd 0.5 -> delta 0
});

test("applies full negative jitter at rnd=0 but respects the floor", () => {
  // 90000 - 30000 = 60000, above the 45000 floor
  assert.equal(nextRefreshDelay(90000, 30000, () => 0), 60000);
});

test("applies full positive jitter at rnd=1", () => {
  assert.equal(nextRefreshDelay(90000, 30000, () => 1), 120000);
});

test("never returns faster than the 45s floor, even with silly inputs", () => {
  assert.ok(nextRefreshDelay(1000, 5000, () => 0) >= 45000);
  assert.ok(nextRefreshDelay(0, 0, () => 0) >= 45000);
});

test("defaults sensibly when given junk", () => {
  const d = nextRefreshDelay(undefined, undefined, () => 0.5);
  assert.ok(d >= 45000);
});
