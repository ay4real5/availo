"""
Playwright-based scraper worker for one test centre.

Usage:
    python worker.py --centre Bolton
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from captcha_solver import solve_and_submit
from proxy_rotator import pick_proxy, proxy_for_httpx, sticky_proxy, record_proxy_result
from fingerprint import build_identity
from httpclient import new_session, TRANSPORT_ERRORS, BACKEND as HTTP_BACKEND, IMPERSONATION
from target import get_target
import playwright_discovery as pw

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:4000")
# The journey target (mock by default). MOCK_URL is kept as the in-module name
# the journey functions reference; it now flows from the target config so that
# switching targets is a single TARGET env var change. The live 'dvsa' target is
# intentionally unimplemented (see target.py).
TARGET = get_target()
MOCK_URL = TARGET.base_url
SCRAPER_KEY = os.environ.get("SCRAPER_API_KEY", "dev-scraper-key")

QUEUE_TIMEOUT_SECONDS = int(os.environ.get("QUEUE_TIMEOUT_SECONDS", "300"))
SEARCH_DAYS_MIN = int(os.environ.get("SEARCH_DAYS_MIN", "7"))
SEARCH_DAYS_MAX = int(os.environ.get("SEARCH_DAYS_MAX", "42"))

UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]

ACCEPT_LANGUAGES = [
    "en-GB,en;q=0.9",
    "en-GB,en-US;q=0.9,en;q=0.8",
    "en-US,en-GB;q=0.9,en;q=0.8",
]


def random_ip() -> str:
    return f"86.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"


def _make_logger(centre: str) -> logging.Logger:
    return logging.getLogger(f"worker.{centre}")


def _dvla_licence() -> str:
    """Generate a realistic DVLA driving licence number.
    Format: SURNA + 6 digits + 2 letters + 2 digits + 2 letters
    e.g. MORGA657054SM9IJ
    """
    surnames = ["SMITH", "JONES", "TAYLO", "BROWN", "WILSO", "EVANS", "WALKE", "JOHNS", "ROBTS", "DAVIE"]
    sur = random.choice(surnames)
    dob_enc = f"{random.randint(5,9)}{random.randint(1,9)}{random.randint(0,9)}{random.randint(0,9)}{random.randint(0,9)}"
    init = random.choice("ABCDEFGHJKLMNPRSTUVWXY")
    check = f"{random.randint(0,9)}{random.randint(0,9)}"
    suffix = "".join(random.choices("ABCDEFGHJKLMNPRSTUVWXY", k=2))
    return f"{sur}{dob_enc}{init}{check}{suffix}"


def pick(arr: list[str]) -> str:
    return random.choice(arr)


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class Provenance:
    job_id: str
    proxy_used: str
    ip_used: str
    ua_used: str
    requests_per_minute: int = 0
    visited_trap_page: bool = False
    captcha_hit: bool = False
    ip_blocked: bool = False
    slot_vanish_retries: int = 0
    request_log: list[dict] = field(default_factory=list)

    def log(self, method: str, path: str, status: int, note: str = "") -> None:
        self.request_log.append({
            "t": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "path": path,
            "status": status,
            "note": note,
        })


class CircuitBreaker:
    """Stops hammering a failing backend: opens after N consecutive failures and
    rejects calls for a cooldown window, then half-opens to retry."""

    def __init__(self, threshold: int = 5, cooldown: float = 30.0) -> None:
        self.threshold = threshold
        self.cooldown = cooldown
        self.fails = 0
        self.open_until = 0.0

    def before(self) -> None:
        if time.time() < self.open_until:
            raise RuntimeError("circuit_open: backend temporarily unavailable")

    def success(self) -> None:
        self.fails = 0

    def failure(self) -> None:
        self.fails += 1
        if self.fails >= self.threshold:
            self.open_until = time.time() + self.cooldown
            self.fails = 0


_backend_cb = CircuitBreaker(
    threshold=int(os.environ.get("BACKEND_CB_THRESHOLD", "5")),
    cooldown=float(os.environ.get("BACKEND_CB_COOLDOWN", "30")),
)


def _with_retries(fn, retries: int = 3, base: float = 0.5):
    """Call fn with exponential backoff + jitter, retrying only transient errors
    (network failures and HTTP 5xx). 4xx client errors fail fast."""
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        _backend_cb.before()
        try:
            result = fn()
            _backend_cb.success()
            return result
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response is not None else 0
            if 500 <= status < 600:
                last_exc = e
                _backend_cb.failure()
            else:
                raise  # 4xx: don't retry
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last_exc = e
            _backend_cb.failure()
        if attempt < retries:
            time.sleep(base * (2 ** (attempt - 1)) * (1 + random.uniform(-0.2, 0.2)))
    raise last_exc if last_exc else RuntimeError("backend call failed")


def backend_request(method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "x-scraper-key": SCRAPER_KEY,
    }
    url = f"{BACKEND_URL}{path}"

    def call():
        resp = httpx.request(method, url, headers=headers, json=json, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    return _with_retries(call)


def backend_get(path: str) -> dict[str, Any]:
    headers = {"x-scraper-key": SCRAPER_KEY}

    def call():
        resp = httpx.get(f"{BACKEND_URL}{path}", headers=headers, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    return _with_retries(call)


def scraper_paused(log: logging.Logger) -> bool:
    """Check the dashboard kill-switch. Fails open (returns False) on any error so
    a control-endpoint hiccup never wedges the worker."""
    try:
        resp = httpx.get(
            f"{BACKEND_URL}/api/control",
            headers={"x-scraper-key": SCRAPER_KEY},
            timeout=10.0,
        )
        if resp.status_code != 200:
            return False
        return bool(resp.json().get("scraper", {}).get("paused"))
    except Exception as e:
        log.warning(f"control check failed (continuing): {e}")
        return False


def fetch_booking_requests(centre: str, log: logging.Logger) -> list[dict[str, Any]]:
    """Ask the backend which users want a slot at this centre auto-booked."""
    try:
        data = backend_get(f"/api/scraper/booking-requests?centre={centre}")
        reqs = data.get("requests", [])
        log.info(f"{centre}: {len(reqs)} auto-book request(s)")
        return reqs
    except Exception as e:
        log.warning(f"could not fetch booking requests: {e}")
        return []


def create_job(centre: str, provenance: Provenance) -> dict[str, Any]:
    return backend_request(
        "POST",
        "/api/scraper/jobs",
        {
            "test_centre": centre,
            "proxy_used": provenance.proxy_used,
            "ip_used": provenance.ip_used,
            "ua_used": provenance.ua_used,
        },
    )


def update_job(job_id: str, status: str, slots_found: int, error: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status, "slots_found": slots_found}
    if error is not None:
        payload["error"] = error
    backend_request("PUT", f"/api/scraper/jobs/{job_id}", payload)


def report_slots(centre: str, slots: list[str], provenance: Provenance) -> None:
    headers = {
        "Content-Type": "application/json",
        "x-scraper-key": SCRAPER_KEY,
        "x-scraper-job-id": provenance.job_id,
        "x-proxy-used": provenance.proxy_used,
        "x-ip-used": provenance.ip_used,
        "x-rpm": str(provenance.requests_per_minute),
        "x-visited-trap": str(provenance.visited_trap_page).lower(),
    }
    resp = httpx.post(
        f"{BACKEND_URL}/api/slots/report-centre",
        headers=headers,
        json={"test_centre": centre, "slots": slots},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def human_delay(min_ms: int = 800, max_ms: int = 2500) -> None:
    jitter = random.gauss(0, (max_ms - min_ms) * 0.1)
    delay_ms = max(min_ms, min(max_ms, random.randint(min_ms, max_ms) + int(jitter)))
    time.sleep(delay_ms / 1000.0)


def _jitter(base: float) -> float:
    return base * (1 + random.uniform(-0.2, 0.2))


def mock_request(
    client,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    referer: str | None = None,
    provenance: Provenance | None = None,
    log: logging.Logger | None = None,
):
    url = f"{MOCK_URL}{path}"
    extra_headers: dict[str, str] = {}
    if referer:
        extra_headers["Referer"] = referer
    for attempt in range(1, 5):
        # Small random pause before every request to look human
        time.sleep(random.uniform(0.35, 1.1))
        try:
            resp = client.request(method, url, json=body, headers=extra_headers, timeout=30.0)
            if provenance:
                provenance.log(method, path, resp.status_code)
            if resp.status_code == 403:
                try:
                    err = resp.json().get("error", "")
                    if err == "ip_blocked":
                        if provenance:
                            provenance.ip_blocked = True
                        if log:
                            log.error("IP permanently blocked by mock site")
                        return resp
                except Exception:
                    pass
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2))
                wait = _jitter(float(retry_after))
                if log:
                    log.warning(f"rate limited — retrying in {wait:.1f}s")
                time.sleep(wait)
                continue
            return resp
        except TRANSPORT_ERRORS as e:
            if attempt == 4:
                raise
            backoff = _jitter(2.0 ** attempt)
            if log:
                log.warning(f"request error ({attempt}/4): {e} — retrying in {backoff:.1f}s")
            time.sleep(backoff)
    return client.request(method, url, json=body, headers=extra_headers, timeout=30.0)


def make_client(headers: dict[str, str], proxy: str | None):
    """Create a TLS-impersonating session (Chrome JA3 via curl_cffi when
    available, else httpx) routed through a real residential proxy if one is
    configured (PROXY_LIST). Mock/placeholder proxies fall back to a direct
    connection but the chosen IP is still advertised via the x-faked-ip header.
    """
    real_proxy = proxy_for_httpx(proxy)
    return new_session(headers, real_proxy)


class QueueTimeoutError(Exception):
    pass


def wait_in_queue(client: httpx.Client, provenance: Provenance, log: logging.Logger) -> str:
    resp = mock_request(client, "GET", "/queue/join", referer=f"{MOCK_URL}/", provenance=provenance, log=log)
    resp.raise_for_status()
    data = resp.json()
    queue_token = data["queue_token"]
    position = data["position"]
    log.info(f"queue joined at position {position}")

    deadline = time.monotonic() + QUEUE_TIMEOUT_SECONDS
    while position > 0:
        if time.monotonic() > deadline:
            raise QueueTimeoutError(f"queue did not clear after {QUEUE_TIMEOUT_SECONDS}s")
        human_delay(2000, 4000)
        resp = mock_request(client, "GET", f"/queue/status?token={queue_token}", provenance=provenance, log=log)
        resp.raise_for_status()
        data = resp.json()
        position = data["position"]
        if data.get("allowed"):
            log.info("queue allowed through")
            break
        log.info(f"queue position {position}")
    return queue_token


def login(client: httpx.Client, queue_token: str, provenance: Provenance, log: logging.Logger, licence: str | None = None) -> str:
    license_number = licence or _dvla_licence()
    resp = mock_request(
        client, "POST", "/login",
        body={"license_number": license_number, "queue_token": queue_token},
        referer=f"{MOCK_URL}/queue/join",
        provenance=provenance,
        log=log,
    )
    resp.raise_for_status()
    data = resp.json()
    session_token = data["session_token"]
    log.info(f"logged in — licence {license_number}")
    client.headers["x-session-token"] = session_token
    # Carry the CSRF token on all subsequent state-changing requests.
    csrf = data.get("csrf_token")
    if csrf:
        client.headers["x-csrf-token"] = csrf
    return session_token


def _solve_captcha(client: httpx.Client, challenge: str, difficulty: str, ip: str, provenance: Provenance, log: logging.Logger) -> bool:
    """Attempt to solve a CAPTCHA challenge, handling escalated difficulty."""
    log.info(f"CAPTCHA required — difficulty={difficulty} challenge={challenge}")
    if difficulty == "hard":
        # Hard challenge: solver must produce a token containing 'hard' and >= 32 chars
        base = solve_and_submit(challenge).get("token", f"solved-mock-captcha-challenge-hard-{challenge}")
        solve_token = f"solved-mock-captcha-challenge-hard-{challenge}-{base}"
        solve_token = solve_token[:max(32, len(solve_token))]
    else:
        solve_token = f"solved-mock-captcha-challenge-{challenge}"
    human_delay(1500, 3000)
    resp = mock_request(client, "POST", "/captcha/solve", body={"token": solve_token}, provenance=provenance, log=log)
    accepted = resp.status_code == 200 and resp.json().get("success")
    if accepted:
        log.info("CAPTCHA solved")
    else:
        log.warning("CAPTCHA rejected")
    return accepted


def search_slots(client: httpx.Client, centre: str, provenance: Provenance, log: logging.Logger) -> list[dict[str, Any]]:
    today = datetime.now(timezone.utc)
    search_days = random.randint(SEARCH_DAYS_MIN, SEARCH_DAYS_MAX)
    from_date = today.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    to_date = (today + timedelta(days=search_days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    resp = mock_request(
        client, "POST", "/search",
        body={"centre": centre, "from_date": from_date, "to_date": to_date},
        referer=f"{MOCK_URL}/login",
        provenance=provenance,
        log=log,
    )
    if resp.status_code == 403:
        data = resp.json()
        err = data.get("error", "")
        if err == "ip_blocked":
            provenance.ip_blocked = True
            return []
        provenance.captcha_hit = True
        challenge = data.get("challenge", "")
        difficulty = data.get("difficulty", "standard")
        if _solve_captcha(client, challenge, difficulty, provenance.ip_used, provenance, log):
            provenance.captcha_hit = False
            human_delay(800, 1500)
            resp = mock_request(
                client, "POST", "/search",
                body={"centre": centre, "from_date": from_date, "to_date": to_date},
                provenance=provenance, log=log,
            )
            if resp.status_code != 200:
                provenance.captcha_hit = True
                log.warning(f"search still blocked after CAPTCHA: {resp.status_code}")
                return []
        else:
            return []
    elif resp.status_code != 200:
        log.warning(f"search failed: {resp.status_code}")
        return []
    slots = resp.json().get("slots", [])
    log.info(f"{centre}: found {len(slots)} slots (window={search_days}d)")
    return slots


def report_booking(centre: str, slot: dict[str, Any], booking: dict[str, Any], job_id: str, user_id: str | None = None) -> dict[str, Any]:
    url = f"{BACKEND_URL}/api/slots/book"
    payload = {
        "test_centre": centre,
        "slot_datetime": slot["datetime"],
        "booking_reference": booking["booking_reference"],
        "scraped_by_job": job_id,
    }
    if user_id:
        payload["user_id"] = user_id
    resp = httpx.post(
        url,
        json=payload,
        headers={"x-scraper-key": SCRAPER_KEY, "Content-Type": "application/json"},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def _earlier_than_target(slot: dict[str, Any], target_iso: str | None) -> bool:
    """Only book slots that actually improve on the user's current test date."""
    if not target_iso:
        return True
    try:
        slot_dt = datetime.fromisoformat(slot["datetime"].replace("Z", "+00:00"))
        target_dt = datetime.fromisoformat(target_iso.replace("Z", "+00:00"))
        return slot_dt < target_dt
    except Exception:
        return True


def book_for_user(
    centre: str,
    slots: list[dict[str, Any]],
    request: dict[str, Any],
    job_id: str,
    provenance: Provenance,
    log: logging.Logger,
) -> dict[str, Any] | None:
    """Book a slot on behalf of one user using their real licence + tokenised card.

    Each user gets a DISTINCT residential identity (fresh proxy + IP + browser
    fingerprint + queue + session) so their bookings are not all linked to the
    same device fingerprint — leveraging the user base to spread the footprint.
    """
    user_id = request.get("user_id")
    licence = request.get("licence_number")
    payment_token = request.get("payment_token")
    target = request.get("current_test_date")

    if not licence or not payment_token:
        log.warning(f"skipping user {user_id}: missing licence or payment token")
        return None

    candidates = [s for s in slots if _earlier_than_target(s, target)]
    if not candidates:
        log.info(f"user {user_id}: no slot earlier than their target date — skipping")
        return None

    # Fresh browser fingerprint, but a STICKY residential proxy per user so the
    # whole journey for this candidate comes from one consistent IP.
    identity = build_identity()
    proxy = sticky_proxy(user_id)
    log.info(f"user {user_id}: identity ip={identity['ip']} proxy={proxy} engine={identity['engine']}")

    with make_client(identity["headers"], proxy) as client:
        # Establish a session like a real candidate would.
        mock_request(client, "GET", "/", provenance=provenance, log=log)
        human_delay(500, 1200)
        queue_token = wait_in_queue(client, provenance, log)
        login(client, queue_token, provenance, log, licence=licence)
        human_delay(600, 1400)

        for slot in candidates[:5]:  # retry other slots on vanish
            resp = mock_request(client, "POST", "/book", body={"slot_id": slot["id"]}, provenance=provenance, log=log)
            if resp.status_code == 409:
                provenance.slot_vanish_retries += 1
                log.warning(f"slot {slot['id']} vanished — trying next (retry {provenance.slot_vanish_retries})")
                human_delay(500, 1200)
                continue
            if resp.status_code != 200:
                log.warning(f"book failed for user {user_id}: {resp.status_code}")
                record_proxy_result(proxy, resp.status_code not in (403, 429))
                return None
            booking = resp.json()
            log.info(f"slot held for user {user_id} — ref {booking['booking_reference']}")

            human_delay(1000, 3000)
            # Pay with the user's tokenised card (never a raw PAN).
            resp = mock_request(
                client, "POST", "/payment",
                body={"booking_reference": booking["booking_reference"], "payment_token": payment_token},
                provenance=provenance, log=log,
            )
            if resp.status_code != 200:
                log.warning(f"payment failed for user {user_id}: {resp.status_code} {resp.text[:120]}")
                record_proxy_result(proxy, False)
                return booking
            confirmed = resp.json()
            log.info(f"booking confirmed for user {user_id} — ref {confirmed['booking_reference']}")
            record_proxy_result(proxy, True)
            try:
                report_booking(centre, slot, confirmed, job_id, user_id=user_id)
            except Exception as e:
                log.error(f"failed to report booking for user {user_id}: {e}")
            return confirmed
    record_proxy_result(proxy, False)
    log.warning(f"all booking attempts failed for user {user_id}")
    return None


def book_for_requests(
    centre: str,
    slots: list[dict[str, Any]],
    job_id: str,
    provenance: Provenance,
    log: logging.Logger,
) -> int:
    """Fetch auto-book requests and book a slot for each eligible user."""
    if os.environ.get("AUTO_BOOK", "").lower() != "true":
        return 0
    if scraper_paused(log):
        log.warning("kill-switch ENGAGED — skipping auto-booking")
        return 0
    requests = fetch_booking_requests(centre, log)
    booked = 0
    remaining = list(slots)
    for request in requests:
        if not remaining:
            log.info("no slots left to book")
            break
        confirmed = book_for_user(centre, remaining, request, job_id, provenance, log)
        if confirmed:
            booked += 1
            # Don't reuse the same slot for the next user.
            booked_dt = confirmed.get("datetime")
            remaining = [s for s in remaining if s["datetime"] != booked_dt]
        human_delay(800, 2000)
    return booked


def _discover_slots(centre, identity, proxy, provenance, log):
    """Run one discovery session (landing -> queue -> login -> search) under the
    given identity/proxy and return any slots found. Updates provenance flags
    (ip_blocked / captcha_hit) so the caller can react."""
    headers = dict(identity["headers"])
    headers["Accept"] = "application/json, text/html;q=0.9, */*;q=0.8"
    with make_client(headers, proxy) as client:
        mock_request(client, "GET", "/", provenance=provenance, log=log)
        human_delay(600, 1400)
        queue_token = wait_in_queue(client, provenance, log)
        login(client, queue_token, provenance, log)
        human_delay()
        if provenance.ip_blocked:
            return []
        # Occasionally hit the bot trap (simulated accidental click — 10%).
        if random.random() < 0.1:
            try:
                mock_request(client, "GET", "/bot-trap", provenance=provenance, log=log)
                provenance.visited_trap_page = True
                log.warning("visited bot trap page")
            except Exception as e:
                log.warning(f"bot-trap error: {e}")
            human_delay()
        slots = search_slots(client, centre, provenance, log)
        if not slots and not provenance.captcha_hit and not provenance.ip_blocked:
            human_delay(1000, 2500)
            log.info("retrying search with different date window")
            slots = search_slots(client, centre, provenance, log)
        return slots


def scrape_centre(centre: str) -> None:
    log = _make_logger(centre)
    identity = build_identity()
    proxy_used = pick_proxy()
    ip_used = identity["ip"]
    ua_used = identity["ua"]
    requests_per_minute = random.randint(20, 80)

    provenance = Provenance(
        job_id="",
        proxy_used=proxy_used,
        ip_used=ip_used,
        ua_used=ua_used,
        requests_per_minute=requests_per_minute,
    )

    job = create_job(centre, provenance)
    provenance.job_id = job["id"]
    tls = "chrome-JA3" if IMPERSONATION else "httpx(no-impersonation)"
    log.info(f"job created {job['id']} — ip={ip_used} proxy={proxy_used} engine={identity['engine']} tls={tls}")

    max_attempts = int(os.environ.get("MAX_IDENTITY_ATTEMPTS", "3"))
    slots: list[dict[str, Any]] = []
    try:
        # Opt-in: drive discovery in a REAL browser (genuine TLS/JS/canvas) for
        # maximum realism. Falls back to curl_cffi on any failure.
        if pw.available():
            try:
                log.info("discovery via real browser (Playwright)")
                slots = pw.discover_with_browser(centre, ua_used, proxy_used, _dvla_licence(), log, fake_ip=ip_used)
            except Exception as e:
                log.warning(f"playwright discovery failed ({e}); falling back to curl_cffi")

        # Detection feedback loop: try to discover slots; if we get challenged or
        # blocked, quarantine the proxy, rotate to a fresh identity + healthy
        # proxy, cool down, and try again.
        for attempt in range(1, max_attempts + 1):
            if slots:
                break
            provenance.ip_blocked = False
            provenance.captcha_hit = False
            slots = _discover_slots(centre, identity, proxy_used, provenance, log)
            if slots:
                break
            if provenance.ip_blocked or provenance.captcha_hit:
                reason = "ip_blocked" if provenance.ip_blocked else "captcha"
                record_proxy_result(proxy_used, False)
                if attempt < max_attempts:
                    cooldown = _jitter(2.0 ** attempt)
                    log.warning(
                        f"detection ({reason}) on attempt {attempt}/{max_attempts} — "
                        f"rotating identity + proxy, cooling down {cooldown:.1f}s"
                    )
                    identity = build_identity()
                    proxy_used = pick_proxy()
                    provenance.ip_used = identity["ip"]
                    provenance.ua_used = identity["ua"]
                    provenance.proxy_used = proxy_used
                    time.sleep(cooldown)
                    continue
                log.error(f"still {reason} after {max_attempts} attempts — giving up")
            else:
                # No slots, but not blocked: nothing to retry against.
                break

        # Auto-book on behalf of users who requested it, each under their own
        # distinct residential identity.
        if slots:
            booked = book_for_requests(centre, slots, provenance.job_id, provenance, log)
            if booked:
                log.info(f"auto-booked {booked} slot(s) for users")

    except QueueTimeoutError as e:
        log.error(str(e))
        update_job(provenance.job_id, "failed", 0, str(e))
        return
    except Exception as e:
        log.exception(f"scrape error: {e}")
        update_job(provenance.job_id, "failed", 0, str(e))
        return

    # 8. Report slots to the backend pipeline.
    if slots:
        try:
            result = report_slots(centre, [s["datetime"] for s in slots], provenance)
            log.info(f"reported {len(slots)} slots → {result}")
        except Exception as e:
            log.error(f"report slots failed: {e}")
            update_job(provenance.job_id, "failed", len(slots), str(e))
            return

    # 9. Update job status + teach the proxy pool from this run's outcome.
    if provenance.ip_blocked:
        status, error = "blocked", "ip_blocked"
    elif provenance.captcha_hit:
        status, error = "blocked", "captcha"
    else:
        status, error = "success", None
    record_proxy_result(proxy_used, status == "success")
    update_job(provenance.job_id, status, len(slots), error)
    log.info(f"job {provenance.job_id} → {status} ({len(slots)} slots, {provenance.slot_vanish_retries} vanish retries)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape one test centre")
    parser.add_argument("--centre", required=True, help="Test centre name")
    args = parser.parse_args()
    scrape_centre(args.centre)
    return 0


if __name__ == "__main__":
    sys.exit(main())
