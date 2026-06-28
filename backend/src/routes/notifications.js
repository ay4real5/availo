import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { sendPendingNotifications } from "../lib/notifications.js";
import { logAudit } from "../lib/audit.js";

export const notificationsRouter = Router();

notificationsRouter.get("/queue", async (req, res, next) => {
  try {
    let query = supabase
      .from("notification_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (req.query.status) query = query.eq("status", req.query.status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ notifications: data ?? [] });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.get("/quarantine", async (req, res, next) => {
  try {
    let query = supabase
      .from("available_slots")
      .select("*")
      .eq("status", "quarantined")
      .order("created_at", { ascending: false })
      .limit(100);
    if (req.query.user_id) query = query.eq("user_id", req.query.user_id);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ slots: data ?? [] });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/quarantine/:id/release", async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const reason = req.body?.reason || "Manual review";

    const { data: slot, error } = await supabase
      .from("available_slots")
      .select("*")
      .eq("id", id)
      .eq("status", "quarantined")
      .single();
    if (error) throw error;
    if (!slot) {
      res.status(404).json({ error: "Quarantined slot not found" });
      return;
    }

    await supabase
      .from("available_slots")
      .update({ status: "approved", rule_meta: { ...slot.rule_meta, released_reason: reason } })
      .eq("id", id);

    await supabase.from("notification_queue").insert({
      slot_id: slot.id,
      user_id: slot.user_id,
      channel: "push",
      status: "pending",
      rule_meta: { manually_released: true, reason },
    });

    await logAudit("slot_released", {
      entityId: slot.id,
      entityType: "available_slot",
      actor: "operator",
      payload: { test_centre: slot.test_centre, slot_datetime: slot.slot_datetime, reason },
    });

    res.json({ released: true });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/quarantine/:id/reject", async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const reason = req.body?.reason || "Manual review";

    const { data: slot, error } = await supabase
      .from("available_slots")
      .select("*")
      .eq("id", id)
      .eq("status", "quarantined")
      .single();
    if (error) throw error;
    if (!slot) {
      res.status(404).json({ error: "Quarantined slot not found" });
      return;
    }

    await supabase
      .from("available_slots")
      .update({ status: "rejected", rule_meta: { ...slot.rule_meta, rejected_reason: reason } })
      .eq("id", id);

    await logAudit("slot_rejected", {
      entityId: slot.id,
      entityType: "available_slot",
      actor: "operator",
      payload: { test_centre: slot.test_centre, slot_datetime: slot.slot_datetime, reason },
    });

    res.json({ rejected: true });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/send-pending", async (_req, res, next) => {
  try {
    const result = await sendPendingNotifications();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
