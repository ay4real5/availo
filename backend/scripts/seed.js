import { supabase } from "../src/lib/supabase.js";

async function seed() {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", "demo@example.com")
    .single();

  if (!existing) {
    const currentTestDate = new Date();
    currentTestDate.setMonth(currentTestDate.getMonth() + 3);
    await supabase.from("users").insert({
      email: "demo@example.com",
      name: "Demo User",
      current_test_date: currentTestDate.toISOString(),
    });
    console.log("[seed] created demo user demo@example.com");
  } else {
    console.log("[seed] demo user already exists");
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
