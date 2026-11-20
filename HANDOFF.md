# ColdMailer: handoff notes

Last updated: Nov 19, 2026 (mailbox warm-up; before that, Oct 18: open sign-ups with a private workspace per account and super admin approval; before that instant reply check and phone push diagnostics, timezones, phone layout, 50 MB CSV uploads in parts, slimmer Settings; before that reply notifications, set send times, AWS EC2 guide). Read this first in the next session.

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

- **Live since Oct 23** on AWS EC2 (`52.64.104.27`, app in `~/coldmailer`) at **https://coldmailer.shahinkhan.online**. Production has migrations `0000`–`0012`; the user reset the production database on Nov 19. Parts of this file below were written before deploying.
- **Nov 20 (later): Warm-up has its own menu** (display and navigation only; warm-up itself unchanged; not deployed yet). Asked for by the user: a Warm-up menu listing the warm-up mailboxes, each opening to full details and its conversations, with the mailbox's own emails clearly told apart from the other mailbox's.
  - **Menu:** "Warm-up" (flame icon) after Mailboxes in the sidebar and in the phone tab bar (now 5 tabs + More, labels 10.5 px).
  - **`/warmup`:** account numbers (inbox score over 7 days, sent today with what's still to go, in spam, last warm-up email), then **Business mailboxes** (day, ramp bar "6 of 30 a day", sent/received today, spam and problem tags, inbox score ring), **Partners** (got/replied today, how much of your mail reached their inbox) and a **Warm-up off** list that opens a mailbox's Settings tab to turn it on.
  - **Inbox score** (after Instantly's health score and lemwarm's score): of a mailbox's warm-up emails the other side found in the last 7 days, the share not in spam; for a partner, the share of emails it got that weren't in its spam. 90+ Good, 75–89 Fair, below Needs care. `inboxScore()` and the per-mailbox numbers (`warmupOverview()`) and per-day numbers (`warmupDaily()`) are new read-only queries in `lib/warmup/status.ts`.
  - **`/warmup/[id]`** with tabs **Overview** (alerts with links, score ring and advice: about day 14 and over 90% before campaigns, ramp progress, today strip, a 14-day stacked bar chart inbox/spam/not found you can tap per day, where the emails landed, latest 5 conversations) · **Emails** (the full conversation list: search, filters, paging) · **Settings** (the on/off switch and the warm-up numbers, same actions as before).
  - **Mine vs theirs:** in lists the latest email reads "You: …" (blue) or "Mark: …", and "You started it" / "Mark started it"; in a conversation a header shows "You" and the other mailbox side by side with how many emails each wrote, your emails have a blue edge and "You", the other mailbox's show its name and "Received", and the placement says "their inbox / their spam" for yours and "your inbox / your spam" for theirs.
  - **Moved:** the warm-up pages now live under `app/(app)/warmup/`; the mailbox page lost its Warm-up tab and has a Warm-up link card instead. Old addresses redirect: `/mailboxes/[id]?tab=warmup` → `/warmup/[id]`, `/mailboxes/[id]/warmup` → its Emails tab, `/mailboxes/[id]/warmup/[threadId]` → `/warmup/[id]/[threadId]`. `setWarmup`/`saveWarmupSettings` also refresh `/warmup` pages.
- **Nov 20: Replies and Campaigns redesigned after cold-email tools** (design only; not deployed yet). Patterns taken from Instantly's Unibox, Smartlead's master inbox and lemlist's campaign report:
  - **Replies list** is an inbox: avatar with unread dot, bold sender and time when unread, subject, two-line preview, campaign tag, "reply 2 of 3", "via mailbox".
  - **Reply page** is an email thread: subject and tags on top, your campaign email first (filled in for this person from the campaign text and the message's merge fields, display only, folded), then every reply from the person folded to a line with the opened one unfolded (attachments inside), and a Reply (mailto) / History / Mark unread bar fixed above the phone tabs.
  - **Campaigns list:** each campaign shows Sent with progress, Replied and Bounced with their rates as three columns, plus waiting/failed tags.
  - **Campaign page:** actions in an even grid on phones, a results card (Sent, Reply rate, Bounce rate, Opened/clicked or Waiting), a Schedule card (next/last email, days left, window, mailboxes, started), recipients with avatars and a "Read reply" chip.
  - `Avatar` moved to `components/ui.tsx` (the warm-up pages re-export it).
- **Nov 19 (later): app-wide redesign, phone first** (design and flow only; no feature changed; not deployed yet). The user found the UI unprofessional and missed loading and saving feedback.
  - **Shared building blocks** (`components/ui.tsx`, `app/globals.css`): new palette and soft shadows (light and dark), rounder cards, 44 px buttons and fields on phones with focus rings, alerts with icons, status badges with a dot, compact page headers (title and button share a row on phones), plus `Skeleton`, `SectionTabs` and `DetailList`.
  - **Frame** (`components/app-shell.tsx`): slimmer phone top bar with an account button, bottom tabs with an active pill and a spinner on the tapped tab, a bottom sheet for More/account, refined sidebar. A thin loading bar runs across the top during any page change (`components/nav-progress.tsx`).
  - **Loading screens:** a `loading.tsx` with page-shaped placeholders (`components/skeletons.tsx`) for every signed-in page.
  - **Save feedback:** `components/toast.tsx`. Every form result also pops up at the top of the screen (green or red) via `ActionResult`, as do redirects (`FlashToast`: mailbox saved, campaign started) and Pause/Resume.
  - **Flow:** the mailbox page is split into **Overview · Warm-up · Settings** tabs (`?tab=`); the edit form lives under Settings and saving returns to Overview with the result. Action buttons sit in one row; search boxes have an icon; filter chips scroll sideways on phones; the notification prompt is one slim line.
  - **Warm-up conversation** reads like an email thread (Gmail-style): earlier emails folded to a line, the latest open, quoted text behind "•••", "Email details" with Message-ID.
  - **Bottom spacing:** `.safe-bottom`/`.safe-top` *replace* an element's padding with the iPhone safe area (0 elsewhere), which had left the phone menu's "Sign out" on the screen edge and removed padding on the sign-in, unsubscribe and super admin pages; those now use `pb-[calc(env(safe-area-inset-bottom)+…)]`.
  - **`devIndicators: false`** in `next.config.ts` hides the Next.js "N" badge in the local dev app (it covered the phone menu). Its "Insight" pill (the Next.js security upgrade notice) still shows in dev only.
  - **Checked** with phone screenshots (390×844, headless Chrome) of every page, in light and dark, plus the computer layout; no server errors; `npm run build` passes.
- **Nov 19: mailbox warm-up** (not deployed yet; `npm run build` passes; checked end to end with the test kit). Migration **`0013`** must reach the server: deploying (`docker compose up -d --build`) backs up the database and applies it.
  - **Why:** the user has 6 new Hostinger business mailboxes (3 domains/subdomains, 2 mailboxes each) and wants them to warm each other up.
  - **Switch** per mailbox (Warm-up menu → the mailbox → Settings tab; was mailbox page → Warm-up until Nov 20). The pool is that account's mailboxes with warm-up on; never across accounts. Needs a mailbox whose inbox is read (IMAP).
  - **Ramp:** day 1 = 2 new emails, +2 a day, up to 30 (day 15); reply rate 35%. All four editable per mailbox. New emails at random times inside the account's send window (Settings), planned once a day on the account's clock; weekends skipped when the window is weekdays only.
  - **Threads:** replies 15 min – 3 h after the email is found, `Re:` + `In-Reply-To`/`References`, the earlier email quoted; at most 3 emails per thread.
  - **Texts (rewritten Nov 19 after the user asked for more emails and proper replies):** 20 scenarios in `lib/warmup/content.ts`, each with its own subjects, wordings, replies and closings. The scenario and the words picked (day, document…) are stored in `warmup_messages.topic` (`call-request?day=Tuesday&thing=slides`), so replies reuse exactly the same details; scenarios without closings ("thank you", reminders) end after the reply. Checked by generating thousands of threads: no unfilled gaps, no repeated "Thanks"/sign-off, about 99% unique bodies. Warm-up emails already planned keep working: text is written when an email is sent; a topic from before the rewrite falls back to generic replies.
  - **Warm-up history pages (Nov 19; moved to `/warmup/[id]?tab=conversations` and `/warmup/[id]/[threadId]` on Nov 20):** `/mailboxes/[id]/warmup` lists a mailbox's warm-up conversations (all-time tiles, search, filters incl. "Waiting to send", paged) and `/mailboxes/[id]/warmup/[threadId]` shows one as a chat with where each email landed. Queries in `lib/warmup/history.ts`; shared avatar and placement pill in `app/(app)/mailboxes/[id]/warmup/parts.tsx`. A conversation only opens through a mailbox that is part of it (404 otherwise). The Warm-up card's numbers are tiles now, and its recent emails link to their conversations.
  - **Partner set-up warnings (Nov 19):** the user's first live Gmail (mark42722752@gmail.com) was added as a Business mailbox named "Gmail"; it was fixed to Partner and "Mark". The mailbox page now warns when a Gmail account isn't a Partner, or when the sender name is empty or a word like "Gmail".
  - **Ramp counts sending days:** with "weekdays only", weekends don't count as warm-up days (Thu 1, Fri 2, Mon 3). Before this fix Monday would have been day 5.
  - **Receiving side:** recognised by `Message-ID` (stored before sending; no visible marker), marked read, moved out of spam back to INBOX; how often a mailbox's emails land in spam is the health signal.
  - **Kept apart:** own table `warmup_messages`, so warm-up never reaches Replies, push, campaign numbers, recipients or the do-not-send list. Warm-up sends count toward the daily limit with campaign and test emails (`sentLast24h`).
  - **Status view** (since Nov 20 in the Warm-up menu; before on the mailbox page): day, today's goal, sent today, received, replies, landed in spam / moved back, not found yet, recent warm-up emails, plus a badge on the Mailboxes list.
  - **Partner mailboxes:** the user also has **10 Gmail accounts** they can sign in to (and other Gmail addresses they can't; nothing sends warm-up mail to those). Per mailbox, *Takes part as* → **Partner**: it only receives (at most `warmup_receive_max`, default 3, new warm-up emails a day, shared fairly among the business mailboxes) and replies 20 min – 5 h later; it never starts threads, now and then stars or marks important (Gmail label), moves warm-up mail out of `[Gmail]/Spam`. Partners are kept out of campaigns (not offered as senders, refused by the API, skipped by the send job, and a campaign email to a partner address is cancelled); a mailbox a campaign uses can't become a partner.
  - **Gmail placement:** each business mailbox's page shows "In Gmail spam, 7 days" (its emails that Gmail partners found in spam, and how many were moved back) apart from spam at the other mailboxes.
  - **After an independent code review (Nov 19), fixed:**
    - a paused mailbox plans no replies and drops waiting ones;
    - replies planned more than 4 days ago and new emails more than 3 hours past their time are dropped, so a stopped server or a disabled account doesn't send yesterday's emails on top of today's;
    - new emails hit by a provider limit are dropped, not moved to the next day;
    - partner slots that don't divide evenly rotate between business mailboxes (random planning order each day);
    - a retry reuses the first try's Message-ID and text;
    - out-of-office replies to warm-up emails, plain mail from the account's own warm-up mailboxes, and bounces about them never reach Replies, push or the do-not-send list;
    - planned times are kept only when the send job also counts them as inside the window (overnight window with weekdays only);
    - the spam-folder retry never searches with an empty Message-ID.
  - **Automated test:** `tools/test-env/warmup-e2e.mjs` runs the real jobs against the test kit and checks 54 things (see the test kit README). It passed 3 full runs in a row on Nov 19, and again after the text rewrite.
  - **Limit, told to the user:** warm-up only between mailboxes on one provider never reaches Gmail/Outlook; the Gmail partners are what fixes that for Gmail.
  - **Next.js notice:** the first `npm run build` run by an AI agent stops with a Next.js message that 16.4.1 has a known security advisory and suggests `next upgrade`. A second run passes. Not upgraded: the user's decision.

- **ColdMailer is built and running locally** in Docker at http://localhost:3000: Postgres, the app, the cron runner and Adminer.
- **You (the user) are testing it** with a real Gmail account and a Hostinger business mailbox (`support@edufusionbd.online`).
- **Not deployed yet.**
  - Oracle Cloud sign-up was **refused** ("an error occurred while creating your account") after the card was verified.
  - **AWS EC2** guide written Oct 16: [`docs/Deploy to AWS EC2.md`](docs/Deploy%20to%20AWS%20EC2.md) (t3.micro + Elastic IP). The user's AWS account is on the **Free plan**: $100 credit plus $20 per Explore AWS activity. The setup uses about $15/month of credits. The plan ends after 6 months or when the credits run out; then the account closes unless upgraded to the Paid plan (90-day grace period).
  - Alternative: **Google Cloud's free e2-micro**, [`docs/Deploy to Google Cloud.md`](docs/Deploy%20to%20Google%20Cloud.md).
  - Fallback: a Hostinger VPS (KVM 1, about $5–7/month).
- **Docker build re-checked Oct 16:** images build cleanly (Next.js compile, TypeScript and 15 pages, no warnings); the stack starts; `migrate` reports "Database is up to date"; pages, 401s on API/cron without credentials, and security headers OK; the Caddyfile validates for the real domain. The running stack uses about 200 MB of RAM.
- **Oct 18 (later): super admin approves every sign-up** (`npm run build` passes; checked with the test kit; migrations applied to the local Docker database, see below):
  - **Super admin:** a third kind of account, `role = 'superadmin'`, seeded by migration `0011` as `shahin.khan.dev@gmail.com`. Only its scrypt hash is in the migration; the starting password was given by the user in chat, and the user changes it by hand in the panel's "Change your password" form after the first sign-in (no forced change, by the user's choice). It signs in at **`/superadmin/login`** and only sees **`/superadmin`**: accounts waiting / active / disabled, with Approve, Reject (deletes a sign-up), Disable, Enable and Delete (disabled accounts, with their whole workspace), plus its own password change. It has no workspace and no API access. Member pages send it to `/superadmin`.
  - **No role leaks:** the member sign-in, the super admin sign-in and `POST /api/v1/auth/token` each give the other kind of account exactly the wrong-password answer (same message, delay and lockout counting), so no page reveals which address is the super admin.
  - **Sign-up:** every new account is `pending` and can't sign in or use the API until approved. After signing up, a "Waiting for approval" popup says so; signing in before approval says the account is waiting. `ADMIN_EMAIL` no longer affects sign-up (only the push contact fallback).
  - **Old admins** become ordinary members (migration `0011`); account management lives only in the super admin panel (Settings has no Accounts card any more).
  - **`API_KEY`** acts as the oldest member account and is refused if it isn't active.
  - **Password fields** all have a show/hide eye button (`PasswordInput` in `components/client.tsx`); Edge's own reveal button is hidden so there is only one.
  - **Migration `0010` changed before release:** it no longer activates `pending` accounts; the super admin approves them.
  - **Deploying is only `docker compose up -d --build`** (the user runs no other commands on the server). A new one-shot `backup` service (`postgres:17-alpine`, `scripts/pre-start-backup.sh`) saves the whole database to `./backups/auto-before-start-<time>.sql.gz` on every start and keeps the newest 10; `migrate` waits for it and doesn't run if the backup fails. Checked on the local Docker stack.
  - **Local Docker database migrated Oct 18:** a manual backup first (`backups/before-superadmin-20261018-113711.sql.gz`), then `0008`–`0011`. Row counts in every table are unchanged; every mailbox, campaign, email, reply and settings row now belongs to `shahin@gmail.com` (still active, now a member); the super admin was added. A second `up` applied `0012` (column gone) after another automatic backup; counts still match (1 mailbox, 1 campaign, 2 emails, 1 reply).
  - **Production:** the server starts with an empty database, so `0011` creates the super admin there too. Sign in at `/superadmin/login` right after deploying and change the password in the panel; then register your own working account at `/register` and approve it in the panel.
- **Oct 18: open sign-ups, private workspaces** (checked with the test kit):
  - **Why:** new users couldn't get in. Every sign-up after the first was saved as `pending` and refused at sign-in until an admin approved it, and all accounts shared one workspace, so approval was the only thing keeping strangers away from the mailboxes.
  - **Now:** each account only sees its own mailboxes, campaigns, recipients, replies, do-not-send list, settings (footer, logo, send window) and reply notifications. The same person can be a recipient in two accounts.
  - **Mailboxes** are unique per account, like recipients. Two accounts can connect the same address; each row has its own daily limit. Unique across all accounts was tried and dropped: anyone can point a "custom" mailbox at their own SMTP server, so it let an account claim someone else's address and find out which addresses were in use.
  - **Disable** (super admin) stops sign-in, API tokens and that account's campaigns (the send job skips them). **Delete** removes a disabled account and its whole workspace.
  - **API:** a JWT only sees its own account.
  - **Replies:** a reply quoting another account's email is ignored, even when both accounts read the same inbox (tested with the same mailbox in two accounts).
  - **Shared devices:** signing out removes that device's push subscription and clears the app-icon badge, so the next person doesn't get the previous account's reply notifications. Renewing a subscription only removes the caller's own old row.
  - **Logo files** live in `STORAGE_DIR/brand/<account id>/`, so accounts never share a file. Older logos stay at `brand/logo-<hash>.<ext>` and keep working.
  - **Forms** submitted by JavaScript now have `method="post"`. Before, a submit before the page finished loading fell back to GET and put the fields (including passwords) in the URL and the server log; this was seen on the sign-in page.
  - **Isolation checks:** an independent code audit of every page, action and route found no cross-account read. A sweep as a second account (69 requests: every page, `/api/v1`, direct links to the admin's records, searches and write attempts) returned none of the admin's data.
  - **Migration `0010`** gives all existing data to the first admin (on the local Docker database: `shahin@gmail.com`). It took about 10 s on the test kit's 300,000 emails.
  - **Not built:** email verification (anyone can register any address), a sign-up rate limit or "close sign-ups" switch, and limits on where custom SMTP/IMAP hosts and push endpoints may point (a signed-in user can make the server connect to any host and see part of its reply).
- **Oct 17 changes (not yet in the local Docker images or on a server; `npm run build` passes):**
  - **Phone push:** the user reported desktop Chrome gets reply notifications but the phone PWA gets **none**. Cause not yet known. Added: the app re-registers the device's push subscription every time it opens (`components/push-sync.tsx`), a `pushsubscriptionchange` handler in `sw.js`, and per-device delivery health in Settings → Reply notifications (sent / arrived / refused, from migration `0008`). Next step: open the app on the phone, press "Send test", and read that phone's line.
  - **Instant reply check:** `lib/jobs/inbox-watch.ts` (started by `instrumentation.ts`) keeps an IMAP IDLE connection per active mailbox; new inbox mail is checked within about 3 seconds (verified with the test kit). Cron's 5-minute check stays as the safety net and still covers the spam folder.
  - **Timezones:** a full timezone dropdown (`components/timezone-select.tsx`, list from `lib/timezones.ts`) in Settings and New campaign. The campaign timezone now drives the send window **and** set times ("9:00 in Arizona" = 16:00 UTC); campaign pages and the time editor show times in the campaign's timezone.
  - **Settings:** Background jobs and API sections removed (the API token button is gone; `POST /api/v1/auth/token` still issues tokens).
  - **CSV:** up to 50 MB / 200,000 people. Lists over 5,000 go up in parts (`/api/campaigns/{id}/recipients`) while the campaign is a `draft`. The proxy only buffers 10 MB of a request body, which is why one big request failed.
  - **Phone layout:** no page scrolls sideways at 375 px with very long emails, subjects and links (checked all 13 pages).
  - **Email logo:** Settings → Email footer and logo takes a PNG/JPG/GIF up to 1 MB (`/api/settings/logo`, `lib/brand-logo.ts`), checked by content, saved as `STORAGE_DIR/brand/logo-<hash>.<ext>` (migration `0009`). It's embedded in each email as an inline `cid:` image above the footer text; personal-style emails then carry a simple HTML part too (switch "Also in personal-style emails"). Tested with the test kit: upload, refusals (SVG, fake PNG, over 1 MB), replace, remove, test emails and a real send-job email. `scripts/backup.sh` now also backs up `STORAGE_DIR`.
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
| Warm-up | Per-mailbox switch. The account's warm-up mailboxes email each other daily (ramp 2 → 30, editable), reply in the same thread, mark warm-up mail read and move it out of spam. Status per mailbox: day, sent today, replies, landed in spam / moved back. Shares the daily limit with campaigns. |
| Recipients | Paged list with search and status filter. Per-person timeline: which mailbox, when, what happened. |
| Accounts | Anyone can register, but the super admin (`/superadmin`, seeded by migration `0011`) must approve each account before it can sign in. Each member account is a private workspace (every owned table has `user_id`). Login with JWT. The app always opens on the sign-in page; registering never signs you in, it shows a "waiting for approval" popup. Password change, show/hide on password fields, rate-limited logins (10 failures → 15-minute lock). |
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
lib/warmup/             warm-up: job.ts (daily plan + sending, run by the send job), inbound.ts (receiving side),
                        content.ts (email texts), schedule.ts (ramp/timing maths), status.ts (numbers for the pages),
                        history.ts (conversation list and thread for the history pages)
lib/timezones.ts        timezone dropdown options; lib/time-window.ts has the zone-aware time conversions
lib/mail/               connection (SMTP/IMAP), compose (personal/newsletter), inbound (replies, bounces, opt-outs), errors, dns
lib/queue-eta.ts        expected-send-time simulation
lib/queries.ts          the 24-hour sent count (see the comment there: why "senders"."id" is written out)
lib/db/schema.ts        all tables
drizzle/                migrations 0000–0013 (+ meta)
scripts/                db-sync.sh, migrate.mjs, cron.mjs, generate-keys.mjs, backup.sh
deploy/                 Caddyfile, server.env (server secrets; private, not in git or images)
tools/test-env/         throwaway Postgres/SMTP/IMAP servers for testing (see its README)
docs/                   plan, schema/API reference, Deploy to AWS EC2 / Google Cloud / Oracle Cloud, archive/
public/                 sw.js (push + offline), offline.html, icons/, brand/
```

## 5. Database and migrations

- **Tables:** `users`, `senders`, `recipients`, `campaigns`, `campaign_senders`, `messages`, `replies`, `warmup_messages`, `tracking_links`, `suppressions`, `test_sends`, `push_subscriptions`, `settings`, `jobs`.
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
  | `0009` | Email logo in `settings` (file, type, size, pixel size, display width, use in personal emails) |
  | `0010` | Private workspaces: `user_id` on `senders`, `recipients`, `campaigns`, `messages`, `replies`, `suppressions` and `settings` (now keyed by `user_id`); mailboxes, recipients and the do-not-send list are unique per account. Hand-edited to give existing rows to the first admin. |
  | `0011` | Super admin: sign-ups default to `pending`, old `admin` roles become `member`, and the super admin `shahin.khan.dev@gmail.com` is inserted (scrypt hash only). Hand-edited. |
  | `0012` | Drops `users.must_change_password` where an earlier draft of `0011` added it (the local Docker and test databases); does nothing elsewhere. |
  | `0013` | Mailbox warm-up: `warmup_*` columns on `senders` (including `warmup_role` and `warmup_receive_max` for partner mailboxes) and the `warmup_messages` table. Generated, not hand-edited. Applied to the test kit database Nov 19 (an earlier draft without the partner columns was undone there first); not yet to production or the local Docker database. |

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

- **Accounts:** register, login; JWT issue and every rejection case; rate limiting.
- **Private workspaces (Oct 18, test kit):**
  - **Sign-up:** a second account registers through the page, signs in at once and sees an empty workspace.
  - **Isolation:** the admin's campaign, reply, mailbox, recipient and attachment links return 404 for it, both on pages and in `/api/v1`.
  - **No borrowing:** it can't send from the admin's mailbox or follow up the admin's campaign.
  - **Separate lists:** the admin's do-not-send list doesn't block it, and its unsubscribe lands only on its own list.
  - **Its own settings:** its emails use its own footer.
  - **Replies:** a reply to its email goes only to it, even though both mailboxes read the same test inbox (picked up by the instant watcher).
  - **Disable:** a disabled account's campaign sends nothing until it's enabled again.
  - **Migration:** `0010` ran on the test database (1 admin, 200,005 recipients, 300,006 emails).
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

- **Mailbox warm-up (Nov 19, test kit):** the test kit now has three warm-up mailboxes plus a Gmail-like partner (`dana@gmail-test.test`: `[Gmail]/Spam`, Gmail labels) with their own IMAP servers, and its SMTP sink delivers to them (every 3rd email per mailbox into the spam folder). Checked:
  - **Switch and form:** on/off from the page ("waiting for a partner" with one mailbox), settings saved and validated.
  - **Plan:** 2 emails per mailbox on day 1, each to a different partner, at random times inside the 09:00–17:00 New York window; nothing outside it (a due email with the window closed was dropped as missed).
  - **Send:** plain text, natural, subject and body about the same thing; one per mailbox per run; 2 minutes between sends.
  - **Receive:** found within ~2 s by the instant watcher, marked read on the server; replies planned at the reply rate, sent with correct `In-Reply-To`/`References` and `Re:`; reply-backs; no 4th email in a thread.
  - **Spam rescue:** two replies that landed in Junk were moved to INBOX, marked read and counted; the moved copies weren't processed twice.
  - **Kept apart:** no `replies`, `recipients`, `suppressions` or `messages` rows from warm-up; a warm-up bounce marked the warm-up email failed without touching the do-not-send list; the same mailbox connected in a second account ignored the warm-up mail.
  - **Daily limit:** at the limit a warm-up email waits; `/api/v1/senders` counts warm-up sends.
  - **Turn off:** waiting emails cancelled; an email planned to that mailbox went to another partner.
  - **Maths:** ramp 2…30, day count on the account's clock, weekends, overnight and all-day windows, resume keeps the ramp day.
  - **Partners:** role set from the page; Test connection found `[Gmail]/Spam`; with 3 business mailboxes and a partner limit of 3, each sent exactly 1 to the partner and the partner started none; the email that landed in `[Gmail]/Spam` was moved to INBOX, read, labelled Important; partner replies 1–4 h later, threaded; "In Gmail spam: 1 of 1, 1 moved back" on that business mailbox's page; partner left out of the new-campaign page, refused by the API, dropped from a mixed sender list, a campaign email to its address cancelled; a mailbox used by a campaign refused as partner. Starring wasn't seen (random, 20%); it uses the same flag call as marking read.
  - **Pages:** mailbox page and list at desktop and 375 px (no sideways scroll); `npm run build` passes.

**Not verified yet:**

- **Warm-up with real mailboxes:** real Hostinger IMAP (spam folder name, `MOVE`), real Gmail partners (app password, `[Gmail]/Spam`, labels), and the week-long ramp over real days.

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
- **Warm-up:**
  - mailboxes on one provider only warm up with each other (Gmail/Outlook never see that mail);
  - texts are in English;
  - a mailbox without a spam folder (none found at Test connection) can't move warm-up mail out of spam;
  - expected campaign send times don't include warm-up emails still to come today, so they can run a little early;
  - changing start/increase/maximum applies from the next day's plan.
- **Gmail tabs:** placement can't be guaranteed. The Personal style removes the bulk-mail signals; a personal sender address (not `support@`), few links and engagement help further.

## 11. Next steps, in order

0. **Warm-up (Nov 19):** deploy it (copy the project to the server, `docker compose up -d --build`; the automatic backup runs first, then migration `0013`). Then turn on warm-up for the 6 Hostinger mailboxes, check their daily limits leave room (warm-up at its maximum sends about 30 new emails plus replies a day), add the 10 Gmail accounts as partners (2-Step Verification, app password, IMAP on), and watch "Your emails in Gmail spam" on each business mailbox in the Warm-up menu.

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
