"""
Browser fingerprint generator.

Real anti-bot systems cross-check that the User-Agent, Sec-CH-UA client hints,
platform and Accept headers are mutually consistent, AND that the soft signals
(language, timezone, locale) are coherent with the source IP's geography. A
naive scraper that sends a Chrome UA but no/incorrect client hints, a Windows UA
with a macOS platform, or a UK residential IP whose browser claims `en-US` /
`America/New_York` is trivially flagged.

This module emits internally-consistent, GEO-coherent identities: the IP, the
Accept-Language, the timezone and the locale all agree, and each identity also
carries a `client_meta` bundle (timezone, locale, viewport, WebGL vendor) so the
real-browser (Playwright) path can spoof a matching, coherent environment.
"""
from __future__ import annotations

import random

# Each profile is a self-consistent (UA, client-hints, platform) bundle plus the
# extra environment signals a real browser exposes (screen, WebGL vendor).
PROFILES = [
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "platform": '"Windows"',
        "mobile": "?0",
        "engine": "blink",
        "viewport": {"width": 1366, "height": 768},
        "webgl_vendor": "Google Inc. (Intel)",
        "webgl_renderer": "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "platform": '"macOS"',
        "mobile": "?0",
        "engine": "blink",
        "viewport": {"width": 1440, "height": 900},
        "webgl_vendor": "Google Inc. (Apple)",
        "webgl_renderer": "ANGLE (Apple, Apple M1, OpenGL 4.1)",
    },
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "sec_ch_ua": None,  # Firefox does not send Sec-CH-UA
        "platform": None,
        "mobile": None,
        "engine": "gecko",
        "viewport": {"width": 1536, "height": 864},
        "webgl_vendor": "Mozilla",
        "webgl_renderer": "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
        "sec_ch_ua": None,  # Safari does not send Sec-CH-UA
        "platform": None,
        "mobile": None,
        "engine": "webkit",
        "viewport": {"width": 1512, "height": 982},
        "webgl_vendor": "Apple",
        "webgl_renderer": "Apple GPU",
    },
]

# IP first-octet -> geography. The mock cross-checks Accept-Language against the
# country implied by the source IP, so the identity must keep these aligned.
# All blocks here are UK residential ranges -> en-GB / Europe-London.
GEO_BLOCKS = {
    86: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (51.5074, -0.1278)},
    81: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (53.4808, -2.2426)},
    90: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (52.4862, -1.8904)},
    25: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (55.9533, -3.1883)},
    31: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (51.4545, -2.5879)},
    51: {"country": "GB", "languages": ["en-GB", "en"], "timezone": "Europe/London", "geo": (53.8008, -1.5491)},
}
_UK_BLOCKS = list(GEO_BLOCKS.keys())


def _accept_language(languages: list[str]) -> str:
    """Build a realistic, weighted Accept-Language header from a language list."""
    parts = [languages[0]]
    q = 0.9
    for lang in languages[1:]:
        parts.append(f"{lang};q={q:.1f}")
        q = round(q - 0.1, 1)
    # A small share of GB users also advertise en-US as a low-priority fallback.
    if random.random() < 0.4 and "en-US" not in languages:
        parts.append("en-US;q=0.7")
    return ",".join(parts)


def random_ip() -> str:
    # UK residential-looking ranges (kept in sync with GEO_BLOCKS).
    block = random.choice(_UK_BLOCKS)
    return f"{block}.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"


def geo_for_ip(ip: str) -> dict:
    """Return the geography bundle (country/languages/timezone) for an IP."""
    try:
        first = int(ip.split(".", 1)[0])
    except Exception:
        first = 86
    return GEO_BLOCKS.get(first, GEO_BLOCKS[86])


def build_identity() -> dict:
    """Return a coherent, GEO-aligned fingerprint.

    The returned dict contains:
      headers      -- request headers (UA, client hints, Accept-Language, geo hint)
      ip           -- residential-looking source IP
      ua / engine  -- browser UA + engine family
      client_meta  -- environment signals for the real-browser path (locale,
                      timezone, viewport, WebGL vendor/renderer, geolocation)
    """
    profile = random.choice(PROFILES)
    ip = random_ip()
    geo = geo_for_ip(ip)
    accept_language = _accept_language(geo["languages"])

    headers = {
        "User-Agent": profile["ua"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": accept_language,
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Upgrade-Insecure-Requests": "1",
        "Connection": "keep-alive",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
    }
    # Only Chromium-family browsers send Sec-CH-UA client hints.
    if profile["sec_ch_ua"]:
        headers["Sec-CH-UA"] = profile["sec_ch_ua"]
        headers["Sec-CH-UA-Mobile"] = profile["mobile"]
        headers["Sec-CH-UA-Platform"] = profile["platform"]

    headers["x-faked-ip"] = ip  # consumed by the mock to simulate the source IP
    # Advertise the client timezone (real browsers leak this via JS; we surface
    # it as a header so the mock can verify IP<->timezone coherence too).
    headers["x-client-timezone"] = geo["timezone"]

    client_meta = {
        "locale": geo["languages"][0],
        "timezone": geo["timezone"],
        "geolocation": {"latitude": geo["geo"][0], "longitude": geo["geo"][1], "accuracy": 50},
        "viewport": profile["viewport"],
        "webgl_vendor": profile["webgl_vendor"],
        "webgl_renderer": profile["webgl_renderer"],
        "languages": geo["languages"],
    }

    return {
        "headers": headers,
        "ip": ip,
        "ua": profile["ua"],
        "engine": profile["engine"],
        "client_meta": client_meta,
    }
