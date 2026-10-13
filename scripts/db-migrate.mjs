#!/usr/bin/env node
/**
 * db-migrate.mjs — apply the MySQL schema (and optionally the event seed) to
 * TiDB Cloud, over the same HTTP driver the Worker uses.
 *
 *   DATABASE_URL="mysql://user:pass@host:4000/kicc_registry?ssl=..." \
 *     node scripts/db-migrate.mjs
 *
 *   node scripts/db-migrate.mjs --seed     # also upsert the events from config
 *   node scripts/db-migrate.mjs --check    # verify connectivity and list tables
 *
 * DATABASE_URL comes from the environment only. It is never written to a file,
 * never logged, and never committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@tidbcloud/serverless';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MYSQL_DIR = path.join(ROOT, 'worker', 'migrations', 'mysql');

const args = process.argv.slice(2);
const wantSeed = args.includes('--seed');
const checkOnly = args.includes('--check');

const url = (process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error(`
  DATABASE_URL is not set.

  Create it in the TiDB Cloud console (your cluster → Connect), then either:

    DATABASE_URL="mysql://<user>.root:<password>@<host>:4000/kicc_registry?ssl={\\"rejectUnauthorized\\":true}" \\
      node scripts/db-migrate.mjs

  or store it as a Worker secret:

    npx wrangler secret put DATABASE_URL --config worker/wrangler.toml
`);
  process.exit(2);
}

// Never print the credentials — only the host and database.
let host = 'unknown';
let database = 'unknown';
try {
  const u = new URL(url);
  host = u.hostname;
  database = u.pathname.replace(/^\//, '') || 'unknown';
} catch {
  /* ignore */
}
console.log(`\n  TiDB target: ${host} / ${database}\n`);

const conn = connect({ url });

/** Split a .sql file into statements. Strips comments, respects quotes. */
function splitStatements(sqlText) {
  const withoutComments = sqlText
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    if (quote) {
      current += ch;
      if (ch === quote && withoutComments[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      const stmt = current.trim();
      if (stmt) out.push(stmt);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}

async function applyFile(file) {
  const full = path.join(MYSQL_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`  skip  ${file} (not present)`);
    return;
  }
  const statements = splitStatements(fs.readFileSync(full, 'utf8'));
  console.log(`  apply ${file} — ${statements.length} statement(s)`);
  for (const stmt of statements) {
    const label = stmt.slice(0, 68).replace(/\s+/g, ' ');
    try {
      await conn.execute(stmt);
      console.log(`        ok   ${label}…`);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      // Re-running a migration must be harmless.
      if (/already exists|Duplicate key name|Duplicate entry/i.test(msg)) {
        console.log(`        skip ${label}… (already applied)`);
      } else {
        console.error(`        FAIL ${label}…\n             ${msg}`);
        throw e;
      }
    }
  }
}

try {
  await conn.execute('SELECT 1 AS ok');
  console.log('  connected.');

  if (checkOnly) {
    const tables = await conn.execute(
      "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
    );
    console.log('\n  tables:');
    for (const t of tables) {
      console.log(`    ${t.table_name ?? t.TABLE_NAME}  (~${t.table_rows ?? t.TABLE_ROWS ?? 0} rows)`);
    }
    const version = await conn.execute('SELECT VERSION() AS v');
    console.log(`\n  engine: ${version[0]?.v ?? 'unknown'}\n`);
    process.exit(0);
  }

  console.log('\n  schema:');
  await applyFile('0001_init.sql');

  if (wantSeed) {
    console.log('\n  seed:');
    await applyFile('0002_seed_events.sql');
  }

  const tables = await conn.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
  );
  const names = tables.map((t) => t.table_name ?? t.TABLE_NAME);
  console.log(`\n  done. tables present: ${names.join(', ')}\n`);

  if (!wantSeed) {
    console.log('  Run again with --seed to load the event calendar from config/event.config.json.\n');
  }
} catch (e) {
  console.error(`\n  migration failed: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
}
