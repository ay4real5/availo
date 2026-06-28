import test from "node:test";
import assert from "node:assert";
import {
  evaluateDetectBot,
  evaluateFlagEarlySlot,
  evaluateRateLimitIp,
  evaluateRules,
  getConfig,
} from "../src/lib/ruleEngine.js";

test("detectBot: human-like session", () => {
  const result = evaluateDetectBot({
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    requests_per_minute: 10,
    visited_trap_page: false,
    no_scroll_events: false,
    no_mouse_events: false,
  });
  assert.equal(result.is_bot, false);
  assert.equal(result.risk_score, 0);
  assert.equal(result.action, "allow");
});

test("detectBot: borderline high RPM", () => {
  const result = evaluateDetectBot({
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    requests_per_minute: 120,
    visited_trap_page: false,
    no_scroll_events: false,
    no_mouse_events: false,
  });
  assert.equal(result.is_bot, false);
  assert.equal(result.risk_score, 40);
  assert.equal(result.action, "allow");
});

test("detectBot: bot-like honeypot + headless", () => {
  const result = evaluateDetectBot({
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (HeadlessChrome)",
    requests_per_minute: 150,
    visited_trap_page: true,
    no_scroll_events: true,
    no_mouse_events: false,
  });
  assert.equal(result.is_bot, true);
  assert.ok(result.risk_score >= 60);
  assert.equal(result.action, "quarantine");
});

test("flagEarlySlot: earlier slot triggers notify", () => {
  const result = evaluateFlagEarlySlot({
    slot_datetime: "2026-11-01T10:00:00.000Z",
    current_test_date: "2026-12-01T09:00:00.000Z",
  });
  assert.equal(result.is_early, true);
  assert.ok(result.risk_score > 0);
  assert.equal(result.action, "notify");
});

test("flagEarlySlot: later slot is ignored", () => {
  const result = evaluateFlagEarlySlot({
    slot_datetime: "2026-12-15T10:00:00.000Z",
    current_test_date: "2026-12-01T09:00:00.000Z",
  });
  assert.equal(result.is_early, false);
  assert.equal(result.risk_score, 0);
  assert.equal(result.action, "ignore");
});

test("rateLimitIp: allows under threshold", () => {
  const result = evaluateRateLimitIp({ ip: "1.2.3.4" });
  assert.equal(result.is_rate_limited, false);
  assert.equal(result.risk_score, 0);
  assert.equal(result.action, "allow");
});

test("evaluateRules: combines bot and early signals", () => {
  const result = evaluateRules({
    ip: "1.2.3.4",
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (HeadlessChrome)",
    requests_per_minute: 150,
    visited_trap_page: true,
    slot_datetime: "2026-11-01T10:00:00.000Z",
    current_test_date: "2026-12-01T09:00:00.000Z",
  });
  assert.equal(result.should_quarantine, true);
  assert.equal(result.should_notify, true);
  assert.equal(result.bot.is_bot, true);
  assert.equal(result.early.is_early, true);
});

test("evaluateRules: human session with early slot only notifies", () => {
  const result = evaluateRules({
    ip: "1.2.3.4",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    requests_per_minute: 10,
    visited_trap_page: false,
    slot_datetime: "2026-11-15T10:00:00.000Z",
    current_test_date: "2026-12-01T09:00:00.000Z",
  });
  assert.equal(result.should_quarantine, false);
  assert.equal(result.should_notify, true);
});

test("rule config is loadable", () => {
  const config = getConfig();
  assert.ok(config.quarantineThreshold > 0);
  assert.ok(config.rules.detect_bot);
  assert.ok(config.rules.flag_early_slot);
});
