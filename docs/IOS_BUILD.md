# Availo on iPhone — Safari extension (App Store) build guide

Apple only allows browser extensions through **Safari**, and a Safari Web Extension
must be wrapped in a small native iOS app and shipped via the **App Store**. This
guide is the exact playbook.

> **This is a Mac-only job.** Apple's toolchain (Xcode + `safari-web-extension-converter`,
> signing, App Store submission) does **not** run on Windows or Linux. The extension
> code and the ready-to-convert build are prepared in this repo; the steps below are
> done by you on a Mac (or a collaborator / a macOS cloud-CI runner).

---

## Build without a Mac (GitHub Actions) — recommended if you don't own a Mac

You don't need to buy a Mac to *build* this. The repo includes a workflow,
[`.github/workflows/safari-build.yml`](../.github/workflows/safari-build.yml), that
runs on GitHub's **cloud macOS runner** (Xcode preinstalled). It does steps 1–4
below for you and hands back the finished Xcode project.

**Run it:** GitHub → your repo → **Actions** tab → **safari-build** →
**Run workflow**. (It also runs automatically when you push a `v*` release tag.)

**What you get:** a downloadable artifact **`availo-ios-xcode-project`** containing
the generated `ios/` Xcode project, plus a log showing an unsigned iOS-Simulator
**compile check** that proves it builds.

**Caveats — read these:**
- This workflow was authored on Windows and is **best-effort/untested from there**.
  The converter's generated Xcode **scheme name** is the likely first-run tweak — the
  compile step prints the real scheme names (`xcodebuild -list`) and is marked
  non-fatal, so the project artifact is produced either way; if the compile failed on
  the scheme name, update the `-scheme` value in the workflow from the log and re-run.
- It **stops short of signing and App Store submission** — that genuinely needs your
  **Apple Developer account** ($99/yr) and signing secrets. Do that part on a Mac
  (steps 3–5 below) or extend the workflow with your signing secrets. Either way the
  **submission** in [step 5](#5-submit-to-the-app-store) is yours.

---

## Be honest about what iPhone can and can't do

**Works on iPhone (while Safari is open on the DVSA tab):**
- Reads the DVSA "change your driving test" page, spots an earlier slot, and
  **highlights** it.
- **Fast-Path autofill** of the sign-in / search forms from details saved on the device.
- An **in-page banner** when a slot appears, and the **phone push + email** alerts
  from the backend.

**Limited / not available on iPhone (be upfront with users):**
- **"Leave it running" barely works.** iOS suspends background tabs/extensions
  aggressively, so continuous background watching isn't reliable — iPhone is best as
  "watch while you're looking at the page." The backend **push/email** is the away
  safety-net.
- **No desktop-style notifications** (`chrome.notifications` isn't available on iOS
  Safari — the code already no-ops it). Alerts are the in-page banner + Web Push.
- **Web Push on iOS** needs the Availo **web app added to the Home Screen** (iOS
  16.4+). Tell users to "Add to Home Screen" to get phone alerts.

The extension boundary is unchanged on iOS too: it only reads + highlights + fills;
it never books, holds, pays, or evades DVSA's checks.

---

## Prerequisites (Mac)
1. A **Mac** with a current **Xcode** installed (from the App Store).
2. An **Apple Developer Program** membership — **$99/year** — to distribute on the
   App Store (and to run on a physical iPhone beyond short-lived free provisioning).
3. This repo checked out on the Mac.

> No Mac? A **macOS cloud runner** (e.g. a GitHub Actions `macos` job, or a hosted
> Mac) can run the converter + Xcode build. App Store *submission* still needs the
> Apple Developer account and App Store Connect.

---

## 1. Produce the Safari-ready extension folder
In `chrome-extension/` on the Mac:
```
npm run build:safari
```
This writes `chrome-extension/safari-build/` — a clean MV3 web extension (event-page
background, prod backend, gov.uk-only, no dev/localhost). That folder is the input to
Apple's converter.

## 2. Convert to an Xcode project
```
xcrun safari-web-extension-converter chrome-extension/safari-build \
  --app-name "Availo" \
  --bundle-identifier app.availo.ios \
  --project-location ./ios \
  --no-open
```
This generates an Xcode project under `./ios` containing **two targets**: the small
**container app** and the **Safari extension**. (Re-run with the same flags after any
extension change, or just copy the refreshed `safari-build/` files into the project's
extension resources.)

## 3. Configure in Xcode
1. Open the generated `.xcodeproj`.
2. Select the project → for **both** the app and extension targets, set your
   **Team** (your Apple Developer team) and confirm the **bundle identifiers**
   (`app.availo.ios` and `app.availo.ios.Extension` or similar).
3. Set the deployment target to **iOS 16.4+** (for Web Push support in the companion
   web app).
4. Add an **app icon** (Assets catalog) — reuse the Availo mark.
5. Give the **container app** a simple screen that tells the user how to enable it:
   *"Open Settings → Apps → Safari → Extensions → turn on Availo, and allow it on
   gov.uk."* (The converter scaffolds a basic app view you can edit.)
6. Confirm the extension's host permission is **`https://*.gov.uk/*`** only (it is,
   from the build).

## 4. Run it
- **Simulator:** pick an iPhone simulator, Run. In the simulator's Safari, enable the
  extension (Settings → Safari → Extensions), open a gov.uk page, and check the
  content script runs (the "Check this page" popup, the highlight on a test page).
- **Real device:** connect an iPhone, select it, Run (needs the Team set).

## 5. Submit to the App Store
1. In **App Store Connect**, create the app record.
2. Archive in Xcode (Product → Archive) → upload the build.
3. Fill the listing — reuse the copy in [`PUBLISHING.md`](PUBLISHING.md) (name,
   description, the permission justification for gov.uk).
4. **Privacy "nutrition" labels:** declare **email** (account) as collected; state in
   the notes that the **driving licence number and booking reference are stored only
   on the device and never sent to the developer's servers**. Not used for tracking;
   not sold.
5. **Review notes:** explain that Availo only reads the DVSA "change your driving
   test" page the user has open to alert them to earlier slots and fill their own
   details — it never books, holds, pays, or bypasses DVSA security. Provide the
   privacy policy URL: `https://availo-frontend-one.vercel.app/privacy.html`.
6. Add screenshots (the popup, the highlighted slot, the settings screen).
7. Submit for review.

---

## Keeping it in sync
When the extension changes, re-run `npm run build:safari` and refresh the extension
resources in the Xcode project (re-run the converter or copy `safari-build/` in), bump
the version, re-archive, and submit an update. All the shared logic (detection,
autofill, roster, alerts) is identical to the Chrome/Firefox builds — only the
packaging differs.
