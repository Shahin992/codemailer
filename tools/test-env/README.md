# Local test kit

Throwaway servers for testing ColdMailer end to end without real mailboxes. No Docker or `sudo` needed. Nothing here is used in production.

| Server | Address | Notes |
| --- | --- | --- |
| PostgreSQL (embedded) | `127.0.0.1:54329`, user/password `email`/`email`, database `email_sender` | Data kept in `pgdata/` |
| SMTP sink | `127.0.0.1:2525`, no encryption | Accepts any login except the password `wrong-password`. Rejects recipients starting with `reject-` (550 5.1.1). Saves every email to `outbox/NNNN.eml`. |
| IMAP mock (hoodiecrow) | `127.0.0.1:1143`, no encryption | One shared mailbox with Sent and Junk folders. Logins: `support@acme.test`, `contact@acme.test`, `sales.acme@gmail-test.test`, password `test-app-password`. Its contents reset when it restarts. |

## Use it

```bash
cd tools/test-env && npm install && node services.mjs
```

In another terminal, from the project root, create the settings (once):

```bash
cp tools/test-env/test.env.example tools/test-env/test.env
```

```bash
npm run keys
```

Paste the printed secrets into `tools/test-env/test.env`. Then create the tables and start the app on port 3100:

```bash
set -a && . tools/test-env/test.env && set +a && npm run db:sync && npx next dev -p 3100
```

Then in the app:

- **Add a mailbox:** choose "Any SMTP server" with
  - SMTP `127.0.0.1` port `2525`, encryption **None**;
  - IMAP `127.0.0.1` port `1143`, encryption **None**;
  - email `support@acme.test`, password `test-app-password`.
- **Run the jobs by hand** instead of waiting for cron:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3100/api/cron/send
```

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3100/api/cron/inbox
```

- **Simulate a reply or bounce:** APPEND a raw email to INBOX over IMAP (e.g. with `imapflow` from the project's `node_modules`). Set `In-Reply-To` to the `Message-ID` of an email in `outbox/`. For a bounce, send a `multipart/report; report-type=delivery-status` message from `MAILER-DAEMON@…`.

The IMAP mock forgets its messages on restart but keeps the same UIDVALIDITY. If replies stop being picked up after a restart, rewind the mailbox position:

```sql
update senders set imap_state = '{}' where email = 'support@acme.test';
```

Then re-add or re-test the mailbox.
