const DEFAULT_BACKEND_URL = "http://localhost:4000";

// The vault lives ONLY in chrome.storage.local on this device and is never sent
// to the backend. It holds the user's own booking details so Fast-Path can fill
// the DVSA login/search forms for them — password-manager class, nothing more.
const VAULT_KEY = "availoVault";

const signedOutEl = document.getElementById("signedOut");
const signedInEl = document.getElementById("signedIn");
const vaultSectionEl = document.getElementById("vaultSection");
const statusEl = document.getElementById("status");
const vaultStatusEl = document.getElementById("vaultStatus");

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email", VAULT_KEY]);
}

async function renderState() {
  const stored = await getStored();
  document.getElementById("backendUrl").value = stored.backendUrl || DEFAULT_BACKEND_URL;

  if (stored.token) {
    signedOutEl.style.display = "none";
    signedInEl.style.display = "block";
    vaultSectionEl.style.display = "block";
    document.getElementById("signedInEmail").textContent = stored.email || "";
    renderVault(stored[VAULT_KEY]);
    await renderPrefsSummary(stored);
  } else {
    signedOutEl.style.display = "block";
    signedInEl.style.display = "none";
    vaultSectionEl.style.display = "none";
  }
}

function renderVault(vault) {
  const v = vault || {};
  document.getElementById("vaultLicence").value = v.licence || "";
  document.getElementById("vaultBookingRef").value = v.bookingRef || "";
  document.getElementById("vaultCentre").value = v.centre || "";
  document.getElementById("vaultDateFrom").value = v.dateFrom || "";
  document.getElementById("vaultDateTo").value = v.dateTo || "";
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

document.getElementById("saveVault").addEventListener("click", async () => {
  const vault = {
    licence: document.getElementById("vaultLicence").value.trim().toUpperCase(),
    bookingRef: document.getElementById("vaultBookingRef").value.trim(),
    centre: document.getElementById("vaultCentre").value.trim(),
    dateFrom: document.getElementById("vaultDateFrom").value,
    dateTo: document.getElementById("vaultDateTo").value,
  };
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
  vaultStatusEl.textContent = "Saved. These stay on this device only.";
  setTimeout(() => { vaultStatusEl.textContent = ""; }, 3000);
});

document.getElementById("clearVault").addEventListener("click", async () => {
  await chrome.storage.local.remove(VAULT_KEY);
  renderVault(null);
  vaultStatusEl.textContent = "Cleared.";
  setTimeout(() => { vaultStatusEl.textContent = ""; }, 3000);
});

renderState();
