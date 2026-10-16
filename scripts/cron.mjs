// Calls the app's job routes on a timer: send every minute, inbox every 5 minutes.
// Usage: npm run cron   (run it next to `npm start`, e.g. as a second PM2 process)
// Instead of this script you can use system crontab; see README.

const target = (process.env.CRON_TARGET || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env.");
  process.exit(1);
}

const jobs = [
  { name: "send", everyMs: 60_000 },
  { name: "inbox", everyMs: 5 * 60_000 },
];

async function run(name) {
  const started = Date.now();
  try {
    const res = await fetch(`${target}/api/cron/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(6 * 60_000),
    });
    const body = await res.text();
    const line = `${new Date().toISOString()} ${name} ${res.status} ${Date.now() - started}ms ${body}`;
    (res.ok ? console.log : console.error)(line);
  } catch (err) {
    console.error(`${new Date().toISOString()} ${name} failed: ${err.message}`);
  }
}

console.log(`Cron runner calling ${target}/api/cron/* (send every 1 min, inbox every 5 min)`);
for (const job of jobs) {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap a slow run
    running = true;
    await run(job.name);
    running = false;
  };
  setTimeout(tick, 5_000);
  setInterval(tick, job.everyMs);
}
