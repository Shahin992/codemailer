-- Custom SQL migration file, put your code below! --
-- Mailboxes saved before encryption could be chosen got the column default 'ssl'.
-- Before, SMTP used SSL only when smtp_secure was true (port 465) and IMAP only on port 993;
-- every other port upgraded with STARTTLS. Restore that for those older rows.
UPDATE "senders" SET "smtp_security" = 'starttls' WHERE "smtp_security" = 'ssl' AND "smtp_secure" = false;--> statement-breakpoint
UPDATE "senders" SET "imap_security" = 'starttls' WHERE "imap_security" = 'ssl' AND "imap_port" IS NOT NULL AND "imap_port" <> 993;
