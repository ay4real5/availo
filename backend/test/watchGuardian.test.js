import test, { beforeEach } from "node:test";
import assert from "node:assert";

process.env.SCRAPER_API_KEY = "test-key";
process.env.DEV_STORE_PATH = ".test-store-watchguardian.json";
process.env.DISABLE_SPIKE_DETECTOR = "true";
process.env.DISABLE_WATCH_GUARDIAN = "true";

const fs = await import("node:fs");
const path = await import("node:path");
const testStore = path.resolve(".test-store-watchguardian.json");
if (fs.existsSync(testStore)) fs.unlinkSync(testStore);

// Importing app.js is what wires the real routers/config the same way the
// running server does; watchGuardian.js itself has no route dependency, but
// this keeps the module graph identical to production and matches how
// integration.test.js is set up.
await import("../src/app.js");
const { supabase } = await import("../src/lib/supabase.js");
const { checkStaleWatches } = await import("../src/lib/watchGuardian.js");

beforeEach(() => {
  supabase.reset();
});

function isoMinutesAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString();
}

async function makeUser() {
  const { data: user } = await supabase
    .from("users")
    .insert({ email: `guardian-${Date.now()}-${Math.random()}@example.com`, name: "Dana" })
    .select()
    .single();
  return user;
}

async function makeSession(userId, { status = "active", lastSeenMinsAgo = 10, centre = "Bury (Manchester)" } = {}) {
  const { data: session } = await supabase
    .from("watch_sessions")
    .insert({
      user_id: userId,
      status,
      test_centre: centre,
      last_seen_at: isoMinutesAgo(lastSeenMinsAgo),
    })
    .select()
    .single();
  return session;
}

async function staleAlertsFor(sessionId) {
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .eq("event_type", "watch_stale_alert_sent")
    .eq("entity_id", sessionId);
  return data ?? [];
}

test("checkStaleWatches: alerts once for a session silent past the threshold", async () => {
  const user = await makeUser();
  const session = await makeSession(user.id, { lastSeenMinsAgo: 10 });

  await checkStaleWatches();

  const alerts = await staleAlertsFor(session.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].payload.centre, "Bury (Manchester)");
});

test("checkStaleWatches: a fresh heartbeat is not alerted", async () => {
  const user = await makeUser();
  const session = await makeSession(user.id, { lastSeenMinsAgo: 1 });

  await checkStaleWatches();

  const alerts = await staleAlertsFor(session.id);
  assert.equal(alerts.length, 0);
});

test("checkStaleWatches: an ended session is never alerted, even if old", async () => {
  const user = await makeUser();
  const session = await makeSession(user.id, { status: "ended", lastSeenMinsAgo: 120 });

  await checkStaleWatches();

  const alerts = await staleAlertsFor(session.id);
  assert.equal(alerts.length, 0);
});

test("checkStaleWatches: does not re-alert an already-alerted episode", async () => {
  const user = await makeUser();
  const session = await makeSession(user.id, { lastSeenMinsAgo: 10 });

  await checkStaleWatches();
  await checkStaleWatches();

  const alerts = await staleAlertsFor(session.id);
  assert.equal(alerts.length, 1, "second run should not send a duplicate alert");
});

test("checkStaleWatches: alerts again after the heartbeat resumes and then goes stale a second time", async () => {
  const user = await makeUser();
  const session = await makeSession(user.id, { lastSeenMinsAgo: 15 });

  // Simulate an earlier stale episode that was already alerted on (backdated,
  // so we don't depend on real wall-clock time passing between test steps).
  await supabase.from("audit_log").insert({
    event_type: "watch_stale_alert_sent",
    entity_id: session.id,
    entity_type: "watch_session",
    actor: "system",
    created_at: isoMinutesAgo(20),
    payload: {},
  });

  // The heartbeat resumed at T-15 (after the T-20 alert) but has since gone
  // stale again (T-15 is well past the 5-minute threshold) — a new episode.
  await checkStaleWatches();

  const alerts = await staleAlertsFor(session.id);
  assert.equal(alerts.length, 2, "a new stale episode after recovery should alert again");
});
