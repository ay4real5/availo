import { supabase } from "./supabase.js";
import { sendSlackAlert } from "./alerts.js";
import { logger } from "./logger.js";

const QUARANTINE_ALERT_THRESHOLD = parseInt(
  process.env.QUARANTINE_ALERT_THRESHOLD || "5",
  10,
);
const ALERT_INTERVAL_MS = 60 * 1000;

let lastAlertTime = 0;

export async function checkQuarantineSpike() {
  try {
    const since = new Date(Date.now() - ALERT_INTERVAL_MS).toISOString();
    const { data, error } = await supabase
      .from("available_slots")
      .select("id, test_centre")
      .gt("created_at", since)
      .eq("status", "quarantined");

    if (error) throw error;

    const count = data?.length ?? 0;
    if (count >= QUARANTINE_ALERT_THRESHOLD) {
      const now = Date.now();
      if (now - lastAlertTime > ALERT_INTERVAL_MS) {
        const centres = [...new Set((data ?? []).map((r) => r.test_centre))].join(", ");
        await sendSlackAlert(
          `:warning: Quarantine spike: ${count} slots quarantined in the last minute ` +
          `(centres: ${centres || "unknown"}). Threshold: ${QUARANTINE_ALERT_THRESHOLD}`,
        );
        lastAlertTime = now;
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, "Spike detector failed");
  }
}

export function startSpikeDetector() {
  if (process.env.DISABLE_SPIKE_DETECTOR === "true") {
    logger.info("Quarantine spike detector disabled");
    return;
  }

  logger.info(
    { threshold: QUARANTINE_ALERT_THRESHOLD },
    "Starting quarantine spike detector",
  );

  // Run immediately on startup, then every minute.
  checkQuarantineSpike();
  const interval = setInterval(checkQuarantineSpike, ALERT_INTERVAL_MS);

  // Graceful shutdown in test environments.
  process.on("SIGTERM", () => clearInterval(interval));
  process.on("SIGINT", () => clearInterval(interval));
}
