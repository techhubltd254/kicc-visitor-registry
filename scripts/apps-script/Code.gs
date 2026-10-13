/**
 * Google Apps Script — KICC registration → Google Sheets
 * =====================================================================
 * Paste this into a new Apps Script project bound to your spreadsheet
 * (Extensions → Apps Script), then deploy it as a Web App.
 *
 * SETUP
 *   1. Create a Google Sheet. Name the tab "KICC Registrations".
 *   2. Extensions → Apps Script → delete the stub → paste this file.
 *   3. Set SHARED_SECRET below to a long random string.
 *   4. Deploy → New deployment → Web app
 *        Execute as:  Me
 *        Who has access: Anyone
 *      Copy the /exec URL.
 *   5. In the Worker:
 *        wrangler secret put SHEETS_WEBHOOK_URL     # the /exec URL
 *        wrangler secret put SHEETS_SHARED_SECRET   # the same SHARED_SECRET
 *
 * SECURITY
 *   The shared secret is checked on every request. Because the endpoint is
 *   public, treat the secret as the only gate: use a long random value, and
 *   rotate it if it is ever exposed. The script only ever appends rows.
 * =====================================================================
 */

var SHARED_SECRET = 'CHANGE_ME_to_a_long_random_string';
var SHEET_NAME = 'KICC Registrations';

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
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, error: 'empty body' });

    var body = JSON.parse(e.postData.contents);
    if (String(body.secret || '') !== SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorised' });
    }
    if (!body.record) return json({ ok: false, error: 'no record' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(body.sheet || SHEET_NAME) || ss.insertSheet(body.sheet || SHEET_NAME);
    ensureHeaders(sheet);

    var r = body.record;

    // Idempotent: never append the same registration number twice.
    var existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().map(function (row) { return row[0]; })
      : [];
    if (existing.indexOf(r.regId) > -1) {
      return json({ ok: true, duplicate: true, regId: r.regId });
    }

    sheet.appendRow([
      r.registeredAt, r.regId, r.fullName, r.email, r.phone,
      r.organisation, r.country, r.idNumber, r.event, r.eventDates,
      r.venue, r.category, r.days, r.requirements, r.consent, r.checkedIn
    ]);

    return json({ ok: true, appended: r.regId, rows: sheet.getLastRow() - 1 });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Simple ping so you can confirm the deployment from a browser. */
function doGet() {
  return json({ ok: true, service: 'KICC registration → Google Sheets', time: new Date().toISOString() });
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#0B2536').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(3, 220);
    sheet.setColumnWidth(4, 240);
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional: run once to add a checkbox column and a status dropdown to an
 * existing sheet, so desk staff can tick people in from the spreadsheet too.
 */
function addCheckinHelpers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  sheet.getRange(2, 16, last - 1, 1).insertCheckboxes();
}
