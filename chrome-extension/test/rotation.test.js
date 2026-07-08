const test = require("node:test");
const assert = require("node:assert");
const AvailoRoster = require("../roster.js");

// Fast, deterministic simulation of the roster rotation state machine — the whole
// watching → cooldown → next-person → break → loop cycle, driven by a fake clock,
// with no real 5–15-minute waits and no browser.

const pacing = { watchMinutes: 15, cooldownSeconds: 60, breakMinutes: 30 };
const MIN = 60 * 1000;

function rotation(over) {
  return { tabId: 1, order: ["p1", "p2", "p3"], index: 0, phase: "watching", phaseUntil: 1000, paused: false, ...over };
}

test("stays put while still within the current phase", () => {
  const d = AvailoRoster.nextPhase(rotation({ phaseUntil: 10000 }), 5000, pacing);
  assert.equal(d.action, "none");
});

test("paused rotation (e.g. in a DVSA queue) never advances", () => {
  const d = AvailoRoster.nextPhase(rotation({ paused: true, phaseUntil: 0 }), 999999, pacing);
  assert.equal(d.action, "none");
});

test("watching → cooldown when the person's turn ends", () => {
  const now = 20000;
  const d = AvailoRoster.nextPhase(rotation({ phase: "watching", index: 0, phaseUntil: now }), now, pacing);
  assert.equal(d.action, "toCooldown");
  assert.equal(d.phase, "cooldown");
  assert.equal(d.index, 0); // same person, just ended
  assert.equal(d.phaseUntil, now + pacing.cooldownSeconds * 1000);
});

test("cooldown → next person (index advances, back to watching)", () => {
  const now = 30000;
  const d = AvailoRoster.nextPhase(rotation({ phase: "cooldown", index: 0, phaseUntil: now }), now, pacing);
  assert.equal(d.action, "toWatching");
  assert.equal(d.phase, "watching");
  assert.equal(d.index, 1);
  assert.equal(d.phaseUntil, now + pacing.watchMinutes * MIN);
});

test("after the last person, cooldown → break (index resets)", () => {
  const now = 40000;
  const d = AvailoRoster.nextPhase(rotation({ phase: "cooldown", index: 2, phaseUntil: now }), now, pacing);
  assert.equal(d.action, "toBreak");
  assert.equal(d.phase, "break");
  assert.equal(d.index, 0);
  assert.equal(d.phaseUntil, now + pacing.breakMinutes * MIN);
});

test("break → loop back to the first person", () => {
  const now = 50000;
  const d = AvailoRoster.nextPhase(rotation({ phase: "break", index: 0, phaseUntil: now }), now, pacing);
  assert.equal(d.action, "toWatching");
  assert.equal(d.phase, "watching");
  assert.equal(d.index, 0);
});

test("full cycle simulation: 3 people, watch→cooldown each, then break, then loop", () => {
  // Drive the machine with a fake clock and record the person/phase sequence.
  let state = rotation({ phase: "watching", index: 0, phaseUntil: 0 });
  let clock = 0;
  const seen = [];
  for (let step = 0; step < 9; step++) {
    clock = state.phaseUntil; // jump the clock to when the phase ends
    const d = AvailoRoster.nextPhase(state, clock, pacing);
    seen.push(`${d.phase}${d.phase === "break" ? "" : d.index}`);
    state = { ...state, phase: d.phase, index: d.index, phaseUntil: d.phaseUntil };
  }
  // watch0 → cooldown0 → watch1 → cooldown1 → watch2 → cooldown2 → break → watch0 (loop) → cooldown0
  assert.deepEqual(seen, [
    "cooldown0", "watching1", "cooldown1", "watching2", "cooldown2", "break", "watching0", "cooldown0", "watching1",
  ]);
});

test("single-person roster: watch → cooldown → break → loop (no one else)", () => {
  const solo = { tabId: 1, order: ["p1"], index: 0, phase: "cooldown", phaseUntil: 0, paused: false };
  const d = AvailoRoster.nextPhase(solo, 100, pacing);
  // index+1 = 1 >= order.length(1) → break
  assert.equal(d.action, "toBreak");
  assert.equal(d.phase, "break");
});
