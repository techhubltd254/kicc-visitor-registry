/**
 * HTTP helpers — JSON envelopes, CORS, CSV, IP hashing.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function ok(data = {}, status = 200) {
  return json({ ok: true, ...data }, status);
}

export function fail(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

/** Allowed origins come from the ALLOWED_ORIGINS env var (comma separated). */
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes('*') || list.includes(origin)) return origin;
  return null;
}

export function preflight(request, env) {
  const origin = allowedOrigin(request, env);
  const h = {
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-admin-token,x-sheets-secret',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
  if (origin) h['access-control-allow-origin'] = origin;
  return new Response(null, { status: 204, headers: h });
}

export function withCors(response, request, env) {
  const origin = allowedOrigin(request, env);
  if (origin) {
    const r = new Response(response.body, response);
    r.headers.set('access-control-allow-origin', origin);
    r.headers.set('vary', 'Origin');
    return r;
  }
  return response;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it correctly. */
export function csvResponse(rows, header, filename) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body =
    '\uFEFF' +
    [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') +
    '\r\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store'
    }
  });
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    '0.0.0.0'
  );
}

export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Payload too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON body');
  }
}
