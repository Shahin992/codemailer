// Mailbox presets. Safe to import in client components.
import type { Provider, Security } from "@/lib/db/schema";

export type ProviderPreset = {
  label: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  saveToSent: boolean; // Gmail files SMTP mail in Sent by itself; most other hosts do not
  dailyLimit: number; // safe starting limit
  passwordLabel: string;
  help: string;
};

export const PROVIDER_PRESETS: Record<Provider, ProviderPreset> = {
  hostinger: {
    label: "Hostinger (business)",
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecurity: "ssl",
    saveToSent: true,
    dailyLimit: 20,
    passwordLabel: "Mailbox password",
    help: "Use the mailbox password from hPanel → Emails → Mailboxes.",
  },
  gmail: {
    label: "Gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "ssl",
    saveToSent: false,
    dailyLimit: 10,
    passwordLabel: "App password",
    help: "Turn on 2-Step Verification, then create a 16-character app password at myaccount.google.com/apppasswords. Your normal Gmail password will not work.",
  },
  custom: {
    label: "Any SMTP server",
    smtpHost: "",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "",
    imapPort: 993,
    imapSecurity: "ssl",
    saveToSent: true,
    dailyLimit: 20,
    passwordLabel: "Password",
    help: "The password (or app password / SMTP key) your mail host gives you.",
  },
};

export const SECURITY_LABELS: Record<Security, string> = {
  ssl: "SSL/TLS",
  starttls: "STARTTLS",
  none: "None (not encrypted)",
};

/** The usual encryption for a port, used when someone changes the port. */
export function securityForPort(port: number, kind: "smtp" | "imap"): Security {
  return port === (kind === "smtp" ? 465 : 993) ? "ssl" : "starttls";
}

export type SmtpTemplate = {
  label: string;
  smtpHost: string; // "{domain}" is replaced with the mailbox's domain
  smtpPort: number;
  smtpSecurity: Security;
  smtpUser?: string; // fixed username, e.g. SendGrid's "apikey"
  imap?: { host: string; port: number; security: Security };
  note: string;
};

// One-click fill-ins for the "Any SMTP server" form.
export const SMTP_TEMPLATES: SmtpTemplate[] = [
  {
    label: "cPanel / shared hosting",
    smtpHost: "mail.{domain}",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "mail.{domain}", port: 993, security: "ssl" },
    note: "Most hosting control panels use mail.yourdomain.com. Check your host's email settings page if it doesn't connect.",
  },
  {
    label: "Zoho Mail",
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "imap.zoho.com", port: 993, security: "ssl" },
    note: "Paid Zoho organisations may need smtppro.zoho.com and imappro.zoho.com. With 2FA on, use an app password.",
  },
  {
    label: "Titan Email",
    smtpHost: "smtp.titan.email",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "imap.titan.email", port: 993, security: "ssl" },
    note: "Use the mailbox password.",
  },
  {
    label: "Namecheap Private Email",
    smtpHost: "mail.privateemail.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "mail.privateemail.com", port: 993, security: "ssl" },
    note: "Use the mailbox password.",
  },
  {
    label: "GoDaddy Workspace Email",
    smtpHost: "smtpout.secureserver.net",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "imap.secureserver.net", port: 993, security: "ssl" },
    note: "For Workspace Email only. GoDaddy's Microsoft 365 mailboxes need Microsoft sign-in, which isn't supported yet.",
  },
  {
    label: "Yahoo Mail",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "ssl" },
    note: "Needs an app password from Yahoo Account Security.",
  },
  {
    label: "iCloud Mail",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    imap: { host: "imap.mail.me.com", port: 993, security: "ssl" },
    note: "Needs an app-specific password from account.apple.com.",
  },
  {
    label: "Amazon SES (send only)",
    smtpHost: "email-smtp.us-east-1.amazonaws.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    note: "Change the region to your SES region. Username and password are SES SMTP credentials, not your AWS login. Bulk services forbid cold outreach to people who didn't opt in.",
  },
  {
    label: "Brevo (send only)",
    smtpHost: "smtp-relay.brevo.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    note: "Username is your Brevo SMTP login; password is an SMTP key. Bulk services forbid cold outreach to people who didn't opt in.",
  },
  {
    label: "SendGrid (send only)",
    smtpHost: "smtp.sendgrid.net",
    smtpPort: 587,
    smtpSecurity: "starttls",
    smtpUser: "apikey",
    note: "Username is literally “apikey”; password is a SendGrid API key. Bulk services forbid cold outreach to people who didn't opt in.",
  },
];

export const UNSUPPORTED_NOTE =
  "Outlook.com and Microsoft 365 no longer accept passwords over SMTP/IMAP, so they need Microsoft sign-in, which isn't supported yet.";
