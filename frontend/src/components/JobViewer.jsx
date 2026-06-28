import { useEffect, useState } from "react";
import axios from "axios";

export default function JobViewer() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    async function load() {
      const res = await axios.get("/api/scraper/jobs", {
        headers: { "x-scraper-key": "dev-scraper-key" },
      });
      setJobs(res.data.jobs || []);
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4">Scraper Jobs</h2>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2">Centre</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Proxy</th>
              <th className="pb-2">Slots</th>
              <th className="pb-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b last:border-0">
                <td className="py-2">{job.test_centre}</td>
                <td className="py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      job.status === "success"
                        ? "bg-green-100 text-green-700"
                        : job.status === "blocked"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {job.status}
                  </span>
                </td>
                <td className="py-2 font-mono">{job.proxy_used || "-"}</td>
                <td className="py-2">{job.slots_found}</td>
                <td className="py-2 text-red-600 text-xs">{job.error || "-"}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-400">
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
