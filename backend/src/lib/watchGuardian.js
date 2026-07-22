import { supabase } from "./supabase.js";
import { logAudit } from "./audit.js";
import { sendWatchStoppedEmail } from "./email.js";
import { sendPushToUser } from "./push.js";
import { logger } from "./logger.js";

// Watch Guardian — the missing half of "leave it running and trust it".
//
// The extension heartbeats its watch_sessions row every ~1 minute
// (chrome-extension/background.js, chrome.alarms "watch-tick") for as long as
// the tab is open, even backgrounded. If the heartbeat goes quiet — the
// laptop slept, WiFi dropped, Chrome was closed, the tab was closed — nothing
// previously noticed: `is_stale` (routes/watch.js) was only ever computed
// on-demand when something called GET /sessions. This module proactively
// checks for that instead, and tells the user by email + push, the same way
// sendSignedOutAlertIfDue already does for the "DVSA signed me out" case.
//
// Entirely server-side, but it never talks to DVSA — it only reads Availo's
// own watch_sessions table and notifies the user.

const CHECK_INTERVAL_MS = 60 * 1000;
// More forgiving than the UI's 2-minute `is_stale` badge (routes/watch.js) —
// this is what actually emails/pushes the user, so it should tolerate a
// couple of missed ticks before concluding the watch really has died.
const GUARDIAN_STALE_MS = 5 * 60 * 1000;

// One alert per stale episode: skip if a watch_stale_alert_sent audit row
// already exists for this session with created_at AFTER its last_seen_at —
// i.e. we already alerted since the last real heartbeat. If the heartbeat
// later resumes and then goes quiet again, that's a new episode and alerts
// again.
async function alreadyAlertedSinceLastHeartbeat(session) {
  const { data } = await supabase
    .from("audit_log")
    .select("id, created_at")
    .eq("event_type", "watch_stale_alert_sent")
    .eq("entity_id", session.id)
    .gt("created_at", session.last_seen_at)
    .limit(1);
  return Boolean(data && data.length > 0);
}

async function alertStaleSession(session) {
  const { data: user } = await supabase
    .from("users")
    .select("id, email, name")
    .eq("id", session.user_id)
    .single();
  if (!user) return;

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("notify_email")
    .eq("user_id", user.id)
    .single();

  const centre = session.test_centre || "your test centre";
  const minutesSilent = Math.round((Date.now() - new Date(session.last_seen_at).getTime()) / 60000);

  let emailResult = { skipped: true };
  if (!prefs || prefs.notify_email !== false) {
    try {
      emailResult = await sendWatchStoppedEmail({ to: user.email, userName: user.name, centre });
    } catch (sendErr) {
      logger.error({ err: sendErr.message }, "[watchGuardian] email send failed");
      emailResult = { error: sendErr.message };
    }
  }

  const pushResult = await sendPushToUser(user.id, {
    title: `Availo stopped watching ${centre}`,
    body: "It hasn't checked in for a few minutes — your laptop may have slept or lost connection. Reopen the tab to keep watching.",
    url: "https://www.gov.uk/change-driving-test",
  });

  await logAudit("watch_stale_alert_sent", {
    entityId: session.id,
    entityType: "watch_session",
    actor: "system",
    payload: {
      user_id: user.id,
      centre,
      minutes_silent: minutesSilent,
      email_id: emailResult.id || null,
      email_error: emailResult.error || null,
      push_sent: pushResult.sent,
      push_total: pushResult.total,
    },
  });
}

export async function checkStaleWatches() {
  try {
    const { data: active, error } = await supabase
      .from("watch_sessions")
      .select("*")
      .eq("status", "active");
    if (error) throw error;

    const cutoff = Date.now() - GUARDIAN_STALE_MS;
    const stale = (active ?? []).filter((s) => new Date(s.last_seen_at).getTime() < cutoff);

    for (const session of stale) {
      try {
        if (await alreadyAlertedSinceLastHeartbeat(session)) continue;
        await alertStaleSession(session);
      } catch (sessionErr) {
        logger.error({ err: sessionErr.message, sessionId: session.id }, "[watchGuardian] failed to alert one session");
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, "Watch Guardian check failed");
  }
}

export function startWatchGuardian() {
  if (process.env.DISABLE_WATCH_GUARDIAN === "true") {
    logger.info("Watch Guardian disabled");
    return;
  }

  logger.info({ staleAfterMs: GUARDIAN_STALE_MS }, "Starting Watch Guardian");

  // Run immediately on startup, then every minute — same shape as the
  // quarantine spike detector (lib/spikeDetector.js).
  checkStaleWatches();
  const interval = setInterval(checkStaleWatches, CHECK_INTERVAL_MS);

  process.on("SIGTERM", () => clearInterval(interval));
  process.on("SIGINT", () => clearInterval(interval));
}
