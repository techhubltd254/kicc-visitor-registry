/**
 * Google Apps Script — KICC registration → Google Sheets
 * =====================================================================
 * Receives POSTs from the Cloudflare Worker (kicc-visitor-registry).
 *
 * SECRET HANDLING — IMPORTANT
 *   This file lives in a PUBLIC GitHub repository, so the shared secret must
 *   NEVER be written into it. It is stored in Script Properties instead
 *   (Project Settings → Script Properties, or run setSharedSecret once).
 *   The Worker sends the same value in the POST body field `secret`.
 *
 * PAYLOAD CONTRACT (keep these 16 fields and their order):
 *   { secret, sheet, record: {
 *       registeredAt, regId, fullName, email, phone, organisation, country,
 *       idNumber, event, eventDates, venue, category, days, requirements,
 *       consent, checkedIn } }
 *
 * DEPLOYMENT
 *   Deploy → New deployment → Web app
 *     Execute as:      Me
 *     Who has access:  Anyone
 *   Then copy the /exec URL into the Worker:
 *     npx wrangler secret put SHEETS_WEBHOOK_URL --config worker/wrangler.toml
 *
 * AFTER ANY EDIT: Deploy → Manage deployments → pencil → Version: New version.
 * That keeps the existing /exec URL. "New deployment" creates a NEW URL and
 * you must re-set SHEETS_WEBHOOK_URL.
 * =====================================================================
 */

var SECRET_PROP = 'SHEETS_SHARED_SECRET';
var SHEET_ID_PROP = 'SHEET_ID';           // only needed for a standalone script
var DEFAULT_SHEET_NAME = 'KICC Registrations';

var HEADERS = [
  'Registered at', 'Reg. number', 'Full name', 'Email', 'Phone',
  'Organisation', 'Country', 'ID / Passport', 'Event', 'Event dates',
  'Venue', 'Category', 'Days', 'Requirements', 'Consent', 'Checked in'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: 'busy' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty body' });
    }

    var body = JSON.parse(e.postData.contents);

    if (!secretMatches(body.secret)) {
      return json({ ok: false, error: 'unauthorised' });
    }
    if (!body.record || !body.record.regId) {
      return json({ ok: false, error: 'no record' });
    }

    var ss = targetSpreadsheet();
    if (!ss) return json({ ok: false, error: 'no spreadsheet bound or configured' });

    var wanted = body.sheet || DEFAULT_SHEET_NAME;
    var sheet = ss.getSheetByName(wanted) || ss.insertSheet(wanted);
    ensureHeaders(sheet);

    var r = body.record;

    // Idempotent: the Worker retries failed pushes from a cron queue, so the
    // same regId can legitimately arrive more than once. Never append twice.
    var existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().map(function (row) { return row[0]; })
      : [];
    if (existing.indexOf(r.regId) > -1) {
      return json({ ok: true, duplicate: true, regId: r.regId });
    }

    sheet.appendRow([
      r.registeredAt || '', r.regId || '', r.fullName || '', r.email || '', r.phone || '',
      r.organisation || '', r.country || '', r.idNumber || '', r.event || '',
      r.eventDates || '', r.venue || '', r.category || '', r.days || '',
      r.requirements || '', r.consent || '', r.checkedIn || ''
    ]);

    return json({ ok: true, appended: r.regId, rows: sheet.getLastRow() - 1 });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Ping so you can confirm the deployment straight from a browser. */
function doGet() {
  return json({
    ok: true,
    service: 'KICC registration -> Google Sheets',
    secretConfigured: sharedSecret() !== '',
    spreadsheet: Boolean(targetSpreadsheet()),
    time: new Date().toISOString()
  });
}

/** Bound to a spreadsheet when created from Extensions → Apps Script;
 *  falls back to the SHEET_ID script property for a standalone script. */
function targetSpreadsheet() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err) { /* standalone */ }
  var id = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROP);
  return id ? SpreadsheetApp.openById(id) : null;
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#0B2536')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(3, 220);
    sheet.setColumnWidth(4, 240);
  }
}

function sharedSecret() {
  return PropertiesService.getScriptProperties().getProperty(SECRET_PROP) || '';
}

/** Length-safe comparison; avoids leaking the position of the first mismatch. */
function secretMatches(candidate) {
  var expected = sharedSecret();
  if (!expected) return false;
  var a = String(candidate || '');
  if (a.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Shows a message. Container-bound scripts get a dialog; a STANDALONE project
 * has no UI, so SpreadsheetApp.getUi() throws and we fall back to Logger.
 */
function tell(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

/**
 * Asks for a value, or returns null. SpreadsheetApp.getUi() throws in a
 * standalone project, so that case is handled rather than crashing.
 */
function promptUser(label) {
  try {
    var ui = SpreadsheetApp.getUi();
    var res = ui.prompt(label, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return null;
    return (res.getResponseText() || '').trim();
  } catch (err) {
    Logger.log('This project has no UI (it is a standalone script).');
    Logger.log('Instead: Project Settings (gear icon) -> Script properties ->');
    Logger.log('  Add script property: SHEETS_SHARED_SECRET = <your secret>');
    Logger.log('  Add script property: SHEET_ID = <spreadsheet id from its URL>');
    return null;
  }
}

/** RUN ONCE. Stores the shared secret (dialog when bound, else use Project Settings). */
function setSharedSecret() {
  var value = promptUser('Paste the SHEETS_SHARED_SECRET from Cloudflare');
  if (value === null) return;
  if (value.length < 32) {
    tell('Too short. Use at least 32 chars (openssl rand -hex 32 gives 64).');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(SECRET_PROP, value);
  tell('Saved. Length ' + value.length + '. Now deploy as a Web app.');
}

/** RUN ONCE if standalone: stores the spreadsheet id. */
function setSpreadsheetId() {
  var value = promptUser('Paste the spreadsheet ID from its URL (/d/<ID>/edit)');
  if (value === null || !value) return;
  PropertiesService.getScriptProperties().setProperty(SHEET_ID_PROP, value);
  tell('Saved. Spreadsheet now opens: ' + Boolean(targetSpreadsheet()));
}

/** Prints configuration state WITHOUT revealing the secret. View → Logs. */
function checkSetup() {
  var s = sharedSecret();
  Logger.log('Secret set : ' + (s ? 'yes, ' + s.length + ' chars' : 'NO — run setSharedSecret'));
  var ss = targetSpreadsheet();
  Logger.log('Spreadsheet: ' + (ss ? ss.getName() : 'NONE — run setSpreadsheetId'));
  if (ss) {
    Logger.log('Tab "' + DEFAULT_SHEET_NAME + '" exists: ' +
      Boolean(ss.getSheetByName(DEFAULT_SHEET_NAME)));
  }
}
