/**
 * Admin API — passcode gate, registry listing, export, event management.
 *
 * All SQL comes from lib/queries.js, so this module is engine-agnostic and
 * runs unchanged on TiDB (MySQL) or D1 (SQLite).
 */

import { ok, fail, readJson, csvResponse, clientIp, hashIp } from '../lib/http.js';
import {
  sha256Hex,
  timingSafeEqual,
  hmacSign,
  hmacVerify,
  toB64urlString,
  fromB64urlString
} from '../lib/crypto.js';
import { sqlDateTime, num } from '../lib/db.js';
import { drainQueue, queueStats } from '../lib/sync.js';
import {
  listEvents,
  insertEvent,
  updateEvent,
  deleteEvent,
  deactivateEvent,
  countRegistrationsForEvent,
  findRegistration,
  deleteRegistration,
  setCheckedIn,
  setNotes,
  setCategory,
  setGate,
  insertAudit,
  listRegistrations,
  exportRegistrations,
  statsTotals,
  statsByEvent,
  statsByCategory,
  statsRecent, countFailedLogins } from '../lib/queries.js';

/* ------------------------------------------------------------------ auth */

/** Secret bindings are trimmed: a value set by piping into `wrangler secret put`
 *  can arrive with a trailing newline, which would silently break every
 *  comparison. Trimming makes the check robust to how the secret was set. */
function envSecret(env, name) {
  return String(env[name] === undefined || env[name] === null ? '' : env[name]).trim();
}

async function passcodeMatches(env, passcode) {
  const supplied = String(passcode || '').trim();
  if (!supplied) return false;

  const storedHash = envSecret(env, 'ADMIN_PASSCODE_HASH');
  const sessionSecret = envSecret(env, 'SESSION_SECRET');

  // Preferred: compare hashes, so the passcode itself is never stored.
  if (storedHash) {
    const peppered = await sha256Hex(`${supplied}::${sessionSecret}`);
    if (timingSafeEqual(peppered, storedHash)) return true;
  }

  // Fallback: a plain passcode secret, still encrypted at rest by Cloudflare.
  const plain = envSecret(env, 'ADMIN_PASSCODE');
  if (plain) return timingSafeEqual(supplied, plain);

  return false;
}

async function issueSession(env, hours) {
  const payload = toB64urlString(
    JSON.stringify({ sub: 'admin', iat: Date.now(), exp: Date.now() + hours * 3600 * 1000 })
  );
  const sig = await hmacSign(payload, envSecret(env, 'SESSION_SECRET'));
  return `${payload}.${sig}`;
}

async function verifySession(env, token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!(await hmacVerify(payload, sig, envSecret(env, 'SESSION_SECRET')))) return null;
  try {
    const data = JSON.parse(fromB64urlString(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

async function requireAdmin(request, env) {
  const url = new URL(request.url);
  const header = request.headers.get('x-admin-token') || request.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : header;
  const token = bearer || url.searchParams.get('key') || '';
  return await verifySession(env, token);
}

/* Best-effort in-process lockout counter keyed by IP hash. Cloudflare reuses
   warm isolates, so this trips immediately even if the audit-log read lags. */
const loginFailures = new Map();

/* ------------------------------------------------------------------ routes */

export async function adminRoute(path, request, env, ctx, cfg, db) {
  const url = new URL(request.url);
  const method = request.method;
  const now = () => sqlDateTime();

  /* ---- login / logout / session ---- */
  if (path === '/api/admin/login' && method === 'POST') {
    const body = await readJson(request);
    /* --- brute-force guard: dual layer -------------------------------------
       (1) in-process counter — trips immediately inside a warm isolate;
       (2) audit_log count — survives isolate recycling across colos. */
    const lockoutMinutes = Number((cfg.admin && cfg.admin.lockoutMinutes) || 15);
    const maxFails = Number((cfg.admin && cfg.admin.maxFailedLogins) || 8);
    const ipHash = await hashIp(clientIp(request), envSecret(env, 'IP_SALT') || envSecret(env, 'SESSION_SECRET') || 'kicc');
    const windowStart = Date.now() - lockoutMinutes * 60000;
    const recent = (loginFailures.get(ipHash) || []).filter((t) => t > windowStart);

    let dbFails = 0;
    try {
      const q = countFailedLogins(ipHash, sqlDateTime(new Date(windowStart)));
      const row = await db.first(q.sql, q.params);
      dbFails = num(row && row.n);
    } catch (e) {
      console.error('lockout count failed:', (e && e.message) || e);
    }
    if (recent.length >= maxFails || dbFails >= maxFails) {
      return fail(
        `Too many failed sign-in attempts. Try again in ${lockoutMinutes} minutes.`,
        429,
        { code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: lockoutMinutes * 60 }
      );
    }

    if (!(await passcodeMatches(env, body.passcode))) {
      const a = insertAudit({
        actor: ipHash,
        action: 'login_failed',
        regId: null,
        at: now(),
        detail: JSON.stringify({ ua: (request.headers.get('user-agent') || '').slice(0, 120) }),
        at: now()
      });
      await db.run(a.sql, a.params).catch((e) => console.error('audit insert failed:', (e && e.message) || e));
      loginFailures.set(ipHash, [...recent, Date.now()]);
      return fail('Incorrect passcode.', 401);
    }
    loginFailures.delete(ipHash);
    const token = await issueSession(env, cfg.admin.sessionHours);
    const a = insertAudit({ actor: 'admin', action: 'login', at: now() });
    await db.run(a.sql, a.params).catch((e) => console.error('audit insert failed:', (e && e.message) || e));
    return ok({ token, expiresInHours: cfg.admin.sessionHours });
  }

  if (path === '/api/admin/logout' && method === 'POST') return ok({ loggedOut: true });

  /* ---- everything below requires a session ---- */
  const session = await requireAdmin(request, env);
  if (!session) return fail('Not authorised. Please sign in again.', 401, { code: 'UNAUTHORISED' });

  if (path === '/api/admin/session' && method === 'GET') {
    return ok({ session: { sub: session.sub, expiresAt: new Date(session.exp).toISOString() } });
  }

  /* ---- stats ---- */
  if (path === '/api/admin/stats' && method === 'GET') {
    const tq = statsTotals();
    const totals = await db.first(tq.sql, tq.params);

    const beq = statsByEvent();
    const byEvent = await db.all(beq.sql, beq.params);

    const bcq = statsByCategory();
    const byCategory = await db.all(bcq.sql, bcq.params);

    const rq = statsRecent(8);
    const recent = await db.all(rq.sql, rq.params);

    return ok({
      totals: {
        total: num(totals && totals.total),
        checkedIn: num(totals && totals.checked_in),
        today: num(totals && totals.today),
        events: num(totals && totals.events),
        categories: num(totals && totals.categories)
      },
      byEvent: byEvent.map((r) => ({
        ...r,
        registrations: num(r.registrations),
        checked_in: num(r.checked_in)
      })),
      byCategory: byCategory.map((r) => ({ ...r, n: num(r.n) })),
      recent,
      queue: await queueStats(db),
      integrations: {
        email: env.EMAIL_PROVIDER || 'none',
      }
    });
  }

  /* ---- list registrations ---- */
  if (path === '/api/admin/registrations' && method === 'GET') {
    const built = listRegistrations({
      filters: {
        q: url.searchParams.get('q'),
        eventId: url.searchParams.get('event'),
        status: url.searchParams.get('status'),
        category: url.searchParams.get('category')
      },
      sort: url.searchParams.get('sort'),
      dir: url.searchParams.get('dir'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize') || cfg.admin.pageSize
    });

    const countRow = await db.first(built.count.sql, built.count.params);
    const total = num(countRow && countRow.n);
    const rows = await db.all(built.rows.sql, built.rows.params);

    return ok({
      total,
      page: built.page,
      pageSize: built.pageSize,
      pages: Math.max(1, Math.ceil(total / built.pageSize)),
      registrations: rows
    });
  }

  /* ---- CSV export ---- */
  if (path === '/api/admin/export.csv' && method === 'GET') {
    const q = exportRegistrations({
      filters: {
        q: url.searchParams.get('q'),
        eventId: url.searchParams.get('event'),
        status: url.searchParams.get('status'),
        category: url.searchParams.get('category')
      }
    });
    const rows = await db.all(q.sql, q.params);

    const header = [
      'Reg. number', 'Full name', 'Email', 'Phone', 'Organisation', 'Country', 'ID/Passport',
      'Event', 'Event dates', 'Venue', 'Category', 'Days', 'Requirements', 'Consent',
      'Registered at', 'Checked in', 'Checked in at', 'Gate', 'Checked in by',
      'Email sent'
    ];

    const body = rows.map((r) => [
      r.id, r.name, r.email, r.phone, r.org, r.country, r.doc_id,
      r.event_name || r.event_id, r.event_dates, r.event_venue, r.category, r.days, r.needs,
      num(r.consent) ? 'Yes' : 'No', r.created_at, num(r.checked_in) ? 'Yes' : 'No',
      r.checked_in_at, r.checked_in_gate, r.checked_in_by,
      num(r.email_sent) ? 'Yes' : 'No'
    ]);

    const a = insertAudit({
      actor: 'admin',
      action: 'export_csv',
      detail: JSON.stringify({ rows: body.length }),
      at: now()
    });
    await db.run(a.sql, a.params).catch((e) => console.error('audit insert failed:', (e && e.message) || e));

    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse(body, header, `kicc-registry-${stamp}.csv`);
  }

  /* ---- single registration mutations ---- */
  const regMatch = path.match(/^\/api\/admin\/registrations\/([A-Za-z0-9-]+)$/);
  if (regMatch) {
    const id = regMatch[1];
    const q = findRegistration(id);
    const existing = await db.first(q.sql, q.params);
    if (!existing) return fail('Registration not found', 404);

    if (method === 'PATCH') {
      const body = await readJson(request);
      const at = now();
      const statements = [];

      if (typeof body.checkedIn === 'boolean') {
        statements.push(setCheckedIn(id, body.checkedIn, at));
        if (body.checkedIn && body.gate) statements.push(setGate(id, body.gate, at));
      }
      if (typeof body.notes === 'string') statements.push(setNotes(id, body.notes, at));
      if (typeof body.category === 'string' && cfg.registration.categories.includes(body.category)) {
        statements.push(setCategory(id, body.category, at));
      }

      const valid = statements.filter(Boolean);
      if (!valid.length) return fail('Nothing to update', 400);

      for (const stmt of valid) await db.run(stmt.sql, stmt.params);

      const a = insertAudit({
        actor: 'admin',
        action: 'update',
        regId: id,
        detail: JSON.stringify(body).slice(0, 500),
        at
      });
      await db.run(a.sql, a.params).catch((e) => console.error('audit insert failed:', (e && e.message) || e));

      const freshQ = findRegistration(id);
      const fresh = await db.first(freshQ.sql, freshQ.params);
      return ok({ registration: fresh });
    }

    if (method === 'DELETE') {
      const del = deleteRegistration(id);
      await db.run(del.sql, del.params);
      const a = insertAudit({
        actor: 'admin',
        action: 'delete',
        regId: id,
        detail: JSON.stringify({ name: existing.name, email: existing.email }),
        at: now()
      });
      await db.run(a.sql, a.params).catch((e) => console.error('audit insert failed:', (e && e.message) || e));
      return ok({ deleted: id });
    }
  }

  /* ---- events CRUD ---- */
  if (path === '/api/admin/events') {
    if (method === 'GET') {
      const q = listEvents(false);
      return ok({ events: await db.all(q.sql, q.params) });
    }

    if (method === 'POST') {
      const b = await readJson(request);
      if (!b.id || !b.name) return fail('id and name are required', 422);
      const q = insertEvent(b);
      await db.run(q.sql, q.params);
      return ok({ created: String(b.id) });
    }

    if (method === 'PATCH') {
      const b = await readJson(request);
      if (!b.id) return fail('id is required', 422);
      const q = updateEvent(b.id, b);
      if (!q) return fail('Nothing to update', 400);
      await db.run(q.sql, q.params);
      return ok({ updated: String(b.id) });
    }

    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return fail('id query parameter is required', 422);

      const cq = countRegistrationsForEvent(id);
      const count = await db.first(cq.sql, cq.params);

      if (num(count && count.n) > 0) {
        const dq = deactivateEvent(id);
        await db.run(dq.sql, dq.params);
        return ok({
          deactivated: id,
          reason: 'event has registrations; deactivated instead of deleted'
        });
      }
      const q = deleteEvent(id);
      await db.run(q.sql, q.params);
      return ok({ deleted: id });
    }
  }

  /* ---- queue maintenance ---- */
  if (path === '/api/admin/queue/drain' && method === 'POST') {
    const result = await drainQueue(db, env, cfg, 25);
    return ok({ queue: result, stats: await queueStats(db) });
  }

  return fail('Not found', 404);
}
