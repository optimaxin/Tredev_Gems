# Mongo → Supabase: design & mapping

Reference for porting `server.py` off MongoDB onto the existing Supabase schema
(68 tables, Alembic `c8f3a6e1b4d7`, project `myegtglvngkzsxjtdhcu`).

**We are adapting the backend to that schema, not replacing it.** It is materially
better than the Mongo model: it normalises what Mongo flattened, and it already
carries the anti-double-sell invariant (`ux_reservations_active_unit`).

`backend/schema.sql` (the Mongo-shaped DDL) is **superseded** — kept only as a
written record of the old data model. Do not apply it.

---

## 1. The two contract rules

Everything else follows from these.

### IDs: uuid in the DB, same field names in the API
The frontend never parses ids — it passes them through opaquely
(`api.get('/reviews/' + data.product_id)`, `cart.add({product_id, unit_id})`).
So values become `uuid`, while response keys stay `product_id`, `unit_id`,
`order_id`, `user_id`. **No frontend change.**

### Money: `numeric` rupees in the DB, integer paise in the API
`formatINR(paise)` (frontend/src/lib/api.js:16) divides by 100, so the API must
keep emitting paise ints. Convert at the boundary — never leak `numeric` outward:

```python
def to_paise(v: Decimal | None) -> int | None:      # DB → API
    return None if v is None else int((v * 100).to_integral_value(ROUND_HALF_UP))

def to_amount(paise: int | None) -> Decimal | None:  # API → DB
    return None if paise is None else (Decimal(paise) / 100)
```
`numeric` is *more* correct than paise ints (exact decimal, no drift).

---

## 2. Table mapping

| Mongo collection | Supabase target | Notes |
|---|---|---|
| `users` | `users` + `user_roles`/`roles` | `name`→`full_name`, `picture`→`avatar_media_id`, `phone_verified` bool→`phone_verified_at` tstz, `is_active`→`status` enum. **`password_hash` must be added** (§4). |
| `products` | `products` (+ `product_variants`) | `name`→`title`, `price`→`base_price` numeric, `is_active`→`status` enum, `attrs`→ detail tables + `attributes` jsonb |
| `products.images[]` | `media_assets` + `product_media` | ordered via `product_media.position`, `is_primary` |
| `products.attrs.graha` | `gemstone_details.planet_graha` (enum) | typed |
| `products.attrs.mukhi` | `rudraksha_details.mukhi` | typed |
| `products.attrs.rashi` / `.purpose` | `products.attributes` jsonb | no typed home; keep in jsonb |
| `units` | `product_units` | `serial`→`serial_no`, status `available`→`in_stock` |
| `units.weight_carat` (`"4-5"` str) | `gemstone_details.weight_carat` + `weight_ratti` (numeric) | fixes the str/float conflict; feeds the carat↔ratti tool |
| `certificates` (one flat doc) | `authenticity_certificates` + `lab_certifications` + `energization_certificates` + `temples` + `priests` + `qr_codes` + `signing_keys` | see §3 |
| `certificates.qr_token` | `qr_codes.token` | plus `scan_count`, `first/last_scanned_at` |
| `carts` | `carts` | **`anon_key`→`session_token`**; `status` cart_status enum |
| `carts.items[]` | `cart_items` | `price`→`unit_price_snapshot` |
| `orders` | `orders` (+ `payments`) | `total`→`grand_total`, `gst`→`tax_total`; `razorpay_*`→`payments` |
| `orders.shipping{}` | `addresses` + `orders.shipping_address_id` | normalised |
| `orders.items[]` | `order_items` | `name`→`title_snapshot`, adds `line_total`, `fulfillment_status` |
| `reservations` | `reservations` | status `reserved`→`active`, `sold`→`consumed` |
| `razorpay_webhook_events` | `processed_webhooks` | already exists |
| `reviews` | `reviews` | ⚠ requires `order_item_id NOT NULL` — verified-purchase only (§5) |
| `media` | `media_assets` | `storage_path`→`bucket`+`object_key` |

### Missing — must be created (§4)
`astrologers`, `astrologer_weekly_slots`, `consultations`, `affiliate_commissions`,
`affiliate_visits`, `queries`, `query_notes`, `events`, `site_assets`,
`admin_events`, `otp_codes`, `verified_items`, `wishlist`, `wa_events`, `wa_broadcasts`

---

## 3. Certificates — the normalisation

Mongo stored one flat doc and signed it with a single env-var Ed25519 key. The
target splits by concern:

```
authenticity_certificates  ← the signed artifact (content_hash, signature, anchor_ref,
                             revoked_at, signing_key_id, valid_until)
  ├── lab_certification_id       → lab_certifications (lab_name, certificate_number,
  │                                report_date, findings jsonb, treatment_disclosure)
  ├── energization_certificate_id → energization_certificates (ritual_type, temple_id,
  │                                 priest_id, performed_on, mantras jsonb, japa_count)
  ├── temple_id                  → temples
  └── signing_key_id             → signing_keys (kid, algorithm, public_key, is_active,
                                    retired_at)   ← real key rotation
qr_codes (token, status, activated_at, scan_count) → product_unit + auth cert
```

**Signing.** `ED25519_PRIVATE_KEY_HEX` stays in env (the private key must never be in
the DB), but the **public** key gets a `signing_keys` row and certificates reference it
via `signing_key_id`. This is what makes rotation possible: old certs keep verifying
against their original key.

`server.py:959` rebuilt the signed payload by *excluding* known keys — fragile, and
worse against a normalised schema. Instead **persist the exact signed payload**
(`authenticity_certificates.statement` is text; add a `signed_payload jsonb` column) and
verify against it directly. `canonical_json` uses `sort_keys=True`, so key order is
irrelevant — only the exact key set and values matter.

The `/api/verify/{token}` response must still return today's flat `cert` object; it is
reassembled from the joined tables + `signed_payload`.

---

## 4. Migrations to write

Applied via Supabase `apply_migration`. **Note:** the schema is Alembic-managed
(`c8f3a6e1b4d7`) but those scripts aren't in this repo, so new tables land outside
Alembic's history — document it, and reconcile if the Alembic source resurfaces.

1. **`users.password_hash text`** — the app does bcrypt login for admin/staff/
   astrologers (`server.py:310`). The schema assumed Firebase only (`firebase_uid`).
   Both coexist: Firebase for phone/OTP, password for staff.
2. **`user_permissions`** — Mongo's `permissions text[]` (ALL_PERMISSIONS,
   `server.py:386`). `roles` already has admin/catalog_manager/customer/fulfillment/
   priest/verifier; map `owner`→admin, `customer`→customer, and keep fine-grained
   permissions in a side table.
3. **`ALTER TYPE order_status ADD VALUE 'payment_failed'`** — the app sets it from the
   Razorpay webhook (`server.py:1263`); the enum lacks it.
4. **`authenticity_certificates.signed_payload jsonb`** — §3.
5. **The 15 missing tables** — following house conventions: `uuid` PK
   `DEFAULT gen_random_uuid()`, `created_at`/`updated_at timestamptz NOT NULL`,
   RLS enabled, FKs to `users(id)`/`products(id)`.

---

## 5. Behaviour deltas to decide

| # | Issue | Options |
|---|---|---|
| 1 | `reviews.order_item_id NOT NULL` — target allows reviews only from a real purchase; Mongo allowed anyone (`server.py:1401`) | keep strict (better) vs make nullable |
| 2 | `category_key` **enum** (`gem_bracelet`, `temple_prashad`, `digital`) vs Mongo free text (`bracelet`, `prashad`) | translation map in the API layer |
| 3 | `orders.status` — Mongo `pending_payment` vs target `pending` | map at the boundary |
| 4 | `product_units.status` — Mongo `available` vs target `in_stock` | map at the boundary |
| 5 | Guest carts — Mongo `anon_key`; target `carts.session_token` | reuse `session_token`, drop `anon_key` |
| 6 | `products.attributes` has no `rashi`/`purpose` typed home | keep in jsonb |
| 7 | RLS is on for every table | backend connects as service role (bypasses RLS); revisit if the frontend ever talks to Supabase directly |

---

## 5b. Connection (verified working)

`DATABASE_URL` in `backend/.env` — **transaction pooler**, not the direct host:

```
postgresql://postgres.myegtglvngkzsxjtdhcu:<pw>@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres
```

Three gotchas, all hit and solved:
1. **`aws-1-`, not `aws-0-`** — newer projects use the `aws-1` prefix. Every `aws-0`
   region returns `tenant/user ... not found`, which looks like a wrong-region error
   but isn't.
2. **Region is `ap-northeast-2`.** Poolers resolve in every region via DNS, so only a
   connection attempt identifies the right one.
3. **Password contains `@`** → must be percent-encoded (`Lubhansh%4099277`), since `@`
   delimits credentials from host in a URL.

Do **not** use `db.<ref>.supabase.co:5432` — it resolves **IPv6-only**, works locally,
and fails on Render (no IPv6 egress).

Verified via `db.py`: Postgres 17.6, jsonb→dict codec live, `numeric`→`Decimal`,
`timestamptz`→ISO string.

## 5c. Gotchas hit while porting the seed (read before writing inserts)

1. **Never `json.dumps()` a jsonb param.** `db.py` registers a jsonb codec with
   `encoder=json.dumps`, so asyncpg already serialises dict params. Passing
   pre-dumped text double-encodes it, and it reads back as `str` instead of `dict`
   — silently. Pass the dict.
2. **49 original tables have `id uuid NOT NULL` with NO default** (only the 11 added
   here use `gen_random_uuid()`). This schema generates uuids in the app layer
   (SQLAlchemy `default=uuid4`). Every insert must supply `id`.
3. **Enums use lowercase English, not Sanskrit**: `planet_graha` is
   `sun|moon|mars|mercury|jupiter|venus|saturn|rahu|ketu`. `signing_keys.algorithm`
   has `CHECK (algorithm = 'ed25519')` — lowercase.
4. **`users.firebase_uid` was NOT NULL** — impossible for password-only staff.
   Dropped, replaced by `CHECK (firebase_uid IS NOT NULL OR password_hash IS NOT NULL)`.
5. **`storage_provider` had no `external`** — added, for CDN-hosted catalogue images
   (full URL goes in `object_key`).
6. **Pre-existing bug fixed**: `log_issuance_event()` used
   `CASE WHEN TG_TABLE_NAME='product_units' THEN NEW.id ELSE NEW.product_unit_id END`,
   but PL/pgSQL resolves record fields at expression-compile time, so it raised
   `record "new" has no field "product_unit_id"` and **every `product_units` INSERT
   failed**. Rewritten using the `to_jsonb(NEW)->>'...'` indirection the same function
   already used for `content_hash`. The table had 0 rows, so this had never been hit.
7. Useful side effect: `refresh_unit_verification_state` + `log_issuance_event` fire
   automatically — units reach `fully_verified` and `issuance_events` populates with
   `unit_intake`/`lab_attached`/`energization_recorded` for free.

**Seed status:** `backend/seed_pg.py` runs green — 8 products, 14 units, 7 certificates.
All 7 verify (signature + hash + signing key) and a tampered payload is rejected.

## 5d. Auth domain — PORTED ✅

`import db` is the Postgres layer. The legacy Mongo handle was renamed
`db = mongo[...]` → **`mdb = mongo[...]`** (190 call sites) because it shadowed the
module. Remaining `mdb.*` references mark what's still un-ported.

- **`_load_user(user_id=|email=|phone=)`** + `_USER_SELECT` rebuild the flat Mongo-shaped
  dict from `users` + `user_roles`/`roles` + `user_permissions` +
  `notification_preferences`. Because of that, `user_role()`, `user_perms()`,
  `require_perm()`, `require_owner()` and `_user_public()` are **unchanged** — and so is
  the API contract.
- `wa_optin` ⇄ `notification_preferences.whatsapp->>'optin'`; `phone_verified` ⇄
  `phone_verified_at IS NOT NULL`; `picture` ⇄ `users.avatar_url`; role `admin`→`owner`.
- Session expiry is now compared in SQL (`expires_at >= now()`) instead of parsing ISO
  strings in Python.
- OTP check is a single `DELETE ... WHERE ... RETURNING`, so a code cannot be redeemed
  twice by concurrent requests.

**New: `/auth/otp/send` + `/auth/otp/verify` are now wired.** `otp_send()`/`otp_check()`
(WhatsApp → Twilio → MSG91 → mock) had been fully implemented but connected to no route,
so `test_06` had *always* failed. These give a **Firebase-free OTP path** — relevant
because Firebase phone auth cannot work on localhost at all.

Tables missed in the first gap sweep and added since: **`user_sessions`**, **`otp_events`**.
A code-derived sweep now confirms every Mongo collection has a Postgres home.

Verified: `test_03..test_06` green (4/4). Signup writes a password-only user
(`firebase_uid` NULL), `customer` role, notification prefs, and consumes the OTP row.

## 5e. Catalog reads — PORTED ✅ (writes still Mongo)

`GET /products`, `GET /products/{slug}`, `GET /categories` now read Postgres.

- **`_PRODUCT_SELECT` + `_shape_product()`** rebuild the flat product dict:
  `title`→`name`, `base_price`→`price` (paise), `compare_at_price`→`mrp`,
  `category_key`→`category`, `product_media`→`images[]`, and **`attrs` is
  re-synthesised** from `gemstone_details`/`rudraksha_details` + `attributes` jsonb.
- Filters map onto typed columns: `graha`→`planet_graha` enum (matches *both* detail
  tables), `mukhi`→`rudraksha_details.mukhi`; `rashi`/`purpose` stay in jsonb.
  Search is `ILIKE` (was `$regex`), still via the `VERNACULAR` map.
- `available_units` was 3 queries + a Python N+1 loop; now **one query** with
  `NOT EXISTS` against active reservations.
- `weight_carat`/`origin` are read from the product's attrs, not the unit — the Mongo
  seed had copied them onto each unit from `attrs` (server.py:1646), so they were
  always product-level.
- **`products.compare_at_price` added** — `mrp` had no column, and without it the
  frontend's discount badge and struck-through price silently disappear
  (ProductCard.jsx:7,42). Backfilled for the demo catalogue.

Verified: `test_03..test_10` green (8/8) incl. `test_10_vernacular_search_pukhraj`.
All filters exercised against real data (graha/mukhi/rashi/purpose/category/search).

**Still Mongo:** admin product/unit/cert writes, cart, orders, reservations,
astrologers, admin/CMS. Every remaining `mdb.*` marks one.

## 5f. Cart + reservations — PORTED ✅ (checkout/orders still Mongo)

`POST /cart/add`, `GET /cart`, `POST /cart/remove/{line_id}` now read/write Postgres.
**`test_17_double_sell_returns_409` passes** — the guard survives the port.

- **Default variants were mandatory.** `cart_items.variant_id` and
  `order_items.variant_id` are `NOT NULL`: this schema requires products → variants →
  units, and the seed had no variants, so *carts were impossible*. Each product now
  gets one "Standard" variant. Serialized products keep inventory in `product_units`
  (`track_inventory=false`); non-serialized use `product_variants.stock_qty` — which is
  the proper home for Mongo's `products.stock_qty`.
- `anon_key` → `carts.session_token`. `_get_or_create_cart` now **400s** when both
  user and anon key are absent; Mongo matched `{"anon_key": None}`, which silently
  collided with any cart lacking the field (a latent cross-cart bug).
- `cart/add` runs reservation + `product_units.status='reserved'` + line insert in **one
  transaction**; `asyncpg.UniqueViolationError` → 409. `cart/remove` reverses all three
  atomically. Mongo did these as separate best-effort writes.
- Cart lines are `cart_items` rows (was an embedded array with `$push`/`$pull`);
  `name`/`image` are joined from products/product_media rather than snapshotted.

**Also fixed (pre-existing, unrelated to the port):** `CORS_ORIGINS="*"` combined with
`allow_credentials=True` is illegal per the CORS spec, so browsers discarded every
response while the server logged `200 OK`. Login appeared to fail for this reason.
`_cors_origins()` now refuses `*` and falls back to dev origins with a warning.
**Deploy note:** the Vercel domain must be added to `CORS_ORIGINS`.

Status: `test_gemora_backend.py` **20 passed / 7 failed** — the 7 are tests 19-25
(checkout, mock-pay, dispatch, vault, verify-after-dispatch, revoke, emergent session),
i.e. exactly the un-ported domains.

## 5g. Checkout + orders + payments — PORTED ✅

`POST /checkout`, `POST /checkout/mock-pay/{id}`, `_mark_paid` now use Postgres.
Suite: **22 passed / 5 failed** (the 5 are dispatch/verify/vault/revoke/emergent —
still Mongo).

⚠️ **LIVE RAZORPAY INCIDENT.** `RAZORPAY_KEY_ID="rzp_live_..."` was in `backend/.env`,
so a local test run created **3 real orders on the live account** (₹2,31,750 / ₹91,155
/ ₹1,82,310). No money moved — Razorpay orders are intents, nothing was charged — but
the suite was talking to production. Live keys are now moved to `.env.live.bak`
(gitignored) and `.env` has empty keys, which selects the mock path. **Never put
`rzp_live_` keys in a dev `.env`; use `rzp_test_`.** Restore the live values only in
the deploy environment.

Order shape is spread across five tables; `_ORDER_SELECT`/`_shape_order` rebuild the
flat dict:

| Mongo order field | Postgres home |
|---|---|
| `shipping{}` | `addresses` + `orders.shipping_address_id` (+ `email_snapshot`) |
| `razorpay_order_id`, `payment_id`, `paid_at` | `payments` (`gateway_ref`, `gateway_payment_id`, `paid_at`) |
| `tracking_number`, `courier`, `shipped_at` | `shipments` |
| `commission_id` | `affiliate_commissions.order_id` (reverse lookup) |
| `gst`, `total` | `tax_total`, `grand_total` |
| `items[]` | `order_items` (+ required `variant_id`) |

Schema decisions forced here:
- **`orders.user_id` is NOT NULL** → guest checkout now creates a claimable user from
  the always-required `CheckoutIn.email`. That also meant **dropping my
  `users_has_auth_method` CHECK** — a guest legitimately has neither password nor
  Firebase identity until they claim the account.
- `order_no` NOT NULL with no default → sequence-backed `TDV-YYYYMMDD-N`.
- Added: `orders.affiliate_code`/`affiliate_astrologer_id` (attribution happens at
  checkout, before any commission row exists), `orders.guest_session_token`,
  `addresses.email_snapshot`, `payments.gateway_payment_id` (Razorpay returns *two*
  ids — order at create, payment at capture; `gateway_ref` alone couldn't hold both).
- `_mark_paid` is now a **real transaction**: a lost reservation rolls back the whole
  payment instead of leaving a half-paid order. It also writes `order_events`.
- Carts are marked `converted`, not deleted — they're the record of what was bought.

## 5h. Dispatch + verify + revoke + vault — PORTED ✅

**`tests/test_gemora_backend.py` is now 27/27 green**, stable across repeated runs.

- **`_CERT_SELECT` + `_shape_cert()`** rebuild the flat cert from `signed_payload` plus
  state columns. Three fields Mongo kept on the certificate don't exist here — the
  schema *derives* them, which is better:
  - `activated`/`activated_at` → `qr_codes.status`/`activated_at` (the QR owns its
    lifecycle; it's what the public actually scans)
  - `sold_to_user_id`/`order_id` → `product_units.sold_order_item_id → order_items → orders`
- Verification uses the key the cert was **issued with** (`signing_keys.public_key`),
  not a global env key — so rotation works and old certs keep verifying.
- Revoke now also flips `qr_codes.status='revoked'`; revoking the cert alone would
  leave the scanned QR still reporting AUTHENTIC.
- Dispatch writes `shipments` + `order_events` and marks `order_items.fulfillment_status`.
- `/me/verified-items` was an N+1 loop (cert + product query per row) → one query.

### ⚠️ Non-obvious bug: `now()` is the TRANSACTION timestamp
The seed inserted both units of a product in one transaction, so they shared an
identical `created_at` — making `ORDER BY created_at` **non-deterministic**. The suite
randomly picked the uncertified unit and failed ~1 run in 2 ("No certificate on file").
Mongo's per-insert Python `now()` gave distinct values, hiding this. Fixed with
`clock_timestamp()` in the seed (advances *within* a transaction) plus a `serial_no`
tiebreak. **Use `clock_timestamp()` for any per-row ordering written in one txn.**

### Test-state pollution
The suite is order-dependent and assumes available units; re-running against the same
DB starves it. **`backend/reset_test_state.sql`** clears transactional state
(orders/carts/reservations/shipments/vault, resets units to `in_stock`, un-revokes
QRs) while preserving catalogue/users/certs. Run it before each suite run:
```bash
psql "$DATABASE_URL" -f backend/reset_test_state.sql
```
Note the FK order: `product_units.sold_order_item_id` must be nulled *before*
`order_items` is deleted.

`test_25_emergent_session_bearer` reached past the API into Mongo's `user_sessions`;
rewritten against Postgres (same intent — a live session token authenticates via Bearer).

## 5i. Astrologers + consultations + affiliates — PORTED ✅

`tests/test_astrologer_flow.py`: **22/22 pass** (run serially — see below).

- `_ASTRO_SELECT`/`_shape_astro`, `_CONSULT_SELECT`/`_shape_consult`,
  `_COMMISSION_SELECT`/`_shape_commission` rebuild the legacy flat dicts.
  `full_name`→`name`, `avatar_url`→`picture`; `weekly_slots` is re-aggregated from its
  child table as jsonb; prices/commissions convert numeric↔paise.
- `astro_dashboard` was 5 count/find round-trips → one aggregate query.
- `PUT /astrologer/availability` replaces slots in a transaction (was an array `$set`).
- `affiliate_visits` now dedupes via `ON CONFLICT` on
  `(astrologer_id, visitor_hash, visit_day)`; Mongo's `$setOnInsert` upsert was racy.
  `visitor_hash` is the full sha256 (char(64)), not Mongo's truncated 16 chars.
- Added `astrologers.avatar_url` (external CDN pictures don't fit `avatar_media_id`).

### Real bugs found
1. **`payload.get("commission_pct") or 10.0`** — `0` is falsy, so a deliberate **0%
   commission silently became 10%**. Caught by `test_02_zero_pct_no_commission`.
2. **Guest checkout wrote `shipping_phone` to `users.phone`**, which is UNIQUE — two
   guests sharing a number (or one ordering twice) hit a duplicate-key 500. A shipping
   phone is a delivery contact, not an account identity; it lives on the address only.
3. **`secure=True; samesite=none` cookies are dropped over plain http://**, so local
   dev silently lost the anon cart cookie. Mongo hid this: `{"anon_key": None}` matched
   an arbitrary cart (a cross-cart leak). `_cookie_kwargs()` now keys off
   `PUBLIC_APP_URL`'s scheme.
4. **`PUBLIC_APP_URL` still pointed at the dead Emergent preview** — welcome/reset
   links were unusable. It's the *frontend* origin (`http://localhost:3002` in dev).

### Typed columns need typed params
asyncpg binds Python objects, and `::time`/`::date[]` casts don't rescue a string:
`"10:00"` → `datetime.time`, `["2026-03-01"]` → `[date(...)]`, `slot_iso` →
`datetime`. Mongo stored all three as plain strings.

### ⚠️ Pre-existing test bug: xdist + module fixtures
`pytest.ini` sets `-n 2 --dist loadscope`, which puts **each class on its own worker**,
so a module-scoped fixture is instantiated **per worker**.
`TestAdminAstrologerCRUD::test_03` patches the astrologer to 25%, and
`TestAffiliateCommission` expects that — but it runs on a different worker with an
unpatched 15% astrologer, so it fails. Not caused by the migration (it would fail on
Mongo too). `pytest.ini` says not to change `addopts`, so **run this file serially**:
```bash
REACT_APP_BACKEND_URL=http://localhost:8001 pytest tests/test_astrologer_flow.py -n 0
```

### Test updates (storage-coupled assertions)
- `astrologer_id.startswith("astro_")` → `uuid.UUID(...)`: ids are uuids now; the API
  *field name* is unchanged, only the value format.
- `welcome_url.startswith("https://")` → accepts http too: scheme follows
  `PUBLIC_APP_URL`, which is http in local dev.
- Welcome-link assertions now use `PUBLIC_APP_URL`, not `BASE_URL` — they only
  coincided when frontend and backend shared a host on the old preview deploy.

## 5j. Admin + media + CMS — PORTED ✅

Per-file results (reset between runs, serial):

| file | result |
|---|---|
| `test_gemora_backend.py` | 26 passed, 1 skipped |
| `test_astrologer_flow.py` | 22 passed |
| `test_admin_features.py`  | 11 passed, 1 skipped |
| `test_media_events.py`    | 18 passed |

### ⚠️ Correction: the OTP routes were removed on purpose
`test_media_events.py::TestLegacyOTPRemoved` asserts `/auth/otp/send` and
`/auth/otp/verify` **must 404** — phone verification is **Firebase-only** via
`/auth/firebase-verify`. Earlier in this migration those routes were wired up based on
`test_gemora_backend.py::test_06`, which is **stale** (it had been failing since the
removal, before the migration started). Routes are now removed again.
`otp_send()`/`otp_check()` and `otp_codes` stay — they serve WhatsApp/Twilio/MSG91
*notifications*, not auth.

Two tests are skipped for this reason (both build users via the removed OTP flow):
`test_06_signup_and_duplicate`, `test_07_delete_user_owner`. Both need a Firebase Auth
emulator (or a direct DB insert) to restore coverage — the endpoints they exercise are
fine, only their setup is stale.

### N+1 loops that became SQL
- `/admin/sales`: ~4 queries + nested Python loops + a product lookup per line item →
  4 aggregate queries. "Paid" now includes the schema's extra in-flight states
  (`processing`/`packed`/`out_for_delivery`/`completed`) the legacy list predated.
- `/admin/inventory/low-stock`: unit query per product + full reservation scan →
  one `GROUP BY ... HAVING`.
- `/me/wishlist`: product lookup per row → one join.

### Deleting an order requires explicit FK order
Only `affiliate_commissions` cascades from `orders`. `payments`, `shipments`,
`invoices`, `order_events`, `order_items`, `notifications`, `coupon_redemptions` are
all **NO ACTION** — deliberate, so financial/audit records can't vanish silently.
`_purge_order_rows()` deletes them in order, and releases
`product_units.sold_order_item_id` first (it blocks the `order_items` delete).

### Other decisions
- **User delete is now a soft delete** (`deleted_at`), because `orders.user_id` is a FK
  — a hard delete would fail or cascade away order history. `_USER_SELECT` filters
  `deleted_at IS NULL`, so the user disappears from the app exactly as before.
- `reviews.order_item_id` relaxed to nullable: the schema modelled verified-purchase
  reviews only, but the current API lets any logged-in user review. A non-NULL value
  still marks a verified buyer, so the stricter path stays available. Added
  `reviews.title` (Mongo had one; the schema didn't).
- Role/permission changes span `users`/`user_roles`/`user_permissions`, so they're
  transactional now rather than one `$set`.

### Test-state reset caveat
`reset_test_state.sql` must also clear `staff_%@example.com`, `qa%@example.com` and
`b@b.com` — `users.phone` is UNIQUE and the suite reuses fixed phone numbers, so
leftovers from a prior run collide. Mongo had no phone index, so this never bit.

### Cross-file interference (pre-existing)
Running all four files in one session fails: `test_admin_features` purges **all orders**
and deletes users, wiping state `test_gemora_backend` depends on. This is not
migration-related (it would do the same on Mongo). **Run each file separately with a
reset between**, as the table above does.

## 5k. MIGRATION COMPLETE ✅ — MongoDB removed

**77 passed / 2 skipped / 0 failed**, entirely on Supabase Postgres.

| file | result |
|---|---|
| `test_gemora_backend.py` | 26 passed, 1 skipped |
| `test_astrologer_flow.py` | 22 passed |
| `test_admin_features.py` | 11 passed, 1 skipped |
| `test_media_events.py` | 18 passed |

Removed: `motor`/`pymongo` from `requirements.txt` (+`asyncpg==0.30.0`), the
`AsyncIOMotorClient`, all 190 `mdb.*` call sites, `MONGO_URL`/`DB_NAME` from `.env`,
and the now-dead `_event_is_active()` (the active window is evaluated in SQL).
Indexes moved out of `_startup()` into the schema where they belong.
`/dev/seed` now delegates to `backend/seed_pg.py`.

### Last bugs found
- **Soft delete burned emails forever.** `users` is soft-deleted (orders FK it), but
  `uq_users_email`/`uq_users_phone` still counted deleted rows — lookups filter
  `deleted_at IS NULL` and miss them, then the INSERT collides. Guest checkout 500'd on
  any previously-deleted email. Both are now **partial unique indexes**
  (`WHERE deleted_at IS NULL`), so a deleted account releases its email/phone. This was
  self-inflicted: introducing soft-delete without scoping the uniqueness to live rows.
- `_MEDIA_SELECT` already ends in `WHERE`, so appending `" WHERE ..."` produced a
  double-WHERE syntax error. Extra predicates must be `AND`.
- `qr_code_status` had no state for "minted but not dispatched" (only
  `active|revoked|replaced`) — that gap *is* the anti-counterfeiting model. Added
  `pending`.
- `media_assets` had no `deleted_at`/`original_filename`; `processed_webhooks` had no
  `verified`/`result`. Added — the media library soft-deletes (product_media/site_assets
  reference it), and webhook audit needs to record signature validity + handler outcome.

### Test updates (all storage-coupled, none behavioural)
`media_id.startswith("m_")` / `event_id.startswith("ev_")` → `uuid.UUID(...)`, and the
stale `from pymongo import MongoClient`. IDs are uuids now; **API field names never
changed**.

### Deleting orders — explicit FK order
Only `affiliate_commissions` cascades. `payments`/`shipments`/`invoices`/`order_events`/
`order_items`/`notifications`/`coupon_redemptions` are **NO ACTION** by design, so
financial records can't vanish. `_purge_order_rows()` handles the ordering and releases
`product_units.sold_order_item_id` first.

## 5l. Emergent removed entirely ✅

Both remaining runtime dependencies on emergentagent.com are gone. **77 passed /
2 skipped / 0 failed**; frontend compiles clean.

### Object storage → Supabase Storage (`backend/storage_sb.py`)
The schema had anticipated this: `storage_provider` already contained `'supabase'`,
`media_assets` already modelled `bucket` + `object_key` (Supabase Storage's addressing),
and buckets (`certificates`/`recordings`/`invoices`/`labels`/`data-exports`) were
already provisioned. Added a private `media` bucket (8 MB, image MIME types) matching
the app's upload validation.

- **All 14 pre-existing objects migrated**, 0 failures; nothing is left on `bucket='emergent'`.
- Reads are proxied via `/api/media/file/{path}` rather than a public bucket, so the
  bucket stays private and access stays revocable.
- Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (**secret** — bypasses RLS;
  backend/Render env only, never the frontend).

### Google Sign-In → Firebase
Was: browser → `auth.emergentagent.com` → redirect back with `#session_id` →
`AuthCallback` → `POST /auth/session` → backend → `demobackend.emergentagent.com`.
Now: Firebase popup → ID token → `POST /auth/google` → our JWT. No redirect hop, no
third party, and one auth provider instead of two (Firebase already did phone auth).

Deleted: `/auth/session`, `AuthCallback.jsx`, the `#session_id` handling in `App.js`
and `AuthContext`, `EMERGENT_AUTH_URL`, `SessionExchangeIn`, `EMERGENT_AUTH_SESSION_URL`,
`EMERGENT_LLM_KEY`, `emergentintegrations` + the `litellm` wheel from requirements.
**`Signup.jsx` had its own copy of the Emergent redirect** — easy to miss, since the
obvious one is in `Login.jsx`.

`user_sessions` is now only used by the legacy bearer-token path; nothing writes it.
It can be dropped once that path is confirmed unused.

### ⚠️ Requires Firebase Console setup before Google sign-in works
**Authentication → Sign-in method → enable Google**, and add the app's domains under
**Authorized domains** (`localhost` is there by default; add the Vercel/production
domain at deploy). Unlike phone auth, `signInWithPopup` **does** work on localhost.

## 6. Sequence

1. Migrations: `password_hash`, `signed_payload`, `payment_failed`, `user_permissions`, then the 15 tables
2. `db.py` mapping layer: uuid/paise/enum/status translators + `_row()` ISO serialiser
3. Rewrite `_seed` first — it constructs every entity, so it's the fastest way to exercise the whole schema
4. Port by domain: auth → catalog → cart/orders → certificates/verify → astrologers/affiliates → admin/CMS
5. `REACT_APP_BACKEND_URL=http://localhost:8001 pytest` after each domain
6. Drive the real UI at :3002 — tests don't cover the frontend contract

**Local first.** Postgres 16 is running on `:5433` (db `tredev`). Dump the Supabase
schema into it and develop against that — fast, no network, and Supabase stays clean
until the port is proven.
