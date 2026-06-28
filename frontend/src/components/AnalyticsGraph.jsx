import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getSummary } from "../api";

export default function AnalyticsGraph() {
  const [summary, setSummary] = useState({ total_sessions: 0, bot_sessions: 0, bot_rate_percent: 0 });

  useEffect(() => {
    async function load() {
      const data = await getSummary();
      setSummary(data);
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const data = [
    { name: "Total", value: summary.total_sessions, color: "#3b82f6" },
    { name: "Bot", value: summary.bot_sessions, color: "#ef4444" },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4">Bot Analytics</h2>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Bot rate: <strong>{summary.bot_rate_percent}%</strong>
      </p>
    </div>
  );
}
