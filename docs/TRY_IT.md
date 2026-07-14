# See Availo work on your own laptop (10 minutes, nothing to install)

Your office/work computer probably blocks browser extensions, so use a **personal
Windows laptop**. You do **not** need Python, Node, or any developer tools — just
Chrome. Nothing here touches the real DVSA; it all runs on fake pages on your own PC.

---

## Step 1 — Get the code onto the laptop
1. In your browser, go to: **https://github.com/ay4real5/availo**
2. Click the green **`< > Code`** button → **Download ZIP**.
3. Find the downloaded `availo-main.zip`, right-click it → **Extract All** → **Extract**.
4. You now have a folder like `availo-main` (inside it is a folder called
   `chrome-extension`). Remember where it is.

*(If you prefer Git: `git clone https://github.com/ay4real5/availo` — but the ZIP
above needs no tools.)*

## Step 2 — Start the fake DVSA site
1. Open the `availo-main\chrome-extension` folder.
2. Double-click **`start-practice.cmd`**.
3. A black window opens saying **"Availo practice site is running."**
   **Leave this window open** the whole time you test. (If Windows shows a blue
   "Windows protected your PC" box, click **More info → Run anyway** — it's just our
   own little script.)

## Step 3 — Add Availo to Chrome
1. Open **Chrome**. In the address bar type `chrome://extensions` and press Enter.
2. Turn on **Developer mode** (toggle, top-right).
3. Click **Load unpacked** (top-left).
4. Select the `availo-main\chrome-extension` folder → **Select Folder**.
5. **Availo Fast-Path** appears. Click the jigsaw icon (top-right of Chrome) and pin
   Availo so its icon shows.

## Step 4 — See it work
1. Click the **Availo icon** → **Practice run (safe rehearsal)**. A fake DVSA login
   page opens (it says "practice" in the title).
2. Click through the fake pages until you reach the **results** page.
3. Watch Availo **highlight the earliest slot**.
4. Click the **Availo icon → Check this page**. You should see something like:
   **"✓ Availo can read this page — it can see 3 available dates."**

That green tick is your proof it works. 🎉

*(Optional — see it auto-fill your details: Availo icon → **Sign in & add details** →
type any FAKE licence number + booking reference → save → run Practice run again and
watch the login form fill itself.)*

## When you are finished
Close the black **practice site** window (that stops the fake site). Remove the
extension anytime from `chrome://extensions`.

---

### If something does not look right
- **No "Practice run" link in the popup?** You picked the wrong folder in Step 3 — it
  must be the `chrome-extension` folder. Remove it and Load unpacked again.
- **Black window flashes and closes?** Right-click `start-practice.cmd` → open it from
  an already-open PowerShell window so you can read the message, and send it to us.
- **Page does not highlight?** Make sure the black practice-site window is still open,
  then reload the page.

This is the exact same detection and autofill code that runs on the real DVSA site —
it is just pointed at safe fake pages so you can rehearse with zero risk.
