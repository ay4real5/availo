const test = require("node:test");
const assert = require("node:assert");
const { AVAILO_SELECTORS, availoDetectPage } = require("../selectors.js");

// Minimal fake document: querySelector returns truthy for whichever markers we say exist.
function fakeDoc(presentSelectors) {
  const set = new Set(presentSelectors);
  return { querySelector: (sel) => (set.has(sel) ? {} : null) };
}

test("detects the results page (and prefers it over others)", () => {
  const doc = fakeDoc([
    AVAILO_SELECTORS.page.results,
    AVAILO_SELECTORS.page.login,
  ]);
  assert.equal(availoDetectPage(doc), "results");
});

test("detects the search page", () => {
  assert.equal(availoDetectPage(fakeDoc([AVAILO_SELECTORS.page.search])), "search");
});

test("detects the login page", () => {
  assert.equal(availoDetectPage(fakeDoc([AVAILO_SELECTORS.page.login])), "login");
});

test("returns null on an unrelated page", () => {
  assert.equal(availoDetectPage(fakeDoc([])), null);
});

test("selector config exposes the fields fast-path fills", () => {
  assert.ok(AVAILO_SELECTORS.login.licenceField);
  assert.ok(AVAILO_SELECTORS.login.bookingRefField);
  assert.ok(AVAILO_SELECTORS.search.centreField);
  assert.ok(AVAILO_SELECTORS.results.slotSelectButton);
});
