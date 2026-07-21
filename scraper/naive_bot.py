"""
A deliberately NAIVE bot, to demonstrate that the hardened mock DVSA site blocks
unsophisticated automation. It does everything a lazy scraper does:

  * default Python HTTP client (gives away a `python-*` User-Agent + no browser headers)
  * no proof-of-work
  * fixed, machine-regular request timing
  * books the first slot it sees (including invisible honeypot decoys)

Run the mock site first (scraper/mock_site/server.py), then:

    python naive_bot.py

Expected outcome: it is stopped by one of the DVSA-grade defences (device
fingerprint block, proof-of-work gate, or honeypot) — i.e. it never books.
Compare with worker.py, which passes all of them.
"""
from __future__ import annotations

import os
import time

import httpx

MOCK = os.environ.get("MOCK_URL", "http://localhost:8000")
IP = os.environ.get("NAIVE_IP", "203.0.113.66")


def main() -> int:
    # Default client: python-httpx UA, no Accept-Language/Encoding, no client hints.
    client = httpx.Client(headers={"x-faked-ip": IP}, timeout=15.0)
    print(f"[naive-bot] hammering {MOCK} from {IP} with no evasion at all\n")

    blocked_reason = None
    for step in range(1, 9):
        time.sleep(0.15)  # fixed, machine-regular cadence
        try:
            r = client.get(f"{MOCK}/queue/join")
        except Exception as e:
            print(f"  request error: {e}")
            return 1
        body = {}
        try:
            body = r.json()
        except Exception:
            pass
        err = body.get("error", "")
        print(f"  step {step}: GET /queue/join -> {r.status_code} {err or 'ok'}")
        if r.status_code == 403 and err == "ip_blocked":
            blocked_reason = "device-fingerprint block (bad UA / missing headers / timing)"
            break
        if r.status_code == 403 and err == "captcha_required":
            blocked_reason = "CAPTCHA challenge (flagged as suspicious)"
            break

    # Even if it somehow got a queue token, try to log in with NO proof-of-work.
    if not blocked_reason:
        time.sleep(0.15)
        qtoken = body.get("queue_token", "")
        r = client.post(f"{MOCK}/login", json={"license_number": "SMITH123456AB", "queue_token": qtoken})
        try:
            err = r.json().get("error", "")
        except Exception:
            err = ""
        print(f"  login (no proof-of-work) -> {r.status_code} {err}")
        if r.status_code == 403 and err in ("pow_required", "captcha_required", "ip_blocked"):
            blocked_reason = "proof-of-work gate (no PoW solution supplied)"

    print()
    if blocked_reason:
        print(f"[naive-bot] BLOCKED by: {blocked_reason}")
        print("[naive-bot] RESULT: the hardened mock stopped the naive bot.")
        return 0
    print("[naive-bot] RESULT: naive bot was NOT blocked - defences too weak.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
