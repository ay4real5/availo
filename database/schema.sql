-- ============================================================================
-- Availo (browser-based Testi-style MVP) schema
-- ----------------------------------------------------------------------------
-- This file is the canonical Postgres/Supabase schema. It is idempotent and
-- safe to re-run: every object uses IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- The backend talks to Supabase via the service-role key (see backend/.env),
-- and falls back to an in-memory dev store when SUPABASE_URL is unset.
--
-- Apply with:  psql "$DATABASE_URL" -f database/schema.sql
--          or: paste into the Supabase SQL editor and run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shared trigger to keep updated_at columns fresh on UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  current_test_date TIMESTAMPTZ,
  -- Auto-book pipeline fields (synced from user_preferences).
  auto_book BOOLEAN DEFAULT FALSE,
  licence_number TEXT,
  -- Tokenised payment details. The raw PAN/CVC are NEVER stored: only an opaque
  -- token plus masked metadata (see backend/src/lib/payments.js).
  payment_token TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp TEXT,
  card_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columns added after the original schema (safe on existing databases).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_book BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS licence_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_last4 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_exp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_name TEXT;

-- ── user_preferences ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  centre TEXT NOT NULL,
  current_test_date TIMESTAMPTZ,
  search_days_ahead INT DEFAULT 42,
  notify_email BOOLEAN DEFAULT TRUE,
  notify_sms BOOLEAN DEFAULT FALSE,
  phone TEXT,
  auto_book BOOLEAN DEFAULT FALSE,
  licence_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ── sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip TEXT,
  user_agent TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  is_bot BOOLEAN DEFAULT FALSE,
  risk_score INT DEFAULT 0,
  flags JSONB DEFAULT '{}'
);

-- ── watch_sessions ───────────────────────────────────────────────────────────
-- A "watch session" is the user's own browser tab actively watching the real
-- DVSA site via the Chrome extension. The backend never initiates or drives
-- these — it only records what the extension reports (see backend/src/routes/watch.js).
CREATE TABLE IF NOT EXISTS watch_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active',        -- active | ended
  test_centre TEXT,
  target_date TIMESTAMPTZ,
  tab_url TEXT,
  extension_version TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── scraper_jobs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_centre TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  proxy_used TEXT,
  ip_used TEXT,
  ua_used TEXT,
  slots_found INT DEFAULT 0,
  error TEXT,
  source_meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS source_meta JSONB DEFAULT '{}';
ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS test_centre TEXT;

-- ── available_slots ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS available_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  test_centre TEXT NOT NULL,
  slot_datetime TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',          -- pending | approved | quarantined | booked
  scraped_by_job UUID REFERENCES scraper_jobs(id) ON DELETE SET NULL,
  proxy_used TEXT,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  source_meta JSONB DEFAULT '{}',
  rule_meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Guards so an older available_slots (created by a previous run) gains any
-- missing columns before the indexes below reference them.
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS test_centre TEXT;
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS source_meta JSONB DEFAULT '{}';
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS rule_meta JSONB DEFAULT '{}';
ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS watch_session_id UUID REFERENCES watch_sessions(id) ON DELETE SET NULL;

-- ── bookings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre TEXT NOT NULL,
  slot_datetime TIMESTAMPTZ NOT NULL,
  booking_reference TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',        -- held | confirmed | cancelled | failed
  scraped_by_job TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS test_centre TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id UUID;

-- ── bot_trap_visits ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_trap_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── notification_queue ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID REFERENCES available_slots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT DEFAULT 'push',
  status TEXT DEFAULT 'pending',
  rule_meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- ── audit_log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  entity_id UUID,
  entity_type TEXT,
  actor TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── scraper_control ──────────────────────────────────────────────────────────
-- Singleton kill-switch row (id = 'global'). The scraper coordinator/worker read
-- this each cycle; the dashboard toggles it. Pausing stops new work safely.
CREATE TABLE IF NOT EXISTS scraper_control (
  id TEXT PRIMARY KEY DEFAULT 'global',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO scraper_control (id, paused) VALUES ('global', FALSE)
  ON CONFLICT (id) DO NOTHING;

-- ── indexes (idempotent) ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions(ip);
CREATE INDEX IF NOT EXISTS idx_sessions_is_bot ON sessions(is_bot);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_prefs_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_prefs_centre ON user_preferences(centre);
CREATE INDEX IF NOT EXISTS idx_slots_test_centre ON available_slots(test_centre);
CREATE INDEX IF NOT EXISTS idx_slots_user_id ON available_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_slots_status ON available_slots(status);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_centre ON bookings(test_centre);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_test_centre ON scraper_jobs(test_centre);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_user_id ON watch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_status ON watch_sessions(status);
CREATE INDEX IF NOT EXISTS idx_slots_watch_session_id ON available_slots(watch_session_id);

-- ── updated_at triggers ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_prefs_updated_at ON user_preferences;
CREATE TRIGGER trg_prefs_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON scraper_jobs;
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON scraper_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notification_queue;
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notification_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_scraper_control_updated_at ON scraper_control;
CREATE TRIGGER trg_scraper_control_updated_at BEFORE UPDATE ON scraper_control
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security (optional) ────────────────────────────────────────────
-- The backend uses the Supabase SERVICE ROLE key, which bypasses RLS. If you
-- ever expose tables to the anon/auth client directly, enable RLS and add
-- per-user policies. Left disabled by default so the service-role backend and
-- the dev store behave identically.
--
-- ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY prefs_owner ON user_preferences
--   USING (user_id = auth.uid());
