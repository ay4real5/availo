import json, urllib.request, urllib.error, time

BASE = "http://localhost:4000"
PASS = "\033[92m PASS\033[0m"
FAIL = "\033[91m FAIL\033[0m"
failures = []

def req(method, path, body=None, token=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as ex:
        return 0, {"error": str(ex)}

def check(label, ok, detail=""):
    print(f"  {PASS if ok else FAIL}  {label}" + (f" — {detail}" if detail else ""))
    if not ok: failures.append(label)

print("\n=== Auth API Tests ===")

# Register
s, d = req("POST", "/api/auth/register", {"email": "availo@test.com", "password": "password123", "name": "Ada Smith"})
check("Register new user", s == 201 and "token" in d, f"status={s}")
token = d.get("token", "")
user_id = d.get("user", {}).get("id", "")

# Duplicate register
s, d = req("POST", "/api/auth/register", {"email": "availo@test.com", "password": "password123"})
check("Duplicate email rejected", s == 409, f"status={s} error={d.get('error')}")

# Login correct
s, d = req("POST", "/api/auth/login", {"email": "availo@test.com", "password": "password123"})
check("Login with correct password", s == 200 and "token" in d, f"status={s}")
token = d.get("token", token)

# Login wrong password
s, d = req("POST", "/api/auth/login", {"email": "availo@test.com", "password": "wrongpass"})
check("Login with wrong password rejected", s == 401, f"status={s}")

# /me
s, d = req("GET", "/api/auth/me", token=token)
check("/me returns user", s == 200 and d.get("email") == "availo@test.com", f"status={s}")

# /me no token
s, d = req("GET", "/api/auth/me")
check("/me without token is 401", s == 401, f"status={s}")

# Save preferences
s, d = req("POST", "/api/auth/preferences", {
    "centre": "Bolton",
    "current_test_date": "2026-10-01T09:00:00.000Z",
    "search_days_ahead": 42,
    "notify_email": True,
}, token=token)
check("Save preferences", s == 200 and d.get("centre") == "Bolton", f"status={s} centre={d.get('centre')}")

# Get preferences
s, d = req("GET", "/api/auth/preferences", token=token)
check("Get preferences", s == 200 and d.get("centre") == "Bolton", f"status={s}")

# My slots (may be empty but should 200)
s, d = req("GET", "/api/auth/my-slots", token=token)
check("My slots returns 200", s == 200 and "slots" in d, f"status={s} slots={len(d.get('slots',[]))}")

print(f"\n{'All passed!' if not failures else chr(10).join(['FAILED: ' + f for f in failures])}")
