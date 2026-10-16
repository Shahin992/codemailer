# ColdMailer Plan: Simple Next.js Sender

Oct 15, 2026 · @Orangetoolz

## What it does

One Next.js app, with the dashboard and backend together, that does five things:

1. **Takes a list of recipient emails.** You paste them, upload a CSV, or paste a Google Sheets link in the dashboard, or send them through the API.
2. **Sends them through your few mailboxes.** These are your Hostinger mailboxes on your domain, any Gmail accounts you add, or any other SMTP server. Send-only servers route replies to a mailbox ColdMailer reads. Every day, each mailbox sends up to its own daily limit until the list is done.
3. **Records each email's status:** sent, bounced or replied, plus opened and clicked if you switch tracking on.
4. **Reads each mailbox's inbox** and saves the replies, linked to the original email and the mailbox that sent it.
5. **Shows any recipient's history:** which mailbox emailed them, when, and what happened.

There is no Redis, no separate backend and no third-party sending service: just Next.js, a PostgreSQL database and your mailboxes.

## Mailboxes

| Mailbox | Send (SMTP) | Read (IMAP) | Login |
| --- | --- | --- | --- |
| Hostinger | `smtp.hostinger.com`, port 465, SSL | `imap.hostinger.com`, port 993, SSL | Full email address + mailbox password |
| Gmail (optional) | `smtp.gmail.com`, port 465, SSL | `imap.gmail.com`, port 993, SSL | App password (needs 2-Step Verification) |

### Connecting a mailbox

**Hostinger mailbox (business): once per mailbox, in hPanel**

1. Go to Emails → your domain → Mailboxes. Create the mailbox (for example `support@yourdomain.com`), or use an existing one, and note its password.
2. Check that the domain's email DNS records (MX, SPF, DKIM) show as connected. Hostinger adds them automatically when the domain's DNS is at Hostinger.
3. Note the plan's sending limit (View limits).

Hostinger's two-factor login protects only webmail, not SMTP and IMAP, so the normal mailbox password works in the app.

**Gmail account: once per account, signed in to that account**

1. Turn on 2-Step Verification (Google Account → Security). It needs a phone.
2. Open `myaccount.google.com/apppasswords`, create an app password named "Email System", and copy the 16-character code. Google shows it only once.
3. Nothing else is needed. IMAP is always on in Gmail now.

Changing the Google password cancels all of that account's app passwords. The app then pauses the mailbox with "Login failed" until you add a new app password. The App passwords page does not appear for accounts that use only security keys or Advanced Protection.

The app uses app passwords rather than a "Sign in with Google" button. That button needs a Google Cloud app that Google must review before it can access Gmail; app passwords need none of that.

**In the app (the same for both)**

1. Go to Mailboxes → Add mailbox and choose **Hostinger** or **Gmail**. The server settings fill in automatically.
2. Enter:
   - the email address;
   - the password (Hostinger) or app password (Gmail);
   - the sender name people will see (for example "YourBrand Support");
   - the daily limit.
3. Click **Test connection**. The app:
   - logs in to SMTP and IMAP;
   - finds the Sent folder;
   - marks where the inbox is now, so only mail that arrives after this point is read (old mail is never touched);
   - sends a test email to your address.
4. If the test passes, the mailbox becomes **Active** and joins the turns. If it fails, the exact error is shown (wrong password, blocked port, limit reached) and the mailbox stays off.
5. The password is encrypted before it is saved. It is never shown again in the dashboard.

| | Hostinger | Gmail |
| --- | --- | --- |
| Copy of each sent email in the Sent folder | The app saves it over IMAP, so it shows in webmail | Gmail saves it automatically |
| "From" address | The mailbox's address, with any sender name | Always the Gmail address itself |
| Bounce notices come from | Hostinger's mail server (`MAILER-DAEMON`) | "Mail Delivery Subsystem" |
| If the password changes | Edit the mailbox, enter the new password, test, resume | Create a new app password, then the same steps |

### Daily limit per mailbox

Hostinger's own sending limits are per mailbox, counted over a rolling 24 hours ([Hostinger](https://www.hostinger.com/support/4625828-how-to-create-and-manage-hostinger-email/)):

| Hostinger email plan | Hostinger's limit per mailbox per day |
| --- | --- |
| Free email included with hosting | 100 |
| Business Starter | 1,000 |
| Business Standard / Premium | 3,000 |

You can check your plan's exact limit in hPanel under Emails → Mailboxes → View limits.

Hostinger's limit is not a safe outreach number. A new mailbox sending hundreds of emails a day to people who don't know you lands in spam quickly. Each mailbox therefore gets its own **daily limit** in the dashboard:

| Mailbox | Start at | Raise by | Stop at |
| --- | --- | --- | --- |
| Hostinger | 20 a day | 10 a week | about 50 a day |
| Gmail | 10 a day | 5 a week | about 20 a day |

Example: 5 Hostinger mailboxes at 30 a day send 150 emails a day, so a list of 1,000 takes about 7 sending days.

## How sending works

- **Every day, inside a send window** (for example 9:00 to 17:00 in the recipients' timezone, weekdays only), the app works through the queue.
- **Mailboxes take turns.** Email 1 goes from mailbox A, email 2 from mailbox B, email 3 from mailbox C, and then back to A. A mailbox that has reached its daily limit is skipped until tomorrow.
- **Sends are spaced out.** Each mailbox's daily limit is spread across the window, varied by ±15% so the timing doesn't look mechanical. At 30 a day over 8 hours, a mailbox sends about once every 16 minutes.
- **Leftovers wait.** When every mailbox has reached its limit, the rest of the list waits until the next day's window.
- **The same person always gets the same mailbox.** A follow-up goes from the mailbox that sent the first email, as a reply in the same thread (`Re:` subject and `In-Reply-To` header). People who replied, bounced or unsubscribed are skipped.
- **Problem mailboxes pause.** A mailbox with a login failure or a "limit exceeded" error pauses itself and shows a warning in the dashboard. The other mailboxes keep sending.
- **No one is emailed twice by mistake.** Duplicates are removed when a list is added, and anyone on the do-not-send list (bounced or unsubscribed) is dropped.

### How it runs inside Next.js

Next.js has no built-in background worker, so the server's cron calls two protected routes:

| Route | Runs | Does |
| --- | --- | --- |
| `/api/cron/send` | Every minute | Sends the emails that are due, one mailbox turn at a time |
| `/api/cron/inbox` | Every 5 minutes | Reads each mailbox's new mail for bounces and replies |

Each route takes a database lock, so two runs never overlap. The daily limit is counted as emails sent in the last 24 hours, which matches Hostinger's own rolling count, so no midnight reset is needed.

## What gets tracked

| Status | Meaning |
| --- | --- |
| `queued` | Waiting for its turn |
| `sent` | Your mail server accepted it |
| `bounced` | A bounce notice came back (bad address, full mailbox) |
| `replied` | The recipient answered |
| `failed` | Could not be sent after 3 tries |
| `cancelled` | You stopped the campaign before it went out |

Mail sent through your own mailboxes gives no true "delivered" signal. An email that is `sent` and has no bounce after 3 days is treated as delivered.

- **Bounces:** Hostinger and Gmail send bounce notices back to the sending mailbox. The inbox check reads them, finds the failed address, marks the email `bounced`, and adds the address to the do-not-send list.
- **Replies:** the inbox check matches each reply to the original email by its `Message-ID` header (or, failing that, by the sender's address). It saves the reply and shows it on the Replies page. Other mail in the inbox is ignored and never stored.
- **Shared inboxes (`support@`, `contact@`):** the app only reads. Unread mail stays unread, and nothing is moved or deleted, so your team's inbox is unchanged.
- **Opens and clicks (optional, per campaign):**
  - A tiny image counts opens, and links pass through your app to count clicks.
  - Apple Mail loads images automatically, so open counts run high. Both features also slightly raise the chance of landing in spam.
  - Leave them off unless you need them; replies are the better signal.
- **Unsubscribe:** every email gets an unsubscribe link and header. Anyone who clicks it is never emailed again.

## Dashboard pages

| Page | What it does |
| --- | --- |
| Login / Register | Email and password accounts. The first account is the admin; later sign-ups wait for an admin's approval |
| Dashboard | Sent today compared with total daily capacity, new replies, bounce count, warnings for paused mailboxes |
| Mailboxes | Add a mailbox, test the connection, set the daily limit, see today's count, pause or resume |
| New campaign | Details below |
| Campaigns | Each campaign's progress; open one to see every recipient with the mailbox used, status and reply; pause, resume or cancel |
| Replies | All replies, newest first, with unread marks; open the full thread |
| Recipient lookup | Type an email address and see every email sent to it, from which mailbox, and what happened |
| Do-not-send list | Bounced and unsubscribed addresses; add more by hand |
| Settings | Send window, timezone, footer address, test address, team approvals (admins), password change, background job status, API example |

On the New campaign page you:

- paste emails, upload a CSV, or paste a Google Sheets link shared as "anyone with the link can view" (extra columns such as `name` become `{{name}}` fields; up to 200,000 per campaign);
- write the subject and body;
- pick which mailboxes to use (all of them by default);
- choose whether this is a follow-up to an earlier campaign;
- see how many days the list will take;
- send a test to yourself, then start.

## Tech stack

| Part | Choice |
| --- | --- |
| App | Next.js (App Router) + TypeScript |
| Database | PostgreSQL with Drizzle ORM; migrations generated by drizzle-kit |
| Sending | Nodemailer |
| Reading inboxes | ImapFlow + mailparser |
| UI | Tailwind CSS + shadcn/ui |
| Login | Own email and password accounts (scrypt hashes, signed session cookie) |

Mailbox passwords are stored encrypted (AES-256-GCM). The key is kept in an environment variable, not in the database.

## Hosting

Everything runs with **Docker Compose**: `db` (PostgreSQL), `migrate`, `app`, `cron` and `adminer`. On every `docker compose up --build`, the `migrate` service runs before the app:

1. It writes a new migration into `drizzle/` if `lib/db/schema.ts` changed.
2. It applies all pending migrations.
3. Only then do `app` and `cron` start.

So there is no manual migration step. `drizzle/` is mounted from the project folder so the migration history is kept. Adminer listens on 127.0.0.1 only. See the README for the commands.

Use a small **Hostinger VPS** (KVM 1 or KVM 2, about $5 to $10 a month). You already use Hostinger, and its VPS allows outgoing mail. It runs the Next.js app, PostgreSQL and the two cron jobs. Shared web hosting is not a good fit, because the app needs a job every minute and a Node.js server that is always running.

Crontab on the VPS, with `CRON_SECRET` defined at the top:

```
* * * * *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/send
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/inbox
```

## Before the first real send

- [ ] SPF, DKIM and DMARC are set for your domain. Hostinger adds SPF and DKIM when the domain's DNS is at Hostinger; add a DMARC record (`p=none` to start). Check with mail-tester.com.
- [ ] The email footer has your postal address and an unsubscribe line.
- [ ] Daily limits start low (see the table above).
- [ ] The recipient list is checked with a list cleaner (ZeroBounce, NeverBounce), so bounces stay under 2%.
- [ ] You know the risk: if `support@` and `contact@` are on your main domain, spam reports from outreach can push your normal support email into spam too. Keep the limits low, or use a second domain for outreach.

## Build steps

About 2 to 3 weeks for one developer.

| Step | What gets built | Done when |
| --- | --- | --- |
| 1 | App, database and login; Mailboxes page with test connection; New campaign page; daily sending with turns and limits | Test emails go out from every mailbox and each one shows which mailbox sent it |
| 2 | Inbox check for bounces and replies; Replies page; Recipient lookup; unsubscribe and do-not-send list; follow-ups in the same thread | A test bounce and a test reply both show up linked to the right email |
| 3 | Dashboard numbers; optional open and click tracking; API; deploy on the VPS | The first real campaign runs for a few days with no errors |

## Questions left

- [ ] Which Hostinger email plan do you have (free with hosting, Business Starter or Premium), and how many mailboxes?
- [ ] Are you adding Gmail accounts too, or Hostinger mailboxes only?
- [ ] Will you add recipients in the dashboard only, or also through the API (for example from the MCP server)?
- [ ] Do you need open and click tracking, or are sent, bounced and replied enough?
- [ ] Is a Hostinger VPS OK for the server?
- [ ] What send window and timezone should the recipients get?
