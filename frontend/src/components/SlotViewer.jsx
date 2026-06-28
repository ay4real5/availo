import { useEffect, useState } from "react";
import { getSlots } from "../api";

export default function SlotViewer() {
  const [slots, setSlots] = useState([]);

  useEffect(() => {
    async function load() {
      const data = await getSlots();
      setSlots(data.slots);
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4">Available Slots</h2>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Centre</th>
              <th className="pb-2">Slot</th>
              <th className="pb-2">Proxy</th>
              <th className="pb-2">Job ID</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => (
              <tr key={slot.id || i} className="border-b last:border-0">
                <td className="py-2">{slot.test_centre}</td>
                <td className="py-2 font-mono">
                  {new Date(slot.slot_datetime).toLocaleString()}
                </td>
                <td className="py-2 font-mono">{slot.proxy_used || "-"}</td>
                <td className="py-2 font-mono text-xs">{slot.scraped_by_job || "-"}</td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-400">
                  No slots found yet. Run the scraper.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
