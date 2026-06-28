import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getConfig, setConfig } from "./ruleEngine.js";

const __filename = fileURLToPath(import.meta.url);
const policiesPath = process.env.POLICIES_PATH
  ? path.resolve(process.env.POLICIES_PATH)
  : path.resolve(path.dirname(__filename), "../../config/policies.json");

function loadPolicies() {
  if (existsSync(policiesPath)) {
    try {
      return JSON.parse(readFileSync(policiesPath, "utf8"));
    } catch (err) {
      console.error("[policyEngine] failed to load policies:", err.message);
    }
  }
  return { versions: [] };
}

function savePolicies(policies) {
  writeFileSync(policiesPath, JSON.stringify(policies, null, 2));
}

export function listPolicies() {
  return loadPolicies();
}

export function snapshotPolicy(note = "") {
  const current = getConfig();
  const policies = loadPolicies();
  const version = {
    id: uuidv4(),
    version: policies.versions.length + 1,
    created_at: new Date().toISOString(),
    active: false,
    note: note || `Snapshot ${policies.versions.length + 1}`,
    config: current,
  };
  policies.versions.forEach((v) => (v.active = false));
  version.active = true;
  policies.versions.push(version);
  savePolicies(policies);
  return version;
}

export function activatePolicy(id) {
  const policies = loadPolicies();
  const target = policies.versions.find((v) => v.id === id);
  if (!target) throw new Error(`Policy version ${id} not found`);

  policies.versions.forEach((v) => (v.active = false));
  target.active = true;
  savePolicies(policies);
  setConfig(target.config);
  return target;
}

export function rollbackPolicy() {
  const policies = loadPolicies();
  if (policies.versions.length < 2) throw new Error("No previous policy to roll back to");

  const previous = policies.versions[policies.versions.length - 2];
  return activatePolicy(previous.id);
}
