import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

export type ImapFolderState = { uidValidity: string; lastUid: number };
export type ImapState = Record<string, ImapFolderState>;
export type AttachmentMeta = { name: string; size: number; mime: string; path: string };

export const PROVIDERS = ["hostinger", "gmail", "custom"] as const;
export type Provider = (typeof PROVIDERS)[number];

// How to connect: "ssl" = TLS from the start (465/993), "starttls" = upgrade on 587/143, "none" = no encryption.
export const SECURITY = ["ssl", "starttls", "none"] as const;
export type Security = (typeof SECURITY)[number];

export const MESSAGE_STATUSES = ["queued", "sending", "sent", "bounced", "replied", "failed", "cancelled"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// People who can sign in. Anyone can sign up, but a new account stays "pending" (can't sign in) until the
// super admin approves it. Each member account has its own private workspace (mailboxes, campaigns,
// recipients, replies, do-not-send list and settings). The super admin has no workspace: it signs in on
// /superadmin/login and only approves, disables and removes accounts.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored lower-case
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(), // scrypt
  role: text("role", { enum: ["superadmin", "member"] }).notNull().default("member"),
  status: text("status", { enum: ["active", "pending", "disabled"] }).notNull().default("pending"),
  lastLoginAt: timestamp("last_login_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

// Your mailboxes: Hostinger, Gmail, or any SMTP server (optionally with IMAP for replies)
export const senders = pgTable("senders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // the account it belongs to
  email: text("email").notNull(), // unique per account; the same mailbox may be connected to two accounts
  displayName: text("display_name"),
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpSecure: boolean("smtp_secure").notNull().default(true), // kept in sync with smtp_security = 'ssl'
  smtpSecurity: text("smtp_security", { enum: SECURITY }).notNull().default("ssl"),
  smtpUser: text("smtp_user"), // null = the email address
  readInbox: boolean("read_inbox").notNull().default(true), // false = send-only (no IMAP)
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapSecurity: text("imap_security", { enum: SECURITY }).notNull().default("ssl"),
  imapUser: text("imap_user"), // null = the SMTP username
  // For send-only mailboxes: replies go to this mailbox (Reply-To), which is read instead.
  replyToSenderId: uuid("reply_to_sender_id").references((): AnyPgColumn => senders.id, { onDelete: "set null" }),
  passwordEnc: text("password_enc").notNull(), // AES-256-GCM, key in ENCRYPTION_KEY
  saveToSent: boolean("save_to_sent").notNull().default(false),
  sentFolder: text("sent_folder"),
  junkFolder: text("junk_folder"),
  dailyLimit: integer("daily_limit").notNull().default(20), // emails per rolling 24 hours
  nextSendAt: timestamp("next_send_at", tz).notNull().defaultNow(), // this mailbox's next turn
  // Set when the provider says "limit exceeded" or "too many": no email at all (not even one with a set time) until then.
  restUntil: timestamp("rest_until", tz),
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", tz),
  imapState: jsonb("imap_state").$type<ImapState>().notNull().default(sql`'{}'::jsonb`),
  lastCheckedAt: timestamp("last_checked_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
}, (t) => [uniqueIndex("senders_user_email_idx").on(t.userId, t.email)]);

// Everyone you have emailed, and the mailbox that always emails them
export const recipients = pgTable("recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // the account it belongs to
  email: text("email").notNull(), // stored lower-case
  name: text("name"),
  senderId: uuid("sender_id").references(() => senders.id, { onDelete: "set null" }),
  status: text("status", { enum: ["active", "replied", "bounced", "unsubscribed"] }).notNull().default("active"),
  firstContactAt: timestamp("first_contact_at", tz),
  lastContactAt: timestamp("last_contact_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("recipients_user_email_idx").on(t.userId, t.email),
  index("recipients_last_contact_idx").on(t.lastContactAt),
  index("recipients_status_idx").on(t.status),
]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // the account it belongs to
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  bodyFormat: text("body_format", { enum: ["text", "html"] }).notNull().default("text"),
  // personal: plain text, opt out by replying (lands in Primary). newsletter: HTML + unsubscribe link/header + tracking.
  style: text("style", { enum: ["personal", "newsletter"] }).notNull().default("personal"),
  bodyHtml: text("body_html").notNull(),
  bodyText: text("body_text").notNull(),
  followUpOf: uuid("follow_up_of").references((): AnyPgColumn => campaigns.id),
  trackOpens: boolean("track_opens").notNull().default(false),
  trackClicks: boolean("track_clicks").notNull().default(false),
  windowStart: text("window_start").notNull().default("09:00"),
  windowEnd: text("window_end").notNull().default("17:00"),
  timezone: text("timezone").notNull().default("America/New_York"),
  weekdaysOnly: boolean("weekdays_only").notNull().default(true),
  // draft: a large list is still being uploaded in parts; nothing sends until it's complete.
  status: text("status", { enum: ["draft", "active", "paused", "done", "cancelled"] }).notNull().default("active"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  source: text("source", { enum: ["ui", "api"] }).notNull().default("ui"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  completedAt: timestamp("completed_at", tz),
}, (t) => [index("campaigns_created_idx").on(t.createdAt), index("campaigns_user_created_idx").on(t.userId, t.createdAt)]);

// Mailboxes chosen for a campaign
export const campaignSenders = pgTable(
  "campaign_senders",
  {
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull().references(() => senders.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.senderId] })],
);

// One email to one person. Rows with status 'queued' are the send queue.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // always the campaign's account
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").notNull().references(() => recipients.id),
    senderId: uuid("sender_id").references(() => senders.id),
    parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => messages.id),
    vars: jsonb("vars").$type<Record<string, string>>(),
    subject: text("subject"), // final subject once sent
    messageIdHeader: text("message_id_header").unique(), // <uuid@yourdomain.com>
    status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("queued"),
    // A send time someone chose. null = automatic (spaced out inside the campaign's send window).
    scheduledAt: timestamp("scheduled_at", tz),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", tz),
    error: text("error"),
    sentAt: timestamp("sent_at", tz),
    bouncedAt: timestamp("bounced_at", tz),
    repliedAt: timestamp("replied_at", tz),
    openCount: integer("open_count").notNull().default(0),
    firstOpenedAt: timestamp("first_opened_at", tz),
    clickCount: integer("click_count").notNull().default(0),
    firstClickedAt: timestamp("first_clicked_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("messages_campaign_status_idx").on(t.campaignId, t.status),
    index("messages_sender_sent_idx").on(t.senderId, t.sentAt),
    index("messages_recipient_idx").on(t.recipientId),
    index("messages_campaign_sent_idx").on(t.campaignId, t.sentAt),
    index("messages_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("messages_user_sent_idx").on(t.userId, t.sentAt),
  ],
);

// Replies matched to an email you sent (other inbox mail is never stored)
export const replies = pgTable(
  "replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // always the mailbox's account
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    recipientId: uuid("recipient_id").references(() => recipients.id),
    senderId: uuid("sender_id").notNull().references(() => senders.id),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    replyText: text("reply_text"), // just the new reply, quoted history removed
    attachments: jsonb("attachments").$type<AttachmentMeta[]>().notNull().default(sql`'[]'::jsonb`),
    messageIdHeader: text("message_id_header").notNull(),
    isAutoReply: boolean("is_auto_reply").notNull().default(false),
    receivedAt: timestamp("received_at", tz).notNull(),
    readAt: timestamp("read_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("replies_sender_message_idx").on(t.senderId, t.messageIdHeader),
    index("replies_received_idx").on(t.receivedAt),
    index("replies_message_idx").on(t.messageId),
    index("replies_recipient_idx").on(t.recipientId),
    index("replies_user_received_idx").on(t.userId, t.receivedAt),
  ],
);

// Original URLs behind tracked links (only when click tracking is on)
export const trackingLinks = pgTable(
  "tracking_links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    clickCount: integer("click_count").notNull().default(0),
  },
  (t) => [index("tracking_links_message_idx").on(t.messageId)],
);

// Test emails (connection tests, "Send test"). Providers count them toward the daily limit, so we do too.
export const testSends = pgTable(
  "test_sends",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    senderId: uuid("sender_id").notNull().references(() => senders.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    sentAt: timestamp("sent_at", tz).notNull().defaultNow(),
  },
  (t) => [index("test_sends_sender_sent_idx").on(t.senderId, t.sentAt)],
);

// Do-not-send list (never emailed again by that account)
export const suppressions = pgTable(
  "suppressions",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: text("reason", { enum: ["bounced", "unsubscribed", "manual"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.email] }), index("suppressions_created_idx").on(t.createdAt)],
);

// Browsers and phones that get reply notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  // Delivery health, shown per device in Settings: when the push service last accepted a notification for it,
  // when the device last confirmed one arrived (its service worker reports back), and the last refusal.
  lastSentAt: timestamp("last_sent_at", tz),
  lastReceivedAt: timestamp("last_received_at", tz),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", tz),
});

// Each account's settings (one row per account, made on first use)
export const settings = pgTable("settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  footerText: text("footer_text").notNull().default(""),
  // Personal-style emails end with this instead of an unsubscribe link.
  optOutLine: text("opt_out_line").notNull().default("If this isn't relevant to you, just reply \"no\" and I won't email you again."),
  windowStart: text("window_start").notNull().default("09:00"),
  windowEnd: text("window_end").notNull().default("17:00"),
  timezone: text("timezone").notNull().default("America/New_York"),
  weekdaysOnly: boolean("weekdays_only").notNull().default(true),
  testEmail: text("test_email"),
  // Logo shown with the footer, like an email signature. The image file lives in STORAGE_DIR (logoFile is
  // its path there, named by its content hash); the rest describes it so emails can be built without reading it.
  logoFile: text("logo_file"),
  logoMime: text("logo_mime"),
  logoBytes: integer("logo_bytes"),
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  logoDisplayWidth: integer("logo_display_width").notNull().default(160),
  // Personal-style emails are plain text; with a logo they go out as simple HTML instead.
  logoInPersonal: boolean("logo_in_personal").notNull().default(true),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

// Cron job lock and last-run status
export const jobs = pgTable("jobs", {
  name: text("name").primaryKey(),
  lockedUntil: timestamp("locked_until", tz),
  lastRunAt: timestamp("last_run_at", tz),
  lastFinishedAt: timestamp("last_finished_at", tz),
  lastResult: text("last_result"),
  lastError: text("last_error"),
});

export type User = typeof users.$inferSelect;
export type Sender = typeof senders.$inferSelect;
export type Recipient = typeof recipients.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type Settings = typeof settings.$inferSelect;
