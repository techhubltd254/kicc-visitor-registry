/**
 * Signed QR badges.
 *
 * Token format:  KICC1.<base64url(json payload)>.<base64url(hmac-sha256)>
 *
 * The payload travels inside the QR code, so a door scanner can display the
 * delegate's name, event and category even before it reaches the network.
 * The HMAC is what makes it unforgeable — a delegate cannot invent a badge.
 */

import { toB64urlString, fromB64urlString, hmacSign, hmacVerify } from './crypto.js';

export const BADGE_VERSION = 'KICC1';

export async function makeBadgeToken(record, secret) {
  const payload = {
    v: 1,
    r: record.id,
    n: record.name,
    e: record.event_id,
    c: record.category,
    d: record.days || ''
  };
  const body = toB64urlString(JSON.stringify(payload));
  const sig = await hmacSign(body, secret);
  return `${BADGE_VERSION}.${body}.${sig}`;
}

export async function readBadgeToken(token, secret) {
  const raw = String(token || '').trim().replace(/\s+/g, '');
  const parts = raw.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [version, body, sig] = parts;
  if (version !== BADGE_VERSION) return { valid: false, reason: 'unsupported_version' };
  const good = await hmacVerify(body, sig, secret);
  if (!good) return { valid: false, reason: 'bad_signature' };
  let payload;
  try {
    payload = JSON.parse(fromB64urlString(body));
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }
  return { valid: true, payload, token: raw };
}

/** Accepts either a full signed badge token or a bare KICC-YYMM-XXXX registration id. */
export async function resolveBadge(input, secret) {
  const value = String(input || '').trim();
  if (!value) return { valid: false, reason: 'empty' };
  if (/^KICC-\d{4}-[A-Z0-9]{4}$/i.test(value)) return { valid: true, regId: value.toUpperCase(), via: 'id' };
  const res = await readBadgeToken(value, secret);
  if (!res.valid) return res;
  return { valid: true, regId: res.payload.r, payload: res.payload, token: res.token, via: 'token' };
}
