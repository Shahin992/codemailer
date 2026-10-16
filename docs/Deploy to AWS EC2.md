# Deploy ColdMailer to AWS EC2

This guide puts ColdMailer on an Amazon EC2 server at **https://coldmailer.edufusionbd.online**, with automatic HTTPS and nightly backups. It's written for an account on AWS's **Free plan** (the free tier for accounts opened since 15 July 2025). It uses the same Docker setup as your laptop. That setup was built and checked with Docker on Oct 16, 2026: images built, all containers started, Caddy's HTTPS config validated.

Plan about an hour. Most of it is waiting for the first build.

Commands marked **laptop** run on your computer; **server** commands run in the SSH session to the server.

## What the Free plan gives you

- **$100 in credits** at sign-up, plus **$20 for each "Explore AWS" activity** you complete, up to $100 more. This guide completes two of them, launching an EC2 instance and creating a budget, for **+$40** (step 1).
- **Nothing is charged to your card** while you're on the Free plan. The server, its disk and its IP address are all **paid from the credits**. There are no separate free EC2 hours on this plan.
- The plan ends after **6 months, or when the credits run out**, whichever comes first.
- The **Billing and Cost Management** home page shows your credit balance and the plan's end date.
- Not available on the Free plan: Savings Plans, Reserved Instances and some Marketplace offers. ColdMailer needs none of them.

What ColdMailer uses from the credits (Mumbai prices, approximate):

| Item | Per month |
| --- | --- |
| t3.micro server (2 vCPUs, 1 GB RAM) | about $8.20 |
| Public IPv4 address (with or without an Elastic IP) | about $3.65 |
| 30 GB gp3 disk | about $2.70 |
| Outgoing traffic | $0 (the first 100 GB a month is always free) |
| **Total** | **about $15** |

Six months come to about **$90**. The $100 sign-up credit covers it, and the $40 from activities is a buffer.

**Stay on t3.micro.** A t3.small (2 GB RAM) costs about $23 a month, about $136 over 6 months. That's more than you'll have unless you complete nearly every activity. If the credits run out, the Free plan ends early and the account closes.

**Why 1 GB of RAM is enough:** on the laptop, the running stack uses about 200 MB (app 63 MB, database 46 MB, Adminer 28 MB, cron 14 MB). Only the build needs more, and the swap file from step 5 covers that.

## Before you start (laptop)

Open `deploy/server.env` and check two values:

- **`ADMIN_EMAIL`**: put the email you'll register with. It's empty now, and while it's empty, **whoever opens the site first becomes the admin**.
- **`VAPID_SUBJECT`**: `mailto:` followed by an address you read. It's currently `mailto:admin@edufusionbd.online`.

**Make DKIM work.** On Oct 16 the three DKIM records below existed in Cloudflare but were **Proxied** (orange cloud). Gmail then gets Cloudflare's IPs instead of the DKIM key, so DKIM fails and mail lands in spam. In Cloudflare (**DNS → Records**), each of these `CNAME` records must have **Proxy status: DNS only** (grey cloud). The same goes for every mail record (`autoconfig`, `autodiscover`, MX):

| Name | Target |
| --- | --- |
| `hostingermail-a._domainkey` | `hostingermail-a.dkim.mail.hostinger.com` |
| `hostingermail-b._domainkey` | `hostingermail-b.dkim.mail.hostinger.com` |
| `hostingermail-c._domainkey` | `hostingermail-c.dkim.mail.hostinger.com` |

hPanel's **Emails → Domain settings** page shows the same values and confirms them once they're live.

**Decide the address now.** In Newsletter style, `coldmailer.edufusionbd.online` appears in every email's unsubscribe link, so it can't change after you start sending. If you want a neutral one such as `links.edufusionbd.online`, change both `APP_URL` and `APP_DOMAIN` in `deploy/server.env`.

## 1. Account, region and $40 of extra credits

1. Sign in at console.aws.amazon.com.
2. Top right, pick the region closest to you: **Asia Pacific (Mumbai) ap-south-1**. Singapore works too.
   - The region only affects how fast the dashboard feels. Your emails leave through Hostinger's or Gmail's servers, not this server, so the server's IP has no effect on deliverability.
   - Everything below must be created in the **same region**.
3. On **Console Home**, find the **Explore AWS** widget and set its filter to **Earn AWS credits**. Start these two activities from there, so they're counted:
   - **Set up a cost budget using AWS Budgets** ($20): create a **Monthly cost budget** with your email.
     - Free plan usage is paid by credits, so the budget may show $0 spent. The number that matters is the **credit balance** on the Billing and Cost Management home page.
   - **Launch an instance using Amazon EC2** ($20): follow the walkthrough with **its own test instance**, and terminate that instance when it tells you to. It costs a few cents.
     - Don't use it to launch `coldmailer`: the walkthrough ends by deleting the instance.
4. Check the **Credits** page in Billing and Cost Management after a day or so. Each activity adds $20.

The other activities (Bedrock, Lambda, RDS) also give $20 each. If you do them, delete what they create afterwards. An RDS database left running uses up credits fast.

## 2. Launch the server

Go to **EC2 → Instances → Launch instances** and fill in:

| Setting | Choose |
| --- | --- |
| Name | `coldmailer` |
| Application and OS image | **Ubuntu**, then **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type**, architecture **64-bit (x86)** |
| Instance type | **t3.micro**, marked **Free tier eligible** (see [What the Free plan gives you](#what-the-free-plan-gives-you)) |
| Key pair | **Create new key pair**: name `coldmailer`, type **ED25519**, format **.pem**. Your browser downloads `coldmailer.pem`. Keep it safe: it's the only way to log in. |
| Network settings | Keep **Create security group** and tick all three: **Allow SSH traffic from → My IP**, **Allow HTTPS traffic from the internet**, **Allow HTTP traffic from the internet** |
| Configure storage | **30 GiB**, type **gp3** |

Leave everything else as it is and click **Launch instance**.

**Why not t4g (ARM)?** It would probably work, since every package the app uses also ships for ARM. But the tested build is x86 (t3), so this guide sticks to that.

## 3. The server's address: public IPv4 (Elastic IP optional)

In **EC2 → Instances → coldmailer**, use the **Public IPv4 address** everywhere below (DNS, SSH). That's `SERVER_IP`.
- The **Private IPv4** (172.31.…) only works inside AWS's own network. Never use it for DNS or for connecting from your laptop.
- The public IP **stays the same through reboots**, but changes if the server is **stopped and started**. If that happens, put the new IP in the Cloudflare record (step 4) and in `~/.ssh/config` (step 5).

**Optional: an Elastic IP** keeps the same address even after a stop and start. It costs the same as the normal public IP:

1. Go to **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address → Allocate**.
2. Select the new address, then **Actions → Associate Elastic IP address**.
3. Under **Instance**, choose `coldmailer`, then click **Associate**.

If you add one, the Elastic IP becomes your `SERVER_IP`.

**Cost:** about $3.65 a month from your credits, the same as the automatic address it replaces. **If you ever delete the server, release the Elastic IP too**: an unattached one keeps using credits.

## 4. Point the subdomain at the server

`edufusionbd.online` uses **Cloudflare's** nameservers (`lennon` and `laura.ns.cloudflare.com`), so DNS records are managed in Cloudflare. Records added in hPanel have no effect.

1. Sign in at dash.cloudflare.com, open **edufusionbd.online**, then **DNS → Records → Add record**:
   - **Type:** `A`
   - **Name:** `coldmailer`
   - **IPv4 address:** `SERVER_IP`
   - **Proxy status:** **DNS only** (grey cloud). Caddy must reach the server directly to get its certificate.
   - **TTL:** Auto
2. Save, then check from your **laptop**. It's ready when this prints `SERVER_IP`:

```bash
getent hosts coldmailer.edufusionbd.online
```

## 5. Connect and prepare the server

**On your laptop,** move the key into place and lock it down. SSH refuses keys that others can read:

```bash
mkdir -p ~/.ssh && mv ~/Downloads/coldmailer.pem ~/.ssh/ && chmod 400 ~/.ssh/coldmailer.pem
```

Save a shortcut so every later command can just say `coldmailer`. **Replace `SERVER_IP`** with the server's public IPv4 (or Elastic IP) before running it. If your key file has another name, change `coldmailer.pem` in both commands:

```bash
printf '\nHost coldmailer\n  HostName SERVER_IP\n  User ubuntu\n  IdentityFile ~/.ssh/coldmailer.pem\n  ServerAliveInterval 60\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
```

Connect. The first time, type `yes` to trust the server:

```bash
ssh coldmailer
```

You're now on the **server**. **Add 4 GB of swap.** Without it, 1 GB of RAM isn't enough to build the app:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Install Docker:**

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && exit
```

The second command logs you out. Run `ssh coldmailer` again so Docker works without `sudo`.

## 6. Copy ColdMailer to the server (GitHub)

The code goes through a **private** GitHub repository. Secrets don't: `.gitignore` keeps out `.env` and `deploy/server.env`, which is copied separately below.

**On your laptop,** push the project (once). GitHub asks for your username and a **personal access token** as the password (GitHub → Settings → Developer settings → Personal access tokens):

```bash
cd "/home/orangetoolz/OTZ Project/Email-services" && git init && git add . && git status --short | grep -E '(^|/)\.env|server\.env' ; echo "(nothing above = no secrets staged)"
```

```bash
git commit -m "ColdMailer" && git branch -M main && git remote add origin https://github.com/Shahin992/codemailer.git && git push -u origin main
```

**On the server,** give it read-only access to the repository with a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github -N "" -C coldmailer-server && printf 'Host github.com\n  IdentityFile ~/.ssh/github\n' >> ~/.ssh/config && cat ~/.ssh/github.pub
```

Copy the printed line. On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste it, leave **Allow write access** unticked, and save. Then clone:

```bash
git clone git@github.com:Shahin992/codemailer.git ~/coldmailer
```

**On your laptop,** send the server settings straight into place:

```bash
scp "/home/orangetoolz/OTZ Project/Email-services/deploy/server.env" coldmailer:coldmailer/.env
```

**On the server,** lock the file and set your user's id in it:

```bash
cd ~/coldmailer && chmod 600 .env && sed -i "s/^UID=.*/UID=$(id -u)/; s/^GID=.*/GID=$(id -g)/" .env
```

## 7. Start it

On the **server**:

```bash
cd ~/coldmailer && docker compose up -d --build
```

**The first build takes about 10–20 minutes** on a t3.micro. If the connection drops, run `ssh coldmailer` and the same command again; it picks up where it stopped. Then:

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

`migrate` should show **Exited (0)**, and the others **Up**. When Caddy's log shows `certificate obtained successfully`, open **https://coldmailer.edufusionbd.online**:

1. Create your account with the `ADMIN_EMAIL` address. It becomes the admin.
2. Add your mailboxes again. The server starts with a fresh database.
3. In Settings:
   - set the footer address and the opt-out line;
   - set the send window and timezone;
   - turn on notifications on your phone. On iPhone, add the app to the Home Screen first.
4. Send a test campaign to your Gmail. In Gmail, open **⋮ → Show original**: SPF, DKIM and DMARC should all say **PASS**. If DKIM doesn't, check the three DKIM records from [Before you start](#before-you-start-laptop).

**Finally, cap the CPU spending.** New t3 servers run in "Unlimited" mode, which uses extra credits if the CPU stays busy for a long time. That's useful for the first build but not afterwards:

1. Go to **EC2 → Instances** and select `coldmailer`.
2. Choose **Actions → Instance settings → Change credit specification**.
3. Untick **Unlimited** and click **Save**.

Later rebuilds still run at full speed: the server saves up CPU credit while it's idle.

## 8. Nightly backups

On the **server**, open the scheduler:

```bash
crontab -e
```

Add this line. It backs up the database every night at 03:00 server time (UTC) and keeps the newest 14:

```
0 3 * * * cd $HOME/coldmailer && sh scripts/backup.sh >> backups/backup.log 2>&1
```

Now and then, copy the backups to your **laptop**:

```bash
mkdir -p ~/coldmailer-backups && scp 'coldmailer:coldmailer/backups/*.sql.gz' ~/coldmailer-backups/
```

## Everyday tasks

**Update after code changes:**

1. If you changed `lib/db/schema.ts`, run `sudo docker compose up -d --build` on the **laptop** first. The new migration file is then created in `drizzle/` there. Commit it with the code, so the server only applies it. A migration generated on the server would block the next `git pull`.
2. On the **laptop**, commit and push:

```bash
git add . && git commit -m "Describe the change" && git push
```

3. On the **server**, pull and rebuild. Your `.env` and data are kept:

```bash
cd ~/coldmailer && git pull && docker compose up -d --build
```

**View logs** on the **server**:

```bash
docker compose logs -f app cron
```

**Free disk space** on the **server** after a few updates (removes only old, unused images):

```bash
docker image prune -f
```

**Open Adminer** (the database browser). It only listens on the server itself, so reach it through SSH from the **laptop**:

```bash
ssh -N -L 8081:127.0.0.1:8080 coldmailer
```

While that runs, open http://localhost:8081. Port 8081 is used because your laptop's own Adminer already uses 8080. Sign in with:
- System: PostgreSQL
- Server: `db`
- User: `email`
- Password: `POSTGRES_PASSWORD` from `.env` on the server
- Database: `email_sender`

Press Ctrl-C in that terminal when you're done.

## Making the credits last

- Run **one** t3.micro with **one** 30 GB gp3 disk and **one** public IP (its own, or one Elastic IP).
- Don't create load balancers, NAT gateways, RDS databases or extra Elastic IPs.
- **Stopping** the server doesn't stop the disk (or an Elastic IP) from using credits, and without an Elastic IP it gets a new public IP when started again.
- **Check the credit balance** on the Billing and Cost Management home page once a week at first. It should drop by about $3.50 a week. Faster means something else is running: see the last row of [If something goes wrong](#if-something-goes-wrong).
- To shut down for good, do all three:
  1. terminate the instance;
  2. release the Elastic IP, if you made one;
  3. check that **EC2 → Volumes** and **Snapshots** are empty.

## When the Free plan ends

AWS emails you as the credits run low and as the end date (6 months after sign-up) gets close.

**If you don't upgrade, AWS closes the account at the end and ColdMailer stops.**
- AWS keeps the data for **90 days**. Upgrading within that time restores the account and the server.
- After 90 days, everything is deleted.

**To keep ColdMailer running without a break**, upgrade a week or two before the end date:
1. In the console, go to **Billing and Cost Management → Upgrade plan** (console.aws.amazon.com/billing/home#/freetier/upgrade).
2. Click **Upgrade account**.

After upgrading:
- leftover credits keep paying first;
- after that your card is charged, about **$15 a month** for this setup.

**Either way, download the newest backup first** (step 8). If you'd rather not pay AWS, restore that backup on another server. [`Deploy to Google Cloud.md`](Deploy%20to%20Google%20Cloud.md) covers Google's always-free e2-micro.

## If something goes wrong

| Problem | Likely cause |
| --- | --- |
| `ssh: connect to host … Connection timed out` | Your home IP changed, and the security group only allows SSH from the old one. In **EC2 → Security Groups**, select the group, then **Edit inbound rules**, set the SSH rule's source to **My IP** and save. |
| `Permission denied (publickey)` | Wrong user or key. The user is `ubuntu`, and the key is `~/.ssh/coldmailer.pem` (`chmod 400`). |
| `UNPROTECTED PRIVATE KEY FILE` | Run `chmod 400 ~/.ssh/coldmailer.pem` |
| Build stops with "killed" or runs out of memory | Swap isn't on: run the swap command from step 5, then `docker compose up -d --build` again |
| Build crawls for a long time | The CPU switch from step 7 was made before the first build, so the server has no CPU credit yet. Tick **Unlimited** again for the build, or wait an hour. |
| `git pull` says local changes would be overwritten | A migration was generated on the server (see Everyday tasks, step 1). Run `git status`; if it's only new `drizzle/` files, generate the same change on the laptop, commit it, then on the server `git stash -u && git pull`. |
| The site doesn't load, or Caddy can't get a certificate | DNS doesn't point at the server's public IP yet (`getent hosts …`). Or the Cloudflare record is proxied (orange cloud) instead of **DNS only**. Or the security group is missing the HTTP (80) or HTTPS (443) rule. |
| Mailbox test says "timed out" | AWS blocks port 25. Use port 465 or 587. |
| An instance type is greyed out or "not available on the Free plan" | Pick **t3.micro**, which is marked **Free tier eligible** |
| The site stopped working after a few months | The Free plan ended (6 months passed or the credits ran out), so the account closed. Upgrade within 90 days to get the server and data back (see [When the Free plan ends](#when-the-free-plan-ends)). |
| Credits drop faster than about $15 a month | In **Billing → Bills**, open the charges by service. Usual causes: the EC2 activity's test instance still running, an unattached Elastic IP, a leftover volume or snapshot, or CPU still on Unlimited. |

Never change `ENCRYPTION_KEY` in `.env` once mailboxes are added; their saved passwords would become unreadable.
