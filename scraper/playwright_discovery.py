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


def _proxy_settings(proxy: str | None) -> dict[str, str] | None:
    if not proxy or not proxy.startswith(("http://", "https://", "socks5://", "socks5h://", "socks4://")):
        return None
    return {"server": proxy}


def _stealth_script(meta: dict) -> str:
    """JS injected before any page script runs, to erase automation tells and
    make the WebGL/navigator surface coherent with the chosen identity."""
    vendor = meta.get("webgl_vendor", "Google Inc. (Intel)")
    renderer = meta.get("webgl_renderer", "ANGLE (Intel)")
    languages = meta.get("languages", ["en-GB", "en"])
    return f"""
    // navigator.webdriver -> undefined (the canonical headless tell)
    Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
    // Plausible language list.
    Object.defineProperty(navigator, 'languages', {{ get: () => {languages!r} }});
    // Non-empty plugins/mimeTypes like a real Chrome.
    Object.defineProperty(navigator, 'plugins', {{ get: () => [1,2,3,4,5] }});
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
    geoloc = meta.get("geolocation")

    with sync_playwright() as p:
        launch_kwargs: dict[str, Any] = {
            "headless": True,
            "args": ["--disable-blink-features=AutomationControlled"],
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
            "extra_http_headers": extra_headers,
        }
        if geoloc:
            context_kwargs["geolocation"] = geoloc
            context_kwargs["permissions"] = ["geolocation"]
        context = browser.new_context(**context_kwargs)
        # Inject stealth before any document scripts execute.
        context.add_init_script(_stealth_script(meta))
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
