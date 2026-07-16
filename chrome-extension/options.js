const DEFAULT_BACKEND_URL = "https://availo-backend-4dbx.onrender.com";

// The vault lives ONLY in chrome.storage.local on this device and is never
// sent to the backend (see vault.js). AvailoVault is loaded before this file
// in options.html.
const REFRESH_KEY = "availoAutoRefresh";

const signedOutEl = document.getElementById("signedOut");
const signedInEl = document.getElementById("signedIn");
const vaultSectionEl = document.getElementById("vaultSection");
const refreshSectionEl = document.getElementById("refreshSection");
const statusEl = document.getElementById("status");
const vaultStatusEl = document.getElementById("vaultStatus");
const refreshStatusEl = document.getElementById("refreshStatus");

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function renderState() {
  const stored = await getStored();
  document.getElementById("backendUrl").value = stored.backendUrl || DEFAULT_BACKEND_URL;

  if (stored.token) {
    signedOutEl.style.display = "none";
    signedInEl.style.display = "block";
    vaultSectionEl.style.display = "block";
    refreshSectionEl.style.display = "block";
    document.getElementById("signedInEmail").textContent = stored.email || "";
    await renderVault();
    await renderRefresh();
    await renderPrefsSummary(stored);
  } else {
    signedOutEl.style.display = "block";
    signedInEl.style.display = "none";
    vaultSectionEl.style.display = "none";
    refreshSectionEl.style.display = "none";
  }
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
    vaultStatusEl.textContent = prefs.current_test_date
      ? `Saved — Availo will alert on anything earlier than ${new Date(prefs.current_test_date).toLocaleDateString()} at ${prefs.centre}.`
      : `Saved — Availo will alert on the first available date at ${prefs.centre}.`;
    await renderPrefsSummary(await getStored());
  } else {
    vaultStatusEl.textContent = "Saved. Your details stay on this device only.";
  }
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
    summaryEl.textContent = `Watching for: ${prefs.centre}${
      prefs.current_test_date ? `, earlier than ${new Date(prefs.current_test_date).toLocaleDateString()}` : ""
    }`;
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
