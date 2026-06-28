import { logger } from "./logger.js";

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export async function sendSlackAlert(text) {
  if (!SLACK_WEBHOOK_URL) {
    logger.warn("SLACK_WEBHOOK_URL not set; skipping alert");
    return;
  }

  try {
    const resp = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      throw new Error(`Slack returned ${resp.status}`);
    }
    logger.info({ text }, "Slack alert sent");
  } catch (err) {
    logger.error({ err: err.message }, "Failed to send Slack alert");
  }
}
