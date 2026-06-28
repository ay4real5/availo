import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const counters = {
  slotsDiscovered: new client.Counter({
    name: "slots_discovered_total",
    help: "Total number of discovered slots reported by scrapers",
    labelNames: ["test_centre"],
    registers: [register],
  }),
  slotsQuarantined: new client.Counter({
    name: "slots_quarantined_total",
    help: "Total number of slots quarantined by the rules engine",
    labelNames: ["test_centre"],
    registers: [register],
  }),
  slotsApproved: new client.Counter({
    name: "slots_approved_total",
    help: "Total number of slots approved for notification",
    labelNames: ["test_centre"],
    registers: [register],
  }),
  scraperJobs: new client.Counter({
    name: "scraper_jobs_total",
    help: "Total number of scraper jobs processed",
    labelNames: ["test_centre", "status"],
    registers: [register],
  }),
  notificationsQueued: new client.Counter({
    name: "notifications_queued_total",
    help: "Total number of notifications queued",
    registers: [register],
  }),
};

export async function metricsHandler(_req, res) {
  res.set("Content-Type", register.contentType);
  try {
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (err) {
    res.status(500).send(err.message);
  }
}
