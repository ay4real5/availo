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
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const payload = {
        centre: form.centre,
        search_days_ahead: Number(form.search_days_ahead),
        notify_email: form.notify_email,
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
    <div className="av-container">
      <main className="av-main">
        <div style={{ maxWidth: 600, margin: "0 auto" }}>

          {serverError && (
            <div className="av-error-summary" role="alert">
              <h2 className="av-error-summary__title">There is a problem</h2>
              <ul className="av-error-summary__list"><li>{serverError}</li></ul>
            </div>
          )}

          <span className="av-eyebrow">Set up your alert</span>
          <h1 className="av-heading-l">Where and when do you want to test?</h1>
          <p className="av-body-l">
            Tell us your centre and current test date. The Availo extension uses these to spot an earlier
            slot the moment it appears on the DVSA page you're viewing — and to alert you.
          </p>

          <div className="av-card">
            <form onSubmit={submit} noValidate>
              <div className={`av-form-group${errors.centre ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="centre">Test centre</label>
                <span className="av-hint">Choose the centre where you want to take your test</span>
                {errors.centre && <p className="av-error-message">{errors.centre}</p>}
                <select
                  id="centre"
                  className="av-select"
                  value={form.centre}
                  onChange={(e) => set("centre", e.target.value)}
                >
                  <option value="">Select a test centre</option>
                  {CENTRES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="av-form-group">
                <label className="av-label" htmlFor="current_test_date">Your current test date (optional)</label>
                <span className="av-hint">
                  If you have a test booked, we'll only alert you to slots that are earlier than this date.
                  Leave blank to see all available slots.
                </span>
                <input
                  id="current_test_date"
                  className="av-input av-input--width-20"
                  type="date"
                  value={form.current_test_date}
                  onChange={(e) => set("current_test_date", e.target.value)}
                />
              </div>

              <div className="av-form-group">
                <label className="av-label" htmlFor="search_days_ahead">How far ahead to search (days)</label>
                <span className="av-hint">We'll look for slots up to this many days from today. Default is 42 days (6 weeks).</span>
                <input
                  id="search_days_ahead"
                  className="av-input av-input--width-20"
                  type="number"
                  min="1"
                  max="180"
                  value={form.search_days_ahead}
                  onChange={(e) => set("search_days_ahead", e.target.value)}
                />
              </div>

              <div className="av-form-group">
                <div className="av-checkbox-row">
                  <input
                    id="notify_email"
                    type="checkbox"
                    checked={form.notify_email}
                    onChange={(e) => set("notify_email", e.target.checked)}
                  />
                  <label className="av-label" htmlFor="notify_email" style={{ marginBottom: 0 }}>
                    Email me a backup alert
                    <span className="av-hint" style={{ marginTop: 4, marginBottom: 0 }}>
                      If the extension spots a slot while you've stepped away, we'll email you so you can come back and book it.
                    </span>
                  </label>
                </div>
              </div>

              <button className="av-btn" type="submit" disabled={loading}>
                {loading ? "Saving…" : existingPrefs ? "Update my alert" : "Start monitoring for me"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
