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
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

MOCK = "http://localhost:8000"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scraper"))


def get_html(path, headers=None):
    """Fetch a page as a browser would, returning (status, html_text)."""
    h = {}
    if headers:
        h.update(headers)
    h["Accept"] = "text/html"  # a browser navigation, not an API call
    time.sleep(random.uniform(0.35, 0.8))
    r = urllib.request.Request(f"{MOCK}{path}", headers=h, method="GET")
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def post_form(path, fields, headers=None, follow=True):
    """POST a form like a browser (urlencoded, text/html accept)."""
    h = {}
    if headers:
        h.update(headers)
    h["Accept"] = "text/html"  # browser form post (not an API/JSON call)
    h["Content-Type"] = "application/x-www-form-urlencoded"
    data = urllib.parse.urlencode(fields).encode()
    time.sleep(random.uniform(0.35, 0.8))
    r = urllib.request.Request(f"{MOCK}{path}", data=data, headers=h, method="POST")
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(r, timeout=20) as resp:
            return resp.status, resp.read().decode(), resp.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), getattr(e, "url", path)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def js_token_for(seed):
    """Mirror the page's JS challenge computation."""
    n = int(seed.rpartition(".")[0])
    return str((n * 7919 + 104729) % 1000000007)


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

print("Test 8: geo-incoherent identity (UK IP, foreign locale/timezone) is flagged")
incoherent = {
    **CLEAN,
    "Accept-Language": "fr-FR,fr;q=0.9",   # not English
    "x-client-timezone": "America/New_York",  # not Europe/London
    "x-faked-ip": "86.50.60.70",            # UK residential range
}
geo_blocked = False
for _ in range(5):
    s, d = call("GET", "/queue/join", headers=incoherent)
    if s == 403:
        geo_blocked = True
        break
check("UK IP with fr-FR + US timezone -> 403", geo_blocked)
# A coherent UK identity (en-GB + Europe/London) on a UK IP still passes.
s, d = call("GET", "/queue/join", headers={**CLEAN, "x-client-timezone": "Europe/London", "x-faked-ip": "81.20.30.40"})
check("UK IP with en-GB + Europe/London -> 200", s == 200)

print("Test 9: session warming — a cold start is recorded")
s0, a0 = call("GET", "/api/analytics")
cold_before = a0.get("cold_starts", 0)
# A fresh IP that hits the API without first landing on a page is a cold start.
call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": "5.6.7.8"})
s1, a1 = call("GET", "/api/analytics")
check("cold start recorded for un-warmed IP", a1.get("cold_starts", 0) > cold_before)

print("Test 10: JS challenge on the browser login (#1)")
# Browser fetches the login page and runs JS to derive js_token from the seed.
sh, html = get_html("/login", headers={**CLEAN, "x-faked-ip": "82.0.0.9"})
m = re.search(r'name="js_seed"[^>]*value="([^"]+)"', html)
check("login page issues a signed JS-challenge seed", bool(m))
seed = m.group(1) if m else ""
# Without js_token the scriptless client is rejected.
s, body, _ = post_form("/login", {
    "license_number": "SMITH123456AB", "queue_token": "qx",
    "human_signal": "9",
}, headers={**CLEAN, "x-faked-ip": "82.1.1.1"}, follow=False)
check("browser login without js_token -> 403", s == 403)
# With the correct js_token and human activity it succeeds (redirects to /search).
s, body, url = post_form("/login", {
    "license_number": "SMITH123456AB", "queue_token": "qy",
    "js_seed": seed, "js_token": js_token_for(seed), "human_signal": "9",
}, headers={**CLEAN, "x-faked-ip": "82.1.1.2"}, follow=True)
check("browser login with valid js_token -> reaches /search", "/search" in url)

print("Test 11: behavioural biometrics on the browser login (#2)")
sh, html = get_html("/login", headers={**CLEAN, "x-faked-ip": "82.2.2.1"})
m = re.search(r'name="js_seed"[^>]*value="([^"]+)"', html)
seed2 = m.group(1) if m else ""
# Correct JS token but ZERO human motion signal -> rejected as a motionless bot.
s, body, _ = post_form("/login", {
    "license_number": "SMITH123456AB", "queue_token": "qz",
    "js_seed": seed2, "js_token": js_token_for(seed2), "human_signal": "0",
}, headers={**CLEAN, "x-faked-ip": "82.2.2.2"}, follow=False)
check("motionless browser login (human_signal=0) -> 403", s == 403)

print("Test 12: fleet-wide detection circuit breaker (#4)")
import tempfile
os.environ["DETECTION_CB_STATE_FILE"] = os.path.join(tempfile.gettempdir(), f"cb_{random.randint(0,99999)}.json")
import circuit
circuit.STATE_FILE = os.environ["DETECTION_CB_STATE_FILE"]
if os.path.exists(circuit.STATE_FILE):
    os.remove(circuit.STATE_FILE)
opened = False
for _ in range(circuit.WINDOW):
    st = circuit.record(detected=True)
    if st["open"]:
        opened = True
        break
check("breaker trips after sustained detection", opened)
raised = False
try:
    circuit.check()
except circuit.CircuitOpenError:
    raised = True
check("check() raises while breaker is open", raised)

print(f"\n{passes} passed, {fails} failed")
sys.exit(0 if fails == 0 else 1)
