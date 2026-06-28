import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabase.js";
import { sendWelcomeEmail } from "../lib/email.js";
import { tokeniseCard } from "../lib/payments.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";

export const authRouter = Router();

// Throttle credential-stuffing / brute force on login: per IP+email so one
// attacker can't grind a single account, and mass account creation on register.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${clientIp(req)}:${String(req.body?.email || "").toLowerCase()}`,
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => clientIp(req),
  message: "Too many accounts created from this network. Please try again later.",
});

const DEV_JWT_SECRET = "availo-dev-secret-change-in-prod";
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const JWT_TTL = "7d";

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || JWT_SECRET === DEV_JWT_SECRET)) {
  throw new Error(
    "JWT_SECRET must be set to a strong, unique value in production (the dev default is not allowed).",
  );
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const prefsSchema = z.object({
  centre: z.string().min(1),
  current_test_date: z.string().datetime().optional().nullable(),
  search_days_ahead: z.number().int().min(1).max(180).default(42),
  notify_email: z.boolean().default(true),
  notify_sms: z.boolean().default(false),
  phone: z.string().optional().nullable(),
  auto_book: z.boolean().default(false),
  licence_number: z.string().min(5).max(20).optional().nullable(),
});

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_TTL });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "token_invalid_or_expired" });
  }
}

authRouter.post("/register", registerLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existing) {
      return res.status(409).json({ error: "email_taken", message: "An account with this email already exists" });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data, error } = await supabase
      .from("users")
      .insert({ email, name: name || null, password_hash })
      .select("id, email, name, created_at")
      .single();

    if (error) throw error;

    const token = signToken(data.id);
    res.status(201).json({ user: data, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const { data: user } = await supabase
      .from("users")
      .select("id, email, name, password_hash, created_at")
      .eq("email", email)
      .single();

    if (!user) {
      return res.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect" });
    }

    const valid = await bcrypt.compare(password, user.password_hash || "");
    if (!valid) {
      return res.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect" });
    }

    const { password_hash: _, ...safeUser } = user;
    const token = signToken(user.id);
    res.json({ user: safeUser, token });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name, created_at")
      .eq("id", req.userId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/preferences", requireAuth, async (req, res, next) => {
  try {
    const { data } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", req.userId)
      .single();
    res.json(data || null);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/preferences", requireAuth, async (req, res, next) => {
  try {
    const prefs = prefsSchema.parse(req.body);

    const { data: existing } = await supabase
      .from("user_preferences")
      .select("id")
      .eq("user_id", req.userId)
      .single();

    const isNew = !existing;
    let result;
    if (existing) {
      const { data, error } = await supabase
        .from("user_preferences")
        .update({ ...prefs, updated_at: new Date().toISOString() })
        .eq("user_id", req.userId)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from("user_preferences")
        .insert({ user_id: req.userId, ...prefs })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    // Keep key fields in sync on the users table so the booking pipeline (which
    // reads from users in /api/slots/report-centre and the booking matcher) can
    // resolve the right user, their target date, auto-book flag and licence.
    const userSync = {};
    if (prefs.current_test_date !== undefined) userSync.current_test_date = prefs.current_test_date;
    if (prefs.auto_book !== undefined) userSync.auto_book = prefs.auto_book;
    if (prefs.licence_number !== undefined) userSync.licence_number = prefs.licence_number;
    if (Object.keys(userSync).length > 0) {
      await supabase.from("users").update(userSync).eq("id", req.userId);
    }

    // Send welcome email only on first-time setup
    if (isNew) {
      const { data: user } = await supabase
        .from("users")
        .select("email, name")
        .eq("id", req.userId)
        .single();
      if (user) {
        sendWelcomeEmail({ to: user.email, userName: user.name, centre: prefs.centre }).catch(
          (err) => console.error("[auth] welcome email error:", err.message),
        );
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const paymentMethodSchema = z.object({
  number: z.string().min(12).max(25),
  exp_month: z.union([z.number(), z.string()]),
  exp_year: z.union([z.number(), z.string()]),
  cvc: z.string().min(3).max(4),
  name: z.string().optional().nullable(),
});

// Capture a card. The raw PAN/CVC are validated then DISCARDED; only an opaque
// token + masked metadata are stored. In production the tokenisation would be
// done by the provider's client SDK and the PAN would never reach this server.
authRouter.post("/payment-method", requireAuth, async (req, res, next) => {
  try {
    const card = paymentMethodSchema.parse(req.body);
    let tokenised;
    try {
      tokenised = tokeniseCard(card);
    } catch (e) {
      return res.status(400).json({ error: e.code || "invalid_card", message: e.message });
    }

    await supabase
      .from("users")
      .update({
        payment_token: tokenised.payment_token,
        card_brand: tokenised.card_brand,
        card_last4: tokenised.card_last4,
        card_exp: tokenised.card_exp,
        card_name: tokenised.card_name,
      })
      .eq("id", req.userId);

    res.status(201).json({
      saved: true,
      card_brand: tokenised.card_brand,
      card_last4: tokenised.card_last4,
      card_exp: tokenised.card_exp,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/payment-method", requireAuth, async (req, res, next) => {
  try {
    const { data: user } = await supabase
      .from("users")
      .select("payment_token, card_brand, card_last4, card_exp, card_name")
      .eq("id", req.userId)
      .single();
    if (!user || !user.payment_token) return res.json(null);
    res.json({
      card_brand: user.card_brand,
      card_last4: user.card_last4,
      card_exp: user.card_exp,
      card_name: user.card_name,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete("/payment-method", requireAuth, async (req, res, next) => {
  try {
    await supabase
      .from("users")
      .update({ payment_token: null, card_brand: null, card_last4: null, card_exp: null, card_name: null })
      .eq("id", req.userId);
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/my-bookings", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ bookings: data ?? [] });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/my-slots", requireAuth, async (req, res, next) => {
  try {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("centre, current_test_date, search_days_ahead")
      .eq("user_id", req.userId)
      .single();

    if (!prefs) return res.json({ slots: [], prefs: null });

    const cutoff = prefs.current_test_date
      ? new Date(prefs.current_test_date)
      : null;

    const { data: slots } = await supabase
      .from("available_slots")
      .select("*")
      .eq("test_centre", prefs.centre)
      .eq("status", "approved")
      .order("slot_datetime", { ascending: true })
      .limit(20);

    const matched = (slots || []).filter((s) => {
      if (!cutoff) return true;
      return new Date(s.slot_datetime) < cutoff;
    });

    res.json({ slots: matched, prefs });
  } catch (err) {
    next(err);
  }
});
