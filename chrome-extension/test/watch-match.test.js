const test = require("node:test");
const assert = require("node:assert");
const { availoMatchesTarget } = require("../watch-match.js");

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
