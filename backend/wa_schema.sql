-- WhatsApp gateway tables for Tredev Gems (OpenWA integration).
--
-- WHY THESE EXIST: OpenWA keeps its own SQLite database, but that is a disposable
-- gateway cache — it is wiped whenever the container is rebuilt or the number is
-- re-paired. These tables are the SYSTEM OF RECORD: every inbound and outbound
-- message is mirrored into Supabase so it survives the gateway, is queryable
-- alongside orders/users, and gives support staff real history.
--
-- Admin ACTIONS (who sent what, who launched a campaign) are recorded separately in
-- `admin_events` via audit_log(), so they surface in the admin Activity Log.
--
-- Apply with:  psql "$DATABASE_URL" -f backend/wa_schema.sql
-- Additive only — creates nothing that existing code reads.

-- ── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_chats (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id           text        NOT NULL,
    -- WhatsApp's own chat id, e.g. "919812345678@s.whatsapp.net" or a @g.us group.
    chat_id              text        NOT NULL,
    phone                text,                 -- E.164, null for groups
    display_name         text,
    is_group             boolean     NOT NULL DEFAULT false,
    -- Links the conversation to a Tredev customer when the number matches a user.
    -- ON DELETE SET NULL: deleting a customer must not destroy support history.
    user_id              uuid        REFERENCES users(id) ON DELETE SET NULL,
    last_message_at      timestamptz,
    last_message_preview text,
    unread_count         integer     NOT NULL DEFAULT 0,
    archived             boolean     NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_wa_chats_session_chat UNIQUE (session_id, chat_id)
);

CREATE INDEX IF NOT EXISTS ix_wa_chats_last_message_at ON wa_chats (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ix_wa_chats_user_id         ON wa_chats (user_id);
CREATE INDEX IF NOT EXISTS ix_wa_chats_phone           ON wa_chats (phone);

-- ── Campaigns (bulk sends) ───────────────────────────────────────────────────
-- Created before wa_messages because messages reference it.
CREATE TABLE IF NOT EXISTS wa_campaigns (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,
    session_id      text        NOT NULL,
    -- OpenWA's async batch id, from POST /messages/send-bulk. Used to poll progress
    -- and to cancel a run in flight.
    batch_id        text,
    body            text        NOT NULL,
    recipient_count integer     NOT NULL DEFAULT 0,
    sent_count      integer     NOT NULL DEFAULT 0,
    failed_count    integer     NOT NULL DEFAULT 0,
    -- queued | running | completed | cancelled | failed
    status          text        NOT NULL DEFAULT 'queued',
    created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS ix_wa_campaigns_created_at ON wa_campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_wa_campaigns_batch_id   ON wa_campaigns (batch_id);

-- ── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id          uuid        NOT NULL REFERENCES wa_chats(id) ON DELETE CASCADE,
    session_id       text        NOT NULL,
    -- WhatsApp's message id. UNIQUE is load-bearing: OpenWA retries webhook
    -- deliveries, so the inbound handler upserts on this to stay idempotent.
    wa_message_id    text        NOT NULL,
    direction        text        NOT NULL CHECK (direction IN ('in', 'out')),
    from_phone       text,
    to_phone         text,
    -- text | image | document | audio | video | sticker | location | contact | poll | other
    msg_type         text        NOT NULL DEFAULT 'text',
    body             text,
    media_url        text,
    media_mime       text,
    -- pending | sent | delivered | read | failed  (inbound rows are 'delivered')
    status           text        NOT NULL DEFAULT 'pending',
    -- Which staff member sent it. NULL for inbound and for automated sends
    -- (order dispatch, staff invite) — those are attributed by `source`.
    sent_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
    -- support | campaign | dispatch | invite | system
    source           text        NOT NULL DEFAULT 'support',
    campaign_id      uuid        REFERENCES wa_campaigns(id) ON DELETE SET NULL,
    error            text,
    -- Full gateway payload, so nothing is lost if we later need a field we didn't map.
    raw              jsonb       NOT NULL DEFAULT '{}'::jsonb,
    wa_timestamp     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_wa_messages_wa_id UNIQUE (session_id, wa_message_id)
);

-- The inbox thread query: newest-first within a conversation.
CREATE INDEX IF NOT EXISTS ix_wa_messages_chat_time ON wa_messages (chat_id, wa_timestamp DESC);
CREATE INDEX IF NOT EXISTS ix_wa_messages_campaign  ON wa_messages (campaign_id);
CREATE INDEX IF NOT EXISTS ix_wa_messages_sent_by   ON wa_messages (sent_by_user_id);
CREATE INDEX IF NOT EXISTS ix_wa_messages_direction ON wa_messages (direction, created_at DESC);
