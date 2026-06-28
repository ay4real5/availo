process.env.DEV_STORE_PATH = ".debug-store.json";

const fs = await import("node:fs");
if (fs.existsSync(".debug-store.json")) fs.unlinkSync(".debug-store.json");

const { supabase } = await import("../src/lib/supabase.js");
const { processSlot } = await import("../src/lib/notifications.js");

supabase.reset();

const userId = "11111111-1111-1111-1111-111111111111";
await supabase.from("users").insert({ id: userId, email: "a@b.com", current_test_date: "2026-12-01T09:00:00.000Z" });

const { data: slot } = await supabase.from("available_slots").insert({
  user_id: userId,
  test_centre: "Bolton",
  slot_datetime: "2026-11-15T10:00:00.000Z",
  status: "pending",
}).select().single();

const result = await processSlot(
  { ...slot, current_test_date: "2026-12-01T09:00:00.000Z" },
  { ip: "1.2.3.4", userAgent: "test", requests_per_minute: 10, visited_trap_page: false },
);

console.log("result", result);

const { data: queue } = await supabase.from("notification_queue").select("*");
console.log("queue length", queue.length, queue);

const { data: slots } = await supabase.from("available_slots").select("status, rule_meta");
console.log("slots", slots);
