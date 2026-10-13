/**
 * test-data-layer.mjs — proves the SQL is genuinely engine-neutral.
 *
 *   npm test            (Node 22, uses the built-in node:sqlite to EXECUTE the SQL)
 *   npm run test:nosqlite   (skips execution, still runs the static checks)
 *
 * Four independent checks:
 *
 *   1. DIALECT SCAN   — no statement may use a SQLite-only construct
 *                       (datetime('now'), strftime, INSERT OR REPLACE, …).
 *   2. MYSQL DDL      — the TiDB schema parses as MySQL, and the SQLite schema
 *                       does NOT, which proves the parser is discriminating.
 *   3. ADAPTER PARITY — the TiDB adapter and the D1 adapter emit byte-identical
 *                       SQL and parameters for the same call.
 *   4. REAL EXECUTION — the schema is created in a real SQLite database and
 *                       every query builder is executed against it, asserting
 *                       actual rows. This is what catches a broken JOIN, a
 *                       LIMIT that is not an integer, or a filter that never
 *                       matches.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Q from '../worker/src/lib/queries.js';
import { TiDBAdapter, D1Adapter, sqlDateTime, hoursAgo } from '../worker/src/lib/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const results = [];
const chk = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  if (!pass) console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
};

/* ================================================================ 1. dialect scan */

const SQLITE_ONLY = [
  [/\bdatetime\s*\(/i, "datetime() — compute the value in JS and bind it"],
  [/\bstrftime\s*\(/i, 'strftime()'],
  [/\bINSERT\s+OR\s+REPLACE\b/i, 'INSERT OR REPLACE — use an explicit upsert'],
  [/\bINSERT\s+OR\s+IGNORE\b/i, 'INSERT OR IGNORE'],
  [/\bAUTOINCREMENT\b/i, 'AUTOINCREMENT — MySQL uses AUTO_INCREMENT'],
  [/\bdate\s*\(\s*'now'\s*\)/i, "date('now') — use CURRENT_DATE"],
  [/\bWITHOUT\s+ROWID\b/i, 'WITHOUT ROWID'],
  [/\bPRAGMA\b/i, 'PRAGMA'],
  [/\bglob\s*\(/i, 'GLOB()']
];

function collectStatements() {
  const out = [];
  const push = (label, q) => {
    if (q && q.sql) out.push({ label, sql: q.sql, params: q.params || [] });
  };

  // every builder that returns a single statement
  const singles = {
    listEvents: () => Q.listEvents(true),
    listEventsAll: () => Q.listEvents(false),
    findEvent: () => Q.findEvent('kicc-visitors-open'),
    insertEvent: () => Q.insertEvent({ id: 'x', name: 'X' }),
    updateEvent: () => Q.updateEvent('x', { name: 'Y', active: true, sortOrder: 2 }),
    deleteEvent: () => Q.deleteEvent('x'),
    deactivateEvent: () => Q.deactivateEvent('x'),
    countRegistrationsForEvent: () => Q.countRegistrationsForEvent('x'),
    findRegistration: () => Q.findRegistration('KICC-2610-AAAA'),
    findRegistrationByEmail: () => Q.findRegistrationByEmail('x', 'a@b.co'),
    idExists: () => Q.idExists('KICC-2610-AAAA'),
    countRegistrationsByIpSince: () => Q.countRegistrationsByIpSince('abc', hoursAgo(1)),
    insertRegistration: () =>
      Q.insertRegistration(
        {
          id: 'KICC-2610-AAAA', event_id: 'x', name: 'A B', email: 'a@b.co', email_norm: 'a@b.co',
          phone: '+254700000000', phone_norm: '254700000000', category: 'Delegate', consent: true
        },
        sqlDateTime()
      ),
    deleteRegistration: () => Q.deleteRegistration('x'),
    markCheckedIn: () => Q.markCheckedIn('x', sqlDateTime(), 'door', 'Main Entrance'),
    setCheckedIn: () => Q.setCheckedIn('x', true, sqlDateTime()),
    setNotes: () => Q.setNotes('x', 'note', sqlDateTime()),
    setCategory: () => Q.setCategory('x', 'Delegate', sqlDateTime()),
    setGate: () => Q.setGate('x', 'Gate', sqlDateTime()),
    setSyncFlag: () => Q.setSyncFlag('x', 'email_sent', true, sqlDateTime()),
    insertAudit: () => Q.insertAudit({ actor: 'admin', action: 'login', at: sqlDateTime() }),
    statsTotals: () => Q.statsTotals(),
    statsByEvent: () => Q.statsByEvent(),
    statsByCategory: () => Q.statsByCategory(),
    statsRecent: () => Q.statsRecent(8),
    insertSyncJob: () => Q.insertSyncJob({ regId: 'x', target: 'email', error: null, nextTryAt: sqlDateTime(), at: sqlDateTime() }),
    queuePending: () => Q.queuePending(25),
    queueBump: () => Q.queueBump(1, 'e', sqlDateTime()),
    queueMarkDone: () => Q.queueMarkDone(1),
    queueAbandon: () => Q.queueAbandon(1, 'gone'),
    queueStats: () => Q.queueStats()
  };

  for (const [label, fn] of Object.entries(singles)) {
    try {
      push(label, fn());
    } catch (e) {
      chk(`builder ${label} runs`, false, e.message);
    }
  }

  const listed = Q.listRegistrations({
    filters: { q: 'am', eventId: 'x', status: 'in', category: 'Delegate' },
    sort: 'name',
    dir: 'asc',
    page: 2,
    pageSize: 25
  });
  push('listRegistrations.count', listed.count);
  push('listRegistrations.rows', listed.rows);
  push('exportRegistrations', Q.exportRegistrations({ filters: { status: 'out' } }));

  return out;
}

const statements = collectStatements();
chk('every query builder produced a statement', statements.length >= 28, `${statements.length} statements`);

const dialectHits = [];
for (const s of statements) {
  for (const [re, why] of SQLITE_ONLY) {
    if (re.test(s.sql)) dialectHits.push(`${s.label}: ${why}`);
  }
}
chk('no SQLite-only construct in any statement', dialectHits.length === 0, dialectHits.join('; '));

// placeholders must all be '?', and no value may be interpolated into the SQL
const interpolation = [];
for (const s of statements) {
  const withoutStrings = s.sql.replace(/'[^']*'/g, "''");
  // a bare % or an @ inside the SQL (outside of quoted literals) suggests a
  // named or printf-style placeholder leaked in from another dialect
  if (/[@:]\w/.test(withoutStrings.replace(/::/g, ''))) {
    interpolation.push(`${s.label}: named placeholder`);
  }
}
chk('all placeholders are positional ?', interpolation.length === 0, interpolation.join('; '));

// the LIKE term must be a bound parameter, never concatenated
const likeConcatenated = statements.filter((s) => /LIKE\s*'/.test(s.sql));
chk('LIKE terms are bound, not concatenated', likeConcatenated.length === 0,
  likeConcatenated.map((s) => s.label).join(', '));

/* ================================================================ 2. MySQL DDL */

let parserOk = false;
let mysqlParseErr = '';
let sqliteParseErr = '';
try {
  // node-sql-parser is CJS; its export shape differs between bundlers and Node,
  // so resolve the constructor defensively instead of assuming a named export.
  const mod = await import('node-sql-parser');
  const Parser =
    (mod && typeof mod.Parser === 'function' && mod.Parser) ||
    (mod && mod.default && typeof mod.default.Parser === 'function' && mod.default.Parser) ||
    (mod && mod.default && typeof mod.default === 'function' && mod.default) ||
    null;
  if (!Parser) throw new Error('Parser export not found in node-sql-parser');
  const parser = new Parser();

  const mysqlSchema = fs.readFileSync(
    path.join(ROOT, 'worker', 'migrations', 'mysql', '0001_init.sql'),
    'utf8'
  );
  try {
    parser.astify(mysqlSchema, { database: 'MySQL' });
    parserOk = true;
  } catch (e) {
    mysqlParseErr = String(e && e.message ? e.message : e).split('\n')[0];
  }
  chk('TiDB/MySQL schema parses as MySQL', parserOk, mysqlParseErr);

  const sqliteSchema = fs.readFileSync(
    path.join(ROOT, 'worker', 'migrations', '0001_init.sql'),
    'utf8'
  );
  try {
    parser.astify(sqliteSchema, { database: 'MySQL' });
    // If the SQLite schema also parsed as MySQL the check would be meaningless,
    // but it does not: AUTOINCREMENT and TEXT PRIMARY KEY without a length fail.
    chk('parser is discriminating (SQLite schema is rejected by MySQL)', false,
      'the SQLite schema unexpectedly parsed as MySQL — the check proves nothing');
  } catch (e) {
    sqliteParseErr = String(e && e.message ? e.message : e).split('\n')[0];
    chk('parser is discriminating (SQLite schema is rejected by MySQL)', true);
  }
} catch (e) {
  chk('node-sql-parser available', false, `run npm install — ${e.message}`);
}

/* ================================================================ 3. adapter parity */

const captured = { tidb: [], d1: [] };
const tidbMock = new TiDBAdapter('mysql://u:p@h:4000/db', () => ({
  execute: async (sql, params) => {
    captured.tidb.push({ sql, params });
    return [];
  }
}));
const d1Mock = new D1Adapter({
  prepare(sql) {
    return {
      bind(...params) {
        return {
          all: async () => {
            captured.d1.push({ sql, params });
            return { results: [] };
          },
          first: async () => {
            captured.d1.push({ sql, params });
            return null;
          },
          run: async () => {
            captured.d1.push({ sql, params });
            return { meta: { changes: 0, last_row_id: 1 }, results: [] };
          }
        };
      }
    };
  }
});

let parityMismatch = null;
for (const s of statements) {
  captured.tidb.length = 0;
  captured.d1.length = 0;

  // route each statement to the method its shape implies
  const isSelect = /^\s*SELECT/i.test(s.sql);
  if (isSelect) {
    await tidbMock.all(s.sql, s.params);
    await d1Mock.all(s.sql, s.params);
  } else {
    await tidbMock.run(s.sql, s.params);
    await d1Mock.run(s.sql, s.params);
  }

  const a = captured.tidb[0];
  const b = captured.d1[0];
  if (!a || !b || a.sql !== b.sql || JSON.stringify(a.params) !== JSON.stringify(b.params)) {
    parityMismatch = s.label;
    break;
  }
}
chk('TiDB and D1 adapters emit identical SQL and params', parityMismatch === null,
  parityMismatch ? `diverged at ${parityMismatch}` : '');

/* ================================================================ 4. real execution */

let executed = 0;
let execSkipped = '';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  try {
    ({ DatabaseSync } = await import('sqlite'));
  } catch {
    DatabaseSync = null;
  }
}

if (!DatabaseSync) {
  execSkipped = 'node:sqlite unavailable — re-run with: npm test  (passes --experimental-sqlite)';
  console.log(`  SKIP  real execution — ${execSkipped}`);
} else {
  const sqliteSchema = fs.readFileSync(
    path.join(ROOT, 'worker', 'migrations', '0001_init.sql'),
    'utf8'
  );
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'event.config.json'), 'utf8'));

  const sq = new DatabaseSync(':memory:');
  sq.exec(sqliteSchema);

  // seed the events straight from the config, exercising insertEvent
  const now = sqlDateTime();
  for (const e of cfg.events) {
    const q = Q.insertEvent(e);
    sq.prepare(q.sql).run(...q.params);
  }

  const evQ = Q.listEvents(true);
  const seeded = sq.prepare(evQ.sql).all();
  chk('events seeded from config', seeded.length === cfg.events.length,
    `${seeded.length} vs ${cfg.events.length}`);

  // ---- register a delegate
  const rec = {
    id: 'KICC-2610-TEST', event_id: cfg.events[0].id, name: 'Amina Otieno',
    email: 'amina@example.co.ke', email_norm: 'amina@example.co.ke',
    phone: '+254712345678', phone_norm: '254712345678', org: 'KICC QA',
    country: 'Kenya', doc_id: '12345678', category: 'Delegate', days: 'All days',
    needs: null, consent: true, badge_token: 'KICC1.abc.def',
    source: 'test', user_agent: 'node', ip_hash: 'deadbeef'
  };
  const ins = Q.insertRegistration(rec, now);
  sq.prepare(ins.sql).run(...ins.params);
  executed++;

  // ---- duplicate email must violate the unique index
  let dupBlocked = false;
  try {
    sq.prepare(ins.sql).run(...ins.params);
  } catch (e) {
    dupBlocked = /unique|constraint/i.test(String(e && e.message ? e.message : e));
  }
  chk('database rejects a duplicate email for the same event', dupBlocked);
  executed++;

  // ---- same email on a DIFFERENT event is allowed
  let crossEventOk = false;
  try {
    const other = { ...rec, id: 'KICC-2610-TST2', event_id: cfg.events[1].id };
    const q = Q.insertRegistration(other, now);
    sq.prepare(q.sql).run(...q.params);
    crossEventOk = true;
  } catch { /* leave false */ }
  chk('the same email may attend a different event', crossEventOk);
  executed++;

  // ---- the friendly duplicate pre-check finds it
  const dupQ = Q.findRegistrationByEmail(cfg.events[0].id, 'amina@example.co.ke');
  const dupRow = sq.prepare(dupQ.sql).get(...dupQ.params);
  chk('duplicate pre-check returns the existing registration', dupRow && dupRow.id === 'KICC-2610-TEST',
    dupRow ? dupRow.id : 'no row');
  executed++;

  // ---- check-in round trip
  const ci = Q.markCheckedIn('KICC-2610-TEST', sqlDateTime(), 'door', 'Main Entrance');
  sq.prepare(ci.sql).run(...ci.params);
  const fr = Q.findRegistration('KICC-2610-TEST');
  const checked = sq.prepare(fr.sql).get(...fr.params);
  chk('check-in persists the flag, time and gate',
    Number(checked.checked_in) === 1 && !!checked.checked_in_at && checked.checked_in_gate === 'Main Entrance',
    JSON.stringify({ checked_in: checked.checked_in, gate: checked.checked_in_gate }));
  executed++;

  // ---- audit trail
  const au = Q.insertAudit({ actor: 'admin', action: 'login', at: now });
  sq.prepare(au.sql).run(...au.params);
  const auditRows = sq.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
  chk('audit log accepts a row', Number(auditRows.n) === 1, String(auditRows.n));
  executed++;

  // ---- sync queue: enqueue, read back, bump, complete
  const sj = Q.insertSyncJob({ regId: 'KICC-2610-TEST', target: 'email', error: 'smtp down', nextTryAt: now, at: now });
  sq.prepare(sj.sql).run(...sj.params);
  const qp = Q.queuePending(25);
  const pending = sq.prepare(qp.sql).all(now);
  chk('a failed sync is queued and readable', pending.length === 1, `${pending.length} pending`);
  executed++;

  const bump = Q.queueBump(pending[0].id, 'still down', sqlDateTime());
  sq.prepare(bump.sql).run(...bump.params);
  const afterBump = sq.prepare('SELECT attempts FROM sync_queue WHERE id = ?').get(pending[0].id);
  chk('a retry increments the attempt count', Number(afterBump.attempts) === 2, String(afterBump.attempts));
  executed++;

  const qsRow = sq.prepare(Q.queueStats().sql).get();
  chk('queue stats count the pending job', Number(qsRow.pending) === 1, JSON.stringify(qsRow));
  executed++;

  const done = Q.queueMarkDone(pending[0].id);
  sq.prepare(done.sql).run(...done.params);
  const qsAfter = sq.prepare(Q.queueStats().sql).get();
  chk('a completed job leaves the pending count', Number(qsAfter.pending || 0) === 0, JSON.stringify(qsAfter));
  executed++;

  // ---- the full admin listing, with every filter at once
  const listed = Q.listRegistrations({
    filters: { q: 'amina', eventId: cfg.events[0].id, status: 'in', category: 'Delegate' },
    sort: 'name', dir: 'asc', page: 1, pageSize: 10
  });
  const countRow = sq.prepare(listed.count.sql).get(...listed.count.params);
  const listRows = sq.prepare(listed.rows.sql).all(...listed.rows.params);
  chk('the filtered registry query matches exactly one delegate',
    Number(countRow.n) === 1 && listRows.length === 1,
    `count=${countRow.n} rows=${listRows.length}`);
  chk('the listing JOINs the event name',
    listRows.length === 1 && listRows[0].event_name === cfg.events[0].name,
    listRows.length ? String(listRows[0].event_name) : 'no row');
  executed += 2;

  // ---- a filter that must match nothing
  const none = Q.listRegistrations({ filters: { q: 'zzzznotfound' }, page: 1, pageSize: 10 });
  const noneRow = sq.prepare(none.count.sql).get(...none.count.params);
  chk('a non-matching filter returns zero', Number(noneRow.n) === 0, String(noneRow.n));
  executed++;

  // ---- CSV export honours the same filters
  const exp = Q.exportRegistrations({ filters: { status: 'in' } });
  const expRows = sq.prepare(exp.sql).all(...exp.params);
  chk('the export query returns the checked-in delegate', expRows.length === 1, `${expRows.length} rows`);
  chk('the export query carries the event columns',
    expRows.length === 1 && !!expRows[0].event_name && !!expRows[0].event_venue,
    expRows.length ? Object.keys(expRows[0]).filter((k) => k.startsWith('event_')).join(',') : '');
  executed += 2;

  // ---- stats
  const t = sq.prepare(Q.statsTotals().sql).get();
  chk('stats totals are computed', Number(t.total) === 2 && Number(t.checked_in) === 1,
    JSON.stringify(t));
  executed++;

  const be = sq.prepare(Q.statsByEvent().sql).all();
  chk('per-event stats group without error', be.length === cfg.events.length, `${be.length} events`);
  executed++;

  const bc = sq.prepare(Q.statsByCategory().sql).all();
  chk('per-category stats group without error', bc.length === 1, `${bc.length} categories`);
  executed++;

  // ---- notes / category / gate updates
  for (const q of [
    Q.setNotes('KICC-2610-TEST', 'vip', sqlDateTime()),
    Q.setCategory('KICC-2610-TEST', 'VIP Guest', sqlDateTime()),
    Q.setGate('KICC-2610-TEST', 'VIP Lounge', sqlDateTime()),
    Q.setSyncFlag('KICC-2610-TEST', 'email_sent', true, sqlDateTime())
  ]) {
    sq.prepare(q.sql).run(...q.params);
    executed++;
  }
  const patched = sq.prepare(fr.sql).get('KICC-2610-TEST');
  chk('PATCH statements all persist',
    patched.notes === 'vip' && patched.category === 'VIP Guest' &&
    patched.checked_in_gate === 'VIP Lounge' && Number(patched.email_sent) === 1,
    JSON.stringify({ notes: patched.notes, cat: patched.category, gate: patched.checked_in_gate, sent: patched.email_sent }));

  // ---- events CRUD
  const insEv = Q.insertEvent({ id: 'tmp-event', name: 'Temp', active: true });
  sq.prepare(insEv.sql).run(...insEv.params);
  const updEv = Q.updateEvent('tmp-event', { name: 'Temp renamed', active: false, sortOrder: 9 });
  sq.prepare(updEv.sql).run(...updEv.params);
  const tmp = sq.prepare('SELECT * FROM events WHERE id = ?').get('tmp-event');
  chk('event insert + update round trip',
    tmp.name === 'Temp renamed' && Number(tmp.active) === 0 && Number(tmp.sort_order) === 9,
    JSON.stringify({ name: tmp.name, active: tmp.active, sort: tmp.sort_order }));
  executed += 3;

  const cnt = sq.prepare(Q.countRegistrationsForEvent(cfg.events[0].id).sql).get(cfg.events[0].id);
  chk('event registration count is right', Number(cnt.n) === 1, String(cnt.n));
  executed++;

  const delEv = Q.deleteEvent('tmp-event');
  sq.prepare(delEv.sql).run(...delEv.params);
  chk('event delete removes the row',
    !sq.prepare('SELECT id FROM events WHERE id = ?').get('tmp-event'));
  executed++;

  // ---- delete a registration
  const del = Q.deleteRegistration('KICC-2610-TST2');
  sq.prepare(del.sql).run(...del.params);
  const left = sq.prepare('SELECT COUNT(*) AS n FROM registrations').get();
  chk('registration delete works', Number(left.n) === 1, String(left.n));
  executed++;

  sq.close();
}

/* ================================================================ report */

const failed = results.filter((r) => !r.pass).length;
console.log('\n  KICC data-layer test\n  ' + '─'.repeat(60));
console.log(`  statements checked : ${statements.length}`);
console.log(`  statements executed: ${executed}`);
if (execSkipped) console.log(`  execution          : SKIPPED (${execSkipped})`);
console.log(`  checks             : ${results.length - failed}/${results.length} passed`);
console.log('  ' + '─'.repeat(60) + '\n');

process.exit(failed ? 1 : 0);
