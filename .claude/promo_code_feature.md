# COUPON RULES ENGINE — Advanced Dynamic Coupons
### Tredev Store · Extension of `coupon-discount-system.md`

> **Read `coupon-discount-system.md` first.**
> This file extends it. Everything in that file still applies.
> This file adds the rules engine that makes coupons dynamic and intelligent.

---

## What "Dynamic" Means

A coupon is dynamic when it carries **conditions** that must be true about the user,
the cart, or the moment in time — before the discount is granted.

This spec defines five condition categories:

| # | Condition Type | Example |
|---|---|---|
| 1 | **Scope** | Applies to all products / specific products / specific categories |
| 2 | **Audience** | All users / first-time buyers / employees only / specific users |
| 3 | **Trigger** | User enters code manually / coupon auto-applies silently |
| 4 | **Cart rules** | Min order value / min quantity / specific items must be in cart |
| 5 | **Stacking** | Can combine with other coupons / exclusive (only one at a time) |

---

## Table of Contents

1. [Updated Database Schema](#1-updated-database-schema)
2. [Coupon Types — Full Taxonomy](#2-coupon-types--full-taxonomy)
3. [Scope Rules — Which Products](#3-scope-rules--which-products)
4. [Audience Rules — Who Can Use It](#4-audience-rules--who-can-use-it)
5. [Auto-Apply Logic](#5-auto-apply-logic)
6. [First-Purchase Coupon Logic](#6-first-purchase-coupon-logic)
7. [Employee Coupon Logic](#7-employee-coupon-logic)
8. [Coupon Stacking Rules](#8-coupon-stacking-rules)
9. [The Master Validation Function](#9-the-master-validation-function)
10. [Admin Panel — Advanced Coupon Builder](#10-admin-panel--advanced-coupon-builder)
11. [Frontend Changes](#11-frontend-changes)
12. [Auto-Apply API Flow](#12-auto-apply-api-flow)
13. [Acceptance Criteria](#13-acceptance-criteria)

---

## 1. Updated Database Schema

Drop and replace the `coupons` table from the base spec with this extended version.

```sql
-- ── ENUMS ──────────────────────────────────────────────────────────────────

CREATE TYPE discount_type_enum AS ENUM (
  'percentage',     -- % off cart or eligible items
  'flat',           -- fixed ₹ amount off
  'free_shipping'   -- waives shipping cost
);

CREATE TYPE coupon_scope_enum AS ENUM (
  'all_products',         -- applies to everything in the store
  'specific_products',    -- only applies if matching products are in cart
  'specific_categories'   -- only applies if matching categories are in cart
);

CREATE TYPE coupon_audience_enum AS ENUM (
  'all_users',          -- anyone with an account
  'first_purchase',     -- only users who have never placed a paid order
  'employees',          -- users whose user_id is in the employee_coupons table
  'specific_users'      -- explicitly listed user IDs (whitelist)
);

CREATE TYPE coupon_trigger_enum AS ENUM (
  'manual',       -- user must type the code themselves
  'auto_apply'    -- system applies it automatically, no code needed
);


-- ── MAIN COUPONS TABLE ──────────────────────────────────────────────────────

CREATE TABLE coupons (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity ────────────────────────────────────────────────────────────
  code                  TEXT              NOT NULL UNIQUE,
                                          -- For auto_apply coupons, still generate a
                                          -- unique internal code (e.g. 'AUTO_WELCOME2025')
                                          -- Users never see or type it
  name                  TEXT              NOT NULL,   -- admin label
  description           TEXT,                         -- internal note

  -- ── Discount ────────────────────────────────────────────────────────────
  discount_type         discount_type_enum NOT NULL,
  discount_value        NUMERIC(10,2),               -- NULL for free_shipping
  max_discount_cap      NUMERIC(10,2),               -- cap for percentage type; NULL = no cap

  -- ── Cart requirements ───────────────────────────────────────────────────
  min_order_value       NUMERIC(10,2)     NOT NULL DEFAULT 0,
  min_quantity          INTEGER           NOT NULL DEFAULT 1,
                                          -- min number of eligible items in cart

  -- ── Scope — WHICH products the coupon covers ────────────────────────────
  scope                 coupon_scope_enum NOT NULL DEFAULT 'all_products',
  applies_to_product_ids UUID[],          -- populated when scope = 'specific_products'
  applies_to_categories  TEXT[],          -- populated when scope = 'specific_categories'
                                          -- e.g. ['rudraksha', 'brass-idols', 'yantras']

  -- ── Audience — WHO can use the coupon ───────────────────────────────────
  audience              coupon_audience_enum NOT NULL DEFAULT 'all_users',
                                          -- specific_users and employees use join tables below

  -- ── Trigger — HOW the coupon activates ─────────────────────────────────
  trigger               coupon_trigger_enum NOT NULL DEFAULT 'manual',
  auto_apply_priority   INTEGER           NOT NULL DEFAULT 0,
                                          -- when multiple auto-apply coupons are eligible,
                                          -- higher number wins (or see stacking rules)

  -- ── Stacking ────────────────────────────────────────────────────────────
  is_stackable          BOOLEAN           NOT NULL DEFAULT FALSE,
                                          -- TRUE = can combine with other coupons
                                          -- FALSE = exclusive; if applied, no other coupon runs

  -- ── Validity ────────────────────────────────────────────────────────────
  valid_from            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  valid_until           TIMESTAMPTZ,      -- NULL = never expires

  -- ── Usage limits ────────────────────────────────────────────────────────
  max_uses_total        INTEGER,          -- NULL = unlimited
  max_uses_per_user     INTEGER           NOT NULL DEFAULT 1,
  times_used            INTEGER           NOT NULL DEFAULT 0,

  -- ── Status ──────────────────────────────────────────────────────────────
  is_active             BOOLEAN           NOT NULL DEFAULT TRUE,

  -- ── Audit ───────────────────────────────────────────────────────────────
  created_by            UUID              REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupons_code         ON coupons (UPPER(code));
CREATE INDEX idx_coupons_trigger      ON coupons (trigger) WHERE is_active = TRUE;
CREATE INDEX idx_coupons_audience     ON coupons (audience) WHERE is_active = TRUE;


-- ── EMPLOYEE WHITELIST ──────────────────────────────────────────────────────
-- Links employees (by user_id) to coupons with audience = 'employees'
-- When an employee leaves, remove their row here — the coupon stops working for them

CREATE TABLE employee_coupons (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   UUID    NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by    UUID    REFERENCES auth.users(id),   -- which admin added this
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, user_id)
);

CREATE INDEX idx_employee_coupons_user ON employee_coupons (user_id);


-- ── SPECIFIC USER WHITELIST ─────────────────────────────────────────────────
-- For audience = 'specific_users' — an explicit list of user IDs
-- Use case: VIP customers, winners of a contest, compensation vouchers

CREATE TABLE coupon_user_whitelist (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   UUID    NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by    UUID    REFERENCES auth.users(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, user_id)
);

CREATE INDEX idx_coupon_whitelist_user ON coupon_user_whitelist (user_id);


-- ── REDEMPTIONS (unchanged from base spec) ──────────────────────────────────

CREATE TABLE coupon_redemptions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       UUID          NOT NULL REFERENCES coupons(id),
  order_id        UUID          NOT NULL REFERENCES orders(id),
  user_id         UUID          NOT NULL REFERENCES auth.users(id),
  coupon_code     TEXT          NOT NULL,
  discount_type   TEXT          NOT NULL,
  discount_value  NUMERIC(10,2),
  discount_amount NUMERIC(10,2) NOT NULL,
  was_auto_applied BOOLEAN      NOT NULL DEFAULT FALSE,  -- NEW: was this auto or manual?
  redeemed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_redemptions_coupon_id  ON coupon_redemptions (coupon_id);
CREATE INDEX idx_redemptions_user_coupon ON coupon_redemptions (user_id, coupon_id);


-- ── ORDERS TABLE ADDITIONS ──────────────────────────────────────────────────
-- Allow multiple coupons per order (for stackable scenario)
-- One-to-many: an order can have multiple coupon redemptions

-- The `orders` table keeps a single `discount_amount` (total of all discounts combined)
-- and a `coupon_codes` text array (all codes applied, for display)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_codes       TEXT[]          DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS discount_amount    NUMERIC(10,2)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal           NUMERIC(10,2)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_after_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
```

---

## 2. Coupon Types — Full Taxonomy

Every coupon you'll ever need fits into this grid.
Use it when creating coupons in the admin panel.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COUPON TAXONOMY                                      │
├──────────────────┬──────────────────────┬──────────────────────────────────┤
│ DIMENSION        │ OPTIONS              │ EXAMPLE                           │
├──────────────────┼──────────────────────┼──────────────────────────────────┤
│                  │ all_products         │ "20% off everything"              │
│ SCOPE            │ specific_products    │ "₹100 off this Rudraksha mala"    │
│ (what)           │ specific_categories  │ "15% off all Brass Idols"         │
├──────────────────┼──────────────────────┼──────────────────────────────────┤
│                  │ all_users            │ "DIWALI25 — everyone gets 25% off"│
│ AUDIENCE         │ first_purchase       │ "WELCOME10 — 10% off first order" │
│ (who)            │ employees            │ "STAFF40 — 40% off for our team"  │
│                  │ specific_users       │ "SORRY100 — ₹100 apology voucher" │
├──────────────────┼──────────────────────┼──────────────────────────────────┤
│                  │ manual               │ User types code in checkout       │
│ TRIGGER          │ auto_apply           │ Banner: "10% off auto-applied!"   │
│ (how)            │                      │ No code needed — system detects   │
├──────────────────┼──────────────────────┼──────────────────────────────────┤
│                  │ percentage           │ 20% off                           │
│ DISCOUNT TYPE    │ flat                 │ ₹150 off                          │
│ (how much)       │ free_shipping        │ Free delivery                     │
├──────────────────┼──────────────────────┼──────────────────────────────────┤
│ STACKING         │ stackable            │ Can combine WELCOME10 + FREESHIP  │
│                  │ exclusive            │ Cannot combine with anything else  │
└──────────────────┴──────────────────────┴──────────────────────────────────┘
```

### Real examples from Tredev Store:

| Code | Scope | Audience | Trigger | Discount |
|---|---|---|---|---|
| `DIWALI25` | All products | All users | Manual | 25% off, cap ₹500 |
| `WELCOME10` | All products | First purchase | Manual | 10% off |
| `FREESHIP` | All products | All users | Auto-apply | Free shipping |
| `STAFF40` | All products | Employees | Manual | 40% off |
| `RUDRAKSHA20` | Category: rudraksha | All users | Manual | 20% off |
| `VIP100` | All products | Specific users | Manual | ₹100 off |
| `NEWUSER_AUTO` | All products | First purchase | Auto-apply | 5% off (silent) |
| `IDOL_LAUNCH` | Product IDs: [x,y] | All users | Auto-apply | 15% off |

---

## 3. Scope Rules — Which Products

### `all_products`
Coupon applies to the entire cart subtotal.
`applies_to_product_ids` and `applies_to_categories` are NULL.

### `specific_products`
Coupon applies only to the subtotal of matching products.
`applies_to_product_ids` = array of product UUIDs.

```
Cart:
  Panchmukhi Rudraksha Mala   ₹1,200   ← matches coupon (product ID in list)
  Brass Ganesha Idol          ₹800     ← does NOT match
  Subtotal:                   ₹2,000

Coupon: RUDRA10 — 10% off specific products [rudraksha_mala_id]

Eligible subtotal:   ₹1,200
Discount (10%):      ₹120
User pays:           ₹2,000 − ₹120 = ₹1,880
```

### `specific_categories`
Coupon applies only to items whose `category` field matches one in the list.

```
Cart:
  Panchmukhi Rudraksha Mala   ₹1,200   category: 'rudraksha'  ← matches
  Shaligram Idol              ₹600     category: 'idols'      ← matches
  Saffron 100g                ₹400     category: 'offerings'  ← no match
  Subtotal:                   ₹2,200

Coupon: SACRED15 — 15% off categories ['rudraksha', 'idols']

Eligible subtotal:   ₹1,200 + ₹600 = ₹1,800
Discount (15%):      ₹270
User pays:           ₹2,200 − ₹270 = ₹1,930
```

**Key rule:** Always calculate the discount on the *eligible subtotal* only,
not the full cart total.

---

## 4. Audience Rules — Who Can Use It

### `all_users`
No extra check. Any authenticated user can use it.

### `first_purchase`
User must have **zero** completed (paid) orders in the `orders` table.

```js
// Check inside validateCoupon()
if (coupon.audience === 'first_purchase') {
  const { count } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('payment_status', 'paid');  // only count paid orders

  if (count > 0) {
    return {
      valid: false,
      error: 'This coupon is only valid for your first purchase.',
    };
  }
}
```

**Important:** Check `payment_status = 'paid'` — not just any order row.
An abandoned cart or failed payment must not count as a "previous purchase."

### `employees`
User must have a row in `employee_coupons` for this coupon.

```js
if (coupon.audience === 'employees') {
  const { data: empRow } = await supabaseAdmin
    .from('employee_coupons')
    .select('id')
    .eq('coupon_id', coupon.id)
    .eq('user_id', userId)
    .single();

  if (!empRow) {
    return {
      valid: false,
      error: 'This coupon is for Tredev team members only.',
    };
  }
}
```

**When an employee leaves the company:**
Admin removes their row from `employee_coupons`.
The coupon immediately stops working for them on the next request.
No code change needed.

### `specific_users`
User must have a row in `coupon_user_whitelist` for this coupon.

```js
if (coupon.audience === 'specific_users') {
  const { data: whitelistRow } = await supabaseAdmin
    .from('coupon_user_whitelist')
    .select('id')
    .eq('coupon_id', coupon.id)
    .eq('user_id', userId)
    .single();

  if (!whitelistRow) {
    return {
      valid: false,
      error: 'This coupon is not available for your account.',
    };
  }
}
```

---

## 5. Auto-Apply Logic

Auto-apply coupons are **never typed by the user**. The system detects eligible coupons
and applies them silently, or shows a banner. No coupon input field is needed.

### When it runs

Auto-apply coupons are checked at **two moments:**

1. **When the cart page loads** — `GET /api/coupons/auto-apply`
2. **When the user adds/removes an item** — same endpoint called again

### How it works

```
User opens cart page
        │
        ▼
Frontend calls GET /api/coupons/auto-apply
(sends: userId, cartItems, cartSubtotal)
        │
        ▼
Server queries all active auto-apply coupons:
  SELECT * FROM coupons
  WHERE trigger = 'auto_apply'
    AND is_active = TRUE
    AND (valid_until IS NULL OR valid_until > NOW())
    AND valid_from <= NOW()
        │
        ▼
For each auto-apply coupon, run full validation
(scope check, audience check, min order, usage limits)
        │
        ▼
Collect all coupons that pass validation

  ┌─ No stackable coupons + non-stackable? → apply the one with highest priority
  ├─ All stackable? → apply all of them, sum the discounts
  └─ Mix? → apply non-stackable with highest priority first;
             if it passes, skip all others
        │
        ▼
Return list of applied coupons + total discount amount
        │
        ▼
Frontend shows:
  🎉 "Free shipping automatically applied!"
  🎉 "5% welcome discount applied!"
  (No input field shown — these are not typed)
```

### Auto-apply API endpoint

```js
// GET /api/coupons/auto-apply
// Query params: cartSubtotal, productIds (comma-separated)

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const cartSubtotal = parseFloat(req.query.cartSubtotal ?? '0');
  const productIds   = (req.query.productIds ?? '').split(',').filter(Boolean);
  const userId       = req.user.id;

  // Fetch all active auto-apply coupons
  const { data: autoCoupons } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .eq('trigger', 'auto_apply')
    .eq('is_active', true)
    .lte('valid_from', new Date().toISOString())
    .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString())
    .order('auto_apply_priority', { ascending: false });

  const validCoupons = [];

  for (const coupon of autoCoupons ?? []) {
    const result = await validateCoupon(
      coupon.code, userId, cartSubtotal, productIds,
      { skipCodeLookup: true, couponRow: coupon }  // pass pre-fetched row to avoid N+1 queries
    );
    if (result.valid) {
      validCoupons.push({ coupon, discountAmount: result.discountAmount });
    }
  }

  // Apply stacking rules (see Section 8)
  const applied = applyStackingRules(validCoupons);

  const totalDiscount = applied.reduce((sum, c) => sum + c.discountAmount, 0);

  return res.status(200).json({
    applied: applied.map(c => ({
      code: c.coupon.code,
      name: c.coupon.name,
      discountType: c.coupon.discount_type,
      discountAmount: c.discountAmount,
    })),
    totalDiscount,
    newSubtotal: Math.max(0, cartSubtotal - totalDiscount),
  });
});
```

---

## 6. First-Purchase Coupon Logic

### Two ways to deliver it

**Option A — Manual (user must know the code):**
Show `WELCOME10` on the registration success page and in the welcome email.
User types it at checkout. Server checks `orders` table → 0 paid orders → valid.

**Option B — Auto-apply (no code needed):**
Set trigger = `auto_apply`, audience = `first_purchase`.
When the user opens their cart for the first time, the system detects:
- trigger = auto_apply ✓
- audience = first_purchase: user has 0 paid orders ✓
- Coupon auto-applies.

**Use Option B** for the best UX — the new user is pleasantly surprised by a discount
they didn't have to hunt for.

### Edge case: Order placed but payment failed

The user tried to buy, payment failed, `orders` row has `payment_status = 'failed'`.
This must NOT disqualify them from the first-purchase coupon.

```js
// CORRECT — only count paid orders
.eq('payment_status', 'paid')

// WRONG — would disqualify users whose payment failed
.not('id', 'is', null)  // counts all orders
```

---

## 7. Employee Coupon Logic

### Setup flow

```
HR / Admin creates employee coupon in admin panel:
  Code: STAFF40
  Audience: employees
  Discount: 40% off, no cap
  Scope: all_products
  Trigger: manual
  Max uses per user: unlimited (employees can use it every time)
  Valid until: never expires (or set to end of year)

Admin goes to: Admin → Coupons → STAFF40 → Manage Employees
Admin adds employees by searching their name/email
Each employee's user_id is inserted into employee_coupons table
```

### Employee experience

```
Employee logs in to Tredev Store with their personal account
Employee shops normally
At checkout, employee types "STAFF40"
Server validates:
  ✓ Code exists
  ✓ Is active
  ✓ Not expired
  ✓ audience = 'employees' → checks employee_coupons table → employee is listed → VALID
Employee gets 40% off
```

### When an employee leaves

```
Admin goes to: Admin → Coupons → STAFF40 → Manage Employees
Admin removes the employee's row
Next time that person tries to use STAFF40 → server queries employee_coupons → no row → INVALID
Message shown: "This coupon is for Tredev team members only."
```

**No need to deactivate the coupon or create a new one.
The employee_coupons table is the access control list.**

---

## 8. Coupon Stacking Rules

Stacking = whether multiple coupons can be applied to the same order simultaneously.

### Rule matrix

| Scenario | Behaviour |
|---|---|
| User applies coupon A (exclusive) | Only A is applied. B, C cannot be added |
| User applies coupon A (stackable) | A is applied. User can also apply B if B is stackable |
| User applies coupon A (stackable) + B (exclusive) | B replaces all others. Only B applies |
| Two auto-apply coupons both exclusive | Highest `auto_apply_priority` wins |
| Two auto-apply coupons both stackable | Both apply, discounts are summed |
| One auto-apply + one manual | Depends on is_stackable of each |

### `applyStackingRules()` function

```js
// lib/applyStackingRules.js

/**
 * Given a list of validated coupons (each with .coupon and .discountAmount),
 * returns the subset that should actually be applied, respecting stacking rules.
 *
 * @param {Array} validCoupons - [{coupon, discountAmount}, ...]
 * @returns {Array}            - subset to apply
 */
export function applyStackingRules(validCoupons) {
  if (validCoupons.length === 0) return [];
  if (validCoupons.length === 1) return validCoupons;

  // Sort by priority descending (highest first)
  const sorted = [...validCoupons].sort(
    (a, b) => b.coupon.auto_apply_priority - a.coupon.auto_apply_priority
  );

  const result = [];

  for (const item of sorted) {
    if (item.coupon.is_stackable) {
      // Stackable — add it unless a non-stackable already won
      const hasExclusive = result.some(r => !r.coupon.is_stackable);
      if (!hasExclusive) result.push(item);
    } else {
      // Non-stackable — if this is the first exclusive, clear everything and use only this
      if (result.length === 0) {
        result.push(item);
        break; // exclusive + highest priority wins, stop checking
      }
      // A stackable was already added and now we see an exclusive —
      // exclusive wins; replace all stackables with this one
      if (item.coupon.auto_apply_priority > Math.max(...result.map(r => r.coupon.auto_apply_priority))) {
        return [item];
      }
      // Otherwise, skip this exclusive (existing stackables have higher priority)
    }
  }

  return result;
}
```

### Communicating stacking to users

When a coupon is already applied and the user tries to enter another code:

```
Scenario A — current coupon is exclusive:
  Message: "DIWALI25 cannot be combined with other coupons. Remove it first to try a different code."

Scenario B — new code is exclusive but current is stackable:
  Message: "STAFF40 is exclusive and will replace your current discount (FREESHIP). Apply anyway?"
  [Keep FREESHIP] [Apply STAFF40]

Scenario C — both stackable:
  Both apply. Show:
  "WELCOME10 (10% off) + FREESHIP (free shipping) both applied."
```

---

## 9. The Master Validation Function

This replaces the version in `coupon-discount-system.md`.
All coupon checks flow through this single function — both manual and auto-apply.

```js
// lib/validateCoupon.js

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { calculateDiscount } from '@/lib/calculateDiscount';

/**
 * Master coupon validation function.
 *
 * @param {string}   code          - The coupon code (will be uppercased and trimmed)
 * @param {string}   userId        - From req.user.id — never from request body
 * @param {number}   cartSubtotal  - Full cart subtotal (all items) in ₹
 * @param {string[]} productIds    - Array of product UUIDs in the cart
 * @param {object}   opts
 *   @param {boolean} opts.skipCodeLookup - Pass true when couponRow is pre-fetched (auto-apply)
 *   @param {object}  opts.couponRow      - Pre-fetched coupon row (avoids redundant DB call)
 *
 * @returns {{ valid: true, coupon, discountAmount, eligibleSubtotal }
 *          |{ valid: false, error: string }}
 */
export async function validateCoupon(code, userId, cartSubtotal, productIds = [], opts = {}) {

  // ── 1. Fetch coupon (or use pre-fetched row) ──────────────────────────────
  let coupon = opts.couponRow ?? null;

  if (!coupon) {
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !data) {
      return { valid: false, error: 'Invalid coupon code. Please check and try again.' };
    }
    coupon = data;
  }

  // ── 2. Active? ────────────────────────────────────────────────────────────
  if (!coupon.is_active) {
    return { valid: false, error: 'This coupon is no longer active.' };
  }

  // ── 3. Date window ────────────────────────────────────────────────────────
  const now = new Date();
  if (new Date(coupon.valid_from) > now) {
    return { valid: false, error: 'This coupon is not valid yet.' };
  }
  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return { valid: false, error: 'This coupon has expired.' };
  }

  // ── 4. Global usage limit ─────────────────────────────────────────────────
  if (coupon.max_uses_total !== null && coupon.times_used >= coupon.max_uses_total) {
    return { valid: false, error: 'This coupon has reached its usage limit.' };
  }

  // ── 5. Per-user usage limit ───────────────────────────────────────────────
  const { count: userUseCount } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', coupon.id)
    .eq('user_id', userId);

  if (userUseCount >= coupon.max_uses_per_user) {
    return { valid: false, error: 'You have already used this coupon.' };
  }

  // ── 6. SCOPE CHECK — calculate eligible subtotal ──────────────────────────
  let eligibleSubtotal = cartSubtotal; // default: all products

  if (coupon.scope === 'specific_products') {
    // Fetch prices of only the matching products from DB
    const { data: eligibleProducts } = await supabaseAdmin
      .from('order_items')   // or cart_items depending on your schema
      .select('price, quantity, product_id')
      .in('product_id', coupon.applies_to_product_ids ?? []);
      // Note: filter to only items with product_id in the cart's productIds too
      // The correct query depends on your cart schema — adjust as needed

    eligibleSubtotal = (eligibleProducts ?? []).reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    );

    if (eligibleSubtotal === 0) {
      return {
        valid: false,
        error: 'This coupon does not apply to the items in your cart.',
      };
    }
  }

  if (coupon.scope === 'specific_categories') {
    // Fetch products in cart that belong to eligible categories
    const { data: eligibleProducts } = await supabaseAdmin
      .from('products')
      .select('id, price')
      .in('id', productIds)
      .in('category', coupon.applies_to_categories ?? []);

    // Map eligible product IDs to quantities in cart (pass cart quantity map from frontend)
    // For now, use price sum from DB — adjust to include quantities
    eligibleSubtotal = (eligibleProducts ?? []).reduce(
      (sum, p) => sum + p.price, 0 // TODO: multiply by cart quantity per product
    );

    if (eligibleSubtotal === 0) {
      return {
        valid: false,
        error: `This coupon only applies to: ${coupon.applies_to_categories.join(', ')}.`,
      };
    }
  }

  // ── 7. Minimum order value (on eligible subtotal) ─────────────────────────
  if (eligibleSubtotal < coupon.min_order_value) {
    return {
      valid: false,
      error: `This coupon requires a minimum eligible order of ₹${coupon.min_order_value.toFixed(0)}.`,
    };
  }

  // ── 8. AUDIENCE CHECK ─────────────────────────────────────────────────────

  if (coupon.audience === 'first_purchase') {
    const { count: paidOrderCount } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('payment_status', 'paid');

    if (paidOrderCount > 0) {
      return {
        valid: false,
        error: 'This coupon is only valid for your first purchase.',
      };
    }
  }

  if (coupon.audience === 'employees') {
    const { data: empRow } = await supabaseAdmin
      .from('employee_coupons')
      .select('id')
      .eq('coupon_id', coupon.id)
      .eq('user_id', userId)
      .single();

    if (!empRow) {
      return {
        valid: false,
        error: 'This coupon is for Tredev team members only.',
      };
    }
  }

  if (coupon.audience === 'specific_users') {
    const { data: whitelistRow } = await supabaseAdmin
      .from('coupon_user_whitelist')
      .select('id')
      .eq('coupon_id', coupon.id)
      .eq('user_id', userId)
      .single();

    if (!whitelistRow) {
      return {
        valid: false,
        error: 'This coupon is not available for your account.',
      };
    }
  }

  // ── 9. Calculate discount on eligible subtotal ────────────────────────────
  const discountAmount = calculateDiscount(coupon, eligibleSubtotal);

  return {
    valid: true,
    coupon,
    discountAmount,
    eligibleSubtotal,
  };
}
```

---

## 10. Admin Panel — Advanced Coupon Builder

The admin form at `/admin/coupons/new` must be extended with these additional fields:

### Scope section
```
Applies To:
  ○ All Products                         ← default
  ○ Specific Products  [search & select products by name]
  ○ Specific Categories  [multi-select: rudraksha / idols / yantras / offerings / ...]
```

### Audience section
```
Who Can Use This Coupon:
  ○ All Users                            ← default
  ○ First-Time Buyers Only
  ○ Tredev Employees Only  →  [+ Add Employees] button appears after saving
  ○ Specific Users Only   →  [+ Add Users] button appears after saving
```

### Trigger section
```
How Is It Applied:
  ○ Manual — user types the code at checkout
  ○ Auto-Apply — system applies it automatically
      If Auto-Apply:
        Priority: [  0  ]   (higher = wins when multiple auto-apply coupons compete)
```

### Stacking section
```
Can this coupon be combined with other coupons?
  ○ No — exclusive (replaces all other coupons)    ← default
  ○ Yes — stackable (can combine with other stackable coupons)
```

### Employee Management (after coupon is saved, audience = employees)

At `/admin/coupons/[id]/employees`:
- Search bar: type employee name or email → shows matching users
- Click "Add" → inserts into `employee_coupons`
- Table of current employees with "Remove" button per row

---

## 11. Frontend Changes

### Checkout page layout changes

```
IF there are auto-applied coupons:
  Show a green banner ABOVE the manual coupon input:
  ┌────────────────────────────────────────────────────┐
  │ 🎉 Free shipping automatically applied!             │
  │ 🎉 5% welcome discount applied!                    │
  └────────────────────────────────────────────────────┘

THEN below:
  Have a promo code? [____________________] [Apply]
```

### When a stackable coupon is already active:
```
Applied discounts:
  AUTO: Free shipping        −₹80
  WELCOME10: 10% off        −₹120
                            ────────
  Total savings:            −₹200

Have another code? [____________________] [Apply]
```

### When an exclusive coupon is active:
```
Applied discount:
  DIWALI25: 25% off         −₹300

  ⚠️ This coupon cannot be combined with other offers.
  [Remove DIWALI25]  ← to try a different code
```

### Order summary — show each discount line separately:

```
Subtotal:                    ₹2,000
Discount — WELCOME10 (10%):   −₹120
Discount — Free Shipping:      −₹80
Shipping:                      ₹0
─────────────────────────────────────
Total:                       ₹1,800
```

---

## 12. Auto-Apply API Flow

```
1. Cart page mounts
   → useEffect fires
   → Frontend calls: GET /api/coupons/auto-apply
                       ?cartSubtotal=2000
                       &productIds=uuid1,uuid2,uuid3

2. Server:
   a. requireAuth middleware — must be logged in
   b. Fetch all active auto-apply coupons from DB
   c. Run full validateCoupon() for each
   d. Apply stacking rules
   e. Return applied coupons + totalDiscount

3. Frontend receives response
   → Stores applied coupons in cart state
   → Shows banners for each applied coupon
   → Updates totals display

4. User adds/removes item from cart
   → Same GET /api/coupons/auto-apply called again
   → Some coupons may now fail (e.g. min_order_value no longer met)
   → Banners update accordingly

5. User clicks "Pay Securely"
   → POST /api/checkout/initiate
   → Sends { cartItems, manualCouponCode, autoAppliedCouponCodes }
   → Server re-validates ALL coupons (both manual and auto-applied)
   → Calculates final total server-side
   → Creates payment gateway order with server-calculated amount
```

---

## 13. Acceptance Criteria

### Scope
- [ ] Coupon with scope `all_products` discounts the full cart subtotal
- [ ] Coupon with scope `specific_products` discounts only matching product lines
- [ ] Coupon with scope `specific_categories` discounts only matching category lines
- [ ] If no cart items match the coupon scope, a clear error message is shown
- [ ] Discount is calculated on the *eligible* subtotal, not the full cart

### Audience
- [ ] `all_users` coupon works for any logged-in user
- [ ] `first_purchase` coupon is rejected for users with ≥ 1 paid order
- [ ] `first_purchase` coupon works for users with 0 paid orders (failed payments don't count)
- [ ] `employees` coupon works only for users in `employee_coupons` for that coupon
- [ ] `employees` coupon stops working immediately when the employee row is deleted
- [ ] `specific_users` coupon works only for users in `coupon_user_whitelist`

### Auto-Apply
- [ ] Auto-apply coupons appear without the user typing anything
- [ ] Auto-apply coupons are checked when cart page loads
- [ ] Auto-apply coupons are re-checked when cart items change
- [ ] Auto-applied coupon banners update if the user's cart no longer qualifies
- [ ] Auto-applied coupons are validated again at checkout — not trusted from frontend state

### Stacking
- [ ] An exclusive coupon blocks other coupons from being added
- [ ] A stackable coupon allows other stackable coupons to be added
- [ ] When an exclusive coupon has higher priority than stackable ones, exclusive wins
- [ ] Each applied coupon shows as a separate line in the order summary

### Employee Coupons
- [ ] Admin can add employees to a coupon from the admin panel
- [ ] Admin can remove employees — their access is revoked immediately
- [ ] Non-employees get a clear error: "This coupon is for Tredev team members only"

### Security
- [ ] All audience and scope checks happen server-side — not in frontend logic
- [ ] Payment is initiated with the server-calculated total — never the client-supplied total
- [ ] All DB queries use parameterised queries (see SECURITY.md)
- [ ] `employee_coupons` and `coupon_user_whitelist` are not readable by users via RLS

---

*Tredev Store — OptiMaxin Solutions*
*Read alongside: `coupon-discount-system.md` · `SECURITY.md`*