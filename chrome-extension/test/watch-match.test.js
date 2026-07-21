const test = require("node:test");
const assert = require("node:assert");
const { availoMatchesTarget, availoPickSoonestUnalerted, availoNormalizeCentre } = require("../watch-match.js");

test("matches when centre and date both qualify", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("centre match is case/whitespace insensitive", () => {
  const ok = availoMatchesTarget(
    { centre: " bolton ", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("centre match tolerates a trailing parenthetical qualifier", () => {
  // Live DVSA header says "Chorley (Euxton)"; the user saved "Chorley".
  const ok = availoMatchesTarget(
    { centre: "Chorley (Euxton)", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Chorley", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("centre match tolerates punctuation and double spaces", () => {
  const ok = availoMatchesTarget(
    { centre: "Wood Green  (London)", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Wood Green", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("normalizeCentre keeps genuinely different centres distinct", () => {
  assert.notEqual(availoNormalizeCentre("Bolton"), availoNormalizeCentre("Bury"));
  assert.equal(availoNormalizeCentre("  Chorley (Euxton) "), "chorley");
  assert.equal(availoNormalizeCentre("Wood Green, London"), "wood green london");
});

test("rejects a different centre", () => {
  const ok = availoMatchesTarget(
    { centre: "Manchester", datetime: "2026-11-01T10:00:00.000Z" },
    { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, false);
});

test("rejects a slot that is not earlier than the target date", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2027-01-01T10:00:00.000Z" },
    { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, false);
});

test("matches any date for the right centre when no target date is set", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2030-01-01T10:00:00.000Z" },
    { centre: "Bolton", targetDate: null },
  );
  assert.equal(ok, true);
});

test("window: matches a slot inside [dateFrom, dateTo]", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-08-20T09:00:00.000Z" },
    { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("window: rejects a slot before dateFrom", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-07-31T09:00:00.000Z" },
    { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z" },
  );
  assert.equal(ok, false);
});

test("window: rejects a slot after dateTo", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-10-01T09:00:00.000Z" },
    { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z" },
  );
  assert.equal(ok, false);
});

test("window: dateTo is inclusive of the whole final day (a midnight-UTC calendar date)", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-09-30T00:00:00.000Z" },
    { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("window: dateFrom alone (no upper bound) accepts anything on/after it", () => {
  assert.equal(
    availoMatchesTarget({ centre: "Bolton", datetime: "2030-01-01T00:00:00.000Z" }, { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z" }),
    true,
  );
  assert.equal(
    availoMatchesTarget({ centre: "Bolton", datetime: "2026-07-01T00:00:00.000Z" }, { centre: "Bolton", dateFrom: "2026-08-01T00:00:00.000Z" }),
    false,
  );
});

test("window: dateTo takes precedence over targetDate when both present", () => {
  // dateTo (inclusive Sep 30) should allow a Sep 15 slot even though targetDate
  // (Aug 15, strict-earlier) would have rejected it.
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "2026-09-15T00:00:00.000Z" },
    { centre: "Bolton", targetDate: "2026-08-15T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z" },
  );
  assert.equal(ok, true);
});

test("rejects malformed dates", () => {
  const ok = availoMatchesTarget(
    { centre: "Bolton", datetime: "not-a-date" },
    { centre: "Bolton", targetDate: "2026-12-01T09:00:00.000Z" },
  );
  assert.equal(ok, false);
});

test("rejects missing slot or prefs", () => {
  assert.equal(availoMatchesTarget(null, { centre: "Bolton" }), false);
  assert.equal(availoMatchesTarget({ centre: "Bolton", datetime: "2026-01-01T00:00:00.000Z" }, null), false);
});

test("pickSoonestUnalerted: returns the earliest slot when nothing has been alerted", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-10T09:15:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-24T13:00:00.000Z" },
  ];
  const next = availoPickSoonestUnalerted(slots, new Set());
  assert.deepStrictEqual(next, slots[0]);
});

test("pickSoonestUnalerted: returns the next slot when the earliest has already been alerted", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-10T09:15:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-24T13:00:00.000Z" },
  ];
  const next = availoPickSoonestUnalerted(slots, new Set(["Bolton|2026-11-10T09:15:00.000Z"]));
  assert.deepStrictEqual(next, slots[1]);
});

test("pickSoonestUnalerted: returns null when every slot has already been alerted", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-10T09:15:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-24T13:00:00.000Z" },
  ];
  const alerted = new Set(["Bolton|2026-11-10T09:15:00.000Z", "Bolton|2026-11-24T13:00:00.000Z"]);
  const next = availoPickSoonestUnalerted(slots, alerted);
  assert.equal(next, null);
});

test("pickSoonestUnalerted: re-alerts when an even-earlier slot appears that wasn't alerted", () => {
  const slots = [
    { centre: "Bolton", datetime: "2026-11-08T08:00:00.000Z" },
    { centre: "Bolton", datetime: "2026-11-10T09:15:00.000Z" },
  ];
  const alerted = new Set(["Bolton|2026-11-10T09:15:00.000Z"]);
  const next = availoPickSoonestUnalerted(slots, alerted);
  assert.deepStrictEqual(next, slots[0]);
});
