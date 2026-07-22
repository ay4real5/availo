const test = require("node:test");
const assert = require("node:assert");
const {
  parseSlotDateTime, looksLikeBlock, looksLikeQueue, looksLoggedOut, looksLikeServiceClosed, looksLikeNoAvailability, parseReopenTime, labelMatchesKind, buttonMatchesAction,
} = require("../dvsa-heuristics.js");

test("looksLikeNoAvailability: recognises a fully-booked centre's 'no tests' page", () => {
  // Verbatim from the real page.
  assert.equal(looksLikeNoAvailability("We have searched all dates in this test centre. There are no tests that meet your requirements. You can search again at a different test centre."), true);
  assert.equal(looksLikeNoAvailability("There are no tests available"), true);
});

test("looksLikeNoAvailability: a normal calendar/results page is not 'no availability'", () => {
  assert.equal(looksLikeNoAvailability("Available tests at Sunderland — July 2026"), false);
  assert.equal(looksLikeNoAvailability(""), false);
});

test("looksLikeServiceClosed: recognises DVSA's overnight closure page", () => {
  // Verbatim from the real page.
  assert.equal(looksLikeServiceClosed("Sorry, you can't use this service right now. It'll be back at 6 am"), true);
  assert.equal(looksLikeServiceClosed("Service unavailable"), true);
  assert.equal(looksLikeServiceClosed("The service is currently closed"), true);
});

test("looksLikeServiceClosed: a normal results/calendar page is not a closure", () => {
  assert.equal(looksLikeServiceClosed("Available tests at Sunderland — July 2026"), false);
  assert.equal(looksLikeServiceClosed(""), false);
});

test("parseReopenTime: pulls the reopening time out of the closure page", () => {
  assert.equal(parseReopenTime("It'll be back at 6 am"), "6 am");
  assert.equal(parseReopenTime("It'll be back at 6:30am"), "6:30am");
  assert.equal(parseReopenTime("Available tests at Bolton"), null);
});

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

test("looksLikeBlock: recognises the real DVSA Imperva/hCaptcha challenge page", () => {
  // Verbatim (trimmed) body text from an actual challenge encountered on
  // driverpracticaltest.dvsa.gov.uk during live testing.
  const real = `
    driverpracticaltest.dvsa.gov.uk - Additional security check is required
    I am human
    Why am I seeing this page?
    The website you are visiting is protected and accelerated by Imperva. Your
    computer may have been infected by malware and therefore flagged by the
    Imperva network. Imperva displays this page for you to verify that an
    actual human is the source of the traffic to this site, and not
    malicious software.
    What should I do?
    Just click the checkbox above to pass the security check. Imperva will
    remember you and will not show this page again. We recommend you run a
    virus and malware scan on your computer to remove any infection.
    Note: Ad blocker extensions can interfere with the CAPTCHA challenge.
    Powered by Imperva
  `;
  assert.equal(looksLikeBlock(real), true);
});

test("looksLikeBlock: normal results page is not a block", () => {
  assert.equal(looksLikeBlock("Available tests at Bolton — Monday 10 November 2026"), false);
  assert.equal(looksLikeBlock(""), false);
});

test("looksLikeQueue: recognises DVSA / Queue-it waiting-room wording", () => {
  assert.equal(looksLikeQueue("You are now in line"), true);
  assert.equal(looksLikeQueue("You are in a queue"), true);
  assert.equal(looksLikeQueue("Your estimated wait time is 5 minutes"), true);
  assert.equal(looksLikeQueue("Waiting room — please do not refresh"), true);
  assert.equal(looksLikeQueue("Number of users in line ahead of you: 1,204"), true);
});

test("looksLikeQueue: a normal results page or a block is not a queue", () => {
  assert.equal(looksLikeQueue("Available tests at Bolton — Monday 10 November 2026"), false);
  assert.equal(looksLikeQueue("Too many requests — please try later"), false);
  assert.equal(looksLikeQueue(""), false);
  assert.equal(looksLikeQueue(null), false);
});

test("looksLoggedOut: recognises DVSA sign-out / session-expiry wording", () => {
  assert.equal(looksLoggedOut("You have been signed out"), true);
  assert.equal(looksLoggedOut("Your session has expired"), true);
  assert.equal(looksLoggedOut("Your session has timed out. Please sign in again."), true);
  assert.equal(looksLoggedOut("For your security, we've signed you out"), true);
  assert.equal(looksLoggedOut("Sign in to continue"), true);
});

test("looksLoggedOut: a normal results page is not a sign-out", () => {
  assert.equal(looksLoggedOut("Available tests at Bolton — Monday 10 November 2026"), false);
  assert.equal(looksLoggedOut(""), false);
  assert.equal(looksLoggedOut(null), false);
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
