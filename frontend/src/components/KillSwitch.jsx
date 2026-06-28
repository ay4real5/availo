import { useEffect, useState } from "react";
import { getControl, setControl } from "../api";

export default function KillSwitch() {
  const [paused, setPaused] = useState(null);
  const [meta, setMeta] = useState({ actor: null, updated_at: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await getControl();
      setPaused(Boolean(data.scraper?.paused));
      setMeta({ actor: data.scraper?.actor, updated_at: data.scraper?.updated_at });
      setError("");
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function toggle() {
    const next = !paused;
    if (next && !window.confirm("Pause ALL scraper workers? In-flight runs stop at the next check; new runs are skipped.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await setControl(next);
      setPaused(Boolean(data.scraper?.paused));
      setMeta({ actor: data.scraper?.actor, updated_at: data.scraper?.updated_at });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  const loading = paused === null;
  const dotColor = loading ? "bg-gray-400" : paused ? "bg-red-500" : "bg-green-500";
  const statusText = loading ? "Loading…" : paused ? "PAUSED" : "Running";

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border p-4 ${
        paused ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"
      }`}
    >
      <span className={`inline-block h-3 w-3 rounded-full ${dotColor} ${!loading && !paused ? "animate-pulse" : ""}`} />
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-800">
          Scraper status: <span className={paused ? "text-red-700" : "text-green-700"}>{statusText}</span>
        </div>
        <div className="text-xs text-gray-500">
          {error
            ? error
            : meta.updated_at
              ? `Last change by ${meta.actor || "system"} · ${new Date(meta.updated_at).toLocaleString()}`
              : "No changes yet"}
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={busy || loading}
        className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
          paused ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
        }`}
      >
        {busy ? "Saving…" : paused ? "Resume workers" : "Pause all workers"}
      </button>
    </div>
  );
}
