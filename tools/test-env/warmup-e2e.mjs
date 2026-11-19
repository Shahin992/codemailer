// End-to-end warm-up test: runs the real send and inbox jobs against the test kit and checks the results.
//
// Needs, once: in the test account (admin@acme.test), the four warm-up mailboxes from the README
// (anna@north.test, ben@north.test, cara@south.test, and dana@gmail-test.test as a Gmail partner).
// Then, with `node services.mjs` and the app on :3100 running, from the project root:
//   set -a && . tools/test-env/test.env && set +a && node tools/test-env/warmup-e2e.mjs
// It changes the test account's warm-up data and settings (restored at the end). About 3 minutes.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "..", "package.json"));
const pg = require("pg");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const APP = "http://127.0.0.1:3100";
const OUTBOX = path.join(here, "outbox");
const BOXES = {
  "anna@north.test": { port: 1144, spam: "Junk" },
  "ben@north.test": { port: 1145, spam: "Junk" },
  "cara@south.test": { port: 1146, spam: "Junk" },
  "dana@gmail-test.test": { port: 1147, spam: "[Gmail]/Spam" },
};
const SENDERS = ["anna@north.test", "ben@north.test", "cara@south.test"];
const PARTNER = "dana@gmail-test.test";

const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();
const q = async (text, params) => (await db.query(text, params)).rows;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cron = async (job) => {
  const res = await fetch(`${APP}/api/cron/${job}`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  return (await res.json()).result ?? "";
};
const api = async (path, body) => {
  const res = await fetch(`${APP}${path}`, { method: "POST", headers: { Authorization: `Bearer ${process.env.API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
async function imapList(email) {
  const box = BOXES[email];
  const c = new ImapFlow({ host: "127.0.0.1", port: box.port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "test-app-password" }, logger: false });
  await c.connect();
  const out = {};
  for (const folder of ["INBOX", box.spam]) {
    const lock = await c.getMailboxLock(folder, { readOnly: true });
    try {
      out[folder] = [];
      if (c.mailbox.exists) for await (const m of c.fetch("1:*", { uid: true, flags: true, envelope: true })) out[folder].push({ mid: m.envelope.messageId, flags: [...m.flags] });
    } finally {
      lock.release();
    }
  }
  await c.logout();
  return out;
}
/** Run send jobs until nothing more is due now (moving sent_at back so the 2-minute spacing doesn't hold the test up). */
async function sendAllDue(maxRounds = 20) {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    await q(`update warmup_messages set sent_at = sent_at - interval '3 minutes' where sent_at > now() - interval '3 minutes'`);
    const r = await cron("send");
    const sent = Number(/warm-up: planned \d+, sent (\d+)/.exec(r)?.[1] ?? 0);
    total += sent;
    const [due] = await q(`select count(*)::int n from warmup_messages where status='scheduled' and scheduled_at <= now()`);
    if (!sent && !due.n) break;
  }
  return total;
}
/** Run inbox checks until every sent warm-up email is found (the instant watcher may get there first). */
async function receiveAll(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await cron("inbox");
    const [left] = await q(`select count(*)::int n from warmup_messages where status='sent' and received_at is null`);
    if (!left.n) return 0;
    await sleep(1500);
  }
  return (await q(`select count(*)::int n from warmup_messages where status='sent' and received_at is null`))[0].n;
}

// ---------- 0. Clean start ----------
const [admin] = await q(`select id from users where email='admin@acme.test'`);
await q(`delete from warmup_messages where user_id=$1`, [admin.id]);
// Campaigns from earlier manual tests (sent from or to the warm-up test mailboxes) and the people they created.
await q(`delete from campaigns where user_id=$1 and (name like 'e2e %' or name in ('guard test', 'partner test'))`, [admin.id]);
await q(`delete from recipients r where r.user_id=$1 and r.email = any($2) and not exists (select 1 from messages m where m.recipient_id=r.id)`, [admin.id, [...SENDERS, PARTNER]]);
await q(`update settings set window_start='09:00', window_end='17:00', timezone='America/New_York', weekdays_only=true where user_id=$1`, [admin.id]);
await q(
  `update senders set warmup_enabled=true, warmup_started_at=now(), warmup_paused_at=null, warmup_planned_on=null, imap_state='{}',
     warmup_start=2, warmup_increase=2, warmup_max=30, warmup_reply_rate=100, warmup_receive_max=3, daily_limit=60, status='active', rest_until=null, last_error=null
   where user_id=$1 and email = any($2)`,
  [admin.id, [...SENDERS, PARTNER]],
);
await q(`update senders set warmup_role = case when email=$2 then 'partner' else 'sender' end, daily_limit = case when email=$2 then 10 else 60 end where user_id=$1 and email = any($3)`, [admin.id, PARTNER, [...SENDERS, PARTNER]]);
// First look: inbox positions = now. The instant watcher may hold the inbox lock, so wait until all are set.
for (let i = 0; i < 30; i++) {
  await cron("inbox");
  const [unset] = await q(`select count(*)::int n from senders where user_id=$1 and email = any($2) and not (imap_state ? 'INBOX')`, [admin.id, [...SENDERS, PARTNER]]);
  if (!unset.n) break;
  await sleep(1000);
}
const found = await q(`select email from senders where user_id=$1 and email = any($2)`, [admin.id, [...SENDERS, PARTNER]]);
if (found.length !== 4) {
  console.error(`Add the four warm-up test mailboxes to admin@acme.test first (found ${found.length}); see tools/test-env/README.md.`);
  process.exit(2);
}
await q(`update senders set provider='gmail' where user_id=$1 and email=$2`, [admin.id, PARTNER]); // counted as Gmail
const ids = Object.fromEntries((await q(`select email, id from senders where user_id=$1 and email = any($2)`, [admin.id, [...SENDERS, PARTNER]])).map((r) => [r.email, r.id]));

// ---------- 1. Plan (day 1, real 09:00-17:00 New York window, weekdays only) ----------
console.log("\n# Plan, day 1");
await cron("send");
const plan = await q(`select s.email as from_, t.email as to_, w.scheduled_at, w.parent_id from warmup_messages w join senders s on s.id=w.sender_id join senders t on t.id=w.to_sender_id where w.user_id=$1`, [admin.id]);
const nyHour = (d) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(d));
const nyDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date());
const weekend = nyDay === "Sat" || nyDay === "Sun";
const nowNy = nyHour(new Date());
if (weekend || nowNy >= 17) {
  check("nothing planned outside the window (weekend or after 17:00 NY)", plan.length === 0, `${plan.length} planned`);
} else {
  for (const s of SENDERS) check(`${s} planned 2 new emails`, plan.filter((p) => p.from_ === s).length === 2, `${plan.filter((p) => p.from_ === s).length}`);
  check("partner planned no new emails", plan.filter((p) => p.from_ === PARTNER).length === 0);
  check("partner gets at most 3 a day", plan.filter((p) => p.to_ === PARTNER).length <= 3, `${plan.filter((p) => p.to_ === PARTNER).length}`);
  check("each sender sends 1 to the partner (fair share)", SENDERS.every((s) => plan.filter((p) => p.from_ === s && p.to_ === PARTNER).length === 1));
  check("nobody emails itself", plan.every((p) => p.from_ !== p.to_));
  check("all times inside 09:00-17:00 New York", plan.every((p) => nyHour(p.scheduled_at) >= 9 && nyHour(p.scheduled_at) < 17), plan.map((p) => nyHour(p.scheduled_at)).join(","));
  check("all times in the future", plan.every((p) => p.scheduled_at > new Date()));
}
const again = await cron("send");
check("a second run plans nothing more today", /planned 0,/.test(again), again);

// ---------- 2. Send (window opened all day so the test can run now) ----------
console.log("\n# Send and receive");
if (!plan.length) {
  // Weekend or after hours: open the window and let a fresh plan happen.
  await q(`update settings set window_start='00:00', window_end='00:00', weekdays_only=false where user_id=$1`, [admin.id]);
  await q(`update senders set warmup_planned_on=null where id = any($1)`, [Object.values(ids)]);
  await cron("send");
}
await q(`update settings set window_start='00:00', window_end='00:00', weekdays_only=false where user_id=$1`, [admin.id]);
await q(`update warmup_messages set scheduled_at=now() where user_id=$1 and status='scheduled'`, [admin.id]);
const sentNew = await sendAllDue();
const [newRows] = await q(`select count(*)::int n, count(*) filter (where status='sent')::int sent from warmup_messages where user_id=$1 and parent_id is null`, [admin.id]);
check("every planned new email was sent", newRows.n === newRows.sent && newRows.n > 0, `${newRows.sent}/${newRows.n}, ${sentNew} this round`);
const left = await receiveAll();
check("every sent email was found by its receiver", left === 0, `${left} not found`);

// ---------- 3. Receiving side on the servers ----------
const warmIds = new Set((await q(`select message_id_header from warmup_messages where user_id=$1 and message_id_header is not null`, [admin.id])).map((r) => r.message_id_header));
let inSpam = 0, unread = 0, seen = 0;
for (const email of Object.keys(BOXES)) {
  const l = await imapList(email);
  for (const [folder, msgs] of Object.entries(l)) {
    for (const m of msgs) {
      if (!warmIds.has(m.mid)) continue;
      if (folder !== "INBOX") inSpam++;
      if (m.flags.includes("\\Seen")) seen++; else unread++;
    }
  }
}
check("no warm-up email left in any spam folder", inSpam === 0, `${inSpam} still in spam`);
check("every warm-up email marked read", unread === 0 && seen > 0, `${seen} read, ${unread} unread`);
const landed = await q(`select landed_in, count(*)::int n, count(rescued_at)::int rescued from warmup_messages where user_id=$1 and received_at is not null group by landed_in`, [admin.id]);
const spamRow = landed.find((r) => r.landed_in === "spam");
check("some emails landed in spam (test kit puts every 3rd there)", Boolean(spamRow?.n), JSON.stringify(landed));
check("every one that landed in spam was moved back", spamRow ? spamRow.rescued === spamRow.n : true);

// ---------- 4. Replies ----------
console.log("\n# Replies and threads");
const [planned] = await q(`select count(*)::int n from warmup_messages where user_id=$1 and parent_id is not null`, [admin.id]);
check("a reply was planned for every new email (reply rate 100%)", planned.n === newRows.n, `${planned.n} replies for ${newRows.n} emails`);
const replyTimes = await q(`select r.scheduled_at - p.received_at as delay, s.warmup_role from warmup_messages r join warmup_messages p on p.id=r.parent_id join senders s on s.id=r.sender_id where r.user_id=$1`, [admin.id]);
const mins = (iv) => (iv.hours ?? 0) * 60 + (iv.minutes ?? 0) + (iv.seconds ?? 0) / 60;
check("sender replies wait 15-180 min", replyTimes.filter((r) => r.warmup_role === "sender").every((r) => mins(r.delay) >= 14.9 && mins(r.delay) <= 180.1), replyTimes.filter((r) => r.warmup_role === "sender").map((r) => Math.round(mins(r.delay))).join(","));
check("partner replies wait 20-300 min", replyTimes.filter((r) => r.warmup_role === "partner").every((r) => mins(r.delay) >= 19.9 && mins(r.delay) <= 300.1), replyTimes.filter((r) => r.warmup_role === "partner").map((r) => Math.round(mins(r.delay))).join(","));
// Send replies, then reply-backs, until threads settle.
for (let round = 0; round < 4; round++) {
  await q(`update warmup_messages set scheduled_at=now() where user_id=$1 and status='scheduled'`, [admin.id]);
  await sendAllDue();
  await receiveAll();
}
const [stuck] = await q(`select count(*)::int n from warmup_messages where user_id=$1 and status in ('scheduled','sending')`, [admin.id]);
check("nothing left waiting or stuck", stuck.n === 0, `${stuck.n}`);
const threads = await q(`select thread_id, count(*)::int n from warmup_messages where user_id=$1 and status <> 'cancelled' group by thread_id`, [admin.id]);
check("no thread longer than 3", threads.every((t) => t.n <= 3), threads.map((t) => t.n).join(","));
check("some threads got a reply back (3 emails)", threads.some((t) => t.n === 3));
check("partner never started a thread", (await q(`select count(*)::int n from warmup_messages where sender_id=$1 and parent_id is null`, [ids[PARTNER]]))[0].n === 0);

// Thread headers in the raw emails
const files = fs.readdirSync(OUTBOX).map((f) => `${OUTBOX}/${f}`);
const byMid = new Map();
for (const f of files) {
  const parsed = await simpleParser(fs.readFileSync(f));
  if (parsed.messageId && warmIds.size) byMid.set(parsed.messageId, parsed);
}
const replyRows = await q(`select r.message_id_header mid, r.subject, p.message_id_header parent_mid, p.subject parent_subject, r.thread_id from warmup_messages r join warmup_messages p on p.id=r.parent_id where r.user_id=$1 and r.status='sent'`, [admin.id]);
let headerOk = 0;
const headerBad = [];
for (const r of replyRows) {
  const m = byMid.get(r.mid);
  const refs = Array.isArray(m?.references) ? m.references : m?.references ? [m.references] : [];
  const [root] = await q(`select message_id_header from warmup_messages where id=$1`, [r.thread_id]);
  const ok = m && m.inReplyTo === r.parent_mid && refs.includes(r.parent_mid) && refs[0] === root.message_id_header && /^Re: /.test(m.subject) && !/^Re: Re:/.test(m.subject) && /\n> /.test(m.text ?? "");
  if (ok) headerOk++; else headerBad.push(r.mid);
}
check("every reply has In-Reply-To, References from the first email, one 'Re:', and the quote", headerOk === replyRows.length && replyRows.length > 0, `${headerOk}/${replyRows.length} ${headerBad.slice(0, 2).join(" ")}`);
const bodies = await q(`select body_text from warmup_messages where user_id=$1 and parent_id is null and body_text is not null`, [admin.id]);
check("no two new emails have the same text", new Set(bodies.map((b) => b.body_text)).size === bodies.length, `${bodies.length} emails`);
const allWarm = [...byMid.values()].filter((m) => warmIds.has(m.messageId));
check("warm-up emails carry no special headers or links", allWarm.every((m) => !/https?:\/\//.test(m.text ?? "") && !m.headers.has("list-unsubscribe") && ![...m.headers.keys()].some((k) => /warm/i.test(k))));

// ---------- 5. Kept apart ----------
console.log("\n# Kept apart from everything else");
const addrs = [...SENDERS, PARTNER];
const [apart] = await q(
  `select (select count(*)::int from replies where user_id=$1 and (from_email = any($2) or sender_id = any($3))) replies,
          (select count(*)::int from recipients where user_id=$1 and email = any($2)) recipients,
          (select count(*)::int from suppressions where user_id=$1 and email = any($2)) dnc,
          (select count(*)::int from messages where user_id=$1 and sender_id = any($3)) campaign_msgs`,
  [admin.id, addrs, Object.values(ids)],
);
check("no Replies rows from warm-up", apart.replies === 0, JSON.stringify(apart));
check("no recipients or do-not-send entries from warm-up", apart.recipients === 0 && apart.dnc === 0);
check("no campaign messages from warm-up", apart.campaign_msgs === 0);

// ---------- 6. Daily limit shared with campaigns ----------
console.log("\n# Daily limit");
const [usage] = await q(`select (select count(*)::int from warmup_messages w where w.sender_id=$1 and w.sent_at > now()-interval '24 hours') warm`, [ids["anna@north.test"]]);
const sendersApi = await (await fetch(`${APP}/api/v1/senders`, { headers: { Authorization: `Bearer ${process.env.API_KEY}` } })).json();
const annaApi = (sendersApi.data ?? sendersApi.senders ?? sendersApi).find((s) => s.email === "anna@north.test");
check("API 24-hour count includes warm-up sends", annaApi?.sent_last_24h >= usage.warm && usage.warm > 0, `api ${annaApi?.sent_last_24h}, warm-up ${usage.warm}`);
await q(`update senders set daily_limit=$2 where id=$1`, [ids["anna@north.test"], annaApi.sent_last_24h]);
const extra = (await q(`insert into warmup_messages (id, thread_id, user_id, sender_id, to_sender_id, scheduled_at) values (gen_random_uuid(), gen_random_uuid(), $1, $2, $3, now()) returning id`, [admin.id, ids["anna@north.test"], ids["ben@north.test"]]))[0].id;
await q(`update warmup_messages set thread_id=id where id=$1`, [extra]);
await sendAllDue(2);
const [ex] = await q(`select status, error, scheduled_at > now() later from warmup_messages where id=$1`, [extra]);
check("at the daily limit a warm-up email waits", ex.status === "scheduled" && ex.later && /daily limit/.test(ex.error ?? ""), JSON.stringify(ex));
// A campaign from anna must also wait.
const camp = await api("/api/v1/campaigns", { name: "e2e limit", subject: "Hi", body: "Hello there", senders: ["anna@north.test"], recipients: ["limit-test@example.test"], send_window: { start: "00:00", end: "00:00", timezone: "UTC", weekdays_only: false } });
await q(`update senders set next_send_at=now() where id=$1`, [ids["anna@north.test"]]);
await cron("send");
const [cm] = await q(`select status from messages where campaign_id=$1`, [camp.body.campaign_id]);
check("at the daily limit a campaign email waits too", cm?.status === "queued", cm?.status);
await q(`update senders set daily_limit=60 where id=$1`, [ids["anna@north.test"]]);
await q(`update campaigns set status='cancelled' where id=$1`, [camp.body.campaign_id]);
await q(`update messages set status='cancelled' where campaign_id=$1 and status='queued'`, [camp.body.campaign_id]);
await q(`update warmup_messages set status='cancelled' where id=$1`, [extra]);

// ---------- 7. Partners and campaigns ----------
console.log("\n# Partners and campaigns");
const p1 = await api("/api/v1/campaigns", { name: "e2e partner sender", subject: "Hi", body: "Hello", senders: [PARTNER], recipients: ["x@example.test"] });
check("API refuses a partner as the only sender", p1.status === 400 && /partner/i.test(p1.body.error ?? ""), JSON.stringify(p1.body));
const p2 = await api("/api/v1/campaigns", { name: "e2e partner recipient", subject: "Hi", body: "Hello", senders: ["ben@north.test", PARTNER], recipients: [PARTNER], send_window: { start: "00:00", end: "00:00", timezone: "UTC", weekdays_only: false } });
const cs = await q(`select s.email from campaign_senders c join senders s on s.id=c.sender_id where c.campaign_id=$1`, [p2.body.campaign_id]);
check("partner dropped from a mixed sender list", cs.length === 1 && cs[0].email === "ben@north.test", cs.map((c) => c.email).join(","));
await q(`update senders set next_send_at=now() where id=$1`, [ids["ben@north.test"]]);
await cron("send");
const [pm] = await q(`select status, error from messages where campaign_id=$1`, [p2.body.campaign_id]);
check("campaign email to a partner address cancelled", pm?.status === "cancelled" && /partner/.test(pm.error ?? ""), JSON.stringify(pm));

// ---------- 8. Day 2 ramp and fair partner share ----------
console.log("\n# Day 2");
await q(`update warmup_messages set scheduled_at=scheduled_at-interval '1 day', sent_at=sent_at-interval '1 day', received_at=received_at-interval '1 day', rescued_at=rescued_at-interval '1 day' where user_id=$1`, [admin.id]);
await q(`update senders set warmup_started_at=warmup_started_at-interval '1 day', warmup_planned_on=null where id = any($1)`, [Object.values(ids)]);
await cron("send");
const day2 = await q(`select s.email from_, t.email to_ from warmup_messages w join senders s on s.id=w.sender_id join senders t on t.id=w.to_sender_id where w.user_id=$1 and w.status='scheduled' and w.parent_id is null`, [admin.id]);
for (const s of SENDERS) check(`${s} planned 4 new emails on day 2`, day2.filter((p) => p.from_ === s).length === 4, `${day2.filter((p) => p.from_ === s).length}`);
check("partner still gets at most 3, one from each sender", day2.filter((p) => p.to_ === PARTNER).length === 3 && SENDERS.every((s) => day2.filter((p) => p.from_ === s && p.to_ === PARTNER).length === 1));

// ---------- 9. Turning a mailbox off ----------
console.log("\n# Turning off");
await q(`update senders set warmup_enabled=false, warmup_paused_at=now() where id=$1`, [ids["cara@south.test"]]);
await q(`update warmup_messages set status='cancelled', error='Warm-up was turned off for this mailbox.' where sender_id=$1 and status='scheduled'`, [ids["cara@south.test"]]); // what the action does
await q(`update warmup_messages set scheduled_at=now() where user_id=$1 and status='scheduled'`, [admin.id]);
await sendAllDue();
const [toCara] = await q(`select count(*)::int n from warmup_messages where to_sender_id=$1 and status='sent' and sent_at > now()-interval '5 minutes'`, [ids["cara@south.test"]]);
check("nothing sent to a mailbox after its warm-up was turned off", toCara.n === 0, `${toCara.n}`);
const [stuck2] = await q(`select count(*)::int n from warmup_messages where user_id=$1 and status='scheduled' and scheduled_at <= now()`, [admin.id]);
check("emails planned to it went elsewhere or were dropped (none stuck)", stuck2.n === 0, `${stuck2.n}`);

// ---------- 10. Fixes from the code review ----------
console.log("\n# Review fixes");
await q(`update senders set warmup_enabled=true, warmup_paused_at=null, status='active' where id = any($1)`, [Object.values(ids)]);
await q(`update warmup_messages set status='cancelled' where user_id=$1 and status='scheduled'`, [admin.id]);
const newRow = async (from, to, extra = "") =>
  (await q(`insert into warmup_messages (id, thread_id, user_id, sender_id, to_sender_id, scheduled_at) select g, g, $1, $2, $3, now() from gen_random_uuid() g returning id`, [admin.id, ids[from], ids[to]]))[0].id;
async function appendTo(email, raw, folder = "INBOX") {
  const c = new ImapFlow({ host: "127.0.0.1", port: BOXES[email].port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "test-app-password" }, logger: false });
  await c.connect();
  await c.append(folder, raw);
  await c.logout();
}
const settle = async () => { await sleep(4000); await cron("inbox"); };

// 10a. A paused mailbox plans no replies, and drops a reply it had waiting.
// A warm-up email anna "sent" earlier arrives in ben's inbox while ben is paused.
const toBen = await newRow("anna@north.test", "ben@north.test");
const pausedMid = `<paused-${Date.now()}@north.test>`;
await q(`update warmup_messages set status='sent', sent_at=now(), message_id_header=$2, subject='Paused test', body_text='Hi Ben' where id=$1`, [toBen, pausedMid]);
await q(`update senders set status='paused' where id=$1`, [ids["ben@north.test"]]);
await appendTo("ben@north.test", Buffer.from(`From: Anna Reyes <anna@north.test>\r\nTo: ben@north.test\r\nSubject: Paused test\r\nMessage-ID: ${pausedMid}\r\n\r\nHi Ben\r\n`));
await settle();
const [benGot] = await q(`select received_at is not null got from warmup_messages where id=$1`, [toBen]);
const [benReplies] = await q(`select count(*)::int n from warmup_messages where parent_id=$1`, [toBen]);
check("a paused mailbox still tidies its inbox but plans no reply", benGot.got && benReplies.n === 0, `received ${benGot.got}, replies ${benReplies.n}`);
const waiting = (await q(`insert into warmup_messages (id, thread_id, user_id, sender_id, to_sender_id, parent_id, scheduled_at) values (gen_random_uuid(), $1, $2, $3, $4, $1, now()) returning id`, [toBen, admin.id, ids["ben@north.test"], ids["anna@north.test"]]))[0].id;
await sendAllDue(2);
const [w1] = await q(`select status, error from warmup_messages where id=$1`, [waiting]);
check("a reply waiting on a paused mailbox is dropped, not saved up", w1.status === "cancelled" && /paused/.test(w1.error), JSON.stringify(w1));
await q(`update senders set status='active' where id=$1`, [ids["ben@north.test"]]);

// 10b. Stale emails are dropped.
const stale = await newRow("anna@north.test", "cara@south.test");
await q(`update warmup_messages set scheduled_at = now() - interval '4 hours' where id=$1`, [stale]);
const oldReply = (await q(`insert into warmup_messages (id, thread_id, user_id, sender_id, to_sender_id, parent_id, scheduled_at, created_at) values (gen_random_uuid(), $1, $2, $3, $4, $1, now(), now() - interval '5 days') returning id`, [toBen, admin.id, ids["anna@north.test"], ids["ben@north.test"]]))[0].id;
await sendAllDue(2);
const [s1] = await q(`select status, error from warmup_messages where id=$1`, [stale]);
const [s2] = await q(`select status, error from warmup_messages where id=$1`, [oldReply]);
check("a new email 4 hours past its time is dropped as missed", s1.status === "cancelled" && /Missed/.test(s1.error), JSON.stringify(s1));
check("a reply planned 5 days ago is dropped", s2.status === "cancelled" && /Too late/.test(s2.error), JSON.stringify(s2));

// 10c. A retry keeps the Message-ID and text of the first try.
const retryRow = await newRow("cara@south.test", "anna@north.test");
const fixedMid = `<retry-${Date.now()}@south.test>`;
await q(`update warmup_messages set message_id_header=$2, subject='Retry subject', body_text=$3, topic='question', attempts=1 where id=$1`, [retryRow, fixedMid, "Hi Anna,\n\nRetry body text.\n\nThanks,\nCara\n"]);
await sendAllDue(2);
const [r1] = await q(`select status, message_id_header from warmup_messages where id=$1`, [retryRow]);
const sentCopy = fs.readdirSync(OUTBOX).map((f) => fs.readFileSync(`${OUTBOX}/${f}`, "utf8")).find((t) => t.includes(fixedMid));
check("a retry is sent with the same Message-ID and text", r1.status === "sent" && r1.message_id_header === fixedMid && /Retry body text/.test(sentCopy ?? ""), r1.status);
await settle();

// 10d. Out-of-office answer to a warm-up email, plain mail from an own warm-up mailbox, a bounce about one.
const [annaWarm] = await q(`select message_id_header from warmup_messages where sender_id=$1 and status='sent' and message_id_header is not null limit 1`, [ids["anna@north.test"]]);
const camp2 = await api("/api/v1/campaigns", { name: "e2e to own mailbox", subject: "Quick hello", body: "Hello Ben", senders: ["anna@north.test"], recipients: ["ben@north.test"], send_window: { start: "00:00", end: "00:00", timezone: "UTC", weekdays_only: false } });
await q(`update senders set next_send_at=now() where id=$1`, [ids["anna@north.test"]]);
await q(`update warmup_messages set sent_at = sent_at - interval '3 minutes' where sent_at > now() - interval '3 minutes'`);
await cron("send");
const [campMsg] = await q(`select status, message_id_header from messages where campaign_id=$1`, [camp2.body.campaign_id]);
const [repliesBefore] = await q(`select count(*)::int n from replies where user_id=$1`, [admin.id]);
const mk = (headers, body) => Buffer.from(headers.join("\r\n") + "\r\n\r\n" + body + "\r\n");
await appendTo("anna@north.test", mk(["From: Ben Okafor <ben@north.test>", "To: anna@north.test", "Subject: Out of office", `Message-ID: <ooo-${Date.now()}@north.test>`, `In-Reply-To: ${annaWarm.message_id_header}`, "Auto-Submitted: auto-replied"], "I'm away until Monday."));
await appendTo("anna@north.test", mk(["From: Ben Okafor <ben@north.test>", "To: anna@north.test", "Subject: Lunch?", `Message-ID: <plain-${Date.now()}@north.test>`], "Lunch at 1?"));
await appendTo("anna@north.test", mk(["From: Mail Delivery System <MAILER-DAEMON@mx.north.test>", "To: anna@north.test", "Subject: Undelivered Mail Returned to Sender", `Message-ID: <dsn-${Date.now()}@mx.north.test>`, "MIME-Version: 1.0", 'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"'], ["--b1", "Content-Type: message/delivery-status", "", "Final-Recipient: rfc822; ben@north.test", "Action: failed", "Status: 5.1.1", "", "--b1--"].join("\r\n")));
await settle();
const [repliesAfter] = await q(`select count(*)::int n from replies where user_id=$1`, [admin.id]);
const [benDnc] = await q(`select count(*)::int n from suppressions where user_id=$1 and email='ben@north.test'`, [admin.id]);
check("campaign to an own warm-up address was sent (setup)", campMsg?.status === "sent", campMsg?.status);
check("out-of-office and plain mail from own warm-up mailboxes don't become Replies", repliesAfter.n === repliesBefore.n, `${repliesBefore.n} -> ${repliesAfter.n}`);
check("a bounce about an own warm-up mailbox doesn't put it on the do-not-send list", benDnc.n === 0);
// A real reply to that campaign email (it quotes it) is still recorded.
await appendTo("anna@north.test", mk(["From: Ben Okafor <ben@north.test>", "To: anna@north.test", "Subject: Re: Quick hello", `Message-ID: <real-${Date.now()}@north.test>`, `In-Reply-To: ${campMsg.message_id_header}`, `References: ${campMsg.message_id_header}`], "Thanks Anna, sounds good."));
await settle();
const [repliesReal] = await q(`select count(*)::int n from replies where user_id=$1`, [admin.id]);
check("a real reply quoting a campaign email is still recorded", repliesReal.n === repliesAfter.n + 1, `${repliesAfter.n} -> ${repliesReal.n}`);
await q(`delete from replies where user_id=$1 and from_email='ben@north.test'`, [admin.id]);
await q(`delete from campaigns where id=$1`, [camp2.body.campaign_id]);
await q(`delete from recipients r where r.user_id=$1 and r.email='ben@north.test' and not exists (select 1 from messages m where m.recipient_id=r.id)`, [admin.id]);

// 10e. Partner slots that don't divide evenly rotate between the business mailboxes.
await q(`update senders set warmup_receive_max=2 where id=$1`, [ids[PARTNER]]);
const leftOut = [];
for (let day = 0; day < 6; day++) {
  await q(`update warmup_messages set status='cancelled' where user_id=$1 and status='scheduled'`, [admin.id]);
  await q(`update warmup_messages set scheduled_at=scheduled_at-interval '1 day', sent_at=sent_at-interval '1 day', received_at=received_at-interval '1 day', created_at=created_at-interval '1 day' where user_id=$1`, [admin.id]);
  await q(`update senders set warmup_planned_on=null where id = any($1)`, [Object.values(ids)]);
  await cron("send");
  const got = await q(`select s.email from warmup_messages w join senders s on s.id=w.sender_id where w.to_sender_id=$1 and w.status='scheduled' and w.parent_id is null`, [ids[PARTNER]]);
  if (got.length > 2) leftOut.push("over");
  leftOut.push(SENDERS.find((x) => !got.some((g) => g.email === x)) ?? "none");
}
check("the partner never gets more than its 2 a day", !leftOut.includes("over"));
check("the mailbox left without a Gmail email changes from day to day", new Set(leftOut).size > 1, leftOut.join(","));
await q(`update senders set warmup_receive_max=3 where id=$1`, [ids[PARTNER]]);

// Leave the test account as the README describes it.
await q(`update settings set window_start='09:00', window_end='17:00', timezone='America/New_York', weekdays_only=true where user_id=$1`, [admin.id]);
await q(`update senders set warmup_reply_rate=35, daily_limit = case when email=$2 then 10 else 60 end where user_id=$1 and email = any($3)`, [admin.id, PARTNER, [...SENDERS, PARTNER]]);

console.log(`\n${failures ? `${failures} FAILED` : "ALL PASSED"}`);
await db.end();
process.exit(failures ? 1 : 0);
