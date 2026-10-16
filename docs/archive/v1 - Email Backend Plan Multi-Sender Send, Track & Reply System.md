# Email Backend Plan: Multi-Sender Send, Track & Reply System

Oct 15, 2026 · @Orangetoolz

## Overview

Build one backend service that accepts send jobs from the MCP server, spreads them round-robin across your 30 business and 1,500 normal mailboxes, and records every message's full lifecycle (queued, sent, delivered, bounced, replied) in your database. Target load is 2,000 to 5,000 emails per day, with each recipient permanently traceable to the mailbox that contacted them.

Core requirements:

- **Input:** the MCP server sends a recipients array, subject, HTML/text body, and a mail type (`business` or `normal`).
- **Sender rotation:** pick a sender at random from the matching pool, weighted by remaining daily capacity and health.
- **Status tracking:** store SMTP acceptance, delivery confirmations, hard/soft bounces, complaints, opens, and clicks per recipient.
- **Reply capture:** pull replies from every sender inbox, store them, and link each one to the original message, recipient, and sender.
- **Recipient-to-sender tracing:** answer "which mailbox emailed this person, when, and what happened" with one query.

One decision shapes everything below: mail sent through individual mailboxes over SMTP gives you bounces and replies, but no true "delivered" signal. A transactional provider (Amazon SES and similar) gives delivery webhooks but cannot send from personal Gmail accounts. The plan therefore supports two transport modes, covered in the sending pipeline section.

## Architecture

&#91;embedded content: system architecture · send path and return path\]

The top row is the send path: the MCP request is stored, queued per recipient, and sent by workers through a rotated mailbox or SES. Bounces, delivery events, and replies come back through the ingestion workers, so every status and reply lands next to the original message in PostgreSQL.

## Sender pool and rotation

Your pool of 30 business and 1,500 normal mailboxes carries 5,000 emails a day at only about 3 to 4 emails per mailbox, so the job is spreading load evenly and slowly, not finding capacity. The rotator is a time-based round-robin: after each send, a mailbox goes to the back of its pool's line and cannot send again until its cooldown ends.

**Business mailboxes: Primeforge.** Primeforge provisions real Google Workspace and Microsoft 365 mailboxes configured for cold outreach, with SPF, DKIM, and DMARC set up automatically ([Postmake](https://postmake.io/tools/primeforge)), and sells them pre-warmed ([Salesforge](https://salesforge.ai/blog/prewarmed-email-accounts-providers)). Because they are standard Workspace or M365 accounts, the backend connects to them exactly like any Google or Microsoft mailbox: Gmail API with Pub/Sub push or Microsoft Graph with change notifications (OAuth), with IMAP/SMTP as a fallback. Store them as `provider = primeforge_google` or `primeforge_m365` so health stats can be compared by provider. No published per-mailbox daily send limit was found, so this plan caps each Primeforge mailbox at 30 a day (40 hard ceiling); confirm the recommended limit with Primeforge support before launch.

**Capacity plan**

| Pool | Mailboxes | Daily cap per mailbox (after warm-up) | Pool capacity per day | Load at 2,000/day | Load at 5,000/day |
| --- | --- | --- | --- | --- | --- |
| Business (Primeforge) | 30 | 30 (hard ceiling 40) | 900 to 1,200 | 600 (20 each) | 900 (30 each) |
| Normal | 1,500 | 4 (hard ceiling 5) | 6,000 to 7,500 | 1,400 (about 1 each) | 4,100 (about 2.7 each) |
| Total | 1,530 |  | 6,900 to 8,700 | 2,000 | 5,000 |

The split assumes the MCP server sends a mix of both types; each request's `mail_type` decides its pool. A business-only load above about 900 a day is more than 30 mailboxes can carry safely, so each request carries an `overflow` setting: `next_day` (default, the rest stays queued for tomorrow) or `normal` (the remainder moves to the normal pool).

**How a sender is picked (round-robin with cooldown)**

Every email goes to the next mailbox in line, so no mailbox sends its daily quota in one burst: email 1 goes from mailbox 1, email 2 from mailbox 2, and after the last mailbox the circle starts again at mailbox 1. Each pool has its own circle.

Business pool (30 mailboxes, cap 30 each):

| Round | Emails | Senders used |
| --- | --- | --- |
| 1 | 1 to 30 | Mailbox 1, 2, 3 ... 30, one email each |
| 2 | 31 to 60 | Mailbox 1, 2, 3 ... 30 again |
| 3 | 61 to 90 | Mailbox 1, 2, 3 ... 30 again |
| ... | ... | ... |
| 30 | 871 to 900 | Mailbox 1 ... 30; each has now sent 30 and stops for the day |

Normal pool (1,500 mailboxes, cap 4 each), on a 5,000-email day:

| Round | Emails | Senders used |
| --- | --- | --- |
| 1 | 1 to 1,500 | Normal mailbox 1 ... 1,500, one email each |
| 2 | 1,501 to 3,000 | Normal mailbox 1 ... 1,500 again |
| 3 | 3,001 to 4,100 | Normal mailbox 1 ... 1,100 |

Each normal mailbox sends 2 or 3 emails that day, never more than 4.

Timing over a 10-hour send window:

| Pool | Emails per day | Pool sends one email every | Each mailbox sends once every | Time for one full round |
| --- | --- | --- | --- | --- |
| Business | 900 | about 40 seconds | about 20 minutes | about 20 minutes |
| Normal | 4,100 | about 9 seconds | about 3 to 4 hours | about 3.5 hours |

Rules that adjust the strict 1, 2, 3 order:

1. **Skip:** a mailbox that is paused, locked, or at its daily cap is skipped; the next email goes to the next mailbox in the circle.
2. **Cooldown:** a mailbox cannot send again until its rest time has passed (18 to 25 minutes for business, 2 to 4 hours for normal), so the circle never spins too fast on low-volume days. If no mailbox is ready, the job waits 60 seconds and tries again.
3. **Sticky sender for follow-ups:** a recipient who was emailed before always gets the same mailbox, so follow-ups stay in one thread and replies trace back cleanly. That email waits for its own mailbox's turn instead of taking the next one. If that mailbox is locked, the recipient is reassigned and the old sender is kept in history.
4. **Small random jitter:** a few random minutes are added to each cooldown so the pattern does not look mechanical to spam filters. Set jitter to zero if you want a strict fixed order.
5. **Atomic pick:** each pool's circle is a Redis sorted set (member = sender ID, score = next allowed send time). A Lua script takes the mailbox that has waited longest, checks its 24-hour count, increments it, and moves it to the back of the circle in one step, so parallel workers never pick the same mailbox or go over a cap.
6. **Spread limits:** at most 2 emails a day from one mailbox to the same recipient domain. If several business mailboxes share one domain, cap that domain's daily total too (for example 150 to 200).

The script that runs each pick:

```ts
// Pick the next sender for one pool. KEYS[1] = pool:normal or pool:business
// ARGV[1] = now (ms), ARGV[2] = cooldown + jitter (ms), computed in Node
const PICK_SENDER = `
local now = tonumber(ARGV[1])
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 20)
for _, id in ipairs(due) do
  local sent = tonumber(redis.call('GET', 'sent:' .. id) or '0')
  local cap  = tonumber(redis.call('HGET', 'caps', id) or '0')
  if sent < cap then
    local n = redis.call('INCR', 'sent:' .. id)
    if n == 1 then redis.call('EXPIRE', 'sent:' .. id, 86400) end
    redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), id)
    return id
  end
end
return false`;
```

**Warm-up schedule** (Primeforge mailboxes arrive pre-warmed, so they start higher; normal mailboxes start at 1 a day)

| Week | Business per mailbox per day | Normal per mailbox per day | Pool total per day |
| --- | --- | --- | --- |
| 1 | 15 | 1 | 1,950 |
| 2 | 25 | 2 | 3,750 |
| 3 | 30 | 3 | 5,400 |
| 4 onward | 30 | 4 | 6,900 |

You can reach 2,000 a day in week 2 and 5,000 a day in week 3 without pushing any single mailbox hard.

**Mailbox health and churn**

- A mailbox pauses itself on an auth failure, a Gmail daily-limit error (`550 5.4.5`), a rate-limit or unusual-activity response (`421 4.7.x`), or a 7-day bounce rate above 3%.
- Status flow: `active` to `cooling` (24 hours, automatic) to `paused` (needs review) to `locked` (needs a human: password reset or phone verification).
- Expect losses in the normal pool. Gmail and Outlook.com terms do not allow automated bulk messaging from consumer accounts, and many accounts logging in from one server IP trigger security checks, so some accounts will be locked over time. Track the `locked` count daily and alert above a threshold (for example 2% of the pool).

**Running 1,530 mailboxes**

- **Business (30):** pooled SMTP connections, and IMAP IDLE or Gmail/Graph push kept open for instant replies.
- **Normal (1,500):** no persistent connections. Open SMTP per send and close it. Poll inboxes in shards of about 100 per minute, so each mailbox is checked every 15 minutes, and every 2 minutes for 48 hours after it sends, when replies are most likely.
- **Auth:** free Gmail accounts need either an app password (2-Step Verification on each account) or OAuth through your own Google Cloud app, where Gmail scopes require Google's app verification beyond 100 users. Outlook.com no longer accepts password logins for SMTP/IMAP, so it needs OAuth.
- **Bulk onboarding:** import mailboxes from a CSV (email, provider, auth type, credential) through `POST /v1/senders/import`, run a test login on each, and mark failures before they enter rotation.

## Sending pipeline

The API never sends mail directly: it stores the request, splits it into one job per recipient, and returns immediately, while queue workers send at a controlled pace. At 5,000/day the average rate is about 3.5 emails per minute, so a single small server with a Redis-backed queue is enough.

Suggested stack: Node.js (NestJS or Express) + TypeScript, PostgreSQL, Redis + BullMQ for queues, Nodemailer for SMTP, ImapFlow + mailparser for inbound mail. Any language with equivalent libraries works.

Flow for one request:

1. **Intake:** MCP server calls `POST /v1/campaigns/send` with an API key. Validate emails, drop duplicates, and remove addresses on the suppression list (previous hard bounces, complaints, unsubscribes).
2. **Persist:** insert one `campaigns` row and one `messages` row per recipient with status `queued`. Use an `idempotency_key` from the MCP request so a retried call never sends twice.
3. **Enqueue:** push one BullMQ job per message, with a random delay so sends spread across the day or a chosen window.
4. **Assign sender:** the worker runs the rotation rules, records `sender_id` on the message, and reserves capacity.
5. **Build MIME:** generate your own `Message-ID` (for example `<uuid@sender-domain.com>`), add a `List-Unsubscribe` header, and store the ID before sending. Personalise merge fields if the MCP server sends them.
6. **Transmit:** send through the transport for that sender (see below). Save the SMTP response code and provider message ID; status becomes `sent`.
7. **Retry:** temporary failures (4xx, timeouts) retry with exponential backoff, up to 3 attempts, possibly on a different sender. Permanent 5xx responses mark the message `failed` or `bounced` right away.
8. **Save to Sent folder:** for SMTP mailboxes, append the message to the mailbox's Sent folder over IMAP so the human-visible mailbox matches your database. Gmail does this automatically.

Two transport modes:

| Mode | Used for | Delivery signal | Bounce signal | Reply capture |
| --- | --- | --- | --- | --- |
| A. Mailbox SMTP / provider API (Gmail API, Microsoft Graph, IMAP/SMTP hosts) | Normal and business mailboxes in the rotation pool | SMTP 250 accepted only | Bounce email (DSN) arrives in the sender inbox, parsed via IMAP | IMAP polling or provider push |
| B. Transactional provider (Amazon SES, Mailgun, Postmark, etc.) on your business domains | High volume from business domains | `Delivery` webhook per recipient | `Bounce` and `Complaint` webhooks | Inbound routing to a webhook, or replies go to a real mailbox via `Reply-To` |

Use OAuth (Gmail API, Microsoft Graph) for Google and Microsoft accounts where possible; both providers are phasing out password-based SMTP/IMAP access, and app passwords are a fallback only.

## Delivery and bounce tracking

Every status change is written as a row in `message_events` and the latest status is copied onto the `messages` row, so you keep the full history and still query current state fast.

| Status | Meaning | Set by |
| --- | --- | --- |
| `queued` | Accepted from MCP, waiting for a worker | API |
| `sent` | Receiving server accepted it (SMTP 250) | Worker |
| `delivered` | Provider confirmed delivery to the recipient's server | SES/ESP webhook (mode B only) |
| `deferred` | Temporary failure, will retry | Worker or webhook |
| `soft_bounced` | Mailbox full, server busy, greylisting | DSN parser or webhook |
| `hard_bounced` | Address or domain does not exist | DSN parser or webhook |
| `complained` | Recipient marked it as spam | ESP webhook or feedback loop |
| `replied` | A reply was matched to this message | Reply ingester |
| `failed` | Gave up after retries | Worker |

How each signal is captured:

- **Mode A (mailbox SMTP):** treat `sent` as "assumed delivered" unless a bounce arrives within 72 hours. A worker reads each sender inbox over IMAP, detects bounce messages (`Content-Type: multipart/report; report-type=delivery-status` or sender `MAILER-DAEMON` / `postmaster`), parses the DSN for `Status: 5.x.x` (hard) or `4.x.x` (soft), the failed recipient, and the original `Message-ID`, then updates that message. Gmail's synchronous rejections arrive as SMTP errors at send time and are handled by the worker.
- **Mode B (transactional provider):** subscribe to `Delivery`, `Bounce`, `Complaint`, and `Reject` events (Amazon SES via SNS to an HTTPS endpoint; Mailgun, Postmark, SendGrid via direct webhooks). Verify each webhook's signature, look the message up by provider message ID, and store the raw payload in `message_events.raw`.
- **Opens and clicks:** a tracking pixel and redirect links can add `opened` and `clicked` events, but Apple Mail Privacy Protection inflates opens and tracking links hurt inbox placement for outreach mail. Both are built in and switchable per campaign; see Open and click tracking below.

Suppression: a hard bounce or complaint inserts the address into `suppressions` immediately, and the intake step skips it on every future request. Three soft bounces in a row on one address are treated as a hard bounce.

Health: a nightly job computes each sender's 7-day bounce and complaint rate and lowers its `health_score`; above 3% bounces or 0.1% complaints the mailbox pauses itself.

## Open and click tracking

Opens are tracked with a 1x1 image and clicks with redirect links, both served by your backend and both switchable per campaign (`track_opens`, `track_clicks`). Opens and clicks are stored as events and counters; they never overwrite a message's status, so a message stays `delivered` or `replied` while its open count grows.

How it works:

1. **Token:** when building the MIME, the worker creates a token per message: the message ID signed with HMAC-SHA256, so nobody can forge or guess tracking URLs.
2. **Open pixel:** add `<img src="https://t.{tracking-domain}/o/{token}.gif" width="1" height="1" alt="">` at the end of the HTML body. The endpoint logs an `open` event and returns a 43-byte transparent GIF with `Cache-Control: no-store`.
3. **Click links:** rewrite every `href` in the HTML to `https://t.{tracking-domain}/c/{token}/{link_id}`, saving the original URL in `tracking_links`. The endpoint logs a `click` event and returns a `302` redirect to the original URL. Leave `mailto:` links and the unsubscribe link untouched.
4. **Counters:** the first open sets `first_opened_at`; every open increments `open_count`. Clicks do the same with `first_clicked_at` and `click_count`. A click with no recorded open also counts as an open, since images may have been blocked.
5. **Fast path:** the tracking endpoints only push the event to a Redis queue and respond in a few milliseconds; a worker writes to PostgreSQL in batches, so a burst of opens never slows the API.

Filtering machine opens and bot clicks (store them, but exclude them from reports):

| Source | What it does | How to flag it |
| --- | --- | --- |
| Apple Mail Privacy Protection | Loads every pixel when mail arrives, whether read or not | Apple proxy IP ranges or user agent; set `is_machine = true` |
| Gmail image proxy | Fetches the pixel through Google, then caches it, so repeat opens may not show | User agent contains `GoogleImageProxy`; count the first open, treat counts as minimums |
| Security scanners (Microsoft Safe Links, Mimecast, Barracuda, Proofpoint) | Click every link seconds after delivery to scan it | Click within 10 seconds of send, `HEAD` requests, all links clicked at once, known scanner IPs; set `is_bot = true` |
| Your own previews | Opening sent mail in the sender's mailbox | Ignore events from the sender mailbox's IP or a session flag |

Tracking domains: use your own tracking domain, not a shared one, and spread several (for example one per 5 to 10 business mailboxes, and a small rotating set for the normal pool) so one blocklisted domain does not hurt all 1,530 senders. Point `t.<domain>` by CNAME to the backend and serve HTTPS with automatic certificates (Caddy on-demand TLS or Let's Encrypt). Free Gmail senders have no domain of their own, so they share the rotating set.

Trade-offs: pixels and rewritten links slightly lower inbox placement for cold email, and a plain-text email cannot carry a pixel. Run A/B tests per campaign (tracking on vs off) and watch reply rate, which is the more reliable signal. Recipients in the EU and UK need consent before tracking pixels under ePrivacy rules; for them, set `track_opens = false`.

## Reply ingestion and recipient-to-sender tracing

Replies are matched by email headers first and by address second, so every reply links back to the exact message, recipient, and sender mailbox. Because you set your own `Message-ID` on every outgoing email, the recipient's mail client puts it into `In-Reply-To` and `References` when they reply.

Ingestion per sender mailbox:

- **Gmail / Google Workspace:** Gmail API `users.watch` with Google Pub/Sub push for near-instant notification, then `history.list` to fetch new messages. Fallback: IMAP polling every 2 to 5 minutes.
- **Microsoft 365 / Outlook:** Microsoft Graph change-notification subscriptions on the Inbox (renewed every few days), or IMAP polling.
- **Other business hosts (IMAP/SMTP):** ImapFlow with IMAP IDLE for push-style updates, or polling with a stored `UIDVALIDITY` + last `UID` cursor so nothing is read twice.
- **Transactional provider (mode B):** set `Reply-To` to a monitored mailbox, or use the provider's inbound routing (SES receipt rules, Mailgun Routes, Postmark Inbound) to POST replies to `/v1/webhooks/inbound`.

Matching order for each inbound email:

1. Parse it with mailparser and skip it if it is a bounce (handled by the DSN parser) or an auto-reply (`Auto-Submitted: auto-replied`, `X-Autoreply`, "Out of office" subjects). Store auto-replies with `is_auto_reply = true` rather than discarding them.
2. Match `In-Reply-To`, then each ID in `References`, against `messages.message_id_header`.
3. If no header match, match the `From` address to `recipients.email` plus the receiving mailbox to `senders.id`, taking the most recent message between them.
4. Save the reply in `replies` with the matched `message_id`, `recipient_id`, `sender_id`, `thread_id`, plain-text body, HTML body, a reply-only text (quoted history stripped), and attachments metadata (files themselves in S3-compatible storage).
5. Set the message and recipient status to `replied` and fire an outbound webhook or event so your app or the MCP server can react.

Tracing: the `recipient_sender_map` table holds one row per recipient with the first sender assigned, first and last contact time, and last status. That row drives the sticky-sender rule and answers "which mailbox goes to this recipient" in one lookup; the `messages` table keeps the full per-email history.

## Database schema and API

The full PostgreSQL schema (nine tables) and the REST API reference for the MCP server live in a separate doc: Email Backend: Database Schema and API Reference.

## Deliverability, security and compliance

At your top volume you reach Gmail's bulk-sender line, so build to its rules from day one: Google defines bulk senders as those sending more than 5,000 messages a day to Gmail addresses and requires authentication, one-click unsubscribe processed within two days, and a spam rate under its threshold ([Google](https://blog.google/products/gmail/gmail-security-authentication-spam-protection/)). Industry guidance puts that threshold at 0.3% as shown in Postmaster Tools, with 0.1% as the safe target ([9to5Google](https://9to5google.com/2023/10/03/gmail-spam-unsubscribe/)). Rotating across many mailboxes does not avoid these rules; Google counts volume by sending domain.

Deliverability checklist:

- [ ] SPF, DKIM, and DMARC (start at `p=none`, move to `quarantine`) on every sending domain; verify alignment with a test to mail-tester.com.
- [ ] Use separate secondary domains for outreach (for example `getyourbrand.com`) so a reputation problem never touches your main business domain.
- [ ] `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers on every commercial email, plus a visible unsubscribe line in the body.
- [ ] Verify recipient lists before sending (ZeroBounce, NeverBounce, or MillionVerifier) to keep hard bounces under 2%.
- [ ] Register domains in Google Postmaster Tools and Microsoft SNDS to watch reputation.
- [ ] Plain, personalised content: few links, no link shorteners, no attachments on first contact, text and HTML parts both present.
- [ ] Warm up every new mailbox and domain (see sender rotation).

Security:

- Encrypt mailbox passwords and OAuth refresh tokens at rest (AES-256-GCM) with the key in a secrets manager or environment variable, never in the database.
- Hash API keys; rate-limit the API; verify webhook signatures (SNS message signature, Mailgun/Postmark HMAC).
- Sanitise inbound HTML before showing it in any UI, and scan attachments.
- Keep raw inbound emails for a fixed period (for example 90 days) and delete after, to limit stored personal data.

Legal: US CAN-SPAM requires a real postal address, honest subject lines, and honouring opt-outs within 10 business days. Recipients in the EU or UK fall under GDPR/PECR, which is much stricter for unsolicited B2C email. The suppression table is your proof of compliance, so never delete from it. This is general information, not legal advice.

## Email provider costing

Sending cost itself is cheap; the mailbox pool is what costs money. At 5,000 emails a day (about 150,000 a month), Amazon SES costs about $15 a month, while a pool of 100 Google Workspace mailboxes costs about $700 a month. Figures below are list prices in USD as of October 2026, monthly, before tax; 2,000/day is taken as 60,000/month and 5,000/day as 150,000/month.

**Your current pool:** with 30 business and 1,500 normal mailboxes already owned, you need no new sending provider. The added monthly cost is the server, about $40 to $80 for 4 vCPU / 8 GB to handle 1,530 mailbox logins and inbox polls (approximate), on top of what the 30 business mailboxes already cost (30 Primeforge mailbox slots at $3.50 to $4.50 each, about $105 to $135 a month, plus their domains). Add Amazon SES, about $15 a month at 5,000/day, only if you later send to opted-in lists from your own domains. The tables below are for comparison or for growing the pool.

One rule decides which column you can use: transactional providers (SES, Postmark, Mailgun, Resend) only allow mail to people who opted in, and suspend accounts that send cold outreach or use bought lists. For cold outreach, budget the mailbox pool; for opted-in clients and leads, use a transactional provider.

**Transactional providers (mode B)**

| Provider | Pricing model | 2,000/day (60k/mo) | 5,000/day (150k/mo) | Delivery + bounce webhooks | Inbound replies |
| --- | --- | --- | --- | --- | --- |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) (à la carte) | $0.10 per 1,000 sent, $0.10 per 1,000 received | \~$6 | \~$15 | Yes (via SNS) | Yes, $0.10 per 1,000 |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) (Essentials plan) | $0.16 per 1,000, deliverability dashboard included | \~$10 | \~$24 | Yes | Yes |
| [Resend](https://wpmailsmtp.com/resend-review/) Pro | $20 for 50k, then $0.90 per 1,000 | \~$29 | \~$110 | Yes | Yes |
| [Mailgun](https://www.usecarly.com/blog/mailgun-pricing/) Foundation | $35 for 50k ($75 for 100k), then $1.30 / $1.10 per 1,000 | \~$48 | \~$130 | Yes | Yes (Routes) |
| [Postmark](https://automationatlas.io/answers/postmark-pricing-explained-2026/) Pro | $16.50 for 10k, then $1.30 per 1,000 | \~$82 | \~$199 | Yes | Yes |

New SES accounts are placed on the Essentials plan by default since July 21, 2026, and can switch to à la carte at any time. SES also charges $0.12 per GB of attachments, which is a few cents at this volume.

**Mailbox pool (mode A), cost per mailbox**

| Mailbox option | Price per mailbox | 40 mailboxes (\~2,000/day) | 100 mailboxes (\~5,000/day) | Notes |
| --- | --- | --- | --- | --- |
| [Zoho Mail Lite](https://www.capterra.in/reviews/174694/zoho-mail) | $1 (5 GB) to $1.25 (10 GB), annual billing | $40 to $50 | $100 to $125 | Cheapest; check Zoho's own daily outbound limits first |
| [Google Workspace Business Starter](https://www.cloudwards.net/google-workspace-plans-and-pricing/) | $7 annual / $8.40 monthly | $280 to $336 | $700 to $840 | Best inbox placement and Gmail API for replies |
| [Microsoft 365 Business Basic](https://bestructured.com/how-much-does-office-365-cost/) | $7 annual (raised from $6 on July 1, 2026) | $280 | $700 | Graph API for replies; Microsoft also enforces bulk-sender rules |
| Free Gmail / Outlook.com | $0 | $0 | $0 | Not recommended: automated volume gets accounts locked, and no custom domain |
| Primeforge (your business mailboxes) | $3.50 to $4.50, sold in slots (minimum 10) | $140 to $180 | $350 to $450 | Pre-warmed Workspace / M365 built for cold outreach; domains extra; confirm daily cap with Primeforge (\[pricing source\](https://warmforge.ai/blog/top-5-ai-inbox-placement-tools)) |

Add to the pool: sending domains (roughly 3 mailboxes per domain, about $10 to $15 per domain per year, so $25 to $45 a month for 34 domains, approximate) and optional list verification (SES validation is $0.01 per address checked).

**Total monthly estimate at 5,000/day**

| Setup | Sending | Domains | Server + DB + Redis | Total per month |
| --- | --- | --- | --- | --- |
| SES only (opted-in recipients) | \~$15 | \~$2 | \~$25 to $40 | \~$45 to $60 |
| Hybrid: SES for opted-in + 30 Workspace mailboxes for 1:1 outreach | \~$15 + $210 | \~$10 | \~$25 to $40 | \~$260 to $275 |
| Pool of 100 Zoho Mail Lite mailboxes | \~$100 to $125 | \~$35 | \~$25 to $40 | \~$160 to $200 |
| Pool of 100 Google Workspace mailboxes | \~$700 to $840 | \~$35 | \~$25 to $40 | \~$760 to $915 |

Server cost assumes one 2 vCPU / 4 GB VPS running the API, workers, PostgreSQL, and Redis (approximate; a managed database adds roughly $15 to $30). At 2,000/day, scale the pool rows by 0.4.

## Implementation roadmap

&#91;embedded content: implementation roadmap · 4 phases, 3 gates\]

One developer can build this in about eight weeks; each gate must pass before the next phase starts. Mailbox warm-up runs in parallel from week 3, so new senders reach full daily caps by launch and volume ramps from 2,000 to 5,000 a day over the following weeks.

Open questions:

- [ ] Which provider is "Prime Force", and what are its per-mailbox daily send limit and IMAP/OAuth access? Answered: it is Primeforge (Workspace / M365, OAuth or IMAP); daily cap still to confirm with Primeforge.
- [ ] Are recipients opted-in contacts or cold outreach? This decides SES versus the mailbox pool.
- [ ] Do you need open and click tracking, or are delivery, bounce, and reply enough? Answered: yes, added as its own section.
