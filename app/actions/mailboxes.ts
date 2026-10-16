"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { messages, PROVIDERS, SECURITY, senders, testSends, type ImapState, type Sender } from "@/lib/db/schema";
import { appendToSent, buildRawEmail, configFromSender, sendRawEmail, testConnection, type MailboxConfig } from "@/lib/mail/connection";
import { describeMailError } from "@/lib/mail/errors";
import { PROVIDER_PRESETS, securityForPort } from "@/lib/providers";
import { isValidEmail, normalizeEmail } from "@/lib/recipients-parse";
import { APP_NAME } from "@/lib/brand";

export type MailboxFormState = { error?: string; fieldErrors?: Record<string, string> };
export type MailboxActionState = { error?: string; message?: string };

const formSchema = z.object({
  id: z.string().optional(),
  provider: z.enum(PROVIDERS),
  email: z.string().transform(normalizeEmail).refine(isValidEmail, "Enter a valid email address"),
  displayName: z.string().trim().max(120).optional(),
  password: z.string().optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecurity: z.enum(SECURITY).optional(),
  smtpUser: z.string().trim().max(320).optional(),
  readInbox: z.boolean(),
  imapHost: z.string().trim().optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecurity: z.enum(SECURITY).optional(),
  imapUser: z.string().trim().max(320).optional(),
  replyToSenderId: z.string().uuid().optional(),
  dailyLimit: z.coerce.number().int().min(1, "At least 1").max(2000, "Too high for outreach"),
  sendTestTo: z.string().optional(),
});

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Keep inbox positions for folders that still exist unchanged, so nothing is read twice or skipped. */
function mergeImapState(previous: ImapState, fresh: ImapState): ImapState {
  const merged: ImapState = { ...fresh };
  for (const [folder, state] of Object.entries(fresh)) {
    const old = previous[folder];
    if (old && old.uidValidity === state.uidValidity) merged[folder] = old;
  }
  return merged;
}

async function sendTestMessage(
  senderId: string,
  cfg: MailboxConfig,
  sender: Pick<Sender, "displayName" | "saveToSent" | "sentFolder">,
  to: string,
) {
  const raw = await buildRawEmail({
    from: sender.displayName ? { name: sender.displayName, address: cfg.email } : cfg.email,
    to,
    subject: `Test email from ${APP_NAME}`,
    text: `This test was sent from ${cfg.email} through ${cfg.smtpHost}.\n\nIf you can read this, the mailbox is connected.`,
  });
  await sendRawEmail(cfg, { from: cfg.email, to }, raw);
  await db.insert(testSends).values({ senderId, toEmail: to });
  if (sender.saveToSent && sender.sentFolder) await appendToSent(cfg, sender.sentFolder, raw).catch(() => undefined);
}

export async function saveMailbox(_prev: MailboxFormState, formData: FormData): Promise<MailboxFormState> {
  await requireSession();
  const parsed = formSchema.safeParse({
    id: field(formData, "id"),
    provider: field(formData, "provider"),
    email: field(formData, "email") ?? "",
    displayName: field(formData, "displayName"),
    password: field(formData, "password"),
    smtpHost: field(formData, "smtpHost"),
    smtpPort: field(formData, "smtpPort"),
    smtpSecurity: field(formData, "smtpSecurity"),
    smtpUser: field(formData, "smtpUser"),
    readInbox: formData.get("provider") !== "custom" || formData.get("readInbox") === "on",
    imapHost: field(formData, "imapHost"),
    imapPort: field(formData, "imapPort"),
    imapSecurity: field(formData, "imapSecurity"),
    imapUser: field(formData, "imapUser"),
    replyToSenderId: field(formData, "replyToSenderId"),
    dailyLimit: field(formData, "dailyLimit") ?? "",
    sendTestTo: field(formData, "sendTestTo"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;
  const existing = input.id ? (await db.select().from(senders).where(eq(senders.id, input.id)))[0] : undefined;
  if (input.id && !existing) return { error: "Mailbox not found." };

  const preset = PROVIDER_PRESETS[input.provider];
  const isCustom = input.provider === "custom";
  const readInbox = input.readInbox;

  const smtpHost = isCustom ? input.smtpHost : preset.smtpHost;
  const smtpPort = isCustom ? (input.smtpPort ?? preset.smtpPort) : preset.smtpPort;
  const smtpSecurity = isCustom ? (input.smtpSecurity ?? securityForPort(smtpPort, "smtp")) : preset.smtpSecurity;
  const smtpUser = isCustom && input.smtpUser && input.smtpUser.toLowerCase() !== input.email ? input.smtpUser : null;

  const imapHost = !readInbox ? null : isCustom ? input.imapHost : preset.imapHost;
  const imapPort = !readInbox ? null : isCustom ? (input.imapPort ?? preset.imapPort) : preset.imapPort;
  const imapSecurity = isCustom && readInbox ? (input.imapSecurity ?? securityForPort(imapPort ?? 993, "imap")) : preset.imapSecurity;
  const imapUser = isCustom && readInbox && input.imapUser && input.imapUser !== (smtpUser ?? input.email) ? input.imapUser : null;

  if (!smtpHost) return { error: "Enter the SMTP server.", fieldErrors: { smtpHost: "Required" } };
  if (readInbox && !imapHost) return { error: "Enter the IMAP server, or turn off reading replies.", fieldErrors: { imapHost: "Required" } };

  let replyToSenderId: string | null = null;
  if (!readInbox && input.replyToSenderId) {
    const [target] = await db.select().from(senders).where(eq(senders.id, input.replyToSenderId));
    if (!target || target.id === existing?.id || !target.readInbox) {
      return { error: "Replies must go to a mailbox whose inbox ColdMailer reads.", fieldErrors: { replyToSenderId: "Pick another mailbox" } };
    }
    replyToSenderId = target.id;
  }

  const password = input.password ?? (existing ? configFromSender(existing).password : undefined);
  if (!password) return { error: "Enter the password.", fieldErrors: { password: "Required" } };

  const cfg: MailboxConfig = {
    email: input.email,
    password,
    smtpHost,
    smtpPort,
    smtpSecurity,
    smtpUser: smtpUser ?? input.email,
    imap: readInbox && imapHost && imapPort ? { host: imapHost, port: imapPort, security: imapSecurity, user: imapUser ?? smtpUser ?? input.email } : null,
  };

  let test;
  try {
    test = await testConnection(cfg);
  } catch (err) {
    return { error: `Connection test failed. ${describeMailError(err)}` };
  }

  const values = {
    email: input.email,
    displayName: input.displayName ?? null,
    provider: input.provider,
    smtpHost,
    smtpPort,
    smtpSecurity,
    smtpSecure: smtpSecurity === "ssl",
    smtpUser,
    readInbox,
    imapHost,
    imapPort,
    imapSecurity,
    imapUser,
    replyToSenderId,
    passwordEnc: encryptSecret(password),
    saveToSent: readInbox && preset.saveToSent && Boolean(test.sentFolder),
    sentFolder: test.sentFolder ?? null,
    junkFolder: test.junkFolder ?? null,
    dailyLimit: input.dailyLimit,
    imapState: readInbox ? (existing ? mergeImapState(existing.imapState, test.imapState) : test.imapState) : {},
    lastError: null,
    lastErrorAt: null,
  };

  let id = existing?.id;
  try {
    if (existing) {
      await db.update(senders).set(values).where(eq(senders.id, existing.id));
    } else {
      const [row] = await db.insert(senders).values(values).returning({ id: senders.id });
      id = row.id;
    }
  } catch (err) {
    if (String((err as { code?: string }).code) === "23505") return { error: "This mailbox is already added." };
    throw err;
  }

  let testNote = "";
  if (input.sendTestTo) {
    const to = normalizeEmail(input.sendTestTo);
    try {
      await sendTestMessage(id!, cfg, values, to);
      testNote = `&test=${encodeURIComponent(to)}`;
    } catch (err) {
      testNote = `&testError=${encodeURIComponent(describeMailError(err))}`;
    }
  }

  revalidatePath("/mailboxes");
  redirect(`/mailboxes/${id}?saved=1${testNote}`);
}

async function loadSender(id: string): Promise<Sender> {
  const [sender] = await db.select().from(senders).where(eq(senders.id, id));
  if (!sender) throw new Error("Mailbox not found");
  return sender;
}

export async function retestMailbox(id: string, _prev: MailboxActionState): Promise<MailboxActionState> {
  await requireSession();
  const sender = await loadSender(id);
  try {
    const test = await testConnection(configFromSender(sender));
    await db
      .update(senders)
      .set({
        lastError: null,
        lastErrorAt: null,
        sentFolder: test.sentFolder ?? sender.sentFolder,
        junkFolder: test.junkFolder ?? sender.junkFolder,
        imapState: mergeImapState(sender.imapState, test.imapState),
      })
      .where(eq(senders.id, id));
    revalidatePath(`/mailboxes/${id}`);
    return { message: sender.status === "paused" ? "Connection works. Resume the mailbox to start sending again." : "Connection works." };
  } catch (err) {
    const error = describeMailError(err);
    await db.update(senders).set({ lastError: error, lastErrorAt: new Date() }).where(eq(senders.id, id));
    revalidatePath(`/mailboxes/${id}`);
    return { error };
  }
}

export async function sendMailboxTest(id: string, _prev: MailboxActionState, formData: FormData): Promise<MailboxActionState> {
  await requireSession();
  const to = normalizeEmail(String(formData.get("to") ?? ""));
  if (!isValidEmail(to)) return { error: "Enter a valid email address." };
  const sender = await loadSender(id);
  try {
    await sendTestMessage(sender.id, configFromSender(sender), sender, to);
    return { message: `Test email sent to ${to}. Check that inbox (and its spam folder).` };
  } catch (err) {
    return { error: describeMailError(err) };
  }
}

export async function setMailboxStatus(id: string, status: "active" | "paused") {
  await requireSession();
  await db
    .update(senders)
    .set(status === "active" ? { status, nextSendAt: sql`least(${senders.nextSendAt}, now())`, lastError: null, lastErrorAt: null } : { status })
    .where(eq(senders.id, id));
  revalidatePath("/mailboxes");
  revalidatePath(`/mailboxes/${id}`);
}

export async function deleteMailbox(id: string, _prev: MailboxActionState): Promise<MailboxActionState> {
  await requireSession();
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.senderId, id));
  if (used.n > 0) {
    return { error: "This mailbox has already sent emails, so it's kept for your history. Pause it instead." };
  }
  await db.delete(senders).where(eq(senders.id, id));
  revalidatePath("/mailboxes");
  redirect("/mailboxes");
}
