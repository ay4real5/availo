"""
Global detection circuit breaker.

The per-proxy health logic in ``proxy_rotator`` benches individual bad egress
IPs. This module adds a *fleet-wide* safety valve: if the site starts detecting
us across many identities/proxies in a short window (a sign our whole approach
has been fingerprinted, or the target has tightened defences), we should stop
hammering it entirely and back off — exactly what a careful operator does.

State is persisted to disk so it is shared across the many short-lived worker
processes a coordinator spawns. The breaker trips when the detection rate over a
rolling window of recent attempts crosses a threshold, then stays open for a
cooldown before half-opening to probe again.
"""
from __future__ import annotations

import json
import os
import time

STATE_FILE = os.environ.get(
    "DETECTION_CB_STATE_FILE", os.path.join(os.path.dirname(__file__), ".detection_cb.json")
)
# Rolling window of the most recent attempts to consider.
WINDOW = int(os.environ.get("DETECTION_CB_WINDOW", "20"))
# Only evaluate once we have at least this many samples (avoids tripping on a
# single early failure).
MIN_SAMPLES = int(os.environ.get("DETECTION_CB_MIN_SAMPLES", "8"))
# Trip when the detected fraction over the window is >= this.
TRIP_RATE = float(os.environ.get("DETECTION_CB_TRIP_RATE", "0.5"))
# How long the breaker stays open before half-opening.
COOLDOWN_SECONDS = float(os.environ.get("DETECTION_CB_COOLDOWN", "120"))
# Samples older than this (seconds) are ignored as stale.
SAMPLE_TTL_SECONDS = float(os.environ.get("DETECTION_CB_SAMPLE_TTL", "600"))


class CircuitOpenError(RuntimeError):
    """Raised when the fleet-wide breaker is open and work should pause."""

    def __init__(self, remaining: float) -> None:
        self.remaining = remaining
        super().__init__(f"detection_circuit_open: backing off for {remaining:.0f}s")


def _load() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"samples": [], "open_until": 0.0}


def _save(state: dict) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def _fresh_samples(state: dict) -> list[dict]:
    cutoff = time.time() - SAMPLE_TTL_SECONDS
    return [s for s in state.get("samples", []) if s.get("t", 0) >= cutoff][-WINDOW:]


def status() -> dict:
    """Return current breaker status (for logging/metrics)."""
    state = _load()
    samples = _fresh_samples(state)
    detected = sum(1 for s in samples if s.get("detected"))
    rate = (detected / len(samples)) if samples else 0.0
    remaining = max(0.0, state.get("open_until", 0.0) - time.time())
    return {"open": remaining > 0, "remaining": remaining, "rate": rate, "samples": len(samples)}


def check() -> None:
    """Raise CircuitOpenError if the breaker is currently open."""
    remaining = max(0.0, _load().get("open_until", 0.0) - time.time())
    if remaining > 0:
        raise CircuitOpenError(remaining)


def record(detected: bool) -> dict:
    """Record one attempt outcome and (re)evaluate the breaker.

    Returns the post-update status dict.
    """
    state = _load()
    samples = _fresh_samples(state)
    samples.append({"t": time.time(), "detected": bool(detected)})
    state["samples"] = samples[-WINDOW:]

    detected_n = sum(1 for s in state["samples"] if s.get("detected"))
    rate = detected_n / len(state["samples"])
    now = time.time()
    if len(state["samples"]) >= MIN_SAMPLES and rate >= TRIP_RATE and state.get("open_until", 0) <= now:
        state["open_until"] = now + COOLDOWN_SECONDS
        # Clear the window so that after cooldown we start fresh (half-open).
        state["samples"] = []
    _save(state)
    remaining = max(0.0, state.get("open_until", 0.0) - now)
    return {"open": remaining > 0, "remaining": remaining, "rate": rate, "samples": len(state["samples"])}
