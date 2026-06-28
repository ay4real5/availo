import { useEffect, useState } from "react";
import { getQuarantine, releaseSlot, rejectSlot } from "../api";

export default function QuarantineViewer() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await getQuarantine();
        setSlots(data.slots);
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  async function act(id, action) {
    setLoading(true);
    setMessage("");
    try {
      const note = reason.trim() || "Manual review";
      if (action === "release") {
        await releaseSlot(id, note);
        setMessage("Slot released and notification queued.");
      } else {
        await rejectSlot(id, note);
        setMessage("Slot rejected.");
      }
      const data = await getQuarantine();
      setSlots(data.slots);
      setActiveId(null);
      setReason("");
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4">Quarantine ({slots.length})</h2>
      {message && (
        <div className={`mb-3 p-2 rounded text-sm ${message.toLowerCase().includes("error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
          {message}
        </div>
      )}
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Centre</th>
              <th className="pb-2">Slot</th>
              <th className="pb-2">Risk</th>
              <th className="pb-2">Reasons</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => (
              <tr key={slot.id || i} className="border-b last:border-0">
                <td className="py-2">{slot.test_centre}</td>
                <td className="py-2 font-mono">{new Date(slot.slot_datetime).toLocaleString()}</td>
                <td className="py-2">{slot.rule_meta?.bot?.risk_score ?? 0}</td>
                <td className="py-2 text-xs max-w-xs truncate">
                  {(slot.rule_meta?.bot?.reasons || []).join(", ")}
                </td>
                <td className="py-2">
                  {activeId === slot.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="border rounded px-2 py-1 text-xs w-32"
                        disabled={loading}
                      />
                      <button
                        onClick={() => act(slot.id, "release")}
                        disabled={loading}
                        className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs disabled:opacity-50"
                      >
                        Release
                      </button>
                      <button
                        onClick={() => act(slot.id, "reject")}
                        disabled={loading}
                        className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => { setActiveId(null); setReason(""); }}
                        disabled={loading}
                        className="text-slate-500 px-1 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveId(slot.id)}
                      className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded text-xs"
                    >
                      Review
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-400">
                  No quarantined slots.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
