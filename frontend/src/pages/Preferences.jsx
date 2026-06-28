import { useState } from "react";
import { apiPost } from "../api";

const CENTRES = [
  "Bolton", "Bury", "Manchester", "Rochdale", "Stockport",
  "Wigan", "Salford", "Oldham", "Trafford", "Tameside",
  "Birmingham", "Coventry", "Leeds", "Sheffield", "Liverpool",
  "Bristol", "Cardiff", "Edinburgh", "Glasgow", "London Erith",
];

export default function Preferences({ token, existingPrefs, onSaved }) {
  const [form, setForm] = useState({
    centre: existingPrefs?.centre || "",
    current_test_date: existingPrefs?.current_test_date
      ? existingPrefs.current_test_date.slice(0, 10)
      : "",
    search_days_ahead: existingPrefs?.search_days_ahead ?? 42,
    notify_email: existingPrefs?.notify_email ?? true,
    auto_book: existingPrefs?.auto_book ?? false,
    licence_number: existingPrefs?.licence_number || "",
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: "" }));
    setServerError("");
  }

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.centre) errs.centre = "Select a test centre";
    if (form.auto_book && form.licence_number.trim().length < 5) {
      errs.licence_number = "Enter your driving licence number to enable auto-booking";
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const payload = {
        centre: form.centre,
        search_days_ahead: Number(form.search_days_ahead),
        notify_email: form.notify_email,
        auto_book: form.auto_book,
        licence_number: form.licence_number.trim() || null,
        current_test_date: form.current_test_date
          ? new Date(form.current_test_date).toISOString()
          : null,
      };
      const saved = await apiPost("/api/auth/preferences", payload, token);
      onSaved(saved);
    } catch (err) {
      setServerError(err.message || "Could not save preferences. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="govuk-width-container">
      <main className="govuk-main-wrapper">
        <div style={{ maxWidth: 560 }}>

          {serverError && (
            <div className="govuk-error-summary" role="alert">
              <h2 className="govuk-error-summary__title">There is a problem</h2>
              <ul className="govuk-error-summary__list"><li>{serverError}</li></ul>
            </div>
          )}

          <span className="govuk-caption-xl">Set up your alert</span>
          <h1 className="govuk-heading-l">Where and when do you want to test?</h1>
          <p className="govuk-body">
            We'll check for earlier cancellations at your chosen centre and email you the moment one appears.
          </p>

          <form onSubmit={submit} noValidate>
            <div className={`govuk-form-group${errors.centre ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="centre">Test centre</label>
              <span className="govuk-hint">Choose the centre where you want to take your test</span>
              {errors.centre && <p className="govuk-error-message">{errors.centre}</p>}
              <select
                id="centre"
                className="govuk-select"
                value={form.centre}
                onChange={(e) => set("centre", e.target.value)}
              >
                <option value="">Select a test centre</option>
                {CENTRES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="govuk-form-group">
              <label className="govuk-label" htmlFor="current_test_date">Your current test date (optional)</label>
              <span className="govuk-hint">
                If you have a test booked, we'll only alert you to slots that are earlier than this date.
                Leave blank to see all available slots.
              </span>
              <input
                id="current_test_date"
                className="govuk-input govuk-input--width-20"
                type="date"
                value={form.current_test_date}
                onChange={(e) => set("current_test_date", e.target.value)}
              />
            </div>

            <div className="govuk-form-group">
              <label className="govuk-label" htmlFor="search_days_ahead">How far ahead to search (days)</label>
              <span className="govuk-hint">We'll look for slots up to this many days from today. Default is 42 days (6 weeks).</span>
              <input
                id="search_days_ahead"
                className="govuk-input govuk-input--width-20"
                type="number"
                min="1"
                max="180"
                value={form.search_days_ahead}
                onChange={(e) => set("search_days_ahead", e.target.value)}
              />
            </div>

            <div className="govuk-form-group">
              <div className="govuk-checkboxes__item" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <input
                  id="auto_book"
                  className="govuk-checkboxes__input"
                  type="checkbox"
                  checked={form.auto_book}
                  onChange={(e) => set("auto_book", e.target.checked)}
                />
                <label className="govuk-label govuk-checkboxes__label" htmlFor="auto_book">
                  Automatically book the first earlier slot for me
                  <span className="govuk-hint" style={{ marginTop: 4 }}>
                    When an earlier slot appears we'll secure it using your saved card.
                    You'll need to add a payment card and your licence number below.
                  </span>
                </label>
              </div>
            </div>

            {form.auto_book && (
              <div className={`govuk-form-group${errors.licence_number ? " govuk-form-group--error" : ""}`}>
                <label className="govuk-label" htmlFor="licence_number">Driving licence number</label>
                <span className="govuk-hint">Required so we can sign in to DVSA and change your test on your behalf.</span>
                {errors.licence_number && <p className="govuk-error-message">{errors.licence_number}</p>}
                <input
                  id="licence_number"
                  className="govuk-input govuk-input--width-20"
                  type="text"
                  value={form.licence_number}
                  onChange={(e) => set("licence_number", e.target.value.toUpperCase())}
                />
              </div>
            )}

            <button className="govuk-button" type="submit" disabled={loading}>
              {loading ? "Saving…" : existingPrefs ? "Update my alert" : "Start monitoring for me"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
