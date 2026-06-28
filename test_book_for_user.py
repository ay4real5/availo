"""
End-to-end test: scraper books a slot for a REAL user using their licence + card.

Steps:
  1. Register a user
  2. Save prefs (Bolton, far-future target date, auto_book=true, licence)
  3. Save a tokenised payment method (test card)
  4. Run the scraper worker for Bolton with AUTO_BOOK=true
  5. Verify a confirmed booking exists attributed to THAT user
"""
import json, os, random, string, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone as tz

BASE = "http://localhost:4000"
SCRAPER_DIR = os.path.join(os.path.dirname(__file__), "scraper")


def req(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


email = "booktest_" + "".join(random.choices(string.ascii_lowercase, k=6)) + "@availo-test.com"
licence = "SMITH" + "".join(random.choices(string.digits, k=6)) + "AB9CD"

print(f"1. Register {email}")
s, d = req("POST", "/api/auth/register", {"email": email, "password": "password123", "name": "Book Test"})
assert s == 201, d
token = d["token"]
user_id = d["user"]["id"]
print(f"   user_id={user_id}")

far_future = (datetime.now(tz.utc) + timedelta(days=120)).strftime("%Y-%m-%dT09:00:00.000Z")
print("2. Save prefs with auto_book=true + licence")
s, d = req("POST", "/api/auth/preferences", {
    "centre": "Bolton",
    "current_test_date": far_future,
    "search_days_ahead": 42,
    "notify_email": True,
    "auto_book": True,
    "licence_number": licence,
}, headers={"Authorization": f"Bearer {token}"})
assert s == 200, d
print(f"   auto_book={d.get('auto_book')} licence={d.get('licence_number')}")

print("3. Save payment method (test card 4242...)")
s, d = req("POST", "/api/auth/payment-method", {
    "number": "4242424242424242",
    "exp_month": 12,
    "exp_year": datetime.now().year + 2,
    "cvc": "123",
    "name": "Book Test",
}, headers={"Authorization": f"Bearer {token}"})
assert s == 201, d
print(f"   saved card {d.get('card_brand')} ****{d.get('card_last4')} exp {d.get('card_exp')}")

print("4. Verify backend lists this user as a booking request")
s, d = req("GET", "/api/scraper/booking-requests?centre=Bolton", headers={"x-scraper-key": "dev-scraper-key"})
mine = [r for r in d.get("requests", []) if r["user_id"] == user_id]
print(f"   requests for Bolton: {len(d.get('requests', []))}, mine: {len(mine)}")
assert mine, "user not eligible as a booking request"
assert mine[0]["payment_token"].startswith("tok_"), "payment token not passed"

print("5. Run scraper worker (AUTO_BOOK=true) for Bolton ...")
env = dict(os.environ)
env.update({
    "AUTO_BOOK": "true",
    "BACKEND_URL": BASE,
    "MOCK_URL": "http://localhost:8000",
    "SCRAPER_API_KEY": "dev-scraper-key",
})
proc = subprocess.run([sys.executable, "worker.py", "--centre", "Bolton"],
                      cwd=SCRAPER_DIR, env=env, capture_output=True, text=True, timeout=300)
# Surface the key worker log lines
for line in (proc.stderr or proc.stdout).splitlines():
    if any(k in line for k in ["booking confirmed", "auto-book", "slot held", "found", "payment failed", "ERROR"]):
        print("   |", line.strip()[:140])

time.sleep(2)

print("6. Verify a confirmed booking is attributed to this user")
s, d = req("GET", f"/api/slots/bookings?user_id={user_id}")
bookings = d.get("bookings", [])
print(f"   bookings for user: {len(bookings)}")
for b in bookings:
    print(f"     {b.get('booking_reference')} {b.get('test_centre')} {b.get('slot_datetime')} {b.get('status')}")

if bookings and any(b.get("status") == "confirmed" for b in bookings):
    print("\nRESULT: PASS — scraper booked a slot for the correct user with their card.")
    sys.exit(0)
else:
    print("\nRESULT: FAIL — no confirmed booking for this user.")
    sys.exit(1)
