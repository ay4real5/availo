import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const configPath = process.env.RULES_CONFIG_PATH
  ? path.resolve(process.env.RULES_CONFIG_PATH)
  : path.resolve(path.dirname(__filename), "../../config/rules.json");

let config = loadConfig();

function loadConfig() {
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[ruleEngine] failed to load config:", err.message);
    return defaultConfig();
  }
}

function defaultConfig() {
  return {
    version: 1,
    quarantineThreshold: 60,
    rules: {},
  };
}

export function getConfig() {
  return config;
}

export function setConfig(newConfig) {
  config = { ...config, ...newConfig };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

export function reloadConfig() {
  config = loadConfig();
  return config;
}

export function evaluateDetectBot(payload) {
  const rule = config.rules.detect_bot;
  if (!rule?.enabled) {
    return { is_bot: false, risk_score: 0, reasons: [], action: "allow" };
  }

  const rpm = payload.requests_per_minute || 0;
  const visitedTrap = payload.visited_trap_page === true;
  const ua = payload.ua || "";
  const noScroll = payload.no_scroll_events === true;
  const noMouse = payload.no_mouse_events === true;

  const signals = rule.signals || {};
  const reasons = [];
  let score = 0;

  if (signals.high_rpm?.enabled && rpm > signals.high_rpm.threshold) {
    score += signals.high_rpm.weight;
    reasons.push(signals.high_rpm.reason);
  }
  if (signals.honeypot_visit?.enabled && visitedTrap) {
    score += signals.honeypot_visit.weight;
    reasons.push(signals.honeypot_visit.reason);
  }
  if (signals.headless_ua?.enabled) {
    const pattern = new RegExp(signals.headless_ua.pattern, "i");
    if (pattern.test(ua)) {
      score += signals.headless_ua.weight;
      reasons.push(signals.headless_ua.reason);
    }
  }
  if (signals.no_scroll_events?.enabled && noScroll) {
    score += signals.no_scroll_events.weight;
    reasons.push(signals.no_scroll_events.reason);
  }
  if (signals.no_mouse_events?.enabled && noMouse) {
    score += signals.no_mouse_events.weight;
    reasons.push(signals.no_mouse_events.reason);
  }

  score = Math.min(score, 100);
  const isBot = score >= config.quarantineThreshold;
  return {
    is_bot: isBot,
    risk_score: score,
    reasons,
    action: isBot ? "quarantine" : "allow",
  };
}

export function evaluateFlagEarlySlot(payload) {
  const rule = config.rules.flag_early_slot;
  if (!rule?.enabled) {
    return { is_early: false, risk_score: 0, reasons: [], action: "ignore" };
  }

  const slotDate = payload.slot_datetime ? new Date(payload.slot_datetime) : null;
  const currentDate = payload.current_test_date ? new Date(payload.current_test_date) : null;

  if (!slotDate || !currentDate) {
    return { is_early: false, risk_score: 0, reasons: ["Missing dates"] };
  }

  if (slotDate < currentDate) {
    const daysEarlier = (currentDate - slotDate) / (1000 * 60 * 60 * 24);
    const score = Math.min(
      rule.baseScore + Math.floor(daysEarlier / 7) * rule.weeklyMultiplier,
      rule.maxScore,
    );
    return {
      is_early: true,
      risk_score: score,
      reasons: [rule.reason.replace("{days}", Math.floor(daysEarlier))],
      action: "notify",
    };
  }

  return {
    is_early: false,
    risk_score: 0,
    reasons: ["Not earlier than current test date"],
    action: "ignore",
  };
}

const ipRequests = new Map();

export function evaluateRateLimitIp(payload) {
  const rule = config.rules.rate_limit_ip;
  if (!rule?.enabled) {
    return { is_rate_limited: false, risk_score: 0, reasons: [], action: "allow" };
  }

  const ip = payload.ip || "unknown";
  const windowMs = rule.windowMinutes * 60 * 1000;
  const now = Date.now();
  const history = ipRequests.get(ip) || [];
  const recent = history.filter((t) => now - t < windowMs);
  recent.push(now);
  ipRequests.set(ip, recent);

  if (recent.length > rule.maxRequests) {
    return {
      is_rate_limited: true,
      risk_score: rule.weight,
      reasons: [rule.reason],
      action: "quarantine",
      requests_in_window: recent.length,
    };
  }

  return {
    is_rate_limited: false,
    risk_score: 0,
    reasons: [],
    action: "allow",
    requests_in_window: recent.length,
  };
}

export function evaluateRules(payload) {
  const bot = evaluateDetectBot(payload);
  const early = evaluateFlagEarlySlot(payload);
  const rateLimit = evaluateRateLimitIp(payload);

  const reasons = [...bot.reasons, ...rateLimit.reasons];
  const botScore = bot.risk_score;
  const combinedScore = Math.min(botScore + rateLimit.risk_score, 100);

  return {
    bot,
    early,
    rateLimit,
    combined_score: combinedScore,
    quarantine_threshold: config.quarantineThreshold,
    is_bot: bot.is_bot || rateLimit.is_rate_limited,
    should_quarantine: combinedScore >= config.quarantineThreshold,
    should_notify: early.is_early,
    reasons,
  };
}

export function evaluateRule(name, payload) {
  if (name === "detect_bot") return evaluateDetectBot(payload);
  if (name === "flag_early_slot") return evaluateFlagEarlySlot(payload);
  if (name === "rate_limit_ip") return evaluateRateLimitIp(payload);
  return { risk_score: 0, reasons: [], action: "allow" };
}
