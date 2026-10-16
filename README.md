<p align="center"><img src="public/brand/coldmailer-logo.svg" alt="ColdMailer" width="360"></p>

Cold outreach from your own mailboxes, sent at a human pace, with every reply tracked.

ColdMailer sends email campaigns through your Hostinger business mailboxes, Gmail accounts, or any SMTP server. It spaces emails out so they look hand-sent, keeps each mailbox under its daily limit, continues the rest of a list the next day, and records every reply and bounce. It installs as an app on phones and computers (PWA) and sends a push notification when someone replies.

- **Mailboxes:** connect Hostinger, Gmail, or any SMTP server (Zoho, Yahoo, iCloud, cPanel hosting, Titan, Namecheap, GoDaddy, Amazon SES, Brevo, SendGrid…). You can set your own server, port, encryption and username. Send-only servers route replies to a mailbox ColdMailer reads. Each mailbox has its own daily limit.
- **Leads:** type or paste addresses, upload a CSV, or paste a Google Sheets link. Up to 200,000 per campaign; duplicates, invalid addresses and the do-not-send list are filtered out.
- **Sending:** mailboxes take turns. Each one sends at most its daily limit per rolling 24 hours, spread across the send window with a little random variation. Whatever doesn't fit today continues automatically tomorrow. The same person always gets the same mailbox. Or **set the times yourself**:
  - when creating a campaign, pick the first email's time and the gap between emails, then change any single email's time;
  - on a waiting email, **Change time** lets you send it now, set a new time, or hand it back to automatic timing.

  An email with a set time goes out at that time, even outside the send window, but never over a mailbox's daily limit.
- **Tracking:** sent, bounced and replied, plus optional opens and clicks. Hard bounces and unsubscribes go on the do-not-send list automatically.
- **Replies:** inboxes are read every 5 minutes, read-only, so unread mail stays unread. Replies are matched to the exact email they answer and pushed to your phone.
- **Follow-ups:** reply in the same thread, from the same mailbox, to everyone who hasn't answered.
- **Team:** sign in and register. The first account is the admin; later sign-ups wait for an admin's approval. Logins and API access use JWTs.

The plan behind it is in [`docs/`](docs/).

## Run with Docker (recommended)

You need Docker with Compose. On Linux, run the commands with `sudo` or add yourself to the `docker` group.

```bash
cp .env.example .env
npm run keys        # or: docker run --rm -v "$PWD":/app -w /app node:22-alpine node scripts/generate-keys.mjs
```

Paste the printed keys into `.env`, then set `APP_URL`, `ADMIN_EMAIL` and `POSTGRES_PASSWORD`. Set `UID` and `GID` to your user's ids (`id -u`, `id -g`) so new migration files in `drizzle/` belong to you. Then:

```bash
docker compose up -d --build
```

| Service | What it does | Address |
| --- | --- | --- |
| `db` | PostgreSQL, data kept in the `pgdata` volume | internal |
| `migrate` | Updates the database, then exits (see below) | — |
| `app` | ColdMailer | http://localhost:3000 |
| `cron` | Calls the send job every minute and the inbox job every 5 minutes | — |
| `adminer` | Database browser (server `db`, PostgreSQL, user/password from `.env`) | http://localhost:8080, this machine only |

Open the app: it always starts on the sign-in page. Choose **Create one** to make the first account, which becomes the admin (if `ADMIN_EMAIL` is set, only that address can create it), then sign in with it. Creating an account never signs you in automatically.

**Put it online:** [`docs/Deploy to AWS EC2.md`](docs/Deploy%20to%20AWS%20EC2.md) (t3.micro, free tier or credits), [`docs/Deploy to Google Cloud.md`](docs/Deploy%20to%20Google%20Cloud.md) (free e2-micro) and [`docs/Deploy to Oracle Cloud.md`](docs/Deploy%20to%20Oracle%20Cloud.md) walk through a small server with automatic HTTPS (Caddy, switched on by `COMPOSE_PROFILES=https` and `APP_DOMAIN` in `.env`) and nightly backups (`scripts/backup.sh`). Push notifications and installing the app need HTTPS. The app port and Adminer only listen on the machine itself; reach Adminer on a server through an SSH tunnel: `ssh -L 8080:127.0.0.1:8080 you@server`.

Logs: `docker compose logs -f app cron migrate`.

## Database changes (migrations)

There is no separate migration step to run. Every `docker compose up --build` starts the `migrate` service before the app:

1. It compares `lib/db/schema.ts` with the migrations in `drizzle/`. If you added or changed tables or columns, it writes a new migration file into `drizzle/`.
2. It applies every migration the database hasn't run yet.
3. Only then do `app` and `cron` start. If anything fails, the app doesn't start and `docker compose logs migrate` says why.

`drizzle/` is mounted from your project folder, so new migration files appear next to your code and are kept between builds. Keep that folder: it is the history of your database. Committing it is a good idea if more than one machine deploys, but not required.

One exception: renaming a table or column makes drizzle-kit ask whether it's a rename or a drop-and-create. That question can't be answered inside a container. Run `npm run db:generate` on your machine once, answer it, then `docker compose up --build` again.

Without Docker, the same thing is `npm run db:sync`.

## Run without Docker

Requirements: Node.js 20.9+, PostgreSQL 14+, and outgoing ports 465/587 (SMTP) and 993 (IMAP). Hostinger VPS works; DigitalOcean blocks SMTP.

```bash
npm install
cp .env.example .env    # set DATABASE_URL and the keys from `npm run keys`
npm run db:sync         # create/update tables
npm run build
npm start               # the app on port 3000
npm run cron            # in a second terminal (or PM2): the send and inbox jobs
```

For development use `npm run dev` instead of build + start, and still run `npm run cron`.

Instead of `npm run cron` you can use system cron:

```cron
CRON_SECRET=paste-the-value-from-.env
* * * * *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/send >/dev/null
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/inbox >/dev/null
```

Settings → Background jobs shows whether both jobs are running.

## Connecting mailboxes

**Hostinger:** use the mailbox password from hPanel → Emails → Mailboxes. Servers are filled in (`smtp.hostinger.com:465`, `imap.hostinger.com:993`).

**Gmail:** turn on 2-Step Verification, create an app password at `myaccount.google.com/apppasswords`, and use that 16-character code, not your normal password.

**Any SMTP server:** choose a provider under "Fill in for" or enter the server yourself. You can set:

- the port, and encryption (SSL/TLS on 465, STARTTLS on 587);
- a username if it isn't the email address (SendGrid uses `apikey`; Amazon SES has its own SMTP credentials);
- IMAP settings, so replies and bounces are read.

If the server is send-only, turn off "Read this mailbox's inbox" and pick a mailbox to receive replies. ColdMailer sets `Reply-To` to it. Outlook.com and Microsoft 365 need Microsoft sign-in, which isn't supported yet.

When you add a mailbox, ColdMailer:

- logs in to SMTP and IMAP;
- finds the Sent and Spam folders;
- notes where the inbox is now, so old mail is never read;
- can send you a test email.

Start daily limits low (Hostinger about 20, Gmail about 10) and raise them slowly.

## Big lead lists

On New campaign → Recipients → **CSV or Google Sheet**:

- **CSV:** needs an `email` column. Other columns (`name`, `company`…) become `{{name}}`, `{{company}}` fields. From Excel, use File → Save As → CSV.
- **Google Sheets:** paste the link. The sheet must be shared as "Anyone with the link can view". The tab in the link is the one imported.

The campaign page shows how many sending days are left. Each day the mailboxes send up to their limits inside the send window, and the rest waits for the next day automatically.

Every queued email shows a live countdown to when it goes out, on the campaign page and in Recipient lookup, with **Set time / Change time** next to it.
- **A set time:** the countdown runs to that time. If a daily limit or a rest after a "limit exceeded" error holds the email back, the page says so.
- **Automatic timing:** the estimate replays the sending rules: each mailbox's rest time, its 24-hour limit and the send window.
- **No estimate:** the page says why: the campaign or its mailbox is paused, or the email is retrying after an error. Times are approximate: real gaps vary by ±15%, and a mailbox shared by several campaigns serves them in turn.

## Landing in Primary, not Promotions or spam

Each campaign has an **Email style**:

- **Personal** (default, for outreach): plain text with no HTML, no unsubscribe header or link and no tracking, so it looks like an email someone typed. It ends with your opt-out line ("just reply 'no'…") and footer from Settings. A short opt-out reply ("no thanks", "stop", "unsubscribe", "please remove me", "not interested") puts the person on the do-not-send list automatically.
- **Newsletter** (for opted-in lists): HTML with an unsubscribe link, a one-click unsubscribe header and optional open/click tracking. Gmail usually files this under Promotions. It's also what Gmail requires from bulk senders (5,000+ emails a day to Gmail).

What else decides the inbox:

- **Sender:** a person's address and name (`sarah@yourdomain.com`, "Sarah Khan") beats a role address (`support@`, `info@`).
- **Content:** few or no links in the first email, no images or attachments, nothing that reads like an advert.
- **Authentication:** SPF, DKIM and DMARC must pass. In Gmail, open the email → ⋮ → *Show original*: all three should say PASS.
- **Volume:** keep daily limits low on new mailboxes and raise them slowly.
- **Engagement:** replies, and recipients moving an email to Primary, teach Gmail to put later emails there.

## The unsubscribe page

Newsletter-style emails have an unsubscribe link (and a one-click unsubscribe header, which Gmail and Outlook show as their own "Unsubscribe" button); personal-style emails ask people to reply instead. The page is public: recipients don't sign in. Each link carries a signed token for that one email, so links can't be guessed or forged.

The page shows:

- who the emails come from (sender name and domain);
- the recipient's address;
- one button.

It never shows the ColdMailer name, logo or app install prompt. Replying with the subject "unsubscribe" works too. All three ways put the address on the do-not-send list and cancel anything still queued for it.

## Big lists in the dashboard

Every list that can grow loads one page at a time from the database:

- Campaigns
- a campaign's recipients
- Replies
- Recipients and each person's timeline
- the do-not-send list

Each has search and filters, a rows-per-page choice (10, 25, 50 or 100) and page links (a compact "3 / 120" on phones). Search, filters and page live in the URL, so a filtered page can be bookmarked or shared with your team.

## How each status is known

| Status | Source |
| --- | --- |
| Sent | Your mail server accepted the email (SMTP 250) |
| Bounced | The server refused the address while sending, or a bounce notice arrived in the sending mailbox. Bounce notices are matched by the email's own Message-ID. |
| Replied | A reply arrived that references the email's Message-ID (or comes from that person within 30 days) |
| Delivered | Not reported by ordinary mailboxes. "Sent with no bounce" is the best signal available. |
| Opened / clicked | Optional tracking image and links. Apple Mail and security scanners are filtered out, so treat the numbers as approximate. |

## Before the first real campaign

- SPF, DKIM and DMARC are set for your domain. The mailbox page checks SPF and DMARC.
- Settings → Email footer has your postal address.
- Send yourself a test from the New campaign page.

## API

Every request carries a JWT: `Authorization: Bearer <token>`. Get a token in one of two ways:

- **Settings → API → Create API token:** for the MCP server or a script. Valid 1–90 days; copy it when shown.
- **`POST /api/v1/auth/token`** with `{"email": "...", "password": "...", "days": 30}`. It returns `{"access_token": "eyJ…", "token_type": "Bearer", "expires_in": …}`.

Tokens are signed with `AUTH_SECRET` (HS256). They're tied to a user, so campaigns created through the API show who made them, and a token stops working as soon as that account is disabled. Changing `AUTH_SECRET` cancels every token and signs everyone out. After 10 wrong passwords, that address is locked for 15 minutes. An `API_KEY` in `.env` also works as a Bearer token if you set one.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/token` | Exchange email + password for a JWT (no token needed) |
| `GET` | `/api/v1/campaigns?status=&q=` | List campaigns with counts (paged) |
| `POST` | `/api/v1/campaigns` | Create a campaign (details below) |
| `GET` | `/api/v1/campaigns/:id` | Progress counts |
| `GET` | `/api/v1/campaigns/:id/messages?status=&q=` | A campaign's emails: who, which mailbox, what happened (paged) |
| `GET` | `/api/v1/replies?since=<ISO date>` | Replies, newest first (paged) |
| `GET` | `/api/v1/recipients?status=&q=` | Everyone you've emailed (paged) |
| `GET` | `/api/v1/recipients/lookup?email=` | One person's full history |
| `GET` | `/api/v1/senders` | Mailboxes and today's usage |

Paged lists take `page` (from 1) and `page_size` (default 50, up to 200). They return a `pagination` block: `{"page", "page_size", "total", "total_pages", "has_more"}`. A page past the end returns the last page.

`POST /api/v1/campaigns` takes:

- required: `name`, `recipients`, `senders`, `subject`, and `body_text` or `body_html`;
- optional: `follow_up_of`, `track_opens`, `track_clicks`, `send_window`;
- optional set send times: `send_at` on a recipient object (ISO date-time with offset), or `schedule: {"start_at", "every_minutes"}` for the whole list. Details in `docs/Email Backend Database Schema and API Reference.md`.

`recipients` can mix plain strings and objects: `["a@x.com", {"email": "b@y.com", "name": "Bea", "vars": {"company": "Y"}}]`.

## Project layout

```
app/(app)/          signed-in pages
app/login, register sign in and sign up
app/api/            campaign creation, Google Sheets import, cron jobs, public API, unsubscribe
app/t/  app/u/      open pixel and click redirect; unsubscribe page
lib/jobs/           send job (turns, limits, retries) and inbox job (replies, bounces)
lib/mail/           SMTP/IMAP connection, email building, reply and bounce parsing
lib/db/schema.ts    database tables (Drizzle ORM); migrations in drizzle/
lib/brand.ts        app name
public/sw.js        service worker: offline page and push notifications
scripts/            db-sync (generate + apply migrations), migrate, cron runner, key generator
```
