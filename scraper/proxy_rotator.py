"""
Residential proxy rotation helper with health-checking, quarantine and sticky
per-user sessions.

In production, populate PROXY_LIST with real residential proxies or use a
provider API. For local development this module falls back to a small pool of
mock proxies so the worker can still exercise the rotation logic.

The ProxyPool:
  * tracks success/failure per proxy (persisted across worker processes),
  * quarantines a proxy after repeated failures (e.g. it got IP-banned),
  * weights selection toward proxies with the best recent success rate,
  * maps a given user to a STICKY proxy so their whole booking journey comes
    from one residential IP (looks like a single real person), and
  * can actively health-check proxies before use.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time

PROXY_LIST_ENV = os.environ.get("PROXY_LIST", "")
PROXY_STATE_FILE = os.environ.get(
    "PROXY_STATE_FILE", os.path.join(os.path.dirname(__file__), ".proxy_state.json")
)
# Quarantine a proxy after this many consecutive failures.
PROXY_MAX_CONSECUTIVE_FAILURES = int(os.environ.get("PROXY_MAX_CONSECUTIVE_FAILURES", "3"))
# How long (seconds) a quarantined proxy stays benched.
PROXY_QUARANTINE_SECONDS = int(os.environ.get("PROXY_QUARANTINE_SECONDS", "900"))
# Health-check target (a proxy must be able to reach this).
PROXY_HEALTHCHECK_URL = os.environ.get("PROXY_HEALTHCHECK_URL", "https://api.ipify.org?format=json")


def _load_proxies() -> list[str]:
    if PROXY_LIST_ENV:
        return [p.strip() for p in PROXY_LIST_ENV.split(",") if p.strip()]
    # Mock residential proxies for local development.
    return [f"mock-residential-{i:03d}" for i in range(1, 11)]


class ProxyRotator:
    def __init__(self, proxies: list[str] | None = None) -> None:
        self.proxies = proxies or _load_proxies()
        self.index = 0

    def next(self) -> str:
        if not self.proxies:
            return "direct"
        proxy = self.proxies[self.index % len(self.proxies)]
        self.index += 1
        return proxy

    def random(self) -> str:
        if not self.proxies:
            return "direct"
        return random.choice(self.proxies)


# ── Intelligent proxy pool ──────────────────────────────────────────────────────
class ProxyPool:
    """Health-aware proxy pool with persisted stats and quarantine."""

    def __init__(self, proxies: list[str] | None = None) -> None:
        self.proxies = proxies or _load_proxies()
        self.state = self._load_state()
        # Ensure every known proxy has a stats record.
        for p in self.proxies:
            self.state.setdefault(p, {"success": 0, "failure": 0, "consec_fail": 0, "quarantined_until": 0})

    # -- persistence --
    def _load_state(self) -> dict:
        try:
            with open(PROXY_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_state(self) -> None:
        try:
            with open(PROXY_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(self.state, f)
        except Exception:
            pass

    # -- health --
    def _is_quarantined(self, proxy: str) -> bool:
        return self.state.get(proxy, {}).get("quarantined_until", 0) > time.time()

    def healthy(self) -> list[str]:
        live = [p for p in self.proxies if not self._is_quarantined(p)]
        return live or list(self.proxies)  # never return empty

    def _success_rate(self, proxy: str) -> float:
        st = self.state.get(proxy, {})
        total = st.get("success", 0) + st.get("failure", 0)
        if total == 0:
            return 0.8  # optimistic prior for unused proxies
        return st.get("success", 0) / total

    # -- selection --
    def pick(self) -> str:
        candidates = self.healthy()
        if not candidates:
            return "direct"
        # Weight by success rate so good proxies are favoured but all get traffic.
        weights = [max(0.05, self._success_rate(p)) for p in candidates]
        return random.choices(candidates, weights=weights, k=1)[0]

    def sticky(self, user_id: str | None) -> str:
        """Deterministically map a user to one healthy proxy (same IP per user)."""
        candidates = self.healthy()
        if not candidates:
            return "direct"
        if not user_id:
            return self.pick()
        h = int(hashlib.sha256(str(user_id).encode()).hexdigest(), 16)
        return candidates[h % len(candidates)]

    # -- feedback --
    def record(self, proxy: str, ok: bool) -> None:
        if not proxy or proxy == "direct":
            return
        st = self.state.setdefault(proxy, {"success": 0, "failure": 0, "consec_fail": 0, "quarantined_until": 0})
        if ok:
            st["success"] += 1
            st["consec_fail"] = 0
        else:
            st["failure"] += 1
            st["consec_fail"] += 1
            if st["consec_fail"] >= PROXY_MAX_CONSECUTIVE_FAILURES:
                st["quarantined_until"] = time.time() + PROXY_QUARANTINE_SECONDS
                st["consec_fail"] = 0
        self._save_state()

    def health_check(self, proxy: str, timeout: float = 8.0) -> bool:
        """Actively verify a real proxy can make an outbound request."""
        if not is_real_proxy(proxy):
            return True  # nothing to check for placeholders/direct
        try:
            import httpx
            r = httpx.get(PROXY_HEALTHCHECK_URL, proxy=proxy, timeout=timeout)
            ok = r.status_code == 200
        except Exception:
            ok = False
        self.record(proxy, ok)
        return ok


# Shared singleton pool for the process.
_pool: ProxyPool | None = None


def get_pool() -> ProxyPool:
    global _pool
    if _pool is None:
        _pool = ProxyPool()
    return _pool


def pick_proxy() -> str:
    """Pick a healthy proxy weighted by success rate."""
    return get_pool().pick()


def sticky_proxy(user_id: str | None) -> str:
    """Return the same residential proxy for a given user across their journey."""
    return get_pool().sticky(user_id)


def record_proxy_result(proxy: str, ok: bool) -> None:
    """Report whether a proxy succeeded so the pool can learn / quarantine."""
    get_pool().record(proxy, ok)


def is_real_proxy(proxy: str | None) -> bool:
    """True if the proxy string is a routable URL we can hand to httpx.

    Real residential proxies look like 'http://user:pass@host:port' or
    'socks5://host:port'. The local-dev placeholders ('mock-residential-001',
    'direct') are not routable and must be ignored.
    """
    if not proxy:
        return False
    return proxy.startswith(("http://", "https://", "socks5://", "socks5h://", "socks4://"))


def proxy_for_httpx(proxy: str | None) -> str | None:
    """Return a proxy URL suitable for httpx, or None to go direct.

    Any '#geo=..' coherence annotation is stripped so only a clean, routable URL
    is handed to the HTTP client.
    """
    return proxy.split("#", 1)[0] if is_real_proxy(proxy) else None


def proxy_geo(proxy: str | None) -> str | None:
    """Return the egress country code a proxy advertises, or None if unknown.

    Annotate a proxy with its country via a URL fragment so the worker can derive
    a browser identity (locale/timezone/IP) that MATCHES the exit node, e.g.:

        http://user:pass@gw.provider.com:8000#geo=GB
        socks5://host:1080#FR

    Placeholders ('mock-residential-001', 'direct') carry no geo -> None, so the
    identity falls back to its default country. This keeps local-dev behaviour
    unchanged while enabling true network<->browser geo coherence in production.
    """
    if not proxy or "#" not in proxy:
        return None
    frag = proxy.rsplit("#", 1)[1].strip()
    if not frag:
        return None
    # Accept 'geo=GB', 'country=GB' or a bare 'GB'.
    for key in ("geo=", "country="):
        if frag.lower().startswith(key):
            frag = frag[len(key):]
            break
    frag = frag.strip().upper()
    return frag if len(frag) == 2 and frag.isalpha() else None
