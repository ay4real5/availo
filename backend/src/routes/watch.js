import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logAudit } from "../lib/audit.js";
import { sendSlotAlert } from "../lib/email.js";
import { requireAuth } from "./auth.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";

// This router never talks to DVSA itself. It only records what the user's own
// Chrome extension observed and did in their own browser tab (see
// chrome-extension/watch-content.js) and, if they're not actively watching when
// a slot appears, sends a backup email nudging them to come back and look.

export const watchRouter = Router();

const STALE_AFTER_MS = 2 * 60 * 1000;

const startSchema = z.object({
  centre: z.string().min(1),
  target_date: z.string().datetime().optional().nullable(),
  tab_url: z.string().optional().nullable(),
  extension_version: z.string().optional().nullable(),
});

async function loadOwnedSession(id, userId) {
  const { data: session } = await supabase.from("watch_sessions").select("*").eq("id", id).single();
  if (!session || session.user_id !== userId) return null;
  return session;
}

watchRouter.post("/sessions", requireAuth, async (req, res, next) => {
  try {
    const body = startSchema.parse(req.body);
    const { data: session, error } = await supabase
      .from("watch_sessions")
      .insert({
        user_id: req.userId,
        status: "active",
        test_centre: body.centre,
        target_date: body.target_date || null,
        tab_url: body.tab_url || null,
        extension_version: body.extension_version || null,
      })
      .select()
      .single();
    if (error) throw error;

    await logAudit("watch_session_started", {
      entityId: session.id,
      entityType: "watch_session",
      actor: "user",
      payload: { user_id: req.userId, centre: body.centre },
    });

    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

watchRouter.post("/sessions/:id/heartbeat", requireAuth, async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req.params.id, req.userId);
    if (!session) return res.status(404).json({ error: "watch_session_not_found" });

    const { data, error } = await supabase
      .from("watch_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", session.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

watchRouter.post("/sessions/:id/stop", requireAuth, async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req.params.id, req.userId);
    if (!session) return res.status(404).json({ error: "watch_session_not_found" });

    if (session.status === "ended") return res.json(session);

    const { data, error } = await supabase
      .from("watch_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", session.id)
      .select()
      .single();
    if (error) throw error;

    await logAudit("watch_session_stopped", {
      entityId: session.id,
      entityType: "watch_session",
      actor: "user",
      payload: { user_id: req.userId },
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

watchRouter.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("watch_sessions")
      .select("*")
      .eq("user_id", req.userId)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    const now = Date.now();
    const sessions = (data ?? []).map((s) => ({
      ...s,
      is_stale: s.status === "active" && now - new Date(s.last_seen_at).getTime() > STALE_AFTER_MS,
    }));

    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

watchRouter.get("/alerts", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("entity_id", req.userId)
      .eq("entity_type", "user")
      .in("event_type", ["watch_backup_alert_sent", "extension_slot_detected"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ alerts: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => `watch-events:${req.userId || clientIp(req)}`,
  message: "Too many watch events. Please slow down.",
});

const eventSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_type: z.literal("slot_detected"),
    watch_session_id: z.string().uuid(),
    test_centre: z.string().min(1),
    slot_datetime: z.string().datetime(),
    page_url: z.string().optional().nullable(),
    detail: z.record(z.any()).optional(),
  }),
  z.object({
    event_type: z.literal("hold_clicked"),
    watch_session_id: z.string().uuid(),
    slot_id: z.string().uuid().optional().nullable(),
    test_centre: z.string().min(1),
    slot_datetime: z.string().datetime(),
  }),
  z.object({
    event_type: z.literal("hold_result"),
    watch_session_id: z.string().uuid(),
    slot_id: z.string().uuid().optional().nullable(),
    outcome: z.enum(["attempted", "unknown", "error"]),
    message: z.string().optional().nullable(),
  }),
  z.object({
    event_type: z.literal("blocked"),
    watch_session_id: z.string().uuid(),
    reason: z.string().optional().nullable(),
    page_url: z.string().optional().nullable(),
  }),
]);

async function sendBackupAlertIfDue(user, testCentre, slot) {
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("centre, notify_email")
    .eq("user_id", user.id)
    .single();

  if (!prefs || !prefs.notify_email || prefs.centre !== testCentre) return;

  // Shared dedupe window with the scraper's own alert path: a user watching AND
  // being scraped for the same centre should still only get one email per window.
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recentAlerts } = await supabase
    .from("audit_log")
    .select("id")
    .in("event_type", ["watch_backup_alert_sent", "slot_alert_sent"])
    .eq("entity_id", user.id)
    .gt("created_at", thirtyMinsAgo)
    .limit(1);

  if (recentAlerts && recentAlerts.length > 0) return;

  let emailResult = { skipped: true };
  try {
    emailResult = await sendSlotAlert({
      to: user.email,
      userName: user.name,
      centre: testCentre,
      slots: [slot],
    });
  } catch (sendErr) {
    console.error(`[watch] Resend error for ${user.email}:`, sendErr.message);
    emailResult = { error: sendErr.message };
  }

  await logAudit("watch_backup_alert_sent", {
    entityId: user.id,
    entityType: "user",
    actor: "system",
    payload: {
      centre: testCentre,
      slot_datetime: slot.slot_datetime,
      email_id: emailResult.id || null,
      error: emailResult.error || null,
    },
  });
}

watchRouter.post("/events", requireAuth, eventsLimiter, async (req, res, next) => {
  try {
    const event = eventSchema.parse(req.body);
    const session = await loadOwnedSession(event.watch_session_id, req.userId);
    if (!session) return res.status(404).json({ error: "watch_session_not_found" });

    if (event.event_type === "slot_detected") {
      const { data: slot, error } = await supabase
        .from("available_slots")
        .insert({
          user_id: req.userId,
          test_centre: event.test_centre,
          slot_datetime: event.slot_datetime,
          status: "approved",
          watch_session_id: session.id,
          source_meta: { origin: "extension", page_url: event.page_url || null, detail: event.detail || {} },
        })
        .select()
        .single();
      if (error) throw error;

      await logAudit("extension_slot_detected", {
        entityId: req.userId,
        entityType: "user",
        actor: "user",
        payload: { slot_id: slot.id, centre: event.test_centre, slot_datetime: event.slot_datetime },
      });

      const { data: user } = await supabase
        .from("users")
        .select("id, email, name")
        .eq("id", req.userId)
        .single();
      if (user) {
        try {
          await sendBackupAlertIfDue(user, event.test_centre, slot);
        } catch (alertErr) {
          console.error("[watch] backup alert flow error:", alertErr.message);
        }
      }

      return res.status(201).json({ slot_id: slot.id });
    }

    if (event.event_type === "hold_clicked") {
      await logAudit("extension_hold_clicked", {
        entityId: req.userId,
        entityType: "user",
        actor: "user",
        payload: {
          slot_id: event.slot_id || null,
          centre: event.test_centre,
          slot_datetime: event.slot_datetime,
        },
      });
      return res.status(201).json({ ok: true });
    }

    if (event.event_type === "hold_result") {
      if (event.slot_id) {
        await supabase.from("available_slots").update({ status: "hold_attempted" }).eq("id", event.slot_id);
      }
      await logAudit("extension_hold_result", {
        entityId: req.userId,
        entityType: "user",
        actor: "user",
        payload: { slot_id: event.slot_id || null, outcome: event.outcome, message: event.message || null },
      });
      return res.status(201).json({ ok: true });
    }

    // blocked
    await logAudit("extension_blocked", {
      entityId: req.userId,
      entityType: "user",
      actor: "user",
      payload: { reason: event.reason || null, page_url: event.page_url || null },
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
