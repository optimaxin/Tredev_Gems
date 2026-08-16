-- GSTIN verification via Cashfree Secure ID (KYB) — see .claude/gst_verification.md.
-- Caches a verified GSTIN's business name so checkout/invoice never trust a
-- client-typed business name (§5, §7 of the spec) — only a name Cashfree itself
-- returned for that exact GSTIN ever reaches an order.

CREATE TABLE IF NOT EXISTS gstin_verifications (
    id                  uuid PRIMARY KEY,
    gstin               text NOT NULL UNIQUE,
    legal_name          text NOT NULL,
    trade_name          text,
    registration_status text,
    raw_response        jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified_at         timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    source              text NOT NULL DEFAULT 'cashfree'
);
CREATE INDEX IF NOT EXISTS gstin_verifications_expires_idx ON gstin_verifications (expires_at);
