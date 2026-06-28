"""
Playwright real-browser discovery (opt-in hybrid).

The fast curl_cffi path is great for high-frequency polling, but the most
detection-sensitive moment is the interactive journey (JS challenges, canvas /
WebGL fingerprinting, real event timing). This module drives the mock site's
*HTML* journey with a genuine headless Chromium so discovery looks exactly like
a real candidate using a browser. Found slots are then handed back to the worker,
which completes the booking via the secure tokenised path.

Enable with USE_PLAYWRIGHT=true. If Playwright or its browser binary is not
installed, `available()` returns False and the worker falls back to curl_cffi.
"""
from __future__ import annotations

import os
import re
from typing import Any

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


def discover_with_browser(centre: str, ua: str, proxy: str | None, licence: str, log, fake_ip: str | None = None) -> list[dict[str, Any]]:
    """Run the HTML journey in a real browser and return discovered slots.

    Returns a list of {id, centre, datetime} dicts (same shape as the JSON API).
    Raises if Playwright's browser binary is missing so the caller can fall back.
    """
    slots: list[dict[str, Any]] = []
    fake_ip = fake_ip or os.environ.get("PW_FAKE_IP") or ""
    with sync_playwright() as p:
        launch_kwargs: dict[str, Any] = {"headless": True}
        proxy_cfg = _proxy_settings(proxy)
        if proxy_cfg:
            launch_kwargs["proxy"] = proxy_cfg
        browser = p.chromium.launch(**launch_kwargs)
        context = browser.new_context(
            user_agent=ua,
            locale="en-GB",
            viewport={"width": 1366, "height": 768},
            extra_http_headers={"x-faked-ip": fake_ip} if fake_ip else None,
        )
        page = context.new_page()
        # Fail fast: if any step stalls, raise quickly so the worker can fall
        # back to the curl_cffi path rather than hanging.
        page.set_default_timeout(int(os.environ.get("PW_STEP_TIMEOUT_MS", "8000")))
        page.set_default_navigation_timeout(int(os.environ.get("PW_NAV_TIMEOUT_MS", "10000")))
        try:
            # 1. Establish a session on the landing page, then go to login.
            page.goto(f"{MOCK_URL}/", wait_until="domcontentloaded")
            page.goto(f"{MOCK_URL}/login", wait_until="domcontentloaded")

            # 2. Login form (licence). Submit via the owning form (robust).
            page.wait_for_selector('input[name="license_number"]')
            page.fill('input[name="license_number"]', licence)
            page.eval_on_selector('input[name="license_number"]', "el => el.form.submit()")
            page.wait_for_url(re.compile(r"/search"))

            # 3. Search form: pick centre + date window, submit.
            page.wait_for_selector('input[name="from_date"]')
            try:
                page.select_option('select[name="centre"]', label=centre)
            except Exception:
                pass  # centre may be free-text or preselected
            from datetime import datetime, timedelta, timezone
            today = datetime.now(timezone.utc)
            page.fill('input[name="from_date"]', today.strftime("%Y-%m-%d"))
            page.fill('input[name="to_date"]', (today + timedelta(days=28)).strftime("%Y-%m-%d"))
            page.eval_on_selector('input[name="from_date"]', "el => el.form.submit()")
            # Best-effort: wait for results to render. If the mock redirects or
            # shows no slots, we simply scrape nothing and the worker falls back.
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
