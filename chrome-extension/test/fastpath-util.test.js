const test = require("node:test");
const assert = require("node:assert");
const { availoVaultComplete, availoEarliestMatch, availoRankMatches } = require("../fastpath-util.js");

test("vault is complete with licence + booking ref", () => {
  assert.equal(availoVaultComplete({ licence: "SMITH902", bookingRef: "12345678" }), true);
});

test("vault is incomplete without a booking ref", () => {
  assert.equal(availoVaultComplete({ licence: "SMITH902", bookingRef: "" }), false);
});

test("vault is incomplete with a too-short licence", () => {
  assert.equal(availoVaultComplete({ licence: "AB", bookingRef: "12345678" }), false);
});

test("vault handles null / missing", () => {
  assert.equal(availoVaultComplete(null), false);
  assert.equal(availoVaultComplete({}), false);
});

const prefs = { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" };

test("earliest match picks the soonest qualifying slot", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-20T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-05T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-12T10:00:00.000Z" },
  ];
  const m = availoEarliestMatch(slots, prefs);
  assert.equal(m.datetime, "2026-11-05T10:00:00.000Z");
});

test("earliest match ignores the wrong centre and later-than-target slots", () => {
  const slots = [
    { centre: "Manchester", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2027-01-01T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-25T10:00:00.000Z" },
  ];
  const m = availoEarliestMatch(slots, prefs);
  assert.equal(m.centre, "Bolton");
  assert.equal(m.datetime, "2026-11-25T10:00:00.000Z");
});

test("earliest match returns null when nothing qualifies", () => {
  assert.equal(availoEarliestMatch([{ centre: "Leeds", datetime: "2026-11-01T10:00:00.000Z" }], prefs), null);
  assert.equal(availoEarliestMatch([], prefs), null);
});

test("rankMatches returns all qualifying slots, earliest first", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-20T10:00:00.000Z" },
    { centre: "Manchester", datetime: "2026-11-03T10:00:00.000Z" }, // wrong centre
    { centre: "Bolton", datetime: "2026-11-05T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2027-01-01T10:00:00.000Z" }, // later than target
    { centre: "Bolton", datetime: "2026-11-12T10:00:00.000Z" },
  ];
  const ranked = availoRankMatches(slots, prefs);
  assert.deepEqual(
    ranked.map((s) => s.datetime),
    ["2026-11-05T10:00:00.000Z", "2026-11-12T10:00:00.000Z", "2026-11-20T10:00:00.000Z"],
  );
});

test("next-best is simply the element after the top one", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-12T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-05T10:00:00.000Z" },
  ];
  const ranked = availoRankMatches(slots, prefs);
  assert.equal(ranked[0].datetime, "2026-11-05T10:00:00.000Z"); // best
  assert.equal(ranked[1].datetime, "2026-11-12T10:00:00.000Z"); // next-best
});

test("rankMatches returns [] when nothing qualifies", () => {
  assert.deepEqual(availoRankMatches([{ centre: "Leeds", datetime: "2026-11-01T10:00:00.000Z" }], prefs), []);
  assert.deepEqual(availoRankMatches([], prefs), []);
});

test("earliestMatch stays consistent with rankMatches[0]", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-18T10:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-09T10:00:00.000Z" },
  ];
  assert.deepEqual(availoEarliestMatch(slots, prefs), availoRankMatches(slots, prefs)[0]);
});
