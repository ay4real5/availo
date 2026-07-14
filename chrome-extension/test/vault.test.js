const test = require("node:test");
const assert = require("node:assert");

// Minimal chrome.storage.local mock so vault.js (which is written for the
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

// Fresh require of vault.js each time.
function loadVault() {
  delete require.cache[require.resolve("../vault.js")];
  return require("../vault.js");
}

test("get() returns an empty vault when nothing is stored", async () => {
  installChromeMock();
  const V = loadVault();
  const v = await V.get();
  assert.equal(v.licence, "");
  assert.equal(v.bookingRef, "");
});

test("save() trims fields and uppercases the licence", async () => {
  installChromeMock();
  const V = loadVault();
  const saved = await V.save({ name: " Sarah ", licence: " ab12345cd ", bookingRef: " 12345678 ", centre: " Bolton " });
  assert.equal(saved.name, "Sarah");
  assert.equal(saved.licence, "AB12345CD");
  assert.equal(saved.bookingRef, "12345678");
  assert.equal(saved.centre, "Bolton");
});

test("get() round-trips a saved vault", async () => {
  installChromeMock();
  const V = loadVault();
  await V.save({ licence: "SMITH901234AB9CD", bookingRef: "12345678", centre: "Bolton", dateFrom: "2026-07-01", dateTo: "2026-08-01" });
  const v = await V.get();
  assert.equal(v.licence, "SMITH901234AB9CD");
  assert.equal(v.centre, "Bolton");
  assert.equal(v.dateFrom, "2026-07-01");
});

test("ready() requires a usable licence and booking reference", async () => {
  installChromeMock();
  const V = loadVault();
  assert.equal(V.ready({ licence: "SMITH901234AB9CD", bookingRef: "12345678" }), true);
  assert.equal(V.ready({ licence: "abc", bookingRef: "1" }), false);
  assert.equal(V.ready(null), false);
});

test("get() migrates the legacy roster's active person into the vault once", async () => {
  installChromeMock({
    availoRoster: [
      { id: "p_1", name: "A", licence: "AAAAA11111", bookingRef: "REF1", centres: ["Bury"], dateFrom: "", dateTo: "" },
      { id: "p_2", name: "B", licence: "BBBBB22222", bookingRef: "REF2", centres: ["Bolton"], dateFrom: "", dateTo: "" },
    ],
    availoActivePersonId: "p_2",
  });
  const V = loadVault();
  const v = await V.get();
  assert.equal(v.name, "B");
  assert.equal(v.licence, "BBBBB22222");
  assert.equal(v.centre, "Bolton");

  // Migration persists — a second get() doesn't re-derive from the roster.
  const again = await V.get();
  assert.equal(again.licence, "BBBBB22222");
});

test("get() migrates the first roster person when no active id is set", async () => {
  installChromeMock({
    availoRoster: [
      { id: "p_1", name: "A", licence: "AAAAA11111", bookingRef: "REF1", centres: ["Bury"], dateFrom: "", dateTo: "" },
    ],
  });
  const V = loadVault();
  const v = await V.get();
  assert.equal(v.name, "A");
  assert.equal(v.centre, "Bury");
});
