import { useEffect, useState } from "react";
import { getNotifications, sendPending } from "../api";

export default function NotificationQueue() {
  const [notifications, setNotifications] = useState([]);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await getNotifications();
        setNotifications(data.notifications);
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  async function sendAll() {
    setSending(true);
    setMessage("");
    try {
      const result = await sendPending();
      const data = await getNotifications();
      setNotifications(data.notifications);
      setMessage(`Sent ${result.sent} pending notifications.`);
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setSending(false);
    }
  }

  const pending = notifications.filter((n) => n.status === "pending");
  const sent = notifications.filter((n) => n.status === "sent");

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <button
          onClick={sendAll}
          disabled={sending || pending.length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
        >
          {sending ? "Sending..." : `Send ${pending.length} pending`}
        </button>
      </div>
      {message && (
        <div className={`mb-3 p-2 rounded text-sm ${message.includes("error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
          {message}
        </div>
      )}
      <div className="overflow-auto max-h-48">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Slot</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Channel</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n, i) => (
              <tr key={n.id || i} className="border-b last:border-0">
                <td className="py-2 font-mono text-xs">{n.slot_id}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${n.status === "sent" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {n.status}
                  </span>
                </td>
                <td className="py-2 text-xs">{n.channel}</td>
              </tr>
            ))}
            {notifications.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-slate-400">
                  No notifications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
