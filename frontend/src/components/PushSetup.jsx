import { useEffect, useState } from "react";
import { getPushKey, subscribePush, unsubscribePush } from "../api";

// VAPID public keys are base64url; the PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

const supported =
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

// iOS only delivers web push to an installed PWA (Add to Home Screen), iOS 16.4+.
const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export default function PushSetup({ token }) {
  const [status, setStatus] = useState("loading"); // loading | unavailable | off | on | error
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!supported) { setStatus("unavailable"); return; }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(existing ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications are blocked. Allow them in your browser settings, then try again.");
        setBusy(false);
        return;
      }
      const { key } = await getPushKey(token);
      if (!key) {
        setMessage("Push isn't configured on the server yet. Email alerts still work.");
        setStatus("unavailable");
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await subscribePush(subscription.toJSON(), token);
      setStatus("on");
      setMessage("Device alerts are on. We'll notify this device the instant a slot appears.");
    } catch (err) {
      setMessage(err.message || "Could not enable device alerts.");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint, token).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("off");
      setMessage("Device alerts are off.");
    } catch (err) {
      setMessage(err.message || "Could not turn off device alerts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="av-heading-m">Alerts on your phone &amp; devices</h2>
      <p className="av-body-s">
        Get a notification the second an earlier slot appears — even when you're not looking at the dashboard.
        Enable it on any device you keep nearby.
      </p>

      {status === "unavailable" && (
        <p className="av-body">
          <span className="av-tag av-tag--neutral">Not available here</span>{" "}
          This browser doesn't support device notifications. Email alerts still work.
        </p>
      )}

      {status === "on" && (
        <>
          <p className="av-body"><span className="av-tag av-tag--success">On for this device</span></p>
          <button className="av-btn av-btn--secondary" onClick={disable} disabled={busy}>
            {busy ? "Turning off…" : "Turn off on this device"}
          </button>
        </>
      )}

      {(status === "off" || status === "error") && (
        <>
          {isIOS && !isStandalone && (
            <div className="av-note">
              <p className="av-body" style={{ margin: 0 }}>
                On iPhone/iPad, first tap <strong>Share → Add to Home Screen</strong>, then open Availo from that
                icon — Apple only allows notifications for the installed app.
              </p>
            </div>
          )}
          <button className="av-btn" onClick={enable} disabled={busy}>
            {busy ? "Enabling…" : "Enable alerts on this device"}
          </button>
        </>
      )}

      {message && <p className="av-body-s" style={{ marginTop: 10 }}>{message}</p>}
    </div>
  );
}
