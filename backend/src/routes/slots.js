import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { processSlot } from "../lib/notifications.js";
import { counters } from "../lib/metrics.js";
import { sendSlotAlert } from "../lib/email.js";
import { logAudit } from "../lib/audit.js";
import { scraperAuth } from "../middleware/scraperAuth.js";
import { adminAuth } from "../middleware/adminAuth.js";

export const slotsRouter = Router();

const reportCentreSchema = z.object({
  test_centre: z.string().min(1),
  slots: z.array(z.string().datetime()).min(1),
});

function buildSlotMeta(req) {
  return {
    scraped_by_job: req.get("x-scraper-job-id") || null,
    proxy_used: req.get("x-proxy-used") || null,
    ip_used: req.get("x-ip-used") || req.sessionMeta?.ip || null,
    session_id: req.sessionId ?? null,
    user_agent: req.sessionMeta?.userAgent ?? null,
    requests_per_minute: parseInt(req.get("x-rpm") || "0", 10) || 0,
    visited_trap_page: req.get("x-visited-trap") === "true",
  };
}

slotsRouter.post("/report-centre", scraperAuth, async (req, res, next) => {
  try {
    const { test_centre, slots } = reportCentreSchema.parse(req.body);
    const meta = buildSlotMeta(req);

    const { data: users } = await supabase.from("users").select("id, email, name, current_test_date");

    const inserted = [];
    const processed = [];

    // Track which users got newly-approved slots this run (for batched email)
    const approvedByUser = new Map();

    for (const slot of slots) {
      for (const user of users) {
        const { data, error } = await supabase
          .from("available_slots")
          .insert({
            user_id: user.id,
            test_centre,
            slot_datetime: slot,
            status: "pending",
            scraped_by_job: meta.scraped_by_job,
            proxy_used: meta.proxy_used,
            session_id: meta.session_id,
            source_meta: meta,
          })
          .select()
          .single();
        if (error) continue;
        inserted.push(data);

        counters.slotsDiscovered.inc({ test_centre });

        const result = await processSlot(
          { ...data, current_test_date: user.current_test_date },
          meta,
        );
        processed.push({ slot_id: data.id, status: result.status });

        if (result.status === "approved") {
          counters.slotsApproved.inc({ test_centre });
          if (!approvedByUser.has(user.id)) {
            approvedByUser.set(user.id, { user, slots: [] });
          }
          approvedByUser.get(user.id).slots.push(data);
        } else if (result.status === "quarantined") {
          counters.slotsQuarantined.inc({ test_centre });
        }
      }
    }

    // Send one batched email per user that has newly approved slots
    // Check user preferences: only email if their alert centre matches
    for (const { user, slots: userSlots } of approvedByUser.values()) {
      try {
        const { data: prefs } = await supabase
          .from("user_preferences")
          .select("centre, notify_email")
          .eq("user_id", user.id)
          .single();

        if (!prefs) continue;
        if (!prefs.notify_email) continue;
        if (prefs.centre !== test_centre) continue;

        // Only email if not already emailed in the last 30 minutes for this centre
        // (prevents spam if scraper runs every few minutes)
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: recentAlerts } = await supabase
          .from("audit_log")
          .select("id")
          .eq("event_type", "slot_alert_sent")
          .eq("entity_id", user.id)
          .gt("created_at", thirtyMinsAgo)
          .limit(1);

        if (recentAlerts && recentAlerts.length > 0) continue;

        let emailResult = { skipped: true };
        try {
          emailResult = await sendSlotAlert({
            to: user.email,
            userName: user.name,
            centre: test_centre,
            slots: userSlots,
          });
        } catch (sendErr) {
          console.error(`[slots] Resend error for ${user.email}:`, sendErr.message);
          emailResult = { error: sendErr.message };
        }

        // Record the alert attempt regardless of send success
        await logAudit("slot_alert_sent", {
          entityId: user.id,
          entityType: "user",
          actor: "system",
          payload: {
            centre: test_centre,
            slots_count: userSlots.length,
            email_id: emailResult.id || null,
            error: emailResult.error || null,
          },
        });
      } catch (emailErr) {
        console.error(`[slots] alert flow error for user ${user.id}:`, emailErr.message);
      }
    }

    const approved = processed.filter((p) => p.status === "approved").length;
    const quarantined = processed.filter((p) => p.status === "quarantined").length;

    res.status(201).json({
      inserted: inserted.length,
      slots: slots.length,
      users: users.length,
      approved,
      quarantined,
      emails_sent: approvedByUser.size,
      ids: inserted.map((s) => s.id),
    });
  } catch (err) {
    next(err);
  }
});

slotsRouter.get("/", adminAuth, async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    const status = req.query.status;
    let query = supabase.from("available_slots").select("*").order("slot_datetime", { ascending: true });
    if (userId) query = query.eq("user_id", userId);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ slots: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const bookSlotSchema = z.object({
  test_centre: z.string().min(1),
  slot_datetime: z.string().datetime(),
  booking_reference: z.string().min(1),
  scraped_by_job: z.string().optional(),
  user_id: z.string().optional(),
});

slotsRouter.post("/book", scraperAuth, async (req, res, next) => {
  try {
    const { test_centre, slot_datetime, booking_reference, scraped_by_job, user_id } =
      bookSlotSchema.parse(req.body);

    // Attribute the booking to the user who actually requested it. If an explicit
    // user_id is provided (the booking pipeline does this), verify it exists.
    // Otherwise fall back to the oldest user for backward compatibility.
    let userId = user_id;
    if (userId) {
      const { data: u } = await supabase.from("users").select("id").eq("id", userId).single();
      if (!u) return res.status(404).json({ error: "user_not_found" });
    } else {
      const { data: users } = await supabase
        .from("users")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1);
      if (!users || users.length === 0) {
        return res.status(400).json({ error: "no users available" });
      }
      userId = users[0].id;
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        user_id: userId,
        test_centre,
        slot_datetime,
        booking_reference,
        status: "confirmed",
        scraped_by_job: scraped_by_job || null,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase
      .from("available_slots")
      .update({ status: "booked" })
      .eq("test_centre", test_centre)
      .eq("slot_datetime", slot_datetime)
      .eq("user_id", userId);

    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});

slotsRouter.get("/bookings", adminAuth, async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    let query = supabase.from("bookings").select("*").order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ bookings: data ?? [] });
  } catch (err) {
    next(err);
  }
});
