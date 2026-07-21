"""
Human-like behavioural motion generator.

The bundled chrome-extension captures real users' scroll/click/mouse-move counts
(see chrome-extension/content.js -> POST /api/sessions/behaviour). A DVSA-class
site scores these signals: a "browser" that submits forms with zero mouse
movement, no scrolling and instant, pixel-perfect cursor jumps is obviously
automated.

This module produces realistic motion the Playwright path can replay:
  * curved mouse trajectories (quadratic Bézier with eased, jittered steps)
  * variable dwell pauses
  * a couple of scrolls

It can also seed itself from recorded human telemetry so the synthetic motion
matches the distribution of real captured sessions when those are available.
"""
from __future__ import annotations

import math
import os
import random

# Optional: a JSON file of recorded telemetry samples (the shape POSTed by the
# chrome extension). When present, motion volume is drawn from real sessions.
TELEMETRY_FILE = os.environ.get("BEHAVIOUR_TELEMETRY_FILE", "")


def _telemetry_profile() -> dict | None:
    """Load a recorded-behaviour profile (mouse/scroll/click volumes), if any."""
    if not TELEMETRY_FILE or not os.path.exists(TELEMETRY_FILE):
        return None
    try:
        import json
        with open(TELEMETRY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        samples = data if isinstance(data, list) else data.get("samples", [])
        if not samples:
            return None
        sample = random.choice(samples)
        return {
            "mouse_move_count": int(sample.get("mouse_move_count", 0)),
            "scroll_count": int(sample.get("scroll_count", 0)),
            "click_count": int(sample.get("click_count", 0)),
        }
    except Exception:
        return None


def _bezier_point(p0, p1, p2, t):
    """Quadratic Bézier interpolation between three control points."""
    mt = 1 - t
    x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
    y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    return x, y


def mouse_path(start, end, steps: int | None = None) -> list[tuple[float, float]]:
    """Return a curved, human-like sequence of points from start to end.

    The control point is offset perpendicular to the straight line so the cursor
    arcs rather than travelling in a robotic straight segment, and the step
    timing uses ease-in/ease-out so it accelerates then decelerates.
    """
    sx, sy = start
    ex, ey = end
    dist = math.hypot(ex - sx, ey - sy)
    if steps is None:
        steps = max(8, min(40, int(dist / 12) + random.randint(4, 10)))
    # Perpendicular bow for the curve.
    mx, my = (sx + ex) / 2, (sy + ey) / 2
    nx, ny = -(ey - sy), (ex - sx)
    norm = math.hypot(nx, ny) or 1.0
    bow = random.uniform(-0.25, 0.25) * dist
    ctrl = (mx + nx / norm * bow, my + ny / norm * bow)

    points: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = i / steps
        # Ease-in-out so motion is fast in the middle, slow at the ends.
        eased = 0.5 - 0.5 * math.cos(math.pi * t)
        x, y = _bezier_point(start, ctrl, end, eased)
        # Small per-step tremor like a real hand.
        x += random.uniform(-1.2, 1.2)
        y += random.uniform(-1.2, 1.2)
        points.append((x, y))
    return points


def plan_session(viewport: dict | None = None) -> dict:
    """Plan a behaviour budget for one page visit.

    Returns counts/targets used by the Playwright path to drive realistic
    interaction, seeded from recorded telemetry when available.
    """
    vp = viewport or {"width": 1366, "height": 768}
    profile = _telemetry_profile()
    if profile:
        moves = max(3, profile["mouse_move_count"] // 10)
        scrolls = max(1, profile["scroll_count"])
        clicks = max(1, profile["click_count"])
        source = "telemetry"
    else:
        moves = random.randint(4, 9)
        scrolls = random.randint(1, 4)
        clicks = random.randint(1, 3)
        source = "synthetic"
    waypoints = [
        (random.randint(40, vp["width"] - 40), random.randint(40, vp["height"] - 40))
        for _ in range(moves)
    ]
    return {
        "waypoints": waypoints,
        "scrolls": scrolls,
        "clicks": clicks,
        "source": source,
        "viewport": vp,
    }
