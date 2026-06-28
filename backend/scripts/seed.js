// Seed a demo user (demo@example.com) with a test date three months out so that
// scraped slots are "earlier" and trigger notifications.
//
// Seeding goes through the running backend's HTTP API (like get-user.js and
// quarantine-slot.js). This is important for the local dev store: the store is
// loaded into memory per-process and the whole file is rewritten on every write,
// so a separate process that writes directly would be clobbered by the running
// backend. Going through the API mutates the *backend's* in-memory store, which
// avoids that race and also works against the deployed Supabase backend.
//
// If the backend is not reachable (e.g. seeding before it has started), we fall
// back to writing directly to the store/Supabase, which is safe because no other
// process is writing at that point.

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");

function threeMonthsOut() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString();
}

const demoUser = {
  email: "demo@example.com",
  name: "Demo User",
  current_test_date: threeMonthsOut(),
};

async function seedViaApi() {
  const res = await fetch(`${BACKEND_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(demoUser),
  });
  if (!res.ok) {
    throw new Error(`backend responded ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function seedDirect() {
  const { supabase } = await import("../src/lib/supabase.js");
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", demoUser.email)
    .single();
  if (existing) {
    await supabase
      .from("users")
      .update({ current_test_date: demoUser.current_test_date })
      .eq("id", existing.id);
    return existing;
  }
  const { data, error } = await supabase.from("users").insert(demoUser).select().single();
  if (error) throw error;
  return data;
}

async function seed() {
  try {
    await seedViaApi();
    console.log(`[seed] created demo user ${demoUser.email} via ${BACKEND_URL}`);
  } catch (err) {
    const offline = /ECONNREFUSED|fetch failed|ENOTFOUND/i.test(err.message);
    if (!offline) throw err;
    console.log(`[seed] backend not reachable at ${BACKEND_URL}, seeding store directly`);
    await seedDirect();
    console.log(`[seed] created demo user ${demoUser.email} in local store`);
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});