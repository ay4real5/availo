import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { adminAuth } from "../middleware/adminAuth.js";

export const sessionsRouter = Router();

sessionsRouter.get("/", adminAuth, async (req, res, next) => {
  try {
    let query = supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(100);
    if (req.query.ip) query = query.eq("ip", req.query.ip);
    if (req.query.is_bot === "true" || req.query.is_bot === "1") query = query.eq("is_bot", true);
    if (req.query.is_bot === "false" || req.query.is_bot === "0") query = query.eq("is_bot", false);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ sessions: data ?? [] });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get("/analytics/summary", adminAuth, async (_req, res, next) => {
  try {
    const { data: all } = await supabase.from("sessions").select("id, is_bot");
    const total = all.length;
    const bots = all.filter((s) => s.is_bot).length;
    res.json({
      total_sessions: total,
      bot_sessions: bots,
      bot_rate_percent: total ? Number(((bots / total) * 100).toFixed(2)) : 0,
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.put("/:id/flag", adminAuth, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { data, error } = await supabase
      .from("sessions")
      .update({ is_bot: true, risk_score: 100, flags: { manually_flagged: true } })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});
