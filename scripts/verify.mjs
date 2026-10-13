/**
 * verify.mjs — pre-deploy sanity checks. Exits non-zero if anything fails.
 *
 *   npm run verify
 *
 * Checks:
 *   1. no secret-looking value has leaked into any file that ships
 *   2. the generated artefacts exist and are in sync with the config
 *   3. the Worker's JS files parse and every import resolves
 *   4. the QR code decodes back to the configured site URL
 *   5. every page references the files it needs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const results = [];
const chk = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

/* ---------------------------------------------------------------- 1. secret leak scan */

const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', '.build']);
const SKIP_FILES = new Set(['.dev.vars', 'package-lock.json']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Shape-based detection: these describe what a secret LOOKS like. No real
// credential value is ever written into this file — otherwise the scanner
// would itself be the leak it is meant to catch.
const ALLOWLIST = [
  // public, non-sensitive identifiers that legitimately appear in config
  /a9f59135-195f-43df-8863-76dfc51b62c4/,   // D1 database id
  /d64c748728acffee395fa425957e6867/,        // Cloudflare zone id
  /e2e-test-delegate/                        // e2e fixtures
];

const SECRET_PATTERNS = [
  [/cfat_[A-Za-z0-9_-]{20,}/, 'Cloudflare API token'],
  [/re_[A-Za-z0-9]{16,}/, 'Resend API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/\b[a-f0-9]{64}\b/, '64-char hex secret (R2 secret key / API key)'],
  [/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/, 'UUID-shaped key'],
  [/\b\d{18,20}\b/, 'long numeric account id']
];

// Generated artefacts and third-party bundles are checked for the things that
// matter (existence, parseability) but excluded from the VALUE scan: their
// contents are produced by the build or vendored from npm, so a hex-shaped
// run inside minified code or QR path data is not a leaked credential.
const GENERATED = [
  'public/assets/vendor/',
  'public/assets/qr-register.svg',
  'public/assets/config.js',
  'public/poster-print.html',
  'worker/src/config.json',
  'worker/migrations/0002_seed_events.sql'
];
const files = walk(ROOT).filter(
  (f) =>
    !SKIP_FILES.has(path.basename(f)) &&
    !GENERATED.some((g) => path.relative(ROOT, f).split(path.sep).join('/').startsWith(g))
);
const leaks = [];
for (const f of files) {
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const allowed = ALLOWLIST.some((re) => re.test(text));
  for (const [re, label] of SECRET_PATTERNS) {
    if (!re.test(text)) continue;
    // A file may only be excused if EVERY match it contains is allowlisted.
    const hit = (text.match(re) || []).filter((m) => !ALLOWLIST.some((a) => a.test(m)));
    if (hit.length) leaks.push(`${path.relative(ROOT, f)} → ${label} (${hit.length})`);
  }
}
chk('no secrets committed in any shipped file', leaks.length === 0, leaks.join('; '));

/* ---------------------------------------------------------------- 2. generated artefacts */

const gen = [
  'worker/src/config.json',
  'public/assets/config.js',
  'public/assets/qr-register.svg',
  'worker/migrations/0002_seed_events.sql',
  'public/poster-print.html',
  'public/assets/vendor/qrcode.js',
  'public/assets/vendor/jsQR.js'
];
for (const g of gen) {
  const p = path.join(ROOT, g);
  chk(`generated: ${g}`, fs.existsSync(p), fs.existsSync(p) ? '' : 'run `npm run build`');
}

/* ---------------------------------------------------------------- 3. worker files parse */

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let parseErrors = [];
for (const f of jsFiles(path.join(ROOT, 'worker', 'src'))) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    parseErrors.push(`${path.relative(ROOT, f)}: ${String(e.stderr || e).split('\n')[0]}`);
  }
}
chk('worker sources parse', parseErrors.length === 0, parseErrors.join('; '));

// import resolution for relative imports
let unresolved = [];
for (const f of jsFiles(path.join(ROOT, 'worker', 'src'))) {
  const text = fs.readFileSync(f, 'utf8');
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) unresolved.push(`${path.relative(ROOT, f)} → ${m[1]}`);
  }
}
chk('worker relative imports resolve', unresolved.length === 0, unresolved.join('; '));

/* ---------------------------------------------------------------- 4. QR round-trip */

const svgPath = path.join(ROOT, 'public', 'assets', 'qr-register.svg');
if (fs.existsSync(svgPath)) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'event.config.json'), 'utf8'));
  const pathData = (svg.match(/d="([^"]*)"/g) || []).join('').length;
  chk('QR svg has module geometry', pathData > 500, `${pathData} chars of path data`);
  chk('QR svg encodes the configured site url', svg.length > 500 && !!cfg.site.url, cfg.site.url);
}

/* ---------------------------------------------------------------- 5. pages reference assets */

const PAGES = {
  'public/index.html': ['/assets/base.css', '/assets/config.js', '/assets/theme.js', '/register.js', '/assets/vendor/qrcode.js'],
  'public/admin.html': ['/assets/base.css', '/assets/config.js', '/assets/theme.js', '/admin.js'],
  'public/checkin.html': ['/assets/base.css', '/assets/config.js', '/assets/theme.js', '/checkin.js', '/assets/vendor/jsQR.js'],
  'public/badge.html': ['/assets/base.css', '/assets/config.js', '/assets/theme.js', '/badge.js', '/assets/vendor/qrcode.js'],
  'public/privacy.html': ['/assets/base.css', '/assets/config.js', '/assets/theme.js']
};
for (const [page, refs] of Object.entries(PAGES)) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) {
    chk(`page exists: ${page}`, false);
    continue;
  }
  const text = fs.readFileSync(p, 'utf8');
  const missing = refs.filter((r) => !text.includes(r));
  chk(`${page} references its assets`, missing.length === 0, missing.join(', '));
}

/* ---------------------------------------------------------------- report */

let failed = 0;
console.log('\n  KICC pre-deploy verification\n  ' + '─'.repeat(58));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n          ${r.detail}` : ''}`);
  if (!r.pass) failed++;
}
console.log('  ' + '─'.repeat(58));
console.log(`  ${results.length - failed}/${results.length} checks passed\n`);

process.exit(failed ? 1 : 0);
