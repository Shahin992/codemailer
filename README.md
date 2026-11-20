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
- **Replies:** the app keeps an IMAP IDLE connection to each active inbox, so a reply is picked up within seconds and pushed to your phone; a full check (inbox and spam folder) also runs every 5 minutes. Read-only, so unread mail stays unread (only warm-up emails are marked read). Replies are matched to the exact email they answer.
- **Warm-up:** switch it on for several mailboxes and they email each other and reply in the same thread, a few more each day, so new addresses build a normal history. Your own Gmail accounts can join as **partners** that only receive and reply. Warm-up emails that land in spam (Gmail's included) are moved back to the inbox and counted. See [Mailbox warm-up](#mailbox-warm-up).
- **Follow-ups:** reply in the same thread, from the same mailbox, to everyone who hasn't answered.
- **Accounts:** anyone can sign up with their email address; the account can be used once the **super admin** approves it. Each account is a private workspace: its own mailboxes, campaigns, recipients, replies, do-not-send list, settings and reply notifications. The super admin signs in at `/superadmin/login` and approves, rejects, disables (a disabled account can't sign in and its campaigns stop sending) and deletes accounts; it has no workspace of its own. Logins and API access use JWTs.

The plan behind it is in [`docs/`](docs/).

## Run with Docker (recommended)

You need Docker with Compose. On Linux, run the commands with `sudo` or add yourself to the `docker` group.

```bash
cp .env.example .env
npm run keys        # or: docker run --rm -v "$PWD":/app -w /app node:22-alpine node scripts/generate-keys.mjs
```

Paste the printed keys into `.env`, then set `APP_URL` and `POSTGRES_PASSWORD`. Set `UID` and `GID` to your user's ids (`id -u`, `id -g`) so new migration files in `drizzle/` belong to you. Then:

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

Open `/superadmin/login` and sign in as the super admin that the database migration creates, and change its starting password in the panel. Then create your own account at `/register` (**Create one** on the sign-in page) and approve it in the super admin panel. Every sign-up waits for that approval; creating an account never signs you in automatically. Every `docker compose up` first saves a database backup to `./backups` (newest 10 kept), and only then applies migrations.

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

The dashboard warns when the jobs stop running.

The instant reply check runs inside the app itself (started from `instrumentation.ts`), not in cron. Set `INBOX_WATCH=off` in `.env` to turn it off; the 5-minute check still runs.

## Email footer and logo

Settings → Email footer and logo:

- **Footer text and opt-out line** go under every campaign email.
- **Logo:** PNG, JPG or GIF up to 1 MB (under 100 KB is best: every email carries a copy). It sits above the footer text like a signature and is embedded in the email (an inline `cid:` image), so it shows without "load images" and personal-style emails still contain no links to this server. The file is checked by its content (not its name), stored as `STORAGE_DIR/brand/logo-<hash>.<ext>`, and the old file is removed when you replace or remove it. `scripts/backup.sh` backs up `STORAGE_DIR` along with the database.
- **Also in personal-style emails** (on by default): those then go out as plain text plus simple HTML instead of plain text only. Images can make Gmail file cold email under Promotions; switch it off for the best chance of the Primary inbox.

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

## Mailbox warm-up

New mailboxes have no history, and mail providers distrust addresses that only ever send. Warm-up gives them a history of ordinary sent **and** received mail before (and while) they send campaigns.

**Turn it on:** open a mailbox (Mailboxes → the address) → the **Warm-up** tab → **Turn on warm-up**. Do it for every mailbox that should take part. The mailboxes with warm-up on in one account form a pool and email each other; warm-up never crosses accounts, and a mailbox needs an inbox ColdMailer reads (IMAP).

**What happens:**

- **Each day** every warm-up mailbox sends new emails to the others at random times inside the account's send window (Settings → Sending defaults). Day 1 is 2 emails, then 2 more each day, up to 30 a day (reached on day 15). With "weekdays only", only weekdays count as warm-up days, so the number never jumps after a weekend. You can change the start, the daily increase, the maximum and the reply rate per mailbox.
- **The emails** are short, ordinary workplace emails in about 20 everyday situations (asking for a call, moving a call, sharing a draft, looking for a file, checking a deadline, a project update, lunch, being out, supplies, training, access to a file…), plain text, no links. Each situation has several wordings and its words (day, document, project) vary, so no two emails are the same.
- **Replies fit the email:** a mailbox answers about 35% of the warm-up emails it gets, 15 minutes to 3 hours later, in the same thread (`Re:` subject, `In-Reply-To`/`References`, the earlier email quoted). The reply is written for that situation and uses the same details ("Do you have 15 minutes on Tuesday…" → "Sure, Tuesday at 2pm works for me."). Some threads get a short closing from the first sender ("Perfect, talk then."), up to 3 emails; "thank you" notes and reminders end with the reply.
- **On the receiving side** the inbox check recognises warm-up emails by their `Message-ID` (nothing visible is added to the email), marks them read, and moves any that landed in **spam** back to the inbox. How often a mailbox's emails land in spam is the main health signal.
- **Daily limit:** warm-up emails count toward the mailbox's daily limit together with campaign and test emails. If warm-up at its maximum could fill the limit, its Warm-up page warns you; raise the daily limit or lower the warm-up maximum.
- **Kept apart:** warm-up emails never appear in Replies, reply notifications, campaign numbers, Recipients or the do-not-send list.

**The Warm-up menu** lists every mailbox with warm-up on. At the top: the account's inbox score over the last 7 days (of its warm-up emails the other mailboxes found, the share that wasn't in spam; 90%+ is good), emails sent today and still to go, how many landed in spam, and the last warm-up email. Then the **business mailboxes** (warm-up day, today's number on the way to the maximum, sent and received today, a score ring), the **partners** (emails got and replied today; the ring is how much of your mail reached their inbox), and the mailboxes with warm-up off, which open where you can turn it on.

**A warm-up mailbox** opens with three tabs:
- **Overview:** the inbox score with what it means (most senders wait for about day 14 and a score over 90% before campaigns), the ramp, today's numbers, the last 14 days as bars (inbox, spam, not found yet; tap a day for its numbers), where its emails landed in the last 7 days (Gmail spam shown apart), and the latest conversations. Problems (no partner yet, paused, inbox not read, no spam folder, warm-up could fill the daily limit, no person's name) show as alerts with a link to fix them.
- **Emails:** every warm-up conversation, with a search and filters (you started, others started, landed in spam, waiting to send). The latest email of each reads "You: …" when this mailbox wrote it, or the other person's name.
- **Settings:** turn warm-up on or off, the role (business mailbox or partner) and the numbers.

A conversation opens like an email thread. This mailbox's own emails say **You**, have a blue edge and show where they landed in *their* inbox; the other mailbox's emails show its name, **Received**, and where they landed in *your* inbox. A strip at the top shows both mailboxes and how many emails each wrote. The Mailboxes list still shows the warm-up day and a spam warning badge.

The mailbox page has two tabs: **Overview** (sending, actions, a link to its warm-up, domain check) and **Settings** (the mailbox's connection, name and daily limit).

**Turning it off** cancels that mailbox's waiting warm-up emails. Turning it on again continues the ramp where it stopped.

### Partner mailboxes (your own Gmail accounts)

Warm-up only between mailboxes on one provider (for example all on Hostinger) never leaves that provider, so Gmail never sees it. Gmail accounts you can sign in to fix that: add them as **partners**. Your business mailboxes send to them, and ColdMailer, signed in to each Gmail over IMAP/SMTP, finds the warm-up email (in the inbox or in `[Gmail]/Spam`), moves it out of spam, marks it read, now and then stars it or marks it important, and replies in the same thread 20 minutes to 5 hours later.

- **Set up each Gmail account** (in the Google account, not in ColdMailer): turn on **2-Step Verification**; create an **App password** at `myaccount.google.com/apppasswords`; in Gmail → Settings → *Forwarding and POP/IMAP*, make sure **IMAP** is on.
- **Add it:** Mailboxes → Add mailbox → **Gmail**, with the Gmail address and the 16-character app password. Then on its page → Warm-up → *Takes part as* → **Partner (only receives and replies)** → Save, and **Turn on warm-up**.
- **Low volume:** a partner gets at most 3 new warm-up emails a day (changeable, 1–10), shared fairly among your business mailboxes, so each business mailbox lands in Gmail every day and the Gmail account still looks like a person's.
- **Partners never start threads and never send campaigns:** they aren't offered as campaign senders, and a campaign email to one of your partner addresses is cancelled. A mailbox a campaign already uses can't become a partner.
- **Status:** each business mailbox's page shows **In Gmail spam, 7 days** (how many of its emails Gmail put in spam, and how many were moved back), apart from spam at your other mailboxes. That Gmail figure is the real inbox-placement signal. A partner's page shows what it received, its replies and what it moved out of its spam.
- Only add accounts ColdMailer can sign in to. Warm-up never sends to an address it can't read and reply from.
- **Give each one a person's name** (Edit mailbox → Sender name): replies are signed with it and the From line shows it. The mailbox page warns when a Gmail account is still a Business mailbox, or when the sender name is empty or not a person's (like "Gmail").

Warm-up helps; it doesn't replace SPF, DKIM, DMARC, low volumes and good content.

## Big lead lists

On New campaign → Recipients → **CSV or Google Sheet**:

- **CSV:** up to 50 MB and 200,000 people. Needs an `email` column. Other columns (`name`, `company`…) become `{{name}}`, `{{company}}` fields. From Excel, use File → Save As → CSV. Large files are read in a background worker, and lists over 5,000 people are uploaded in parts of 5,000 with a progress bar: the campaign is a **draft** (nothing sends) until the last part is in. Checked with 100,000 rows / 20 MB (about 30 seconds) and 200,000 rows / 45 MB (about 50 seconds).
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

Every request carries a JWT: `Authorization: Bearer <token>`. Get a token with:

- **`POST /api/v1/auth/token`** with `{"email": "...", "password": "...", "days": 30}`. It returns `{"access_token": "eyJ…", "token_type": "Bearer", "expires_in": …}`.

Tokens are signed with `AUTH_SECRET` (HS256). They're tied to a user and only see that account's workspace, and a token stops working as soon as that account is disabled. Changing `AUTH_SECRET` cancels every token and signs everyone out. After 10 wrong passwords, that address is locked for 15 minutes. An `API_KEY` in `.env` also works as a Bearer token if you set one; it always acts as the oldest member account and stops working if that account isn't active. The super admin has no API access.

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
| `GET` | `/api/v1/senders` | Mailboxes and usage in the last 24 hours (campaign, warm-up and test emails) |

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
lib/warmup/         mailbox warm-up: daily plan, sending, receiving side, email texts, status numbers
lib/mail/           SMTP/IMAP connection, email building, reply and bounce parsing
lib/db/schema.ts    database tables (Drizzle ORM); migrations in drizzle/
lib/brand.ts        app name
public/sw.js        service worker: offline page and push notifications
scripts/            db-sync (generate + apply migrations), migrate, cron runner, key generator
```
