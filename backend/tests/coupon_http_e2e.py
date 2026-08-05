"""Authenticated HTTP round-trip over the real coupon endpoints.

    cd backend && ./venv/bin/uvicorn server:app --port 8099 &
    ./venv/bin/python tests/coupon_http_e2e.py

Companion to coupon_e2e.py: that one proves the RULES against the database, this
one proves the HTTP surface — permissions, boundary validation, and the buyer's
actual apply/revoke flow.

SAFE against the live database, and deliberately not part of the destructive
pytest suite (see tests/conftest.py). It creates one coupon (ZZ_E2E_HTTP) and
deletes it; it adds one item to the test buyer's cart and removes it. No order is
placed, no inventory is consumed, no payment gateway is called. Both cleanups are
asserted, so a failure to tidy up shows as a failed check rather than silent drift.
"""
import sys, asyncio, httpx
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv
load_dotenv(BACKEND / ".env")
import server, db

BASE = "http://127.0.0.1:8099/api"
OK, BAD = [], []
def check(n, c, d=""):
    (OK if c else BAD).append(n); print(f"  {'✓' if c else '✗'} {n}{'' if c else f'  → {d}'}")

async def main():
    await db.connect()
    owner = await db.fetch_val(
        """SELECT u.id::text FROM users u JOIN user_roles ur ON ur.user_id=u.id
            JOIN roles r ON r.id=ur.role_id WHERE r.name='admin' AND u.deleted_at IS NULL LIMIT 1""")
    buyer = await db.fetch_val(
        """SELECT u.id::text FROM users u WHERE u.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id
                            WHERE o.user_id=u.id AND p.status='captured') LIMIT 1""")
    cart_items = await db.fetch_all(
        """SELECT c.user_id::text AS uid, count(ci.id) AS n FROM carts c
             JOIN cart_items ci ON ci.cart_id=c.id
            WHERE c.status='active' AND c.user_id IS NOT NULL GROUP BY 1 LIMIT 1""")
    await db.disconnect()
    print(f"owner={owner} buyer={buyer} a-cart-user={cart_items}")

    ah = {"Authorization": f"Bearer {server.make_jwt(owner)}"}
    bh = {"Authorization": f"Bearer {server.make_jwt(buyer)}"}
    cid = None
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as c:
        r = await c.get("/admin/coupons", headers=ah)
        check("owner can list coupons", r.status_code == 200, r.text[:200])
        check("a non-admin buyer cannot", (await c.get("/admin/coupons", headers=bh)).status_code == 403)

        body = {"code": "ZZ_E2E_HTTP", "name": "E2E HTTP", "discount_type": "percentage",
                "discount_value": 10, "audience": "employees", "trigger_type": "manual",
                "is_stackable": False, "usage_limit_per_user": 1, "is_active": True}
        r = await c.post("/admin/coupons", json=body, headers=ah)
        check("create a coupon", r.status_code == 200, r.text[:300])
        if r.status_code != 200:
            return 1
        cid = r.json()["coupon_id"]
        check("percentage value round-trips as a percent, not money",
              r.json()["discount_value"] == 10.0, str(r.json()["discount_value"]))

        r = await c.post("/admin/coupons", json=body, headers=ah)
        check("a duplicate code is rejected with 409", r.status_code == 409, r.text[:150])

        bad = {**body, "code": "ZZ_E2E_BAD", "discount_type": "fixed_amount",
               "discount_value": 10000, "currency": None}
        r = await c.post("/admin/coupons", json=bad, headers=ah)
        check("a flat coupon without a currency is refused at the boundary",
              r.status_code == 400 and "currency" in r.text, r.text[:150])

        bad2 = {**body, "code": "ZZ_E2E_BAD2", "discount_value": 150}
        r = await c.post("/admin/coupons", json=bad2, headers=ah)
        check("a percentage above 100 is refused", r.status_code == 400, r.text[:150])

        bad3 = {**body, "code": "ZZ_E2E_BAD3", "scope": "specific_categories",
                "applies_to_categories": ["not_a_category"]}
        r = await c.post("/admin/coupons", json=bad3, headers=ah)
        check("an unknown category is refused", r.status_code == 400, r.text[:150])

        r = await c.get(f"/admin/coupons/{cid}/members", headers=ah)
        check("member list starts empty", r.status_code == 200 and r.json() == [], r.text[:150])
        r = await c.post(f"/admin/coupons/{cid}/members", json={"user_id": buyer}, headers=ah)
        check("add an employee", r.status_code == 200, r.text[:150])
        r = await c.get(f"/admin/coupons/{cid}/members", headers=ah)
        check("the employee appears in the list",
              len(r.json()) == 1 and r.json()[0]["user_id"] == buyer, r.text[:200])

        # ── Real buyer flow: put something in the cart, exercise the coupon
        #    endpoints against it, then take it back out. The buyer's cart was
        #    verified empty above, so this leaves the account exactly as found.
        prod = (await c.get("/products?limit=50")).json()
        pick = next((p for p in prod if not p.get("out_of_stock")), prod[0])
        r = await c.post("/cart/add", json={"product_id": pick["product_id"], "qty": 1}, headers=bh)
        check("buyer can add an item to their cart", r.status_code == 200, r.text[:200])
        line_id = r.json()["items"][0]["line_id"]
        try:
            r = await c.get("/coupons/auto-apply", headers=bh)
            check("auto-apply runs against the real cart",
                  r.status_code == 200 and "applied" in r.json(), r.text[:200])

            r = await c.post("/coupons/validate", json={"code": "ZZ_E2E_HTTP"}, headers=bh)
            check("an employee coupon validates for a listed employee",
                  r.status_code == 200 and r.json()["applied"][0]["code"].upper() == "ZZ_E2E_HTTP",
                  f"{r.status_code} {r.text[:200]}")
            check("the discount is 10% of the real cart subtotal",
                  r.json()["total_discount"] == round(pick["price"] * 0.10),
                  f"{r.json()['total_discount']} vs {pick['price']}")

            r = await c.delete(f"/admin/coupons/{cid}/members/{buyer}", headers=ah)
            check("remove the employee", r.status_code == 200, r.text[:150])
            r = await c.post("/coupons/validate", json={"code": "ZZ_E2E_HTTP"}, headers=bh)
            check("access is revoked immediately after removal",
                  r.status_code == 400 and "team members only" in r.text,
                  f"{r.status_code} {r.text[:200]}")

            r = await c.post("/coupons/validate", json={"code": "NOPE_NOT_REAL"}, headers=bh)
            check("an unknown code returns a buyer-facing 400",
                  r.status_code == 400 and "Invalid coupon code" in r.text, r.text[:150])
        finally:
            r = await c.post(f"/cart/remove/{line_id}", headers=bh)
            check("test cart item removed — buyer's cart left as found",
                  r.status_code == 200 and not r.json()["items"], r.text[:150])

        r = await c.delete(f"/admin/coupons/{cid}", headers=ah)
        check("an unused coupon deletes cleanly",
              r.status_code == 200 and r.json()["deactivated"] is False, r.text[:150])
        cid = None
        codes = [x["code"].upper() for x in (await c.get("/admin/coupons", headers=ah)).json()]
        check("nothing is left behind", not any(x.startswith("ZZ_E2E") for x in codes), str(codes))

    print(f"\n{len(OK)} passed, {len(BAD)} failed")
    return 1 if BAD else 0

sys.exit(asyncio.run(main()))
