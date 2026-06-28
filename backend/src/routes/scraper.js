import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { processSlot } from "../lib/notifications.js";
import { counters } from "../lib/metrics.js";
import { scraperAuth } from "../middleware/scraperAuth.js";
import { adminAuth } from "../middleware/adminAuth.js";

export const scraperRouter = Router();

const MOCK_URL = process.env.MOCK_URL || "http://localhost:8000";

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

const ACCEPT_LANGUAGES = [
  "en-GB,en;q=0.9",
  "en-GB,en-US;q=0.9,en;q=0.8",
  "en-US,en-GB;q=0.9,en;q=0.8",
];

function randomIp() {
  return `86.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function humanDelay(minMs = 400, maxMs = 1200) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return sleep(ms);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const jobSchema = z.object({
  test_centre: z.string().min(1),
  proxy_used: z.string().optional(),
  ip_used: z.string().optional(),
  ua_used: z.string().optional(),
});

const updateJobSchema = z.object({
  status: z.enum(["running", "success", "failed", "blocked"]).optional(),
  proxy_used: z.string().optional(),
  ip_used: z.string().optional(),
  ua_used: z.string().optional(),
  slots_found: z.number().int().min(0).optional(),
  error: z.string().optional(),
}).strict();

scraperRouter.get("/jobs", adminAuth, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("scraper_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ jobs: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const DEFAULT_CENTRES = [
  "Bolton",
  "Bury",
  "Manchester",
  "Rochdale",
  "Stockport",
  "Wigan",
  "Salford",
  "Oldham",
  "Trafford",
  "Tameside",
];

scraperRouter.get("/centres", async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("available_slots")
      .select("test_centre");
    if (error) throw error;
    const known = [...new Set((data ?? []).map((s) => s.test_centre))];
    const all = [...new Set([...DEFAULT_CENTRES, ...known])];
    res.json({ centres: all });
  } catch (err) {
    next(err);
  }
});

// Returns the list of users who want a slot at this centre auto-booked.
// A request is eligible when the user has enabled auto_book, supplied a licence
// number and a saved (tokenised) card, has a future target date to beat, and
// does not already have a confirmed booking for this centre.
scraperRouter.get("/booking-requests", scraperAuth, async (req, res, next) => {
  try {
    const centre = req.query.centre;
    if (!centre) return res.status(400).json({ error: "centre query param required" });

    const { data: users } = await supabase
      .from("users")
      .select("id, email, name, current_test_date, auto_book, licence_number, payment_token");

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("user_id, centre, auto_book, licence_number");

    const { data: bookings } = await supabase
      .from("bookings")
      .select("user_id, test_centre, status");

    const prefByUser = new Map((prefs ?? []).map((p) => [p.user_id, p]));
    const hasConfirmed = (userId) =>
      (bookings ?? []).some(
        (b) => b.user_id === userId && b.test_centre === centre && b.status === "confirmed",
      );

    const now = Date.now();
    const requests = [];
    for (const u of users ?? []) {
      const pref = prefByUser.get(u.id);
      const wantsCentre = pref?.centre === centre;
      const autoBook = u.auto_book ?? pref?.auto_book ?? false;
      const licence = u.licence_number ?? pref?.licence_number ?? null;
      if (!wantsCentre || !autoBook || !licence || !u.payment_token) continue;
      // Must have a target date in the future to make booking worthwhile.
      const target = u.current_test_date ? new Date(u.current_test_date).getTime() : null;
      if (target !== null && target <= now) continue;
      if (hasConfirmed(u.id)) continue;
      requests.push({
        user_id: u.id,
        licence_number: licence,
        payment_token: u.payment_token,
        current_test_date: u.current_test_date ?? null,
      });
    }

    res.json({ centre, requests });
  } catch (err) {
    next(err);
  }
});

scraperRouter.post("/heartbeat", scraperAuth, async (req, res, next) => {
  try {
    const { worker_id } = req.body || {};
    await supabase.from("scraper_jobs").insert({
      test_centre: "heartbeat",
      status: "heartbeat",
      source_meta: { worker_id, seen_at: new Date().toISOString() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

scraperRouter.post("/jobs", scraperAuth, async (req, res, next) => {
  try {
    const { test_centre, proxy_used, ip_used, ua_used } = jobSchema.parse(req.body);
    const { data, error } = await supabase
      .from("scraper_jobs")
      .insert({
        test_centre,
        status: "running",
        proxy_used: proxy_used || null,
        ip_used: ip_used || null,
        ua_used: ua_used || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

scraperRouter.put("/jobs/:id", scraperAuth, async (req, res, next) => {
  try {
    const payload = updateJobSchema.parse(req.body);
    const { data, error } = await supabase
      .from("scraper_jobs")
      .update(payload)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

async function mockRequest(path, method = "GET", headers = {}, body = null) {
  await humanDelay(350, 900);
  const res = await fetch(`${MOCK_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const responseBody = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 403 && res.status !== 409) {
    const err = new Error(`mock request ${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    err.body = responseBody;
    throw err;
  }
  return { ok: res.ok, status: res.status, body: responseBody };
}

async function waitInQueue(headers) {
  let { body } = await mockRequest("/queue/join", "GET", headers);
  let position = body.position;
  const queueToken = body.queue_token;
  while (position > 0) {
    await new Promise((r) => setTimeout(r, 1000));
    ({ body } = await mockRequest(`/queue/status?token=${queueToken}`, "GET", headers));
    position = body.position;
    if (body.allowed) break;
  }
  return queueToken;
}

async function runScraperForCentre(baseUrl, centre, sessionId) {
  const proxy = `residential-${randomBytes(2).toString("hex")}`;
  const ip = randomIp();
  const ua = pick(UAS);
  const headers = {
    "User-Agent": ua,
    "x-faked-ip": ip,
    "Accept-Language": pick(ACCEPT_LANGUAGES),
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
  };

  let visitedTrap = false;
  let captchaHit = false;
  let slots = [];
  let body = null;

  try {
    // 1. Join the queue and wait.
    const queueToken = await waitInQueue(headers);

    // 2. Login with a licence number.
    const licenseNumber = `DRIV${Math.floor(Math.random() * 900000) + 100000}`;
    const { body: loginBody } = await mockRequest("/login", "POST", headers, {
      license_number: licenseNumber,
      queue_token: queueToken,
    });
    headers["x-session-token"] = loginBody.session_token;

    // 3. Sometimes hit the honeypot (simulating an accidental click).
    if (Math.random() < 0.15) {
      try {
        await mockRequest("/bot-trap", "GET", headers);
        visitedTrap = true;
      } catch {
        // ignore
      }
    }

    // 4. Search for slots.
    const today = new Date().toISOString();
    const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    try {
      ({ body } = await mockRequest("/search", "POST", headers, {
        centre,
        from_date: today,
        to_date: twoWeeks,
      }));
      slots = body.slots || [];
    } catch (err) {
      if (err.status === 403 && err.body?.error === "captcha_required") {
        captchaHit = true;
      }
    }
  } catch (err) {
    // Captcha or rate-limit can surface here; surface a blocked job.
    if (err.status === 403 && err.body?.error === "captcha_required") {
      captchaHit = true;
    }
  }

  // 5. Evaluate bot rule using the same signals a worker would report.
  const ruleRes = await fetch(`${baseUrl}/api/rules/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rule: "detect_bot",
      payload: { ip, ua, requests_per_minute: Math.floor(Math.random() * 200), visited_trap_page: visitedTrap },
    }),
  });
  const rule = await ruleRes.json();

  // 6. Create/update job record.
  const { data: job } = await supabase
    .from("scraper_jobs")
    .insert({ test_centre: centre, status: "running", proxy_used: proxy, ip_used: ip, ua_used: ua })
    .select()
    .single();
  const status = captchaHit ? "blocked" : "success";
  await supabase
    .from("scraper_jobs")
    .update({ status, slots_found: slots.length, error: captchaHit ? "captcha" : null })
    .eq("id", job.id);
  counters.scraperJobs.inc({ test_centre: centre, status });

  // 7. Report slots through the notification pipeline.
  let approved = 0;
  let quarantined = 0;
  if (slots.length > 0) {
    const { data: users } = await supabase.from("users").select("id, current_test_date");
    for (const slot of slots) {
      for (const user of users) {
        const { data } = await supabase
          .from("available_slots")
          .insert({
            user_id: user.id,
            test_centre: centre,
            slot_datetime: slot.datetime,
            status: "pending",
            scraped_by_job: job.id,
            proxy_used: proxy,
            session_id: sessionId,
            source_meta: { ip_used: ip, user_agent: ua },
          })
          .select()
          .single();
        if (!data) continue;

        const result = await processSlot(
          { ...data, current_test_date: user.current_test_date },
          { ip, userAgent: ua, requests_per_minute: Math.floor(Math.random() * 200), visited_trap_page: visitedTrap },
        );
        if (result.status === "approved") approved++;
        else quarantined++;
      }
    }
  }

  return {
    job_id: job.id,
    centre,
    slots_found: slots.length,
    approved,
    quarantined,
    is_bot: rule.is_bot,
    risk_score: rule.risk_score,
    reasons: rule.reasons,
  };
}

scraperRouter.get("/run", scraperAuth, async (req, res, next) => {
  try {
    const centre = req.query.centre || "Bolton";
    const result = await runScraperForCentre(
      `${req.protocol}://${req.get("host")}`,
      centre,
      req.sessionId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { runScraperForCentre };
