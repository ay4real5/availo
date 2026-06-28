/**
 * Lightweight, dependency-free in-memory rate limiter.
 *
 * Sized for the single-instance deployment (Render). It protects the public auth
 * endpoints from credential-stuffing / brute force without pulling in a store or
 * an extra package. State is per-process and self-expiring.
 *
 * For a multi-instance deployment this should be backed by Redis instead, but the
 * interface (a keyed fixed-window counter) stays the same.
 */

/** Best-effort client IP, honouring the first hop of X-Forwarded-For (Vercel/Render). */
export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Create a fixed-window rate-limit middleware.
 *
 * @param {object} opts
 * @param {number} opts.windowMs   Window length in milliseconds.
 * @param {number} opts.max        Max requests per key per window.
 * @param {(req) => string} [opts.keyGenerator]  How to bucket requests.
 * @param {string} [opts.message]  Error message returned on limit.
 */
export function rateLimit({ windowMs, max, keyGenerator, message } = {}) {
  const window = windowMs ?? 15 * 60 * 1000;
  const limit = max ?? 100;
  const keyOf = keyGenerator ?? ((req) => clientIp(req));
  const buckets = new Map(); // key -> { count, resetAt }

  // Periodically evict expired buckets so memory stays bounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, window);
  if (typeof sweep.unref === "function") sweep.unref();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = keyOf(req);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + window };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, limit - b.count);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((b.resetAt - now) / 1000)));

    if (b.count > limit) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "rate_limited",
        message: message || "Too many requests. Please try again later.",
        retry_after_seconds: retryAfter,
      });
    }
    next();
  };
}
