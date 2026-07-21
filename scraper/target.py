"""
Target selection for the scraper.

The worker drives a booking *journey* (queue -> login -> search -> book -> pay).
Today the only implemented target is the local **mock** DVSA site, which exists
as a safe test harness. This module exists so that the target is a single
config switch (`TARGET=mock|dvsa`) rather than a hard-coded URL scattered
through the worker.

IMPORTANT — the `dvsa` target is intentionally NOT implemented. Pointing the
scraper at the live DVSA service has Terms-of-Service and legal implications and
must only be done after an explicit decision and review. The stub below raises
so that nobody enables it by accident.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Target:
    """Connection details for a booking target."""
    name: str
    base_url: str
    #: True when this target is the safe local test harness.
    is_mock: bool


def _mock_target() -> Target:
    return Target(
        name="mock",
        base_url=os.environ.get("MOCK_URL", "http://localhost:8000"),
        is_mock=True,
    )


def _dvsa_target() -> Target:
    raise NotImplementedError(
        "The live DVSA target is not implemented. Automating the real DVSA "
        "booking service has Terms-of-Service and legal implications and must "
        "be enabled deliberately after review. Keep TARGET=mock for development."
    )


def get_target() -> Target:
    """Resolve the active target from the TARGET env var (defaults to 'mock')."""
    name = os.environ.get("TARGET", "mock").strip().lower()
    if name in ("", "mock"):
        return _mock_target()
    if name == "dvsa":
        return _dvsa_target()
    raise ValueError(f"Unknown TARGET '{name}' (expected 'mock' or 'dvsa')")
