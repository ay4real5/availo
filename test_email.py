"""
Quick test: register a fresh user, set preferences, trigger a scrape, 
then check backend logs confirm email dispatch.
"""
import json, urllib.request, urllib.error, time, random, string

BASE = "http://localhost:4000"
PASS = "\033[92m PASS\033[0m"
FAIL = "\033[91m FAIL\033[0m"
failures = []

def req(method, path, body=None, token=None, extra_headers=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    if extra_headers: h.update(extra_headers)
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {}
    except Exception as ex:
        return 0, {"error": str(ex)}

def check(label, ok, detail=""):
    print(f"  {PASS if ok else FAIL}  {label}" + (f" — {detail}" if detail else ""))
    if not ok: failures.append(label)

# Use a unique email each run
tag = "".join(random.choices(string.ascii_lowercase, k=6))
email = f"test_{tag}@availo-test.com"

print(f"\n=== Email Integration Test (user: {email}) ===")

# 1. Register
s, d = req("POST", "/api/auth/register", {"email": email, "password": "testpass99", "name": "Ada Lovelace"})
check("Register", s == 201, f"status={s}")
token = d.get("token", "")

# 2. Save preferences (triggers welcome email)
s, d = req("POST", "/api/auth/preferences", {
    "centre": "Bolton",
    "current_test_date": "2027-01-01T09:00:00.000Z",
    "search_days_ahead": 42,
    "notify_email": True,
}, token=token)
check("Save prefs (welcome email triggered)", s == 200, f"status={s} centre={d.get('centre')}")

# 3. Give backend a moment to send the welcome email
time.sleep(1)

# 4. Report slots for Bolton directly — this is what triggers emails
from datetime import datetime, timedelta, timezone as tz
slots_to_report = [
    (datetime.now(tz.utc) + timedelta(days=i)).strftime("%Y-%m-%dT10:00:00.000Z")
    for i in range(3, 8)
]
s, d = req("POST", "/api/slots/report-centre",
           {"test_centre": "Bolton", "slots": slots_to_report},
           extra_headers={"x-scraper-key": "dev-scraper-key"})
check("Report Bolton slots", s == 201, f"status={s} approved={d.get('approved')} emails_sent={d.get('emails_sent')}")

# 5. Check audit log for slot_alert_sent event
time.sleep(1)
s, d = req("GET", "/api/audit?event_type=slot_alert_sent")
events = d.get("logs", d.get("events", []))
check("slot_alert_sent recorded in audit log", len(events) > 0, f"{len(events)} event(s)")

# 6. Check my-slots returns matched slots
s, d = req("GET", "/api/auth/my-slots", token=token)
slots = d.get("slots", [])
check("my-slots returns matched slots", s == 200 and len(slots) > 0, f"{len(slots)} slots")

print(f"\n{'All passed!' if not failures else chr(10).join(['FAILED: ' + f for f in failures])}")
print("\nCheck your backend terminal for '[email] Sent ...' lines confirming Resend API calls.")
