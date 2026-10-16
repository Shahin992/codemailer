import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { decryptSecret } from "@/lib/crypto";
import type { ImapFolderState, Security, Sender } from "@/lib/db/schema";

export type MailboxConfig = {
  email: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  smtpUser: string;
  /** null for send-only mailboxes (no inbox to read) */
  imap: { host: string; port: number; security: Security; user: string } | null;
};

// nodemailer 10 doesn't export its options type from the package root; derive it from sendMail.
export type MailOptions = Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0];

export function configFromSender(sender: Sender): MailboxConfig {
  const smtpUser = sender.smtpUser || sender.email;
  return {
    email: sender.email,
    password: decryptSecret(sender.passwordEnc),
    smtpHost: sender.smtpHost,
    smtpPort: sender.smtpPort,
    smtpSecurity: sender.smtpSecurity,
    smtpUser,
    imap:
      sender.readInbox && sender.imapHost && sender.imapPort
        ? { host: sender.imapHost, port: sender.imapPort, security: sender.imapSecurity, user: sender.imapUser || smtpUser }
        : null,
  };
}

export function createSmtp(cfg: MailboxConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    // EHLO name. The default is the machine name (in Docker a random container id), which ends up in
    // the first Received header and reads as a spam signal; the mailbox's own domain is a real hostname.
    name: cfg.email.slice(cfg.email.lastIndexOf("@") + 1).toLowerCase(),
    secure: cfg.smtpSecurity === "ssl",
    requireTLS: cfg.smtpSecurity === "starttls", // never send the password unencrypted unless "none" was chosen
    ignoreTLS: cfg.smtpSecurity === "none",
    auth: { user: cfg.smtpUser, pass: cfg.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** Build the full raw email once, so the same bytes are sent and saved to Sent. */
export async function buildRawEmail(mail: MailOptions): Promise<Buffer> {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info = await composer.sendMail(mail);
  return info.message as Buffer;
}

export async function sendRawEmail(cfg: MailboxConfig, envelope: { from: string; to: string }, raw: Buffer) {
  const transport = createSmtp(cfg);
  try {
    return await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
}

export async function withImap<T>(cfg: MailboxConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!cfg.imap) throw new Error(`${cfg.email} is send-only; it has no inbox to read.`);
  const client = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.security === "ssl",
    doSTARTTLS: cfg.imap.security === "starttls" ? true : cfg.imap.security === "none" ? false : undefined,
    auth: { user: cfg.imap.user, pass: cfg.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function findFolders(client: ImapFlow): Promise<{ sent?: string; junk?: string }> {
  const list = await client.list();
  const sent =
    list.find((f) => f.specialUse === "\\Sent")?.path ??
    list.find((f) => /^(inbox[./])?sent( items| messages| mail)?$/i.test(f.path))?.path;
  const junk =
    list.find((f) => f.specialUse === "\\Junk")?.path ??
    list.find((f) => /^(inbox[./])?(spam|junk)( e-?mail)?$/i.test(f.path))?.path;
  return { sent, junk };
}

/** Where a folder is now, so the inbox check only reads mail that arrives later. */
export async function folderState(client: ImapFlow, folder: string): Promise<ImapFolderState> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) throw new Error(`Could not open ${folder}`);
    return { uidValidity: String(box.uidValidity), lastUid: Math.max((box.uidNext ?? 1) - 1, 0) };
  } finally {
    lock.release();
  }
}

export type ConnectionTestResult = {
  sentFolder?: string;
  junkFolder?: string;
  imapState: Record<string, ImapFolderState>;
};

/** Log in to SMTP (and IMAP if the mailbox has an inbox), find the Sent and Spam folders, and mark where the inbox is now. */
export async function testConnection(cfg: MailboxConfig): Promise<ConnectionTestResult> {
  const transport = createSmtp(cfg);
  try {
    await transport.verify();
  } catch (err) {
    throw Object.assign(err as Error, { stage: "SMTP" });
  } finally {
    transport.close();
  }
  if (!cfg.imap) return { imapState: {} };
  return withImap(cfg, async (client) => {
    const { sent, junk } = await findFolders(client);
    const imapState: Record<string, ImapFolderState> = { INBOX: await folderState(client, "INBOX") };
    if (junk) imapState[junk] = await folderState(client, junk);
    return { sentFolder: sent, junkFolder: junk, imapState };
  });
}

export async function appendToSent(cfg: MailboxConfig, folder: string, raw: Buffer) {
  await withImap(cfg, (client) => client.append(folder, raw, ["\\Seen"]));
}
