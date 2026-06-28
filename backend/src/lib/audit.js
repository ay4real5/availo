import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export async function logAudit(eventType, { entityId, entityType, actor, payload } = {}) {
  try {
    const { error } = await supabase.from("audit_log").insert({
      event_type: eventType,
      entity_id: entityId ?? null,
      entity_type: entityType ?? null,
      actor: actor ?? "system",
      payload: payload ?? {},
    });
    if (error) throw error;
  } catch (err) {
    logger.error({ err: err.message, eventType }, "Failed to write audit log");
  }
}

export async function getAuditLog(filters = {}) {
  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);

  const { data, error } = await query;
  if (error) throw error;
  return { logs: data ?? [] };
}
