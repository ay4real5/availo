import json, urllib.request
with urllib.request.urlopen("http://localhost:4000/api/audit") as r:
    d = json.loads(r.read())
logs = d.get("logs", [])
slot_logs = [l for l in logs if "slot" in l.get("event_type", "")]
print(f"Total audit entries: {len(logs)}")
print(f"Slot-related entries: {len(slot_logs)}")
for l in slot_logs[-5:]:
    print(f"  {l.get('event_type')} | entity_id={l.get('entity_id')} | created={l.get('created_at','')[:19]}")
