import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import request from "supertest";

process.env.SCRAPER_API_KEY = "test-key";
process.env.DEV_STORE_PATH = ".test-store.json";
process.env.DISABLE_SPIKE_DETECTOR = "true";

const fs = await import("node:fs");
const path = await import("node:path");
const testStore = path.resolve(".test-store.json");
if (fs.existsSync(testStore)) fs.unlinkSync(testStore);

const rulesConfigPath = path.resolve("config/rules.json");
const originalRules = fs.readFileSync(rulesConfigPath, "utf8");
const policiesPath = path.resolve("config/policies.json");
if (fs.existsSync(policiesPath)) fs.unlinkSync(policiesPath);

const { app } = await import("../src/app.js");
const { supabase } = await import("../src/lib/supabase.js");
const { reloadConfig } = await import("../src/lib/ruleEngine.js");

beforeEach(() => {
  supabase.reset();
  reloadConfig();
});

after(() => {
  fs.writeFileSync(rulesConfigPath, originalRules);
  if (fs.existsSync(policiesPath)) fs.unlinkSync(policiesPath);
  if (fs.existsSync(testStore)) fs.unlinkSync(testStore);
});

test("GET /health returns ok", async () => {
  const res = await request(app).get("/health").expect(200);
  assert.equal(res.body.status, "ok");
});

test("POST /api/users creates a user", async () => {
  const res = await request(app)
    .post("/api/users")
    .send({ email: "demo@example.com", name: "Demo" })
    .expect(201);
  assert.equal(res.body.email, "demo@example.com");
});

test("POST /api/scraper/jobs creates a job", async () => {
  const res = await request(app)
    .post("/api/scraper/jobs")
    .set("x-scraper-key", "test-key")
    .send({ test_centre: "Bolton", proxy_used: "residential-1" })
    .expect(201);
  assert.equal(res.body.test_centre, "Bolton");
  assert.equal(res.body.status, "running");
});

test("POST /api/slots/report-centre saves slots with provenance", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({
    id: userId,
    email: "u@example.com",
    current_test_date: "2026-12-01T09:00:00.000Z",
  });

  const res = await request(app)
    .post("/api/slots/report-centre")
    .set("x-scraper-key", "test-key")
    .set("x-scraper-job-id", "job-123")
    .set("x-proxy-used", "proxy-1")
    .set("x-ip-used", "1.2.3.4")
    .send({ test_centre: "Bolton", slots: ["2026-11-15T10:00:00.000Z"] })
    .expect(201);

  assert.equal(res.body.inserted, 1);
  assert.equal(res.body.slots, 1);
  assert.equal(res.body.approved, 1);
  assert.equal(res.body.quarantined, 0);

  const { data: slots } = await supabase
    .from("available_slots")
    .select("*")
    .eq("user_id", userId);
  assert.equal(slots[0].proxy_used, "proxy-1");
  assert.equal(slots[0].scraped_by_job, "job-123");
  assert.equal(slots[0].status, "approved");

  const { data: notifications } = await supabase
    .from("notification_queue")
    .select("slot_id, status")
    .eq("slot_id", slots[0].id);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].status, "pending");
});

test("GET /api/sessions returns tracked sessions", async () => {
  await request(app).get("/health").expect(200);
  const res = await request(app).get("/api/sessions").expect(200);
  assert.ok(Array.isArray(res.body.sessions));
  assert.ok(res.body.sessions.length > 0);
});

test("POST /api/rules/run flags bot behaviour", async () => {
  const res = await request(app)
    .post("/api/rules/run")
    .send({
      rule: "detect_bot",
      payload: {
        ip: "1.2.3.4",
        ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (HeadlessChrome)",
        requests_per_minute: 150,
        visited_trap_page: true,
      },
    })
    .expect(200);
  assert.equal(res.body.is_bot, true);
  assert.ok(res.body.risk_score >= 60);
  assert.ok(res.body.reasons.includes("Visited honeypot"));
});

test("POST /api/rules/run flags early slot", async () => {
  const res = await request(app)
    .post("/api/rules/run")
    .send({
      rule: "flag_early_slot",
      payload: {
        slot_datetime: "2026-11-01T10:00:00.000Z",
        current_test_date: "2026-12-01T09:00:00.000Z",
      },
    })
    .expect(200);
  assert.equal(res.body.is_early, true);
  assert.ok(res.body.risk_score > 0);
  assert.equal(res.body.action, "notify");
});

test("Slot with high bot score is quarantined", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({ id: userId, email: "q@example.com" });

  const res = await request(app)
    .post("/api/slots/report-centre")
    .set("x-scraper-key", "test-key")
    .set("x-rpm", "200")
    .set("x-visited-trap", "true")
    .send({ test_centre: "Bolton", slots: ["2026-11-15T10:00:00.000Z"] })
    .expect(201);

  assert.equal(res.body.quarantined, 1);
  assert.equal(res.body.approved, 0);

  const { data: slots } = await supabase
    .from("available_slots")
    .select("status")
    .eq("user_id", userId);
  assert.equal(slots[0].status, "quarantined");
});

test("POST /api/scraper/heartbeat records liveness", async () => {
  const res = await request(app)
    .post("/api/scraper/heartbeat")
    .set("x-scraper-key", "test-key")
    .send({ worker_id: "test-worker" })
    .expect(200);
  assert.equal(res.body.ok, true);
});

test("GET /metrics exposes Prometheus counters", async () => {
  const res = await request(app).get("/metrics").expect(200);
  assert.ok(res.text.includes("slots_discovered_total"));
  assert.ok(res.text.includes("slots_quarantined_total"));
  assert.ok(res.text.includes("slots_approved_total"));
  assert.ok(res.text.includes("scraper_jobs_total"));
  assert.ok(res.text.includes("notifications_queued_total"));
});

test("Manual release of quarantined slot queues a notification", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({ id: userId, email: "release@example.com" });

  const report = await request(app)
    .post("/api/slots/report-centre")
    .set("x-scraper-key", "test-key")
    .set("x-rpm", "200")
    .set("x-visited-trap", "true")
    .send({ test_centre: "Bolton", slots: ["2026-11-15T10:00:00.000Z"] })
    .expect(201);

  const slotId = report.body.ids[0];
  assert.ok(slotId);

  const release = await request(app)
    .post(`/api/notifications/quarantine/${slotId}/release`)
    .send({ reason: "Looks legitimate" })
    .expect(200);

  assert.equal(release.body.released, true);

  const { data: slots } = await supabase.from("available_slots").select("status").eq("id", slotId);
  assert.equal(slots[0].status, "approved");
});

test("Policy snapshot and rollback work", async () => {
  const snapshot = await request(app)
    .post("/api/rules/policies/snapshot")
    .send({ note: "before change" })
    .expect(200);
  assert.equal(snapshot.body.note, "before change");
  assert.ok(snapshot.body.id);

  // Create a second snapshot so rollback has a previous version to restore.
  await request(app)
    .post("/api/rules/policies/snapshot")
    .send({ note: "second snapshot" })
    .expect(200);

  await request(app)
    .post("/api/rules/config")
    .send({ quarantineThreshold: 99 })
    .expect(200);

  const rollback = await request(app).post("/api/rules/policies/rollback").expect(200);
  assert.ok(rollback.body.id);

  const config = await request(app).get("/api/rules/config").expect(200);
  assert.equal(config.body.quarantineThreshold, 60);
});

test("Audit log records quarantine and release decisions", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({ id: userId, email: "audit@example.com" });

  const report = await request(app)
    .post("/api/slots/report-centre")
    .set("x-scraper-key", "test-key")
    .set("x-rpm", "200")
    .set("x-visited-trap", "true")
    .send({ test_centre: "Bolton", slots: ["2026-11-15T10:00:00.000Z"] })
    .expect(201);

  const slotId = report.body.ids[0];

  await request(app)
    .post(`/api/notifications/quarantine/${slotId}/release`)
    .send({ reason: "Audit test" })
    .expect(200);

  const audit = await request(app)
    .get("/api/audit")
    .query({ entity_id: slotId })
    .expect(200);

  assert.ok(audit.body.logs.length >= 2);
  const events = audit.body.logs.map((l) => l.event_type);
  assert.ok(events.includes("slot_quarantined"));
  assert.ok(events.includes("slot_released"));
});

test("Manual reject of quarantined slot marks it rejected", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({ id: userId, email: "reject@example.com" });

  const report = await request(app)
    .post("/api/slots/report-centre")
    .set("x-scraper-key", "test-key")
    .set("x-rpm", "200")
    .set("x-visited-trap", "true")
    .send({ test_centre: "Bolton", slots: ["2026-11-15T10:00:00.000Z"] })
    .expect(201);

  const slotId = report.body.ids[0];
  assert.ok(slotId);

  const reject = await request(app)
    .post(`/api/notifications/quarantine/${slotId}/reject`)
    .send({ reason: "Confirmed bot" })
    .expect(200);

  assert.equal(reject.body.rejected, true);

  const { data: slots } = await supabase.from("available_slots").select("status").eq("id", slotId);
  assert.equal(slots[0].status, "rejected");
});

test("GET /api/control defaults to running", async () => {
  const res = await request(app).get("/api/control").expect(200);
  assert.equal(res.body.scraper.paused, false);
});

test("POST /api/control pauses and resumes, with audit entries", async () => {
  const pause = await request(app)
    .post("/api/control")
    .send({ paused: true, actor: "tester" })
    .expect(200);
  assert.equal(pause.body.scraper.paused, true);
  assert.equal(pause.body.scraper.actor, "tester");

  const afterPause = await request(app).get("/api/control").expect(200);
  assert.equal(afterPause.body.scraper.paused, true);

  const resume = await request(app)
    .post("/api/control")
    .send({ paused: false, actor: "tester" })
    .expect(200);
  assert.equal(resume.body.scraper.paused, false);

  const audit = await request(app)
    .get("/api/audit")
    .query({ entity_type: "scraper_control" })
    .expect(200);
  const events = audit.body.logs.map((l) => l.event_type);
  assert.ok(events.includes("scraper_paused"));
  assert.ok(events.includes("scraper_resumed"));
});

test("POST /api/control rejects an invalid body", async () => {
  await request(app).post("/api/control").send({}).expect(400);
});

test("GET /api/scraper/jobs is reachable by the dashboard (admin, open in dev)", async () => {
  await request(app).get("/api/scraper/jobs").expect(200);
});

test("admin endpoints enforce ADMIN_TOKEN when configured", async () => {
  process.env.ADMIN_TOKEN = "s3cret-admin";
  try {
    await request(app).get("/api/sessions/analytics/summary").expect(401);
    await request(app)
      .get("/api/sessions/analytics/summary")
      .set("x-admin-token", "s3cret-admin")
      .expect(200);
    // The kill-switch toggle is admin-only.
    await request(app).post("/api/control").send({ paused: true }).expect(401);
    await request(app)
      .post("/api/control")
      .set("x-admin-token", "s3cret-admin")
      .send({ paused: true })
      .expect(200);
  } finally {
    delete process.env.ADMIN_TOKEN;
  }
});

test("admin endpoints fail closed in production without ADMIN_TOKEN", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.ADMIN_TOKEN;
  try {
    await request(app).get("/api/sessions/analytics/summary").expect(503);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("GET /api/scraper/booking-requests requires the scraper key", async () => {
  await request(app)
    .get("/api/scraper/booking-requests")
    .query({ centre: "Bolton" })
    .expect(401);

  await request(app)
    .get("/api/scraper/booking-requests")
    .query({ centre: "Bolton" })
    .set("x-scraper-key", "test-key")
    .expect(200);
});

test("POST /api/slots/book creates a confirmed booking", async () => {
  const userId = crypto.randomUUID();
  await supabase.from("users").insert({ id: userId, email: "book@example.com" });

  const slotDatetime = "2026-11-20T14:00:00.000Z";
  await supabase.from("available_slots").insert({
    user_id: userId,
    test_centre: "Bolton",
    slot_datetime: slotDatetime,
    status: "approved",
  });

  const res = await request(app)
    .post("/api/slots/book")
    .set("x-scraper-key", "test-key")
    .send({
      test_centre: "Bolton",
      slot_datetime: slotDatetime,
      booking_reference: "REF-123456",
      scraped_by_job: "job-abc",
    })
    .expect(201);

  assert.equal(res.body.booking.status, "confirmed");
  assert.equal(res.body.booking.booking_reference, "REF-123456");

  const bookings = await request(app).get("/api/slots/bookings").expect(200);
  assert.equal(bookings.body.bookings.length, 1);
  assert.equal(bookings.body.bookings[0].test_centre, "Bolton");

  const { data: slots } = await supabase
    .from("available_slots")
    .select("status")
    .eq("test_centre", "Bolton")
    .eq("slot_datetime", slotDatetime);
  assert.equal(slots[0].status, "booked");
});

async function registerUser(email) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "password123", name: "Watch Tester" })
    .expect(201);
  return res.body.token;
}

test("POST /api/watch/sessions requires auth", async () => {
  await request(app).post("/api/watch/sessions").send({ centre: "Bolton" }).expect(401);
});

test("POST /api/watch/sessions starts a session for the caller", async () => {
  const token = await registerUser("watch1@example.com");
  const res = await request(app)
    .post("/api/watch/sessions")
    .set("Authorization", `Bearer ${token}`)
    .send({ centre: "Bolton" })
    .expect(201);
  assert.equal(res.body.status, "active");
  assert.equal(res.body.test_centre, "Bolton");
});

test("POST /api/watch/events slot_detected creates a slot, logs audit, and records the alert attempt", async () => {
  const token = await registerUser("watch2@example.com");
  const session = await request(app)
    .post("/api/watch/sessions")
    .set("Authorization", `Bearer ${token}`)
    .send({ centre: "Bolton" })
    .expect(201);

  const event = await request(app)
    .post("/api/watch/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      event_type: "slot_detected",
      watch_session_id: session.body.id,
      test_centre: "Bolton",
      slot_datetime: "2026-11-15T10:00:00.000Z",
    })
    .expect(201);

  assert.ok(event.body.slot_id);

  const { data: slots } = await supabase
    .from("available_slots")
    .select("*")
    .eq("id", event.body.slot_id);
  assert.equal(slots[0].status, "approved");
  assert.equal(slots[0].source_meta.origin, "extension");
  assert.equal(slots[0].watch_session_id, session.body.id);

  const audit = await request(app)
    .get("/api/audit")
    .query({ event_type: "extension_slot_detected" })
    .expect(200);
  assert.ok(audit.body.logs.length >= 1);
});

test("POST /api/watch/events slot_detected dedupes backup alerts within 30 minutes", async () => {
  const token = await registerUser("watch3@example.com");
  await request(app)
    .post("/api/auth/preferences")
    .set("Authorization", `Bearer ${token}`)
    .send({ centre: "Bolton", notify_email: true })
    .expect(200);
  const session = await request(app)
    .post("/api/watch/sessions")
    .set("Authorization", `Bearer ${token}`)
    .send({ centre: "Bolton" })
    .expect(201);

  await request(app)
    .post("/api/watch/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      event_type: "slot_detected",
      watch_session_id: session.body.id,
      test_centre: "Bolton",
      slot_datetime: "2026-11-15T10:00:00.000Z",
    })
    .expect(201);

  await request(app)
    .post("/api/watch/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      event_type: "slot_detected",
      watch_session_id: session.body.id,
      test_centre: "Bolton",
      slot_datetime: "2026-11-16T10:00:00.000Z",
    })
    .expect(201);

  const audit = await request(app)
    .get("/api/audit")
    .query({ event_type: "watch_backup_alert_sent" })
    .expect(200);
  assert.equal(audit.body.logs.length, 1);
});

test("watch session endpoints reject access to another user's session", async () => {
  const tokenA = await registerUser("watch4a@example.com");
  const tokenB = await registerUser("watch4b@example.com");

  const session = await request(app)
    .post("/api/watch/sessions")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ centre: "Bolton" })
    .expect(201);

  await request(app)
    .post(`/api/watch/sessions/${session.body.id}/stop`)
    .set("Authorization", `Bearer ${tokenB}`)
    .expect(404);

  await request(app)
    .post("/api/watch/events")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      event_type: "hold_clicked",
      watch_session_id: session.body.id,
      test_centre: "Bolton",
      slot_datetime: "2026-11-15T10:00:00.000Z",
    })
    .expect(404);
});
