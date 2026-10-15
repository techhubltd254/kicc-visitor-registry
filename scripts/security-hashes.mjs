/**
 * Writes worker/src/security.json — sha256 hashes of every inline <script>
 * block shipped in public/ and docs/. The Worker's CSP allows exactly those
 * hashes, so inline scripts work without 'unsafe-inline'.
 * Runs as the last step of `npm run build`; re-run after editing any HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOTS = ['public', 'docs'];
const hashes = new Set();
const sources = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    if (!/\.html?$/i.test(name)) continue;
    const file = path.join(root, name);
    const html = fs.readFileSync(file, 'utf8');
    let n = 0;
    for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const code = m[1];
      if (!code.trim()) continue;
      hashes.add(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`);
      n += 1;
    }
    if (n) sources.push(`${file} (${n})`);
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  note: 'sha256 hashes of inline <script> blocks — regenerate with `npm run build` after editing HTML',
  sources,
  scripts: [...hashes].sort()
};
fs.writeFileSync(path.join('worker', 'src', 'security.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`  security.json  : ${out.scripts.length} inline script hash(es) from ${sources.length} page(s)`);
