"""
Playwright real-browser discovery (opt-in hybrid) with stealth + biometrics.

The fast curl_cffi path is great for high-frequency polling, but the most
detection-sensitive moment is the interactive journey (JS challenges, canvas /
WebGL fingerprinting, real event timing, behavioural biometrics). This module
drives the mock site's *HTML* journey with a genuine, stealthed headless
Chromium so discovery looks exactly like a real candidate using a browser:

  * navigator.webdriver / headless tells are patched out
  * the browser environment (locale, timezone, geolocation, WebGL vendor) is
    made coherent with the chosen residential identity (see fingerprint.py)
  * a curved, eased mouse path + scrolling generate genuine pointer events so
    the site's behavioural-biometric signal is satisfied
  * the page's JS challenge runs for free because this is a real JS engine

Found slots are handed back to the worker, which completes booking via the
secure tokenised path. Enable with USE_PLAYWRIGHT=true; if Playwright or its
browser binary is missing, `available()` returns False and the worker falls
back to curl_cffi.
"""
from __future__ import annotations

import os
import random
import re
from typing import Any

import biometrics

MOCK_URL = os.environ.get("MOCK_URL", "http://localhost:8000")

try:
    from playwright.sync_api import sync_playwright  # type: ignore

    _PLAYWRIGHT_IMPORTED = True
except Exception:
    _PLAYWRIGHT_IMPORTED = False


def available() -> bool:
    """True if Playwright is importable AND opted-in via USE_PLAYWRIGHT."""
    return _PLAYWRIGHT_IMPORTED and os.environ.get("USE_PLAYWRIGHT", "").lower() == "true"


# Injected to neuter WebRTC IP leakage at the JS layer. Real browsers keep
# RTCPeerConnection available (removing it entirely is itself a tell), so we keep
# the API but strip any STUN/TURN servers a page supplies — candidate gathering
# then cannot surface a non-proxied host/srflx address.
_WEBRTC_GUARD_JS = """
(function () {
  const _strip = (cfg) => {
    try {
      cfg = cfg || {};
      cfg.iceServers = [];
      cfg.iceTransportPolicy = 'relay';
    } catch (e) {}
    return cfg;
  };
  const _PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (_PC) {
    const Wrapped = function (cfg, ...rest) { return new _PC(_strip(cfg), ...rest); };
    Wrapped.prototype = _PC.prototype;
    window.RTCPeerConnection = Wrapped;
    window.webkitRTCPeerConnection = Wrapped;
  }
})();
"""


def _proxy_settings(proxy: str | None) -> dict[str, str] | None:
    if not proxy or not proxy.startswith(("http://", "https://", "socks5://", "socks5h://", "socks4://")):
        return None
    # Drop any '#geo=..' coherence annotation before handing the URL to Chromium.
    return {"server": proxy.split("#", 1)[0]}


def _stealth_script(meta: dict) -> str:
    """JS injected before any page script runs, to erase automation tells and
    make the WebGL/navigator/canvas/audio surface coherent with the chosen
    identity. Covers the signals a DVSA-class anti-bot stack actually reads:
    navigator surface, screen geometry, plus per-identity canvas + AudioContext
    noise so the fingerprint hash is stable per session yet unique per identity.
    """
    vendor = meta.get("webgl_vendor", "Google Inc. (Intel)")
    renderer = meta.get("webgl_renderer", "ANGLE (Intel)")
    languages = meta.get("languages", ["en-GB", "en"])
    platform = meta.get("platform", "Win32")
    hardware_concurrency = int(meta.get("hardware_concurrency", 8))
    device_memory = meta.get("device_memory", 8)
    max_touch_points = int(meta.get("max_touch_points", 0))
    screen = meta.get("screen", {"width": 1920, "height": 1080})
    color_depth = int(meta.get("color_depth", 24))
    canvas_seed = int(meta.get("canvas_seed", 12345))
    audio_seed = int(meta.get("audio_seed", 54321))
    # Firefox/Safari do not expose navigator.deviceMemory; delete it there so the
    # surface matches the claimed UA rather than leaking Chromium's value.
    device_memory_js = (
        f"Object.defineProperty(navigator, 'deviceMemory', {{ get: () => {int(device_memory)} }});"
        if device_memory is not None
        else "try {{ delete Navigator.prototype.deviceMemory; }} catch (e) {{}}"
    )
    return f"""
    // navigator.webdriver -> undefined (the canonical headless tell)
    Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
    // Plausible language list.
    Object.defineProperty(navigator, 'languages', {{ get: () => {languages!r} }});
    // Non-empty plugins/mimeTypes like a real Chrome.
    Object.defineProperty(navigator, 'plugins', {{ get: () => [1,2,3,4,5] }});
    // Hardware surface coherent with the identity.
    Object.defineProperty(navigator, 'hardwareConcurrency', {{ get: () => {hardware_concurrency} }});
    Object.defineProperty(navigator, 'platform', {{ get: () => {platform!r} }});
    Object.defineProperty(navigator, 'maxTouchPoints', {{ get: () => {max_touch_points} }});
    {device_memory_js}
    // Screen geometry coherent with the identity.
    try {{
      Object.defineProperty(screen, 'width', {{ get: () => {screen['width']} }});
      Object.defineProperty(screen, 'height', {{ get: () => {screen['height']} }});
      Object.defineProperty(screen, 'availWidth', {{ get: () => {screen['width']} }});
      Object.defineProperty(screen, 'availHeight', {{ get: () => {screen['height'] - 40} }});
      Object.defineProperty(screen, 'colorDepth', {{ get: () => {color_depth} }});
      Object.defineProperty(screen, 'pixelDepth', {{ get: () => {color_depth} }});
    }} catch (e) {{}}
    // window.chrome runtime shim.
    window.chrome = window.chrome || {{ runtime: {{}} }};
    // Permissions query shouldn't reveal automation.
    const _q = window.navigator.permissions && window.navigator.permissions.query;
    if (_q) {{
      window.navigator.permissions.query = (p) => (
        p && p.name === 'notifications'
          ? Promise.resolve({{ state: Notification.permission }})
          : _q(p)
      );
    }}
    // Spoof the WebGL vendor/renderer to match the identity.
    const _getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {{
      if (p === 37445) return {vendor!r};   // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return {renderer!r}; // UNMASKED_RENDERER_WEBGL
      return _getParam.call(this, p);
    }};

    // ── Deterministic per-identity canvas noise ─────────────────────────────
    // A seeded PRNG so the perturbation is stable within this session but unique
    // across identities (a constant canvas hash across many users is a tell).
    (function () {{
      let _s = {canvas_seed} >>> 0;
      function _rng() {{
        _s = (_s + 0x6D2B79F5) >>> 0;
        let t = _s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }}
      function _noisePixel(canvas) {{
        try {{
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) return;
          const x = {canvas_seed} % canvas.width;
          const y = ({canvas_seed} >> 3) % canvas.height;
          const px = ctx.getImageData(x, y, 1, 1);
          px.data[0] = (px.data[0] + (Math.floor(_rng() * 4))) & 255;
          px.data[1] = (px.data[1] + (Math.floor(_rng() * 4))) & 255;
          px.data[2] = (px.data[2] + (Math.floor(_rng() * 4))) & 255;
          ctx.putImageData(px, x, y);
        }} catch (e) {{}}
      }}
      const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function () {{
        _noisePixel(this);
        return _toDataURL.apply(this, arguments);
      }};
      const _toBlob = HTMLCanvasElement.prototype.toBlob;
      if (_toBlob) {{
        HTMLCanvasElement.prototype.toBlob = function () {{
          _noisePixel(this);
          return _toBlob.apply(this, arguments);
        }};
      }}
    }})();

    // ── Deterministic per-identity AudioContext noise ───────────────────────
    (function () {{
      const _eps = (({audio_seed} % 1000) / 1e7);
      const _AP = (window.AnalyserNode && AnalyserNode.prototype);
      if (_AP && _AP.getFloatFrequencyData) {{
        const _g = _AP.getFloatFrequencyData;
        _AP.getFloatFrequencyData = function (arr) {{
          _g.apply(this, arguments);
          for (let i = 0; i < arr.length; i++) {{ arr[i] += _eps; }}
        }};
      }}
      const _BP = (window.AudioBuffer && AudioBuffer.prototype);
      if (_BP && _BP.getChannelData) {{
        const _c = _BP.getChannelData;
        _BP.getChannelData = function () {{
          const data = _c.apply(this, arguments);
          if (data && data.length) {{ data[0] = data[0] + _eps; }}
          return data;
        }};
      }}
    }})();
    """


def _do_biometrics(page, meta: dict, log) -> None:
    """Generate human-like pointer motion + scrolling so the page's behavioural
    signal (mousemove/scroll counters) registers genuine activity."""
    plan = biometrics.plan_session(meta.get("viewport"))
    try:
        prev = (plan["viewport"]["width"] / 2, plan["viewport"]["height"] / 2)
        page.mouse.move(prev[0], prev[1])
        for wp in plan["waypoints"]:
            for (x, y) in biometrics.mouse_path(prev, wp):
                page.mouse.move(x, y)
            prev = wp
        for _ in range(plan["scrolls"]):
            page.mouse.wheel(0, 220)
        log.info(f"biometric motion replayed ({plan['source']}: {len(plan['waypoints'])} waypoints)")
    except Exception as e:
        log.warning(f"biometric replay skipped: {e}")


def discover_with_browser(
    centre: str,
    ua: str,
    proxy: str | None,
    licence: str,
    log,
    fake_ip: str | None = None,
    client_meta: dict | None = None,
) -> list[dict[str, Any]]:
    """Run the HTML journey in a real, stealthed browser and return slots.

    Returns a list of {id, centre, datetime} dicts (same shape as the JSON API).
    Raises if Playwright's browser binary is missing so the caller can fall back.
    """
    slots: list[dict[str, Any]] = []
    fake_ip = fake_ip or os.environ.get("PW_FAKE_IP") or ""
    meta = client_meta or {}
    locale = meta.get("locale", "en-GB")
    timezone_id = meta.get("timezone", "Europe/London")
    viewport = meta.get("viewport", {"width": 1366, "height": 768})
    screen = meta.get("screen", viewport)
    device_scale_factor = float(meta.get("device_scale_factor", 1.0))
    max_touch_points = int(meta.get("max_touch_points", 0))
    geoloc = meta.get("geolocation")

    with sync_playwright() as p:
        launch_kwargs: dict[str, Any] = {
            "headless": True,
            "args": [
                "--disable-blink-features=AutomationControlled",
                # Prevent WebRTC from leaking the real local/host IP via STUN: force
                # all UDP through the proxy. Without this, a single getUserMedia/RTC
                # probe deanonymises every rotated identity at once.
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                "--webrtc-ip-handling-policy=disable_non_proxied_udp",
            ],
        }
        proxy_cfg = _proxy_settings(proxy)
        if proxy_cfg:
            launch_kwargs["proxy"] = proxy_cfg
        browser = p.chromium.launch(**launch_kwargs)
        # Keep the source IP coherent across the timezone/locale/geo signals.
        extra_headers = {"x-faked-ip": fake_ip, "x-client-timezone": timezone_id} if fake_ip else {"x-client-timezone": timezone_id}
        context_kwargs: dict[str, Any] = {
            "user_agent": ua,
            "locale": locale,
            "timezone_id": timezone_id,
            "viewport": viewport,
            "screen": screen,
            "device_scale_factor": device_scale_factor,
            "has_touch": max_touch_points > 0,
            "is_mobile": False,
            "extra_http_headers": extra_headers,
        }
        if geoloc:
            context_kwargs["geolocation"] = geoloc
            context_kwargs["permissions"] = ["geolocation"]
        context = browser.new_context(**context_kwargs)
        # Inject stealth before any document scripts execute.
        context.add_init_script(_stealth_script(meta))
        # Belt-and-braces WebRTC hardening at the JS layer: strip any STUN/TURN
        # ICE servers a page tries to use, so candidate gathering can't surface a
        # non-proxied address even if the launch flag is ignored.
        context.add_init_script(_WEBRTC_GUARD_JS)
        page = context.new_page()
        page.set_default_timeout(int(os.environ.get("PW_STEP_TIMEOUT_MS", "8000")))
        page.set_default_navigation_timeout(int(os.environ.get("PW_NAV_TIMEOUT_MS", "10000")))

        def _dwell(lo: float = 0.6, hi: float = 1.6) -> None:
            # Human reading/thinking pause between page loads. Also keeps the
            # inter-request cadence well above the site's "too fast" threshold.
            page.wait_for_timeout(int(random.uniform(lo, hi) * 1000))

        try:
            # 1. Warm up like a real visitor: land, (maybe) read an info page.
            page.goto(f"{MOCK_URL}/", wait_until="domcontentloaded")
            _do_biometrics(page, meta, log)
            _dwell()
            page.goto(f"{MOCK_URL}/login", wait_until="domcontentloaded")

            # 2. Generate genuine pointer/scroll activity, then fill the form.
            #    This both satisfies the behavioural signal and lets the page's
            #    JS challenge populate js_token.
            page.wait_for_selector('input[name="license_number"]')
            _do_biometrics(page, meta, log)
            page.click('input[name="license_number"]')
            page.type('input[name="license_number"]', licence, delay=60)
            _dwell()
            page.eval_on_selector('input[name="license_number"]', "el => el.form.submit()")
            page.wait_for_url(re.compile(r"/search"))

            # 3. Search form: pick centre + date window, submit.
            page.wait_for_selector('input[name="from_date"]')
            _do_biometrics(page, meta, log)
            try:
                page.select_option('select[name="centre"]', label=centre)
            except Exception:
                pass  # centre may be free-text or preselected
            from datetime import datetime, timedelta, timezone
            today = datetime.now(timezone.utc)
            page.fill('input[name="from_date"]', today.strftime("%Y-%m-%d"))
            page.fill('input[name="to_date"]', (today + timedelta(days=28)).strftime("%Y-%m-%d"))
            _dwell()
            page.eval_on_selector('input[name="from_date"]', "el => el.form.submit()")
            try:
                page.wait_for_selector('input[name="slot_id"]', timeout=8000)
            except Exception:
                pass

            # 4. Scrape slots from the results page's booking forms.
            ids = page.eval_on_selector_all(
                'input[name="slot_id"]', "els => els.map(e => e.value)"
            )
            dts = page.eval_on_selector_all(
                'input[name="slot_datetime"]', "els => els.map(e => e.value)"
            )
            for sid, dt in zip(ids, dts):
                if sid and dt:
                    slots.append({"id": sid, "centre": centre, "datetime": dt})
            log.info(f"{centre}: browser discovery found {len(slots)} slots")
        finally:
            context.close()
            browser.close()
    return slots
