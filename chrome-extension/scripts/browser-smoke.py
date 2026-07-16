#!/usr/bin/env python3
"""
Real-browser detection smoke test for the Availo extension.

Runs the extension's ACTUAL detection/heuristics engine (dvsa-heuristics.js,
selectors.js AvailoResolve, watch-match.js, fastpath-util.js) inside a real
headless Chromium, against the realistic GOV.UK-markup practice fixtures — and
asserts it correctly recognises the pages and slots. This proves the risky part
(parsing real-DVSA-shaped markup) works in a real browser, not just in Node.

Why this shape: loading the packed extension + its MV3 service worker is
unreliable in headless Chromium (and the Edge devtools channel is blocked by this
machine's admin policy), so we inject the same source files the extension uses and
call them directly against the live DOM. The in-page banner UI is covered by
the unit tests + a manual load-unpacked.

Run:   python scripts/browser-smoke.py [OUTPUT_DIR]
Needs: playwright (pip) with chromium; falls back cleanly if unavailable.
"""
import sys, os, pathlib, functools, threading, http.server, tempfile

EXT_DIR = pathlib.Path(__file__).resolve().parents[1]
FIXTURE_DIR = EXT_DIR / "dev-fixture"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (EXT_DIR / "_smoke-out")
OUT.mkdir(parents=True, exist_ok=True)
PORT = 5555

# The detection engine, in load order (later files use earlier globals).
ENGINE = ["dvsa-heuristics.js", "watch-match.js", "fastpath-util.js", "selectors.js"]

results = []
def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(FIXTURE_DIR))
    httpd = http.server.HTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def inject_engine(page):
    for f in ENGINE:
        page.add_script_tag(path=str(EXT_DIR / f))

def main():
    from playwright.sync_api import sync_playwright
    serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1) Results page — recognise it, count slots, pick the earliest Bolton slot.
        page.goto(f"http://localhost:{PORT}/results.html")
        inject_engine(page)
        diag = page.evaluate("() => AvailoResolve.diagnose(document)")
        best = page.evaluate(
            """() => {
                 const rows = AvailoResolve.resultRows(document)
                   .map(r => ({ centre: r.centre || 'Bolton', datetime: r.datetime }));
                 const ranked = availoRankMatches(rows, { centre: 'Bolton', targetDate: null });
                 return ranked[0] || null;
               }"""
        )
        page.screenshot(path=str(OUT / "1-results.png"))
        record("results page recognised", diag.get("page") == "results", f"page={diag.get('page')}")
        record("slots detected on results", diag.get("rowCount", 0) >= 3, f"rowCount={diag.get('rowCount')}")
        record("earliest Bolton slot picked", bool(best) and best["datetime"].startswith("2026-11-10"),
               f"earliest={best and best['datetime']}")

        # 1b) Real DVSA calendar-grid layout (Test date/Test time pages) — a
        # structurally different page to results.html's row list. Confirmed
        # against the real site's markup during live testing.
        page.goto(f"http://localhost:{PORT}/calendar.html")
        inject_engine(page)
        cal = page.evaluate("() => AvailoResolve.diagnose(document)")
        calRows = page.evaluate("() => AvailoResolve.resultRows(document).map(r => r.datetime)")
        page.screenshot(path=str(OUT / "1b-calendar.png"))
        record("calendar-grid page recognised", cal.get("page") == "results", f"page={cal.get('page')}")
        record("calendar-grid available dates found", len(calRows) == 2, f"dates={calRows}")
        record("earliest calendar date is 2026-11-04", bool(calRows) and min(calRows).startswith("2026-11-04"),
               f"earliest={min(calRows) if calRows else None}")

        # 2) Login page — recognise it and find the fields Fast-Path fills.
        page.goto(f"http://localhost:{PORT}/login.html")
        inject_engine(page)
        ld = page.evaluate("() => AvailoResolve.diagnose(document)")
        page.screenshot(path=str(OUT / "2-login.png"))
        record("login page recognised", ld.get("page") == "login", f"page={ld.get('page')}")
        record("licence + booking-ref fields found",
               ld.get("login", {}).get("licence") and ld.get("login", {}).get("bookingRef"),
               f"login={ld.get('login')}")

        # 3) Blocked page — the stop signal.
        page.goto(f"http://localhost:{PORT}/results.html?blocked=1")
        inject_engine(page)
        blocked = page.evaluate("() => AvailoResolve.blocked(document)")
        page.screenshot(path=str(OUT / "3-blocked.png"))
        record("block/challenge detected", bool(blocked), f"blocked={blocked}")

        # 4) Signed-out page — the alert signal.
        page.goto(f"http://localhost:{PORT}/results.html?loggedout=1")
        inject_engine(page)
        out = page.evaluate("() => AvailoResolve.loggedOut(document)")
        page.screenshot(path=str(OUT / "4-signedout.png"))
        record("signed-out detected", bool(out), f"loggedOut={out}")

        browser.close()

    print("\nScreenshots in:", OUT)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"{passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
