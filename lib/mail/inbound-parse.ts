// Pure helpers for reading incoming mail: bounce detection, auto-reply detection, quote stripping.
import type { ParsedMail } from "mailparser";

export function senderAddress(parsed: ParsedMail): { email: string; name: string } | null {
  const from = parsed.from?.value?.[0];
  if (!from?.address) return null;
  return { email: from.address.trim().toLowerCase(), name: (from.name ?? "").trim() };
}

export function isBounce(parsed: ParsedMail): boolean {
  const contentType = parsed.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  if (contentType?.value === "multipart/report" && /delivery-status/i.test(contentType.params?.["report-type"] ?? "")) {
    return true;
  }
  const from = senderAddress(parsed)?.email ?? "";
  if (/^(mailer-daemon|postmaster)@/.test(from)) return true;
  const subject = parsed.subject ?? "";
  return (
    /undeliver|delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery failure|failure notice/i.test(subject) &&
    /mailer-daemon|postmaster|mail delivery/i.test(parsed.from?.text ?? "")
  );
}

export type BounceInfo = {
  recipient?: string;
  status?: string; // e.g. 5.1.1
  diagnostic?: string;
  originalMessageIds: string[];
  hard: boolean;
};

export function parseBounce(raw: string, ownMessageId?: string): BounceInfo {
  const status = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(raw)?.[1];
  const recipient =
    /^Final-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+)>?/im.exec(raw)?.[1] ??
    /^Original-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+)>?/im.exec(raw)?.[1] ??
    /wasn't delivered to\s+<?([^\s<>]+@[^\s<>]+?)>?\s/i.exec(raw)?.[1] ??
    /^\s*<?([^\s<>@]+@[^\s<>]+?)>?:?\s*\n\s*(host|SMTP error|.*said:)/im.exec(raw)?.[1];
  const diagnostic = /^Diagnostic-Code:\s*(?:smtp;\s*)?(.+(?:\n[ \t]+.+)*)/im.exec(raw)?.[1]?.replace(/\s+/g, " ").trim();
  const own = ownMessageId?.trim().toLowerCase();
  const originalMessageIds = [...raw.matchAll(/^Message-ID:\s*(<[^>\s]+>)/gim)]
    .map((m) => m[1])
    .filter((id) => id.toLowerCase() !== own);
  const softCode = status?.startsWith("4") ?? false;
  return {
    recipient: recipient?.toLowerCase(),
    status,
    diagnostic,
    originalMessageIds,
    hard: !softCode,
  };
}

export function isAutoReply(parsed: ParsedMail): boolean {
  const h = parsed.headers;
  const autoSubmitted = String(h.get("auto-submitted") ?? "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (h.has("x-autoreply") || h.has("x-autorespond")) return true;
  if (/auto_reply/i.test(String(h.get("precedence") ?? ""))) return true;
  return /^(auto(matic)?[ -]?reply|out of (the )?office|autoreply|away from)/i.test((parsed.subject ?? "").trim());
}

const OPT_OUT =
  /^(please )?(no|nope|stop|unsubscribe( me)?|opt ?out|remove( me)?( from (your|this|the) (list|mailing list))?|take me off( your| this| the)?( list| mailing list)?|not interested|no thanks?|no thank you|do not (email|contact) me( again)?|dont (email|contact) me( again)?|stop (emailing|contacting) me)( please)?( thanks?| thank you)?( not interested)?$/;

/**
 * "No thanks", "Stop", "Please remove me"… in reply to a personal-style email means "don't email me again".
 * Only short replies whose first line is clearly an opt-out count, so a real conversation is never cut off.
 */
export function isOptOutReply(replyText: string): boolean {
  const text = replyText.trim();
  if (!text || text.length > 200) return false;
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const normalized = firstLine
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return OPT_OUT.test(normalized);
}

/** Keep only the new part of a reply: stop at the quoted history. */
export function extractReplyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    if (/^On .+/i.test(line) && (/wrote:$/i.test(line) || /wrote:$/i.test(next))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^_{10,}$/.test(line)) break;
    if (/^From:\s.+/i.test(line) && out.some((l) => l.trim())) break;
    if (/^>/.test(line) && out.some((l) => l.trim())) break;
    out.push(lines[i]);
  }
  const reply = out.join("\n").trim();
  return reply || text.trim();
}

export function messageIdList(parsed: ParsedMail): string[] {
  const refs = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [];
  const ids = [parsed.inReplyTo ?? "", ...refs]
    .flatMap((value) => value.match(/<[^>\s]+>/g) ?? [])
    .map((id) => id.trim());
  return [...new Set(ids)];
}
