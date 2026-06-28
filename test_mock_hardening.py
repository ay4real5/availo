"""
Verifies the DVSA-grade hardened mock site defends against naive bots while a
well-behaved client still completes the journey:

  1. Forged/tampered session token is rejected
  2. Login requires a valid proof-of-work solution
  3. Missing CSRF token blocks a booking (after a real PoW login)
  4. A bot-like device fingerprint (bad UA, missing headers) gets blocked
  5. A coherent browser fingerprint passes
  6. Booking a hidden honeypot/decoy slot blocks the IP
  7. A session is bound to its IP — replaying it from another IP is rejected
"""
import hashlib
import json
import random
import time
import urllib.error
import urllib.request

MOCK = "http://localhost:8000"


def call(method, path, headers=None, body=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body else None
    # Jittered pause so we stay well clear of the mock's timing fingerprint
    # (too-fast and too-regular cadences are both flagged).
    time.sleep(random.uniform(0.35, 0.8))
    r = urllib.request.Request(f"{MOCK}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


CLEAN = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/json;q=0.9",
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
}


def solve_pow(headers):
    """Brute-force a nonce for the mock's proof-of-work challenge."""
    s, d = call("GET", "/pow", headers=headers)
    challenge = d["challenge"]
    prefix = "0" * int(d["difficulty"])
    nonce = 0
    while not hashlib.sha256(f"{challenge}:{nonce}".encode()).hexdigest().startswith(prefix):
        nonce += 1
    return challenge, str(nonce)


def join_queue(headers):
    call("GET", "/queue/join", headers=headers)
    s, qj = call("GET", "/queue/join", headers=headers)
    qtoken = qj["queue_token"]
    for _ in range(8):
        s, qs = call("GET", f"/queue/status?token={qtoken}", headers=headers)
        if qs.get("allowed"):
            break
    return qtoken


def full_login(ip, licence="SMITH123456AB"):
    """Queue -> PoW -> login, the way the real scraper does it."""
    h = {**CLEAN, "x-faked-ip": ip}
    qtoken = join_queue(h)
    challenge, nonce = solve_pow(h)
    s, d = call("POST", "/login", headers=h, body={
        "license_number": licence,
        "queue_token": qtoken,
        "pow_challenge": challenge,
        "pow_nonce": nonce,
    })
    return s, d, h


passes = 0
fails = 0


def check(name, cond):
    global passes, fails
    if cond:
        passes += 1
        print(f"  PASS  {name}")
    else:
        fails += 1
        print(f"  FAIL  {name}")


print("Test 1: forged session token rejected")
s, d = call("POST", "/book", headers={**CLEAN, "x-faked-ip": "9.9.9.1", "x-session-token": "forged.deadbeef"}, body={"slot_id": "x"})
check("forged token -> 401 unauthenticated", s == 401)

print("Test 2: login requires proof-of-work")
h = {**CLEAN, "x-faked-ip": "9.9.9.20"}
qtoken = join_queue(h)
s, d = call("POST", "/login", headers=h, body={"license_number": "SMITH123456AB", "queue_token": qtoken})
check("login without PoW -> 403 pow_required", s == 403 and d.get("error") == "pow_required")

print("Test 3: PoW login succeeds; missing CSRF blocks booking")
s, login, h = full_login("9.9.9.2")
session = login.get("session_token")
csrf = login.get("csrf_token")
check("PoW login returns signed session + csrf", bool(session and "." in session and csrf))
s, d = call("POST", "/book", headers={**h, "x-session-token": session}, body={"slot_id": "bolton-x"})
check("book without CSRF -> 403 csrf_failed", s == 403 and d.get("error") == "csrf_failed")

print("Test 4: bot fingerprint gets blocked")
bot_headers = {"User-Agent": "python-httpx/0.28", "x-faked-ip": "7.7.7.7"}
blocked = False
for i in range(6):
    s, d = call("GET", "/queue/join", headers=bot_headers)
    if s == 403 and d.get("error") == "ip_blocked":
        blocked = True
        break
check("naive bot fingerprint -> blocked", blocked)

print("Test 5: clean fingerprint passes")
s, d = call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": "5.5.5.5"})
check("clean browser -> 200 queue join", s == 200)

print("Test 6: honeypot decoy slot blocks the IP")
ip6 = "9.9.9.30"
s, login, h = full_login(ip6)
session = login.get("session_token")
csrf = login.get("csrf_token")
decoy = None
for _ in range(12):
    s, d = call("POST", "/search", headers=h, body={"session_token": session, "centre": "Bolton"})
    decoy = next((x for x in d.get("slots", []) if not x.get("visible", True)), None)
    if decoy:
        break
check("search surfaced a hidden honeypot slot", bool(decoy))
if decoy:
    s, d = call("POST", "/book", headers={**h, "x-session-token": session, "x-csrf-token": csrf}, body={"slot_id": decoy["id"]})
    check("booking honeypot -> 403 honeypot_tripped", s == 403 and d.get("error") == "honeypot_tripped")
    s, d = call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": ip6})
    check("honeypot IP now hard-blocked", s == 403 and d.get("error") == "ip_blocked")

print("Test 7: session is bound to its IP")
s, login, h = full_login("9.9.9.40")
session = login.get("session_token")
# Replay the same session token from a DIFFERENT IP.
s, d = call("POST", "/search", headers={**CLEAN, "x-faked-ip": "9.9.9.41", "x-session-token": session},
            body={"session_token": session, "centre": "Bolton"})
check("session replayed from new IP -> 401 binding mismatch", s == 401 and d.get("error") == "session_binding_mismatch")

print(f"\n{passes} passed, {fails} failed")
import sys
sys.exit(0 if fails == 0 else 1)
