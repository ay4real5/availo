import { useState, useEffect } from "react";
import { apiGet, getMyBookings } from "../api";
import PaymentMethod from "../components/PaymentMethod";
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
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiGet("/api/auth/my-slots", token);
        setSlots(data.slots || []);
      } catch {
        setSlots([]);
      } finally {
        setLoading(false);
      }
      try {
        const b = await getMyBookings(token);
        setBookings(b.bookings || []);
      } catch {
        setBookings([]);
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

        {isActive && slots.length > 0 && (
          <div className="av-banner av-banner--success" role="region">
            <span className="av-banner__icon" aria-hidden="true">✓</span>
            <div>
              <p className="av-banner__heading">
                {slots.length} earlier slot{slots.length !== 1 ? "s" : ""} found at {prefs.centre}
              </p>
              <p className="av-body" style={{ margin: 0 }}>Check below and book one on the DVSA website before it goes.</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          <div>
            <h1 className="av-heading-l" style={{ marginBottom: 4 }}>Your alert</h1>
            <p className="av-body-s" style={{ margin: 0 }}>Signed in as {user.email}</p>
          </div>
          <button className="av-btn av-btn--secondary" onClick={onSignOut}>Sign out</button>
        </div>

        {!isActive ? (
          <div className="av-card">
            <p className="av-body">You haven't set up an alert yet.</p>
            <button className="av-btn" onClick={onChangePrefs}>Set up your alert</button>
          </div>
        ) : (
          <>
            <div className="av-card">
              <dl className="av-summary-list" style={{ marginBottom: 20 }}>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Status</dt>
                  <dd className="av-summary-list__value">
                    <span className="av-tag av-tag--success">Active — monitoring</span>
                  </dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Test centre</dt>
                  <dd className="av-summary-list__value">{prefs.centre}</dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Your current test date</dt>
                  <dd className="av-summary-list__value">
                    {prefs.current_test_date ? fmt(prefs.current_test_date) : <span style={{ color: "var(--muted)" }}>Not set — showing all available slots</span>}
                  </dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Search window</dt>
                  <dd className="av-summary-list__value">{prefs.search_days_ahead} days from today</dd>
                </div>
                <div className="av-summary-list__row">
                  <dt className="av-summary-list__key">Auto-booking</dt>
                  <dd className="av-summary-list__value">
                    {prefs.auto_book ? (
                      <span className="av-tag">On — we'll book the first earlier slot</span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Off — we'll only alert you</span>
                    )}
                  </dd>
                </div>
              </dl>

              <button className="av-btn av-btn--secondary" onClick={onChangePrefs}>
                Change preferences
              </button>
            </div>

            <div className="av-section-gap">
              <h2 className="av-heading-m">
                {loading ? "Checking for slots…" : slots.length > 0 ? `${slots.length} available slot${slots.length !== 1 ? "s" : ""} at ${prefs.centre}` : `No slots found yet at ${prefs.centre}`}
              </h2>

              {!loading && slots.length === 0 && (
                <div className="av-warning">
                  <span className="av-warning__icon" aria-hidden="true">i</span>
                  <p className="av-warning__text" style={{ margin: 0 }}>
                    No earlier cancellations found right now. We're checking continuously — you'll get an alert as soon as one appears.
                  </p>
                </div>
              )}

              {slots.map((slot) => (
                <div key={slot.id} className="av-slot-card av-slot-card--new">
                  <div>
                    <p className="av-slot-card__date">{fmt(slot.slot_datetime)}</p>
                    <p className="av-slot-card__time">{fmtTime(slot.slot_datetime)}</p>
                    {slot.source_meta?.origin === "extension" && (
                      <span className="av-tag" style={{ marginTop: 8 }}>
                        Detected via your Watch extension
                      </span>
                    )}
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

              {!loading && slots.length > 0 && (
                <p className="av-body-s" style={{ marginTop: 10 }}>
                  Slots refresh every 30 seconds. Book quickly — cancellations go fast.
                </p>
              )}
            </div>

            <div className="av-section-gap">
              <h2 className="av-heading-m">Your bookings</h2>
              {bookings.length === 0 ? (
                <p className="av-body" style={{ color: "var(--muted)" }}>No bookings yet. When auto-booking secures a slot it will appear here.</p>
              ) : (
                <div className="av-card">
                  <table className="av-table">
                    <thead>
                      <tr>
                        <th scope="col">Test centre</th>
                        <th scope="col">Date &amp; time</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((b) => (
                        <tr key={b.id}>
                          <td>{b.test_centre}</td>
                          <td>{fmt(b.slot_datetime)} {fmtTime(b.slot_datetime)}</td>
                          <td>{b.booking_reference}</td>
                          <td>
                            <span className={`av-tag ${b.status === "confirmed" ? "av-tag--success" : b.status === "failed" || b.status === "cancelled" ? "av-tag--danger" : "av-tag--warning"}`}>
                              {b.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="av-card av-section-gap">
              <WatchStatus token={token} />
            </div>

            <div className="av-card av-section-gap">
              <PushSetup token={token} />
            </div>

            <div className="av-card av-section-gap">
              <PaymentMethod token={token} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
