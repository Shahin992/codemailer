# Email Backend: Database Schema and API Reference

Oct 15, 2026 · @Orangetoolz

Companion to the Email Backend Plan: the PostgreSQL schema and the REST API the MCP server calls.

## Database schema

Nine PostgreSQL tables cover senders, sends, events, opens and clicks, replies, and tracing; at 5,000 messages a day this is about 1.8 million message rows a year, which PostgreSQL handles comfortably with the indexes below. Partition `message_events` by month once it passes a few million rows.

```sql
-- Sender mailboxes (credentials encrypted with AES-256-GCM, key kept outside the DB)
CREATE TABLE senders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            CITEXT UNIQUE NOT NULL,
  display_name     TEXT,
  mail_type        TEXT NOT NULL CHECK (mail_type IN ('business','normal')),
  provider         TEXT NOT NULL,          -- primeforge_google, primeforge_m365, gmail, outlook, imap_smtp, ses
  auth_type        TEXT NOT NULL,          -- oauth2, app_password, smtp_password, api_key
  smtp_host TEXT, smtp_port INT, imap_host TEXT, imap_port INT,
  credentials_enc  BYTEA NOT NULL,         -- encrypted tokens/passwords
  daily_cap        INT NOT NULL DEFAULT 30,  -- 30 business (Primeforge), 4 normal
  warmup_stage     INT NOT NULL DEFAULT 0,
  warmup_started_at TIMESTAMPTZ,
  next_send_at     TIMESTAMPTZ,            -- mirrors the Redis round-robin score
  health_score     NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  status           TEXT NOT NULL DEFAULT 'active',   -- active, cooling, paused, locked, disabled
  imap_uidvalidity BIGINT, imap_last_uid BIGINT, gmail_history_id TEXT,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT UNIQUE NOT NULL,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active, bounced, complained, unsubscribed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One request from the MCP server
CREATE TABLE campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT UNIQUE,
  mail_type        TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body_html        TEXT,
  body_text        TEXT,
  source           TEXT DEFAULT 'mcp',
  track_opens      BOOLEAN NOT NULL DEFAULT true,
  track_clicks     BOOLEAN NOT NULL DEFAULT true,
  total_recipients INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per recipient per send
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES campaigns(id),
  recipient_id        UUID NOT NULL REFERENCES recipients(id),
  sender_id           UUID REFERENCES senders(id),
  thread_id           UUID NOT NULL DEFAULT gen_random_uuid(),
  message_id_header   TEXT UNIQUE,         -- <uuid@sender-domain>
  provider_message_id TEXT,                -- SES/Gmail/Graph ID
  status              TEXT NOT NULL DEFAULT 'queued',
  smtp_response       TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ DEFAULT now(), sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ, bounced_at TIMESTAMPTZ, replied_at TIMESTAMPTZ,
  tracking_token      TEXT UNIQUE,         -- HMAC-signed, used in pixel and link URLs
  first_opened_at TIMESTAMPTZ, open_count INT NOT NULL DEFAULT 0,
  first_clicked_at TIMESTAMPTZ, click_count INT NOT NULL DEFAULT 0
);
CREATE INDEX ON messages (recipient_id, sent_at DESC);
CREATE INDEX ON messages (sender_id, sent_at DESC);
CREATE INDEX ON messages (status);
CREATE INDEX ON messages (provider_message_id);

-- Full event history (sent, delivered, bounce, complaint, open, click, reply)
CREATE TABLE message_events (
  id           BIGSERIAL PRIMARY KEY,
  message_id   UUID NOT NULL REFERENCES messages(id),
  event_type   TEXT NOT NULL,
  bounce_type  TEXT,          -- hard, soft
  bounce_code  TEXT,          -- e.g. 5.1.1
  detail       TEXT,
  link_id      BIGINT,        -- set on click events
  ip           INET,
  user_agent   TEXT,
  is_machine   BOOLEAN NOT NULL DEFAULT false,  -- Apple MPP / proxy prefetch
  is_bot       BOOLEAN NOT NULL DEFAULT false,  -- security-scanner clicks
  raw          JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON message_events (message_id, occurred_at);

CREATE TABLE replies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID REFERENCES messages(id),
  recipient_id      UUID REFERENCES recipients(id),
  sender_id         UUID NOT NULL REFERENCES senders(id),
  thread_id         UUID,
  from_email        CITEXT NOT NULL,
  subject           TEXT,
  body_text         TEXT,
  body_html         TEXT,
  reply_only_text   TEXT,
  attachments       JSONB,       -- [{name, size, mime, storage_key}]
  in_reply_to       TEXT,
  is_auto_reply     BOOLEAN NOT NULL DEFAULT false,
  match_method      TEXT,        -- header, address, unmatched
  received_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON replies (recipient_id, received_at DESC);

-- Which sender owns each recipient
CREATE TABLE recipient_sender_map (
  recipient_id     UUID PRIMARY KEY REFERENCES recipients(id),
  sender_id        UUID NOT NULL REFERENCES senders(id),
  previous_sender_ids UUID[] NOT NULL DEFAULT '{}',  -- kept when a locked sender is replaced
  first_contact_at TIMESTAMPTZ NOT NULL,
  last_contact_at  TIMESTAMPTZ NOT NULL,
  last_status      TEXT
);

-- Original URLs behind rewritten click links
CREATE TABLE tracking_links (
  id          BIGSERIAL PRIMARY KEY,
  message_id  UUID NOT NULL REFERENCES messages(id),
  url         TEXT NOT NULL,
  position    INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON tracking_links (message_id);

CREATE TABLE suppressions (
  email      CITEXT PRIMARY KEY,
  reason     TEXT NOT NULL,   -- hard_bounce, complaint, unsubscribe, manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Example trace query: `SELECT r.email, s.email AS sender, m.status, m.sent_at FROM messages m JOIN recipients r ON r.id = m.recipient_id JOIN senders s ON s.id = m.sender_id WHERE r.email = 'client@example.com' ORDER BY m.sent_at;`

## API endpoints for the MCP server

The MCP server talks to the backend over a small authenticated REST API; each endpoint can be exposed as an MCP tool (for example `send_email`, `get_message_status`, `list_replies`). All `/v1` calls carry an `Authorization: Bearer <api_key>` header, webhook endpoints verify the provider's signature instead, and the tracking endpoints are public on the tracking domains.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/campaigns/send` | Queue a send: recipients array, subject, body, mail type |
| `GET` | `/v1/campaigns/{id}` | Campaign totals: queued, sent, delivered, bounced, replied |
| `GET` | `/v1/campaigns/{id}/engagement` | Unique and total opens and clicks, human vs machine, per link and per sender |
| `GET` | `/v1/messages/{id}` | One message with its event history |
| `GET` | `/v1/recipients/{email}/trace` | Every sender, message, status, and reply for one recipient |
| `GET` | `/v1/replies?since=` | New replies, newest first, for the MCP server to read |
| `GET` | `/v1/senders` | Sender pool with caps, sent today, health, status |
| `POST` | `/v1/senders` | Add a mailbox (credentials or OAuth flow) |
| `POST` | `/v1/senders/import` | Bulk-add mailboxes from a CSV, with a test login on each |
| `PATCH` | `/v1/senders/{id}` | Pause, resume, or change daily cap |
| `POST` | `/v1/suppressions` | Add an address to the do-not-send list |
| `GET` | `/v1/unsubscribe/{token}` | One-click unsubscribe target for the `List-Unsubscribe` header |
| `POST` | `/v1/webhooks/ses` (or `/mailgun`, `/postmark`) | Delivery, bounce, complaint events from the provider |
| `POST` | `/v1/webhooks/inbound` | Inbound replies routed by the provider |
| `POST` | `/v1/webhooks/gmail` | Gmail Pub/Sub push notifications |
| `GET` | `/o/{token}.gif` | Open pixel: logs an open, returns a 1x1 GIF (public, on the tracking domain) |
| `GET` | `/c/{token}/{link_id}` | Click redirect: logs a click, 302 to the original URL (public, on the tracking domain) |

Example send request:

```json
{
  "idempotency_key": "mcp-req-7f3a9c",
  "mail_type": "business",
  "overflow": "next_day",
  "track_opens": true,
  "track_clicks": true,
  "recipients": [
    {"email": "dr.smith@example.com", "name": "Dr. Smith", "vars": {"clinic": "Smile Dental"}},
    {"email": "info@another.com"}
  ],
  "subject": "Quick question about {{clinic}}",
  "body_html": "<p>Hi {{name}}, ...</p>",
  "body_text": "Hi {{name}}, ...",
  "send_window": {"start": "09:00", "end": "17:00", "timezone": "America/New_York"}
}
```

Response: `202 Accepted` with `campaign_id`, accepted count, and a list of rejected addresses with reasons (invalid, duplicate, suppressed).
