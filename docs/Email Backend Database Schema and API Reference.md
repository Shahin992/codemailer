# ColdMailer: Database Schema and API Reference

Oct 16, 2026 · @Orangetoolz

This is the companion to the ColdMailer plan. The source of truth is the code:

- the tables are in `lib/db/schema.ts`;
- the SQL migrations are in `drizzle/`, generated and applied automatically on `docker compose up --build`.

This page summarises both. The older, larger design is in `docs/archive/`.

## Tables

| Table | Holds |
| --- | --- |
| `users` | Accounts: name, email, scrypt password hash, `role` (`member`, or `superadmin`: approves accounts at `/superadmin`, has no workspace), `status` (`pending` until the super admin approves a sign-up, `active`, `disabled`). Anyone can sign up; nobody can sign in before approval. Each account is a private workspace: `senders`, `recipients`, `campaigns`, `messages`, `replies`, `suppressions` and `settings` all carry the owning account's `user_id`, and every page, action and API call only sees that account's rows. |
| `senders` | Mailboxes. Holds: provider (hostinger, gmail, custom); SMTP server, port, encryption (`ssl`, `starttls`, `none`) and username; whether the inbox is read (`read_inbox`) and the IMAP server, port, encryption and username; for send-only mailboxes, the mailbox that receives replies (`reply_to_sender_id`); encrypted password (AES-256-GCM); daily limit; next turn (`next_send_at`); `rest_until` (no sending at all until then, set by a “limit exceeded” or “too many” error); status and last error; Sent/Spam folder names; inbox positions (`imap_state`); warm-up: on/off (`warmup_enabled`), role (`warmup_role`: `sender` sends and replies; `partner`, e.g. the user's own Gmail accounts, only receives at most `warmup_receive_max` new warm-up emails a day and replies, and never sends campaigns), day 1 of the ramp (`warmup_started_at`, moved forward by the time warm-up was off; `warmup_paused_at`), the local date already planned (`warmup_planned_on`), and the per-mailbox numbers `warmup_start`, `warmup_increase`, `warmup_max`, `warmup_reply_rate`. |
| `recipients` | Everyone the account ever emailed (unique per account): email, name, status (active, replied, bounced, unsubscribed), the mailbox that owns them (`sender_id`), first and last contact |
| `campaigns` | Subject, body (text or HTML), send window and timezone, weekdays only, tracking switches, follow-up link, status (draft while a large list is still uploading, active, paused, done, cancelled), creator |
| `campaign_senders` | The mailboxes chosen for each campaign |
| `messages` | One email to one person. `queued` rows are the send queue. Holds merge fields, the final subject, the email's own `Message-ID`, status (queued, sending, sent, bounced, replied, failed, cancelled), `scheduled_at` (a send time someone chose; empty = automatic), attempts, errors, send/bounce/reply times, open and click counts. |
| `replies` | Replies matched to a sent email: sender, subject, full text and HTML, the reply without quoted history, attachments, auto-reply flag, read state |
| `warmup_messages` | Warm-up emails between one account's own mailboxes (migration `0013`), kept apart from `messages`/`replies` so they never reach campaign stats, Replies, recipients, push notifications or the do-not-send list. Holds the sending and receiving mailbox (`sender_id`, `to_sender_id`), the email it answers (`parent_id`) and its thread (`thread_id`, `topic`), subject and text (written when sent), the `Message-ID` (saved before sending; the receiving inbox check recognises warm-up emails by it), status (scheduled, sending, sent, failed, cancelled), `scheduled_at`, attempts, errors, `sent_at`, and the receiving side's findings: `received_at`, `landed_in` (inbox or spam) and `rescued_at` (moved out of spam). |
| `tracking_links` | Original URLs behind tracked links |
| `suppressions` | Each account's do-not-send list (bounced, unsubscribed, manual) |
| `push_subscriptions` | Browsers and phones that get reply notifications, per user, with delivery health: last sent (push service accepted), last received (the device confirmed), last error |
| `settings` | One row per account: footer text, opt-out line, default send window and timezone, test address, and the email logo (file path in `STORAGE_DIR`, type, size, pixel size, width in emails, whether personal-style emails use it) |
| `jobs` | Cron job locks and last-run results, shown in Settings |

## Picking the next mailbox

Only one send run happens at a time; it holds a lock row in `jobs`. The run picks the mailbox that has waited longest among the campaign's active mailboxes, using the same rolling 24-hour count Hostinger uses:

```sql
SELECT s.* FROM senders s
JOIN campaign_senders cs ON cs.sender_id = s.id AND cs.campaign_id = $1
WHERE s.status = 'active'
  AND s.next_send_at <= now()
  AND (SELECT count(*) FROM messages m
       WHERE m.sender_id = s.id AND m.sent_at > now() - interval '24 hours')
    + (SELECT count(*) FROM warmup_messages w
       WHERE w.sender_id = s.id AND w.sent_at > now() - interval '24 hours')
    + (SELECT count(*) FROM test_sends t
       WHERE t.sender_id = s.id AND t.sent_at > now() - interval '24 hours') < s.daily_limit
ORDER BY s.next_send_at;
```

The daily limit covers campaign, warm-up and test emails together (`sentLast24h` in `lib/queries.ts`).

After each send, the mailbox's `next_send_at` moves forward by the send window divided by its daily limit (±15%, at least 2 minutes). It never moves backwards. People already tied to a mailbox wait for that mailbox's turn.

### Emails with a set time

A `queued` email with `scheduled_at` is skipped by the automatic picking above. Once `scheduled_at` has passed, it goes out on the next run, before any automatic email of its campaign:

- **Ignored:** the send window, weekdays-only and the mailbox's turn (`next_send_at`). Someone chose the time.
- **Still applied:**
  - a paused campaign or mailbox;
  - `rest_until`;
  - the rolling 24-hour daily limit.

  An email held back by any of these goes out as soon as it's allowed. The campaign page says why it's waiting.
- **Which mailbox:** the person's own mailbox if they have one, otherwise the campaign mailbox that has waited longest.

Set times come from the campaign form ("Set the times myself"), from the API (`send_at`, `schedule`), or from **Set time / Change time** on any waiting email. That control can also send an email now or hand it back to automatic timing.

## Warm-up

Code in `lib/warmup/`. The send job (every minute) runs warm-up first, then campaigns, so the shared daily limit is never overshot by two jobs at once.

- **Pool:** an account's mailboxes with `warmup_enabled`, status active and an inbox that's read (IMAP). Never across accounts.
- **Plan (once a day per sending mailbox, on the account's clock):** `warmup_start + warmup_increase × (day − 1)`, capped at `warmup_max`, new emails at random times inside the account's send window (Settings). Partners take at most `warmup_receive_max` new emails a day in total, shared fairly among the account's sending mailboxes (each gets about `ceil(partner room / sending mailboxes)`); the rest goes to the other sending mailboxes. Partners never start threads. Turned on part-way through a day, only the rest of the day's share. Nothing is planned on weekends when the window is weekdays only.
- **Partners and campaigns:** partner mailboxes are left out of campaign mailbox choices (page and API) and the campaign send job; a campaign email addressed to one of the account's partner mailboxes is cancelled; a mailbox that any campaign uses can't become a partner.
- **Send:** due rows go out unless the mailbox is paused or resting, the window is closed (a new email is then dropped as missed; a reply waits for the window), the daily limit is reached (waits 20–60 minutes), or the mailbox sent something in the last 2 minutes. At most one warm-up email per mailbox per run. A partner that left the pool is swapped for another one.
- **Receive:** `processInbound` first looks up the email's `Message-ID` in `warmup_messages`. A match for this mailbox records `received_at` and `landed_in`, may plan a reply (at `warmup_reply_rate`, half that for an answer to a reply, at most 3 emails per thread, sent 15 minutes to 3 hours later, partners 20 minutes to 5 hours, inside the window), and the inbox check then marks it `\Seen` (a partner also stars about 20% and, on Gmail, labels about 25% `\Important`) and moves it from the spam folder (Gmail: `[Gmail]/Spam`) to INBOX (`rescued_at`). The mailbox page counts placement at Gmail mailboxes separately. Moves that fail are retried by `Message-ID` search for 3 days. A match for another mailbox or account is ignored. A bounce notice about a warm-up email marks it failed.

## Authentication (JWT)

| Used for | Where the JWT lives | Audience | Lifetime |
| --- | --- | --- | --- |
| Dashboard login | httpOnly cookie `es_session` | `coldmailer:web` | 30 days |
| API (`/api/v1/*`) | `Authorization: Bearer <token>` header | `coldmailer:api` | 1–90 days |

- Both are HS256, issuer `coldmailer`, signed with `AUTH_SECRET`, with the user's id as `sub`.
- Because the audiences differ, a login cookie can't be used as an API token or the other way round.
- Every request checks that the user still exists and is active, so disabling an account stops its tokens at once.
- API tokens come from `POST /api/v1/auth/token` with an email and password.
- 10 failed password attempts lock that address for 15 minutes.
- Each token only sees its own account's workspace.
- The optional `API_KEY` from `.env` is still accepted as a Bearer token. It always acts as the oldest member account, and is refused if that account isn't active.
- The super admin account gets no API token: the token endpoint answers as for a wrong password.

## Routes

The dashboard uses Server Actions and a few signed-in routes. The public routes are below.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/token` | Email + password | Returns a JWT access token |
| `POST` | `/api/v1/campaigns` | JWT | Create a campaign from a recipients array |
| `GET` | `/api/v1/campaigns/{id}` | JWT | Progress counts |
| `GET` | `/api/v1/campaigns/{id}/messages` | JWT | The campaign's emails with status, mailbox, `scheduled_at` and send times |
| `GET` | `/api/v1/recipients/lookup?email=` | JWT | One person's full history |
| `GET` | `/api/v1/replies?since=` | JWT | New replies |
| `GET` | `/api/v1/senders` | JWT | Mailboxes and usage in the last 24 hours (campaign, warm-up and test emails) |
| `POST` | `/api/cron/send` | `CRON_SECRET` | Send due emails (every minute) |
| `POST` | `/api/cron/inbox` | `CRON_SECRET` | Read inboxes and spam folders for bounces and replies (every 5 minutes; new inbox mail is also picked up within seconds by the IMAP IDLE watcher in the app) |
| `POST` | `/api/campaigns`, `/api/campaigns/test`, `/api/sheets` | Signed in | Create a campaign, send a test, import a Google Sheet. With `"draft": true` the campaign holds the first part of a large list and doesn't send yet |
| `POST` | `/api/campaigns/{id}/recipients` | Signed in | The next part of a draft campaign's list (`{"recipients": [...], "done": false}`, at most 10,000 per part); `"done": true` with the last part starts it. People already in the campaign are skipped, so resending a part is harmless |
| `GET` / `POST` / `DELETE` | `/api/settings/logo` | Signed in | The email logo: show it, upload a new one (multipart field `logo`; PNG, JPG or GIF, up to 1 MB), remove it |
| `POST` | `/api/push/subscription` | Signed in | The service worker re-registers a renewed push subscription |
| `POST` | `/api/push/received` | Subscription endpoint | The service worker confirms a notification arrived (shown per device in Settings) |
| `GET` | `/t/o/{token}.gif`, `/t/c/{token}/{link_id}` | Signed token | Open pixel, click redirect |
| `GET` / `POST` | `/u/{token}`, `/api/unsubscribe/{token}` | Signed token | Unsubscribe page, one-click unsubscribe |

Mailboxes are added only in the dashboard, so passwords never pass through the API.

### Create campaign request

`recipients` can be plain email strings, or objects with a name and extra fields:

```json
{
  "name": "Dental clinics October",
  "recipients": [
    "info@another.com",
    {"email": "dr.smith@example.com", "name": "Dr. Smith", "vars": {"clinic": "Smile Dental"}}
  ],
  "senders": ["support@yourdomain.com", "contact@yourdomain.com"],
  "subject": "Quick question about {{clinic|your clinic}}",
  "body_text": "Hi {{first_name|there}}, ...",
  "track_opens": false,
  "track_clicks": false,
  "send_window": {"start": "09:00", "end": "17:00", "timezone": "America/New_York", "weekdays_only": true}
}
```

**Set send times (optional).** Without them, emails are spaced out automatically inside `send_window`. With them, each email goes out at its time, inside the window or not; daily limits still apply.

- `send_at` on a recipient object: that person's time, as an ISO 8601 date-time with an offset, e.g. `"2026-10-20T09:30:00+06:00"`.
- `schedule`: `{"start_at": "2026-10-20T09:30:00+06:00", "every_minutes": 10}`. The first email goes at `start_at`, then one every `every_minutes`, in list order. A recipient's own `send_at` wins over it.
  - For a follow-up (`follow_up_of`), the order is the order the first emails were sent.
- Times may be in the past (they go out at once) but at most a year ahead.

```json
{
  "recipients": [
    {"email": "dr.smith@example.com", "send_at": "2026-10-20T09:30:00+06:00"},
    "info@another.com"
  ],
  "schedule": {"start_at": "2026-10-20T10:00:00+06:00", "every_minutes": 15}
}
```

Here Dr. Smith's email goes at 09:30. `info@another.com` is second in the list, so it goes at 10:15.

Response `201 Created`:

```json
{
  "campaign_id": "6c1f…",
  "accepted": 2,
  "duplicates": 0,
  "rejected": [{"email": "bad@", "reason": "invalid"}],
  "estimated_days": 1
}
```

Rejection reasons are `invalid` and `do_not_send`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL, used in tracking and unsubscribe links |
| `ADMIN_EMAIL` | Optional: contact address for push notifications when `VAPID_SUBJECT` is empty (no longer affects sign-up) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database (Docker builds `DATABASE_URL` from these) |
| `DATABASE_URL` | Database connection when running without Docker |
| `APP_PORT`, `ADMINER_PORT` | Ports on the host (Docker) |
| `AUTH_SECRET` | Signs login and API JWTs |
| `ENCRYPTION_KEY` | 32-byte key that encrypts mailbox passwords |
| `TRACKING_SECRET` | Signs tracking and unsubscribe tokens |
| `CRON_SECRET` | Protects `/api/cron/*` |
| `API_KEY` | Optional shared Bearer key for `/api/v1/*`, acting as the oldest member account (JWTs are the usual way) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notifications. `VAPID_SUBJECT` must be a real `mailto:` address (Apple refuses `localhost` ones) |
| `INBOX_WATCH` | Optional: `off` turns off the instant (IMAP IDLE) reply check |
