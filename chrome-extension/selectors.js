// ============================================================================
// AvailoResolve — finds the DVSA login / search / results elements on the page.
//
// For each target it tries strategies in priority order:
//   1. An explicit data-testid  (our fixtures use these; also a future manual
//      override hook if a specific page ever needs pinning down).
//   2. GOV.UK Design System structure + text heuristics (dvsa-heuristics.js) —
//      this is what matches the REAL DVSA pages with no per-user configuration.
// If nothing matches confidently it returns null/[] and callers do nothing —
// it never guesses hard enough to misfire.
//
// NON-GOAL (every consumer): the extension fills the user's own details and
// submits read-only searches, and only ever HIGHLIGHTS the slot's Select
// control — it never clicks Select/Confirm/Pay, never bypasses a block. See
// docs/ARCHITECTURE.md §9.
//
// dvsa-heuristics.js is loaded before this file (manifest.json).
// ============================================================================

const AvailoResolve = (() => {
  const H = typeof module !== "undefined" && module.exports
    ? require("./dvsa-heuristics.js")
    : {
        parseSlotDateTime: (t) => (typeof parseSlotDateTime === "function" ? parseSlotDateTime(t) : null),
        looksLikeBlock: (t) => (typeof looksLikeBlock === "function" ? looksLikeBlock(t) : false),
        looksLikeQueue: (t) => (typeof looksLikeQueue === "function" ? looksLikeQueue(t) : false),
        looksLoggedOut: (t) => (typeof looksLoggedOut === "function" ? looksLoggedOut(t) : false),
        looksLikeServiceClosed: (t) => (typeof looksLikeServiceClosed === "function" ? looksLikeServiceClosed(t) : false),
        parseReopenTime: (t) => (typeof parseReopenTime === "function" ? parseReopenTime(t) : null),
        labelMatchesKind: (t, k) => (typeof labelMatchesKind === "function" ? labelMatchesKind(t, k) : false),
        buttonMatchesAction: (t, a) => (typeof buttonMatchesAction === "function" ? buttonMatchesAction(t, a) : false),
      };

  // --- small DOM helpers ----------------------------------------------------
  function testid(doc, id) {
    return doc.querySelector(`[data-testid="${id}"]`);
  }

  // The human-readable label for an input: its <label for>, aria-label,
  // placeholder, or preceding label text.
  function labelTextFor(input, doc) {
    const bits = [];
    if (input.id) {
      const lbl = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) bits.push(lbl.textContent);
    }
    if (input.getAttribute("aria-label")) bits.push(input.getAttribute("aria-label"));
    if (input.getAttribute("placeholder")) bits.push(input.getAttribute("placeholder"));
    if (input.name) bits.push(input.name);
    if (input.id) bits.push(input.id);
    // a label wrapping the input
    const wrapLabel = input.closest("label");
    if (wrapLabel) bits.push(wrapLabel.textContent);
    return bits.join(" ").trim();
  }

  function findInputByKind(doc, kind, types) {
    const inputs = [...doc.querySelectorAll("input, select")].filter((el) => {
      if (el.type === "hidden") return false;
      if (types && el.tagName === "INPUT" && !types.includes(el.type || "text")) return false;
      return true;
    });
    return inputs.find((el) => H.labelMatchesKind(labelTextFor(el, doc), kind)) || null;
  }

  function findButtonByAction(doc, action) {
    const buttons = [...doc.querySelectorAll("button, input[type=submit], a[role=button], .govuk-button")];
    return buttons.find((el) => {
      const text = (el.value || el.textContent || "").trim();
      return H.buttonMatchesAction(text, action);
    }) || null;
  }

  function bodyText(doc) {
    return (doc.body && doc.body.innerText) || (doc.body && doc.body.textContent) || "";
  }

  // --- public API -----------------------------------------------------------

  function blocked(doc = document) {
    if (testid(doc, "availo-blocked")) return true;
    return H.looksLikeBlock(bodyText(doc));
  }

  // A queue/waiting room. Distinct from blocked(): the caller should WAIT
  // (keep the tab as-is, never refresh — refreshing loses your place in line),
  // not stop watching.
  function queued(doc = document) {
    if (testid(doc, "availo-queue")) return true;
    return H.looksLikeQueue(bodyText(doc));
  }

  // DVSA's scheduled overnight closure ("back at 6 am"). Distinct from blocked():
  // pause + gently re-check until it reopens, don't stand down for good.
  function serviceClosed(doc = document) {
    if (testid(doc, "availo-service-closed")) return true;
    return H.looksLikeServiceClosed(bodyText(doc));
  }

  // The stated reopening time from the closure page, e.g. "6 am", or null.
  function reopenTime(doc = document) {
    return H.parseReopenTime(bodyText(doc));
  }

  // Has DVSA signed the user out? True on the sign-in page or a session-expired
  // page. Used to alert the user instead of silently watching a login page.
  function loggedOut(doc = document) {
    if (testid(doc, "availo-logged-out")) return true;
    if (H.looksLoggedOut(bodyText(doc))) return true;
    return page(doc) === "login";
  }

  // Rows on the results page: each has a parseable date/time and its own
  // Select/Book control. Centre is page-level (the searched centre), not per-row.
  function resultRows(doc = document) {
    // testid fixtures first
    const tagged = [...doc.querySelectorAll('[data-testid="availo-slot-row"]')];
    const candidateRows = tagged.length
      ? tagged
      : [...doc.querySelectorAll("tr, li, .govuk-table__row, [class*='slot'], [class*='appointment']")];

    const rows = [];
    for (const el of candidateRows) {
      const selectEl =
        testid(el, "availo-slot-select") ||
        [...el.querySelectorAll("button, a, input[type=submit], .govuk-button")]
          .find((b) => H.buttonMatchesAction((b.value || b.textContent || "").trim(), "select"));
      if (!selectEl) continue;

      // Prefer an explicit datetime attribute (fixtures), else parse the row text.
      const attr = el.getAttribute && el.getAttribute("data-slot-datetime");
      const datetime = attr ? new Date(attr).toISOString() : H.parseSlotDateTime(el.textContent || "");
      if (!datetime) continue;

      const centre = (el.getAttribute && el.getAttribute("data-slot-centre")) || null;
      rows.push({ el, datetime, centre, selectEl });
    }

    rows.push(...calendarAvailableDates(doc));
    return rows;
  }

  // The REAL DVSA "change your driving test" / "book your driving test" pages
  // (driverpracticaltest.dvsa.gov.uk) render a month calendar, not a row list —
  // structurally different from the fixture's table. Each bookable day is a
  // <td class="BookingCalendar-date--bookable"> (optionally also "is-active"
  // when it's the selected day) containing
  // <a class="BookingCalendar-dateLink" data-date="2026-08-01">. Confirmed
  // directly against the real site's markup via DevTools for both the
  // unavailable AND bookable variants — note the class says "bookable", not
  // "available", even though the page's own legend label reads "Available".
  // No per-day time is exposed here — that only appears in a separate "Choose
  // a time" panel after a date is picked — so these rows carry midnight UTC
  // for the date only; still enough to tell whether a day is earlier than the
  // target date.
  function calendarAvailableDates(doc = document) {
    const cells = [...doc.querySelectorAll(".BookingCalendar-date--bookable")];
    const centre = pageCentre(doc);
    const rows = [];
    for (const cell of cells) {
      const link = cell.querySelector("a[data-date]") || (cell.matches && cell.matches("a[data-date]") ? cell : null);
      if (!link) continue;
      const dateStr = link.getAttribute("data-date");
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      const d = new Date(`${dateStr}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) continue;
      // Attribute the date to the centre the REAL calendar page is actually for
      // (read from the page header), not to whatever the user happens to have
      // saved. Otherwise watching the Ayr page with "Chorley" saved would report
      // Ayr dates as Chorley matches. If we can't read a centre, fall back to
      // null and let the caller's prefs-centre fallback apply (keeps the fixture
      // and any non-header layout working as before).
      rows.push({ el: cell, datetime: d.toISOString(), centre: centre || null, selectEl: link });
    }
    return rows;
  }

  // The centre a real DVSA booking page is for, read from its header
  // (<div id="chosen-test-centre"><h1>Ayr</h1><a>Change</a></div>). Confirmed
  // against the live site's markup. Returns null if not present (e.g. the
  // practice fixture / any page without this header).
  function pageCentre(doc = document) {
    const h = doc.querySelector("#chosen-test-centre h1");
    if (!h) return null;
    // The h1 carries a screen-reader-only step label before the visible centre
    // name — confirmed on the live "Book" flow:
    //   <h1><span class="visuallyhidden">Test date / time</span>Sunderland</h1>
    // Reading textContent directly gives "Test date / timeSunderland", so strip
    // hidden helper spans and read just the visible text.
    const clone = h.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll(".visuallyhidden, .govuk-visually-hidden, .visually-hidden, [hidden]").forEach((el) => el.remove());
    }
    const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
    return text || null;
  }

  function page(doc = document) {
    if (testid(doc, "availo-page-results") || resultRows(doc).length) return "results";
    if (testid(doc, "availo-page-search") || (findInputByKind(doc, "centre") && findButtonByAction(doc, "search"))) return "search";
    if (
      testid(doc, "availo-page-login") ||
      (findInputByKind(doc, "licence") || findInputByKind(doc, "bookingRef"))
    ) return "login";
    return null;
  }

  function loginFields(doc = document) {
    return {
      licence: testid(doc, "availo-field-licence") || findInputByKind(doc, "licence"),
      bookingRef: testid(doc, "availo-field-booking-ref") || findInputByKind(doc, "bookingRef"),
      submit: testid(doc, "availo-login-submit") || findButtonByAction(doc, "login"),
    };
  }

  function searchFields(doc = document) {
    return {
      centre: testid(doc, "availo-field-centre") || findInputByKind(doc, "centre"),
      dateFrom: testid(doc, "availo-field-date-from") || findInputByKind(doc, "dateFrom", ["date", "text"]),
      dateTo: testid(doc, "availo-field-date-to") || findInputByKind(doc, "dateTo", ["date", "text"]),
      submit: testid(doc, "availo-search-submit") || findButtonByAction(doc, "search"),
    };
  }

  // For the popup's "Check this page" diagnostic.
  function diagnose(doc = document) {
    const p = page(doc);
    const login = loginFields(doc);
    const search = searchFields(doc);
    const rows = resultRows(doc);
    return {
      page: p,
      blocked: blocked(doc),
      queued: queued(doc),
      loggedOut: loggedOut(doc),
      login: { licence: !!login.licence, bookingRef: !!login.bookingRef, submit: !!login.submit },
      search: { centre: !!search.centre, dateFrom: !!search.dateFrom, submit: !!search.submit },
      rowCount: rows.length,
      centre: pageCentre(doc),
      // The soonest available date across the whole calendar (ISO strings sort
      // chronologically) — a concrete number the user can sanity-check, unlike
      // the raw all-months total.
      soonest: rows.length ? rows.map((r) => r.datetime).sort()[0] : null,
    };
  }

  return { page, loginFields, searchFields, resultRows, blocked, queued, loggedOut, serviceClosed, reopenTime, diagnose, pageCentre };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AvailoResolve };
}
