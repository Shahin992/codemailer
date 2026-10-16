// Turn SMTP / IMAP errors into a category the send job can act on, and a message a person can read.

type MailError = Error & {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
};

export type SmtpErrorKind = "auth" | "sender_limit" | "rate_limit" | "recipient" | "rejected" | "temporary";

export function classifySmtpError(err: unknown): SmtpErrorKind {
  const e = err as MailError;
  const response = `${e.response ?? ""} ${e.message ?? ""}`;
  const code = e.responseCode ?? 0;
  if (e.code === "EAUTH" || code === 535 || code === 534) return "auth";
  if (/5\.4\.5|sending (quota|limit)|daily (user )?sending|limit exceeded|too many messages/i.test(response)) return "sender_limit";
  if (code === 421 || (code === 450 && /rate/i.test(response)) || /4\.7\.\d/.test(response)) return "rate_limit";
  if (code >= 500 && e.code === "EENVELOPE") return "recipient";
  if (code >= 500) return "rejected";
  return "temporary";
}

export function describeMailError(err: unknown): string {
  const stage = (err as { stage?: string }).stage;
  const text = describe(err);
  return stage ? `${stage}: ${text}` : text;
}

function describe(err: unknown): string {
  const e = err as MailError;
  if (e.code === "EAUTH" || e.authenticationFailed || e.serverResponseCode === "AUTHENTICATIONFAILED") {
    return "Login failed: the username or password is wrong. Gmail and Yahoo need an app password, not the normal password.";
  }
  if (e.code === "ENOTFOUND") return "Mail server not found. Check the server name.";
  if (e.code === "ECONNREFUSED") return "The mail server refused the connection. Check the port.";
  if (e.code === "ETLS" || e.command === "STARTTLS" || (/STARTTLS/i.test(e.message ?? "") && /not support|unavailable|missing/i.test(e.message ?? ""))) {
    return "The server doesn't offer STARTTLS. Try SSL/TLS instead (port 465 for SMTP, 993 for IMAP).";
  }
  if (e.code === "ESOCKET" && /wrong version number|ssl3_get_record|packet length too long/i.test(e.message ?? "")) {
    return "Encryption mismatch: this port expects a different setting. Use SSL/TLS on 465 and STARTTLS on 587.";
  }
  if (e.code === "ETIMEDOUT" || e.code === "ETIMEOUT" || e.code === "ECONNECTION") {
    return "Could not reach the mail server (timed out). Check the server name and port, and that this server allows outgoing mail.";
  }
  const text = (e.response || e.message || String(err)).replace(/\s+/g, " ").trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export function isAuthError(err: unknown): boolean {
  const e = err as MailError;
  return e.code === "EAUTH" || Boolean(e.authenticationFailed) || e.serverResponseCode === "AUTHENTICATIONFAILED";
}
