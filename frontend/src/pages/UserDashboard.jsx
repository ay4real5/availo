import { useState, useEffect } from "react";
import { apiGet } from "../api";
import WatchStatus from "../components/WatchStatus";
import PushSetup from "../components/PushSetup";

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function UserDashboard({ user, token, prefs, onChangePrefs, onSignOut }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiGet("/api/auth/my-slots", token);
        // Only show slots your OWN extension actually spotted on the real DVSA
        // page. Anything else in the store is demo/mock data and must not be
        // shown as if it were a real cancellation.
        setSlots((data.slots || []).filter((s) => s.source_meta?.origin === "extension"));
      } catch {
        setSlots([]);
      } finally {
        setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [token]);

  const isActive = Boolean(prefs?.centre);

  return (
    <div className="av-container">
      <main className="av-main">

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          <div>
            <h1 className="av-heading-l" style={{ marginBottom: 4 }}>Your alert</h1>
            <p className="av-body-s" style={{ margin: 0 }}>Signed in as {user.email}</p>
          </div>
          <button className="av-btn av-btn--secondary" onClick={onSignOut}>Sign out</button>
        </div>

        {!isActive ? (
          <div className="av-card">
            <p className="av-body">You haven't set up your alert yet — tell us your test centre and current test date.</p>
            <button className="av-btn" onClick={onChangePrefs}>Set up your alert</button>
          </div>
        ) : (
          <>
            {/* Honest explainer — no pretending we watch DVSA on a server. */}
            <div className="av-card">
              <h2 className="av-heading-m">How Availo helps you</h2>
              <p className="av-body">
                We don't sit on the DVSA website for you — that's against DVSA's rules, and it's not
                what we do. Instead:
              </p>
              <ol className="av-list" style={{ marginBottom: 12 }}>
                <li>Install the Availo browser extension (below).</li>
                <li>Open the real <a href="https://www.gov.uk/change-driving-test" target="_blank" rel="noopener noreferrer">DVSA "change your driving test"</a> page and sign in as normal.</li>
                <li>The extension watches that page for you and alerts you the instant an earlier slot appears — even by email or on your phone if you've stepped away.</li>
                <li>It fills your details so you're one click from booking. <strong>You always make the booking yourself.</strong></li>
              </ol>
            </div>

            <div className="av-card av-section-gap">
              <dl className="av-summary-list" style={{ marginBottom: 20 }}>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Test centre</dt>
                  <dd className="av-summary-list__value">{prefs.centre}</dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Your current test date</dt>
                  <dd className="av-summary-list__value">
                    {prefs.current_test_date ? fmt(prefs.current_test_date) : <span style={{ color: "var(--muted)" }}>Not set — we'll alert you to any available slot</span>}
                  </dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Search window</dt>
                  <dd className="av-summary-list__value">{prefs.search_days_ahead} days from today</dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Email alerts</dt>
                  <dd className="av-summary-list__value">
                    {prefs.notify_email === false
                      ? <span style={{ color: "var(--muted)" }}>Off</span>
                      : <span className="av-tag av-tag--success">On</span>}
                  </dd>
                </div>
              </dl>

              <button className="av-btn av-btn--secondary" onClick={onChangePrefs}>
                Change preferences
              </button>
            </div>

            <div className="av-card av-section-gap">
              <WatchStatus token={token} />
            </div>

            <div className="av-card av-section-gap">
              <PushSetup token={token} />
            </div>

            {/* Slots the user's OWN extension spotted on the real DVSA page. */}
            <div className="av-section-gap">
              <h2 className="av-heading-m">Slots your extension has spotted</h2>
              {loading ? (
                <p className="av-body">Loading…</p>
              ) : slots.length === 0 ? (
                <div className="av-warning">
                  <span className="av-warning__icon" aria-hidden="true">i</span>
                  <p className="av-warning__text" style={{ margin: 0 }}>
                    Nothing yet. Install the extension and open the DVSA page with it watching — any earlier
                    slot it spots will appear here, and you'll be alerted straight away.
                  </p>
                </div>
              ) : (
                <>
                  {slots.map((slot) => (
                    <div key={slot.id} className="av-slot-card av-slot-card--new">
                      <div>
                        <p className="av-slot-card__date">{fmt(slot.slot_datetime)}</p>
                        <p className="av-slot-card__time">{fmtTime(slot.slot_datetime)}</p>
                        <span className="av-tag" style={{ marginTop: 8 }}>Spotted by your extension</span>
                      </div>
                      <a
                        className="av-btn"
                        href="https://www.gov.uk/change-driving-test"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Book on DVSA →
                      </a>
                    </div>
                  ))}
                  <p className="av-body-s" style={{ marginTop: 10 }}>
                    Book quickly — cancellations go fast.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
