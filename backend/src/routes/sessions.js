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

sessionsRouter.post("/behaviour", async (req, res, next) => {
  try {
    const payload = z
      .object({
        session_id: z.string().min(1),
        url: z.string().optional(),
        timestamp: z.string().datetime().optional(),
        scroll_count: z.number().int().min(0).default(0),
        click_count: z.number().int().min(0).default(0),
        mouse_move_count: z.number().int().min(0).default(0),
        viewport: z.record(z.any()).optional(),
      })
      .parse(req.body);

    const sessionData = {
      id: payload.session_id,
      user_agent: req.get("user-agent"),
      ip: req.sessionMeta?.ip || req.ip,
      flags: {
        scroll_count: payload.scroll_count,
        click_count: payload.click_count,
        mouse_move_count: payload.mouse_move_count,
        viewport: payload.viewport,
        url: payload.url,
      },
      started_at: payload.timestamp || new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("sessions")
      .select("id")
      .eq("id", payload.session_id)
      .single();

    if (existing) {
      await supabase.from("sessions").update(sessionData).eq("id", payload.session_id);
    } else {
      await supabase.from("sessions").insert(sessionData);
    }

    res.json({ ok: true });
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
