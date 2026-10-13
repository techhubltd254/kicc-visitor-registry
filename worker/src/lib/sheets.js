/**
 * Google Sheets sync.
 *
 * The Worker POSTs each registration as JSON to a Google Apps Script Web App
 * (deployed as "Anyone" access). The script appends a row to the sheet.
 *
 * Setup is in README.md → "Google Sheets backend". Credentials live only in
 * env bindings:
 *
 *   SHEETS_WEBHOOK_URL    the /exec URL of your Apps Script deployment
 *   SHEETS_SHARED_SECRET  any long random string; the Apps Script checks it
 *
 * Nothing here writes to the sheet on the request path — it is called from
 * ctx.waitUntil() so a slow Sheet never delays the delegate's confirmation.
 */

export function sheetsEnabled(env, cfg) {
  return Boolean(cfg.integrations.googleSheets.enabled && env.SHEETS_WEBHOOK_URL);
}

export function sheetsRow(record, event) {
  return {
    registeredAt: record.created_at,
    regId: record.id,
    fullName: record.name,
    email: record.email,
    phone: record.phone,
    organisation: record.org || '',
    country: record.country || '',
    idNumber: record.doc_id || '',
    event: event ? event.name : record.event_id,
    eventDates: event ? event.dates : '',
    venue: event ? event.venue : '',
    category: record.category,
    days: record.days || '',
    requirements: record.needs || '',
    consent: record.consent ? 'Yes' : 'No',
    checkedIn: record.checked_in ? 'Yes' : 'No'
  };
}

export async function syncToSheets(env, record, event, cfg) {
  if (!sheetsEnabled(env, cfg)) return { skipped: true, reason: 'sheets_disabled' };

  const payload = {
    secret: env.SHEETS_SHARED_SECRET || '',
    sheet: cfg.integrations.googleSheets.sheetName,
    record: sheetsRow(record, event)
  };

  const res = await fetch(env.SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!res.ok) throw new Error(`sheets webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { synced: true };
}
