#!/usr/bin/env bash
# Wire the Google Sheets webhook into the Cloudflare Worker.
# Usage: ./scripts/sheets-go-live.sh 'https://script.google.com/macros/s/XXXX/exec'
set -euo pipefail
EXEC_URL="${1:-}"
[ -z "$EXEC_URL" ] && { echo "usage: $0 '<the /exec URL from the Apps Script deployment>'"; exit 1; }
case "$EXEC_URL" in
  *"/exec") : ;;
  *) echo "That does not look like a /exec URL. Do not use /dev."; exit 1 ;;
esac
SECRET_FILE=".build/sheets-secret.txt"
[ -f "$SECRET_FILE" ] || { echo "missing $SECRET_FILE"; exit 1; }
SECRET="$(tr -d '\n' < "$SECRET_FILE")"

echo "1/4  setting SHEETS_WEBHOOK_URL"
printf '%s\n' "$EXEC_URL" | npx --yes wrangler@4 secret put SHEETS_WEBHOOK_URL --config worker/wrangler.toml

echo "2/4  setting SHEETS_SHARED_SECRET"
printf '%s\n' "$SECRET" | npx --yes wrangler@4 secret put SHEETS_SHARED_SECRET --config worker/wrangler.toml

echo "3/4  direct webhook test (expect ok:true and a row in the sheet)"
curl -sL -X POST "$EXEC_URL" -H 'content-type: application/json' \
  -d "$(printf '{"secret":"%s","sheet":"KICC Registrations","record":{"registeredAt":"2026-10-15 12:00:00","regId":"TEST-DIRECT-001","fullName":"Direct Webhook Test","email":"direct.test@example.com","phone":"+254700000000","organisation":"KICC QA","country":"Kenya","idNumber":"","event":"General KICC Visitor Registration","eventDates":"Open daily","venue":"KICC Main Reception","category":"Delegate","days":"All days","requirements":"","consent":"Yes","checkedIn":"No"}}' "$SECRET")"
echo

echo "4/4  worker health (expect \"sheets\":true)"
sleep 12
curl -s https://kiccvisitorsregistration.co.ke/api/health; echo
