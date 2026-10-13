-- =====================================================================
-- KICC Visitor Registration — D1 schema
-- Apply with:  npm run db:init        (remote)
--              npm run db:init:local  (local dev)
-- =====================================================================

-- ---------- events (seeded from config/event.config.json, editable at runtime) ----------
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  dates        TEXT,
  start_date   TEXT,
  end_date     TEXT,
  venue        TEXT,
  description  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_active ON events(active, sort_order);

-- ---------- registrations ----------
CREATE TABLE IF NOT EXISTS registrations (
  id               TEXT PRIMARY KEY,              -- KICC-YYMM-XXXX
  event_id         TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  email_norm       TEXT NOT NULL,                 -- lowercased + trimmed, for the unique index
  phone            TEXT NOT NULL,
  phone_norm       TEXT,
  org              TEXT,
  country          TEXT,
  doc_id           TEXT,
  category         TEXT NOT NULL,
  days             TEXT,
  needs            TEXT,
  consent          INTEGER NOT NULL DEFAULT 0,
  consent_at       TEXT,
  badge_token      TEXT,                          -- signed HMAC payload used by the QR badge
  checked_in       INTEGER NOT NULL DEFAULT 0,
  checked_in_at    TEXT,
  checked_in_by    TEXT,
  checked_in_gate  TEXT,
  source           TEXT,
  user_agent       TEXT,
  ip_hash          TEXT,                          -- salted SHA-256, never the raw IP
  email_sent       INTEGER NOT NULL DEFAULT 0,
  sheets_synced    INTEGER NOT NULL DEFAULT 0,
  tidc_synced      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Duplicate-email blocking enforced by the database, not just the API.
-- One address may register once per event; the same address may attend other events.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_unique_email_event
  ON registrations(event_id, email_norm);

CREATE INDEX IF NOT EXISTS idx_reg_event    ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_created  ON registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_checked  ON registrations(checked_in);
CREATE INDEX IF NOT EXISTS idx_reg_phone    ON registrations(phone_norm);

-- ---------- audit trail ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  actor   TEXT,
  action  TEXT NOT NULL,
  reg_id  TEXT,
  detail  TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

-- ---------- outbound sync queue (email / Sheets / TIDC retries) ----------
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_id      TEXT NOT NULL,
  target      TEXT NOT NULL,                      -- 'email' | 'sheets' | 'tidc'
  payload     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_queue_pending ON sync_queue(done, next_try_at);
