/**
 * Every SQL statement the application runs, in one place.
 * =====================================================================
 *
 * RULES FOR THIS FILE (enforced by scripts/test-data-layer.mjs)
 *
 *  1. Placeholders are always `?`. TiDB, D1 and mysql2 all accept it.
 *  2. No SQLite-only functions. `datetime('now')`, `date('now')`, `strftime()`
 *     and `INSERT OR REPLACE` are forbidden. Timestamps are computed in
 *     JavaScript and bound as parameters, so the database engine never has to
 *     supply "now" — and the same string runs on MySQL and SQLite.
 *  3. `CURRENT_DATE` and `DATE()` are used where the engine must judge a date;
 *     both exist in MySQL 8 and SQLite.
 *  4. `LIMIT` / `OFFSET` are sanitised integers, inlined rather than bound —
 *     parameter binding for LIMIT differs between drivers.
 *  5. Every dynamic identifier (sort column, sync target column) is looked up
 *     in a whitelist, never taken from user input.
 *
 * That is the whole dialect strategy: write once, run on either engine.
 */

/* ------------------------------------------------------------------ whitelists */

export const SORTABLE = {
  created: 'r.created_at',
  name: 'r.name',
  event: 'r.event_id',
  checkin: 'r.checked_in_at',
  category: 'r.category'
};

/** Columns processRegistration may flip after a successful outbound sync. */
export const FLAG_COLUMNS = {
  email: 'email_sent',
  tidc: 'tidc_synced'
};

const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/* ------------------------------------------------------------------ events */

export const listEvents = (activeOnly = true) => ({
  sql: activeOnly
    ? 'SELECT * FROM events WHERE active = 1 ORDER BY sort_order ASC, name ASC'
    : 'SELECT * FROM events ORDER BY sort_order ASC, name ASC',
  params: []
});

export const findEvent = (id) => ({
  sql: 'SELECT * FROM events WHERE id = ? LIMIT 1',
  params: [String(id)]
});

export const insertEvent = (e) => ({
  sql: `INSERT INTO events (id, name, dates, start_date, end_date, venue, description, active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)`,
  params: [
    String(e.id).slice(0, 80),
    String(e.name).slice(0, 200),
    e.dates || null,
    e.startDate || null,
    e.endDate || null,
    e.venue || null,
    e.description || null,
    e.active === false ? 0 : 1,
    Number(e.sortOrder) || 0
  ]
});

const EVENT_FIELDS = {
  name: 'name',
  dates: 'dates',
  startDate: 'start_date',
  endDate: 'end_date',
  venue: 'venue',
  description: 'description',
  active: 'active',
  sortOrder: 'sort_order'
};

export function updateEvent(id, patch) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = EVENT_FIELDS[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(col === 'active' ? (value ? 1 : 0) : value);
  }
  if (!sets.length) return null;
  params.push(String(id));
  return { sql: `UPDATE events SET ${sets.join(', ')} WHERE id = ?`, params };
}

export const deleteEvent = (id) => ({ sql: 'DELETE FROM events WHERE id = ?', params: [String(id)] });
export const deactivateEvent = (id) => ({
  sql: 'UPDATE events SET active = 0 WHERE id = ?',
  params: [String(id)]
});
export const countRegistrationsForEvent = (id) => ({
  sql: 'SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?',
  params: [String(id)]
});

/* ------------------------------------------------------------------ registration */

export const findRegistration = (id) => ({
  sql: 'SELECT * FROM registrations WHERE id = ? LIMIT 1',
  params: [String(id)]
});

export const findRegistrationByEmail = (eventId, emailNorm) => ({
  sql: `SELECT id, name, checked_in FROM registrations
         WHERE event_id = ? AND email_norm = ? LIMIT 1`,
  params: [String(eventId), String(emailNorm)]
});

export const idExists = (id) => ({
  sql: 'SELECT id FROM registrations WHERE id = ? LIMIT 1',
  params: [String(id)]
});

export const countRegistrationsByIpSince = (ipHash, since) => ({
  sql: 'SELECT COUNT(*) AS n FROM registrations WHERE ip_hash = ? AND created_at >= ?',
  params: [ipHash, since]
});

export function insertRegistration(rec, now) {
  return {
    sql: `INSERT INTO registrations
            (id, event_id, name, email, email_norm, phone, phone_norm, org, country, doc_id,
             category, days, needs, consent, consent_at, badge_token, source, user_agent, ip_hash,
             created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [
      rec.id,
      rec.event_id,
      rec.name,
      rec.email,
      rec.email_norm,
      rec.phone,
      rec.phone_norm,
      rec.org || null,
      rec.country || null,
      rec.doc_id || null,
      rec.category,
      rec.days || null,
      rec.needs || null,
      rec.consent ? 1 : 0,
      rec.consent ? now : null,
      rec.badge_token || null,
      rec.source || null,
      rec.user_agent || null,
      rec.ip_hash || null,
      now,
      now
    ]
  };
}

export const deleteRegistration = (id) => ({
  sql: 'DELETE FROM registrations WHERE id = ?',
  params: [String(id)]
});

export const markCheckedIn = (id, at, by, gate) => ({
  sql: `UPDATE registrations
           SET checked_in = 1, checked_in_at = ?, checked_in_by = ?, checked_in_gate = ?, updated_at = ?
         WHERE id = ?`,
  params: [at, by || null, gate || null, at, String(id)]
});

export const setCheckedIn = (id, on, at) => ({
  sql: `UPDATE registrations
           SET checked_in = ?, checked_in_at = ?, updated_at = ?
         WHERE id = ?`,
  params: [on ? 1 : 0, on ? at : null, at, String(id)]
});

export const setNotes = (id, notes, at) => ({
  sql: 'UPDATE registrations SET notes = ?, updated_at = ? WHERE id = ?',
  params: [String(notes).slice(0, 2000), at, String(id)]
});

export const setCategory = (id, category, at) => ({
  sql: 'UPDATE registrations SET category = ?, updated_at = ? WHERE id = ?',
  params: [String(category), at, String(id)]
});

export const setGate = (id, gate, at) => ({
  sql: 'UPDATE registrations SET checked_in_gate = ?, updated_at = ? WHERE id = ?',
  params: [String(gate).slice(0, 60), at, String(id)]
});

/** Flip a post-sync flag. `column` must come from FLAG_COLUMNS. */
export function setSyncFlag(id, column, value, at) {
  const col = Object.values(FLAG_COLUMNS).find((c) => c === column);
  if (!col) return null;
  return {
    sql: `UPDATE registrations SET ${col} = ?, updated_at = ? WHERE id = ?`,
    params: [value ? 1 : 0, at, String(id)]
  };
}

/* ------------------------------------------------------------------ audit */

export const insertAudit = ({ actor, action, regId, detail, at }) => ({
  sql: `INSERT INTO audit_log (actor, action, reg_id, detail, at) VALUES (?,?,?,?,?)`,
  params: [
    actor ? String(actor).slice(0, 60) : null,
    String(action).slice(0, 40),
    regId || null,
    detail == null ? null : String(detail).slice(0, 2000),
    at
  ].map((v) => (v === undefined ? null : v))
});

/* ------------------------------------------------------------------ admin listing */

/**
 * One builder for the registry list, the CSV export and the paging count, so
 * the filters can never drift apart between them.
 */
export function buildRegistrationFilter({ q, eventId, status, category } = {}) {
  const where = [];
  const params = [];

  const term = String(q || '').trim().toLowerCase();
  if (term) {
    where.push(
      `(LOWER(r.name) LIKE ? OR LOWER(r.email) LIKE ? OR LOWER(r.phone) LIKE ?
        OR LOWER(r.id) LIKE ? OR LOWER(COALESCE(r.org, '')) LIKE ?)`
    );
    const like = `%${term}%`;
    params.push(like, like, like, like, like);
  }
  if (eventId) {
    where.push('r.event_id = ?');
    params.push(String(eventId));
  }
  if (status === 'in') where.push('r.checked_in = 1');
  if (status === 'out') where.push('r.checked_in = 0');
  if (category) {
    where.push('r.category = ?');
    params.push(String(category));
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listRegistrations({ filters = {}, sort, dir, page, pageSize } = {}) {
  const { clause, params } = buildRegistrationFilter(filters);
  const sortCol = SORTABLE[sort] || SORTABLE.created;
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const size = clampInt(pageSize, 5, 200, 50);
  const current = clampInt(page, 1, 100000, 1);
  const offset = (current - 1) * size;

  return {
    count: {
      sql: `SELECT COUNT(*) AS n FROM registrations r ${clause}`,
      params: [...params]
    },
    rows: {
      sql: `SELECT r.*, e.name AS event_name, e.dates AS event_dates, e.venue AS event_venue
              FROM registrations r
              LEFT JOIN events e ON e.id = r.event_id
              ${clause}
             ORDER BY ${sortCol} ${direction}
             LIMIT ${size} OFFSET ${offset}`,
      params: [...params]
    },
    page: current,
    pageSize: size
  };
}

export function exportRegistrations({ filters = {}, limit = 20000 } = {}) {
  const { clause, params } = buildRegistrationFilter(filters);
  const cap = clampInt(limit, 1, 100000, 20000);
  return {
    sql: `SELECT r.*, e.name AS event_name, e.dates AS event_dates, e.venue AS event_venue
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
            ${clause}
           ORDER BY r.created_at DESC
           LIMIT ${cap}`,
    params
  };
}

/* ------------------------------------------------------------------ stats */

export const statsTotals = () => ({
  sql: `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END) AS checked_in,
          SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS today,
          COUNT(DISTINCT event_id) AS events,
          COUNT(DISTINCT category) AS categories
        FROM registrations`,
  params: []
});

export const statsByEvent = () => ({
  sql: `SELECT e.id, e.name, e.dates, e.venue,
               COUNT(r.id) AS registrations,
               SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) AS checked_in
          FROM events e
          LEFT JOIN registrations r ON r.event_id = e.id
         GROUP BY e.id, e.name, e.dates, e.venue
         ORDER BY registrations DESC, e.name ASC`,
  params: []
});

export const statsByCategory = () => ({
  sql: 'SELECT category, COUNT(*) AS n FROM registrations GROUP BY category ORDER BY n DESC',
  params: []
});

export const statsRecent = (limit = 8) => ({
  sql: `SELECT id, name, event_id, category, created_at
          FROM registrations ORDER BY created_at DESC LIMIT ${clampInt(limit, 1, 50, 8)}`,
  params: []
});

/* ------------------------------------------------------------------ sync queue */

export const insertSyncJob = ({ regId, target, error, nextTryAt, at }) => ({
  sql: `INSERT INTO sync_queue (reg_id, target, last_error, attempts, next_try_at, created_at)
        VALUES (?,?,?,?,?,?)`,
  params: [String(regId), String(target), error == null ? null : String(error).slice(0, 500), 1, nextTryAt, at]
});

/**
 * Due jobs. `at` is bound rather than compared against the engine's clock, so
 * the retry schedule behaves identically on MySQL and SQLite.
 */
export const queuePending = (at, limit = 25) => ({
  sql: `SELECT * FROM sync_queue
         WHERE done = 0 AND attempts < 6 AND next_try_at <= ?
         ORDER BY id ASC LIMIT ${clampInt(limit, 1, 200, 25)}`,
  params: [at]
});

export const queueBump = (id, error, nextTryAt) => ({
  sql: `UPDATE sync_queue
           SET attempts = attempts + 1, last_error = ?, next_try_at = ?
         WHERE id = ?`,
  params: [error == null ? null : String(error).slice(0, 500), nextTryAt, Number(id)]
});

export const queueMarkDone = (id) => ({
  sql: 'UPDATE sync_queue SET done = 1, last_error = NULL WHERE id = ?',
  params: [Number(id)]
});

export const queueAbandon = (id, reason) => ({
  sql: 'UPDATE sync_queue SET done = 1, last_error = ? WHERE id = ?',
  params: [String(reason).slice(0, 500), Number(id)]
});

export const queueStats = () => ({
  sql: `SELECT
          SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN done = 0 AND attempts >= 6 THEN 1 ELSE 0 END) AS failed
        FROM sync_queue`,
  params: []
});

/** Failed admin sign-ins from one IP hash inside the lockout window. */
export function countFailedLogins(actorHash, since) {
  return {
    sql: `SELECT COUNT(*) AS n FROM audit_log
           WHERE action = 'login_failed' AND actor = ? AND at >= ?`,
    params: [actorHash, since]
  };
}
