import json, urllib.request, urllib.error, time
from datetime import datetime, timedelta, timezone as tz

BASE = "http://localhost:4000"
def req(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {}

import random, string
# Use the Resend-verified address so a real email is delivered (sandbox restriction)
email = "buklord@proton.me"

print(f"1. Register/login {email}")
s, d = req("POST", "/api/auth/register", {"email": email, "password": "password123", "name": "Test User"})
if s == 409:
    s, d = req("POST", "/api/auth/login", {"email": email, "password": "password123"})
token = d.get("token")
print(f"   status={s}")

# Far-future test date so reported slots count as 'earlier' -> approved
far_future = (datetime.now(tz.utc) + timedelta(days=120)).strftime("%Y-%m-%dT09:00:00.000Z")
print("2. Save Bolton prefs (welcome email)")
s, d = req("POST", "/api/auth/preferences",
           {"centre": "Bolton", "current_test_date": far_future, "search_days_ahead": 42, "notify_email": True},
           headers={"Authorization": f"Bearer {token}"})
print(f"   status={s} centre={d.get('centre')}")

# Report Bolton slots earlier than the user's test date -> should approve + email
slots = [(datetime.now(tz.utc) + timedelta(days=i)).strftime("%Y-%m-%dT10:00:00.000Z") for i in range(3,6)]
print("3. Report earlier Bolton slots")
t0 = time.time()
s, d = req("POST", "/api/slots/report-centre", {"test_centre": "Bolton", "slots": slots},
           headers={"x-scraper-key": "dev-scraper-key"})
elapsed = time.time() - t0
print(f"   status={s} approved={d.get('approved')} emails_sent={d.get('emails_sent')} time={elapsed:.1f}s")

time.sleep(2)

import json as j2
with open(r"C:\Users\ayorindeawarun\CascadeProjects\testi-mvp\backend\dev-store.json") as f:
    db = j2.load(f)
alerts = [l for l in db.get("audit_log",[]) if l.get("event_type")=="slot_alert_sent"]
print(f"\nDevstore slot_alert_sent rows: {len(alerts)}")
for a in alerts[-3:]:
    print(f"  {a.get('payload')} @ {a.get('created_at','')[:19]}")
