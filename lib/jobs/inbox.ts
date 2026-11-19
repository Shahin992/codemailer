import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { ImapFlow } from "imapflow";
import { db } from "@/lib/db";
import { senders, warmupMessages, type ImapState, type Sender } from "@/lib/db/schema";
import { configFromSender, withImap } from "@/lib/mail/connection";
import { describeMailError, isAuthError } from "@/lib/mail/errors";
import { processInbound, type InboundResult } from "@/lib/mail/inbound";
import { markRescued } from "@/lib/warmup/inbound";

const MAX_PER_FOLDER = 200;
const STAR_RATE = 0.2; // share of warm-up emails a partner mailbox stars
const IMPORTANT_RATE = 0.25; // and marks important (Gmail only)
const INBOX_ERROR = "Inbox check failed:";

type Counts = Record<InboundResult, number>;

async function checkMailbox(sender: Sender, counts: Counts) {
  const cfg = configFromSender(sender);
  const state: ImapState = { ...sender.imapState };
  const folders = ["INBOX", ...(sender.junkFolder ? [sender.junkFolder] : [])];

  await withImap(cfg, async (client) => {
    for (const folder of folders) {
      const fetched: { uid: number; source: Buffer }[] = [];
      // readOnly opens the folder with EXAMINE: unread mail stays unread and nothing can be changed.
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const box = client.mailbox;
        if (!box) continue;
        const uidValidity = String(box.uidValidity);
        const latestUid = Math.max((box.uidNext ?? 1) - 1, 0);
        const prev = state[folder];
        if (!prev || prev.uidValidity !== uidValidity) {
          state[folder] = { uidValidity, lastUid: latestUid }; // first look: start from now
          continue;
        }
        if (latestUid <= prev.lastUid) continue;
        for await (const msg of client.fetch(`${prev.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= prev.lastUid || !msg.source) continue;
          fetched.push({ uid: msg.uid, source: msg.source });
          if (fetched.length >= MAX_PER_FOLDER) break;
        }
      } finally {
        lock.release();
      }

      // Process after the fetch finishes; IMAP commands can't run inside a fetch loop.
      let lastUid = state[folder]?.lastUid ?? 0;
      const warmup: { uid: number; id: string }[] = [];
      for (const { uid, source } of fetched.sort((a, b) => a.uid - b.uid)) {
        counts[await processInbound(sender, source, folder, uid, (id) => warmup.push({ uid, id }))]++;
        lastUid = Math.max(lastUid, uid);
        state[folder] = { uidValidity: state[folder].uidValidity, lastUid };
      }
      if (warmup.length) await tidyWarmup(client, sender, folder, warmup);
    }
    if (sender.junkFolder) await retryRescues(client, sender, sender.junkFolder);
  });

  await db
    .update(senders)
    .set({
      imapState: state,
      lastCheckedAt: new Date(),
      // A passing check clears an earlier inbox error (e.g. a brief DNS or network failure); sending errors stay.
      ...(sender.lastError?.startsWith(INBOX_ERROR) ? { lastError: null, lastErrorAt: null } : {}),
    })
    .where(eq(senders.id, sender.id));
}

/**
 * Warm-up emails only (other mail is never touched): mark them read, and move the ones that landed in spam
 * back to the inbox, which tells the provider they aren't spam. A failure here doesn't stop the inbox check;
 * spam moves that failed are tried again later by retryRescues.
 */
async function tidyWarmup(client: ImapFlow, sender: Sender, folder: string, found: { uid: number; id: string }[]) {
  const uids = found.map((f) => f.uid).join(",");
  try {
    const lock = await client.getMailboxLock(folder); // read-write, unlike the reading above
    try {
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      // Partner mailboxes (people's own accounts, e.g. Gmail) now and then star one or mark it important,
      // as people do with mail they care about. Done before a move, so the flags travel with the email.
      if (sender.warmupRole === "partner") {
        const starred = found.filter(() => Math.random() < STAR_RATE).map((f) => f.uid);
        if (starred.length) await client.messageFlagsAdd(starred.join(","), ["\\Flagged"], { uid: true });
        const important = found.filter(() => Math.random() < IMPORTANT_RATE).map((f) => f.uid);
        if (important.length && client.capabilities.has("X-GM-EXT-1")) {
          await client.messageFlagsAdd(important.join(","), ["\\Important"], { uid: true, useLabels: true });
        }
      }
      if (folder.toUpperCase() !== "INBOX") {
        await client.messageMove(uids, "INBOX", { uid: true });
        await markRescued(found.map((f) => f.id));
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error(`[warmup] ${sender.email}: could not tidy warm-up emails in ${folder}: ${describeMailError(err)}`);
  }
}

/** Warm-up emails found in spam a while ago but not moved out yet: find them there by Message-ID and move them. */
async function retryRescues(client: ImapFlow, sender: Sender, junkFolder: string) {
  const pending = await db
    .select({ id: warmupMessages.id, messageIdHeader: warmupMessages.messageIdHeader })
    .from(warmupMessages)
    .where(
      and(
        eq(warmupMessages.toSenderId, sender.id),
        eq(warmupMessages.landedIn, "spam"),
        isNull(warmupMessages.rescuedAt),
        isNotNull(warmupMessages.messageIdHeader),
        lt(warmupMessages.receivedAt, sql`now() - interval '10 minutes'`),
        gt(warmupMessages.receivedAt, sql`now() - interval '3 days'`),
      ),
    )
    .limit(20);
  if (!pending.length) return;
  try {
    const lock = await client.getMailboxLock(junkFolder);
    try {
      for (const row of pending) {
        if (!row.messageIdHeader) continue; // an empty search would match the whole folder
        const uids = await client.search({ header: { "message-id": row.messageIdHeader } }, { uid: true });
        if (!uids || !uids.length) continue; // not there (any more): tried again until 3 days after it arrived
        await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
        await client.messageMove(uids, "INBOX", { uid: true });
        await markRescued([row.id]);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error(`[warmup] ${sender.email}: could not move warm-up emails out of ${junkFolder}: ${describeMailError(err)}`);
  }
}

/** Check every mailbox's inbox, or only one (when the inbox watcher saw new mail arrive there). */
export async function runInboxJob(onlySenderId?: string): Promise<string> {
  const list = await db
    .select()
    .from(senders)
    .where(and(eq(senders.readInbox, true), onlySenderId ? eq(senders.id, onlySenderId) : undefined)); // send-only mailboxes have no inbox
  const counts: Counts = { reply: 0, auto_reply: 0, bounce: 0, unsubscribe: 0, ignored: 0, duplicate: 0, warmup: 0 };
  let errors = 0;

  for (const sender of list) {
    try {
      await checkMailbox(sender, counts);
    } catch (err) {
      errors++;
      const message = `${INBOX_ERROR} ${describeMailError(err)}`;
      await db
        .update(senders)
        .set({
          lastError: message,
          lastErrorAt: new Date(),
          lastCheckedAt: new Date(),
          ...(isAuthError(err) ? { status: "paused" as const } : {}),
        })
        .where(eq(senders.id, sender.id));
    }
  }

  return `checked ${list.length} mailboxes: ${counts.reply} replies, ${counts.auto_reply} auto-replies, ${counts.bounce} bounces, ${counts.unsubscribe} unsubscribes, ${counts.warmup} warm-up emails, ${counts.ignored} other emails, ${counts.duplicate} already saved, ${errors} errors`;
}
