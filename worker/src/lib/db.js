/**
 * Data layer — one query surface over two engines.
 * =====================================================================
 *
 *   TiDB  (MySQL protocol over HTTPS)  →  used whenever DATABASE_URL is set
 *   D1    (SQLite)                     →  fallback, so the site keeps running
 *
 * TiDB is reached through the official serverless HTTP driver
 * (@tidbcloud/serverless). A raw mysql2 TCP socket is not available in the
 * Workers runtime, so HTTP is the only supported transport — and the faster
 * one from the edge anyway.
 *
 * DIALECT STRATEGY
 * All SQL lives in lib/queries.js in the neutral subset both engines accept,
 * so one query string runs unchanged on TiDB and on D1. See the rules at the
 * top of that file; scripts/test-data-layer.mjs enforces them.
 */

import { connect } from '@tidbcloud/serverless';

/* ------------------------------------------------------------------ helpers */

/** MySQL DATETIME literal, e.g. 2026-10-12 06:45:00. Both engines accept it. */
export function sqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function hoursAgo(hours) {
  return sqlDateTime(new Date(Date.now() - hours * 3600 * 1000));
}

export function minutesFromNow(minutes) {
  return sqlDateTime(new Date(Date.now() + minutes * 60 * 1000));
}

/** Engines disagree on how they hand back aggregates; normalise to Number. */
export function num(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ TiDB */

export class TiDBAdapter {
  constructor(url, connectFn = connect) {
    this.kind = 'tidb';
    this.dialect = 'mysql';
    this.url = url;
    this._connect = connectFn;
    this._conn = null;
  }

  /** Lazily connect, so a request that never touches the database costs nothing. */
  conn() {
    if (!this._conn) this._conn = this._connect({ url: this.url });
    return this._conn;
  }

  async all(sql, params = []) {
    const res = await this.conn().execute(sql, params);
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.rows)) return res.rows;
    return [];
  }

  async first(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows.length ? rows[0] : null;
  }

  async run(sql, params = []) {
    const res = await this.conn().execute(sql, params);
    if (Array.isArray(res)) return { changes: res.length, lastId: null, rows: res };
    return {
      changes: num(res && res.rowsAffected),
      lastId: res && res.lastInsertId !== undefined ? res.lastInsertId : null,
      rows: (res && res.rows) || []
    };
  }

  async batch(statements) {
    const out = [];
    for (const stmt of statements) {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const params = typeof stmt === 'string' ? [] : stmt.params || [];
      out.push(await this.run(sql, params));
    }
    return out;
  }
}

/* ------------------------------------------------------------------ D1 */

export class D1Adapter {
  constructor(d1) {
    this.kind = 'd1';
    this.dialect = 'sqlite';
    this.db = d1;
  }

  async all(sql, params = []) {
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return results || [];
  }

  async first(sql, params = []) {
    return (await this.db.prepare(sql).bind(...params).first()) || null;
  }

  async run(sql, params = []) {
    const r = await this.db.prepare(sql).bind(...params).run();
    return {
      changes: num(r.meta && r.meta.changes),
      lastId: r.meta && r.meta.last_row_id !== undefined ? r.meta.last_row_id : null,
      rows: r.results || []
    };
  }

  async batch(statements) {
    const out = [];
    for (const stmt of statements) {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const params = typeof stmt === 'string' ? [] : stmt.params || [];
      out.push(await this.run(sql, params));
    }
    return out;
  }
}

/* ------------------------------------------------------------------ factory */

/**
 * Pick the backend for this request.
 *   DATABASE_URL set  → TiDB  (the production database)
 *   DB binding        → D1    (fallback / local development)
 *
 * `deps.connect` exists purely so tests can inject a mock driver.
 */
export function makeDb(env, deps = {}) {
  const url = env && env.DATABASE_URL ? String(env.DATABASE_URL).trim() : '';
  if (url) return new TiDBAdapter(url, deps.connect || connect);
  if (env && env.DB) return new D1Adapter(env.DB);
  throw new Error(
    'No database configured. Set the DATABASE_URL secret (TiDB) or bind D1 as DB.'
  );
}

/** Which backend a request will use, without connecting. Never leaks credentials. */
export function dbStatus(env) {
  const url = env && env.DATABASE_URL ? String(env.DATABASE_URL).trim() : '';
  if (url) {
    let host = 'unknown';
    let database = 'unknown';
    try {
      const u = new URL(url);
      host = u.hostname;
      database = u.pathname.replace(/^\//, '') || 'unknown';
    } catch {
      /* leave as unknown */
    }
    return { backend: 'tidb', driver: 'mysql-http', host, database, configured: true };
  }
  return {
    backend: env && env.DB ? 'd1' : 'none',
    driver: 'sqlite',
    host: null,
    database: 'kicc-registry',
    configured: Boolean(env && env.DB),
    note: env && env.DB
      ? 'Running on the D1 fallback. Set the DATABASE_URL secret to switch to TiDB.'
      : 'No database configured.'
  };
}
