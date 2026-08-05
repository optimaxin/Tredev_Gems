"""End-to-end check for the coupon rules engine — SAFE against the live database.

    cd backend && ./venv/bin/python tests/coupon_e2e.py

WHY THIS IS NOT IN THE PYTEST SUITE
-----------------------------------
tests/conftest.py gates that suite behind TREDEV_ALLOW_DESTRUCTIVE_TESTS because it
purges every order. This file is the opposite: it must be runnable any time, so it
is a plain script and it never leaves a row behind.

HOW IT STAYS SAFE
-----------------
Everything that writes happens inside ONE transaction that is ALWAYS rolled back —
coupons, ACL rows, redemptions, the order row, the usage counters. Reads (products,
users, their payment history) touch real data but change nothing. No order is ever
placed, no product unit is ever marked sold, no payment gateway is called.

WHAT IT COVERS
--------------
Every box in section 13 of .claude/promo_code_feature.md, plus the checkout money
path (the arithmetic /checkout applies) and redemption bookkeeping.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv                                        # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import db                       # noqa: E402
import coupons as cr            # noqa: E402

PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(f"  {'✓' if ok else '✗'} {name}{'' if ok else f'  → {detail}'}")


class Rollback(Exception):
    """Raised at the end of the transaction so nothing is ever committed."""


async def seed_coupon(conn, code: str, **kw) -> str:
    cid = uuid.uuid4()
    row = {
        "name": code, "description": "e2e", "discount_type": "percentage",
        "discount_value": Decimal("10"), "max_discount_amount": None,
        "min_order_amount": None, "min_quantity": 1, "currency": None,
        "scope": "all_products", "applies_to_product_ids": None,
        "applies_to_categories": None, "audience": "all_users",
        "trigger_type": "manual", "auto_apply_priority": 0, "is_stackable": False,
        "starts_at": None, "ends_at": None, "usage_limit": None,
        "usage_limit_per_user": 1, "usage_count": 0, "is_active": True,
    }
    row.update(kw)
    await conn.execute(
        """INSERT INTO coupons (id, code, name, description, discount_type, discount_value,
                max_discount_amount, min_order_amount, min_quantity, currency, scope,
                applies_to_product_ids, applies_to_categories, audience, trigger_type,
                auto_apply_priority, is_stackable, starts_at, ends_at, usage_limit,
                usage_limit_per_user, usage_count, is_active)
           VALUES ($1,$2::citext,$3,$4,$5::coupon_discount_type,$6,$7,$8,$9,$10,
                   $11::coupon_scope,$12::uuid[],$13::text[],$14::coupon_audience,
                   $15::coupon_trigger,$16,$17,$18,$19,$20,$21,$22,$23)""",
        cid, code, row["name"], row["description"], row["discount_type"],
        row["discount_value"], row["max_discount_amount"], row["min_order_amount"],
        row["min_quantity"], row["currency"], row["scope"], row["applies_to_product_ids"],
        row["applies_to_categories"], row["audience"], row["trigger_type"],
        row["auto_apply_priority"], row["is_stackable"], row["starts_at"], row["ends_at"],
        row["usage_limit"], row["usage_limit_per_user"], row["usage_count"], row["is_active"])
    return str(cid)


async def run(conn) -> None:
    # ── Fixtures drawn from real rows, so scope/category matching is exercised
    #    against the categories this store actually uses.
    prods = db._rows(await conn.fetch(
        """SELECT DISTINCT ON (category_key) id::text AS id, title, category_key::text AS cat
             FROM products WHERE deleted_at IS NULL
            ORDER BY category_key, created_at"""))
    by_cat = {p["cat"]: p for p in prods}
    assert len(by_cat) >= 2, "need products in at least two categories"
    a, b = prods[0], prods[1]

    # ₹1,200 and ₹800 — the spec's worked example in section 3.
    cart = {"currency": "INR", "items": [
        {"line_id": "l1", "product_id": a["id"], "qty": 1, "price": 120000, "name": a["title"]},
        {"line_id": "l2", "product_id": b["id"], "qty": 1, "price": 80000, "name": b["title"]},
    ]}
    subtotal = 200000

    new_buyer = await conn.fetchval(
        """SELECT u.id::text FROM users u WHERE u.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
                             WHERE o.user_id = u.id AND p.status = 'captured') LIMIT 1""")
    repeat_buyer = await conn.fetchval(
        """SELECT DISTINCT o.user_id::text FROM orders o JOIN payments p ON p.order_id = o.id
            WHERE p.status = 'captured' AND o.user_id IS NOT NULL LIMIT 1""")
    assert new_buyer and repeat_buyer, "need one buyer with and one without a paid order"

    async def resolve(user, codes=(), shipping=0):
        return await cr.resolve(user, cart, list(codes), shipping, conn)

    # ── SCOPE ────────────────────────────────────────────────────────────────
    print("\nScope")
    await seed_coupon(conn, "E2E_ALL", discount_value=Decimal("10"))
    r = await resolve(new_buyer, ["E2E_ALL"])
    check("all_products discounts the full subtotal",
          r["total_discount"] == 20000, f"got {r['total_discount']}")

    await seed_coupon(conn, "E2E_PROD", discount_value=Decimal("10"),
                      scope="specific_products", applies_to_product_ids=[a["id"]])
    r = await resolve(new_buyer, ["E2E_PROD"])
    check("specific_products discounts only the matching line",
          r["total_discount"] == 12000, f"got {r['total_discount']}")

    await seed_coupon(conn, "E2E_CAT", discount_value=Decimal("15"),
                      scope="specific_categories", applies_to_categories=[a["cat"]])
    r = await resolve(new_buyer, ["E2E_CAT"])
    check("specific_categories discounts only the matching category",
          r["total_discount"] == 18000, f"got {r['total_discount']}")

    missing = next(c for c in ("digital", "mala", "yantra", "pooja_kit")
                   if c not in (a["cat"], b["cat"]))
    await seed_coupon(conn, "E2E_NOMATCH", scope="specific_categories",
                      applies_to_categories=[missing])
    r = await resolve(new_buyer, ["E2E_NOMATCH"])
    check("a scope that matches nothing is refused with a clear reason",
          not r["applied"] and "only applies to" in r["rejected"][0]["error"],
          str(r["rejected"]))

    await seed_coupon(conn, "E2E_CAP", discount_value=Decimal("25"),
                      max_discount_amount=Decimal("300"))
    r = await resolve(new_buyer, ["E2E_CAP"])
    check("percentage cap is honoured", r["total_discount"] == 30000, f"got {r['total_discount']}")

    # ── AUDIENCE ─────────────────────────────────────────────────────────────
    print("\nAudience")
    await seed_coupon(conn, "E2E_WELCOME", audience="first_purchase")
    check("first_purchase works for a buyer with no paid order",
          (await resolve(new_buyer, ["E2E_WELCOME"]))["total_discount"] == 20000)
    r = await resolve(repeat_buyer, ["E2E_WELCOME"])
    check("first_purchase is refused once the buyer has paid before",
          not r["applied"] and "first purchase" in r["rejected"][0]["error"], str(r["rejected"]))

    staff_id = await seed_coupon(conn, "E2E_STAFF", discount_value=Decimal("40"),
                                 audience="employees", usage_limit_per_user=None)
    r = await resolve(new_buyer, ["E2E_STAFF"])
    check("employees coupon refuses a non-employee",
          not r["applied"] and "team members only" in r["rejected"][0]["error"], str(r["rejected"]))
    await conn.execute(
        "INSERT INTO employee_coupons (id, coupon_id, user_id) VALUES (gen_random_uuid(),$1::uuid,$2::uuid)",
        staff_id, new_buyer)
    check("employees coupon works once the buyer is on the list",
          (await resolve(new_buyer, ["E2E_STAFF"]))["total_discount"] == 80000)
    await conn.execute("DELETE FROM employee_coupons WHERE coupon_id=$1::uuid", staff_id)
    check("removing the employee revokes it immediately, with no other change",
          not (await resolve(new_buyer, ["E2E_STAFF"]))["applied"])

    vip_id = await seed_coupon(conn, "E2E_VIP", discount_type="fixed_amount",
                               discount_value=Decimal("100"), currency="INR",
                               audience="specific_users")
    check("specific_users refuses an account not on the whitelist",
          not (await resolve(new_buyer, ["E2E_VIP"]))["applied"])
    await conn.execute(
        "INSERT INTO coupon_user_whitelist (id, coupon_id, user_id) VALUES (gen_random_uuid(),$1::uuid,$2::uuid)",
        vip_id, new_buyer)
    check("specific_users works for a whitelisted account",
          (await resolve(new_buyer, ["E2E_VIP"]))["total_discount"] == 10000)

    # ── CART RULES & CURRENCY ────────────────────────────────────────────────
    print("\nCart rules")
    await seed_coupon(conn, "E2E_MIN", min_order_amount=Decimal("5000"))
    check("minimum order value blocks a cart below it",
          not (await resolve(new_buyer, ["E2E_MIN"]))["applied"])
    await seed_coupon(conn, "E2E_QTY", min_quantity=5)
    check("minimum quantity blocks a cart with too few items",
          not (await resolve(new_buyer, ["E2E_QTY"]))["applied"])
    await seed_coupon(conn, "E2E_USD", discount_type="fixed_amount",
                      discount_value=Decimal("20"), currency="USD")
    check("a USD-only coupon is refused on an INR cart",
          not (await resolve(new_buyer, ["E2E_USD"]))["applied"])
    check("an unknown code is refused, not silently ignored",
          (await resolve(new_buyer, ["E2E_NOPE"]))["rejected"][0]["error"].startswith("Invalid"))

    # ── AUTO-APPLY ───────────────────────────────────────────────────────────
    print("\nAuto-apply")
    await seed_coupon(conn, "E2E_AUTO5", discount_value=Decimal("5"),
                      trigger_type="auto_apply", is_stackable=True,
                      audience="first_purchase", usage_limit_per_user=None)
    r = await resolve(new_buyer)                      # nothing typed
    check("an auto-apply coupon applies with no code typed",
          [c["code"] for c in r["applied"]] == ["E2E_AUTO5"] and r["total_discount"] == 10000,
          str(r["applied"]))
    check("auto-apply respects audience — the repeat buyer gets nothing",
          not (await resolve(repeat_buyer))["applied"])
    check("an auto-apply coupon the buyer can't use stays silent (no error shown)",
          not (await resolve(repeat_buyer))["rejected"])

    await seed_coupon(conn, "E2E_AUTOMIN", discount_value=Decimal("5"),
                      trigger_type="auto_apply", min_order_amount=Decimal("9999"))
    r = await resolve(new_buyer)
    check("an auto-apply coupon whose minimum is unmet drops out of the applied list",
          "E2E_AUTOMIN" not in [c["code"] for c in r["applied"]])

    await seed_coupon(conn, "E2E_FREESHIP", discount_type="free_shipping",
                      discount_value=None, trigger_type="auto_apply", is_stackable=True)
    r = await resolve(new_buyer, [], shipping=8000)
    ship = next(c for c in r["applied"] if c["code"] == "E2E_FREESHIP")
    check("free_shipping waives the real shipping charge at checkout",
          ship["amount"] == 8000, f"got {ship['amount']}")
    r0 = await resolve(new_buyer)                     # cart page: shipping unknown
    check("free_shipping still shows on the cart page, valued at 0",
          any(c["code"] == "E2E_FREESHIP" for c in r0["applied"]) and r0["free_shipping"])

    # ── STACKING ─────────────────────────────────────────────────────────────
    print("\nStacking")
    r = await resolve(new_buyer)
    check("two stackable auto-apply coupons both apply and sum",
          {c["code"] for c in r["applied"]} == {"E2E_AUTO5", "E2E_FREESHIP"}, str(r["applied"]))

    await seed_coupon(conn, "E2E_EXCL", discount_value=Decimal("30"),
                      trigger_type="auto_apply", is_stackable=False, auto_apply_priority=5)
    r = await resolve(new_buyer)
    check("a higher-priority exclusive coupon replaces every stackable one",
          [c["code"] for c in r["applied"]] == ["E2E_EXCL"], str(r["applied"]))
    check("an exclusive coupon's own discount is still correct",
          r["total_discount"] == 60000, f"got {r['total_discount']}")
    r = await resolve(new_buyer, ["E2E_ALL"])
    check("a typed code blocked by an exclusive gets an explanatory refusal",
          any("cannot be combined" in x["error"] for x in r["rejected"]), str(r["rejected"]))
    await conn.execute("UPDATE coupons SET is_active=false WHERE code='E2E_EXCL'::citext")
    check("deactivating a coupon takes it out immediately",
          "E2E_EXCL" not in [c["code"] for c in (await resolve(new_buyer))["applied"]])

    # ── USAGE LIMITS ─────────────────────────────────────────────────────────
    print("\nUsage limits")
    await seed_coupon(conn, "E2E_ONCE", usage_limit=1, usage_count=1)
    check("a coupon at its global limit is refused",
          "usage limit" in (await resolve(new_buyer, ["E2E_ONCE"]))["rejected"][0]["error"])

    # ── CHECKOUT MONEY PATH ──────────────────────────────────────────────────
    # Mirrors backend/server.py checkout(): resolve -> clamp -> write the order,
    # then _mark_paid() -> record_redemptions().
    print("\nCheckout & redemption")
    # A stackable manual code so the order carries BOTH a typed and an auto-applied
    # coupon — the multi-coupon order the stacking rules exist to produce.
    await seed_coupon(conn, "E2E_STACKME", discount_value=Decimal("10"), is_stackable=True)
    order_id = uuid.uuid4()
    r = await resolve(new_buyer, ["E2E_STACKME"], shipping=8000)
    check("a stackable typed code combines with the auto-applied ones",
          {c["code"] for c in r["applied"]} == {"E2E_STACKME", "E2E_AUTO5", "E2E_FREESHIP"},
          str([c["code"] for c in r["applied"]]))
    shipping_total = 8000
    discount = min(r["total_discount"], subtotal + shipping_total)
    total = subtotal + shipping_total - discount
    check("order total = subtotal + shipping - discount, never negative",
          total >= 0 and total == subtotal + shipping_total - discount, f"total={total}")

    addr_id = await conn.fetchval(
        "SELECT id FROM addresses WHERE user_id = $1::uuid LIMIT 1", new_buyer)
    await conn.execute(
        """INSERT INTO orders (id, user_id, status, currency, subtotal, discount_total,
                tax_total, shipping_total, grand_total, shipping_address_id,
                billing_address_id, placed_at, coupon_breakdown)
           VALUES ($1,$2::uuid,'pending','INR',$3,$4,0,$5,$6,$7,$7,now(),$8::jsonb)""",
        order_id, new_buyer, db.to_amount(subtotal), db.to_amount(discount),
        db.to_amount(shipping_total), db.to_amount(total), addr_id, r["applied"])
    stored = await conn.fetchval("SELECT coupon_breakdown FROM orders WHERE id=$1", order_id)
    check("every applied coupon is stored as its own line on the order",
          len(stored) == len(r["applied"]) and all("amount" in c for c in stored), str(stored))

    before = await conn.fetchval("SELECT usage_count FROM coupons WHERE code='E2E_STACKME'::citext")
    order = {"order_id": str(order_id), "user_id": new_buyer, "coupon_breakdown": stored}
    await cr.record_redemptions(conn, order)
    rows = db._rows(await conn.fetch(
        "SELECT coupon_code, discount_amount, was_auto_applied FROM coupon_redemptions WHERE order_id=$1",
        order_id))
    after = await conn.fetchval("SELECT usage_count FROM coupons WHERE code='E2E_STACKME'::citext")
    check("payment capture writes one redemption row per applied coupon",
          len(rows) == len(stored), f"{len(rows)} rows for {len(stored)} coupons")
    check("redemption records the amount actually granted",
          any(db.to_paise(x["discount_amount"]) == 20000 for x in rows), str(rows))
    check("redemption flags whether the coupon was auto-applied",
          any(x["was_auto_applied"] for x in rows) and any(not x["was_auto_applied"] for x in rows),
          str(rows))
    check("usage_count is incremented on capture", after == before + 1, f"{before} -> {after}")

    await cr.record_redemptions(conn, order)          # webhook/verify race
    again = await conn.fetchval(
        "SELECT count(*) FROM coupon_redemptions WHERE order_id=$1", order_id)
    twice = await conn.fetchval("SELECT usage_count FROM coupons WHERE code='E2E_STACKME'::citext")
    check("re-running capture is a no-op — no double redemption, no double count",
          again == len(rows) and twice == after, f"rows={again} count={twice}")

    # Per-user limit now bites, because a redemption exists.
    check("the per-user limit counts purchases, and blocks the second attempt",
          "already used" in (await resolve(new_buyer, ["E2E_STACKME"]))["rejected"][0]["error"])

    # ── SECURITY ─────────────────────────────────────────────────────────────
    print("\nSecurity")
    # resolve() trusts the cart dict it is handed — that is the point of hoisting the
    # reads out of it. The guarantee therefore lives one layer up: the HTTP handlers
    # must build that dict themselves and accept nothing about the cart from the
    # caller. So assert on the request surface, which is where forgery would enter.
    import inspect

    import server

    money_ish = ("subtotal", "total", "amount", "price", "product_id", "discount", "qty")
    surface = {}
    for model in (server.CouponApplyIn, server.CheckoutIn):
        surface[model.__name__] = [f for f in model.model_fields
                                   if any(w in f for w in money_ish)]
    check("no coupon/checkout request field carries a cart total or product list",
          surface == {"CouponApplyIn": [], "CheckoutIn": []}, str(surface))

    for fn in (server.coupons_auto_apply, server.coupons_validate):
        params = set(inspect.signature(fn).parameters) - {"request", "user_id", "body", "_"}
        check(f"/{fn.__name__} takes no cart figures as query params", not params, str(params))

    src = inspect.getsource(server.checkout)
    check("checkout re-resolves coupons server-side and clamps the discount",
          "coupon_rules.resolve(" in src and "min(credit_discount" in src)
    check("checkout accepts only the typed code, never the auto-applied list",
          "body.coupon_code" in src and "auto_applied" not in src)

    for tbl in ("employee_coupons", "coupon_user_whitelist"):
        rls = await conn.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", f"public.{tbl}")
        pol = await conn.fetchval(
            "SELECT count(*) FROM pg_policies WHERE tablename = $1", tbl)
        check(f"{tbl} is not readable by PostgREST clients (RLS on, no policies)",
              rls and pol == 0, f"rls={rls} policies={pol}")

    raise Rollback


async def main() -> int:
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — cannot run.")
        return 2
    await db.connect()
    print("Coupon rules engine — end-to-end (all writes roll back)")
    try:
        async with db.transaction() as conn:
            await run(conn)
    except Rollback:
        pass
    finally:
        await db.disconnect()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED: " + "; ".join(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
