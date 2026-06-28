import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const storePath = process.env.DEV_STORE_PATH
  ? path.resolve(process.env.DEV_STORE_PATH)
  : path.resolve("dev-store.json");

const defaultTables = {
  users: [],
  sessions: [],
  scraper_jobs: [],
  available_slots: [],
  bot_trap_visits: [],
  notification_queue: [],
  audit_log: [],
  bookings: [],
  user_preferences: [],
  scraper_control: [],
};

function loadTables() {
  if (existsSync(storePath)) {
    try {
      const raw = readFileSync(storePath, "utf8");
      return { ...defaultTables, ...JSON.parse(raw) };
    } catch (err) {
      console.error("[dev-store] failed to load, using defaults:", err.message);
      return structuredClone(defaultTables);
    }
  }
  return structuredClone(defaultTables);
}

let tables = loadTables();

// Debounced persistence: the dev store can receive hundreds of writes within a
// single request (e.g. /api/slots/report-centre inserts a row + audit entry per
// user per slot). Writing the entire JSON file synchronously on every mutation
// is O(file_size) per op and caused multi-second request times / timeouts.
// Instead we mark the store dirty and coalesce writes into a single async flush.
const PERSIST_DEBOUNCE_MS = Number(process.env.DEV_STORE_FLUSH_MS || 150);
let flushTimer = null;
let dirty = false;

function flushTablesSync() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  writeFileSync(storePath, JSON.stringify(tables, null, 2));
}

function persistTables() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTablesSync();
  }, PERSIST_DEBOUNCE_MS);
  // Don't keep the event loop alive solely for a pending flush.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

// Ensure pending writes are flushed when the process shuts down so we never lose
// data that was only scheduled for an async write.
let exitHooksRegistered = false;
function registerExitHooks() {
  if (exitHooksRegistered) return;
  exitHooksRegistered = true;
  const onExit = () => {
    try {
      flushTablesSync();
    } catch {
      // best-effort on shutdown
    }
  };
  process.once("exit", onExit);
  process.once("SIGINT", () => {
    onExit();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    onExit();
    process.exit(0);
  });
}
registerExitHooks();

const now = () => new Date().toISOString();

function applyDefaults(table, row) {
  const defaults = { id: row.id || uuidv4(), created_at: row.created_at || now() };
  if ("updated_at" in row) defaults.updated_at = row.updated_at;
  return { ...defaults, ...row };
}

function normaliseNull(value) {
  return value === undefined ? null : value;
}

function parseColumns(columns) {
  if (!columns || columns === "*") return { all: true, columns: [], relations: {} };
  const parts = columns.split(/,(?![^()]*\))/).map((p) => p.trim()).filter(Boolean);
  const result = { all: false, columns: [], relations: {} };
  for (const part of parts) {
    const relMatch = part.match(/^(.+)\((.+)\)$/);
    if (relMatch) {
      result.relations[relMatch[1]] = parseColumns(relMatch[2]);
    } else {
      result.columns.push(part);
    }
  }
  return result;
}

function resolveSelect(row, spec, tableName) {
  const columns = spec.columns ?? [];
  const relations = spec.relations ?? {};
  const result = {};

  if (spec.all || columns.includes("*")) {
    for (const [key, value] of Object.entries(row)) {
      result[key] = normaliseNull(value);
    }
  }

  for (const col of columns) {
    if (col !== "*") result[col] = normaliseNull(row[col]);
  }

  for (const [relName, relSpec] of Object.entries(relations)) {
    if (relName === "users" && tableName === "sessions") {
      const user = tables.users.find((u) => u.id === row.user_id);
      result[relName] = user ? resolveSelect(user, relSpec, "users") : null;
    }
  }

  return result;
}

class MemoryQueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.selectSpec = { all: true, columns: [], relations: {} };
    this.orderBy = null;
    this.orderAsc = true;
    this.limitCount = null;
    this.returnSingle = false;
    this.mutation = null;
  }

  select(columns) {
    this.selectSpec = parseColumns(columns);
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: "in", column, values: new Set(values) });
    return this;
  }

  gt(column, value) {
    this.filters.push({ type: "gt", column, value });
    return this;
  }

  order(column, { ascending }) {
    this.orderBy = column;
    this.orderAsc = ascending;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.returnSingle = true;
    return this;
  }

  insert(values) {
    this.mutation = { type: "insert", values };
    return this;
  }

  update(patch) {
    this.mutation = { type: "update", patch };
    return this;
  }

  delete() {
    this.mutation = { type: "delete" };
    return this;
  }

  getRows() {
    let rows = tables[this.table].map((r) => ({ ...r }));
    for (const f of this.filters) {
      if (f.type === "eq") rows = rows.filter((r) => r[f.column] === f.value);
      else if (f.type === "in") rows = rows.filter((r) => f.values.has(r[f.column]));
      else if (f.type === "gt") rows = rows.filter((r) => r[f.column] > f.value);
    }
    if (this.orderBy) {
      rows.sort((a, b) => {
        if (a[this.orderBy] < b[this.orderBy]) return this.orderAsc ? -1 : 1;
        if (a[this.orderBy] > b[this.orderBy]) return this.orderAsc ? 1 : -1;
        return 0;
      });
    }
    if (this.limitCount != null && this.limitCount >= 0) {
      rows = rows.slice(0, this.limitCount);
    }
    return rows;
  }

  execute() {
    let rows = this.getRows();

    if (this.mutation) {
      if (this.mutation.type === "insert") {
        const values = Array.isArray(this.mutation.values) ? this.mutation.values : [this.mutation.values];
        rows = values.map((row) => {
          const created = applyDefaults(this.table, row);
          tables[this.table].push(created);
          return { ...created };
        });
        persistTables();
      } else if (this.mutation.type === "update") {
        for (const row of rows) {
          const actual = tables[this.table].find((r) => r.id === row.id);
          if (actual) {
            Object.assign(actual, this.mutation.patch, { updated_at: now() });
          }
        }
        rows = this.getRows();
        persistTables();
      } else if (this.mutation.type === "delete") {
        tables[this.table] = tables[this.table].filter((row) => !rows.some((r) => r.id === row.id));
        rows = [];
        persistTables();
      }
    }

    const data = rows.map((row) => resolveSelect(row, this.selectSpec, this.table));
    return { data: this.returnSingle ? data[0] ?? null : data, error: null };
  }

  then(onResolve, onReject) {
    return Promise.resolve(this.execute()).then(onResolve, onReject);
  }
}

export const devStore = {
  from(table) {
    if (!tables[table]) {
      return {
        async execute() {
          return { data: null, error: { message: `Unknown table ${table}` } };
        },
      };
    }
    return new MemoryQueryBuilder(table);
  },
  reset() {
    tables = structuredClone(defaultTables);
    persistTables();
  },
};

export const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : devStore;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  console.log("[supabase] using real Supabase client", SUPABASE_URL);
} else {
  console.log("[supabase] using dev store", storePath);
}
