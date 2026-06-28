import { useState, useEffect } from "react";
import { apiGet, getMyBookings } from "../api";
import PaymentMethod from "../components/PaymentMethod";

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
    <div className="govuk-width-container">
      <main className="govuk-main-wrapper">

        {isActive && slots.length > 0 && (
          <div className="govuk-notification-banner govuk-notification-banner--success" role="region">
            <div className="govuk-notification-banner__header">
              <p>Success</p>
            </div>
            <div style={{ padding: "15px 20px 5px" }}>
              <h2 className="govuk-notification-banner__heading">
                {slots.length} earlier slot{slots.length !== 1 ? "s" : ""} found at {prefs.centre}
              </h2>
              <p className="govuk-body">Check below and book one on the DVSA website before it goes.</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          <div>
            <h1 className="govuk-heading-l" style={{ marginBottom: 4 }}>Your alert</h1>
            <p className="govuk-body-s" style={{ color: "#505a5f" }}>Signed in as {user.email}</p>
          </div>
          <button className="govuk-button govuk-button--secondary" style={{ marginTop: 8 }} onClick={onSignOut}>Sign out</button>
        </div>

        {!isActive ? (
          <div className="govuk-inset-text">
            <p className="govuk-body">You haven't set up an alert yet.</p>
            <button className="govuk-button" onClick={onChangePrefs}>Set up your alert</button>
          </div>
        ) : (
          <>
            <dl className="govuk-summary-list" style={{ marginBottom: 30 }}>
              <div className="govuk-summary-list__row">
                <dt className="govuk-summary-list__key">Status</dt>
                <dd className="govuk-summary-list__value">
                  <strong className="govuk-tag govuk-tag--green">Active — monitoring</strong>
                </dd>
              </div>
              <div className="govuk-summary-list__row">
                <dt className="govuk-summary-list__key">Test centre</dt>
                <dd className="govuk-summary-list__value">{prefs.centre}</dd>
              </div>
              <div className="govuk-summary-list__row">
                <dt className="govuk-summary-list__key">Your current test date</dt>
                <dd className="govuk-summary-list__value">
                  {prefs.current_test_date ? fmt(prefs.current_test_date) : <span style={{ color: "#505a5f" }}>Not set — showing all available slots</span>}
                </dd>
              </div>
              <div className="govuk-summary-list__row">
                <dt className="govuk-summary-list__key">Search window</dt>
                <dd className="govuk-summary-list__value">{prefs.search_days_ahead} days from today</dd>
              </div>
              <div className="govuk-summary-list__row">
                <dt className="govuk-summary-list__key">Auto-booking</dt>
                <dd className="govuk-summary-list__value">
                  {prefs.auto_book ? (
                    <strong className="govuk-tag govuk-tag--blue">On — we'll book the first earlier slot</strong>
                  ) : (
                    <span style={{ color: "#505a5f" }}>Off — we'll only email you</span>
                  )}
                </dd>
              </div>
            </dl>

            <button className="govuk-button govuk-button--secondary" onClick={onChangePrefs} style={{ marginBottom: 40 }}>
              Change preferences
            </button>

            <h2 className="govuk-heading-m">
              {loading ? "Checking for slots…" : slots.length > 0 ? `${slots.length} available slot${slots.length !== 1 ? "s" : ""} at ${prefs.centre}` : `No slots found yet at ${prefs.centre}`}
            </h2>

            {!loading && slots.length === 0 && (
              <div className="govuk-warning-text">
                <div className="govuk-warning-text__icon" aria-hidden="true">!</div>
                <p className="govuk-warning-text__text">
                  No earlier cancellations found right now. We're checking every few minutes — you'll get an email as soon as one appears.
                </p>
              </div>
            )}

            {slots.map((slot) => (
              <div key={slot.id} className="availo-slot-card availo-slot-card--new">
                <div>
                  <p className="availo-slot-card__date">{fmt(slot.slot_datetime)}</p>
                  <p className="availo-slot-card__time">{fmtTime(slot.slot_datetime)}</p>
                </div>
                <a
                  className="govuk-button"
                  href="https://www.gov.uk/change-driving-test"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginBottom: 0 }}
                >
                  Book on DVSA →
                </a>
              </div>
            ))}

            {!loading && slots.length > 0 && (
              <p className="govuk-body-s" style={{ color: "#505a5f", marginTop: 10 }}>
                Slots refresh every 30 seconds. Book quickly — cancellations go fast.
              </p>
            )}

            <div style={{ marginTop: 40 }}>
              <h2 className="govuk-heading-m">Your bookings</h2>
              {bookings.length === 0 ? (
                <p className="govuk-body" style={{ color: "#505a5f" }}>No bookings yet. When auto-booking secures a slot it will appear here.</p>
              ) : (
                <table className="govuk-table">
                  <thead className="govuk-table__head">
                    <tr className="govuk-table__row">
                      <th scope="col" className="govuk-table__header">Test centre</th>
                      <th scope="col" className="govuk-table__header">Date &amp; time</th>
                      <th scope="col" className="govuk-table__header">Reference</th>
                      <th scope="col" className="govuk-table__header">Status</th>
                    </tr>
                  </thead>
                  <tbody className="govuk-table__body">
                    {bookings.map((b) => (
                      <tr key={b.id} className="govuk-table__row">
                        <td className="govuk-table__cell">{b.test_centre}</td>
                        <td className="govuk-table__cell">{fmt(b.slot_datetime)} {fmtTime(b.slot_datetime)}</td>
                        <td className="govuk-table__cell">{b.booking_reference}</td>
                        <td className="govuk-table__cell">
                          <strong className={`govuk-tag ${b.status === "confirmed" ? "govuk-tag--green" : b.status === "failed" || b.status === "cancelled" ? "govuk-tag--red" : "govuk-tag--yellow"}`}>
                            {b.status}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <PaymentMethod token={token} />
          </>
        )}
      </main>
    </div>
  );
}
