import json
with open(r"C:\Users\ayorindeawarun\CascadeProjects\testi-mvp\backend\dev-store.json") as f:
    db = json.load(f)
prefs = db.get("user_preferences", [])
users = {u["id"]: u for u in db.get("users", [])}
print("User preferences:")
for p in prefs:
    u = users.get(p.get("user_id"), {})
    print(f"  email={u.get('email')} centre={p.get('centre')} notify_email={p.get('notify_email')}")
