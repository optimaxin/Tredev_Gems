-- Performance: indexes on hot foreign-key columns that are currently unindexed.
--
-- Audit (2026-07-16) of the Supabase schema found these FK/join columns had NO
-- index, forcing sequential scans on every lookup. The order-list endpoints were
-- the worst hit: for each order row, _ORDER_SELECT's LATERAL joins seq-scan
-- payments and shipments, and _shape_order seq-scans order_items.
--
-- CONCURRENTLY avoids taking a write lock (must run outside a transaction; if you
-- feed this through Alembic, use op.create_index(..., postgresql_concurrently=True)
-- with an autocommit block). Safe and non-destructive; DROP INDEX to revert.
--
-- STATUS: already applied to the live Supabase project (myegtglvngkzsxjtdhcu) on
-- 2026-07-16 as plain (non-CONCURRENTLY) CREATE INDEX, which was instant because the
-- tables were empty. This file is kept so the change can be back-filled into an
-- Alembic revision; IF NOT EXISTS makes re-running a no-op.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_order_id
    ON order_items (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_product_id
    ON order_items (product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_product_unit_id
    ON order_items (product_unit_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_payments_order_id
    ON payments (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_shipments_order_id
    ON shipments (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_cart_items_cart_id
    ON cart_items (cart_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_qr_codes_cert_id
    ON qr_codes (authenticity_certificate_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_product_units_sold_order_item_id
    ON product_units (sold_order_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_reservations_cart_id
    ON reservations (cart_id);
