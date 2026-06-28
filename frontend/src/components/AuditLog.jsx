import { useEffect, useState } from "react";
import { getAudit } from "../api";

const EVENT_COLOURS = {
  slot_quarantined: "bg-red-100 text-red-700",
  slot_approved: "bg-green-100 text-green-700",
  slot_ignored: "bg-slate-100 text-slate-600",
  slot_released: "bg-amber-100 text-amber-700",
  slot_rejected: "bg-gray-200 text-gray-700",
  rules_config_updated: "bg-blue-100 text-blue-700",
  rules_config_reloaded: "bg-blue-100 text-blue-700",
};

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const params = filter ? { event_type: filter } : {};
        const data = await getAudit(params);
        setLogs(data.logs);
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [filter]);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Audit Log ({logs.length})</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All events</option>
          <option value="slot_quarantined">Quarantined</option>
          <option value="slot_approved">Approved</option>
          <option value="slot_released">Released</option>
          <option value="slot_rejected">Rejected</option>
          <option value="rules_config_updated">Rules updated</option>
        </select>
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Time</th>
              <th className="pb-2">Event</th>
              <th className="pb-2">Actor</th>
              <th className="pb-2">Entity</th>
              <th className="pb-2">Payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b last:border-0">
                <td className="py-2 text-xs">{new Date(log.created_at).toLocaleTimeString()}</td>
                <td className="py-2">
                  <span className={`px-2 py-1 rounded text-xs ${EVENT_COLOURS[log.event_type] || "bg-slate-100 text-slate-600"}`}>
                    {log.event_type}
                  </span>
                </td>
                <td className="py-2">{log.actor}</td>
                <td className="py-2 font-mono text-xs">{log.entity_id?.slice(0, 8) || "—"}</td>
                <td className="py-2 text-xs max-w-xs truncate">
                  {JSON.stringify(log.payload)}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-400">
                  No audit events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
