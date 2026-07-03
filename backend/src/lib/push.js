import { logger } from "./logger.js";

// Web Push wrapper. Like email (lib/email.js), push is OPTIONAL: if the VAPID
// keys aren't configured — or the `web-push` package isn't installed — push is
// silently skipped rather than erroring. No paid third party is involved; Web
// Push uses the browser vendors' own free push services, keyed by self-generated
// VAPID keys (generate once with `npx web-push generate-vapid-keys`).

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@availo.app";

let webpush = null;
let configured = false;
let triedInit = false;

async function ensure() {
  if (configured) return webpush;
  if (triedInit) return webpush; // don't retry a failed import every call
  triedInit = true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    logger.info("VAPID keys not set — web push disabled");
    return null;
  }
  try {
    const mod = await import("web-push");
    webpush = mod.default || mod;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
    return webpush;
  } catch (err) {
    logger.warn({ err: err.message }, "web-push package unavailable — push disabled");
    return null;
  }
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC || null;
}

// { skipped } if push isn't configured; { ok } on success; { error, gone } on
// failure, where gone=true means the subscription is dead (404/410) and the
// caller should delete it.
export async function sendPush(subscription, payload) {
  const wp = await ensure();
  if (!wp) return { skipped: true };
  try {
    await wp.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    const gone = err.statusCode === 404 || err.statusCode === 410;
    return { error: err.message, gone };
  }
}
