import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { adminAuth, adminTokenValid } from "../middleware/adminAuth.js";

export const controlRouter = Router();

// Reading the kill-switch is allowed for either the scraper (via the scraper
// key, since the coordinator/worker poll it each cycle) or an admin (via the
// admin token). Toggling it (POST) is admin-only.
function controlReadAuth(req, res, next) {
  const scraperKey = process.env.SCRAPER_API_KEY;
  if (scraperKey && req.get("x-scraper-key") === scraperKey) return next();
  if (adminTokenValid(req)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// The kill-switch is a single, well-known row so the coordinator/worker can read
// it cheaply each cycle and the dashboard can toggle it.
const CONTROL_ID = "global";

/**
 * Returns the current scraper control state, defaulting to "running" when no row
 * exists yet. Shape: { paused: boolean, actor: string|null, updated_at: string|null }.
 */
export async function getScraperControl() {
  const { data } = await supabase
    .from("scraper_control")
    .select("*")
    .eq("id", CONTROL_ID)
    .single();
  if (!data) return { paused: false, actor: null, updated_at: null };
  return {
    paused: Boolean(data.paused),
    actor: data.actor ?? null,
    updated_at: data.updated_at ?? data.created_at ?? null,
  };
}

const setSchema = z.object({
  paused: z.boolean(),
  actor: z.string().min(1).max(120).optional(),
});

controlRouter.get("/", controlReadAuth, async (_req, res, next) => {
  try {
    res.json({ scraper: await getScraperControl() });
  } catch (err) {
    next(err);
  }
});

controlRouter.post("/", adminAuth, async (req, res, next) => {
  try {
    const parsed = setSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { paused, actor } = parsed.data;

    const { data: existing } = await supabase
      .from("scraper_control")
      .select("id")
      .eq("id", CONTROL_ID)
      .single();

    if (existing) {
      await supabase
        .from("scraper_control")
        .update({ paused, actor: actor ?? "dashboard" })
        .eq("id", CONTROL_ID);
    } else {
      await supabase
        .from("scraper_control")
        .insert({ id: CONTROL_ID, paused, actor: actor ?? "dashboard" });
    }

    await logAudit(paused ? "scraper_paused" : "scraper_resumed", {
      entityType: "scraper_control",
      actor: actor ?? "dashboard",
      payload: { id: CONTROL_ID, paused },
    });
    logger.warn({ paused, actor: actor ?? "dashboard" }, "scraper control toggled");

    res.json({ scraper: await getScraperControl() });
  } catch (err) {
    next(err);
  }
});
