import { useEffect, useState } from "react";
import { getSessions, flagSession } from "../api";

export default function SessionList() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const data = await getSessions();
    setSessions(data.sessions);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  async function flag(id) {
    await flagSession(id);
    load();
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <button
          onClick={load}
          className="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded"
          disabled={loading}
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">IP</th>
              <th className="pb-2">User-Agent</th>
              <th className="pb-2">Risk</th>
              <th className="pb-2">Bot?</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="py-2 font-mono">{s.ip}</td>
                <td className="py-2 truncate max-w-xs" title={s.user_agent}>
                  {s.user_agent}
                </td>
                <td className="py-2">{s.risk_score}</td>
                <td className="py-2">
                  {s.is_bot ? (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">bot</span>
                  ) : (
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">ok</span>
                  )}
                </td>
                <td className="py-2">
                  {!s.is_bot && (
                    <button
                      onClick={() => flag(s.id)}
                      className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
                    >
                      Flag
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-400">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
