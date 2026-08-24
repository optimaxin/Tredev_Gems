-- Email notification tables for Tredeva Gems — see .claude/.email_notification.md
-- and the "Email notification system" plan.
--
-- Mirrors wa_schema.sql's shape (email_log ~= wa_messages, email_campaigns ~=
-- wa_campaigns): every send attempt is logged for support/debuggability, and
-- bulk campaigns get their own progress-tracked row.
--
-- Apply with:  psql "$DATABASE_URL" -f backend/email_schema.sql
-- (or via the Supabase MCP apply_migration tool, per backend/MIGRATION.md)
-- Additive only — creates nothing that existing code reads.

CREATE TABLE IF NOT EXISTS email_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type         text        NOT NULL,   -- order_confirmation | order_status | consultation_booking | ...
    to_emails    text[]      NOT NULL,
    subject      text        NOT NULL,
    status       text        NOT NULL,   -- sent | failed
    error        text,
    message_id   text,
    sent_by      uuid REFERENCES users(id),
    campaign_id  uuid,
    related_id   text,                   -- order_id, booking_id, astrologer_id, etc.
    body_html    text,                   -- the exact rendered email, so a failed send can be retried verbatim
    created_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ix_email_log_created_at ON email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_email_log_type ON email_log (type);
CREATE INDEX IF NOT EXISTS ix_email_log_status ON email_log (status);

CREATE TABLE IF NOT EXISTS email_campaigns (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text        NOT NULL,
    subject          text        NOT NULL,
    content          text        NOT NULL,          -- HTML from the compose/campaign editor
    template         text        NOT NULL DEFAULT 'standard',
    audience_type    text        NOT NULL,           -- all_users | segment | csv | manual
    audience_filter  jsonb,
    recipient_emails text[],                         -- for csv/manual audience types
    recipient_count  int         NOT NULL DEFAULT 0,
    sent_count       int         NOT NULL DEFAULT 0,
    failed_count     int         NOT NULL DEFAULT 0,
    status           text        NOT NULL DEFAULT 'draft',
        -- draft | scheduled | sending | paused | sent | cancelled
    scheduled_at     timestamptz,
    started_at       timestamptz,
    completed_at     timestamptz,
    created_by       uuid REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_campaigns_status ON email_campaigns (status);

-- Admin/staff-editable templates (Admin -> Emails -> Templates). System
-- templates (is_system=true) override specific copy fields on the 8 fixed
-- transactional emails (see email_templates.py's SYSTEM_TEMPLATES catalogue) —
-- their structural layout stays code-rendered; only `fields`/`enabled` matter.
-- Custom templates (is_system=false) are full subject+body_html canned
-- messages usable from the Compose tab's template picker; never auto-fires.
CREATE TABLE IF NOT EXISTS email_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key           text        UNIQUE NOT NULL,
    name          text        NOT NULL,
    is_system     boolean     NOT NULL DEFAULT false,
    category      text        NOT NULL DEFAULT 'transactional',
    trigger_event text        NOT NULL DEFAULT 'manual',
    subject       text,                       -- custom templates only
    body_html     text,                       -- custom templates only
    fields        jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- system templates only
    enabled       boolean     NOT NULL DEFAULT true,
    variables     text[],
    updated_by    uuid REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_templates_is_system ON email_templates (is_system);

-- No new notification_preferences column needed — it already has an `email jsonb`
-- column (default '{"marketing": false, "order_updates": true, "review_prompts":
-- true}'), predating this feature but never wired to any code. This is exactly
-- the opt-in/opt-out model §7.5/§8.3 asks for: `marketing` gates bulk campaign
-- eligibility (opt-in, off by default — set true only via /admin/emails or a
-- future account-settings toggle), `order_updates` gates the order-status-update
-- email (on by default; the initial order-confirmation receipt is never gated on
-- it, same as a purchase receipt is never optional).
