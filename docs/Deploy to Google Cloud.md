# Deploy ColdMailer to Google Cloud (free e2-micro)

This guide puts ColdMailer on Google Cloud's Always Free server at **https://coldmailer.edufusionbd.online**, with automatic HTTPS and nightly backups.

The free server is small (1 GB RAM), so you'll add swap and the first build takes a while. Plan about an hour.

What stays free:

| Item | Free limit |
| --- | --- |
| Server | One **e2-micro** VM, only in **us-west1, us-central1 or us-east1** |
| Disk | Up to **30 GB "Standard persistent disk"** |
| Outgoing traffic | **1 GB a month** |

Anything else (another region, a bigger machine, a "Balanced" or SSD disk) is charged. The steps below avoid all of those.

Commands marked **laptop** run on your computer; **server** commands run in the server's SSH window.

## 1. Account, billing and a safety alert

1. Go to console.cloud.google.com, sign in with your Google account and **activate the free trial**. It asks for a card for verification.
2. A project named "My First Project" is created. You can rename it to `coldmailer`.
3. Go to **Billing → Budgets & alerts → Create budget**. Set the amount to **$1** and keep the email alerts on. You'll hear about any charge right away.

**Important:** the trial ($300 credit) ends after 90 days. When Google asks, click **Activate full account / Upgrade**. Otherwise Google stops the server when the trial ends. After upgrading, the e2-micro stays free within the limits above.

## 2. Create the server

Go to **Compute Engine → VM instances**. Click **Enable** if asked, then **Create instance**:

| Setting | Choose |
| --- | --- |
| Name | `coldmailer` |
| Region | **us-central1 (Iowa)**, or us-west1 / us-east1. Any other region is **not** free. |
| Machine | Series **E2**, type **e2-micro** |
| Boot disk (click **Change**) | **Ubuntu 24.04 LTS** (x86/64), disk type **Standard persistent disk** (not "Balanced"), size **30 GB** |
| Firewall | Tick **Allow HTTP traffic** and **Allow HTTPS traffic** |

Leave everything else as it is and click **Create**.

When it's running, copy its **External IP** from the list. Below it's called `SERVER_IP`.

**About the address:** the server keeps this IP across reboots. Google releases it only if you **stop** the server. If that ever happens, update the DNS record from step 3 with the new IP. Don't buy a "static" IP; you don't need one.

## 3. Point the subdomain at the server

The domain's DNS is managed at **Cloudflare** (its nameservers are Cloudflare's), so records added in hPanel have no effect.

1. Sign in at dash.cloudflare.com, open **edufusionbd.online**, then **DNS → Records → Add record**:
   - **Type:** `A`
   - **Name:** `coldmailer`
   - **IPv4 address:** `SERVER_IP`
   - **Proxy status:** **DNS only** (grey cloud), so Caddy can get its certificate
   - **TTL:** Auto
2. Save, then check from your **laptop**. It's ready when this prints `SERVER_IP`:

```bash
getent hosts coldmailer.edufusionbd.online
```

## 4. Open the server and prepare it

In the VM list, click **SSH** next to `coldmailer`. A terminal opens in your browser; that's the **server**. Run the following there.

**Add 4 GB of swap.** Without it, 1 GB of RAM isn't enough to build the app:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Install Docker:**

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Close the SSH window and open it again (**SSH** button), so Docker works without `sudo`.

## 5. Copy ColdMailer to the server

Before packing, open `deploy/server.env` on your laptop and fill in:

- `ADMIN_EMAIL`: the email you'll use for the first account;
- `VAPID_SUBJECT`: `mailto:` followed by your email.

**On your laptop,** pack the project, leaving out build output and local data:

```bash
tar czf ~/coldmailer.tgz --exclude=./node_modules --exclude=./.next --exclude=./storage --exclude=./backups --exclude=./.env -C "/home/orangetoolz/OTZ Project/Email-services" .
```

**In the SSH window,** click the **Upload file** button (top right, arrow-up icon) and choose `coldmailer.tgz` from your home folder. Then unpack it and create the app's settings:

```bash
mkdir -p ~/coldmailer && tar xzf ~/coldmailer.tgz -C ~/coldmailer && cd ~/coldmailer && cp deploy/server.env .env && chmod 600 .env
```

```bash
sed -i "s/^UID=.*/UID=$(id -u)/; s/^GID=.*/GID=$(id -g)/" .env
```

(The second command sets your server user's id, so database migration files can be written.)

## 6. Start it

On the **server**:

```bash
cd ~/coldmailer && docker compose up -d --build
```

On this small machine **the first build takes 15–30 minutes**. Leave the window open; if it disconnects, open SSH again and run the same command, and it continues. Then:

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
2. Add your mailboxes again. The server starts with a fresh database.
3. In Settings:
   - set the footer address and the opt-out line;
   - set the send window and timezone;
   - turn on notifications on your phone. On iPhone, add the app to the Home Screen first.
4. Send a test campaign to yourself, and open its link on your phone to confirm the public address works.

## 7. Nightly backups

On the **server**, open the scheduler:

```bash
crontab -e
```

Add this line. It backs up the database every night at 03:00 server time (UTC) and keeps the newest 14:

```
0 3 * * * cd $HOME/coldmailer && sh scripts/backup.sh >> backups/backup.log 2>&1
```

To keep a copy off the server, download a backup now and then through the SSH window: **Download file**, then enter a path such as `coldmailer/backups/coldmailer-YYYYMMDD-HHMMSS.sql.gz`.

## Everyday tasks

**Update after code changes:**
1. Make a new `coldmailer.tgz` on your laptop (same `tar` command) and upload it.
2. On the **server**, unpack it over the old copy and rebuild. Your `.env` and data are kept:

```bash
tar xzf ~/coldmailer.tgz -C ~/coldmailer && cd ~/coldmailer && docker compose up -d --build
```

**View logs** on the **server**:

```bash
docker compose logs -f app cron
```

**Open Adminer** (the database browser): it only listens on the server itself. If you install the gcloud CLI on your laptop, reach it with:

```bash
gcloud compute ssh coldmailer --zone YOUR_ZONE -- -L 8080:127.0.0.1:8080
```

Then open http://localhost:8080 and sign in with:
- System: PostgreSQL
- Server: `db`
- User: `email`
- Password: `POSTGRES_PASSWORD` from `.env`
- Database: `email_sender`

## Staying free

- Keep **one e2-micro** in us-west1, us-central1 or us-east1, and only the **Standard** disk (30 GB or less).
- Outgoing traffic is free up to **1 GB a month**.
  - Sending email uses very little: a few hundred emails a day is well under 100 MB a month.
  - Most of the traffic is you using the dashboard.
  - Reading inboxes is incoming traffic, which is free.
- Don't create a static IP, a load balancer or a Cloud SQL database.
- Keep the **$1 budget alert**, and look at **Billing → Reports** once in the first month.

## If something goes wrong

| Problem | Likely cause |
| --- | --- |
| Build stops with "killed" or runs out of memory | Swap isn't on: run the swap command from step 4, then `docker compose up -d --build` again |
| The site doesn't load, or Caddy can't get a certificate | DNS doesn't point at `SERVER_IP` yet (`getent hosts …`), or the server was created without "Allow HTTP/HTTPS traffic" (edit the VM and tick both) |
| Mailbox test says "timed out" | Use port 465 or 587 (Google blocks port 25) |
| The site stopped working after a while | The trial ended without upgrading (step 1), or the VM was stopped and got a new IP (update DNS) |
| A small charge appears | Check **Billing → Reports** by SKU: usually a "Balanced" disk, a second VM, or a non-free region |

Never change `ENCRYPTION_KEY` in `.env` once mailboxes are added; their saved passwords would become unreadable.
