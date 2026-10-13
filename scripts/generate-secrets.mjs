/**
 * generate-secrets.mjs — prints the three random secrets the Worker needs.
 *
 *   npm run secrets:generate
 *
 * Copy each value into `.dev.vars` for local development, and into
 * `wrangler secret put <NAME>` for production. Never commit them.
 */

import crypto from 'node:crypto';

const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

console.log(`
  ── KICC Worker secrets ──────────────────────────────────────────
  Copy these into .dev.vars (local) and set them in production with
  \`wrangler secret put <NAME>\`.

  SESSION_SECRET=${rand(32)}
  QR_SIGNING_SECRET=${rand(32)}
  IP_SALT=${rand(24)}

  ── Rotate these if they were ever shared in plain text ──────────
  Any secret that has been pasted into a chat, ticket or email should
  be treated as compromised and replaced.

  Generate the admin passcode hash with:
    SESSION_SECRET=<the value above> npm run hash-passcode -- "your-passcode"
`);
