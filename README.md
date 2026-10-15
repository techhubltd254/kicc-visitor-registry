# KICC Visitor Registration

Registration, QR badges and door check-in for **The Kenyatta International
Convention Centre (KICC)** — *Africa's Premier Meeting Venue*.

Live site: **https://kiccvisitorsregistration.co.ke**

---

## ⚠️ Read this first — rotate your credentials

The Cloudflare API token, the R2 access key / secret, and the TIDC keys that
were shared over chat must all be treated as **compromised**. They were sent in
plain text and cannot be un-sent. Before you go live:

1. **Cloudflare API token** — revoke it and create a new one with only the
   scopes you need (`Workers Scripts: Edit`, `D1: Edit`, `R2: Edit`,
   `Zone: Read`, `DNS: Edit`). Dashboard → My Profile → API Tokens.
2. **R2 access key / secret** — rotate under R2 → Manage API Tokens.
3. **TIDC keys** — regenerate them with the provider once you have confirmed
   what TIDC actually is (see *TIDC* below).
4. **Admin passcode** — never keep the one you typed in a chat. Generate a new
   one with `npm run hash-passcode -- "new-passcode"`.
5. **Worker secrets** — the three signing secrets below should be freshly
   generated with `npm run secrets:generate` and never reused from anywhere.

**No secret is stored in this repository.** Every credential is read from a
Cloudflare environment binding at runtime. `npm run verify` fails the build if a
secret-looking string ever appears in a shipped file — run it before every
deploy.

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
   Delegate phone   │  Cloudflare Worker  (kicc-visitor-registry) │
   ───────────────► │                                             │
        QR code     │  /              → static assets (public/)    │
                    │  /api/register  → validate, dedupe, store   │
   Door scanner ───►│  /api/checkin   → verify badge, mark arrival │
                    │  /api/admin/*   → registry, CSV, events      │
   Organiser ──────►│                                             │
                    └───────┬──────────────┬──────────────┬───────┘
                            │              │              │
                      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐
                      │ D1        │  │ R2        │  │ waitUntil()│
                      │ registry  │  │ exports   │  │ email ·    │
                      │ + audit   │  │ + badges  │  │ Sheets ·   │
                      └───────────┘  └───────────┘  │ TIDC       │
                                                     └─────┬──────┘
                                        cron */10 ─────────┘
                                        retries the sync queue
```

**Why it scales.** Cloudflare Workers run at the edge with no servers to size,
D1 is a managed SQLite database, and every outbound integration (email, Sheets,
TIDC) runs *after* the response inside `ctx.waitUntil()` and is retried by a
cron trigger. A slow Google Sheet or a dead mail API never delays a delegate at
the desk, and no registration is ever lost — failures land in `sync_queue` and
are retried with exponential backoff.

---

## What's built

| Feature | Where | Notes |
|---|---|---|
| Visitor registration form | `public/index.html` + `register.js` | Server-validated, mobile-first |
| **Duplicate-email blocking** | `worker/src/index.js` + D1 unique index | Friendly 409 with the existing registration number, enforced by the database as a backstop |
| **Automatic confirmation email** | `worker/src/lib/email.js` + `templates/confirmation.js` | Resend, MailChannels or your own webhook; branded HTML + plain text, sent in the background |
| **Per-delegate QR badge** | `worker/src/lib/badge.js` + `public/badge.html` | HMAC-signed token; a badge cannot be forged |
| **Door check-in** | `public/checkin.html` + `checkin.js` | Camera scanning (vendored jsQR) with manual fallback, per-gate logging, vibrate feedback |
| Organiser console | `public/admin.html` + `admin.js` | KPIs, search, filters, pagination, check-in/undo, delete |
| **CSV export** | `/api/admin/export.csv` | UTF-8 BOM + ISO dates, opens cleanly in Excel |
| Event manager | `/api/admin/events` | Add and edit events from the console; DB is the source of truth |
| Runtime event branding | `config/event.config.json` | One file drives colours, copy, categories, countries and events |
| Privacy notice | `public/privacy.html` | Kenya Data Protection Act, 2019 |
| Printable poster | `public/poster-print.html` | Self-contained A4 poster with a live QR code |
| Retry queue + audit log | `worker/src/lib/sync.js` | Cron every 10 minutes, full audit trail |

---

## Repository layout

```
.
├── config/
│   └── event.config.json        ← THE file you edit: brand, copy, features, events
├── public/                      ← static site (no build step, no framework)
│   ├── index.html               registration form
│   ├── badge.html               delegate QR badge
│   ├── checkin.html             door scanner
│   ├── admin.html               organiser console
│   ├── privacy.html             privacy notice
│   ├── poster-print.html        generated printable poster
│   ├── *.js                     one small module per page
│   └── assets/                  base.css, theme.js, logo, favicon, generated config.js + QR
├── worker/
│   ├── wrangler.toml            bindings: D1, R2, assets, cron, vars
│   ├── migrations/              0001 schema, 0002 generated event seed
│   └── src/
│       ├── index.js             router
│       ├── config.json          generated from config/event.config.json
│       ├── lib/                 http, crypto, badge, email, sheets, tidc, sync
│       ├── routes/admin.js      admin API
│       └── templates/           confirmation email
├── scripts/
│   ├── build.mjs                config → worker + browser + QR + poster
│   ├── verify.mjs               secret scan + pre-deploy checks
│   ├── generate-secrets.mjs     random signing secrets
│   ├── hash-passcode.mjs        passcode → SHA-256
└── .dev.vars.example            template for local secrets (never committed)
```

---

## Setup

### 1. Install

```bash
npm install
cp .dev.vars.example .dev.vars
```

### 2. Generate the signing secrets

```bash
npm run secrets:generate
```

Paste the three values into `.dev.vars`. In production, set each one as a real
secret — never in `wrangler.toml`:

```bash
npx wrangler secret put SESSION_SECRET      --config worker/wrangler.toml
npx wrangler secret put QR_SIGNING_SECRET   --config worker/wrangler.toml
npx wrangler secret put IP_SALT             --config worker/wrangler.toml
```

### 3. Create the admin passcode

```bash
SESSION_SECRET="<the value you generated>" npm run hash-passcode -- "your-new-passcode"
```

```bash
npx wrangler secret put ADMIN_PASSCODE_HASH --config worker/wrangler.toml
```

### 4. Database and bucket

Already created for this project:

| Resource | Name | ID |
|---|---|---|
| D1 database | `kicc-registry` | `a9f59135-195f-43df-8863-76dfc51b62c4` |
| R2 bucket | `kicc-badges` | — |
| Zone | `kiccvisitorsregistration.co.ke` | `d64c748728acffee395fa425957e6867` |

To recreate them elsewhere:

```bash
npx wrangler d1 create kicc-registry --config worker/wrangler.toml
npx wrangler r2 bucket create kicc-badges --config worker/wrangler.toml
```

Then put the returned `database_id` into `worker/wrangler.toml`.

### 5. Build, migrate, deploy

```bash
npm run build      # config → worker config, browser config, QR codes, poster
npm run verify     # secret scan + checks; fails the build on a leak
npm run db:init    # apply migrations (schema + event seed)
npm run deploy
```

`npm run deploy` runs build and verify first, so a leak stops the deploy.

### 6. Point the domain at Cloudflare

The domain is registered through **hosting.com** and currently uses their
nameservers:

```
ns1.mysecurecloudhost.com   ns2.mysecurecloudhost.com
ns3.mysecurecloudhost.com   ns4.mysecurecloudhost.com
```

Cloudflare has assigned this zone:

```
elsa.ns.cloudflare.com
fattouche.ns.cloudflare.com
```

**Change the nameservers at the registrar** (hosting.com → Domains → Manage →
Update Nameservers) to the two Cloudflare values above. This is the one step
that cannot be done through the API — it needs the registrar account. After the
change, activation usually completes within a few minutes to a few hours. Then
add a route so the Worker answers on the apex domain:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

and in the Cloudflare dashboard → Workers → `kicc-visitor-registry` → Settings →
Domains & Routes → **Add custom domain** → `kiccvisitorsregistration.co.ke`
(repeat for `www` if you want it).

---

## Connecting the email confirmation

Set the provider in `worker/wrangler.toml` (`EMAIL_PROVIDER`) and supply its key
as a secret.

**Resend** (recommended — simple, generous free tier):

```bash
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
```

Then verify the sending domain in Resend and set `EMAIL_PROVIDER = "resend"`.
`EMAIL_PROVIDER = "none"` silently skips email — useful while testing.

Other options: `mailchannels` (no key), or `webhook` with your own endpoint
(`EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_SECRET`).

To edit the email itself, open `worker/src/templates/confirmation.js`. Branding
comes from the config, so the email restyles when the site does.

---

## TIDC — provider unverified

A TIDC credential set (numeric account id, short public key, UUID private key)
was supplied with this project. **We could not verify it.** A search for a
developer API matching that naming convention found no published documentation,
endpoint, authentication scheme or request/response contract.

Rather than guess a request shape — which would mean posting delegate personal
data to an unknown endpoint — the integration ships as a **safe, disabled
adapter**:

- `worker/src/lib/tidc.js` — credentials read only from env bindings, with a
  `buildRequest()` you fill in once you have the docs.
- `features.tidcSync` is `false` in the config.
- Everything is already queued and retried, so switching it on later loses no
  records.

To enable it, once you know what TIDC is:

```bash
npx wrangler secret put TIDC_ACCOUNT_ID  --config worker/wrangler.toml
npx wrangler secret put TIDC_PUBLIC_KEY  --config worker/wrangler.toml
npx wrangler secret put TIDC_PRIVATE_KEY --config worker/wrangler.toml
npx wrangler secret put TIDC_API_BASE    --config worker/wrangler.toml
```

then set `"tidcSync": true` in `config/event.config.json`, run `npm run build`,
and complete `buildRequest()` / `authHeaders()` in `tidc.js` from the docs.

**If TIDC turns out to be a payment gateway, an eCitizen/ID service or a
ticketing platform, tell me which and I will wire the real contract.**

---

## Editing the site

Almost everything lives in `config/event.config.json`. Edit it, run
`npm run build`, redeploy.

| Key | Controls |
|---|---|
| `site` | Organisation name, tagline, address, support phone/email, public URL |
| `brand` | Every colour on the site, the badge, the email and the poster |
| `hero` | Headline, sub-headline, chips |
| `features` | Toggle duplicate blocking, email, Sheets, QR badges, TIDC, rate limit |
| `registration` | Categories, day options, countries, consent wording, open/closed |
| `email` | Sender name/address, reply-to, subject template |
| `checkin.gates` | The entrance list on the door scanner |
| `events` | The event calendar |

Runtime event management is also in the organiser console — events added there
appear on the form immediately and live in the database.

---

## API reference

Public:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status and which integrations are live |
| GET | `/api/config` | Branding and feature flags for the browser |
| GET | `/api/events` | Active events |
| POST | `/api/register` | Create a registration |
| POST | `/api/checkin` | Door check-in |
| GET | `/api/badge?t=` / `?id=` | Fetch a delegate's badge |

Admin (session token in `x-admin-token`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Passcode → session token |
| GET | `/api/admin/stats` | KPIs, per-event and per-category breakdowns, queue depth |
| GET | `/api/admin/registrations` | Search, filter, sort, paginate |
| GET | `/api/admin/export.csv` | CSV export (honours the same filters) |
| PATCH | `/api/admin/registrations/:id` | Check in, undo, notes, category |
| DELETE | `/api/admin/registrations/:id` | Delete (audited) |
| GET/POST/PATCH/DELETE | `/api/admin/events` | Event management |
| POST | `/api/admin/queue/drain` | Force a retry pass |

---

## Operations

```bash
npm run tail         # live logs
npm run db:count     # registration + check-in totals
npm run db:shell     # recent registrations
npm run verify       # pre-deploy checks
```

**On the event day:** open `/checkin.html` on each scanner phone, pick the gate,
grant camera permission. The organiser console at `/admin.html` shows live
numbers and can export at any time.

---

## Security notes

- Badges are HMAC-signed. A QR code not issued by this system is rejected as a
  possible forgery and the scan is logged.
- IP addresses are stored only as a salted SHA-256 hash, used for rate limiting.
- The admin passcode is checked server-side against a hash; sessions are
  signed and expire after `admin.sessionHours`.
- Duplicate emails are blocked by a database unique index, not just by
  application code.
- The public form is rate-limited per hashed IP (`features.rateLimitPerHour`).
- `npm run verify` scans every shipped file for secret patterns and fails on a
  match.

## Known limits

- R2 is bound for exports and badge PDFs but the current build writes CSV
  straight to the response, so the bucket is provisioned and idle until you
  want archival copies.
- The poster is generated as HTML and captured to PNG separately; there is no
  in-app poster designer.
- Email deliverability depends on your provider and on SPF/DKIM being set for
  `kiccvisitorsregistration.co.ke`.
