"""
Verifies the hardened mock DVSA defends against naive bots:
  1. Forged/tampered session token is rejected
  2. Missing CSRF token blocks a booking
  3. A bot-like device fingerprint (bad UA, missing headers) gets blocked
  4. A coherent browser fingerprint passes
"""
import json, urllib.request, urllib.error

MOCK = "http://localhost:8000"


def call(method, path, headers=None, body=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{MOCK}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
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
ip = "9.9.9.1"
s, d = call("POST", "/book", headers={**CLEAN, "x-faked-ip": ip, "x-session-token": "forged.deadbeef"}, body={"slot_id": "x"})
check("forged token -> 401 unauthenticated", s == 401)

print("Test 2: missing CSRF blocks booking")
ip = "9.9.9.2"
# join queue + login properly
call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": ip})
s, qj = call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": ip})
qtoken = qj["queue_token"]
# advance queue to 0
for _ in range(5):
    s, qs = call("GET", f"/queue/status?token={qtoken}", headers={**CLEAN, "x-faked-ip": ip})
    if qs.get("allowed"):
        break
s, login = call("POST", "/login", headers={**CLEAN, "x-faked-ip": ip}, body={"license_number": "SMITH123456AB", "queue_token": qtoken})
session = login.get("session_token")
csrf = login.get("csrf_token")
check("login returns signed session + csrf", bool(session and "." in session and csrf))
# book WITHOUT csrf
s, d = call("POST", "/book", headers={**CLEAN, "x-faked-ip": ip, "x-session-token": session}, body={"slot_id": "bolton-x"})
check("book without CSRF -> 403 csrf_failed", s == 403 and d.get("error") == "csrf_failed")

print("Test 3: bot fingerprint gets blocked")
bot_headers = {"User-Agent": "python-httpx/0.28", "x-faked-ip": "7.7.7.7"}
blocked = False
for i in range(6):
    s, d = call("GET", "/queue/join", headers=bot_headers)
    if s == 403 and d.get("error") == "ip_blocked":
        blocked = True
        break
check("naive bot fingerprint -> blocked", blocked)

print("Test 4: clean fingerprint passes")
s, d = call("GET", "/queue/join", headers={**CLEAN, "x-faked-ip": "5.5.5.5"})
check("clean browser -> 200 queue join", s == 200)

print(f"\n{passes} passed, {fails} failed")
import sys
sys.exit(0 if fails == 0 else 1)
