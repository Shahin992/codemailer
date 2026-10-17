// Instant reply check. Keeps one IMAP connection per mailbox open in IDLE, so the mail server tells us the
// moment new mail reaches the inbox; that mailbox is then checked straight away, and a reply's push
// notification goes out within seconds instead of at the next scheduled inbox check (which still runs
// as a safety net, and also covers the spam folder). Runs inside the app server, started from instrumentation.ts.

import { and, eq } from "drizzle-orm";
import type { ImapFlow } from "imapflow";
import { db } from "@/lib/db";
import { senders, type Sender } from "@/lib/db/schema";
import { runInboxJob } from "@/lib/jobs/inbox";
import { runExclusive } from "@/lib/jobs/lock";
import { configFromSender, createImap } from "@/lib/mail/connection";
import { describeMailError } from "@/lib/mail/errors";

const RECONCILE_MS = 2 * 60_000; // pick up added, edited, paused and removed mailboxes
const CHECK_DELAY_MS = 2_000; // let a burst of new mail settle into one check
const BUSY_RETRY_MS = 15_000; // the inbox job was already running; look again shortly
const MAX_BACKOFF_MS = 10 * 60_000;

type Watch = {
  key: string;
  email: string;
  client: ImapFlow | null;
  stopped: boolean;
  failures: number;
  reconnect?: ReturnType<typeof setTimeout>;
  check?: ReturnType<typeof setTimeout>;
};

// Kept on globalThis so a reloaded module (in development) doesn't start a second set of connections.
const state = globalThis as typeof globalThis & { __inboxWatch?: { watches: Map<string, Watch>; timer: ReturnType<typeof setInterval> } };

/** Changes to any of these mean the connection has to be made again. */
function watchKey(s: Sender): string {
  return [s.imapHost, s.imapPort, s.imapSecurity, s.imapUser, s.smtpUser, s.passwordEnc].join("|");
}

function scheduleCheck(senderId: string, w: Watch, delay = CHECK_DELAY_MS) {
  if (w.stopped || w.check) return;
  w.check = setTimeout(async () => {
    w.check = undefined;
    const outcome = await runExclusive("inbox", 10, () => runInboxJob(senderId)).catch((err) => ({ ran: true, error: String(err) }));
    if (!outcome.ran) scheduleCheck(senderId, w, BUSY_RETRY_MS);
    else if (outcome.error) console.error(`[inbox-watch] check of ${w.email} failed: ${outcome.error}`);
  }, delay);
}

async function connect(sender: Sender, w: Watch) {
  if (w.stopped) return;
  let client: ImapFlow;
  try {
    // IDLE starts a second after the inbox is opened and is renewed every 4 minutes, which also notices a dead connection.
    client = createImap(configFromSender(sender), { autoIdleDelay: 1_000, maxIdleTime: 4 * 60_000, socketTimeout: 5 * 60_000 });
  } catch (err) {
    console.error(`[inbox-watch] ${sender.email}: ${describeMailError(err)}`);
    return;
  }
  w.client = client;
  client.on("error", (err: unknown) => console.error(`[inbox-watch] ${w.email}: ${describeMailError(err)}`));
  client.on("exists", (data: { count: number; prevCount: number }) => {
    if (data.count > data.prevCount) scheduleCheck(sender.id, w);
  });
  client.on("close", () => {
    if (w.client === client) w.client = null;
    if (!w.stopped) retry(sender, w);
  });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    w.failures = 0;
    // Mail that arrived while the connection was down is picked up now rather than at the next scheduled check.
    scheduleCheck(sender.id, w);
  } catch (err) {
    console.error(`[inbox-watch] ${w.email}: could not watch the inbox: ${describeMailError(err)}`);
    client.close(); // fires "close", which schedules the retry
  }
}

function retry(sender: Sender, w: Watch) {
  if (w.stopped || w.reconnect) return;
  const delay = Math.min(30_000 * 2 ** w.failures, MAX_BACKOFF_MS);
  w.failures++;
  w.reconnect = setTimeout(() => {
    w.reconnect = undefined;
    void connect(sender, w);
  }, delay);
}

function stop(w: Watch) {
  w.stopped = true;
  clearTimeout(w.reconnect);
  clearTimeout(w.check);
  if (w.client) w.client.logout().catch(() => w.client?.close());
}

async function reconcile(watches: Map<string, Watch>) {
  // Paused mailboxes are left to the scheduled check: a wrong password would only fail here again and again.
  const list = await db
    .select()
    .from(senders)
    .where(and(eq(senders.readInbox, true), eq(senders.status, "active")));
  const wanted = new Map(list.filter((s) => s.imapHost && s.imapPort).map((s) => [s.id, s]));

  for (const [id, w] of watches) {
    const sender = wanted.get(id);
    if (!sender || watchKey(sender) !== w.key) {
      stop(w);
      watches.delete(id);
    }
  }
  for (const [id, sender] of wanted) {
    if (watches.has(id)) continue;
    const w: Watch = { key: watchKey(sender), email: sender.email, client: null, stopped: false, failures: 0 };
    watches.set(id, w);
    void connect(sender, w);
  }
}

/** Start watching every active mailbox's inbox. Safe to call more than once. Set INBOX_WATCH=off to disable. */
export function startInboxWatcher() {
  if (state.__inboxWatch || process.env.INBOX_WATCH === "off" || !process.env.DATABASE_URL) return;
  const watches = new Map<string, Watch>();
  const run = () => reconcile(watches).catch((err) => console.error("[inbox-watch] could not load mailboxes", err));
  state.__inboxWatch = { watches, timer: setInterval(run, RECONCILE_MS) };
  setTimeout(run, 5_000); // after the server has started
  console.log("[inbox-watch] watching inboxes for new replies");
}
