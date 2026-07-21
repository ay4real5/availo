import { spawn } from "node:child_process";
import dotenv from "dotenv";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "dev-scraper-key";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "5", 10);
const WORKER_SCRIPT = join(__dirname, "worker.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

async function fetchCentres() {
  const res = await fetch(`${BACKEND_URL}/api/scraper/centres`, {
    headers: { "x-scraper-key": SCRAPER_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch centres: ${res.status}`);
  }
  const data = await res.json();
  return data.centres || [];
}

function runWorker(centre) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [WORKER_SCRIPT, "--centre", centre], {
      stdio: "inherit",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worker for ${centre} exited with code ${code}`));
      }
    });
  });
}

async function runBatch(centres) {
  const active = [];
  for (let i = 0; i < centres.length; i += CONCURRENCY) {
    const batch = centres.slice(i, i + CONCURRENCY);
    console.log(`[coordinator] running batch: ${batch.join(", ")}`);
    await Promise.allSettled(batch.map((c) => runWorker(c)));
  }
}

async function isPaused() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/control`, {
      headers: { "x-scraper-key": SCRAPER_API_KEY },
    });
    if (!res.ok) return false; // fail open: a control outage shouldn't halt scraping
    const data = await res.json();
    return Boolean(data?.scraper?.paused);
  } catch (err) {
    console.warn("[coordinator] control check failed (continuing):", err.message);
    return false;
  }
}

async function sendHeartbeat() {
  try {
    await fetch(`${BACKEND_URL}/api/scraper/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-scraper-key": SCRAPER_API_KEY },
      body: JSON.stringify({ worker_id: `coordinator-${process.pid}` }),
    });
  } catch (err) {
    console.warn("[coordinator] heartbeat failed:", err.message);
  }
}

async function main() {
  await sendHeartbeat();

  if (await isPaused()) {
    console.log("[coordinator] kill-switch ENGAGED — scraping paused, skipping this run");
    return;
  }

  const centres = await fetchCentres();
  if (centres.length === 0) {
    console.log("[coordinator] no centres found");
    return;
  }
  console.log(`[coordinator] scraping ${centres.length} centres: ${centres.join(", ")}`);

  await runBatch(centres);
  console.log("[coordinator] all workers finished");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
