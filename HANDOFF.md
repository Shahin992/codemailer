# ColdMailer: handoff notes

Last updated: Oct 17, 2026 (instant reply check and phone push diagnostics, timezones, phone layout, 50 MB CSV uploads in parts, slimmer Settings; before that reply notifications, set send times, AWS EC2 guide). Read this first in the next session.

## Contents

1. [Where things stand](#1-where-things-stand)
2. [What the app does](#2-what-the-app-does)
3. [How it's built](#3-how-its-built)
4. [Where everything is](#4-where-everything-is)
5. [Database and migrations](#5-database-and-migrations)
6. [Secrets and settings](#6-secrets-and-settings)
7. [Running it on this laptop](#7-running-it-on-this-laptop)
8. [How work was tested](#8-how-work-was-tested)
9. [Verified vs not yet verified](#9-verified-vs-not-yet-verified)
10. [Known gaps and limits](#10-known-gaps-and-limits)
11. [Next steps](#11-next-steps-in-order)
12. [How to work on it in the next session](#12-how-to-work-on-it-in-the-next-session)

## 1. Where things stand

- **ColdMailer is built and running locally** in Docker at http://localhost:3000: Postgres, the app, the cron runner and Adminer.
- **You (the user) are testing it** with a real Gmail account and a Hostinger business mailbox (`support@edufusionbd.online`).
- **Not deployed yet.**
  - Oracle Cloud sign-up was **refused** ("an error occurred while creating your account") after the card was verified.
  - **AWS EC2** guide written Oct 16: [`docs/Deploy to AWS EC2.md`](docs/Deploy%20to%20AWS%20EC2.md) (t3.micro + Elastic IP). The user's AWS account is on the **Free plan**: $100 credit plus $20 per Explore AWS activity. The setup uses about $15/month of credits. The plan ends after 6 months or when the credits run out; then the account closes unless upgraded to the Paid plan (90-day grace period).
  - Alternative: **Google Cloud's free e2-micro**, [`docs/Deploy to Google Cloud.md`](docs/Deploy%20to%20Google%20Cloud.md).
  - Fallback: a Hostinger VPS (KVM 1, about $5–7/month).
- **Docker build re-checked Oct 16:** images build cleanly (Next.js compile, TypeScript and 15 pages, no warnings); the stack starts; `migrate` reports "Database is up to date"; pages, 401s on API/cron without credentials, and security headers OK; the Caddyfile validates for the real domain. The running stack uses about 200 MB of RAM.
- **Oct 17 changes (not yet in the local Docker images or on a server; `npm run build` passes):**
  - **Phone push:** the user reported desktop Chrome gets reply notifications but the phone PWA gets **none**. Cause not yet known. Added: the app re-registers the device's push subscription every time it opens (`components/push-sync.tsx`), a `pushsubscriptionchange` handler in `sw.js`, and per-device delivery health in Settings → Reply notifications (sent / arrived / refused, from migration `0008`). Next step: open the app on the phone, press "Send test", and read that phone's line.
  - **Instant reply check:** `lib/jobs/inbox-watch.ts` (started by `instrumentation.ts`) keeps an IMAP IDLE connection per active mailbox; new inbox mail is checked within about 3 seconds (verified with the test kit). Cron's 5-minute check stays as the safety net and still covers the spam folder.
  - **Timezones:** a full timezone dropdown (`components/timezone-select.tsx`, list from `lib/timezones.ts`) in Settings and New campaign. The campaign timezone now drives the send window **and** set times ("9:00 in Arizona" = 16:00 UTC); campaign pages and the time editor show times in the campaign's timezone.
  - **Settings:** Background jobs and API sections removed (the API token button is gone; `POST /api/v1/auth/token` still issues tokens).
  - **CSV:** up to 50 MB / 200,000 people. Lists over 5,000 go up in parts (`/api/campaigns/{id}/recipients`) while the campaign is a `draft`. The proxy only buffers 10 MB of a request body, which is why one big request failed.
  - **Phone layout:** no page scrolls sideways at 375 px with very long emails, subjects and links (checked all 13 pages).
- **SMTP EHLO name** is now the mailbox's domain instead of the container id (`lib/mail/connection.ts`, Oct 16). Typecheck passes; not yet rebuilt into the local Docker images (`sudo docker compose up -d --build`).
- **Public address chosen:** `https://coldmailer.edufusionbd.online`. The domain's DNS is at **Cloudflare** (nameservers `lennon`/`laura.ns.cloudflare.com`), not Hostinger: add records there, as **DNS only**. `deploy/server.env` is ready for it. "coldmailer" appears in every email's unsubscribe link; a neutral subdomain would hide that. Decide before sending real campaigns, because the address must not change afterwards.

## 2. What the app does

| Area | Details |
| --- | --- |
| Mailboxes | Hostinger, Gmail (app password) or **any SMTP server**: own server, port, encryption (SSL/STARTTLS/none) and username. Optional IMAP for reading replies; **send-only** mailboxes route replies to another mailbox via `Reply-To`. Fill-in presets for Zoho, Yahoo, iCloud, Titan, Namecheap, GoDaddy, cPanel, SES, Brevo, SendGrid. Connection test, domain SPF/DMARC check, daily limit. |
| Campaigns | Recipients typed or pasted, **CSV upload**, or a **Google Sheets link** (up to 200,000). Pick several mailboxes. Subject and body with `{{field}}` / `{{field\|fallback}}` merge fields. Timing: **Automatic** (send window, timezone, weekdays-only) or **Set the times myself** (first email at, then one every N minutes, and any single email's time can be changed). Test email to yourself. Follow-ups reply in the same thread from the same mailbox. |
| Email style | **Personal** (default): plain text, no unsubscribe header or link, an opt-out line ("reply 'no'…"), no tracking. Aims for Gmail Primary. **Newsletter**: HTML, unsubscribe link plus one-click header, optional open/click tracking. |
| Sending | Mailboxes take turns. Each sends at most its daily limit per rolling 24 hours, spread over the window (±15% variation). The rest waits for the next day automatically. The same person always gets the same mailbox. Retries for temporary errors; auth errors pause the mailbox; "limit exceeded" rests it for 24 hours (`rest_until`). **Set times** (`messages.scheduled_at`) go out at that time, inside or outside the window, still within pauses, rests and daily limits. Every waiting email has a live countdown and **Set/Change time** (new time, Send now, back to Automatic). |
| Tracking | Sent, bounced (SMTP rejection and bounce notices, matched by Message-ID), replied, failed. Open/click only in Newsletter style. "Delivered" is not reported by ordinary mailboxes. Every queued email shows an **expected send time** or why it's waiting. |
| Replies | Inbox job every 5 minutes, read-only (unread stays unread). Matches replies by `In-Reply-To`/`References`, else by address. Strips quoted history, saves attachments, flags auto-replies. **"No thanks / stop / unsubscribe / remove me" replies** put the person on the do-not-send list. Emailed "unsubscribe" requests do too. **Several replies from one person** to the same email are all kept: the reply page shows the whole conversation, the list tags them "reply 2 of 3", and the campaign and recipient pages show every one. |
| Do-not-send | Bounces, unsubscribes and manual entries. Skipped in every campaign. |
| Recipients | Paged list with search and status filter. Per-person timeline: which mailbox, when, what happened. |
| Accounts | Register and login with JWT. The app always opens on the sign-in page; registering never signs you in, it returns to sign-in with a notice. The first account is admin (restricted to `ADMIN_EMAIL` if set); later sign-ups need admin approval. Team page, password change, rate-limited logins (10 failures → 15-minute lock). |
| API | `/api/v1/*` with Bearer JWT (`POST /api/v1/auth/token`, or Settings → Create API token). Optional shared `API_KEY`. Paged lists return a `pagination` block. |
| PWA | Installable app with an offline page. **Push notification for every reply**: sent with high urgency (no waiting for a sleeping phone) and stays on screen until clicked. An open ColdMailer tab refreshes its reply list and unread count and shows a banner when one arrives, and refreshes again when the tab is shown. On a computer, pushes arrive only while the browser is running. Fully responsive: sidebar on desktop, bottom tabs on phones. |
| Pagination | Every growing list is paged at the database (LIMIT/OFFSET with a count), with search and filters in the URL. |
| Branding | Name **ColdMailer** (`lib/brand.ts`), icy-blue logo in `public/brand/`. The name is kept off recipient-facing pages (the unsubscribe page shows only the sender). |

## 3. How it's built

- **Framework:** Next.js 16.4 (App Router, Turbopack) with React 19 and TypeScript. One app holds the UI, the API and the jobs.
  - `AGENTS.md` is written by `next dev`. It says Next 16 differs from older versions; read `node_modules/next/dist/docs/` when unsure.
  - The route-protection file is `proxy.ts` (formerly `middleware.ts`).
- **Database:** PostgreSQL through **Drizzle ORM**. The schema lives in `lib/db/schema.ts`; migrations in `drizzle/`.
- **Mail:** Nodemailer 10 to send; ImapFlow and mailparser to read.
- **Other:** web-push for notifications, jose for JWTs, zod for validation, Tailwind CSS 4, lucide-react icons.
- **Jobs:** cron calls `/api/cron/send` every minute and `/api/cron/inbox` every 5 minutes. In Docker the `cron` container does this.
- **Docker** (`docker-compose.yml`):

  | Service | Role |
  | --- | --- |
  | `db` | Postgres |
  | `migrate` | Auto-generates and applies migrations, then exits |
  | `app` | The app (port 3000, this machine only) |
  | `cron` | Calls the send and inbox jobs |
  | `adminer` | Database browser (127.0.0.1:8080) |
  | `caddy` | HTTPS; only with `COMPOSE_PROFILES=https` on a server |

## 4. Where everything is

```
app/(app)/              signed-in pages: dashboard, campaigns, replies, recipients, mailboxes, suppressions, settings
app/login, app/register login and sign-up
app/api/                campaigns, campaign test, Google Sheets import, cron jobs, attachments, unsubscribe
app/api/v1/             public API (JWT): auth/token, campaigns (+ messages), recipients (+ lookup), replies, senders
app/t/, app/u/          open pixel and click redirect; public unsubscribe page
app/actions/            server actions: auth, team, mailboxes, campaigns, replies, push, settings
components/             UI kit, app shell (nav), pagination, queue ETA, PWA bits
lib/jobs/send.ts        send job: turns, limits, gaps, retries, error handling
lib/jobs/inbox.ts       inbox job: IMAP reading per mailbox and folder
lib/jobs/inbox-watch.ts instant reply check: IMAP IDLE per active mailbox, started by instrumentation.ts
lib/timezones.ts        timezone dropdown options; lib/time-window.ts has the zone-aware time conversions
lib/mail/               connection (SMTP/IMAP), compose (personal/newsletter), inbound (replies, bounces, opt-outs), errors, dns
lib/queue-eta.ts        expected-send-time simulation
lib/queries.ts          the 24-hour sent count (see the comment there: why "senders"."id" is written out)
lib/db/schema.ts        all tables
drizzle/                migrations 0000–0008 (+ meta)
scripts/                db-sync.sh, migrate.mjs, cron.mjs, generate-keys.mjs, backup.sh
deploy/                 Caddyfile, server.env (server secrets; private, not in git or images)
tools/test-env/         throwaway Postgres/SMTP/IMAP servers for testing (see its README)
docs/                   plan, schema/API reference, Deploy to AWS EC2 / Google Cloud / Oracle Cloud, archive/
public/                 sw.js (push + offline), offline.html, icons/, brand/
```

## 5. Database and migrations

- **Tables:** `users`, `senders`, `recipients`, `campaigns`, `campaign_senders`, `messages`, `replies`, `tracking_links`, `suppressions`, `test_sends`, `push_subscriptions`, `settings`, `jobs`.
- **Migrations so far:**

  | File | What it does |
  | --- | --- |
  | `0000` | Initial tables |
  | `0001` | Users |
  | `0002` | Any-SMTP columns |
  | `0003` | Custom data backfill of encryption settings |
  | `0004` | `test_sends` |
  | `0005` | Pagination indexes |
  | `0006` | Email style and opt-out line |
  | `0007` | `messages.scheduled_at` (set send times) and `senders.rest_until` |
  | `0008` | Push delivery health per device (`last_sent_at`, `last_received_at`, `last_error`, `last_error_at`) |

- **Process:** change `lib/db/schema.ts`, then either:
  - run `docker compose up --build`, where the `migrate` container generates the migration file into `drizzle/` and applies it; or
  - run `npm run db:sync` against a database.

  Commit the new `drizzle/` files: they are the database history, and the server must get the same files.
- **Renames** (table or column) make drizzle-kit ask a question. Run `npm run db:generate` interactively on the laptop for those.
- **Data changes** (backfills) need a custom migration: `npx drizzle-kit generate --custom --name what_it_does`, then write the SQL into the new file.

## 6. Secrets and settings

| File | Purpose |
| --- | --- |
| `.env` (laptop) | Local Docker run, `APP_URL=http://localhost:3000`. Private, `chmod 600`. |
| `deploy/server.env` | Server settings with **separate** fresh secrets, `APP_URL=https://coldmailer.edufusionbd.online`, `COMPOSE_PROFILES=https`. **Still to fill in:** `ADMIN_EMAIL` and the email in `VAPID_SUBJECT`. |
| `.env.example` | Documents every variable |

- **Never change `ENCRYPTION_KEY`** once mailboxes exist: their saved passwords become unreadable.
- Changing `AUTH_SECRET` signs everyone out and cancels API tokens.
- `npm run keys` prints a fresh set of secrets.

## 7. Running it on this laptop

Docker needs `sudo` on this machine (fingerprint or password), so run Docker commands in a terminal where you can authenticate.

```bash
sudo docker compose up -d --build
```

```bash
sudo docker compose logs -f app cron
```

```bash
sudo docker compose down
```

The first starts or rebuilds everything after code changes; the second shows logs; the third stops everything and keeps your data.

- **App:** http://localhost:3000
- **Adminer:** http://localhost:8080 (PostgreSQL, server `db`, user `email`, password from `.env`, database `email_sender`)

Without Docker (development): `npm install`, then `npm run dev` plus `npm run cron`, using a `DATABASE_URL` in `.env`.

**Checks before calling a change done:**

```bash
npm run typecheck
```

```bash
npm run build
```

## 8. How work was tested

There's no automated test suite. Each feature was checked end to end against the **local test kit** in `tools/test-env/` (see its README):

- embedded Postgres;
- an SMTP sink that saves every email to `outbox/`;
- an IMAP mock, into which replies and bounce notices were appended to test the inbox job.

Pages were checked in the browser pane at desktop and phone width.

## 9. Verified vs not yet verified

**Verified locally:**

- **Accounts:** register, login, admin approval; JWT issue and every rejection case; rate limiting.
- **Mailboxes:** add and test a mailbox; wrong password; STARTTLS missing; send-only mailbox with Reply-To.
- **Sending:** turns, gaps and daily limits; SMTP rejection → bounced; follow-up threading; merge fields with fallbacks; Personal-style format (`text/plain`, no unsubscribe header).
- **Inbox:** bounce notices matched by Message-ID; replies by header and by address; opt-out replies → do-not-send; emailed unsubscribe; inbox stays unread.
- **Tracking and unsubscribe:** open/click with bot filtering; one-click unsubscribe; recipient page without app name.
- **Lists and views:** pagination on all lists (with 3,000+ rows, about 340 ms per page), API pagination, expected send times, phone layouts.
- **Migrations and Docker:** automatic migrations (generate and apply), the custom backfill migration; Docker build and run on this laptop.
- **Multiple replies (Oct 16, test kit):** four replies from one person (to our email, to his own reply, and a new email with no thread headers) are all recorded and shown on the reply page, the Replies list, the campaign page and the recipient timeline. The in-app banner was checked; real OS push was not (the browser pane can't run service workers).
- **Inbox job result** now also counts "other emails" (not about a campaign email) and "already saved"; a passing check clears an old "Inbox check failed" error on the mailbox.
- **Set send times (Oct 16, test kit):**
  - **Form:** "Set the times myself" with a per-email edit.
  - **Timing:** only due emails go out, also outside the window.
  - **Controls:** Change time, Send now and Automatic, on the campaign page and in Recipient lookup.
  - **Waiting:** daily limit and `rest_until` hold set times back, and the page says why.
  - **Unchanged:** automatic sending and its gap.
  - **API:** `send_at`, `schedule`, `scheduled_at`, plus validation errors.
  - **Countdowns** at phone width; `npm run build` passes.
  - **Not yet:** in Docker, and migration `0007` on the existing local database.

**Not verified yet:**

- **Real deliverability:** Gmail Primary placement with the Personal style. On Oct 16 a test to the user's Gmail **landed in spam**. Cause found: the `hostingermail-a/b/c._domainkey` DKIM CNAMEs exist in Cloudflare but were **Proxied**, so they resolve to Cloudflare IPs and Gmail can't read the key. The user switched them to **DNS only** the same day; Google's public DNS returned the key right after. Not yet confirmed with a new test in Gmail's "Show original". SPF is fine; DMARC is `p=none`.
- **Real servers:** AWS EC2, Google Cloud or Oracle; Caddy HTTPS with a real certificate; the backup script on a server.
- **Phones:** push notifications on a real phone (the user's phone PWA receives none as of Oct 17; see "Oct 17 changes"); PWA install on iPhone/Android.
- **Real mailbox, Oct 16:** the local database had only one reply (Oct 15) and the Hostinger INBOX position was still UID 4, so no newer email had reached that INBOX by then. A read-only listing of the real inbox (sender, subject, thread headers) wasn't run because sudo timed out.
- **Local Docker rebuilt Oct 16** with the reply-notification changes; a manual inbox run there reported no new emails of any kind in the Hostinger INBOX. Real push delivery to the user's Chrome is still to be seen with a live reply.
- **Imports:** a real shared Google Sheet (only the error paths were tested).
- **Other providers:** Microsoft 365 / Outlook.com (they need OAuth, which isn't built).

## 10. Known gaps and limits

- **Statuses:** no separate "delivered" status (sent with no bounce for N days is the best available signal).
- **Mail providers:** no Microsoft 365 / Outlook.com sign-in (OAuth).
- **Replies:** no replying from the dashboard; the reply page has a `mailto:` link.
- **Imports:** Excel files must be saved as CSV first (or use a Google Sheets link).
- **Estimates:** expected send times are approximate (±15% gaps; a mailbox shared by several campaigns serves them in turn).
- **Login limiter:** in memory, so it resets when the app restarts. Fine for one container.
- **Old test emails:** those sent before the counting fix aren't counted in "Sent in the last 24 hours".
- **Gmail tabs:** placement can't be guaranteed. The Personal style removes the bulk-mail signals; a personal sender address (not `support@`), few links and engagement help further.

## 11. Next steps, in order

1. **Hosting:** follow [`docs/Deploy to AWS EC2.md`](docs/Deploy%20to%20AWS%20EC2.md) (or the Google Cloud guide). On a Hostinger VPS the same Docker steps apply, apart from the provider-specific parts.
2. **Before deploying:**
   - fill `ADMIN_EMAIL` and `VAPID_SUBJECT` in `deploy/server.env`;
   - decide on the subdomain (`coldmailer.` vs something neutral like `links.`). If you change it, update `APP_URL` and `APP_DOMAIN` there.
3. **Deploy:**
   - add the DNS `A` record in hPanel and run `docker compose up -d --build` on the server;
   - confirm Caddy obtained the certificate;
   - create the admin account, add mailboxes, and set Settings (footer address, opt-out line, timezone `Asia/Dhaka` or the recipients' timezone).
4. **Deliverability check:**
   - send a Personal-style test to Gmail;
   - in "Show original", SPF, DKIM and DMARC should all PASS. If DKIM fails, check that Hostinger's three DKIM CNAMEs in Cloudflare are DNS only, not Proxied (see the AWS guide's "Before you start").
   - Prefer a personal sender address and name.
5. **Turn on nightly backups** (crontab line in the guide) and copy backups off the server now and then.
6. **Optional next features:** a "delivered" label, reply from the dashboard, Microsoft 365 OAuth, an automated test suite.

## 12. How to work on it in the next session

1. **Orient:** read this file.
   - Check the current state with `sudo docker compose ps` (local) or the server's `docker compose ps`.
   - Keep `README.md`, `docs/Email Backend Database Schema and API Reference.md` and this file up to date when things change.
2. **Code changes:**
   - edit, then `npm run typecheck` and `npm run build`;
   - test against `tools/test-env/` when mail behaviour changes;
   - rebuild Docker: `sudo docker compose up -d --build`.
3. **Schema changes:** edit `lib/db/schema.ts`. The migration is generated on the next Docker start (or with `npm run db:sync`). Keep the new `drizzle/` files.
4. **Updating the server:** copy the project again (the deploy guide's `tar`/upload or `rsync` step), then run `docker compose up -d --build` on the server. `.env` and the data volumes are kept.
5. **Do not** commit or share `.env` or `deploy/server.env`. Don't change `ENCRYPTION_KEY`.
