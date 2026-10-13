-- =====================================================================
-- KICC Visitor Registration — TiDB / MySQL schema
--
-- Apply with:  npm run db:tidb:migrate      (needs DATABASE_URL set)
--              npm run db:tidb:seed
--
-- TiDB Cloud Starter and Essential are both MySQL 8 compatible, so this is
-- plain MySQL. InnoDB + utf8mb4 throughout, because delegate names, event
-- titles and requirements text include non-Latin characters.
-- =====================================================================

-- ---------- events ----------
CREATE TABLE IF NOT EXISTS events (
  id           VARCHAR(80)   NOT NULL,
  name         VARCHAR(200)  NOT NULL,
  dates        VARCHAR(120)      NULL,
  start_date   DATE              NULL,
  end_date     DATE              NULL,
  venue        VARCHAR(160)      NULL,
  description  TEXT              NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order   INT           NOT NULL DEFAULT 0,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_active (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- registrations ----------
CREATE TABLE IF NOT EXISTS registrations (
  id               VARCHAR(24)   NOT NULL,        -- KICC-YYMM-XXXX
  event_id         VARCHAR(80)   NOT NULL,
  name             VARCHAR(120)  NOT NULL,
  email            VARCHAR(200)  NOT NULL,
  email_norm       VARCHAR(200)  NOT NULL,        -- lowercased + trimmed
  phone            VARCHAR(40)   NOT NULL,
  phone_norm       VARCHAR(20)       NULL,
  org              VARCHAR(160)      NULL,
  country          VARCHAR(80)       NULL,
  doc_id           VARCHAR(60)       NULL,
  category         VARCHAR(60)   NOT NULL,
  days             VARCHAR(60)       NULL,
  needs            TEXT              NULL,
  consent          TINYINT(1)    NOT NULL DEFAULT 0,
  consent_at       DATETIME          NULL,
  badge_token      VARCHAR(512)      NULL,
  checked_in       TINYINT(1)    NOT NULL DEFAULT 0,
  checked_in_at    DATETIME          NULL,
  checked_in_by    VARCHAR(60)       NULL,
  checked_in_gate  VARCHAR(60)       NULL,
  source           VARCHAR(40)       NULL,
  user_agent       VARCHAR(250)      NULL,
  ip_hash          VARCHAR(32)       NULL,        -- salted SHA-256, never the raw IP
  email_sent       TINYINT(1)    NOT NULL DEFAULT 0,
  sheets_synced    TINYINT(1)    NOT NULL DEFAULT 0,
  tidc_synced      TINYINT(1)    NOT NULL DEFAULT 0,
  notes            TEXT              NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Duplicate-email blocking is enforced by the database, not just the API:
  -- one address may register once per event, and may attend other events.
  UNIQUE KEY uniq_email_event (event_id, email_norm),
  KEY idx_reg_event   (event_id),
  KEY idx_reg_created (created_at),
  KEY idx_reg_checked (checked_in),
  KEY idx_reg_phone   (phone_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- audit trail ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGINT       NOT NULL AUTO_INCREMENT,
  at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor   VARCHAR(60)      NULL,
  action  VARCHAR(40)  NOT NULL,
  reg_id  VARCHAR(24)      NULL,
  detail  TEXT             NULL,
  PRIMARY KEY (id),
  KEY idx_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- outbound sync queue (email / Sheets / TIDC retries) ----------
CREATE TABLE IF NOT EXISTS sync_queue (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  reg_id      VARCHAR(24)  NOT NULL,
  target      VARCHAR(20)  NOT NULL,
  payload     TEXT             NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  last_error  TEXT             NULL,
  done        TINYINT(1)   NOT NULL DEFAULT 0,
  next_try_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_queue_pending (done, next_try_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
