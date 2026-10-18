# Deploy ColdMailer to Oracle Cloud (free)

This guide puts ColdMailer on a free Oracle Cloud server at **https://coldmailer.edufusionbd.online**, with automatic HTTPS and nightly backups. It takes about an hour, most of it waiting for Oracle and the first build.

You need:

- an Oracle Cloud account (sign-up asks for a card, but the server below stays free);
- access to hPanel for `edufusionbd.online`;
- this project on your laptop, including `deploy/server.env` (already created with fresh secrets).

Commands marked **laptop** run on your computer; **server** commands run after you've logged in to the server with `ssh`.

## 1. Create the server

1. Sign up at oracle.com/cloud/free.
   - Pick a home region close to you, such as Singapore or Mumbai. You can't change it later.
   - Free ARM capacity is sometimes short in busy regions.
2. Go to **Compute → Instances → Create instance**:
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Ampere `VM.Standard.A1.Flex` with **2 OCPUs and 12 GB memory**. It's marked "Always Free eligible".
   - **Networking:** keep "Assign a public IPv4 address" on.
   - **SSH keys:** choose "Generate a key pair" and **download the private key**. You can't download it again later.
   - **Boot volume:** the default (about 50 GB) is fine.
3. Click **Create**. If you see "Out of capacity", try another availability domain or try again later.
4. When it says *Running*, copy the **Public IP address**. Below it's called `SERVER_IP`.

**Recommended: stop Oracle from reclaiming the server.**
- Oracle may reclaim Always Free servers that look idle, and ColdMailer is idle most of the time.
- To avoid that, upgrade the account to *Pay As You Go*: Billing → Upgrade. It stays free as long as you only use Always Free resources.
- Add a budget alert of, for example, $1 under Billing → Budgets, so you'd hear about any charge.

## 2. Open ports 80 and 443

HTTPS needs two openings: one in Oracle's network settings, and one on the server itself.

**Oracle network:**
1. Open the instance, then click its **Subnet** and then the **Default Security List**.
2. Click **Add Ingress Rules** and add two rules:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`;
   - the same again with destination port `443`.

**On the server** (do this after step 4 below; Oracle's Ubuntu image blocks these ports internally too):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Point the subdomain at the server

1. In hPanel, open **Domains → edufusionbd.online → DNS / Nameservers**.
2. Add a record:
   - **Type:** `A`
   - **Name:** `coldmailer`
   - **Points to:** your `SERVER_IP`
   - **TTL:** 300 (or the default)
3. Save. If the domain's nameservers aren't Hostinger's, add the same record wherever its DNS is managed.

Check it from your **laptop**. It's ready when this prints your `SERVER_IP` (usually within minutes):

```bash
getent hosts coldmailer.edufusionbd.online
```

## 4. Log in and install Docker

On your **laptop**, protect the key you downloaded, then log in:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
```

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@SERVER_IP
```

On the **server**, run the port commands from step 2, then install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker ubuntu
```

Log out (`exit`) and back in, so Docker works without `sudo`.

## 5. Copy ColdMailer to the server

Before copying, open `deploy/server.env` on your laptop and fill in:

- `ADMIN_EMAIL`: optional contact for push notifications (the super admin, created by the database migration, approves all sign-ups);
- `VAPID_SUBJECT`: `mailto:` followed by your email.

Then from your **laptop**, copy the project. This skips build output and your local data:

```bash
rsync -az --exclude node_modules --exclude .next --exclude .env --exclude storage --exclude backups -e "ssh -i $HOME/Downloads/ssh-key-XXXX.key" "/home/orangetoolz/OTZ Project/Email-services/" ubuntu@SERVER_IP:coldmailer/
```

(Replace `ssh-key-XXXX.key` with your key's file name.)

On the **server**, turn the server settings into the app's `.env`:

```bash
cd ~/coldmailer && cp deploy/server.env .env && chmod 600 .env
```

## 6. Start it

On the **server**:

```bash
cd ~/coldmailer && docker compose up -d --build
```

The first build takes about 5 minutes. Then:

- `migrate` creates the tables;
- `app` and `cron` start;
- **Caddy** gets the HTTPS certificate.

Check that everything is up:

```bash
docker compose ps
```

```bash
docker compose logs caddy --tail 20
```

When Caddy's log shows `certificate obtained successfully`, open **https://coldmailer.edufusionbd.online**:

1. Create your account. It becomes the admin.
2. Add your mailboxes again. Nothing from your laptop's test setup is copied over.
3. In Settings:
   - set the footer address;
   - set the send window and timezone (for example `Asia/Dhaka`);
   - turn on notifications on your phone. On iPhone, add the app to the Home Screen first.
4. Send a test campaign to yourself, and click its unsubscribe link from your phone to confirm the public address works.

## 7. Nightly backups

On the **server**, open the scheduler:

```bash
crontab -e
```

Add this line. It backs up the database every night at 03:00 server time and keeps the newest 14:

```
0 3 * * * cd /home/ubuntu/coldmailer && sh scripts/backup.sh >> backups/backup.log 2>&1
```

Backups on the same server don't help if the server is lost. Now and then, copy them to your **laptop**:

```bash
rsync -az -e "ssh -i $HOME/Downloads/ssh-key-XXXX.key" ubuntu@SERVER_IP:coldmailer/backups/ "$HOME/coldmailer-backups/"
```

To restore a backup, see the comment at the top of `scripts/backup.sh`.

## Everyday tasks

**Update after code changes:** run the same `rsync` command from step 5, then on the **server**:

```bash
cd ~/coldmailer && docker compose up -d --build
```

Database changes apply automatically: new migration files appear in `drizzle/` on the server.

**View logs** on the **server**:

```bash
docker compose logs -f app cron
```

**Open Adminer** (the database browser): it only listens on the server itself. Reach it through an SSH tunnel from your **laptop**:

```bash
ssh -i ~/Downloads/ssh-key-XXXX.key -L 8080:127.0.0.1:8080 ubuntu@SERVER_IP
```

While that runs, open http://localhost:8080 and sign in with:
- System: PostgreSQL
- Server: `db`
- User: `email`
- Password: `POSTGRES_PASSWORD` from `.env`
- Database: `email_sender`

## If something goes wrong

| Problem | Likely cause |
| --- | --- |
| The site doesn't load, or Caddy can't get a certificate | DNS doesn't point at `SERVER_IP` yet (check with `getent hosts`), or port 80/443 is closed in the Security List or by `iptables` (step 2) |
| "Out of capacity" when creating the server | Free ARM servers are busy in that region; try another availability domain or later |
| Mailbox test says "timed out" | Make sure the mailbox uses port 465 or 587 (port 25 is blocked on Oracle) |
| The server disappeared or stopped | It was reclaimed as idle; upgrade to Pay As You Go (step 1) |
| Settings → Background jobs says "not running" | Run `docker compose ps` and check that `cron` is up; restart it with `docker compose restart cron` |

Never change `ENCRYPTION_KEY` in `.env` once mailboxes are added; their saved passwords would become unreadable. Changing `AUTH_SECRET` signs everyone out and cancels all API tokens.
