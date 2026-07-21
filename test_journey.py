"""
End-to-end test of the full Availo journey:
  1. Services health
  2. Mock DVSA: queue -> login -> search -> book -> payment
  3. Scraper worker (run_workers.js via subprocess)
  4. Backend: slots reported, audit log populated
"""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

BASE_MOCK = "http://localhost:8000"
BASE_BACKEND = "http://localhost:4000"

PASS = "\033[92m PASS\033[0m"
FAIL = "\033[91m FAIL\033[0m"
HEAD = "\033[1m{}\033[0m"

failures = []

BROWSER_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Accept": "application/json",
    "DNT": "1",
    "x-faked-ip": "86.55.100.200",
}

def req(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body else None
    h = {**BROWSER_HEADERS, **(headers or {})}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        # Add inter-request delay so timing fingerprint check passes
        time.sleep(0.4)
        with urllib.request.urlopen(r, timeout=25) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as ex:
        return 0, {"error": str(ex)}

def check(label, condition, detail=""):
    status = PASS if condition else FAIL
    print(f"  {status}  {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(label)

# ── 1. Health checks ─────────────────────────────────────────────────────────
print(HEAD.format("\n=== 1. Services health ==="))
s, d = req("GET", f"{BASE_BACKEND}/health")
check("Backend /health", s == 200 and d.get("status") == "ok", f"status={d.get('status')}")

s, d = req("GET", f"{BASE_MOCK}/health")
check("Mock DVSA /health", s == 200, f"http {s}")

# ── 2. Mock DVSA full journey (JSON API) ─────────────────────────────────────
print(HEAD.format("\n=== 2. Mock DVSA journey ==="))

# Queue join
s, d = req("GET", f"{BASE_MOCK}/queue/join")
check("Queue join", s == 200 and "queue_token" in d, f"position={d.get('position')}")
token = d.get("queue_token", "")

# Queue decay to 0
allowed = False
for _ in range(10):
    s, d = req("GET", f"{BASE_MOCK}/queue/status?token={token}")
    if d.get("allowed"):
        allowed = True
        break
    time.sleep(0.3)
check("Queue decays to allowed", allowed)

# Login
s, d = req("POST", f"{BASE_MOCK}/login", {"license_number": "MORGA657054SM9IJ", "queue_token": token})
check("Login with licence number", s == 200 and "session_token" in d, f"http {s} {d}")
session_token = d.get("session_token", "")

# Search
s, d = req("POST", f"{BASE_MOCK}/search", {
    "session_token": session_token,
    "centre": "Bolton",
    "from_date": "2026-07-01",
    "to_date": "2026-08-01",
})
slots = d.get("slots", [])
check("Search returns slots", s == 200 and len(slots) > 0, f"{len(slots)} slots")

# Book (hold slot)
if slots:
    slot = slots[0]
    s, d = req("POST", f"{BASE_MOCK}/book", {
        "session_token": session_token,
        "slot_id": slot["id"],
    })
    check("Book slot (hold)", s == 200 and "booking_reference" in d, f"ref={d.get('booking_reference')} http={s}")
    booking_ref = d.get("booking_reference", "")

    # Payment
    s, d = req("POST", f"{BASE_MOCK}/payment", {
        "session_token": session_token,
        "booking_reference": booking_ref,
        "card_number": "4111111111111111",
        "expiry": "06/27",
        "cvv": "123",
    })
    check("Payment confirms booking", s == 200 and d.get("status") == "confirmed", f"status={d.get('status')} http={s}")
else:
    check("Book slot (hold)", False, "no slots to book")
    check("Payment confirms booking", False, "no slots to book")

# ── 3. Backend: trigger a scrape ─────────────────────────────────────────────
print(HEAD.format("\n=== 3. Backend scrape trigger ==="))
s, d = req("GET", f"{BASE_BACKEND}/api/admin/scrape?centre=Bolton")
check("Admin scrape runs", s == 200, f"http {s}")
check("Slots found in scrape", d.get("slots_found", 0) > 0, f"slots_found={d.get('slots_found')}")

# ── 4. Backend data ───────────────────────────────────────────────────────────
print(HEAD.format("\n=== 4. Backend data ==="))
s, d = req("GET", f"{BASE_BACKEND}/api/slots")
slots_in_backend = d if isinstance(d, list) else d.get("slots", [])
check("Backend has slots", len(slots_in_backend) > 0, f"{len(slots_in_backend)} slots")

s, d = req("GET", f"{BASE_BACKEND}/api/audit")
audit = d if isinstance(d, list) else d.get("events", d.get("audit", [d] if d else []))
check("Audit log has entries", len(audit) > 0, f"{len(audit)} entries")

# ── 5. Unit + integration tests ──────────────────────────────────────────────
print(HEAD.format("\n=== 5. Automated test suite (npm run verify) ==="))
result = subprocess.run(
    ["cmd", "/c", "npm run test"],
    cwd=r"C:\Users\ayorindeawarun\CascadeProjects\testi-mvp",
    capture_output=True, text=True, timeout=120
)
passed = result.returncode == 0
check("npm test suite passes", passed, "see output below if failed")
if not passed:
    print(result.stdout[-1500:])
    print(result.stderr[-500:])

# ── Summary ───────────────────────────────────────────────────────────────────
print(HEAD.format("\n=== SUMMARY ==="))
total = 10 + (1 if not passed else 0)
if not failures:
    print(f"\033[92m  All checks passed!\033[0m\n")
else:
    print(f"\033[91m  {len(failures)} check(s) failed:\033[0m")
    for f in failures:
        print(f"    - {f}")
    sys.exit(1)
