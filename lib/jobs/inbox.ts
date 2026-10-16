import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { senders, type ImapState, type Sender } from "@/lib/db/schema";
import { configFromSender, withImap } from "@/lib/mail/connection";
import { describeMailError, isAuthError } from "@/lib/mail/errors";
import { processInbound, type InboundResult } from "@/lib/mail/inbound";

const MAX_PER_FOLDER = 200;

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
      for (const { uid, source } of fetched.sort((a, b) => a.uid - b.uid)) {
        counts[await processInbound(sender, source, folder, uid)]++;
        lastUid = Math.max(lastUid, uid);
        state[folder] = { uidValidity: state[folder].uidValidity, lastUid };
      }
    }
  });

  await db
    .update(senders)
    .set({ imapState: state, lastCheckedAt: new Date() })
    .where(eq(senders.id, sender.id));
}

export async function runInboxJob(): Promise<string> {
  const list = await db.select().from(senders).where(eq(senders.readInbox, true)); // send-only mailboxes have no inbox
  const counts: Counts = { reply: 0, auto_reply: 0, bounce: 0, unsubscribe: 0, ignored: 0, duplicate: 0 };
  let errors = 0;

  for (const sender of list) {
    try {
      await checkMailbox(sender, counts);
    } catch (err) {
      errors++;
      const message = `Inbox check failed: ${describeMailError(err)}`;
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

  return `checked ${list.length} mailboxes: ${counts.reply} replies, ${counts.auto_reply} auto-replies, ${counts.bounce} bounces, ${counts.unsubscribe} unsubscribes, ${errors} errors`;
}
