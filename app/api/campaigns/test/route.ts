import { and, eq } from "drizzle-orm";
import { convert as htmlToText } from "html-to-text";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getMemberSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders, testSends } from "@/lib/db/schema";
import { composeEmail } from "@/lib/mail/compose";
import { buildRawEmail, configFromSender, sendRawEmail } from "@/lib/mail/connection";
import { describeMailError } from "@/lib/mail/errors";
import { textToHtml } from "@/lib/merge";
import { isValidEmail, normalizeEmail } from "@/lib/recipients-parse";
import { getSettings } from "@/lib/settings";
import { emailLogo } from "@/lib/brand-logo";

const schema = z.object({
  senderId: z.string().uuid(),
  to: z.string().transform(normalizeEmail).refine(isValidEmail, "Enter a valid test address"),
  subject: z.string().trim().min(1, "Write a subject"),
  body: z.string().min(1, "Write the email body"),
  bodyFormat: z.enum(["text", "html"]),
  style: z.enum(["personal", "newsletter"]).default("personal"),
  sample: z
    .object({ email: z.string(), name: z.string().optional(), vars: z.record(z.string(), z.string()).optional() })
    .optional(),
});

/** Send the campaign email, filled in for the first recipient, to your own address. */
export async function POST(request: Request) {
  const me = await getMemberSession();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const [sender] = await db.select().from(senders).where(and(eq(senders.id, input.senderId), eq(senders.userId, me.id)));
  if (!sender) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  const settings = await getSettings(me.id);

  const isHtml = input.bodyFormat === "html";
  const sample = input.sample ?? { email: input.to, name: "" };
  try {
    const composed = await composeEmail({
      style: input.style,
      bodyFormat: input.bodyFormat,
      optOutLine: settings.optOutLine,
      sender,
      recipient: { email: input.to, name: sample.name ?? null },
      vars: { ...(sample.vars ?? {}), email: sample.email, ...(sample.name ? { name: sample.name } : {}) },
      subjectTemplate: `[Test] ${input.subject}`,
      bodyHtml: isHtml ? input.body : textToHtml(input.body),
      bodyText: isHtml ? htmlToText(input.body, { wordwrap: false }) : input.body,
      footerText: settings.footerText,
      logo: await emailLogo(settings, input.style),
    });
    const raw = await buildRawEmail(composed.mail);
    await sendRawEmail(configFromSender(sender), { from: sender.email, to: input.to }, raw);
    await db.insert(testSends).values({ senderId: sender.id, toEmail: input.to });
    return NextResponse.json({ ok: true, message: `Test sent to ${input.to} from ${sender.email}.` });
  } catch (err) {
    return NextResponse.json({ error: describeMailError(err) }, { status: 502 });
  }
}
