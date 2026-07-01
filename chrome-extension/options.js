const DEFAULT_BACKEND_URL = "http://localhost:4000";

const signedOutEl = document.getElementById("signedOut");
const signedInEl = document.getElementById("signedIn");
const statusEl = document.getElementById("status");

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function renderState() {
  const stored = await getStored();
  document.getElementById("backendUrl").value = stored.backendUrl || DEFAULT_BACKEND_URL;

  if (stored.token) {
    signedOutEl.style.display = "none";
    signedInEl.style.display = "block";
    document.getElementById("signedInEmail").textContent = stored.email || "";
    await renderPrefsSummary(stored);
  } else {
    signedOutEl.style.display = "block";
    signedInEl.style.display = "none";
  }
}

async function renderPrefsSummary(stored) {
  const summaryEl = document.getElementById("prefsSummary");
  try {
    const res = await fetch(`${stored.backendUrl}/api/auth/preferences`, {
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

renderState();
