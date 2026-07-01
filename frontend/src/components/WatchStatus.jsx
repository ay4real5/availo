import { useEffect, useState } from "react";
import { getMyWatchSessions, getMyWatchAlerts } from "../api";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function WatchStatus({ token }) {
  const [sessions, setSessions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [s, a] = await Promise.all([getMyWatchSessions(token), getMyWatchAlerts(token)]);
      setSessions(s.sessions || []);
      setAlerts(a.alerts || []);
    } catch {
      setSessions([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [token]);

  const activeSession = sessions.find((s) => s.status === "active" && !s.is_stale);
  const staleSession = sessions.find((s) => s.status === "active" && s.is_stale);

  return (
    <div style={{ marginTop: 40 }}>
      <h2 className="govuk-heading-m">Watch &amp; Assist</h2>
      <p className="govuk-body-s" style={{ color: "#505a5f" }}>
        Install the Availo browser extension to watch the real DVSA "change your test" page yourself.
        It never books or holds anything on its own — it just alerts you the instant an earlier slot
        appears, and you click through to secure it yourself.
      </p>

      {loading ? (
        <p className="govuk-body">Checking watch status…</p>
      ) : activeSession ? (
        <p className="govuk-body">
          <strong className="govuk-tag govuk-tag--green">Watching now</strong>{" "}
          {activeSession.test_centre} since {fmtDateTime(activeSession.started_at)}
        </p>
      ) : staleSession ? (
        <p className="govuk-body">
          <strong className="govuk-tag govuk-tag--yellow">Watching may have stopped</strong>{" "}
          No update from the extension since {fmtDateTime(staleSession.last_seen_at)}. Check the tab is still open.
        </p>
      ) : (
        <p className="govuk-body">
          <strong className="govuk-tag govuk-tag--grey">Not currently watching</strong>{" "}
          Open the real DVSA page and click "Start watching" in the extension popup.
        </p>
      )}

      {sessions.length > 0 && (
        <details className="govuk-details" style={{ marginTop: 10 }}>
          <summary className="govuk-details__summary">
            <span className="govuk-details__summary-text">Watch session history</span>
          </summary>
          <div className="govuk-details__text">
            <table className="govuk-table">
              <thead className="govuk-table__head">
                <tr className="govuk-table__row">
                  <th className="govuk-table__header" scope="col">Centre</th>
                  <th className="govuk-table__header" scope="col">Started</th>
                  <th className="govuk-table__header" scope="col">Status</th>
                </tr>
              </thead>
              <tbody className="govuk-table__body">
                {sessions.map((s) => (
                  <tr key={s.id} className="govuk-table__row">
                    <td className="govuk-table__cell">{s.test_centre}</td>
                    <td className="govuk-table__cell">{fmtDateTime(s.started_at)}</td>
                    <td className="govuk-table__cell">{s.status === "ended" ? "Ended" : s.is_stale ? "Stale" : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {alerts.length > 0 && (
        <details className="govuk-details" style={{ marginTop: 10 }}>
          <summary className="govuk-details__summary">
            <span className="govuk-details__summary-text">Backup alert history</span>
          </summary>
          <div className="govuk-details__text">
            <p className="govuk-body-s" style={{ color: "#505a5f" }}>
              We send a backup email whenever the extension finds a slot while you weren't actively watching.
            </p>
            <ul className="govuk-list govuk-list--bullet">
              {alerts.map((a) => (
                <li key={a.id}>
                  {a.event_type === "watch_backup_alert_sent" ? "Backup email sent" : "Slot detected"} —{" "}
                  {a.payload?.centre} at {fmtDateTime(a.payload?.slot_datetime)} ({fmtDateTime(a.created_at)})
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
