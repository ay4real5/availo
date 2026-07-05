const test = require("node:test");
const assert = require("node:assert");

// Minimal chrome.storage.local mock so roster.js (which is written for the
// extension) can be unit-tested in Node. Each test gets a fresh store.
function installChromeMock(initial = {}) {
  const store = { ...initial };
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        async set(obj) { Object.assign(store, obj); },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        },
      },
    },
  };
  return store;
}

// Fresh require of roster.js each time (it caches module state minimally).
function loadRoster() {
  delete require.cache[require.resolve("../roster.js")];
  return require("../roster.js");
}

test("migrates the old single vault into roster[0]", async () => {
  installChromeMock({
    availoVault: { licence: "SMITH901234AB9CD", bookingRef: "12345678", centre: "Bolton", dateFrom: "2026-07-01", dateTo: "2026-08-01" },
  });
  const R = loadRoster();
  const roster = await R.get();
  assert.equal(roster.length, 1);
  assert.equal(roster[0].licence, "SMITH901234AB9CD");
  assert.equal(roster[0].bookingRef, "12345678");
  assert.deepEqual(roster[0].centres, ["Bolton"]);
});

test("caps the roster at 3 people", async () => {
  installChromeMock();
  const R = loadRoster();
  const five = Array.from({ length: 5 }, (_, i) => R.normalisePerson({ name: `P${i}`, licence: "AAAAA11111", bookingRef: "REF123" }));
  const saved = await R.save(five);
  assert.equal(saved.length, 3);
});

test("caps centres at 3 per person and trims blanks", async () => {
  installChromeMock();
  const R = loadRoster();
  const p = R.normalisePerson({ name: "Sarah", licence: "AAAAA11111", bookingRef: "REF123", centres: ["Bolton", "", "Bury", "Sale", "Wigan"] });
  assert.deepEqual(p.centres, ["Bolton", "Bury", "Sale"]);
});

test("personReady requires a usable licence and booking reference", async () => {
  installChromeMock();
  const R = loadRoster();
  assert.equal(R.personReady({ licence: "SMITH901234AB9CD", bookingRef: "12345678" }), true);
  assert.equal(R.personReady({ licence: "abc", bookingRef: "1" }), false);
  assert.equal(R.personReady(null), false);
});

test("pacing enforces safe minimum floors", async () => {
  installChromeMock();
  const R = loadRoster();
  const saved = await R.savePacing({ watchMinutes: 1, cooldownSeconds: 5, breakMinutes: 2 });
  assert.equal(saved.watchMinutes, R.PACING_FLOORS.watchMinutes);
  assert.equal(saved.cooldownSeconds, R.PACING_FLOORS.cooldownSeconds);
  assert.equal(saved.breakMinutes, R.PACING_FLOORS.breakMinutes);
});

test("pacing defaults apply when unset", async () => {
  installChromeMock();
  const R = loadRoster();
  const p = await R.getPacing();
  assert.deepEqual(p, R.PACING_DEFAULTS);
});

test("active person falls back to the first when none selected", async () => {
  installChromeMock();
  const R = loadRoster();
  const roster = await R.save([
    R.normalisePerson({ name: "A", licence: "AAAAA11111", bookingRef: "REF1", centres: ["Bolton"] }),
    R.normalisePerson({ name: "B", licence: "BBBBB22222", bookingRef: "REF2", centres: ["Bury"] }),
  ]);
  const active = await R.getActivePerson();
  assert.equal(active.name, "A");
  await R.setActiveId(roster[1].id);
  const active2 = await R.getActivePerson();
  assert.equal(active2.name, "B");
});

test("personToVault uses the primary (first) centre", async () => {
  installChromeMock();
  const R = loadRoster();
  const vault = R.personToVault({ licence: "AAAAA11111", bookingRef: "REF1", centres: ["Bury", "Bolton"], dateFrom: "2026-07-01", dateTo: "" });
  assert.equal(vault.centre, "Bury");
  assert.equal(vault.licence, "AAAAA11111");
  assert.equal(R.personToVault(null), null);
});
