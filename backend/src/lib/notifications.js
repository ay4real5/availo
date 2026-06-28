import { evaluateRules } from "../lib/ruleEngine.js";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { counters } from "./metrics.js";
import { logAudit } from "./audit.js";

/**
 * Decide whether a discovered slot should be quarantined or enqueued for notification.
 * Runs detect_bot, flag_early_slot and rate_limit_ip rules from the JSON config.
 */
export async function processSlot(slot, sessionMeta) {
  const result = evaluateRules({
    ip: sessionMeta.ip,
    ua: sessionMeta.userAgent,
    requests_per_minute: sessionMeta.requests_per_minute || 0,
    visited_trap_page: sessionMeta.visited_trap_page || false,
    slot_datetime: slot.slot_datetime,
    current_test_date: slot.current_test_date,
  });

  const ruleMeta = {
    bot: result.bot,
    early: result.early,
    rateLimit: result.rateLimit,
    combined_score: result.combined_score,
    quarantine_threshold: result.quarantine_threshold,
  };

  if (result.should_quarantine) {
    await supabase
      .from("available_slots")
      .update({ status: "quarantined", rule_meta: ruleMeta })
      .eq("id", slot.id);
    await logAudit("slot_quarantined", {
      entityId: slot.id,
      entityType: "available_slot",
      payload: { test_centre: slot.test_centre, slot_datetime: slot.slot_datetime, rule_meta: ruleMeta },
    });
    logger.info({ slot_id: slot.id, rule_meta: ruleMeta }, "Slot quarantined");
    return { status: "quarantined", rule_meta: ruleMeta };
  }

  const notify = result.should_notify;
  const status = notify ? "approved" : "ignored";
  await supabase
    .from("available_slots")
    .update({ status, rule_meta: ruleMeta })
    .eq("id", slot.id);

  if (notify) {
    await supabase.from("notification_queue").insert({
      slot_id: slot.id,
      user_id: slot.user_id,
      channel: "push",
      status: "pending",
      rule_meta: ruleMeta,
    });
    counters.notificationsQueued.inc();
    await logAudit("slot_approved", {
      entityId: slot.id,
      entityType: "available_slot",
      payload: { test_centre: slot.test_centre, slot_datetime: slot.slot_datetime, rule_meta: ruleMeta },
    });
    logger.info({ slot_id: slot.id }, "Slot approved and notification queued");
    return { status: "approved", rule_meta: ruleMeta, notify: true };
  }

  await logAudit("slot_ignored", {
    entityId: slot.id,
    entityType: "available_slot",
    payload: { test_centre: slot.test_centre, slot_datetime: slot.slot_datetime, rule_meta: ruleMeta },
  });
  logger.info({ slot_id: slot.id }, "Slot ignored (not earlier)");
  return { status: "ignored", rule_meta: ruleMeta, notify: false };
}

/**
 * Drain pending notifications. In a real app this would send push/SMS.
 */
export async function sendPendingNotifications() {
  const { data: pending } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .limit(50);

  const sent = [];
  for (const item of pending ?? []) {
    // Simulate sending a notification.
    await supabase
      .from("notification_queue")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", item.id);
    sent.push(item.id);
  }

  return { sent: sent.length };
}
