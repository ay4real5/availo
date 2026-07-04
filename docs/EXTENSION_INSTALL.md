# Availo extension — install & use

The Availo extension watches the **real DVSA "change your driving test" page**
in your own browser and alerts you the instant an earlier slot appears — then
fills your details so you're one click from booking. **It never books, holds, or
pays on its own. You always make the booking yourself.**

This guide is written to be followed by someone non-technical.

---

## 1. Install the extension

### Once it's on the Chrome Web Store (easiest — future)
Click **Add to Chrome** on the Availo store page and confirm. That's it — skip to
step 2.

### Right now (before it's published): "load unpacked"
1. Download/clone this project so you have the `chrome-extension` folder on your
   computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and choose the `chrome-extension` folder.
5. You'll see **Availo Fast-Path** appear. Pin it (jigsaw icon → pin) so it's
   always visible.

Edge works the same way (`edge://extensions`).

---

## 2. Sign in and add your details (one time)

1. Click the Availo icon → **Sign in & add details** (opens the settings page).
2. Sign in with your Availo account (the same one as the website).
3. Under **Your booking details**, enter your **driving licence number** and
   **booking reference**, and (optionally) your preferred centre and date range.
   - 🔒 These are stored **only in your browser, on your device** — they're never
     sent to Availo's servers. They're used to fill the DVSA forms for you, like
     a password manager.
4. Set your **test centre and current test date** on the Availo website
   (dashboard → Change preferences) so we know which slots count as "earlier".

---

## 3. Use it on the real DVSA page

1. Go to the real DVSA **"change your driving test"** page and sign in as normal.
2. Click the Availo icon → **Check this page**. Availo tells you in plain English
   what it can see, e.g. *"✓ Availo can read this page — it can see 12 available
   dates."* If it says it can't recognise the page, open your list of available
   tests and check again.
3. Click **Start watching this tab** (to be alerted when a new earlier slot
   appears) or **Fast-Path now** (to fill your details and jump straight to the
   best slot).
4. When an earlier slot appears you'll get an on-screen banner (plus email / phone
   alert if you set those up). Availo **highlights** the slot — you click
   **Book this test** yourself, then confirm and pay on DVSA as usual.

If DVSA ever shows a "there is a problem" / verification page, Availo **stops** and
tells you to continue manually — it never tries to get around DVSA's checks.

---

## 4. Leave it running — catch a slot while you're away

You don't have to sit and watch. Set it going and get on with your day:

1. On the DVSA available-tests page, click **Start watching this tab**.
2. **Leave the computer on** (not asleep/shut down) with that tab open. A locked
   screen is fine as long as the PC stays awake; if it sleeps or powers off,
   watching stops.
3. Availo keeps checking in the background and, while watching, **gently
   refreshes the DVSA page** so new cancellations show up. When one appears it
   **highlights the slot** and alerts you — on screen, by email, and (if you set
   it up) on your **phone**.
4. When the alert reaches you: get to the slot fast and **click Book yourself** —
   either come back to the PC, **remote-desktop** into it (the slot is already
   highlighted, so it's one click), or open DVSA **on your phone** and grab it.

**Availo never books or holds the slot for you.** You always make the booking —
that's what keeps your account safe.

**If DVSA signs you out** (it does this after a while of inactivity), Availo
**tells you** — on screen, by email, and on your phone — instead of silently
watching a dead page. Sign back in (your details are pre-filled, so it's one
click) and watching resumes automatically.

### The auto-refresh setting (please read)
On the extension settings page you can turn **Auto-refresh** on/off and set how
often. Keep it **slow (90+ seconds)** — refreshing too fast looks like a bot to
DVSA and can get **your account flagged and your test cancelled**. Availo also
**stops instantly** if DVSA ever shows a challenge or error page, and never tries
to get around it.

---

## 5. Practice first (recommended)

Before a real slot is on the line, rehearse the whole thing safely:

1. Serve the practice pages: from the `chrome-extension/dev-fixture` folder run a
   simple static server, e.g. `npx serve -l 5555 .` or `python -m http.server 5555`.
2. Click the Availo icon → **Practice run (safe rehearsal)**.
3. Walk through sign-in → search → the highlighted slot → **Book this test**. It
   never touches DVSA — it's just to build muscle memory so you're calm and fast
   when it counts.

---

## 6. If it doesn't recognise a real DVSA page

The extension auto-detects DVSA's standard GOV.UK page layout, so it should work
without any setup. If **Check this page** can't read a real page:

- Make sure you're on the actual results/search/sign-in step (not a landing page).
- Reload the page and check again.
- If it still can't, that page's layout may differ from the standard — send the
  Availo team the result of **Check this page** and (if you're comfortable) a
  screenshot of the page. The page-matching lives in one file
  (`chrome-extension/selectors.js` + `dvsa-heuristics.js`) and can be tuned
  quickly. **This is the only step that needs a real booking to verify**, since
  the results page is behind your DVSA sign-in.

---

## The promise (why this is safe)

- The extension only ever **reads** the page you already have open and **fills
  your own details**.
- It **highlights** the slot — it never clicks Select/Confirm/Pay for you.
- It never runs on a server, never stores your DVSA credentials, never tries to
  evade DVSA's anti-bot checks. You stay in control of the booking.
