import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import dotenv from "dotenv";

import { logger } from "./lib/logger.js";
import { supabase } from "./lib/supabase.js";
import { trackSession } from "./middleware/sessionTracker.js";
import { scraperAuth } from "./middleware/scraperAuth.js";
import { adminAuth } from "./middleware/adminAuth.js";
import { usersRouter } from "./routes/users.js";
import { authRouter } from "./routes/auth.js";
import { slotsRouter } from "./routes/slots.js";
import { sessionsRouter } from "./routes/sessions.js";
import { scraperRouter } from "./routes/scraper.js";
import { rulesRouter } from "./routes/rules.js";
import { notificationsRouter } from "./routes/notifications.js";
import { controlRouter } from "./routes/control.js";
import { metricsHandler } from "./lib/metrics.js";
import { startSpikeDetector } from "./lib/spikeDetector.js";
import { getAuditLog } from "./lib/audit.js";
import { runScraperForCentre } from "./routes/scraper.js";
import { sendSlotAlert } from "./lib/email.js";

dotenv.config();

const app = express();

app.use(helmet());

// CORS: in production, only allow origins from CORS_ORIGIN (comma-separated).
// Outside production we allow all origins for convenience.
const corsAllowlist = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === "production" && corsAllowlist.length === 0) {
  logger.warn("CORS_ORIGIN is not set in production — cross-origin requests will be blocked");
}
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / non-browser requests (no Origin header).
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (corsAllowlist.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json());
app.use(pinoHttp({ logger }));

// Track every request as a session.
app.use(trackSession);

const isRealDb = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Availo Backend API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #f8f9fa; color: #212529; }
    h1 { color: #1d70b8; border-bottom: 3px solid #1d70b8; padding-bottom: 10px; }
    .badge { display: inline-block; background: #00703c; color: white; border-radius: 4px; padding: 2px 10px; font-size: 13px; font-weight: bold; vertical-align: middle; margin-left: 8px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 30px; }
    th { background: #1d70b8; color: white; text-align: left; padding: 10px 14px; font-size: 13px; }
    td { padding: 10px 14px; border-bottom: 1px solid #e9ecef; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    a { color: #1d70b8; text-decoration: none; font-family: monospace; font-size: 13px; }
    a:hover { text-decoration: underline; }
    .method { font-family: monospace; font-size: 12px; font-weight: bold; padding: 2px 6px; border-radius: 3px; }
    .get { background: #cfe2ff; color: #084298; }
    .post { background: #d1e7dd; color: #0a3622; }
    .put { background: #fff3cd; color: #664d03; }
    .section { font-size: 12px; color: #6c757d; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 6px 14px; background: #f1f3f5; }
  </style>
</head>
<body>
  <h1>Availo Backend API <span class="badge">RUNNING</span></h1>
  <p>This is the backend API for the Availo driving test booking platform.</p>

  <table>
    <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
    <tr><td colspan="3" class="section">System</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/health">/health</a></td><td>Health check — database status</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/metrics">/metrics</a></td><td>Prometheus metrics</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/audit">/api/audit</a></td><td>Full audit log</td></tr>
    <tr><td colspan="3" class="section">Slots</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/slots">/api/slots</a></td><td>All available slots found by the scraper</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/slots/bookings">/api/slots/bookings</a></td><td>All confirmed bookings</td></tr>
    <tr><td><span class="method post">POST</span></td><td>/api/slots/report-centre</td><td>Scraper reports new slots (requires API key)</td></tr>
    <tr><td><span class="method post">POST</span></td><td>/api/slots/book</td><td>Record a confirmed booking (requires API key)</td></tr>
    <tr><td colspan="3" class="section">Scraper</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/scraper/jobs">/api/scraper/jobs</a></td><td>All scraper job history (requires API key)</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/scraper/centres">/api/scraper/centres</a></td><td>Test centres to scrape</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/admin/scrape?centre=Bolton">/api/admin/scrape?centre=Bolton</a></td><td>Trigger a single scrape from the browser</td></tr>
    <tr><td colspan="3" class="section">Notifications &amp; Quarantine</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/notifications/quarantine">/api/notifications/quarantine</a></td><td>Quarantined slots awaiting manual review</td></tr>
    <tr><td><span class="method post">POST</span></td><td>/api/notifications/quarantine/:id/release</td><td>Release a quarantined slot</td></tr>
    <tr><td><span class="method post">POST</span></td><td>/api/notifications/quarantine/:id/reject</td><td>Reject a quarantined slot</td></tr>
    <tr><td colspan="3" class="section">Rules &amp; Policy</td></tr>
    <tr><td><span class="method get">GET</span></td><td><a href="/api/rules/config">/api/rules/config</a></td><td>Current rule configuration</td></tr>
    <tr><td><span class="method post">POST</span></td><td>/api/rules/run</td><td>Run a rule against a payload</td></tr>
  </table>

  <p style="font-size:13px;color:#6c757d">
    Dashboard: <a href="http://localhost:3000">http://localhost:3000</a> &nbsp;|&nbsp;
    Mock DVSA: <a href="http://localhost:8000">http://localhost:8000</a>
  </p>
</body>
</html>`);
});

app.get("/health", async (_req, res) => {
  const { error } = await supabase.from("users").select("id").limit(1);
  res.status(error ? 503 : 200).json({
    status: error ? "error" : "ok",
    store: error ? "unreachable" : isRealDb ? "supabase" : "dev-store",
  });
});

app.get("/metrics", metricsHandler);

app.get("/api/audit", adminAuth, async (req, res, next) => {
  try {
    const result = await getAuditLog({
      eventType: req.query.event_type,
      entityId: req.query.entity_id,
      entityType: req.query.entity_type,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/api/admin/test-email", adminAuth, async (req, res, next) => {
  try {
    const to = req.query.to || "delivered@resend.dev";
    const result = await sendSlotAlert({
      to,
      userName: "Test User",
      centre: "Bolton",
      slots: [
        { slot_datetime: new Date(Date.now() + 86400000 * 5).toISOString() },
        { slot_datetime: new Date(Date.now() + 86400000 * 7).toISOString() },
      ],
    });
    res.json({ result, to });
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authRouter);
app.use("/api/users", adminAuth, usersRouter);
app.use("/api/slots", slotsRouter);
app.use("/api/sessions", sessionsRouter);
app.get("/api/admin/scrape", adminAuth, async (req, res, next) => {
  try {
    const centre = req.query.centre || "Bolton";
    const result = await runScraperForCentre(
      `${req.protocol}://${req.get("host")}`,
      centre,
      req.sessionId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});
// Auth is applied per-route inside scraperRouter: read-only jobs/centres are
// public (admin dashboard), while booking-requests (payment tokens), job writes,
// heartbeat and the manual run trigger require the scraper key.
app.use("/api/scraper", scraperRouter);
app.use("/api/rules", rulesRouter);
app.use("/api/notifications", adminAuth, notificationsRouter);
app.use("/api/control", controlRouter);

startSpikeDetector();

app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

export { app };
