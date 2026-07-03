import { useEffect, useState } from "react";
import { getMyWatchSessions, getMyWatchAlerts } from "../api";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function relativeTime(iso) {
  if (!iso) return "just now";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "moments ago";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
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
  const recentAlert = alerts.find((a) => a.payload && a.payload.slot_datetime);

  return (
    <div>
      <h2 className="av-heading-m">Watch &amp; Assist</h2>
      <p className="av-body-s">
        Install the Availo browser extension to watch the real DVSA "change your test" page yourself.
        It never books or holds anything on its own — it just alerts you the instant an earlier slot
        appears, and you click through to secure it yourself.
      </p>

      {loading ? (
        <p className="av-body">Checking watch status…</p>
      ) : activeSession ? (
        <div className="av-note">
          <p className="av-body" style={{ margin: "0 0 4px" }}>
            <span className="av-tag av-tag--success">Watching now</span>
          </p>
          <p className="av-body" style={{ margin: 0 }}>
            You can stop checking — Availo is watching <strong>{activeSession.test_centre}</strong> for you.
            {" "}<span style={{ color: "var(--muted)" }}>Last checked {relativeTime(activeSession.last_seen_at)}.</span>
          </p>
          {recentAlert ? (
            <p className="av-body-s" style={{ margin: "6px 0 0" }}>
              We already spotted one for you {relativeTime(recentAlert.created_at)} — check your alerts below.
            </p>
          ) : (
            <p className="av-body-s" style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              No earlier slots right now — that's normal. We'll reach you the second one appears.
            </p>
          )}
        </div>
      ) : staleSession ? (
        <p className="av-body">
          <span className="av-tag av-tag--warning">Watching may have paused</span>{" "}
          No update since {fmtDateTime(staleSession.last_seen_at)} — just check the DVSA tab is still open, and you're covered again.
        </p>
      ) : (
        <p className="av-body">
          <span className="av-tag av-tag--neutral">Not currently watching</span>{" "}
          Open the real DVSA page and click "Start watching" in the extension popup — then you can put it out of your mind.
        </p>
      )}

      {sessions.length > 0 && (
        <details className="av-details">
          <summary>Watch session history</summary>
          <div className="av-details__body">
            <table className="av-table">
              <thead>
                <tr>
                  <th scope="col">Centre</th>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.test_centre}</td>
                    <td>{fmtDateTime(s.started_at)}</td>
                    <td>{s.status === "ended" ? "Ended" : s.is_stale ? "Stale" : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {alerts.length > 0 && (
        <details className="av-details">
          <summary>Backup alert history</summary>
          <div className="av-details__body">
            <p className="av-body-s">
              We send a backup email whenever the extension finds a slot while you weren't actively watching.
            </p>
            <ul className="av-list">
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
