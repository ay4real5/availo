"""
Browser fingerprint generator.

Real anti-bot systems cross-check that the User-Agent, Sec-CH-UA client hints,
platform and Accept headers are mutually consistent. A naive scraper that sends
a Chrome UA but no/incorrect client hints (or a Windows UA with a macOS platform)
is trivially flagged. This module emits internally-consistent profiles so each
identity looks like a genuine browser.
"""
from __future__ import annotations

import random

# Each profile is a self-consistent (UA, client-hints, platform) bundle.
PROFILES = [
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "platform": '"Windows"',
        "mobile": "?0",
        "engine": "blink",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "platform": '"macOS"',
        "mobile": "?0",
        "engine": "blink",
    },
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "sec_ch_ua": None,  # Firefox does not send Sec-CH-UA
        "platform": None,
        "mobile": None,
        "engine": "gecko",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
        "sec_ch_ua": None,  # Safari does not send Sec-CH-UA
        "platform": None,
        "mobile": None,
        "engine": "webkit",
    },
]

ACCEPT_LANGUAGES = [
    "en-GB,en;q=0.9",
    "en-GB,en-US;q=0.9,en;q=0.8",
    "en-US,en-GB;q=0.9,en;q=0.8",
]


def random_ip() -> str:
    # UK residential-looking ranges.
    block = random.choice([86, 81, 90, 25, 31, 51])
    return f"{block}.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"


def build_identity() -> dict:
    """Return a coherent fingerprint: UA, matching headers and a residential IP."""
    profile = random.choice(PROFILES)
    headers = {
        "User-Agent": profile["ua"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": random.choice(ACCEPT_LANGUAGES),
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

    ip = random_ip()
    headers["x-faked-ip"] = ip  # consumed by the mock to simulate the source IP
    return {"headers": headers, "ip": ip, "ua": profile["ua"], "engine": profile["engine"]}
