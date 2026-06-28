import json
with open(r"C:\Users\ayorindeawarun\CascadeProjects\testi-mvp\backend\dev-store.json") as f:
    db = json.load(f)
all_logs = db.get("audit_log", [])
alerts = [l for l in all_logs if l.get("event_type") == "slot_alert_sent"]
users = db.get("users", [])
prefs = db.get("user_preferences", [])
print(f"Total audit_log rows : {len(all_logs)}")
print(f"slot_alert_sent rows : {len(alerts)}")
print(f"Users                : {len(users)}")
print(f"User preferences     : {len(prefs)}")
for a in alerts:
    print(f"  entity_id={a.get('entity_id')} payload={a.get('payload')} created={a.get('created_at','')[:19]}")
if not alerts:
    # Show event_type distribution
    from collections import Counter
    c = Counter(l.get("event_type") for l in all_logs)
    print("\nEvent type counts:")
    for et, n in c.most_common(10):
        print(f"  {et}: {n}")
