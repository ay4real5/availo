"""
Directly call report-centre with a scraper key to trigger the email path.
"""
import json, urllib.request, urllib.error, time

BASE = "http://localhost:4000"

def req(method, path, body=None, extra_headers=None):
    h = {"Content-Type": "application/json", "x-scraper-key": "dev-scraper-key"}
    if extra_headers: h.update(extra_headers)
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {}

from datetime import datetime, timedelta, timezone

slots = [
    (datetime.now(timezone.utc) + timedelta(days=i)).strftime("%Y-%m-%dT09:00:00.000Z")
    for i in range(3, 8)
]

print("Calling /api/slots/report-centre with Bolton slots...")
s, d = req("POST", "/api/slots/report-centre", {
    "test_centre": "Bolton",
    "slots": slots,
})
print(f"  status={s}")
print(f"  response={json.dumps(d, indent=2)}")

time.sleep(1)
print("\nChecking audit log for slot_alert_sent...")
s2, d2 = req("GET", "/api/audit?event_type=slot_alert_sent")
logs = d2.get("logs", [])
print(f"  {len(logs)} slot_alert_sent entries found")
for l in logs:
    print(f"    entity_id={l.get('entity_id')} payload={l.get('payload')}")
