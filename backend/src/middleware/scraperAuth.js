import { timingSafeEqual } from "node:crypto";

/**
 * Collect the set of accepted scraper keys. Supports a single SCRAPER_API_KEY
 * (back-compat) plus a comma-separated SCRAPER_API_KEYS so each worker/fleet can
 * carry its OWN key that can be revoked independently without rotating the rest.
 */
function acceptedKeys() {
  const keys = [];
  if (process.env.SCRAPER_API_KEY) keys.push(process.env.SCRAPER_API_KEY.trim());
  if (process.env.SCRAPER_API_KEYS) {
    for (const k of process.env.SCRAPER_API_KEYS.split(",")) {
      const t = k.trim();
      if (t) keys.push(t);
    }
  }
  return keys;
}

/** Constant-time string compare that never short-circuits on length. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function scraperAuth(req, res, next) {
  const expected = acceptedKeys();
  if (expected.length === 0) {
    // Fail closed: never allow access when no key is configured.
    return res.status(503).json({ error: "scraper_api_key_not_configured" });
  }
  const key = req.get("x-scraper-key");
  if (!key || !expected.some((k) => safeEqual(key, k))) {
    return res.status(401).json({ error: "Invalid or missing scraper API key" });
  }
  next();
}
