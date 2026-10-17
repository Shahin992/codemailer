import { randomUUID } from "node:crypto";
import { makeToken } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import type { EmailLogo } from "@/lib/brand-logo";
import type { MailOptions } from "@/lib/mail/connection";
import { buildVars, escapeHtml, fillFields } from "@/lib/merge";

export type EmailStyle = "personal" | "newsletter";

export type ComposeParts = {
  /**
   * personal: plain text like a one-to-one email, no unsubscribe header or link (people opt out by replying).
   * newsletter: HTML and text, unsubscribe link plus one-click unsubscribe header, tracking allowed.
   */
  style: EmailStyle;
  bodyFormat: "text" | "html";
  /** Personal style: the "just reply no" line under the message. */
  optOutLine: string;
  sender: { email: string; displayName: string | null };
  recipient: { email: string; name: string | null };
  vars: Record<string, string> | null;
  subjectTemplate: string;
  bodyHtml: string;
  bodyText: string;
  footerText: string;
  /** Logo shown above the footer text, like a signature (see lib/brand-logo.ts). */
  logo?: EmailLogo | null;
  /** Message row id; used for unsubscribe and tracking tokens. Absent for test emails. */
  messageId?: string;
  /** Set for follow-ups: the earlier email in the thread, newest last. */
  thread?: { subject: string; messageIds: string[] };
  /** Where replies should go when it isn't the sending address (send-only mailboxes). */
  replyTo?: string;
  trackOpens?: boolean;
  /** Rewrites a link for click tracking; returns the tracked URL. */
  trackLink?: (url: string) => Promise<string>;
};

export type ComposedEmail = {
  mail: MailOptions;
  subject: string;
  messageIdHeader: string;
};

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export function newMessageIdHeader(senderEmail: string): string {
  return `<${randomUUID()}@${domainOf(senderEmail)}>`;
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** The logo as an inline image: embedded in the email (cid:), so it shows without loading anything from the web. */
function logoParts(p: ComposeParts): { img: string; attachments: NonNullable<MailOptions["attachments"]> } | null {
  if (!p.logo) return null;
  const cid = `logo@${domainOf(p.sender.email)}`;
  const alt = escapeHtml(p.footerText.trim().split("\n")[0] || p.sender.displayName || "Logo");
  return {
    img:
      `<img src="cid:${cid}" width="${p.logo.width}" height="${p.logo.height}" alt="${alt}" ` +
      `style="display:block;border:0;outline:none;max-width:100%;width:${p.logo.width}px;height:auto">`,
    attachments: [{ filename: p.logo.filename, content: p.logo.content, contentType: p.logo.mime, cid, contentDisposition: "inline" }],
  };
}

async function rewriteLinks(html: string, track: (url: string) => Promise<string>, skip: string): Promise<string> {
  const pattern = /href\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;
  const urls = new Map<string, string>();
  for (const m of html.matchAll(pattern)) {
    const url = m[2].replace(/&amp;/g, "&");
    if (url !== skip && !urls.has(url)) urls.set(url, await track(url));
  }
  return html.replace(pattern, (whole, quote: string, raw: string) => {
    const tracked = urls.get(raw.replace(/&amp;/g, "&"));
    return tracked ? `href=${quote}${tracked}${quote}` : whole;
  });
}

export async function composeEmail(p: ComposeParts): Promise<ComposedEmail> {
  const vars = buildVars(p.recipient, p.vars);
  const subject = p.thread ? replySubject(p.thread.subject) : fillFields(p.subjectTemplate, vars).trim();
  const messageIdHeader = newMessageIdHeader(p.sender.email);
  const references = p.thread?.messageIds ?? [];
  const base: MailOptions = {
    from: p.sender.displayName ? { name: p.sender.displayName, address: p.sender.email } : p.sender.email,
    to: p.recipient.name ? { name: p.recipient.name, address: p.recipient.email } : p.recipient.email,
    subject,
    messageId: messageIdHeader,
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
    date: new Date(),
    ...(references.length ? { inReplyTo: references[references.length - 1], references: references.join(" ") } : {}),
  };

  const logo = logoParts(p);
  if (p.style === "personal") {
    return { mail: { ...base, ...personalBody(p, vars, logo?.img), ...(logo ? { attachments: logo.attachments } : {}) }, subject, messageIdHeader };
  }

  let html = fillFields(p.bodyHtml, vars, true);
  let text = fillFields(p.bodyText, vars);

  const unsubscribeUrl = p.messageId ? `${appUrl()}/u/${makeToken(p.messageId, "unsub")}` : `${appUrl()}/u/test`;
  const oneClickUrl = p.messageId ? `${appUrl()}/api/unsubscribe/${makeToken(p.messageId, "unsub")}` : unsubscribeUrl;

  if (p.trackLink) html = await rewriteLinks(html, p.trackLink, unsubscribeUrl);

  const footer = p.footerText.trim();
  text += `\n\n--\n${footer ? `${footer}\n` : ""}Unsubscribe: ${unsubscribeUrl}\n`;
  if (logo) html += `<div style="margin-top:24px">${logo.img}</div>`;
  html +=
    `<p style="margin-top:${logo ? 12 : 24}px;color:#888;font-size:12px;line-height:1.4">` +
    (footer ? `${escapeHtml(footer).replace(/\n/g, "<br>")}<br>` : "") +
    `<a href="${unsubscribeUrl}" style="color:#888">Unsubscribe</a></p>`;

  if (p.trackOpens && p.messageId) {
    html += `<img src="${appUrl()}/t/o/${makeToken(p.messageId, "track")}.gif" width="1" height="1" alt="" style="border:0">`;
  }

  const document =
    `<!doctype html><html><head><meta charset="utf-8"></head>` +
    `<body><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${html}</div></body></html>`;

  const mail: MailOptions = {
    ...base,
    text,
    html: document,
    ...(logo ? { attachments: logo.attachments } : {}),
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>, <mailto:${p.replyTo ?? p.sender.email}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  return { mail, subject, messageIdHeader };
}

/**
 * What a person typing in their mail app would send: a plain-text body (HTML only if the campaign
 * was written in HTML or there is a logo, and then without any template styling), the reply-to-opt-out
 * line and the footer as a plain signature, with the logo above it. No unsubscribe header, link, tracking
 * image or rewritten links: those are what make Gmail file mail under Promotions.
 */
function personalBody(p: ComposeParts, vars: Record<string, string>, logoImg?: string): Pick<MailOptions, "text" | "html"> {
  const optOut = p.optOutLine.trim();
  const footer = p.footerText.trim();
  const text = [fillFields(p.bodyText, vars).trim(), optOut, footer].filter(Boolean).join("\n\n") + "\n";
  if (p.bodyFormat === "text" && !logoImg) return { text };
  const paragraph = (line: string) => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`;
  const html =
    fillFields(p.bodyHtml, vars, true) +
    (optOut ? paragraph(optOut) : "") +
    (logoImg ? `<div style="margin-top:16px">${logoImg}</div>` : "") +
    (footer ? paragraph(footer) : "");
  return { text, html: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>` };
}
