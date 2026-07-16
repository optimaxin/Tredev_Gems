-- Tredev — relational schema (Postgres / Supabase)
-- Ported from MongoDB. See backend/db.py for the access layer.
--
-- Conventions:
--   * PKs are app-generated ids from uid(prefix) -> "{prefix}{uuid4hex[:16]}" (text).
--   * Money is INTEGER paise (INR minor units).
--   * Timestamps are timestamptz; db.py re-serialises them to ISO-8601 strings so
--     API responses stay byte-compatible with the previous Mongo-backed contract.
--   * Columns named sort_order / start_time / end_time avoid the SQL reserved words
--     "order" / "end"; they are aliased back to order/start/end on read.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    user_id        text PRIMARY KEY,
    email          text NOT NULL UNIQUE,
    name           text NOT NULL,
    picture        text NOT NULL DEFAULT '',
    phone          text UNIQUE,
    phone_verified boolean NOT NULL DEFAULT false,
    wa_optin       boolean NOT NULL DEFAULT true,
    password_hash  text,
    is_admin       boolean NOT NULL DEFAULT false,
    role           text NOT NULL DEFAULT 'customer'
                     CHECK (role IN ('owner', 'staff', 'customer')),
    -- text[] rather than a child table: fixed small set, read on every auth check
    -- (has_perm), so a join on that hot path isn't worth it.
    permissions    text[] NOT NULL DEFAULT '{}'
                     CHECK (permissions <@ ARRAY['products','inventory','certificates',
                            'orders','categories','astrologers','consultations','queries']::text[]),
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    session_token text PRIMARY KEY,          -- supplied by Emergent, not uid()
    user_id       text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);

-- ── catalog ──────────────────────────────────────────────────────────────────
CREATE TABLE categories (
    category_id text PRIMARY KEY,
    key         text NOT NULL UNIQUE,
    label       text NOT NULL,
    hindi       text NOT NULL DEFAULT '',
    parent_key  text REFERENCES categories(key) ON DELETE SET NULL,
    sort_order  integer NOT NULL DEFAULT 100,  -- "order" in the API
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    product_id      text PRIMARY KEY,
    slug            text NOT NULL UNIQUE,
    name            text NOT NULL,
    category        text NOT NULL REFERENCES categories(key),
    description     text NOT NULL DEFAULT '',
    price           integer NOT NULL,          -- paise
    mrp             integer,
    images          text[] NOT NULL DEFAULT '{}',
    attrs           jsonb NOT NULL DEFAULT '{}'::jsonb,
    devanagari_name text,
    is_serialized   boolean NOT NULL DEFAULT true,
    is_active       boolean NOT NULL DEFAULT true,
    stock_qty       integer,                   -- sparse in Mongo; nullable here
    created_at      timestamptz NOT NULL DEFAULT now()
);
-- Faceted filters query dotted paths (server.py:811-817) -> btree expression indexes.
CREATE INDEX products_attrs_graha_idx   ON products ((attrs ->> 'graha'));
CREATE INDEX products_attrs_rashi_idx   ON products ((attrs ->> 'rashi'));
CREATE INDEX products_attrs_purpose_idx ON products ((attrs ->> 'purpose'));
CREATE INDEX products_attrs_mukhi_idx   ON products ((attrs ->> 'mukhi'));
CREATE INDEX products_attrs_gin         ON products USING GIN (attrs);
-- Case-insensitive substring search on name/description/slug (server.py:821-823).
CREATE INDEX products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX products_desc_trgm ON products USING GIN (description gin_trgm_ops);
CREATE INDEX products_slug_trgm ON products USING GIN (slug gin_trgm_ops);
CREATE INDEX products_category_idx ON products (category);

CREATE TABLE units (
    unit_id      text PRIMARY KEY,
    product_id   text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    serial       text NOT NULL UNIQUE,
    -- text, not numeric: the seed writes ranges like "4-5" (server.py:1646) while
    -- UnitIn declared float. UnitIn is being corrected to str | None.
    weight_carat text,
    origin       text,
    notes        text,
    status       text NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available', 'sold')),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX units_product_idx ON units (product_id);
CREATE INDEX units_status_idx  ON units (status);

-- ── astrologers ──────────────────────────────────────────────────────────────
-- Defined before orders: orders.affiliate_astrologer_id references it.
CREATE TABLE astrologers (
    astrologer_id  text PRIMARY KEY,
    name           text NOT NULL,
    devanagari     text NOT NULL DEFAULT '',
    expertise      text[] NOT NULL DEFAULT '{}',
    price          integer NOT NULL,
    years          integer NOT NULL DEFAULT 0,
    picture        text NOT NULL DEFAULT '',
    email          text UNIQUE,
    commission_pct double precision NOT NULL DEFAULT 10.0
                     CHECK (commission_pct >= 0 AND commission_pct <= 100),
    bio            text NOT NULL DEFAULT '',
    is_active      boolean NOT NULL DEFAULT true,
    affiliate_code text UNIQUE,
    password_hash  text,
    -- Regex-validated in the API layer (server.py:2281); kept as text[] so the
    -- response stays a plain list of 'YYYY-MM-DD' strings.
    blackout_dates text[] NOT NULL DEFAULT '{}',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE astrologer_weekly_slots (
    astrologer_id text NOT NULL REFERENCES astrologers(astrologer_id) ON DELETE CASCADE,
    day           integer NOT NULL CHECK (day BETWEEN 0 AND 6),   -- 0 = Monday
    start_time    text NOT NULL,     -- "HH:MM"; API field is "start"
    end_time      text NOT NULL,     -- "HH:MM"; API field is "end"
    position      integer NOT NULL,
    PRIMARY KEY (astrologer_id, position)
);

-- ── orders ───────────────────────────────────────────────────────────────────
CREATE TABLE orders (
    order_id   text PRIMARY KEY,
    user_id    text REFERENCES users(user_id) ON DELETE SET NULL,  -- null = guest
    anon_key   text,
    subtotal   integer NOT NULL,
    gst        integer NOT NULL,
    total      integer NOT NULL,
    currency   text NOT NULL DEFAULT 'INR',
    status     text NOT NULL CHECK (status IN ('pending_payment', 'paid', 'shipped',
                 'delivered', 'cancelled', 'refunded', 'payment_failed')),

    -- CheckoutIn.shipping was a nested dict; flattened here, re-nested on read.
    shipping_name    text NOT NULL,
    shipping_phone   text NOT NULL,
    shipping_address text NOT NULL,
    shipping_city    text NOT NULL,
    shipping_state   text NOT NULL,
    shipping_pincode text NOT NULL,
    email            text NOT NULL,

    affiliate_code          text,
    affiliate_astrologer_id text REFERENCES astrologers(astrologer_id) ON DELETE SET NULL,

    razorpay_order_id text,
    mock_payment      boolean NOT NULL DEFAULT false,
    payment_id        text,
    -- No FK: affiliate_commissions.order_id already points back here (would be circular).
    commission_id     text,

    tracking_number text,
    courier         text,

    payment_failure_reason text,

    -- server.py:2358 wrote a dynamically-named "{status}_at" field; enumerated here.
    pending_payment_at timestamptz,
    paid_at            timestamptz,
    shipped_at         timestamptz,
    delivered_at       timestamptz,
    cancelled_at       timestamptz,
    refunded_at        timestamptz,
    payment_failed_at  timestamptz,

    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx    ON orders (user_id);
CREATE INDEX orders_created_idx ON orders (created_at);
CREATE INDEX orders_status_idx  ON orders (status);

CREATE TABLE order_items (
    line_id    text PRIMARY KEY,
    order_id   text NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id text NOT NULL REFERENCES products(product_id),
    unit_id    text REFERENCES units(unit_id),
    qty        integer NOT NULL,
    -- price/name/image are point-in-time snapshots, deliberately denormalised.
    price      integer NOT NULL,
    name       text NOT NULL,
    image      text,
    position   integer NOT NULL          -- preserves the original array order
);
CREATE INDEX order_items_order_idx ON order_items (order_id, position);

-- ── carts ────────────────────────────────────────────────────────────────────
CREATE TABLE carts (
    cart_id    text PRIMARY KEY,
    user_id    text REFERENCES users(user_id) ON DELETE CASCADE,
    anon_key   text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    -- Mongo stored exactly one of these (server.py:988); the other key was absent.
    CONSTRAINT carts_owner_xor CHECK ((user_id IS NOT NULL) <> (anon_key IS NOT NULL))
);
-- Mongo had no index here, so concurrent requests could create duplicate carts.
CREATE UNIQUE INDEX carts_user_idx ON carts (user_id)  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX carts_anon_idx ON carts (anon_key) WHERE anon_key IS NOT NULL;

CREATE TABLE cart_items (
    line_id    text PRIMARY KEY,
    cart_id    text NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    product_id text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    unit_id    text REFERENCES units(unit_id) ON DELETE CASCADE,
    qty        integer NOT NULL,
    price      integer NOT NULL,
    name       text NOT NULL,
    image      text,
    position   integer NOT NULL
);
CREATE INDEX cart_items_cart_idx ON cart_items (cart_id, position);

-- ── reservations ─────────────────────────────────────────────────────────────
CREATE TABLE reservations (
    reservation_id text PRIMARY KEY,
    unit_id        text NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    product_id     text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    cart_id        text REFERENCES carts(cart_id) ON DELETE SET NULL,
    user_id        text REFERENCES users(user_id) ON DELETE SET NULL,
    anon_key       text,
    status         text NOT NULL CHECK (status IN ('reserved', 'sold')),
    expires_at     timestamptz NOT NULL,
    order_id       text REFERENCES orders(order_id) ON DELETE SET NULL,
    sold_at        timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- THE anti-double-sell guard. Direct port of the Mongo partial unique index at
-- server.py:576-581. A violation surfaces as asyncpg UniqueViolationError and is
-- translated to HTTP 409. Covered by test_17_double_sell_returns_409.
CREATE UNIQUE INDEX reservations_unit_active_idx
    ON reservations (unit_id)
    WHERE status IN ('reserved', 'sold');

CREATE INDEX reservations_cart_idx ON reservations (cart_id);

-- ── certificates ─────────────────────────────────────────────────────────────
CREATE TABLE certificates (
    cert_id text PRIMARY KEY,

    -- Columns below duplicate signed_payload for querying/FK integrity. The
    -- signature is ALWAYS verified against signed_payload, never against these.
    unit_id           text NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    serial            text NOT NULL,
    product_id        text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    product_name      text NOT NULL DEFAULT '',
    lab_name          text NOT NULL,
    lab_report_no     text NOT NULL,
    lab_report_url    text,
    temple_name       text NOT NULL,
    temple_devanagari text,
    energization_date text NOT NULL,       -- signed as a string; keep verbatim
    priest_name       text NOT NULL,
    pooja_recording_url text,
    mantra            text,
    issued_at         timestamptz NOT NULL,
    issuer            text NOT NULL,
    public_key_hex    text NOT NULL,

    -- The exact dict that was hashed and Ed25519-signed (server.py:908-926).
    -- Replaces the fragile "rebuild by excluding known keys" logic at server.py:959,
    -- where any new column would silently break verification.
    signed_payload jsonb NOT NULL,

    content_hash_sha256   text NOT NULL,
    signature_ed25519_hex text NOT NULL,
    qr_token              text NOT NULL UNIQUE,
    activated             boolean NOT NULL DEFAULT false,  -- true only at dispatch
    revoked               boolean NOT NULL DEFAULT false,

    activated_at    timestamptz,
    sold_to_user_id text REFERENCES users(user_id) ON DELETE SET NULL,
    order_id        text REFERENCES orders(order_id) ON DELETE SET NULL,
    revoked_at      timestamptz
    -- Deliberately NO unique(unit_id): "one cert per unit" stays unenforced pending
    -- the separate certificate-assignment flow.
);
CREATE INDEX certificates_unit_idx    ON certificates (unit_id);
CREATE INDEX certificates_product_idx ON certificates (product_id);
CREATE INDEX certificates_owner_idx   ON certificates (sold_to_user_id);

CREATE TABLE verified_items (
    user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    unit_id    text NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    qr_token   text NOT NULL,
    product_id text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, unit_id)
);

-- ── engagement ───────────────────────────────────────────────────────────────
CREATE TABLE wishlist (
    user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    product_id text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);

CREATE TABLE reviews (
    review_id  text PRIMARY KEY,
    product_id text NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    author     text NOT NULL DEFAULT 'Anonymous',   -- snapshot of users.name
    rating     integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title      text NOT NULL DEFAULT '',
    body       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_product_idx ON reviews (product_id);

-- ── consultations ────────────────────────────────────────────────────────────
CREATE TABLE consultations (
    booking_id      text PRIMARY KEY,
    astrologer_id   text NOT NULL REFERENCES astrologers(astrologer_id),
    astrologer_name text NOT NULL,          -- snapshot
    slot_iso        text NOT NULL,
    user_id         text REFERENCES users(user_id) ON DELETE SET NULL,
    name            text NOT NULL,
    email           text NOT NULL,
    phone           text NOT NULL,
    concern         text NOT NULL DEFAULT '',
    amount          integer NOT NULL,       -- snapshot of astrologers.price
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
    jitsi_room      text,
    meeting_link    text,
    notes           text,                   -- scalar string (cf. query_notes, a list)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz
);
CREATE INDEX consultations_astrologer_idx ON consultations (astrologer_id);
CREATE INDEX consultations_user_idx       ON consultations (user_id);

-- ── affiliates ───────────────────────────────────────────────────────────────
CREATE TABLE affiliate_commissions (
    commission_id     text PRIMARY KEY,
    astrologer_id     text NOT NULL REFERENCES astrologers(astrologer_id) ON DELETE CASCADE,
    affiliate_code    text,
    -- Unique: one commission per order. Previously guarded only by an app-level
    -- check (server.py:1152).
    order_id          text NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
    order_subtotal    integer NOT NULL,
    order_total       integer NOT NULL,
    commission_pct    double precision NOT NULL,   -- snapshot
    commission_amount integer NOT NULL,            -- paise
    currency          text NOT NULL DEFAULT 'INR',
    status            text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid')),
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_commissions_astrologer_idx ON affiliate_commissions (astrologer_id);

CREATE TABLE affiliate_visits (
    astrologer_id  text NOT NULL REFERENCES astrologers(astrologer_id) ON DELETE CASCADE,
    -- sha256 of the anon cookie despite the name (server.py:2318).
    ip_hash        text NOT NULL,
    day            date NOT NULL,
    affiliate_code text NOT NULL,
    at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (astrologer_id, ip_hash, day)   -- daily dedupe; was racy in Mongo
);

-- ── OTP ──────────────────────────────────────────────────────────────────────
CREATE TABLE otp_codes (
    phone      text PRIMARY KEY,
    code       text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_events (
    id           bigserial PRIMARY KEY,   -- had no PK in Mongo; insert-only log
    phone        text NOT NULL,
    kind         text NOT NULL,
    at           timestamptz NOT NULL DEFAULT now(),
    firebase_uid text
);

-- ── media & CMS ──────────────────────────────────────────────────────────────
CREATE TABLE media (
    media_id          text PRIMARY KEY,
    storage_path      text NOT NULL,
    content_type      text NOT NULL,
    size              integer NOT NULL,
    original_filename text NOT NULL,
    url               text NOT NULL,
    uploaded_by       text REFERENCES users(user_id) ON DELETE SET NULL,
    is_deleted        boolean NOT NULL DEFAULT false,
    deleted_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_assets (
    slot       text PRIMARY KEY CHECK (slot ~ '^[a-z0-9_\-]{2,64}$'),
    media_id   text REFERENCES media(media_id) ON DELETE SET NULL,
    url        text,                      -- denormalised from media.url
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE events (
    event_id        text PRIMARY KEY,
    title           text NOT NULL,
    subtitle        text NOT NULL DEFAULT '',
    description     text NOT NULL DEFAULT '',
    image_url       text NOT NULL DEFAULT '',
    cta_text        text NOT NULL DEFAULT '',
    cta_link        text NOT NULL DEFAULT '',
    coupon_code     text NOT NULL DEFAULT '',
    starts_at       timestamptz,
    ends_at         timestamptz,
    priority        integer NOT NULL DEFAULT 0,
    active          boolean NOT NULL DEFAULT true,
    show_in_strip   boolean NOT NULL DEFAULT true,
    show_in_section boolean NOT NULL DEFAULT true,
    created_by      text REFERENCES users(user_id) ON DELETE SET NULL,
    updated_by      text REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz
);

-- ── support ──────────────────────────────────────────────────────────────────
CREATE TABLE queries (
    query_id   text PRIMARY KEY,
    name       text NOT NULL,
    email      text NOT NULL,
    phone      text,
    subject    text NOT NULL,
    message    text NOT NULL,
    user_id    text REFERENCES users(user_id) ON DELETE SET NULL,
    status     text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE query_notes (
    id       bigserial PRIMARY KEY,
    query_id text NOT NULL REFERENCES queries(query_id) ON DELETE CASCADE,
    by       text REFERENCES users(user_id) ON DELETE SET NULL,
    at       timestamptz NOT NULL DEFAULT now(),
    text     text NOT NULL,
    position integer NOT NULL
);
CREATE INDEX query_notes_query_idx ON query_notes (query_id, position);

-- ── audit & webhooks ─────────────────────────────────────────────────────────
CREATE TABLE admin_events (
    event_id text PRIMARY KEY,
    actor_id text REFERENCES users(user_id) ON DELETE SET NULL,
    action   text NOT NULL,
    target   text NOT NULL DEFAULT '',
    meta     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- shape varies per action
    at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_events_at_idx ON admin_events (at DESC);

CREATE TABLE razorpay_webhook_events (
    -- event_id comes from a header and may be absent (server.py:1275). A nullable
    -- UNIQUE allows repeated NULLs, matching Mongo, while still deduping real ids.
    id       bigserial PRIMARY KEY,
    event_id text UNIQUE,
    event    text NOT NULL,
    verified boolean NOT NULL,
    payload  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- raw Razorpay JSON
    result   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- handler output
    at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_events (
    event_id   text PRIMARY KEY,          -- Meta-supplied
    kind       text NOT NULL CHECK (kind IN ('message', 'status')),
    status     text,                      -- only for kind='status'
    raw        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz,               -- absent when a status arrives first
    updated_at timestamptz
);

CREATE TABLE wa_broadcasts (
    id          bigserial PRIMARY KEY,    -- had no PK in Mongo; insert-only log
    template    text NOT NULL,
    body_params text[] NOT NULL DEFAULT '{}',
    sent        integer NOT NULL DEFAULT 0,
    failed      integer NOT NULL DEFAULT 0,
    at          timestamptz NOT NULL DEFAULT now(),
    by          text REFERENCES users(user_id) ON DELETE SET NULL
);
