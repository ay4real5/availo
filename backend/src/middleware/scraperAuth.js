export function scraperAuth(req, res, next) {
  const expected = process.env.SCRAPER_API_KEY;
  if (!expected) {
    // Fail closed: never allow access when no key is configured.
    return res.status(503).json({ error: "scraper_api_key_not_configured" });
  }
  const key = req.get("x-scraper-key");
  if (!key || key !== expected) {
    return res.status(401).json({ error: "Invalid or missing scraper API key" });
  }
  next();
}
