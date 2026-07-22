const DEFAULT_BACKEND_URL = "https://availo-backend-4dbx.onrender.com";

// The vault lives ONLY in chrome.storage.local on this device and is never
// sent to the backend (see vault.js). AvailoVault is loaded before this file
// in options.html.
const REFRESH_KEY = "availoAutoRefresh";

const signedOutEl = document.getElementById("signedOut");
const signedInEl = document.getElementById("signedIn");
const setupSectionEl = document.getElementById("setupSection");
const vaultSectionEl = document.getElementById("vaultSection");
const refreshSectionEl = document.getElementById("refreshSection");
const timingSectionEl = document.getElementById("timingSection");
const statusEl = document.getElementById("status");
const vaultStatusEl = document.getElementById("vaultStatus");
const refreshStatusEl = document.getElementById("refreshStatus");

const SIGNED_IN_SECTIONS = [setupSectionEl, vaultSectionEl, refreshSectionEl, timingSectionEl];

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function renderState() {
  const stored = await getStored();
  document.getElementById("backendUrl").value = stored.backendUrl || DEFAULT_BACKEND_URL;

  if (stored.token) {
    signedOutEl.style.display = "none";
    signedInEl.style.display = "block";
    SIGNED_IN_SECTIONS.forEach((el) => { el.style.display = "block"; });
    document.getElementById("signedInEmail").textContent = stored.email || "";
    await renderVault();
    await renderRefresh();
    await renderPrefsSummary(stored);
    await renderSetupStatus(stored);
  } else {
    signedOutEl.style.display = "block";
    signedInEl.style.display = "none";
    SIGNED_IN_SECTIONS.forEach((el) => { el.style.display = "none"; });
  }
}

// A plain checklist of "is everything ready to watch?" — surfaces the exact
// gaps (no centre, no dates, alerts off) that otherwise leave people stuck.
async function renderSetupStatus(stored) {
  const listEl = document.getElementById("setupList");
  const vault = await AvailoVault.get();
  let prefs = null;
  try {
    const res = await fetch(`${stored.backendUrl || DEFAULT_BACKEND_URL}/api/auth/preferences`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    });
    if (res.ok) prefs = await res.json();
  } catch { /* offline — show what we can from the vault */ }

  const row = (state, label) => {
    const mark = state === "ok" ? "✓" : state === "no" ? "✗" : "○";
    return `<div class="check"><span class="mark ${state}">${mark}</span><span>${label}</span></div>`;
  };

  const items = [];
  items.push(row("ok", `Signed in as ${stored.email || "your account"}`));
  items.push(vault.centre
    ? row("ok", `Test centre set: <strong>${escapeAttr(vault.centre)}</strong>`)
    : row("no", `No test centre set yet — add one in “Your details” below.`));
  const hasWindow = vault.dateFrom || vault.dateTo;
  items.push(hasWindow
    ? row("ok", `Alert window set${vault.dateTo ? ` (up to ${new Date(vault.dateTo).toLocaleDateString()})` : ""}.`)
    : row("todo", `No date window — you'll be alerted for <em>any</em> date at your centre (fine for a first booking).`));
  items.push((prefs && prefs.notify_email !== false)
    ? row("ok", `Email alerts on (to ${stored.email || "your account"}).`)
    : row("todo", `Email alerts off.`));
  items.push(row("todo", `Phone push: optional — enable it on your phone via the Availo dashboard.`));
  items.push(AvailoVault.ready(vault)
    ? row("ok", `Licence + booking reference saved (one-tap autofill enabled).`)
    : row("todo", `Licence + booking reference not saved — optional, only needed for login autofill.`));

  listEl.innerHTML = items.join("");
}

async function renderRefresh() {
  const { [REFRESH_KEY]: s } = await chrome.storage.local.get(REFRESH_KEY);
  const cfg = s || {};
  document.getElementById("autoRefreshEnabled").checked = cfg.enabled !== false; // default on
  document.getElementById("autoRefreshSeconds").value = Math.max(45, Number(cfg.baseSeconds) || 90);
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

async function renderVault() {
  const v = await AvailoVault.get();
  document.getElementById("vaultName").value = v.name;
  document.getElementById("vaultLicence").value = v.licence;
  document.getElementById("vaultBookingRef").value = v.bookingRef;
  document.getElementById("vaultCentre").value = v.centre;
  document.getElementById("vaultDateFrom").value = v.dateFrom;
  document.getElementById("vaultDateTo").value = v.dateTo;
}

// Sync just the centre + target date into the backend preferences (never the
// licence/booking ref, which stay device-only) so "Start watching" knows what
// counts as "earlier" without a separate dashboard trip. Best-effort: the vault
// save above already succeeded and shouldn't be blocked by this.
async function syncPreferences(centre, dateTo) {
  if (!centre) return null;
  const stored = await getStored();
  if (!stored.token) return null;
  try {
    const res = await fetch(`${stored.backendUrl || DEFAULT_BACKEND_URL}/api/auth/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({
        centre,
        current_test_date: dateTo ? new Date(dateTo).toISOString() : null,
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Plain-English description of the alert window. BOTH ends are honoured by the
// matcher — describe them both, not just the upper bound.
function windowSentence(dateFrom, dateTo) {
  const fmt = (d) => new Date(d).toLocaleDateString();
  if (dateFrom && dateTo) return `for slots between ${fmt(dateFrom)} and ${fmt(dateTo)}`;
  if (dateTo) return `for slots on or before ${fmt(dateTo)}`;
  if (dateFrom) return `for slots from ${fmt(dateFrom)} onwards`;
  return "for any available slot";
}

async function saveVault() {
  const saved = await AvailoVault.save({
    name: document.getElementById("vaultName").value,
    licence: document.getElementById("vaultLicence").value,
    bookingRef: document.getElementById("vaultBookingRef").value,
    centre: document.getElementById("vaultCentre").value,
    dateFrom: document.getElementById("vaultDateFrom").value,
    dateTo: document.getElementById("vaultDateTo").value,
  });
  document.getElementById("vaultName").value = saved.name;
  document.getElementById("vaultLicence").value = saved.licence;

  const prefs = await syncPreferences(saved.centre, saved.dateTo);
  if (prefs) {
    vaultStatusEl.textContent = `Saved — Availo will alert ${windowSentence(saved.dateFrom, saved.dateTo)} at ${saved.centre}.`;
    await renderPrefsSummary(await getStored());
  } else {
    vaultStatusEl.textContent = "Saved. Your details stay on this device only.";
  }
  await renderSetupStatus(await getStored());
  setTimeout(() => { vaultStatusEl.textContent = ""; }, 4000);
}

async function renderPrefsSummary(stored) {
  const summaryEl = document.getElementById("prefsSummary");
  try {
    const res = await fetch(`${stored.backendUrl || DEFAULT_BACKEND_URL}/api/auth/preferences`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    });
    if (!res.ok) throw new Error("failed to load preferences");
    const prefs = await res.json();
    if (!prefs) {
      summaryEl.textContent = "No preferences set yet — open the Availo dashboard to set your centre and target date.";
      return;
    }
    // The full window (both bounds) lives in the local vault; the backend only
    // stores the upper bound. Describe the real window the matcher uses.
    const vault = await AvailoVault.get();
    summaryEl.textContent = `Watching for: ${prefs.centre} — ${windowSentence(vault.dateFrom, vault.dateTo)}`;
  } catch {
    summaryEl.textContent = "";
  }
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  const backendUrl = document.getElementById("backendUrl").value.trim() || DEFAULT_BACKEND_URL;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  statusEl.textContent = "Signing in…";

  try {
    const res = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.message || "Sign-in failed.";
      return;
    }
    await chrome.storage.local.set({
      backendUrl,
      token: data.token,
      userId: data.user.id,
      email: data.user.email,
    });
    statusEl.textContent = "";
    await renderState();
  } catch (err) {
    statusEl.textContent = `Could not reach backend: ${err.message}`;
  }
});

document.getElementById("signOut").addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "userId", "email"]);
  await renderState();
});

document.getElementById("saveVault").addEventListener("click", saveVault);

document.getElementById("saveRefresh").addEventListener("click", async () => {
  const enabled = document.getElementById("autoRefreshEnabled").checked;
  const baseSeconds = Math.max(45, Math.min(600, Number(document.getElementById("autoRefreshSeconds").value) || 90));
  await chrome.storage.local.set({ [REFRESH_KEY]: { enabled, baseSeconds } });
  document.getElementById("autoRefreshSeconds").value = baseSeconds;
  refreshStatusEl.textContent = enabled ? `Saved — refreshing about every ${baseSeconds}s while watching.` : "Saved — auto-refresh off.";
  setTimeout(() => { refreshStatusEl.textContent = ""; }, 3000);
});

// Populate the test-centre suggestions from the official DVSA centre list
// (dvsa-centres.js). The field stays free text, so a missing/renamed centre
// can still be typed by hand.
const centreListEl = document.getElementById("dvsaCentres");
if (centreListEl && typeof DVSA_CENTRES !== "undefined") {
  centreListEl.innerHTML = DVSA_CENTRES.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("");
}

renderState();
