/**
 * hash-passcode.mjs — turn an organiser passcode into the SHA-256 hash that
 * the Worker stores, so the passcode itself never lives in config or in the
 * repository.
 *
 *   npm run hash-passcode -- "my-new-passcode"
 *   npm run hash-passcode                      (generates a strong one for you)
 *
 * The Worker salts the passcode with SESSION_SECRET before hashing, so the
 * hash only validates against the same Worker's SESSION_SECRET. Set both.
 */

import crypto from 'node:crypto';

const arg = process.argv.slice(2).join(' ').trim();
const passcode = arg || crypto.randomBytes(9).toString('base64url').slice(0, 12);

const sessionSecret = process.env.SESSION_SECRET || '';
const peppered = crypto.createHash('sha256').update(`${passcode}::${sessionSecret}`).digest('hex');

console.log(`
  Passcode      : ${passcode}
  SESSION_SECRET: ${sessionSecret ? '(read from environment)' : '(NOT set — the hash below is unsalted)'}

  ADMIN_PASSCODE_HASH
  ${peppered}

  Next steps:
    wrangler secret put SESSION_SECRET       # paste the same value you hashed with
    wrangler secret put ADMIN_PASSCODE_HASH  # paste the hash above
`);
if (!sessionSecret) {
  console.log('  Tip: set SESSION_SECRET first, e.g.');
  console.log('       SESSION_SECRET=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))") \\');
  console.log('       npm run hash-passcode -- "my-new-passcode"\n');
}
