"""
CAPTCHA solver simulator.

In production this module would integrate with a service like 2captcha or
Anti-Captcha. For local development it simulates a solver by posting the
mock challenge back to the mock site.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

MOCK_URL = os.environ.get("MOCK_URL", "http://localhost:8000")
SOLVER_DELAY_SECONDS = float(os.environ.get("CAPTCHA_SOLVER_DELAY", "2"))
# Set this to route challenges to a real solving service (e.g. 2captcha).
TWOCAPTCHA_API_KEY = os.environ.get("TWOCAPTCHA_API_KEY", "")
TWOCAPTCHA_TIMEOUT = float(os.environ.get("TWOCAPTCHA_TIMEOUT", "120"))


# Maps a CAPTCHA family to the 2captcha "method" and the field carrying the
# site key. Lets one wrapper handle reCAPTCHA v2/v3, hCaptcha and Cloudflare
# Turnstile — the three challenges a DVSA-class site is most likely to deploy.
_PROVIDER_METHODS = {
    "recaptcha": ("userrecaptcha", "googlekey"),
    "hcaptcha": ("hcaptcha", "sitekey"),
    "turnstile": ("turnstile", "sitekey"),
}


def _solve_with_2captcha(
    challenge: str,
    sitekey: str | None = None,
    url: str | None = None,
    captcha_type: str | None = None,
) -> dict[str, Any] | None:
    """Integration point for a real CAPTCHA-solving provider (2captcha).

    Returns a solver result dict on success, or None to fall back to simulation.
    This is a thin, provider-agnostic wrapper: swap the endpoints/payload to use
    Anti-Captcha, CapMonster, etc. Requires TWOCAPTCHA_API_KEY to be set.

    ``captcha_type`` selects the challenge family ("recaptcha" | "hcaptcha" |
    "turnstile"); when omitted it is inferred from whether a site key is present.
    """
    if not TWOCAPTCHA_API_KEY:
        return None
    # Pick the provider method/keyfield for the challenge family.
    if captcha_type is None:
        captcha_type = "recaptcha" if sitekey else "text"
    method, key_field = _PROVIDER_METHODS.get(captcha_type, ("post", None))
    try:
        # 1. Submit the challenge.
        payload: dict[str, Any] = {
            "key": TWOCAPTCHA_API_KEY,
            "method": method,
            "pageurl": url or MOCK_URL,
            "json": 1,
        }
        if key_field and sitekey:
            payload[key_field] = sitekey
        if method == "post":
            payload["textcaptcha"] = challenge
        submit = httpx.post(
            "https://2captcha.com/in.php",
            data=payload,
            timeout=30.0,
        ).json()
        if submit.get("status") != 1:
            print(f"[captcha_solver] 2captcha submit failed: {submit}")
            return None
        req_id = submit["request"]
        # 2. Poll for the result.
        deadline = time.time() + TWOCAPTCHA_TIMEOUT
        while time.time() < deadline:
            time.sleep(5)
            poll = httpx.get(
                "https://2captcha.com/res.php",
                params={"key": TWOCAPTCHA_API_KEY, "action": "get", "id": req_id, "json": 1},
                timeout=30.0,
            ).json()
            if poll.get("status") == 1:
                return {"token": poll["request"], "provider": "2captcha"}
            if poll.get("request") != "CAPCHA_NOT_READY":
                print(f"[captcha_solver] 2captcha error: {poll}")
                return None
        print("[captcha_solver] 2captcha timed out")
        return None
    except Exception as e:
        print(f"[captcha_solver] 2captcha exception: {e}")
        return None


def solve_challenge(
    challenge: str,
    sitekey: str | None = None,
    url: str | None = None,
    captcha_type: str | None = None,
) -> dict[str, Any]:
    """Solve a CAPTCHA challenge.

    Uses a real provider (2captcha) when TWOCAPTCHA_API_KEY is configured;
    otherwise simulates a solve that the mock site accepts. ``captcha_type``
    selects the challenge family ("recaptcha" | "hcaptcha" | "turnstile").
    """
    real = _solve_with_2captcha(challenge, sitekey=sitekey, url=url, captcha_type=captcha_type)
    if real:
        return real
    time.sleep(SOLVER_DELAY_SECONDS)
    token = f"solved-{challenge}-{int(time.time())}"
    return {"token": token, "provider": "simulated"}


def submit_solution(challenge: str, token: str) -> bool:
    """Submit the solution to the mock site and return success/failure."""
    try:
        resp = httpx.post(
            f"{MOCK_URL}/captcha/solve",
            json={"challenge": challenge, "token": token},
            timeout=10.0,
        )
        return resp.status_code == 200 and resp.json().get("success", False)
    except Exception as e:
        print(f"[captcha_solver] submission failed: {e}")
        return False


def solve_and_submit(
    challenge: str,
    sitekey: str | None = None,
    url: str | None = None,
    captcha_type: str | None = None,
) -> dict[str, Any]:
    """Solve the challenge and submit it. Return the solver result."""
    result = solve_challenge(challenge, sitekey=sitekey, url=url, captcha_type=captcha_type)
    result["accepted"] = submit_solution(challenge, result["token"])
    return result
