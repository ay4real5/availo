// ============================================================================
// Pure, DOM-free heuristics for recognising the real DVSA pages.
//
// The DVSA "change your driving test" flow is built on the public GOV.UK Design
// System, so we can recognise fields/rows/buttons by their labels, text and the
// dates they contain — no per-user configuration, and it degrades gracefully
// (if unsure, callers do nothing rather than misfire). These functions take
// plain strings so they're unit-testable without a browser; the DOM glue lives
// in selectors.js (AvailoResolve).
// ============================================================================

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Parse the date/time out of a chunk of results-row text into an ISO string, or
// null if there isn't a confident date. Handles the shapes GOV.UK/DVSA render:
//   "Monday 10 November 2026 9:15am"
//   "10 Nov 2026, 09:15"
//   "10 November 2026 at 2:00pm"
//   "2026-11-10 09:15"
function parseSlotDateTime(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/ /g, " ").trim();

  let year, monthIdx, day;

  // ISO-ish: 2026-11-10
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    year = Number(iso[1]); monthIdx = Number(iso[2]) - 1; day = Number(iso[3]);
  } else {
    // "10 November 2026" / "10 Nov 2026"
    const dmy = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
    if (!dmy) return null;
    day = Number(dmy[1]);
    monthIdx = MONTHS[dmy[2].toLowerCase()];
    year = Number(dmy[3]);
    if (monthIdx === undefined) return null;
  }

  // Time: "9:15am", "09:15", "2:00 pm", "at 14:00". Default to midnight if absent.
  let hour = 0, minute = 0;
  const time = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (time) {
    hour = Number(time[1]);
    minute = Number(time[2]);
    const mer = time[3] && time[3].toLowerCase();
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
  }

  if (
    Number.isNaN(year) || Number.isNaN(day) ||
    monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31 ||
    hour > 23 || minute > 59
  ) return null;

  const d = new Date(Date.UTC(year, monthIdx, day, hour, minute));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Does this page text read like a block / challenge / rate-limit / error page?
function looksLikeBlock(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  return (
    /sorry,?\s+there\s+is\s+a\s+problem/.test(t) ||
    /too\s+many\s+requests/.test(t) ||
    /unusual\s+activity/.test(t) ||
    /verify\s+(you\s+are|that\s+you'?re)\s+human/.test(t) ||
    /are\s+you\s+a\s+robot/.test(t) ||
    /\bh?captcha\b/.test(t) ||
    /access\s+denied/.test(t) ||
    /you\s+have\s+been\s+blocked/.test(t) ||
    // Confirmed against the real Imperva/hCaptcha challenge DVSA can show
    // ("driverpracticaltest.dvsa.gov.uk - Additional security check is
    // required", "I am human", "Powered by Imperva").
    /security\s+check\s+is\s+required/.test(t) ||
    /additional\s+security\s+check/.test(t) ||
    /\bimperva\b/.test(t) ||
    /\bi\s+am\s+human\b/.test(t)
  );
}

// Does this page read like a DVSA/Queue-it waiting room? A queue is NOT a block:
// the correct behaviour is to WAIT quietly (never refresh — that loses your
// place), not to stop watching. Kept separate from looksLikeBlock for that
// reason.
function looksLikeQueue(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  return (
    /you\s+are\s+now\s+in\s+line/.test(t) ||
    /you\s+are\s+in\s+(?:a\s+)?queue/.test(t) ||
    /waiting\s+room/.test(t) ||
    /your\s+(?:estimated\s+)?wait\s+time/.test(t) ||
    /estimated\s+wait/.test(t) ||
    /your\s+turn/.test(t) ||
    /please\s+wait.*(?:queue|line|turn)/.test(t) ||
    /\bqueue-it\b/.test(t) ||
    /number\s+of\s+users\s+(?:in\s+line\s+)?ahead\s+of\s+you/.test(t)
  );
}

// Does this page text read like DVSA signed the user out / the session expired?
function looksLoggedOut(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  return (
    /you(?:'ve| have)?\s+been\s+signed\s+out/.test(t) ||
    /(?:your\s+)?session\s+has\s+(?:expired|timed\s*out|ended)/.test(t) ||
    /signed\s+out\s+(?:for|due\s+to)\s+(?:your\s+security|inactivity)/.test(t) ||
    /for\s+your\s+security,?\s+we(?:'ve| have)?\s+signed\s+you\s+out/.test(t) ||
    /sign\s+in\s+to\s+continue/.test(t) ||
    /your\s+session\s+has\s+expired/.test(t)
  );
}

const LABEL_KEYWORDS = {
  licence: [/driving\s*licence/i, /licence\s*number/i, /\blicence\b/i, /\blicense\b/i],
  bookingRef: [/booking\s*reference/i, /reference\s*number/i, /application\s*reference/i, /\breference\b/i, /\bbooking\b/i],
  centre: [/test\s*centre/i, /\bcentre\b/i, /\bcenter\b/i, /location/i, /postcode/i],
  dateFrom: [/from/i, /earliest/i, /start\s*date/i, /on\s*or\s*after/i],
  dateTo: [/\bto\b/i, /latest/i, /end\s*date/i, /on\s*or\s*before/i],
};

// Does a field's label / name / placeholder text identify it as `kind`?
function labelMatchesKind(text, kind) {
  if (!text || typeof text !== "string") return false;
  const patterns = LABEL_KEYWORDS[kind];
  if (!patterns) return false;
  return patterns.some((re) => re.test(text));
}

const BUTTON_KEYWORDS = {
  login: [/sign\s*in/i, /log\s*in/i, /^continue$/i, /start\s*now/i],
  search: [/search/i, /find\s+(a\s+)?test/i, /show\s+.*tests/i, /^continue$/i],
  // The slot's own reserve control — the extension only ever HIGHLIGHTS this;
  // the human clicks it.
  select: [/book\s+this\s+test/i, /^book$/i, /select/i, /choose/i, /reserve/i, /change\s+to\s+this/i],
};

function buttonMatchesAction(text, action) {
  if (!text || typeof text !== "string") return false;
  const patterns = BUTTON_KEYWORDS[action];
  if (!patterns) return false;
  const t = text.trim();
  return patterns.some((re) => re.test(t));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseSlotDateTime, looksLikeBlock, looksLikeQueue, looksLoggedOut, labelMatchesKind, buttonMatchesAction };
}
