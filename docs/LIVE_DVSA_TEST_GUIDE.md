# Live DVSA Test Guide — Manual Safety Checklist

This is the **only** part of Availo that must be verified against the real DVSA "change your driving test" site. Do it with a real booking that has some test centres/dates you could transfer to. The extension never books or pays — you click every button yourself.

## Before you start

- [ ] You have a real DVSA booking and the login details (licence + booking ref).
- [ ] You are on a private home connection — not a public/corporate network with shared egress.
- [ ] Auto-refresh is set to **90+ seconds** in the options page.
- [ ] You have 10–15 minutes to sit with the page and intervene if anything looks wrong.
- [ ] The extension is the version that passed the fixture tests.

## Steps

1. **Sign in to the real DVSA site manually** and reach the "change your driving test" results page.
2. **Click the Availo icon** → **"Check this page"**.
   - Expected: "✓ Availo can read this page — it can see X available dates."
   - If it says it can't read the page, open the list of available tests and check again.
3. **Click "Start watching this tab"** (single person) or **"Start watching everyone (in turn)"** (roster).
4. **Leave the tab active** for 5–10 minutes.
   - Expected: the page gently refreshes every 90+ seconds (you'll see the page reload briefly).
   - Expected: no CAPTCHA, no "unusual activity" warnings, no blocks.
   - Expected: if you get signed out, you get an on-screen + notification alert.
5. **Trigger the slot-detection path** (if a suitable slot isn't already showing):
   - You can either wait for a real cancellation to appear, or
   - Pick a centre/date that already has an earlier slot than your current booking.
   - Expected: a single notification for the earliest matching slot, not a flood.
   - Expected: the matching row is highlighted on the page.
   - Expected: the extension pauses so it doesn't cycle away from the slot.
6. **Click "Book this test" yourself** on the highlighted slot and confirm/pay on DVSA as normal.
   - The extension never clicks this for you.
7. **Stop watching** when done.

## Red flags — stop immediately and report

- Multiple rapid notifications in a row (regression of the "storm" bug).
- The page refreshes faster than you configured.
- DVSA shows a CAPTCHA, verification, or "unusual activity" message.
- The extension auto-clicks any "Book", "Confirm", or "Pay" button.
- The extension tries to sign in with credentials you didn't save.

## What success looks like

- Availo reads the page and counts the available dates correctly.
- Slow, jittered refreshes happen without triggering DVSA defences.
- Exactly one alert per earliest matching slot.
- You manually click Book and complete the transfer on DVSA.

## After the live test

If everything passes, the roster mode is verified end-to-end. If anything fails, capture the page text, the popup state, and the service-worker console logs.
