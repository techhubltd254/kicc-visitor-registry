/**
 * build.mjs — the one command that keeps everything in sync.
 *
 *   node scripts/build.mjs
 *
 * Reads config/event.config.json (the single source of truth) and:
 *   1. writes worker/src/config.json          (imported by the Worker)
 *   2. writes public/assets/config.js         (window.KICC_CONFIG for the browser)
 *   3. writes worker/migrations/0002_seed_events.sql
 *   4. generates public/assets/qr-register.{svg,png} for the site URL
 *   5. copies the vendored QR libraries into public/assets/vendor/
 *   6. writes public/poster-print.html — a fully self-contained poster
 *   7. validates the config and fails loudly on anything missing
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { renderPoster } from './poster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'event.config.json');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(PUBLIC, 'assets');
const VENDOR = path.join(ASSETS, 'vendor');

const log = (...a) => console.log('[build]', ...a);
const fail = (msg) => {
  console.error('\n[build] FAILED:', msg, '\n');
  process.exit(1);
};

/* ------------------------------------------------------------------ 1. load + validate */

if (!fs.existsSync(CONFIG_PATH)) fail(`Missing ${CONFIG_PATH}`);
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const required = [
  ['site.name', cfg.site?.name],
  ['site.organisation', cfg.site?.organisation],
  ['site.url', cfg.site?.url],
  ['brand.navy', cfg.brand?.navy],
  ['brand.red', cfg.brand?.red],
  ['brand.gold', cfg.brand?.gold]
];
for (const [k, v] of required) if (!v) fail(`config is missing ${k}`);
if (!Array.isArray(cfg.events) || !cfg.events.length) fail('config.events must contain at least one event');

const ids = new Set();
for (const e of cfg.events) {
  if (!e.id || !e.name) fail(`event "${e.name || '?'}" needs both id and name`);
  if (ids.has(e.id)) fail(`duplicate event id: ${e.id}`);
  ids.add(e.id);
}

fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(VENDOR, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'worker', 'src'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'worker', 'migrations'), { recursive: true });

/* ------------------------------------------------------------------ 2. worker/src/config.json */

fs.writeFileSync(
  path.join(ROOT, 'worker', 'src', 'config.json'),
  JSON.stringify(cfg, null, 2) + '\n'
);
log('wrote worker/src/config.json');

/* ------------------------------------------------------------------ 3. public/assets/config.js */

const browserCfg = {
  site: cfg.site,
  brand: cfg.brand,
  hero: cfg.hero,
  features: cfg.features,
  registration: cfg.registration,
  checkin: cfg.checkin,
  integrations: {
    googleSheets: { enabled: cfg.integrations.googleSheets.enabled },
    tidc: { enabled: cfg.integrations.tidc.enabled, verified: cfg.integrations.tidc.verified }
  }
};

fs.writeFileSync(
  path.join(ASSETS, 'config.js'),
  '/* AUTO-GENERATED from config/event.config.json — do not edit by hand. */\n' +
    '/* Run `npm run build` after changing the config. */\n' +
    'window.KICC_CONFIG = ' +
    JSON.stringify(browserCfg, null, 2) +
    ';\n'
);
log('wrote public/assets/config.js');

/* ------------------------------------------------------------------ 4. seed migration */

const sqlStr = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const seedRows = cfg.events
  .map(
    (e, i) =>
      `(${sqlStr(e.id)}, ${sqlStr(e.name)}, ${sqlStr(e.dates)}, ${sqlStr(e.startDate)}, ${sqlStr(e.endDate)}, ` +
      `${sqlStr(e.venue)}, ${sqlStr(e.description)}, ${e.active === false ? 0 : 1}, ${Number(e.sortOrder ?? i + 1)})`
  )
  .join(',\n  ');

fs.writeFileSync(
  path.join(ROOT, 'worker', 'migrations', '0002_seed_events.sql'),
  `-- AUTO-GENERATED from config/event.config.json — re-run \`npm run build\` after editing it.\n` +
    `-- Upsert, so re-applying this migration never wipes registrations.\n\n` +
    `INSERT INTO events (id, name, dates, start_date, end_date, venue, description, active, sort_order)\nVALUES\n  ${seedRows}\n` +
    `ON CONFLICT(id) DO UPDATE SET\n` +
    `  name=excluded.name, dates=excluded.dates, start_date=excluded.start_date,\n` +
    `  end_date=excluded.end_date, venue=excluded.venue, description=excluded.description,\n` +
    `  sort_order=excluded.sort_order, updated_at=datetime('now');\n`
);
log(`wrote worker/migrations/0002_seed_events.sql (${cfg.events.length} events)`);

// MySQL / TiDB variant. Upsert syntax differs from SQLite, so the seed is
// emitted twice from the same config and neither file is hand-maintained.
fs.mkdirSync(path.join(ROOT, 'worker', 'migrations', 'mysql'), { recursive: true });
const mysqlSeedRows = cfg.events
  .map(
    (e, i) =>
      `(${sqlStr(e.id)}, ${sqlStr(e.name)}, ${sqlStr(e.dates)}, ${sqlStr(e.startDate)}, ${sqlStr(e.endDate)}, ` +
      `${sqlStr(e.venue)}, ${sqlStr(e.description)}, ${e.active === false ? 0 : 1}, ${Number(e.sortOrder ?? i + 1)})`
  )
  .join(',\n  ');

fs.writeFileSync(
  path.join(ROOT, 'worker', 'migrations', 'mysql', '0002_seed_events.sql'),
  `-- AUTO-GENERATED from config/event.config.json — re-run \`npm run build\` after editing it.\n` +
    `-- Upsert, so re-applying never wipes registrations.\n\n` +
    `INSERT INTO events (id, name, dates, start_date, end_date, venue, description, active, sort_order)\nVALUES\n  ${mysqlSeedRows}\n` +
    `ON DUPLICATE KEY UPDATE\n` +
    `  name = VALUES(name),\n` +
    `  dates = VALUES(dates),\n` +
    `  start_date = VALUES(start_date),\n` +
    `  end_date = VALUES(end_date),\n` +
    `  venue = VALUES(venue),\n` +
    `  description = VALUES(description),\n` +
    `  sort_order = VALUES(sort_order);\n`
);
log(`wrote worker/migrations/mysql/0002_seed_events.sql (${cfg.events.length} events)`);

/* ------------------------------------------------------------------ 5. vendored QR libraries */

function copyVendor(candidates, target) {
  for (const rel of candidates) {
    const src = path.join(ROOT, 'node_modules', rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(VENDOR, target));
      log(`vendored ${rel} -> public/assets/vendor/${target}`);
      return true;
    }
  }
  return false;
}

const haveQrGen = copyVendor(
  [
    'qrcode-generator/qrcode.js',
    'qrcode-generator/dist/qrcode.js',
    'qrcode-generator/js/qrcode.js'
  ],
  'qrcode.js'
);
const haveJsQr = copyVendor(['jsqr/dist/jsQR.js', 'jsqr/jsQR.js', 'jsqr/dist/jsqr.js'], 'jsQR.js');

if (!haveQrGen || !haveJsQr) {
  log('WARNING: a vendored QR library is missing. Run `npm install` first.');
}

/* ------------------------------------------------------------------ 6. QR codes */

async function makeQr() {
  if (!haveQrGen) {
    log('skipping QR generation (qrcode-generator not vendored)');
    return null;
  }
  // qrcode-generator ships a UMD bundle; load it in a sandboxed context so it
  // works the same whether Node treats it as ESM or CJS.
  const src = fs.readFileSync(path.join(VENDOR, 'qrcode.js'), 'utf8');
  const ctx = { module: { exports: {} }, exports: {}, window: {}, self: {}, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'qrcode.js' });

  const candidate =
    (typeof ctx.module.exports === 'function' && ctx.module.exports) ||
    (ctx.module.exports && typeof ctx.module.exports.qrcode === 'function' && ctx.module.exports.qrcode) ||
    (typeof ctx.window.qrcode === 'function' && ctx.window.qrcode);
  if (!candidate) fail('could not load qrcode-generator from public/assets/vendor/qrcode.js');
  const qrcode = candidate;

  const qr = qrcode(0, 'M');
  qr.addData(cfg.site.url);
  qr.make();

  const svg = qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
  fs.writeFileSync(path.join(ASSETS, 'qr-register.svg'), svg);
  log(`wrote public/assets/qr-register.svg for ${cfg.site.url}`);

  // Also emit the raw module matrix as a PPM so scripts/decode-qr.py can
  // rasterise and decode it with an INDEPENDENT reader (OpenCV).
  try {
    const n = qr.getModuleCount();
    const scale = 8;
    const quiet = 4;
    const size = (n + quiet * 2) * scale;
    const px = Buffer.alloc(size * size * 3, 255);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = (c + quiet) * scale + dx;
            const y = (r + quiet) * scale + dy;
            const i = (y * size + x) * 3;
            px[i] = 0;
            px[i + 1] = 0;
            px[i + 2] = 0;
          }
        }
      }
    }
    const buildDir = path.join(ROOT, '.build');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(
      path.join(buildDir, 'qr-check.ppm'),
      Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), px])
    );
    log(`wrote .build/qr-check.ppm (${n}x${n} modules) for independent decoding`);
  } catch (e) {
    log(`WARNING: could not emit QR matrix for verification: ${e.message}`);
  }

  return svg;
}

const qrSvg = await makeQr();

/* ------------------------------------------------------------------ 7. self-contained poster */

if (qrSvg) {
  fs.writeFileSync(path.join(PUBLIC, 'poster-print.html'), renderPoster({ cfg, qrSvg }));
  log('wrote public/poster-print.html (self-contained, layout in scripts/poster.mjs)');
}

/* ------------------------------------------------------------------ 8. summary */

log('done.');
console.log(`
  Site URL      : ${cfg.site.url}
  Events        : ${cfg.events.length}
  Duplicate block: ${cfg.features.duplicateEmailBlock ? 'on' : 'off'}
  Email         : ${cfg.features.emailConfirmation ? 'on' : 'off'}
  Sheets sync   : ${cfg.features.googleSheetsSync ? 'on' : 'off'}
  QR badges     : ${cfg.features.qrBadge ? 'on' : 'off'}
  TIDC sync     : ${cfg.features.tidcSync ? 'ON (provider unverified!)' : 'off'}
`);
