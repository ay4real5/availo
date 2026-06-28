"""
Unified HTTP client adapter with TLS fingerprint impersonation.

Real anti-bot stacks (Cloudflare, DataDome, Imperva) fingerprint the TLS
ClientHello (JA3/JA4) *before* any HTTP header is parsed. Plain `httpx`/`requests`
emit Python's TLS signature, which is trivially classified as a bot.

This module prefers `curl_cffi`, which performs the TLS handshake via curl with
a real browser's cipher/extension ordering ("impersonate=chrome..."), so the
JA3/JA4 matches a genuine Chrome. If `curl_cffi` is not installed it falls back
to `httpx` so the worker still runs in development.

Both backends are exposed behind a single `Session` interface:
    session.headers          # mutable dict of default headers
    session.request(method, url, json=None, headers=None, timeout=30)
    session.get(...) / session.post(...)
    -> response with .status_code, .json(), .text, .headers

Catch transport failures with `TRANSPORT_ERRORS`.
"""
from __future__ import annotations

import os
from typing import Any

# curl_cffi impersonation target. 'chrome' tracks a recent Chrome build across
# curl_cffi releases; override with a pinned version (e.g. 'chrome124') if needed.
IMPERSONATE_TARGET = os.environ.get("TLS_IMPERSONATE", "chrome")

try:
    from curl_cffi import requests as _cffi  # type: ignore

    _BACKEND = "curl_cffi"
    _CFFI_ERRORS: tuple[type[Exception], ...]
    try:
        from curl_cffi.requests.errors import RequestsError as _CffiError  # type: ignore

        _CFFI_ERRORS = (_CffiError,)
    except Exception:  # pragma: no cover - older curl_cffi layout
        _CFFI_ERRORS = (Exception,)
except Exception:  # curl_cffi not available
    _cffi = None
    _BACKEND = "httpx"
    _CFFI_ERRORS = ()

import httpx

if _BACKEND == "curl_cffi":
    TRANSPORT_ERRORS: tuple[type[Exception], ...] = _CFFI_ERRORS + (httpx.TransportError,)
else:
    TRANSPORT_ERRORS = (httpx.TimeoutException, httpx.ConnectError, httpx.TransportError)

BACKEND = _BACKEND
IMPERSONATION = _BACKEND == "curl_cffi"


class _CffiSession:
    """Wraps a curl_cffi Session to the common interface."""

    def __init__(self, headers: dict[str, str], proxy: str | None):
        proxies = {"http": proxy, "https": proxy} if proxy else None
        self._s = _cffi.Session(
            headers=headers,
            impersonate=IMPERSONATE_TARGET,
            proxies=proxies,
            timeout=30.0,
        )

    @property
    def headers(self):
        return self._s.headers

    def request(self, method, url, json=None, headers=None, timeout=30.0):
        return self._s.request(
            method, url, json=json, headers=headers, timeout=timeout, allow_redirects=True
        )

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)

    def close(self):
        try:
            self._s.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _HttpxSession:
    """Wraps httpx.Client to the common interface."""

    def __init__(self, headers: dict[str, str], proxy: str | None):
        kwargs: dict[str, Any] = {"headers": headers, "follow_redirects": True, "timeout": 30.0}
        if proxy:
            kwargs["proxy"] = proxy
        self._s = httpx.Client(**kwargs)

    @property
    def headers(self):
        return self._s.headers

    def request(self, method, url, json=None, headers=None, timeout=30.0):
        return self._s.request(method, url, json=json, headers=headers, timeout=timeout)

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)

    def close(self):
        self._s.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def new_session(headers: dict[str, str] | None = None, proxy: str | None = None):
    """Create a browser-impersonating session (curl_cffi) or httpx fallback."""
    headers = dict(headers or {})
    if _BACKEND == "curl_cffi":
        return _CffiSession(headers, proxy)
    return _HttpxSession(headers, proxy)
