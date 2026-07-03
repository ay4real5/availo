// ============================================================================
// AVAILO_SELECTORS — the ONE place all DVSA-DOM knowledge lives.
//
// TODO(spike): every value here is an UNVERIFIED placeholder, written to match
// the local dev fixture (chrome-extension/dev-fixture/*.html) only. Before this
// ships against the real DVSA "change your driving test" flow, someone must log
// in, inspect the real login / search / results markup in DevTools, and update
// this single object. Nothing else in the extension needs to change — every
// other file reads its selectors from here.
//
// NON-GOAL (applies to every consumer of this file): the extension only fills
// the user's own details and submits read-only searches, and only ever clicks
// something on the user's explicit action. It never clicks Select / Confirm /
// Pay on the real DVSA site — those stay the human's. See docs/ARCHITECTURE.md
// §9 for why server-side DVSA automation is deliberately not done at all.
// ============================================================================

const AVAILO_SELECTORS = {
  // --- page detection: a marker unique to each step of the journey ---------
  page: {
    login: '[data-testid="availo-page-login"]',
    search: '[data-testid="availo-page-search"]',
    results: '[data-testid="availo-page-results"]',
  },

  // --- login page: the user's own credentials (password-manager class) ------
  login: {
    licenceField: '[data-testid="availo-field-licence"]',
    bookingRefField: '[data-testid="availo-field-booking-ref"]',
    submitButton: '[data-testid="availo-login-submit"]',
  },

  // --- search page: a read-only query for available slots -------------------
  search: {
    centreField: '[data-testid="availo-field-centre"]',
    dateFromField: '[data-testid="availo-field-date-from"]',
    dateToField: '[data-testid="availo-field-date-to"]',
    submitButton: '[data-testid="availo-search-submit"]',
  },

  // --- results page: where detection + the final human click happen ---------
  results: {
    slotRow: '[data-testid="availo-slot-row"]',
    slotDatetimeAttr: "data-slot-datetime",
    slotCentreAttr: "data-slot-centre",
    // The slot's own Select/Book control. The extension only ever highlights &
    // scrolls to this — the human clicks it themselves.
    slotSelectButton: '[data-testid="availo-slot-select"]',
    blockedMarker: '[data-testid="availo-blocked"]',
  },
};

// Which step of the journey is this page? Returns "login" | "search" |
// "results" | null. Pure aside from the document lookup.
function availoDetectPage(doc = document) {
  if (doc.querySelector(AVAILO_SELECTORS.page.results)) return "results";
  if (doc.querySelector(AVAILO_SELECTORS.page.search)) return "search";
  if (doc.querySelector(AVAILO_SELECTORS.page.login)) return "login";
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AVAILO_SELECTORS, availoDetectPage };
}
