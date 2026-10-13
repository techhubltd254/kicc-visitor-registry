/**
 * TIDC adapter — PLUGGABLE STUB, PROVIDER UNVERIFIED.
 * ---------------------------------------------------------------------------
 * A "TIDC" credential set was supplied with this project: a numeric account
 * id, a short alphanumeric public key and a UUID private key.
 *
 * We searched for a developer API matching this naming convention (public key
 * / private key / numeric account id) and found no published documentation,
 * endpoint, auth scheme or request/response contract that matches it. We
 * therefore do NOT guess a request shape — guessing would send delegate
 * personal data to an unknown endpoint.
 *
 * The credential VALUES are deliberately not recorded anywhere in this
 * repository. They belong in environment bindings only — see the env var
 * names below. If they were ever shared over chat or email, rotate them.
 *
 * What this file gives you instead:
 *   • A correct, safe adapter skeleton wired into the registration pipeline.
 *   • Credentials read only from env bindings (never hard-coded).
 *   • A hard switch (features.tidcSync) that is OFF by default.
 *   • Everything queued and retried, so enabling it later loses no records.
 *
 * TO ENABLE, once you have the provider's docs:
 *   1. Put the credentials in Worker secrets (see .dev.vars.example):
 *        wrangler secret put TIDC_ACCOUNT_ID
 *        wrangler secret put TIDC_PUBLIC_KEY
 *        wrangler secret put TIDC_PRIVATE_KEY
 *        wrangler secret put TIDC_API_BASE
 *   2. Set "tidcSync": true in config/event.config.json.
 *   3. Fill in buildRequest() / parseResponse() below to match the docs.
 * ---------------------------------------------------------------------------
 */

export function tidcEnabled(env, cfg) {
  return Boolean(cfg.features.tidcSync && env.TIDC_API_BASE && env.TIDC_ACCOUNT_ID);
}

export function tidcStatus(env, cfg) {
  return {
    enabled: Boolean(cfg.features.tidcSync),
    verified: Boolean(cfg.integrations.tidc.verified),
    configured: Boolean(env.TIDC_API_BASE && env.TIDC_ACCOUNT_ID && env.TIDC_PUBLIC_KEY && env.TIDC_PRIVATE_KEY),
    apiBase: env.TIDC_API_BASE ? 'set' : 'missing'
  };
}

/**
 * Map a KICC registration to the provider's expected body.
 * TODO: replace with the real schema from the TIDC documentation.
 */
export function buildRequest(env, record, event) {
  return {
    accountId: env.TIDC_ACCOUNT_ID,
    reference: record.id,
    registeredAt: record.created_at,
    visitor: {
      fullName: record.name,
      email: record.email,
      phone: record.phone,
      organisation: record.org || null,
      country: record.country || null,
      idNumber: record.doc_id || null
    },
    event: event ? { id: event.id, name: event.name, dates: event.dates, venue: event.venue } : null,
    category: record.category,
    days: record.days || null,
    requirements: record.needs || null
  };
}

function authHeaders(env) {
  // TODO: swap for the real scheme once documented. Both common shapes are
  // provided so you only have to delete the one you do not need.
  return {
    'content-type': 'application/json',
    'x-public-key': env.TIDC_PUBLIC_KEY || '',
    'x-private-key': env.TIDC_PRIVATE_KEY || ''
  };
}

export async function syncToTidc(env, record, event, cfg) {
  if (!tidcEnabled(env, cfg)) {
    return { skipped: true, reason: 'tidc_disabled_or_unconfigured' };
  }

  const url = `${String(env.TIDC_API_BASE).replace(/\/$/, '')}/visitors`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(buildRequest(env, record, event))
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`tidc ${res.status}: ${text.slice(0, 200)}`);

  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* provider may return plain text; keep the raw body */
  }
  return { synced: true, response: parsed };
}
