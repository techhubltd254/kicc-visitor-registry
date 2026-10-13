#!/usr/bin/env bash
# =====================================================================
#  deploy.sh — provision secrets, migrate the database, deploy the Worker.
#
#  Every credential is generated here and pushed straight into a Cloudflare
#  secret binding. Nothing is written into the repository, the zip, or any
#  file that ships.
#
#  Usage:  bash scripts/deploy.sh
# =====================================================================
set -euo pipefail

# Both are read from the environment. Nothing account-specific is stored here.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "CLOUDFLARE_ACCOUNT_ID is not set" >&2
  exit 1
fi
export CI=true
export WRANGLER_SEND_METRICS=false

# The token is read from the environment by wrangler; it is never echoed.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set" >&2
  exit 1
fi

CONFIG="worker/wrangler.toml"
LOGDIR=".build"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/deploy.log"

rand() { node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('base64url'))"; }

echo "==> generating fresh signing secrets (never written to disk in the repo)"
SESSION_SECRET="$(rand 32)"
QR_SIGNING_SECRET="$(rand 32)"
IP_SALT="$(rand 24)"

# A strong admin passcode is generated once and handed to the operator
# separately — it is NOT stored in the repo.
ADMIN_PASSCODE="Kicc$(rand 9)"
ADMIN_PASSCODE_HASH="$(SESSION_SECRET="$SESSION_SECRET" node -e '
  const c = require("crypto");
  const p = process.argv[1];
  console.log(c.createHash("sha256").update(p + "::" + process.env.SESSION_SECRET).digest("hex"));
' "$ADMIN_PASSCODE")"

echo "==> pushing secrets to Cloudflare"
printf '%s' "$SESSION_SECRET"     | npx wrangler secret put SESSION_SECRET    --config "$CONFIG" >/dev/null
printf '%s' "$QR_SIGNING_SECRET"  | npx wrangler secret put QR_SIGNING_SECRET --config "$CONFIG" >/dev/null
printf '%s' "$IP_SALT"            | npx wrangler secret put IP_SALT           --config "$CONFIG" >/dev/null
printf '%s' "$ADMIN_PASSCODE_HASH"| npx wrangler secret put ADMIN_PASSCODE_HASH --config "$CONFIG" >/dev/null
echo "    SESSION_SECRET, QR_SIGNING_SECRET, IP_SALT, ADMIN_PASSCODE_HASH — set"

echo "==> applying D1 migrations"
npx wrangler d1 migrations apply kicc-registry --remote --config "$CONFIG" 2>&1 | tee "$LOG.migrate" | tail -20

echo "==> deploying the Worker"
npx wrangler deploy --config "$CONFIG" 2>&1 | tee "$LOG" | tail -30

WORKER_URL="$(grep -Eo 'https://[a-z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)"

# Hand the operator their passcode in a standalone file, outside the repo zip.
printf 'KICC organiser console — https://kiccvisitorsregistration.co.ke/admin.html\n\nPasscode: %s\n\nChange it immediately:\n  SESSION_SECRET="<your session secret>" npm run hash-passcode -- "new-passcode"\n  npx wrangler secret put ADMIN_PASSCODE_HASH --config worker/wrangler.toml\n' "$ADMIN_PASSCODE" > "$LOGDIR/ADMIN-PASSCODE.txt"

echo
echo "================ DEPLOY SUMMARY ================"
echo "Worker URL     : ${WORKER_URL:-see $LOG}"
echo "Custom domain  : https://kiccvisitorsregistration.co.ke (live once nameservers move)"
echo "Passcode file  : $LOGDIR/ADMIN-PASSCODE.txt (uploaded to you separately, NOT in the zip)"
echo "================================================"
