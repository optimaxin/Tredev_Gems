"""Coupon rules engine — see .claude/promo_code_feature.md.

A coupon is "dynamic" because it carries conditions that must hold about the cart,
the buyer and the moment in time before any discount is granted. Five categories:

    scope     which products it covers      (all / specific products / categories)
    audience  who may use it                (everyone / first purchase / staff / VIPs)
    trigger   how it activates              (typed at checkout / applied silently)
    cart      minimum value and quantity
    stacking  exclusive, or combinable with other stackable coupons

Two rules hold this file together:

1. **Nothing is trusted from the client except the coupon code.** Subtotals, product
   ids and quantities are all read from the buyer's server-side cart, so a forged
   `cartSubtotal` cannot buy a discount. `resolve()` is called again at checkout and
   its number — not the browser's — is what the payment gateway is asked to charge.

2. **Money is int minor units** (paise for INR, cents for USD), the same convention
   server.py uses across the cart/order API. `discount_value` is the one exception:
   for `percentage` it is a percentage, not money.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional

import db

# audience -> the ACL table that grants it. Values are literals in this module, never
# anything derived from a request, so interpolating them into SQL is safe.
_ACL_TABLE = {
    "employees": "employee_coupons",
    "specific_users": "coupon_user_whitelist",
}

_ACL_ERROR = {
    "employees": "This coupon is for Tredev team members only.",
    "specific_users": "This coupon is not available for your account.",
}

# Every column the engine reads. Selected explicitly so a schema addition can never
# silently change behaviour here.
COUPON_COLS = """
    c.id::text                  AS coupon_id,
    c.code::text                AS code,
    c.name                      AS name,
    c.description               AS description,
    c.discount_type::text       AS discount_type,
    c.discount_value            AS discount_value,
    c.max_discount_amount       AS max_discount_amount,
    c.min_order_amount          AS min_order_amount,
    c.min_quantity              AS min_quantity,
    c.currency                  AS currency,
    c.scope::text               AS scope,
    c.applies_to_product_ids    AS applies_to_product_ids,
    c.applies_to_categories     AS applies_to_categories,
    c.audience::text            AS audience,
    c.trigger_type::text        AS trigger_type,
    c.auto_apply_priority       AS auto_apply_priority,
    c.is_stackable              AS is_stackable,
    c.starts_at                 AS starts_at,
    c.ends_at                   AS ends_at,
    c.usage_limit               AS usage_limit,
    c.usage_limit_per_user      AS usage_limit_per_user,
    c.usage_count               AS usage_count,
    c.is_active                 AS is_active,
    c.created_at                AS created_at,
    c.updated_at                AS updated_at
"""


# ── Discount arithmetic ──────────────────────────────────────────────────────

def calculate_discount(coupon: dict, eligible_subtotal: int, shipping_total: int = 0) -> int:
    """Discount in minor units, capped so it can never exceed what it discounts."""
    dtype = coupon["discount_type"]
    if dtype == "free_shipping":
        return max(0, shipping_total)
    value = Decimal(str(coupon["discount_value"] or 0))
    if dtype == "percentage":
        amount = int((Decimal(eligible_subtotal) * value / 100)
                     .to_integral_value(rounding=ROUND_HALF_UP))
        cap = coupon.get("max_discount_amount")
        if cap is not None:
            amount = min(amount, db.to_paise(cap))
    else:  # fixed_amount
        amount = db.to_paise(value)
    # A discount never exceeds the subtotal it applies to — no negative line totals,
    # and no ₹200-off coupon turning a ₹150 cart into a refund.
    return max(0, min(amount, eligible_subtotal))


def apply_stacking_rules(valid: list[dict]) -> list[dict]:
    """Pick the subset of validated coupons that may run together.

    An exclusive (non-stackable) coupon wins outright whenever its priority matches
    or beats every stackable one — which, with the default priority of 0, means
    "an exclusive coupon in the mix always wins". Otherwise the stackables all apply
    and their discounts sum. Ties break on the larger discount, so the outcome does
    not depend on row order.
    """
    if len(valid) <= 1:
        return list(valid)

    def rank(item: dict) -> tuple:
        return (item["coupon"]["auto_apply_priority"], item["discount_amount"])

    stackable = [v for v in valid if v["coupon"]["is_stackable"]]
    exclusive = sorted((v for v in valid if not v["coupon"]["is_stackable"]),
                       key=rank, reverse=True)
    if not exclusive:
        return sorted(stackable, key=rank, reverse=True)
    top = exclusive[0]
    # Priority alone decides exclusive-vs-stackable; the discount tie-break only
    # orders coupons within a tier, so it must not sway this comparison.
    if not stackable or (top["coupon"]["auto_apply_priority"]
                         >= max(s["coupon"]["auto_apply_priority"] for s in stackable)):
        return [top]
    return sorted(stackable, key=rank, reverse=True)


# ── Cart-side helpers ────────────────────────────────────────────────────────

async def _categories_for(product_ids: Iterable[str], conn=None) -> dict[str, str]:
    ids = list({p for p in product_ids if p})
    if not ids:
        return {}
    sql = "SELECT id::text AS id, category_key::text AS k FROM products WHERE id = ANY($1::uuid[])"
    rows = db._rows(await conn.fetch(sql, ids)) if conn else await db.fetch_all(sql, ids)
    return {r["id"]: r["k"] for r in rows}


def _eligible_lines(coupon: dict, items: list[dict], categories: dict[str, str]) -> list[dict]:
    scope = coupon["scope"]
    if scope == "specific_products":
        wanted = {str(p) for p in (coupon["applies_to_product_ids"] or [])}
        return [li for li in items if li["product_id"] in wanted]
    if scope == "specific_categories":
        wanted = {str(c) for c in (coupon["applies_to_categories"] or [])}
        return [li for li in items if categories.get(li["product_id"]) in wanted]
    return list(items)


async def _user_context(user_id: str, coupon_ids: list[str], conn=None) -> dict:
    """Everything audience/usage checks need about this buyer, in four queries total
    regardless of how many coupons are being evaluated (the auto-apply path walks
    every active coupon, so a per-coupon query here would be a real N+1)."""
    async def q(sql, *args):
        return db._rows(await conn.fetch(sql, *args)) if conn else await db.fetch_all(sql, *args)

    # A *paid* order — an abandoned cart or a failed payment must not burn someone's
    # first-purchase coupon, so this asks the payments ledger, not orders.status.
    paid = await q(
        """SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
            WHERE o.user_id = $1::uuid AND p.status = 'captured' LIMIT 1""", user_id)
    used = await q(
        """SELECT coupon_id::text AS cid, count(*) AS n FROM coupon_redemptions
            WHERE user_id = $1::uuid AND coupon_id = ANY($2::uuid[])
            GROUP BY coupon_id""", user_id, coupon_ids)
    emp = await q(
        "SELECT coupon_id::text AS cid FROM employee_coupons WHERE user_id = $1::uuid", user_id)
    wl = await q(
        "SELECT coupon_id::text AS cid FROM coupon_user_whitelist WHERE user_id = $1::uuid", user_id)
    return {
        "has_paid_order": bool(paid),
        "used": {r["cid"]: r["n"] for r in used},
        "employees": {r["cid"] for r in emp},
        "specific_users": {r["cid"] for r in wl},
    }


# ── Validation ───────────────────────────────────────────────────────────────

def _as_dt(v):
    """db.fetch_* renders timestamptz as ISO strings; a raw conn.fetch does not."""
    if not v:
        return None
    if isinstance(v, str):
        v = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def validate_coupon(coupon: dict, cart: dict, ctx: dict, categories: dict[str, str],
                    shipping_total: int = 0) -> dict:
    """The single gate every coupon passes through — manual and auto-apply alike.

    Pure: all DB reads are hoisted into `ctx`/`categories` by the caller, which is
    what makes this cheap to run against every active coupon and easy to test.

    Returns {"valid": True, coupon, discount_amount, eligible_subtotal}
         or {"valid": False, "error": "<message shown to the buyer>"}.
    """
    def no(msg):
        return {"valid": False, "error": msg, "coupon": coupon}

    if not coupon["is_active"]:
        return no("This coupon is no longer active.")

    now = datetime.now(timezone.utc)
    starts, ends = _as_dt(coupon["starts_at"]), _as_dt(coupon["ends_at"])
    if starts and starts > now:
        return no("This coupon is not valid yet.")
    if ends and ends < now:
        return no("This coupon has expired.")

    # Currency. A flat "100 off" is ₹100 or $100, never both — see the
    # coupons_flat_needs_currency constraint. A percentage travels across currencies.
    cart_currency = (cart.get("currency") or "INR").strip()
    if coupon["currency"] and coupon["currency"].strip() != cart_currency:
        return no(f"This coupon is not valid for {cart_currency} orders.")

    if coupon["usage_limit"] is not None and (coupon["usage_count"] or 0) >= coupon["usage_limit"]:
        return no("This coupon has reached its usage limit.")

    per_user = coupon["usage_limit_per_user"]          # NULL = unlimited
    if per_user is not None and ctx["used"].get(coupon["coupon_id"], 0) >= per_user:
        return no("You have already used this coupon.")

    # ── Scope: the discount is computed on the *eligible* subtotal, not the cart's.
    items = cart.get("items") or []
    lines = _eligible_lines(coupon, items, categories)
    eligible_subtotal = sum(li["price"] * li["qty"] for li in lines)
    eligible_qty = sum(li["qty"] for li in lines)

    if not lines or eligible_subtotal <= 0:
        if coupon["scope"] == "specific_categories":
            return no("This coupon only applies to: "
                      f"{', '.join(coupon['applies_to_categories'] or [])}.")
        return no("This coupon does not apply to the items in your cart.")

    if eligible_qty < (coupon["min_quantity"] or 1):
        return no(f"Add {coupon['min_quantity']} or more eligible items to use this coupon.")

    min_order = db.to_paise(coupon["min_order_amount"]) if coupon["min_order_amount"] else 0
    if eligible_subtotal < min_order:
        return no(f"This coupon needs a minimum eligible order of "
                  f"{_money(min_order, cart_currency)}.")

    # ── Audience
    audience = coupon["audience"]
    if audience == "first_purchase" and ctx["has_paid_order"]:
        return no("This coupon is only valid for your first purchase.")
    if audience in _ACL_TABLE and coupon["coupon_id"] not in ctx[audience]:
        return no(_ACL_ERROR[audience])

    discount = calculate_discount(coupon, eligible_subtotal, shipping_total)
    # free_shipping is exempt: it is legitimately worth 0 before a shipping country
    # is picked (and always 0 within India, where delivery is already free), but the
    # buyer should still see it applied rather than silently rejected.
    if discount <= 0 and coupon["discount_type"] != "free_shipping":
        return no("This coupon gives no discount on your current cart.")

    return {"valid": True, "coupon": coupon,
            "discount_amount": discount, "eligible_subtotal": eligible_subtotal}


def _money(minor: int, currency: str) -> str:
    sym = "₹" if currency == "INR" else "$"
    return f"{sym}{minor // 100:,}"


# ── Resolution: cart -> the coupons that actually apply ──────────────────────

async def resolve(user_id: str, cart: dict, manual_codes: Optional[Iterable[str]] = None,
                  shipping_total: int = 0, conn=None) -> dict:
    """Evaluate every auto-apply coupon plus any codes the buyer typed, then apply
    the stacking rules.

    This is the ONLY place a discount number is produced. `/coupons/auto-apply`
    calls it to render banners; `/checkout` calls it again to price the order, so a
    stale or tampered browser state cannot change what is charged.
    """
    codes = [c.strip().upper() for c in (manual_codes or []) if c and c.strip()]
    items = cart.get("items") or []
    if not items:
        return {"applied": [], "rejected": [{"code": c, "error": "Your cart is empty."} for c in codes],
                "total_discount": 0, "free_shipping": False}

    async def q(sql, *args):
        return db._rows(await conn.fetch(sql, *args)) if conn else await db.fetch_all(sql, *args)

    # Auto-apply coupons are found by the server; manual ones are looked up by code.
    # One query for both — the active-window filter runs in SQL either way.
    candidates = await q(
        f"""SELECT {COUPON_COLS} FROM coupons c
             WHERE c.is_active
               AND (c.starts_at IS NULL OR c.starts_at <= now())
               AND (c.ends_at   IS NULL OR c.ends_at   >= now())
               AND (c.trigger_type = 'auto_apply' OR c.code::text = ANY($1::text[]))
             ORDER BY c.auto_apply_priority DESC""", codes)

    found = {c["code"].upper() for c in candidates}
    rejected = [{"code": c, "error": "Invalid coupon code. Please check and try again."}
                for c in codes if c not in found]

    if not candidates:
        return {"applied": [], "rejected": rejected, "total_discount": 0, "free_shipping": False}

    categories = await _categories_for((li["product_id"] for li in items), conn)
    ctx = await _user_context(user_id, [c["coupon_id"] for c in candidates], conn)

    valid = []
    for coupon in candidates:
        result = validate_coupon(coupon, cart, ctx, categories, shipping_total)
        if result["valid"]:
            valid.append(result)
        elif coupon["code"].upper() in codes:
            # Only surface failures for codes the buyer actually typed. An auto-apply
            # coupon they don't qualify for should stay invisible, not read as a taunt.
            rejected.append({"code": coupon["code"], "error": result["error"]})

    applied = apply_stacking_rules(valid)
    applied_ids = {a["coupon"]["coupon_id"] for a in applied}
    for v in valid:
        if v["coupon"]["coupon_id"] not in applied_ids and v["coupon"]["code"].upper() in codes:
            rejected.append({
                "code": v["coupon"]["code"],
                "error": f"{applied[0]['coupon']['code']} cannot be combined with other coupons."
                         if applied else "This coupon cannot be combined with the others applied.",
            })

    return {
        "applied": [_public(a) for a in applied],
        "rejected": rejected,
        "total_discount": sum(a["discount_amount"] for a in applied),
        "free_shipping": any(a["coupon"]["discount_type"] == "free_shipping" for a in applied),
    }


def _public(item: dict) -> dict:
    """The shape the frontend and the orders.coupon_breakdown column both use."""
    c = item["coupon"]
    return {
        "coupon_id": c["coupon_id"],
        "code": c["code"],
        "name": c["name"] or c["code"],
        "discount_type": c["discount_type"],
        "discount_value": float(c["discount_value"]) if c["discount_value"] is not None else None,
        "amount": item["discount_amount"],
        "eligible_subtotal": item["eligible_subtotal"],
        "auto": c["trigger_type"] == "auto_apply",
        "stackable": c["is_stackable"],
    }


# ── Redemption (called once payment captures, never at checkout) ─────────────

async def record_redemptions(conn, order: dict) -> None:
    """Turn orders.coupon_breakdown into redemption rows and bump usage counters.

    Deliberately runs inside _mark_paid's transaction rather than at checkout: an
    abandoned checkout must not burn a single-use coupon, and per-user limits are
    supposed to count purchases, not attempts. The unique index on
    (order_id, coupon_id) makes a webhook/verify race a no-op instead of a
    double-count.
    """
    for c in order.get("coupon_breakdown") or []:
        inserted = await conn.fetchval(
            """INSERT INTO coupon_redemptions
                    (id, coupon_id, order_id, user_id, coupon_code, discount_type,
                     discount_value, discount_amount, was_auto_applied)
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
               ON CONFLICT (order_id, coupon_id) DO NOTHING
               RETURNING id""",
            c["coupon_id"], order["order_id"], order["user_id"], c["code"],
            c["discount_type"], Decimal(str(c["discount_value"])) if c.get("discount_value") is not None else None,
            db.to_amount(c["amount"]), bool(c.get("auto")))
        if inserted:
            await conn.execute(
                "UPDATE coupons SET usage_count = usage_count + 1 WHERE id = $1::uuid",
                c["coupon_id"])


# ── Self-check ───────────────────────────────────────────────────────────────
# Runnable with `python backend/coupons.py`. Covers the arithmetic and the stacking
# matrix — the two places a silent bug would mis-charge a buyer. The DB-backed paths
# are covered end-to-end by tests/test_coupon_rules.py.

def _demo():
    def coupon(**kw):
        base = {"coupon_id": kw.pop("cid", "x"), "code": "X", "name": None,
                "discount_type": "percentage", "discount_value": Decimal("10"),
                "max_discount_amount": None, "min_order_amount": None, "min_quantity": 1,
                "currency": None, "scope": "all_products", "applies_to_product_ids": None,
                "applies_to_categories": None, "audience": "all_users",
                "trigger_type": "manual", "auto_apply_priority": 0, "is_stackable": False,
                "starts_at": None, "ends_at": None, "usage_limit": None,
                "usage_limit_per_user": 1, "usage_count": 0, "is_active": True}
        base.update(kw)
        return base

    # ── arithmetic
    assert calculate_discount(coupon(), 200000) == 20000                      # 10% of ₹2000
    assert calculate_discount(coupon(discount_value=Decimal("25"),
                                     max_discount_amount=Decimal("500")), 400000) == 50000  # capped
    assert calculate_discount(coupon(discount_type="fixed_amount",
                                     discount_value=Decimal("150")), 200000) == 15000
    # a flat discount never exceeds what it discounts
    assert calculate_discount(coupon(discount_type="fixed_amount",
                                     discount_value=Decimal("500")), 20000) == 20000
    assert calculate_discount(coupon(discount_type="free_shipping",
                                     discount_value=None), 200000, shipping_total=8000) == 8000
    # rounds half-up rather than truncating
    assert calculate_discount(coupon(discount_value=Decimal("33")), 12345) == 4074

    # ── scope
    items = [{"product_id": "p1", "qty": 1, "price": 120000},
             {"product_id": "p2", "qty": 1, "price": 80000}]
    cats = {"p1": "rudraksha", "p2": "idol"}
    assert sum(li["price"] for li in _eligible_lines(
        coupon(scope="specific_products", applies_to_product_ids=["p1"]), items, cats)) == 120000
    assert sum(li["price"] for li in _eligible_lines(
        coupon(scope="specific_categories", applies_to_categories=["rudraksha", "idol"]),
        items, cats)) == 200000
    assert _eligible_lines(coupon(scope="specific_categories",
                                  applies_to_categories=["yantra"]), items, cats) == []

    # ── stacking matrix (section 8 of the spec)
    def v(cid, stack, prio, amt):
        return {"coupon": coupon(cid=cid, is_stackable=stack, auto_apply_priority=prio),
                "discount_amount": amt, "eligible_subtotal": 100000}

    ids = lambda r: [x["coupon"]["coupon_id"] for x in r]
    assert ids(apply_stacking_rules([v("a", True, 0, 10), v("b", True, 0, 20)])) == ["b", "a"]
    assert ids(apply_stacking_rules([v("a", True, 0, 10), v("b", False, 0, 5)])) == ["b"]
    assert ids(apply_stacking_rules([v("a", False, 1, 10), v("b", False, 5, 5)])) == ["b"]
    # a stackable pair outranking the exclusive keeps both
    assert ids(apply_stacking_rules([v("a", True, 9, 10), v("b", True, 9, 20),
                                     v("c", False, 1, 99)])) == ["b", "a"]
    assert apply_stacking_rules([]) == []

    # ── validation gates
    ctx = {"has_paid_order": False, "used": {}, "employees": set(), "specific_users": set()}
    cart = {"currency": "INR", "items": items}
    ok = validate_coupon(coupon(cid="c1"), cart, ctx, cats)
    assert ok["valid"] and ok["discount_amount"] == 20000

    assert not validate_coupon(coupon(is_active=False), cart, ctx, cats)["valid"]
    assert not validate_coupon(coupon(audience="first_purchase"), cart,
                               {**ctx, "has_paid_order": True}, cats)["valid"]
    assert validate_coupon(coupon(audience="first_purchase"), cart, ctx, cats)["valid"]
    assert not validate_coupon(coupon(cid="c1", audience="employees"), cart, ctx, cats)["valid"]
    assert validate_coupon(coupon(cid="c1", audience="employees"), cart,
                           {**ctx, "employees": {"c1"}}, cats)["valid"]
    assert not validate_coupon(coupon(cid="c1"), cart,
                               {**ctx, "used": {"c1": 1}}, cats)["valid"]
    assert not validate_coupon(coupon(usage_limit=5, usage_count=5), cart, ctx, cats)["valid"]
    assert not validate_coupon(coupon(min_order_amount=Decimal("5000")), cart, ctx, cats)["valid"]
    assert not validate_coupon(coupon(min_quantity=5), cart, ctx, cats)["valid"]
    # a ₹ coupon must not discount a $ cart
    assert not validate_coupon(coupon(currency="INR"),
                               {**cart, "currency": "USD"}, ctx, cats)["valid"]
    assert validate_coupon(coupon(currency="USD"),
                           {**cart, "currency": "USD"}, ctx, cats)["valid"]
    # scope with no match is rejected, not silently discounted at 0
    assert not validate_coupon(coupon(scope="specific_categories",
                                      applies_to_categories=["yantra"]), cart, ctx, cats)["valid"]
    print("coupons.py self-check OK")


if __name__ == "__main__":
    _demo()
