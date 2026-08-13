-- GST tax invoice feature — see .claude/invoice.md §7.
-- Money here is INTEGER PAISE (bigint), per §5.3. The older orders/products
-- tables use numeric; db.to_paise() converts at the boundary.
--
-- Tables are named tax_invoice* rather than invoice*: an unrelated, thinner
-- `invoices` table already exists in this schema (order-delete already cascades
-- into it — see server.py's admin_delete_order) and is unrelated to this feature.
-- Reusing its name would either collide or silently repurpose someone else's table.

-- ── product tax master (§6) ──────────────────────────────────────────────────
-- Deliberately NULLable: existing rows have no classification, and a plausible
-- default that renders cleanly is worse than a hard failure (§6). Invoice
-- generation blocks on any line whose product is missing these.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS hsn_code    text,
    ADD COLUMN IF NOT EXISTS gst_rate_bp integer CHECK (gst_rate_bp >= 0 AND gst_rate_bp <= 10000),
    ADD COLUMN IF NOT EXISTS uqc         text;

-- ── buyer GSTIN captured at checkout (optional, B2B) ─────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS buyer_gstin       text,
    ADD COLUMN IF NOT EXISTS buyer_legal_name  text;

-- ── invoice numbering (§4.3) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoice_sequences (
    document_type text   NOT NULL,
    fy_code       char(4) NOT NULL,
    last_sequence bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (document_type, fy_code)
);

-- ── invoices (§7.1) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoices (
    id              uuid PRIMARY KEY,
    document_type   text NOT NULL DEFAULT 'tax_invoice',
    invoice_number  text NOT NULL UNIQUE,
    fy_code         char(4) NOT NULL,
    sequence        bigint NOT NULL,
    issued_at       timestamptz NOT NULL DEFAULT now(),
    order_id        uuid NOT NULL REFERENCES orders(id),
    -- sha256(document_type|order_id|revision): a retried webhook, a double-clicked
    -- admin button, or an at-least-once queue must never mint a second number.
    idempotency_key text NOT NULL UNIQUE,

    -- Frozen snapshots (§7.4): the render path never JOINs to products/users/
    -- settings, so a three-year-old invoice still re-renders unchanged.
    supplier_json       jsonb NOT NULL,
    buyer_name          text  NOT NULL,
    buyer_gstin         text,
    buyer_billing_json  jsonb NOT NULL,
    buyer_shipping_json jsonb NOT NULL,

    place_of_supply_code char(2),
    place_of_supply_name text NOT NULL DEFAULT '',
    supply_type          text NOT NULL
                           CHECK (supply_type IN ('intra_state','inter_state','export','sez')),
    b2b_or_b2c           text NOT NULL CHECK (b2b_or_b2c IN ('b2b','b2c')),
    reverse_charge       boolean NOT NULL DEFAULT false,

    total_gross_paise    bigint NOT NULL,
    total_discount_paise bigint NOT NULL DEFAULT 0,
    total_taxable_paise  bigint NOT NULL,
    total_cgst_paise     bigint NOT NULL DEFAULT 0,
    total_sgst_paise     bigint NOT NULL DEFAULT 0,
    total_igst_paise     bigint NOT NULL DEFAULT 0,
    shipping_paise       bigint NOT NULL DEFAULT 0,
    round_off_paise      bigint NOT NULL DEFAULT 0,
    grand_total_paise    bigint NOT NULL,
    currency             char(3) NOT NULL DEFAULT 'INR',
    amount_in_words      text NOT NULL,

    payment_method    text NOT NULL DEFAULT 'PREPAID',
    payment_reference text,

    -- e-invoice seam, off in v1 (§7.6). Never populated by us; never rendered
    -- unless a real IRP response lands here.
    irn               text,
    irn_ack_no        text,
    irn_ack_date      timestamptz,
    signed_qr_payload text,

    status           text NOT NULL DEFAULT 'issued'
                       CHECK (status IN ('issued','cancelled')),
    template_version text NOT NULL DEFAULT 'v1',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_invoices_order_idx  ON tax_invoices (order_id);
CREATE INDEX IF NOT EXISTS tax_invoices_issued_idx ON tax_invoices (issued_at);
CREATE INDEX IF NOT EXISTS tax_invoices_fy_seq_idx ON tax_invoices (document_type, fy_code, sequence);

-- ── invoice line items (§7.2) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoice_line_items (
    id          uuid PRIMARY KEY,
    invoice_id  uuid NOT NULL REFERENCES tax_invoices(id) ON DELETE RESTRICT,
    line_no     integer NOT NULL,
    product_id  uuid,
    sku         text,
    description text NOT NULL,
    attributes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    hsn_code    text NOT NULL,
    quantity    integer NOT NULL,
    uqc         text NOT NULL,
    unit_price_excl_paise bigint NOT NULL,
    gross_excl_paise      bigint NOT NULL,
    discount_paise        bigint NOT NULL DEFAULT 0,
    taxable_paise         bigint NOT NULL,
    gst_rate_bp           integer NOT NULL,
    cgst_paise            bigint NOT NULL DEFAULT 0,
    sgst_paise            bigint NOT NULL DEFAULT 0,
    igst_paise            bigint NOT NULL DEFAULT 0,
    line_total_paise      bigint NOT NULL,
    UNIQUE (invoice_id, line_no)
);

-- ── immutability (§7.3) ──────────────────────────────────────────────────────
-- An issued invoice is a statutory record: corrections happen via a credit note,
-- never an edit. The application has no update path for these columns either;
-- this trigger is the backstop against a stray UPDATE from a console or script.
CREATE OR REPLACE FUNCTION tax_invoices_forbid_mutation() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'issued' AND (
           NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number
        OR NEW.sequence            IS DISTINCT FROM OLD.sequence
        OR NEW.fy_code             IS DISTINCT FROM OLD.fy_code
        OR NEW.order_id            IS DISTINCT FROM OLD.order_id
        OR NEW.supplier_json       IS DISTINCT FROM OLD.supplier_json
        OR NEW.buyer_gstin         IS DISTINCT FROM OLD.buyer_gstin
        OR NEW.buyer_billing_json  IS DISTINCT FROM OLD.buyer_billing_json
        OR NEW.total_taxable_paise IS DISTINCT FROM OLD.total_taxable_paise
        OR NEW.total_cgst_paise    IS DISTINCT FROM OLD.total_cgst_paise
        OR NEW.total_sgst_paise    IS DISTINCT FROM OLD.total_sgst_paise
        OR NEW.total_igst_paise    IS DISTINCT FROM OLD.total_igst_paise
        OR NEW.grand_total_paise   IS DISTINCT FROM OLD.grand_total_paise
    ) THEN
        RAISE EXCEPTION 'invoice % is issued and immutable (use a credit note)',
              OLD.invoice_number;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_invoices_immutable ON tax_invoices;
CREATE TRIGGER tax_invoices_immutable BEFORE UPDATE ON tax_invoices
    FOR EACH ROW EXECUTE FUNCTION tax_invoices_forbid_mutation();

-- UPDATE only, not DELETE: this codebase already treats "delete this order and
-- everything on it" as a supported admin action (_purge_order_rows) and the
-- destructive test suite relies on purging orders wholesale — blocking DELETE
-- here would break both. The guarantee this trigger provides is narrower: a
-- live invoice's numbers can't be quietly altered while the order still exists.
CREATE OR REPLACE FUNCTION tax_invoice_lines_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'invoice line items are immutable once written (delete the whole order to remove them)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_invoice_lines_immutable ON tax_invoice_line_items;
CREATE TRIGGER tax_invoice_lines_immutable BEFORE UPDATE ON tax_invoice_line_items
    FOR EACH ROW EXECUTE FUNCTION tax_invoice_lines_forbid_mutation();

-- ── access audit (§7.3 / §10.2) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoice_audit_log (
    id         uuid PRIMARY KEY,
    invoice_id uuid NOT NULL REFERENCES tax_invoices(id),
    actor_type text NOT NULL,
    actor_id   text,
    action     text NOT NULL,
    ip         text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_invoice_audit_invoice_idx ON tax_invoice_audit_log (invoice_id);
