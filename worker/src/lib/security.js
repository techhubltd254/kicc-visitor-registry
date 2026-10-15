/**
 * Security headers applied to every response the Worker returns — the HTML
 * pages served from the ASSETS binding and the JSON API alike.
 *
 * The Content-Security-Policy is generated at build time by
 * scripts/security-hashes.mjs, which hashes the inline <script> blocks that
 * actually ship in public/ and docs/. Re-run `npm run build` after editing any
 * HTML file, or the hashes go stale and the browser blocks the inline block.
 */
import policy from '../security.json';

const STATIC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin-allow-popups'
};

const SELF_ORIGINS = [
  "'self'",
  'https://kiccvisitorsregistration.co.ke',
  'https://kicc-visitor-registry.techhubltd254.workers.dev'
];

/* Cloudflare appends its analytics beacon at the edge; allow it explicitly so
   the policy does not silently break Web Analytics. */
const BEACON = 'https://static.cloudflareinsights.com';

const NO_INDEX = [
  /^\/admin(\.html)?\/?$/i,
  /^\/checkin(\.html)?\/?$/i,
  /^\/badge(\.html)?\/?$/i,
  /^\/api\/admin(\/|$)/i
];

export function contentSecurityPolicy() {
  const script = [...SELF_ORIGINS, BEACON, ...(policy.scripts || [])].join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    `form-action ${SELF_ORIGINS.join(' ')}`,
    `script-src ${script}`,
    /* inline style="" attributes are used across the pages; style injection is
       far less dangerous than script injection, so 'unsafe-inline' is accepted
       for styles only — scripts are pinned to hashes. */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${SELF_ORIGINS.join(' ')} https://techhubltd254.github.io https://cloudflareinsights.com`,
    "manifest-src 'self'",
    "worker-src 'self'",
    'upgrade-insecure-requests'
  ].join('; ');
}

export function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(STATIC_HEADERS)) headers.set(k, v);
  headers.set('content-security-policy', contentSecurityPolicy());
  try {
    const path = new URL(request.url).pathname;
    if (NO_INDEX.some((re) => re.test(path))) {
      headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
    }
  } catch {
    /* request URLs always parse; nothing to do */
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
