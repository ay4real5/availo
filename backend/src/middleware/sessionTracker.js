import { v4 as uuidv4 } from "uuid";
import { supabase } from "../lib/supabase.js";

export async function trackSession(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const userAgent = req.get("user-agent") || "unknown";
  const id = uuidv4();
  const now = new Date().toISOString();

  const session = {
    id,
    user_id: req.body?.user_id || null,
    ip,
    user_agent: userAgent,
    started_at: now,
    ended_at: null,
    is_bot: false,
    risk_score: 0,
    flags: {},
  };

  try {
    await supabase.from("sessions").insert(session);
  } catch (err) {
    // Don't block requests if session tracking fails.
  }

  req.sessionId = id;
  req.sessionMeta = { ip, userAgent };

  res.on("finish", async () => {
    try {
      await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", id);
    } catch {
      // Ignore post-response errors.
    }
  });

  next();
}
