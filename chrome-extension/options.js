const DEFAULT_BACKEND_URL = "https://availo-backend-4dbx.onrender.com";

// The roster + pacing live ONLY in chrome.storage.local on this device and are
// never sent to the backend (see roster.js). AvailoRoster is loaded before this
// file in options.html.
const REFRESH_KEY = "availoAutoRefresh";

const signedOutEl = document.getElementById("signedOut");
const signedInEl = document.getElementById("signedIn");
const rosterSectionEl = document.getElementById("rosterSection");
const pacingSectionEl = document.getElementById("pacingSection");
const refreshSectionEl = document.getElementById("refreshSection");
const statusEl = document.getElementById("status");
const rosterStatusEl = document.getElementById("rosterStatus");
const pacingStatusEl = document.getElementById("pacingStatus");
const refreshStatusEl = document.getElementById("refreshStatus");

// Working copy of the roster while the page is open; persisted on Save.
let roster = [];

async function getStored() {
  return chrome.storage.local.get(["backendUrl", "token", "userId", "email"]);
}

async function renderState() {
  const stored = await getStored();
  document.getElementById("backendUrl").value = stored.backendUrl || DEFAULT_BACKEND_URL;

  if (stored.token) {
    signedOutEl.style.display = "none";
    signedInEl.style.display = "block";
    rosterSectionEl.style.display = "block";
    pacingSectionEl.style.display = "block";
    refreshSectionEl.style.display = "block";
    document.getElementById("signedInEmail").textContent = stored.email || "";
    roster = await AvailoRoster.get();
    renderRoster();
    await renderPacing();
    await renderRefresh();
    await renderPrefsSummary(stored);
  } else {
    signedOutEl.style.display = "block";
    signedInEl.style.display = "none";
    rosterSectionEl.style.display = "none";
    pacingSectionEl.style.display = "none";
    refreshSectionEl.style.display = "none";
  }
}

async function renderRefresh() {
  const { [REFRESH_KEY]: s } = await chrome.storage.local.get(REFRESH_KEY);
  const cfg = s || {};
  document.getElementById("autoRefreshEnabled").checked = cfg.enabled !== false; // default on
  document.getElementById("autoRefreshSeconds").value = Math.max(45, Number(cfg.baseSeconds) || 90);
}

// Read the current form values back into the `roster` working copy. Called
// before any structural change (add/remove person/centre) so edits aren't lost.
function syncRosterFromDom() {
  roster = roster.map((person, i) => {
    const card = document.querySelector(`.person-card[data-index="${i}"]`);
    if (!card) return person;
    const centres = [...card.querySelectorAll(".centre-input")]
      .map((el) => el.value.trim())
      .filter(Boolean)
      .slice(0, AvailoRoster.MAX_CENTRES);
    return {
      ...person,
      name: card.querySelector(".p-name").value.trim(),
      licence: card.querySelector(".p-licence").value.trim().toUpperCase(),
      bookingRef: card.querySelector(".p-bookingref").value.trim(),
      centres,
      currentTestDate: card.querySelector(".p-currentdate").value,
      dateFrom: card.querySelector(".p-datefrom").value,
      dateTo: card.querySelector(".p-dateto").value,
    };
  });
}

function centreRowHtml(centre, ci) {
  return `
    <div class="centre-row">
      <input class="centre-input" type="text" data-ci="${ci}" placeholder="e.g. Bolton" value="${escapeAttr(centre)}" />
      <button type="button" class="remove-centre" data-ci="${ci}">Remove</button>
    </div>`;
}

function personCardHtml(person, i) {
  const centres = person.centres && person.centres.length ? person.centres : [""];
  const centreRows = centres.map((c, ci) => centreRowHtml(c, ci)).join("");
  const canAddCentre = centres.length < AvailoRoster.MAX_CENTRES;
  return `
    <div class="person-card" data-index="${i}">
      <div class="person-head">
        <span class="person-title">Person ${i + 1}</span>
        <button type="button" class="remove-person">Remove</button>
      </div>
      <label>Name (just for you)</label>
      <input class="p-name" type="text" autocomplete="off" placeholder="e.g. Sarah" value="${escapeAttr(person.name)}" />
      <label>Driving licence number</label>
      <input class="p-licence" type="text" autocomplete="off" value="${escapeAttr(person.licence)}" />
      <label>Booking reference</label>
      <input class="p-bookingref" type="text" autocomplete="off" value="${escapeAttr(person.bookingRef)}" />
      <label>Test centres to watch (up to ${AvailoRoster.MAX_CENTRES})</label>
      <div class="centres-list">${centreRows}</div>
      ${canAddCentre ? `<button type="button" class="add-centre">+ Add another centre</button>` : ""}
      <label>Their current test date (only alert on earlier slots)</label>
      <input class="p-currentdate" type="date" value="${escapeAttr(person.currentTestDate)}" />
      <div class="row">
        <div>
          <label>Search from</label>
          <input class="p-datefrom" type="date" value="${escapeAttr(person.dateFrom)}" />
        </div>
        <div>
          <label>Search to</label>
          <input class="p-dateto" type="date" value="${escapeAttr(person.dateTo)}" />
        </div>
      </div>
    </div>`;
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderRoster() {
  const listEl = document.getElementById("rosterList");
  listEl.innerHTML = roster.map((p, i) => personCardHtml(p, i)).join("");

  // Wire per-card buttons.
  listEl.querySelectorAll(".person-card").forEach((card) => {
    const i = Number(card.getAttribute("data-index"));
    card.querySelector(".remove-person").addEventListener("click", () => {
      syncRosterFromDom();
      roster.splice(i, 1);
      renderRoster();
    });
    const addCentreBtn = card.querySelector(".add-centre");
    if (addCentreBtn) addCentreBtn.addEventListener("click", () => {
      syncRosterFromDom();
      roster[i].centres = [...(roster[i].centres || []), ""];
      renderRoster();
    });
    card.querySelectorAll(".remove-centre").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ci = Number(btn.getAttribute("data-ci"));
        syncRosterFromDom();
        roster[i].centres.splice(ci, 1);
        renderRoster();
      });
    });
  });

  // Cap note + add-person button state.
  const capNote = document.getElementById("capNote");
  const addBtn = document.getElementById("addPerson");
  if (roster.length >= AvailoRoster.MAX_PEOPLE) {
    capNote.textContent = `You can watch up to ${AvailoRoster.MAX_PEOPLE} people from one laptop. This keeps you safe on a single home connection.`;
    addBtn.style.display = "none";
  } else {
    capNote.textContent = "";
    addBtn.style.display = "inline-block";
  }
}

async function renderPacing() {
  const p = await AvailoRoster.getPacing();
  document.getElementById("watchMinutes").value = p.watchMinutes;
  document.getElementById("cooldownSeconds").value = p.cooldownSeconds;
  document.getElementById("breakMinutes").value = p.breakMinutes;
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

document.getElementById("addPerson").addEventListener("click", () => {
  if (roster.length >= AvailoRoster.MAX_PEOPLE) return;
  syncRosterFromDom();
  roster.push(AvailoRoster.emptyPerson());
  renderRoster();
});

// One "Save" persists the whole roster. Fires whenever any field changes via a
// small debounce, plus explicitly is safe because renderState re-reads storage.
async function saveRoster() {
  syncRosterFromDom();
  roster = await AvailoRoster.save(roster);
  renderRoster();
  rosterStatusEl.textContent = "Saved. Everyone's details stay on this device only.";
  setTimeout(() => { rosterStatusEl.textContent = ""; }, 3000);
}

// Save the roster on blur of any input inside the list (so edits persist without
// a separate button), and also expose an explicit trigger via the add button.
document.getElementById("rosterList").addEventListener("change", saveRoster);

document.getElementById("savePacing").addEventListener("click", async () => {
  const saved = await AvailoRoster.savePacing({
    watchMinutes: Number(document.getElementById("watchMinutes").value),
    cooldownSeconds: Number(document.getElementById("cooldownSeconds").value),
    breakMinutes: Number(document.getElementById("breakMinutes").value),
  });
  document.getElementById("watchMinutes").value = saved.watchMinutes;
  document.getElementById("cooldownSeconds").value = saved.cooldownSeconds;
  document.getElementById("breakMinutes").value = saved.breakMinutes;
  pacingStatusEl.textContent = `Saved — watching ${saved.watchMinutes} min each, ${saved.cooldownSeconds}s gap, ${saved.breakMinutes} min break.`;
  setTimeout(() => { pacingStatusEl.textContent = ""; }, 3500);
});

document.getElementById("saveRefresh").addEventListener("click", async () => {
  const enabled = document.getElementById("autoRefreshEnabled").checked;
  const baseSeconds = Math.max(45, Math.min(600, Number(document.getElementById("autoRefreshSeconds").value) || 90));
  await chrome.storage.local.set({ [REFRESH_KEY]: { enabled, baseSeconds } });
  document.getElementById("autoRefreshSeconds").value = baseSeconds;
  refreshStatusEl.textContent = enabled ? `Saved — refreshing about every ${baseSeconds}s while watching.` : "Saved — auto-refresh off.";
  setTimeout(() => { refreshStatusEl.textContent = ""; }, 3000);
});

renderState();
