import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const COORDINATOR = join(__dirname, "run_workers.js");
const MAX_RETRIES = parseInt(process.env.SUPERVISOR_MAX_RETRIES || "5", 10);
const BASE_DELAY_MS = parseInt(process.env.SUPERVISOR_BASE_DELAY_MS || "1000", 10);
const MAX_DELAY_MS = parseInt(process.env.SUPERVISOR_MAX_DELAY_MS || "30000", 10);
const RUN_INTERVAL_MS = parseInt(process.env.SUPERVISOR_RUN_INTERVAL_MS || "60000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCoordinator() {
  return new Promise((resolve, reject) => {
    console.log(`[supervisor] spawning coordinator: ${COORDINATOR}`);
    const child = spawn("node", [COORDINATOR], {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
    });

    let killed = false;
    const timeout = setTimeout(() => {
      console.log("[supervisor] coordinator run timeout reached, killing child");
      killed = true;
      child.kill("SIGTERM");
    }, RUN_INTERVAL_MS);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (killed || code === 0) {
        resolve(code ?? 0);
      } else {
        reject(new Error(`Coordinator exited with code ${code}, signal ${signal}`));
      }
    });
  });
}

async function withBackoff(attempt) {
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  console.log(`[supervisor] backing off for ${delay}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
  await sleep(delay);
}

// Jitter the inter-run interval so polling is not perfectly periodic (a fixed
// cadence is itself a bot signal). +/-25% around the configured interval.
function adaptiveInterval() {
  const jitter = 1 + (Math.random() * 0.5 - 0.25);
  return Math.round(RUN_INTERVAL_MS * jitter);
}

async function main() {
  let attempt = 0;
  while (true) {
    try {
      await runCoordinator();
      attempt = 0;
      const next = adaptiveInterval();
      console.log(`[supervisor] run complete, sleeping ${next}ms (jittered)`);
      await sleep(next);
    } catch (err) {
      console.error("[supervisor] coordinator failed:", err.message);
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        console.error(`[supervisor] exceeded ${MAX_RETRIES} retries, exiting`);
        process.exit(1);
      }
      await withBackoff(attempt);
    }
  }
}

process.on("SIGTERM", () => {
  console.log("[supervisor] received SIGTERM, exiting");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
