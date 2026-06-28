import { Router } from "express";
import { z } from "zod";
import {
  evaluateRule,
  evaluateRules,
  getConfig,
  setConfig,
  reloadConfig,
} from "../lib/ruleEngine.js";
import { logAudit } from "../lib/audit.js";
import { listPolicies, snapshotPolicy, activatePolicy, rollbackPolicy } from "../lib/policyEngine.js";
import { adminAuth } from "../middleware/adminAuth.js";

export const rulesRouter = Router();

export const AVAILABLE_RULES = ["detect_bot", "flag_early_slot", "rate_limit_ip"];

const runSchema = z.object({
  rule: z.enum(["detect_bot", "flag_early_slot", "rate_limit_ip"]),
  payload: z.record(z.any()),
});

rulesRouter.post("/run", (req, res, next) => {
  try {
    const { rule, payload } = runSchema.parse(req.body);
    const result = evaluateRule(rule, payload);
    res.json({ rule, ...result });
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/evaluate", (req, res, next) => {
  try {
    const payload = z.record(z.any()).parse(req.body);
    const result = evaluateRules(payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

rulesRouter.get("/config", adminAuth, (_req, res, next) => {
  try {
    res.json(getConfig());
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/config", adminAuth, (req, res, next) => {
  try {
    const config = z.record(z.any()).parse(req.body);
    const updated = setConfig(config);
    logAudit("rules_config_updated", {
      actor: "operator",
      payload: config,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/reload", adminAuth, (_req, res, next) => {
  try {
    const config = reloadConfig();
    logAudit("rules_config_reloaded", {
      actor: "operator",
      payload: { version: config.version },
    });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

rulesRouter.get("/policies", adminAuth, (_req, res, next) => {
  try {
    res.json(listPolicies());
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/policies/snapshot", adminAuth, (req, res, next) => {
  try {
    const note = z.string().optional().parse(req.body?.note || "");
    const version = snapshotPolicy(note);
    logAudit("policy_snapshot_created", {
      actor: "operator",
      payload: { version_id: version.id, note: version.note },
    });
    res.json(version);
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/policies/:id/activate", adminAuth, (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const version = activatePolicy(id);
    logAudit("policy_activated", {
      actor: "operator",
      payload: { version_id: version.id, version: version.version },
    });
    res.json(version);
  } catch (err) {
    next(err);
  }
});

rulesRouter.post("/policies/rollback", adminAuth, (_req, res, next) => {
  try {
    const version = rollbackPolicy();
    logAudit("policy_rollback", {
      actor: "operator",
      payload: { version_id: version.id, version: version.version },
    });
    res.json(version);
  } catch (err) {
    next(err);
  }
});

rulesRouter.get("/", adminAuth, (_req, res) => {
  const config = getConfig();
  const rules = Object.entries(config.rules || {}).map(([name, rule]) => ({
    name,
    enabled: rule.enabled,
    description: ruleDescription(name),
  }));
  res.json({ rules, quarantine_threshold: config.quarantineThreshold });
});

function ruleDescription(name) {
  const descriptions = {
    detect_bot: "Detects bot-like behaviour based on RPM, honeypot hits, headless UA and missing interaction events.",
    flag_early_slot: "Flags a cancellation slot that is earlier than the user's current booked test date.",
    rate_limit_ip: "Detects excessive requests from a single IP within a configurable window.",
  };
  return descriptions[name] || "";
}
