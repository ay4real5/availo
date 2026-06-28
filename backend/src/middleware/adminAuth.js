// Gate for the admin dashboard surface (analytics, audit, quarantine review,
// rules/policies, the kill-switch toggle, manual scrape, etc.).
//
// Behaviour:
//   - Production: requires `x-admin-token` to equal ADMIN_TOKEN. If ADMIN_TOKEN
//     is unset it FAILS CLOSED (503) so the admin surface is never accidentally
//     left open on a public deployment.
//   - Non-production: if ADMIN_TOKEN is unset, requests are allowed (keeps local
//     dev + the test suite friction-free). If it IS set, it is enforced.
export function adminTokenValid(req) {
  const expected = process.env.ADMIN_TOKEN;
  const isProd = process.env.NODE_ENV === "production";
  if (!expected) return !isProd; // dev: open; prod: never valid without a token
  return req.get("x-admin-token") === expected;
}

export function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const isProd = process.env.NODE_ENV === "production";
  if (!expected) {
    if (isProd) return res.status(503).json({ error: "admin_token_not_configured" });
    return next(); // dev convenience
  }
  if (req.get("x-admin-token") !== expected) {
    return res.status(401).json({ error: "Invalid or missing admin token" });
  }
  next();
}
