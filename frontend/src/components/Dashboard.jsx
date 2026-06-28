import { useEffect, useState } from "react";
import SessionList from "./SessionList";
import SlotViewer from "./SlotViewer";
import QuarantineViewer from "./QuarantineViewer";
import NotificationQueue from "./NotificationQueue";
import JobViewer from "./JobViewer";
import AnalyticsGraph from "./AnalyticsGraph";
import AuditLog from "./AuditLog";
import KillSwitch from "./KillSwitch";
import { getSummary, runScraper as runScraperApi, setAdminToken, clearAdminToken } from "../api";

function AdminLogin({ onAuthed }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setAdminToken(value.trim());
    try {
      await getSummary();
      onAuthed();
    } catch (err) {
      clearAdminToken();
      setError(err.response?.status === 401 ? "Invalid admin token." : (err.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-10 border rounded-lg bg-white shadow-sm">
      <h1 className="text-xl font-bold mb-1">Admin sign-in</h1>
      <p className="text-sm text-gray-500 mb-4">Enter the admin token to access the dashboard.</p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Admin token"
          className="w-full border rounded px-3 py-2"
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Checking\u2026" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function Dashboard() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [authed, setAuthed] = useState(null); // null = checking

  useEffect(() => {
    getSummary()
      .then(() => setAuthed(true))
      .catch((err) => {
        if (err.response?.status === 401 || err.response?.status === 503) setAuthed(false);
        else setAuthed(true); // network/other error: let the dashboard load and surface errors per-widget
      });
  }, []);

  async function runScraper() {
    setRunning(true);
    setMessage("");
    try {
      const data = await runScraperApi();
      const { slots_found, approved, quarantined, is_bot, risk_score } = data;
      setMessage(
        `Job complete: ${slots_found} slots found, ${approved || 0} approved, ${quarantined || 0} quarantined. ` +
        `Bot score: ${risk_score} (${is_bot ? "bot" : "human"}).`,
      );
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setRunning(false);
    }
  }

  function lock() {
    clearAdminToken();
    setAuthed(false);
  }

  if (authed === null) {
    return <div className="max-w-7xl mx-auto p-6 text-gray-500">Loading...</div>;
  }
  if (authed === false) {
    return <AdminLogin onAuthed={() => setAuthed(true)} />;
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Availo Dashboard</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={runScraper}
            disabled={running}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {running ? "Running..." : "Run Scraper Job"}
          </button>
          <button
            onClick={lock}
            className="border border-gray-300 hover:bg-gray-100 px-3 py-2 rounded text-sm"
            title="Clear the stored admin token"
          >
            Lock
          </button>
        </div>
      </header>

      <div className="mb-6">
        <KillSwitch />
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded text-sm ${
            /error|invalid|missing|failed/i.test(message)
              ? "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <AnalyticsGraph />
        <SlotViewer />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <QuarantineViewer />
        <NotificationQueue />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SessionList />
        <JobViewer />
      </div>

      <AuditLog />
    </div>
  );
}
