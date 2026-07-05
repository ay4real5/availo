# Devin Cloud Skill: Availo Roster End-to-End Test

Use this skill definition in Devin Cloud to make future roster-mode tests one-shot.

## Skill name

`availo-roster-e2e-test`

## Trigger phrases

- "Run the Availo roster test"
- "Test the Availo extension roster mode"
- "Re-test Availo Fast-Path"

## Description

Performs a complete screen-recorded end-to-end test of the Availo Fast-Path Chrome extension's roster mode against the local dev fixture.

## Skill steps

1. **Start backend** (`backend/` on port 4000)
   - `npm install` if needed
   - `npm start`
   - Verify: `http://localhost:4000/api/health` or `/` returns JSON

2. **Start dev-fixture** (`chrome-extension/dev-fixture/` on port 5555)
   - `python3 -m http.server 5555` (or `npx serve -l 5555 .`)
   - Verify: `http://localhost:5555/login.html` loads

3. **Load the unpacked extension**
   - Open Chrome → `chrome://extensions`
   - Enable Developer mode
   - Load unpacked → select `chrome-extension/`
   - Pin the Availo Fast-Path icon

4. **Sign in / options page**
   - Click extension icon → "Sign in & add details"
   - Backend URL: `http://localhost:4000`
   - If backend auth is configured, use `practice@availo.test` / `practice123`
   - If backend auth is unavailable, proceed with on-device-only tests

5. **Configure roster**
   - Add 3 people with distinct names, licences, booking refs, and centres
   - Example:
     - Alice: Bolton + Manchester, current test 2026-12-01
     - Bob: Bolton, current test 2026-11-20
     - Carol: Manchester, current test 2026-12-15
   - Save roster

6. **Configure pacing**
   - Set to minimum floors: watch 5 min, cooldown 30 s, break 15 min
   - Save pacing

7. **Test Fast-Path**
   - Open `http://localhost:5555/login.html`
   - Click extension icon → "Fast-Path now (fill & jump to slot)"
   - Verify: login auto-fills → search auto-fills → results page → earliest slot highlighted
   - Click "Book this test" and confirm the rehearsal panel appears

8. **Test diagnostics**
   - On login.html, search.html, results.html click "Check this page" and verify the plain-English summary

9. **Test rotation start**
   - On results.html, click "Start watching everyone (in turn)"
   - Verify: notification "Now watching [Person 1]", popup shows person/phase/time, badge updates

10. **Test slot detection**
    - Verify a single alert fires for the earliest slot that is earlier than the current test date
    - Verify rotation PAUSES
    - Verify "Show me the slot" works

11. **Test controls**
    - Pause → verify "Paused on [person]"
    - Resume → verify back to watching
    - Skip → verify cooldown notification → next person notification

12. **Test blocked page**
    - Navigate to `results.html?blocked=1`
    - Verify: block detected, rotation STOPS, popup returns to idle, notification fires

13. **Test signed-out page**
    - Start watching, then navigate to `results.html?loggedout=1`
    - Verify: signed-out notification, watch stops

14. **Test queue page**
    - Create `queue.html` with Queue-it/DVSA waiting-room wording
    - Navigate to it while watching
    - Verify: queue detected, rotation PAUSES (not stops), badge "Q", notification fires
    - Navigate back to results.html → verify watching resumes

15. **Test stop**
    - Click "Stop watching everyone"
    - Verify popup returns to idle

16. **Check service worker console**
    - `chrome://extensions` → Service worker → Console
    - Record any errors/warnings

17. **Run unit tests**
    - `cd chrome-extension && node --test`
    - Verify all tests pass

## Expected outcomes

- All 13 end-to-end scenarios pass
- Chrome extension unit tests pass
- No errors in service worker console
- Screen recording captures the entire run

## Reporting format

At the end, post a summary checklist with:
- [ ] backend up
- [ ] fixture up
- [ ] extension loaded
- [ ] roster saved
- [ ] pacing saved
- [ ] Fast-Path works
- [ ] diagnostics work
- [ ] rotation start
- [ ] slot detection (single alert, no storm)
- [ ] pause/resume/skip
- [ ] blocked → stop
- [ ] signed-out
- [ ] queue → pause
- [ ] stop → idle
- [ ] clean console
- [ ] unit tests pass

Attach the screen recording and note any discrepancies.
