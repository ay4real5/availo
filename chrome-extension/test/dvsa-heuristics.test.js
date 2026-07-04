const test = require("node:test");
const assert = require("node:assert");
const {
  parseSlotDateTime, looksLikeBlock, labelMatchesKind, buttonMatchesAction,
} = require("../dvsa-heuristics.js");

test("parseSlotDateTime: full GOV.UK wording with am time", () => {
  assert.equal(parseSlotDateTime("Monday 10 November 2026 9:15am"), "2026-11-10T09:15:00.000Z");
});

test("parseSlotDateTime: abbreviated month, 24h time with comma", () => {
  assert.equal(parseSlotDateTime("10 Nov 2026, 09:15"), "2026-11-10T09:15:00.000Z");
});

test("parseSlotDateTime: pm converts to 24h", () => {
  assert.equal(parseSlotDateTime("10 November 2026 at 2:00pm"), "2026-11-10T14:00:00.000Z");
});

test("parseSlotDateTime: 12am/12pm edge cases", () => {
  assert.equal(parseSlotDateTime("1 June 2026 12:00am"), "2026-06-01T00:00:00.000Z");
  assert.equal(parseSlotDateTime("1 June 2026 12:00pm"), "2026-06-01T12:00:00.000Z");
});

test("parseSlotDateTime: ISO-ish date", () => {
  assert.equal(parseSlotDateTime("2026-11-10 09:15"), "2026-11-10T09:15:00.000Z");
});

test("parseSlotDateTime: date without a time defaults to midnight UTC", () => {
  assert.equal(parseSlotDateTime("10 November 2026"), "2026-11-10T00:00:00.000Z");
});

test("parseSlotDateTime: rejects text with no date", () => {
  assert.equal(parseSlotDateTime("Book this test"), null);
  assert.equal(parseSlotDateTime(""), null);
  assert.equal(parseSlotDateTime(null), null);
});

test("looksLikeBlock: recognises common block/challenge wording", () => {
  assert.equal(looksLikeBlock("Sorry, there is a problem with the service"), true);
  assert.equal(looksLikeBlock("Too many requests — please try later"), true);
  assert.equal(looksLikeBlock("Please verify you are human"), true);
  assert.equal(looksLikeBlock("We've detected unusual activity"), true);
  assert.equal(looksLikeBlock("Complete the CAPTCHA to continue"), true);
});

test("looksLikeBlock: normal results page is not a block", () => {
  assert.equal(looksLikeBlock("Available tests at Bolton — Monday 10 November 2026"), false);
  assert.equal(looksLikeBlock(""), false);
});

test("labelMatchesKind: licence and booking-ref by label text", () => {
  assert.equal(labelMatchesKind("Driving licence number", "licence"), true);
  assert.equal(labelMatchesKind("Booking reference", "bookingRef"), true);
  assert.equal(labelMatchesKind("Your application reference", "bookingRef"), true);
  assert.equal(labelMatchesKind("Driving licence number", "bookingRef"), false);
});

test("labelMatchesKind: centre and dates", () => {
  assert.equal(labelMatchesKind("Test centre", "centre"), true);
  assert.equal(labelMatchesKind("Or enter a postcode", "centre"), true);
  assert.equal(labelMatchesKind("From", "dateFrom"), true);
  assert.equal(labelMatchesKind("Latest date", "dateTo"), true);
});

test("buttonMatchesAction: select control wording", () => {
  assert.equal(buttonMatchesAction("Book this test", "select"), true);
  assert.equal(buttonMatchesAction("Select", "select"), true);
  assert.equal(buttonMatchesAction("Change to this appointment", "select"), true);
  assert.equal(buttonMatchesAction("Sign in", "select"), false);
});

test("buttonMatchesAction: login and search wording", () => {
  assert.equal(buttonMatchesAction("Sign in", "login"), true);
  assert.equal(buttonMatchesAction("Search for tests", "search"), true);
  assert.equal(buttonMatchesAction("Find a test", "search"), true);
});
