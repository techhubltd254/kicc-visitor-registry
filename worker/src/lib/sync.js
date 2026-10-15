/**
 * Outbound sync orchestration + retry queue.
 *
 * processRegistration() runs inside ctx.waitUntil() so a delegate never waits
 * on email or Google Sheets. Any failure is written to sync_queue and retried
 * by the cron trigger, so no record is ever silently lost.
 *
 * Every statement comes from lib/queries.js, so this module is engine-agnostic.
 */

import { sendConfirmationEmail } from './email.js';
import {
  insertAudit,
  insertSyncJob,
  queuePending,
  queueBump,
  queueMarkDone,
  queueAbandon,
  queueStats as queueStatsQuery,
  setSyncFlag,
  findRegistration
} from './queries.js';
import { sqlDateTime, minutesFromNow, num } from './db.js';

const MAX_ATTEMPTS = 6;

async function attempt(target, fn) {
  try {
    return { target, ok: true, res: await fn() };
  } catch (e) {
    return { target, ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export async function processRegistration(db, env, record, event, cfg) {
  const now = sqlDateTime();
  const jobs = [];

  if (cfg.features.emailConfirmation) {
    jobs.push(attempt('email', () => sendConfirmationEmail(env, record, event, cfg)));
  }
  if (cfg.features.googleSheetsSync) {
    jobs.push(attempt('sheets', () => syncToSheets(env, record, event, cfg)));
  }

  const results = await Promise.all(jobs);
  const summary = {};

  for (const r of results) {
    summary[r.target] = r.ok ? r.res : { failed: true, error: r.error };

    const skipped = r.ok && r.res && r.res.skipped;
    if (r.ok && !skipped) {
      const q = setSyncFlag(record.id, r.target === 'email' ? 'email_sent' : 'sheets_synced', true, now);
      if (q) await db.run(q.sql, q.params);
    } else if (!r.ok) {
      const q = insertSyncJob({
        regId: record.id,
        target: r.target,
        error: r.error,
        nextTryAt: now,
        at: now
      });
      await db.run(q.sql, q.params);
    }
  }

  const audit = insertAudit({
    actor: 'system',
    action: 'sync',
    regId: record.id,
    detail: JSON.stringify(summary).slice(0, 1000),
    at: now
  });
  await db.run(audit.sql, audit.params);

  return summary;
}

/** Cron entry point: retry queued work with exponential backoff. */
export async function drainQueue(db, env, cfg, limit = 25) {
  const pending = queuePending(sqlDateTime(new Date()), limit);
  const rows = await db.all(pending.sql, [sqlDateTime()]);
  if (!rows.length) return { drained: 0, succeeded: 0 };

  let succeeded = 0;

  for (const job of rows) {
    const regQ = findRegistration(job.reg_id);
    const reg = await db.first(regQ.sql, regQ.params);

    if (!reg) {
      const q = queueAbandon(job.id, 'registration no longer exists');
      await db.run(q.sql, q.params);
      continue;
    }

    const eventQ = { sql: 'SELECT * FROM events WHERE id = ? LIMIT 1', params: [reg.event_id] };
    const event = await db.first(eventQ.sql, eventQ.params);

    const r = await attempt(job.target, async () => {
      if (job.target === 'email') return sendConfirmationEmail(env, reg, event, cfg);
      if (job.target === 'sheets') return syncToSheets(env, reg, event, cfg);
      throw new Error(`unknown sync target: ${job.target}`);
    });

    if (r.ok) {
      const flag = setSyncFlag(
        reg.id,
        job.target === 'email' ? 'email_sent' : 'sheets_synced',
        true,
        sqlDateTime()
      );
      if (flag) await db.run(flag.sql, flag.params);
      const done = queueMarkDone(job.id);
      await db.run(done.sql, done.params);
      succeeded++;
    } else {
      const backoff = Math.min(60, Math.pow(2, num(job.attempts) + 1));
      const bump = queueBump(job.id, r.error, minutesFromNow(backoff));
      await db.run(bump.sql, bump.params);
    }
  }

  return { drained: rows.length, succeeded };
}

export async function queueStats(db) {
  const q = queueStatsQuery();
  const row = await db.first(q.sql, q.params);
  return { pending: num(row && row.pending), failed: num(row && row.failed) };
}

export { MAX_ATTEMPTS };
