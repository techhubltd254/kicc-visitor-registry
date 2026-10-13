/**
 * KICC Visitor Registration — API router.
 *
 * Storage: TiDB (MySQL over HTTPS) when DATABASE_URL is set, D1 otherwise.
 * Every SQL statement lives in lib/queries.js in the dialect-neutral subset,
 * so the same code runs on either engine.
 *
 *   GET    /api/health
 *   GET    /api/config                     public branding + feature flags
 *   GET    /api/events                     active events
 *   POST   /api/register                   create a registration
 *   POST   /api/checkin                    door check-in (badge token or reg id)
 *   GET    /api/badge                      ?t=<token> | ?id=<regId>
 *   POST   /api/admin/login                passcode -> session token
 *   GET    /api/admin/registrations        search / filter / paginate
 *   GET    /api/admin/stats
 *   GET    /api/admin/export.csv
 *   PATCH  /api/admin/registrations/:id
 *   DELETE /api/admin/registrations/:id
 *   GET/POST/PATCH/DELETE /api/admin/events
 *   POST   /api/admin/queue/drain
 */

import config from './config.json';
import { ok, fail, preflight, withCors, readJson, clientIp, hashIp } from './lib/http.js';
import { newRegistrationId } from './lib/crypto.js';
import { makeDb, dbStatus, sqlDateTime, hoursAgo, num } from './lib/db.js';
import { makeBadgeToken, resolveBadge } from './lib/badge.js';
import { processRegistration, drainQueue } from './lib/sync.js';
import { adminRoute } from './routes/admin.js';
import {
  listEvents as listEventsQuery,
  findEvent,
  findRegistration,
  findRegistrationByEmail,
  idExists,
  countRegistrationsByIpSince,
  insertRegistration,
  insertAudit,
  markCheckedIn
} from './lib/queries.js';

/* ------------------------------------------------------------------ config */

function publicConfig() {
  return {
    site: config.site,
    brand: config.brand,
    hero: config.hero,
    features: config.features,
    registration: config.registration,
    checkin: config.checkin,
    database: config.database,
    integrations: {
      googleSheets: { enabled: config.integrations.googleSheets.enabled }
    }
  };
}

/* ------------------------------------------------------------------ validation */

function validateRegistration(body, cfg, event) {
  const errors = {};
  const clean = {};
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

  clean.name = str(body.name).replace(/\s+/g, ' ');
  clean.email = str(body.email).toLowerCase();
  clean.phone = str(body.phone);
  clean.org = str(body.org).slice(0, 160);
  clean.country = str(body.country).slice(0, 80);
  clean.docId = str(body.docId).slice(0, 60);
  clean.category = str(body.category);
  clean.days = str(body.days) || 'All days';
  clean.needs = str(body.needs).slice(0, 1000);
  clean.consent = Boolean(body.consent);

  if (clean.name.length < 3 || !clean.name.includes(' ')) {
    errors.name = 'Please enter your full name (first and last name).';
  } else if (clean.name.length > 120) {
    errors.name = 'Name is too long.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email) || clean.email.length > 200) {
    errors.email = 'Please enter a valid email address.';
  }

  const digits = clean.phone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) {
    errors.phone = 'Enter a phone number with 9 to 15 digits, including the country code.';
  }

  if (!event) errors.event = 'Please select the event you are attending.';

  if (!cfg.registration.categories.includes(clean.category)) {
    errors.category = 'Please choose a valid registration category.';
  }

  if (cfg.features.requireIdNumber && !clean.docId) {
    errors.docId = 'An ID or passport number is required for this event.';
  }

  if (!clean.consent) errors.consent = 'Consent is required before we can register you.';

  return { errors, clean, valid: Object.keys(errors).length === 0 };
}

/* ------------------------------------------------------------------ register */

async function register(request, env, ctx, db) {
  const cfg = config;
  if (!cfg.registration.open) return fail(cfg.registration.closedMessage, 403);

  const body = await readJson(request);

  const evQ = findEvent(String(body.eventId || body.event || ''));
  const event = await db.first(evQ.sql, evQ.params);

  const { errors, clean, valid } = validateRegistration(body, cfg, event);
  if (!valid) return fail('Please correct the highlighted fields.', 422, { fieldErrors: errors });

  const ipHash = await hashIp(clientIp(request), env.IP_SALT || env.SESSION_SECRET || 'kicc');

  if (cfg.features.rateLimitPerHour) {
    const rl = countRegistrationsByIpSince(ipHash, hoursAgo(1));
    const row = await db.first(rl.sql, rl.params);
    if (num(row && row.n) >= cfg.features.rateLimitPerHour) {
      return fail('Too many registrations from this connection. Please try again later.', 429);
    }
  }

  // ---- duplicate-email blocking: friendly pre-check, with the unique index as backstop
  if (cfg.features.duplicateEmailBlock) {
    const dup = findRegistrationByEmail(event.id, clean.email);
    const existing = await db.first(dup.sql, dup.params);
    if (existing) {
      return fail('This email address is already registered for this event.', 409, {
        code: 'DUPLICATE_EMAIL',
        existingId: existing.id
      });
    }
  }

  // ---- allocate an id, retrying on the (unlikely) collision
  let regId = null;
  for (let i = 0; i < 6 && !regId; i++) {
    const candidate = newRegistrationId(cfg.registration.idPrefix);
    const clashQ = idExists(candidate);
    const clash = await db.first(clashQ.sql, clashQ.params);
    if (!clash) regId = candidate;
  }
  if (!regId) return fail('Could not allocate a registration number. Please retry.', 503);

  const badgeToken = await makeBadgeToken(
    { id: regId, name: clean.name, event_id: event.id, category: clean.category, days: clean.days },
    env.QR_SIGNING_SECRET
  );

  const now = sqlDateTime();
  const record = {
    id: regId,
    event_id: event.id,
    name: clean.name,
    email: clean.email,
    email_norm: clean.email,
    phone: clean.phone,
    phone_norm: clean.phone.replace(/\D/g, ''),
    org: clean.org,
    country: clean.country,
    doc_id: clean.docId,
    category: clean.category,
    days: clean.days,
    needs: clean.needs,
    consent: true,
    badge_token: badgeToken,
    source: String(body.source || 'web').slice(0, 40),
    user_agent: String(request.headers.get('user-agent') || '').slice(0, 250),
    ip_hash: ipHash
  };

  const ins = insertRegistration(record, now);
  try {
    await db.run(ins.sql, ins.params);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    // The unique index on (event_id, email_norm) is the real guard.
    if (/duplicate|unique/i.test(msg)) {
      return fail('This email address is already registered for this event.', 409, {
        code: 'DUPLICATE_EMAIL'
      });
    }
    throw e;
  }

  const fetchQ = findRegistration(regId);
  const stored = await db.first(fetchQ.sql, fetchQ.params);

  const audit = insertAudit({
    actor: 'public',
    action: 'register',
    regId,
    detail: JSON.stringify({ event: event.id, category: clean.category }),
    at: now
  });
  await db.run(audit.sql, audit.params);

  // Never block the delegate's confirmation on email or Sheets.
  ctx.waitUntil(processRegistration(db, env, stored, event, cfg));

  const siteUrl = (env.PUBLIC_SITE_URL || cfg.site.url).replace(/\/$/, '');

  return ok({
    registration: {
      id: stored.id,
      name: stored.name,
      email: stored.email,
      phone: stored.phone,
      category: stored.category,
      days: stored.days,
      createdAt: stored.created_at,
      badgeToken: stored.badge_token
    },
    event: {
      id: event.id,
      name: event.name,
      dates: event.dates,
      venue: event.venue,
      description: event.description
    },
    links: {
      badge: `${siteUrl}/badge.html?t=${encodeURIComponent(badgeToken)}`,
      checkin: `${siteUrl}/checkin.html`
    }
  });
}

/* ------------------------------------------------------------------ check-in */

function present(record, event) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    org: record.org,
    country: record.country,
    category: record.category,
    days: record.days,
    needs: record.needs,
    event: event ? event.name : record.event_id,
    eventDates: event ? event.dates : '',
    venue: event ? event.venue : '',
    checkedIn: Boolean(num(record.checked_in)),
    checkedInAt: record.checked_in_at,
    checkedInGate: record.checked_in_gate,
    registeredAt: record.created_at
  };
}

async function checkin(request, env, db) {
  const body = await readJson(request);
  const resolved = await resolveBadge(body.token || body.regId || body.code, env.QR_SIGNING_SECRET);

  if (!resolved.valid) {
    return fail(
      resolved.reason === 'bad_signature'
        ? 'This badge failed its signature check — it may be a forgery.'
        : 'Unrecognised badge. Scan again or enter the registration number.',
      400,
      { code: resolved.reason }
    );
  }

  const q = findRegistration(resolved.regId);
  const record = await db.first(q.sql, q.params);
  if (!record) {
    return fail('That registration number is not in the register.', 404, { code: 'NOT_FOUND' });
  }

  const evQ = findEvent(record.event_id);
  const event = await db.first(evQ.sql, evQ.params);
  const already = Boolean(num(record.checked_in));

  if (already && !body.force) {
    return ok({
      alreadyCheckedIn: true,
      delegate: present(record, event),
      message: `Already checked in at ${record.checked_in_at}`
    });
  }

  const gate = String(body.gate || 'Main Entrance').slice(0, 60);
  const by = String(body.by || 'door').slice(0, 60);
  const now = sqlDateTime();

  const upd = markCheckedIn(record.id, now, by, gate);
  await db.run(upd.sql, upd.params);

  const audit = insertAudit({
    actor: by,
    action: 'checkin',
    regId: record.id,
    detail: JSON.stringify({ gate }),
    at: now
  });
  await db.run(audit.sql, audit.params);

  const freshQ = findRegistration(record.id);
  const fresh = await db.first(freshQ.sql, freshQ.params);

  return ok({ checkedIn: true, wasAlreadyCheckedIn: already, gate, delegate: present(fresh, event) });
}

/* ------------------------------------------------------------------ badge */

async function badgeLookup(request, env, db) {
  const url = new URL(request.url);
  const resolved = await resolveBadge(
    url.searchParams.get('t') || url.searchParams.get('id'),
    env.QR_SIGNING_SECRET
  );
  if (!resolved.valid) return fail('Invalid badge', 400, { code: resolved.reason });

  const q = findRegistration(resolved.regId);
  const record = await db.first(q.sql, q.params);
  if (!record) return fail('Registration not found', 404);

  const evQ = findEvent(record.event_id);
  const event = await db.first(evQ.sql, evQ.params);

  return ok({ delegate: present(record, event), token: record.badge_token });
}

/* ------------------------------------------------------------------ worker */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return preflight(request, env);
    const respond = (r) => withCors(r, request, env);
    const cfg = config;

    try {
      if (path === '/api/health') {
        return respond(
          ok({
            service: 'kicc-visitor-registry',
            environment: env.ENVIRONMENT || 'development',
            time: new Date().toISOString(),
            database: dbStatus(env),
            emailProvider: env.EMAIL_PROVIDER || 'none',
            sheets: Boolean(cfg.integrations.googleSheets.enabled && env.SHEETS_WEBHOOK_URL)
          })
        );
      }

      if (path === '/api/config') return respond(ok({ config: publicConfig() }));

      const db = makeDb(env);

      if (path === '/api/events' && request.method === 'GET') {
        const q = listEventsQuery(true);
        return respond(ok({ events: await db.all(q.sql, q.params) }));
      }

      if (path === '/api/register' && request.method === 'POST') {
        return respond(await register(request, env, ctx, db));
      }
      if (path === '/api/checkin' && request.method === 'POST') {
        return respond(await checkin(request, env, db));
      }
      if (path === '/api/badge' && request.method === 'GET') {
        return respond(await badgeLookup(request, env, db));
      }

      if (path.startsWith('/api/admin/')) {
        return respond(await adminRoute(path, request, env, ctx, cfg, db));
      }

      // Anything that is not an API route falls through to the static assets.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return respond(fail('Not found', 404));
    } catch (e) {
      console.error('unhandled error', (e && e.stack) || e);
      return respond(fail(`Internal error: ${(e && e.message) || 'unknown'}`, 500));
    }
  },

  /** Cron: drain the outbound sync queue. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const db = makeDb(env);
          const result = await drainQueue(db, env, config);
          console.log('queue drained', JSON.stringify(result));
        } catch (e) {
          console.error('queue drain failed', (e && e.message) || e);
        }
      })()
    );
  }
};
