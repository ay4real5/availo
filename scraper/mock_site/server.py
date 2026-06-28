"""
Realistic mock DVSA driving test booking site.

Simulates the full candidate journey:
  1. Queue / waiting room
  2. Login with driving licence number
  3. Search for available test dates by centre and date range
  4. Select a slot and enter mock payment details
  5. Receive a booking confirmation

Also includes anti-bot countermeasures: rate limiting, CAPTCHA, honeypot
links, delays, and session expiry.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import secrets
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, urlencode

from templates import (
    page_home, page_queue, page_login, page_search, page_results,
    page_book_confirm, page_payment, page_confirmation, page_error, page_analytics,
)

# Bind to 0.0.0.0 so the server is reachable when running in a container / on a
# managed host (Render, etc.); defaults stay localhost-friendly for local dev.
HOST = os.environ.get("MOCK_HOST", "0.0.0.0")
# Managed hosts inject $PORT; fall back to MOCK_PORT then 8000 for local use.
PORT = int(os.environ.get("PORT", os.environ.get("MOCK_PORT", "8000")))

# Secret used to HMAC-sign session + CSRF tokens so forged tokens are rejected.
MOCK_SECRET = os.environ.get("MOCK_SECRET", "mock-dvsa-signing-secret").encode()
# Where persistent anti-bot state is stored across restarts.
STATE_FILE = os.environ.get("MOCK_STATE_FILE", os.path.join(os.path.dirname(__file__), ".mock_state.json"))
# Device-fingerprint risk score (0-100) above which a request is challenged/blocked.
FINGERPRINT_BLOCK_SCORE = int(os.environ.get("FINGERPRINT_BLOCK_SCORE", "70"))
FINGERPRINT_CAPTCHA_SCORE = int(os.environ.get("FINGERPRINT_CAPTCHA_SCORE", "45"))

# In-memory site state (lost on server restart, which is fine for a mock).
stats = {
    "requests": 0,
    "bot_traps": 0,
    "captcha_hits": 0,
    "logins": 0,
    "queue_joins": 0,
    "searches": 0,
    "bookings": 0,
    "payments": 0,
}
flagged_ips: set[str] = set()
rate_limit: dict[str, list[float]] = {}

# Queue: token -> position. Position 0 means allowed through.
queue: dict[str, int] = {}

# Sessions: token -> session dict.
sessions: dict[str, dict] = {}

# Slot inventory: (centre, iso_datetime) -> slot dict.
slot_inventory: dict[str, dict] = {}

BOOKING_TTL_SECONDS = 600
SESSION_TTL_SECONDS = 1800
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 30
QUEUE_DECAY_PROBABILITY = 0.6
CAPTCHA_RATE_THRESHOLD = 20
IP_BLOCK_TRAP_HITS = 2          # block IP after this many bot-trap hits
SLOT_VANISH_PROBABILITY = 0.15  # chance a slot disappears between search and book
SUSPICIOUS_INTERVAL_MS = 300    # requests faster than this (ms) are flagged

# Per-IP: number of bot-trap hits
bot_trap_hits: dict[str, int] = {}
# Per-IP: timestamp of last request (for timing fingerprint)
last_request_time: dict[str, float] = {}
# Per-IP: captcha solve count (escalation)
captcha_solves: dict[str, int] = {}
# Blocked IPs (persisted across restarts)
blocked_ips: set[str] = set()
# Per-IP: cumulative device-fingerprint risk score (persisted)
fingerprint_scores: dict[str, float] = {}


# ── Persistence ───────────────────────────────────────────────────────────────
def _load_state() -> None:
    """Restore blocked IPs, fingerprint scores and stats from disk."""
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        blocked_ips.update(data.get("blocked_ips", []))
        fingerprint_scores.update(data.get("fingerprint_scores", {}))
        for k, v in data.get("stats", {}).items():
            if k in stats:
                stats[k] = v
        print(f"[mock-dvsa] restored state: {len(blocked_ips)} blocked IPs, {len(fingerprint_scores)} scored IPs")
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[mock-dvsa] could not load state: {e}")


def _save_state() -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "blocked_ips": sorted(blocked_ips),
                "fingerprint_scores": fingerprint_scores,
                "stats": stats,
            }, f)
    except Exception as e:
        print(f"[mock-dvsa] could not save state: {e}")


# ── Signed tokens (HMAC) ───────────────────────────────────────────────────────
def _sign(value: str) -> str:
    """Return value.signature where signature is an HMAC over value."""
    sig = hmac.new(MOCK_SECRET, value.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{value}.{sig}"


def _verify_signed(token: str | None) -> bool:
    """Validate an HMAC-signed token; rejects tampered/forged tokens."""
    if not token or "." not in token:
        return False
    value, _, sig = token.rpartition(".")
    expected = hmac.new(MOCK_SECRET, value.encode(), hashlib.sha256).hexdigest()[:16]
    return hmac.compare_digest(sig, expected)


def _new_signed_token() -> str:
    return _sign(secrets.token_urlsafe(16))


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _random_token() -> str:
    return secrets.token_urlsafe(16)


def _generate_slot_id(centre: str, dt: datetime) -> str:
    return f"{centre.lower().replace(' ', '-')}-{_iso(dt)}"


def _get_or_create_slots(centre: str, from_date: str, to_date: str) -> list[dict]:
    """Return available slots for a centre and date range, generating them on demand."""
    start = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
    end = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
    slots: list[dict] = []
    current = start
    while current <= end:
        # 40% chance any given day has at least one slot.
        if random.random() < 0.4:
            for _ in range(random.randint(1, 3)):
                hour = random.randint(8, 17)
                minute = random.choice([0, 10, 20, 30, 40, 50])
                slot_dt = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
                key = f"{centre}-{_iso(slot_dt)}"
                if key not in slot_inventory:
                    slot_inventory[key] = {
                        "id": _generate_slot_id(centre, slot_dt),
                        "centre": centre,
                        "datetime": _iso(slot_dt),
                        "available": True,
                        "held_until": None,
                        "booked_by": None,
                    }
                slot = slot_inventory[key]
                if slot["available"] and (slot["held_until"] is None or _now() > slot["held_until"]):
                    slots.append({
                        "id": slot["id"],
                        "centre": slot["centre"],
                        "datetime": slot["datetime"],
                    })
        current += timedelta(days=1)
    return sorted(slots, key=lambda s: s["datetime"])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, body: dict):
        self._send(status, json.dumps(body).encode(), "application/json")

    def _html(self, status: int, body: str):
        self._send(status, body.encode(), "text/html")

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length).decode()
        content_type = self.headers.get("Content-Type", "")
        if "application/x-www-form-urlencoded" in content_type:
            from urllib.parse import parse_qs as _pqs
            parsed = _pqs(raw)
            return {k: v[0] for k, v in parsed.items()}
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _client_ip(self) -> str:
        return self.headers.get("x-faked-ip") or self.client_address[0]

    def _is_bot_fingerprint(self, ip: str) -> bool:
        """Detect bot-like request patterns."""
        ua = self.headers.get("User-Agent", "")
        # Headless / automation UAs
        if any(s in ua.lower() for s in ["headless", "phantomjs", "selenium", "puppeteer", "python-httpx", "python-requests", "curl", "wget"]):
            return True
        # Missing browser headers that all real browsers always send
        if not self.headers.get("Accept-Language"):
            return True
        if not self.headers.get("Accept-Encoding"):
            return True
        # Request timing: real humans don't hit endpoints faster than 300ms apart
        now_ts = time.time()
        last = last_request_time.get(ip, 0)
        interval_ms = (now_ts - last) * 1000
        last_request_time[ip] = now_ts
        if last > 0 and interval_ms < SUSPICIOUS_INTERVAL_MS:
            stats["bot_traps"] += 1
            return True
        return False

    def _device_fingerprint_score(self, ip: str) -> float:
        """Score how bot-like the request's device fingerprint is (0-100).

        Real anti-bot systems cross-check that the UA, Sec-CH-UA client hints and
        platform are mutually consistent, and that standard browser headers are
        present. Inconsistencies accumulate risk.
        """
        ua = self.headers.get("User-Agent", "")
        ua_l = ua.lower()
        score = 0.0

        # Obvious automation tooling in the UA.
        if any(s in ua_l for s in [
            "headless", "selenium", "puppeteer", "playwright", "phantomjs",
            "python-", "httpx", "curl", "wget", "go-http", "java/", "okhttp",
        ]):
            score += 60

        # Standard headers every real browser sends.
        if not self.headers.get("Accept-Language"):
            score += 25
        if not self.headers.get("Accept-Encoding"):
            score += 20
        if not self.headers.get("Accept"):
            score += 15

        # Client-hint consistency for Chromium-family browsers.
        is_chromium = ("chrome/" in ua_l or "edg/" in ua_l) and "firefox" not in ua_l
        sec_ua = self.headers.get("Sec-CH-UA")
        sec_platform = (self.headers.get("Sec-CH-UA-Platform", "") or "").strip('"').lower()
        if is_chromium and not sec_ua:
            score += 30  # Chrome UA but no client hints

        # Platform claimed by client hints must match the UA's OS.
        if sec_platform:
            if "windows" in ua_l:
                ua_os = "windows"
            elif "mac os" in ua_l:
                ua_os = "macos"
            elif "android" in ua_l:
                ua_os = "android"
            elif "linux" in ua_l:
                ua_os = "linux"
            else:
                ua_os = ""
            if ua_os and sec_platform != ua_os:
                score += 40  # e.g. Windows UA claiming macOS platform

        return min(100.0, score)

    def _apply_fingerprint_risk(self, ip: str) -> str | None:
        """Update the IP's cumulative risk (EMA) and act on it.

        Returns 'block' or 'captcha' if action is required, else None.
        """
        score = self._device_fingerprint_score(ip)
        prev = fingerprint_scores.get(ip, 0.0)
        cumulative = round(prev * 0.6 + score * 0.4, 1)
        fingerprint_scores[ip] = cumulative
        if cumulative >= FINGERPRINT_BLOCK_SCORE:
            blocked_ips.add(ip)
            _save_state()
            return "block"
        if cumulative >= FINGERPRINT_CAPTCHA_SCORE:
            flagged_ips.add(ip)
            return "captcha"
        return None

    def _check_blocked(self, ip: str) -> bool:
        """Return True if this IP is hard-blocked."""
        return ip in blocked_ips

    def _random_delay(self, params: dict):
        """Apply a small delay based on query params and random jitter."""
        min_delay = float(params.get("min", [0.05])[0])
        max_delay = float(params.get("max", [0.25])[0])
        time.sleep(random.uniform(min_delay, max_delay))

    def _check_rate_limit(self, ip: str) -> bool:
        now = time.time()
        window = [t for t in rate_limit.get(ip, []) if now - t < RATE_LIMIT_WINDOW_SECONDS]
        window.append(now)
        rate_limit[ip] = window
        return len(window) <= RATE_LIMIT_MAX_REQUESTS

    def _captcha_required(self, ip: str) -> bool:
        if ip in flagged_ips:
            return True
        window = rate_limit.get(ip, [])
        now_ts = time.time()
        recent = [t for t in window if now_ts - t < RATE_LIMIT_WINDOW_SECONDS]
        return len(recent) >= CAPTCHA_RATE_THRESHOLD

    def _require_captcha(self, ip: str):
        stats["captcha_hits"] += 1
        # Escalate: after first solve, serve a harder challenge token
        solves = captcha_solves.get(ip, 0)
        difficulty = "hard" if solves >= 1 else "standard"
        challenge = f"mock-captcha-challenge-{difficulty}-{secrets.token_hex(4)}"
        self._json(403, {
            "error": "captcha_required",
            "message": "Please solve the CAPTCHA to continue",
            "challenge": challenge,
            "difficulty": difficulty,
            "attempt": solves + 1,
        })

    def _common(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        ip = self._client_ip()
        stats["requests"] += 1
        self._random_delay(params)
        # Hard block check first
        if self._check_blocked(ip):
            self._json(403, {"error": "ip_blocked", "message": "Your access has been permanently blocked"})
            return None
        # Fingerprint check (skip for health/analytics)
        if parsed.path not in ("/health", "/analytics", "/api/analytics"):
            if self._is_bot_fingerprint(ip):
                flagged_ips.add(ip)
            action = self._apply_fingerprint_risk(ip)
            if action == "block":
                self._json(403, {"error": "ip_blocked", "message": "Your access has been permanently blocked"})
                return None
        if not self._check_rate_limit(ip):
            self._json(429, {"error": "rate_limited", "message": "Too many requests", "retry_after": 5})
            return None
        if self._captcha_required(ip) and parsed.path not in ("/health", "/captcha/solve"):
            self._require_captcha(ip)
            return None
        return parsed, params, ip

    def _queue_position(self, token: str) -> int:
        return queue.get(token, -1)

    def _session(self, token: str) -> dict | None:
        # Reject tokens whose HMAC signature doesn't validate (forged/tampered).
        if not _verify_signed(token):
            return None
        sess = sessions.get(token)
        if not sess:
            return None
        if (_now() - sess["created_at"]).total_seconds() > SESSION_TTL_SECONDS:
            sessions.pop(token, None)
            return None
        return sess

    def _csrf_ok(self, sess: dict, body: dict) -> bool:
        """Validate the CSRF token for state-changing requests."""
        provided = self.headers.get("x-csrf-token") or body.get("csrf_token")
        expected = sess.get("csrf_token")
        return bool(provided and expected and hmac.compare_digest(provided, expected))

    def do_GET(self):
        result = self._common()
        if result is None:
            return
        parsed, params, ip = result
        path = parsed.path

        if path == "/health":
            self._json(200, {"status": "ok"})

        # ── HTML pages (browser journey) ──────────────────────────────────────
        elif path == "/":
            self._html(200, page_home())

        elif path == "/queue":
            token = _random_token()
            position = len(queue) + 1
            queue[token] = position
            stats["queue_joins"] += 1
            self._html(200, page_queue(position, token, position * 2))

        elif path == "/login" and self.headers.get("Accept", "").startswith("text/"):
            token = params.get("token", [None])[0] or ""
            self._html(200, page_login(token))

        elif path == "/search" and "session_token" in params:
            self._html(200, page_search(params["session_token"][0]))

        elif path == "/analytics":
            self._html(200, page_analytics(stats, list(flagged_ips), len(sessions), len(queue)))

        # ── JSON API endpoints (scraper worker) ───────────────────────────────
        elif path == "/login":
            # Legacy simple JSON login for scraper.
            stats["logins"] += 1
            self._json(200, {"authenticated": True})

        elif path == "/queue/join":

            token = _random_token()
            position = len(queue) + 1
            queue[token] = position
            stats["queue_joins"] += 1
            self._json(200, {"queue_token": token, "position": position, "estimated_seconds": position * 2})

        elif path == "/queue/status":
            token = params.get("token", [None])[0] or self.headers.get("x-queue-token")
            position = self._queue_position(token)
            if position < 0:
                self._json(400, {"error": "invalid_queue_token"})
                return
            # Advance the queue: always move by at least 1, sometimes more.
            if position > 0:
                step = 1
                if random.random() < QUEUE_DECAY_PROBABILITY:
                    step = random.randint(1, max(1, position // 3))
                position = max(0, position - step)
                queue[token] = position
            self._json(200, {"queue_token": token, "position": position, "allowed": position == 0})
        elif path == "/slots":
            centre = params.get("centre", ["Bolton"])[0]
            today = _now()
            slots = _get_or_create_slots(centre, _iso(today), _iso(today + timedelta(days=14)))
            self._json(200, {"centre": centre, "slots": slots})
        elif path == "/captcha":
            self._require_captcha(ip)
        elif path == "/bot-trap":
            flagged_ips.add(ip)
            stats["bot_traps"] += 1
            hits = bot_trap_hits.get(ip, 0) + 1
            bot_trap_hits[ip] = hits
            if hits >= IP_BLOCK_TRAP_HITS:
                blocked_ips.add(ip)
                print(f"[mock-dvsa] IP {ip} permanently blocked after {hits} trap hits")
            self._json(200, {"ok": True})
        elif path == "/api/analytics":
            self._json(200, {
                **stats,
                "flagged_ips": list(flagged_ips),
                "active_sessions": len(sessions),
                "queue_length": len(queue),
            })
        elif path == "/search":
            # JSON search for scraper (no session_token param).
            centre = params.get("centre", ["Bolton"])[0]
            today = _now()
            slots = _get_or_create_slots(centre, _iso(today), _iso(today + timedelta(days=14)))
            self._json(200, {"centre": centre, "slots": slots})
        elif path == "/delay":
            time.sleep(random.uniform(1.0, 2.0))
            self._json(200, {"delayed": True})
        elif path == "/error":
            self._json(500, {"error": "internal_error", "message": "Mock server error"})
        elif path == "/retry":
            self.send_response(429)
            self.send_header("Content-Type", "application/json")
            self.send_header("Retry-After", "2")
            self.end_headers()
            self.wfile.write(b'{"error": "rate_limited", "message": "Too many requests"}')
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        ip = self._client_ip()
        stats["requests"] += 1
        self._random_delay(params)
        if self._check_blocked(ip):
            self._json(403, {"error": "ip_blocked", "message": "Your access has been permanently blocked"})
            return
        if self._is_bot_fingerprint(ip):
            flagged_ips.add(ip)
        if self._apply_fingerprint_risk(ip) == "block":
            self._json(403, {"error": "ip_blocked", "message": "Your access has been permanently blocked"})
            return
        if not self._check_rate_limit(ip):
            self._json(429, {"error": "rate_limited", "message": "Too many requests", "retry_after": 5})
            return
        if self._captcha_required(ip) and path not in {"/captcha/solve"}:
            self._require_captcha(ip)
            return

        body = self._read_body()
        accept = self.headers.get("Accept", "")
        # A real browser accepts text/html and does NOT request application/json.
        # API clients (the scraper) send Accept including application/json, so they
        # must take the JSON code paths even if text/html is listed as a fallback.
        is_browser = "text/html" in accept and "application/json" not in accept

        # ── HTML form POST routes (browser journey) ───────────────────────
        if path == "/login" and is_browser:
            license_number = body.get("license_number") or body.get("licence_number", "")
            queue_token = body.get("queue_token", "")
            if not license_number or len(license_number) < 4:
                self._html(400, page_login(queue_token, error="Enter your driving licence number"))
                return
            if self._queue_position(queue_token) != 0:
                # Re-check: the queue may now be clear even without explicit join
                if queue_token not in queue:
                    queue[queue_token] = 0
                elif queue[queue_token] != 0:
                    self._html(403, page_error("Not your turn", "You must wait in the queue before signing in.", "/queue"))
                    return
            stats["logins"] += 1
            session_token = _new_signed_token()
            sessions[session_token] = {
                "token": session_token,
                "csrf_token": _new_signed_token(),
                "license_number": license_number,
                "created_at": _now(),
                "bookings": [],
            }
            self._redirect(f"/search?session_token={session_token}")
            return

        if path == "/search-results" and is_browser:
            session_token = body.get("session_token", "")
            sess = self._session(session_token)
            if not sess:
                self._redirect("/")
                return
            centre = body.get("centre", "Bolton")
            from_date = body.get("from_date") or _iso(_now())
            to_date = body.get("to_date") or _iso(_now() + timedelta(days=14))
            stats["searches"] += 1
            slots = _get_or_create_slots(centre, from_date, to_date)
            self._html(200, page_results(slots, centre, session_token))
            return

        if path == "/book-confirm" and is_browser:
            session_token = body.get("session_token", "")
            sess = self._session(session_token)
            if not sess:
                self._redirect("/")
                return
            slot_id = body.get("slot_id", "")
            slot_datetime = body.get("slot_datetime", "")
            centre = body.get("centre", "")
            self._html(200, page_book_confirm(slot_id, slot_datetime, centre, session_token))
            return

        if path == "/payment-page" and is_browser:
            session_token = body.get("session_token", "")
            sess = self._session(session_token)
            if not sess:
                self._redirect("/")
                return
            slot_id = body.get("slot_id", "")
            slot_datetime = body.get("slot_datetime", "")
            centre = body.get("centre", "")
            # Hold the slot.
            slot = next(
                (s for s in slot_inventory.values()
                 if s["id"] == slot_id and s["available"]
                 and (s["held_until"] is None or _now() > s["held_until"])),
                None,
            )
            if not slot:
                self._html(409, page_error("Slot no longer available", "Someone else just booked this slot. Please search again.", "/search?session_token=" + session_token))
                return
            slot["held_until"] = _now() + timedelta(seconds=BOOKING_TTL_SECONDS)
            booking_ref = _random_token()[:10].upper()
            booking = {
                "booking_reference": booking_ref,
                "slot_id": slot_id,
                "centre": centre,
                "datetime": slot_datetime,
                "license_number": sess["license_number"],
                "status": "pending_payment",
                "held_until": _iso(slot["held_until"]),
            }
            sess["bookings"].append(booking)
            stats["bookings"] += 1
            self._html(200, page_payment(booking_ref, slot_datetime, centre, session_token))
            return

        if path == "/payment-submit" and is_browser:
            session_token = body.get("session_token", "")
            sess = self._session(session_token)
            if not sess:
                self._redirect("/")
                return
            booking_ref = body.get("booking_reference", "")
            booking = next((b for b in sess["bookings"] if b["booking_reference"] == booking_ref), None)
            if not booking:
                self._html(404, page_error("Booking not found", "We could not find your booking. Please start again.", "/"))
                return
            slot = slot_inventory.get(f"{booking['centre']}-{booking['datetime']}")
            if not slot or slot["held_until"] is None or _now() > slot["held_until"]:
                self._html(409, page_error("Payment timed out", "Your slot hold expired. Please search and select a slot again.", "/search?session_token=" + session_token))
                return
            slot["available"] = False
            slot["booked_by"] = sess["license_number"]
            slot["held_until"] = None
            booking["status"] = "confirmed"
            booking["payment_token"] = _random_token()
            stats["payments"] += 1
            self._html(200, page_confirmation(booking))
            return

        # ── JSON API routes (scraper) ────────────────────────────────────
        if path == "/captcha/solve":
            token_val = body.get("token", "")
            # Standard challenge: must start with solved-mock-captcha-challenge
            # Hard challenge: also requires the difficulty suffix to be echoed back
            solves = captcha_solves.get(ip, 0)
            if solves >= 1:
                # Harder: token must contain 'hard' and be at least 32 chars
                accepted = "hard" in token_val and len(token_val) >= 32
            else:
                accepted = token_val.startswith("solved-mock-captcha-challenge")
            if accepted:
                flagged_ips.discard(ip)
                captcha_solves[ip] = solves + 1
            self._json(200 if accepted else 403, {"success": accepted, "attempt": solves + 1})
            return

        if path == "/login":
            license_number = body.get("license_number") or body.get("licence_number")
            queue_token = body.get("queue_token") or self.headers.get("x-queue-token")
            if not license_number or len(license_number) < 6:
                self._json(400, {"error": "invalid_license_number"})
                return
            if self._queue_position(queue_token) != 0:
                self._json(403, {"error": "queue_not_ready", "message": "Wait for the queue"})
                return
            stats["logins"] += 1
            token = _new_signed_token()
            csrf = _new_signed_token()
            sessions[token] = {
                "token": token,
                "csrf_token": csrf,
                "license_number": license_number,
                "created_at": _now(),
                "bookings": [],
            }
            self._json(200, {"session_token": token, "csrf_token": csrf, "authenticated": True})
            return

        if path == "/search":
            session_token = body.get("session_token") or self.headers.get("x-session-token")
            sess = self._session(session_token)
            if not sess:
                self._json(401, {"error": "unauthenticated"})
                return
            centre = body.get("centre", "Bolton")
            from_date = body.get("from_date")
            to_date = body.get("to_date")
            if not from_date or not to_date:
                today = _now()
                from_date = _iso(today)
                to_date = _iso(today + timedelta(days=14))
            stats["searches"] += 1
            slots = _get_or_create_slots(centre, from_date, to_date)
            self._json(200, {"centre": centre, "slots": slots, "count": len(slots)})
            return

        if path == "/book":
            session_token = body.get("session_token") or self.headers.get("x-session-token")
            sess = self._session(session_token)
            if not sess:
                self._json(401, {"error": "unauthenticated", "message": "Session expired or invalid"})
                return
            if not self._csrf_ok(sess, body):
                self._json(403, {"error": "csrf_failed", "message": "Missing or invalid CSRF token"})
                return
            slot_id = body.get("slot_id")
            if not slot_id:
                self._json(400, {"error": "missing_slot_id"})
                return
            # Slot scarcity: randomly vanish slots between search and book
            if random.random() < SLOT_VANISH_PROBABILITY:
                self._json(409, {"error": "slot_unavailable", "message": "This slot was just taken by another user"})
                return
            slot = next(
                (s for s in slot_inventory.values()
                 if s["id"] == slot_id and s["available"]
                 and (s["held_until"] is None or _now() > s["held_until"])),
                None,
            )
            if not slot:
                self._json(409, {"error": "slot_unavailable", "message": "This slot is no longer available"})
                return
            slot["held_until"] = _now() + timedelta(seconds=BOOKING_TTL_SECONDS)
            booking_ref = _random_token()[:10].upper()
            booking = {
                "booking_reference": booking_ref,
                "slot_id": slot_id,
                "centre": slot["centre"],
                "datetime": slot["datetime"],
                "license_number": sess["license_number"],
                "status": "pending_payment",
                "held_until": _iso(slot["held_until"]),
            }
            sess["bookings"].append(booking)
            stats["bookings"] += 1
            self._json(200, booking)
            return

        if path == "/payment":
            session_token = body.get("session_token") or self.headers.get("x-session-token")
            sess = self._session(session_token)
            if not sess:
                self._json(401, {"error": "unauthenticated", "message": "Session expired; please log in again"})
                return
            if not self._csrf_ok(sess, body):
                self._json(403, {"error": "csrf_failed", "message": "Missing or invalid CSRF token"})
                return
            # Real bookings require a payment. We accept a tokenised card only
            # (never a raw PAN) — a token issued by the payment provider.
            payment_token = body.get("payment_token") or self.headers.get("x-payment-token")
            if not payment_token or not str(payment_token).startswith("tok_"):
                self._json(402, {"error": "payment_required", "message": "A valid tokenised payment method is required"})
                return
            booking_ref = body.get("booking_reference")
            booking = next((b for b in sess["bookings"] if b["booking_reference"] == booking_ref), None)
            if not booking:
                self._json(404, {"error": "booking_not_found"})
                return
            slot = slot_inventory.get(f"{booking['centre']}-{booking['datetime']}")
            if not slot:
                self._json(410, {"error": "slot_gone", "message": "Slot no longer exists"})
                return
            if slot["held_until"] is None or _now() > slot["held_until"]:
                slot["held_until"] = None
                self._json(409, {"error": "payment_timeout", "message": "Slot hold expired; please select again"})
                return
            slot["available"] = False
            slot["booked_by"] = sess["license_number"]
            slot["held_until"] = None
            booking["status"] = "confirmed"
            booking["payment_token"] = _random_token()
            stats["payments"] += 1
            self._json(200, booking)
            return

        self._json(404, {"error": "not_found"})


if __name__ == "__main__":
    _load_state()
    server = HTTPServer((HOST, PORT), Handler)
    print(f"[mock-dvsa] listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _save_state()
        server.shutdown()
        print("[mock-dvsa] state saved; shutting down")
