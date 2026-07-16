"""Tredev end-to-end backend tests (pytest).

All in ONE class so pytest-xdist loadscope keeps sequential state on a single worker.
Tests are ordered by name; the file uses `pytest -p ordering` if needed, but the
default alphabetical class ordering already gives us the sequence 01→99.
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://verified-stone.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@gemora.in"
ADMIN_PASS = "admin@1234"
BUYER_EMAIL = "priya@example.com"
BUYER_PASS = "priya@1234"


def _post(path, json=None, headers=None, cookies=None):
    return requests.post(f"{API}{path}", json=json, headers=headers or {}, cookies=cookies or {}, timeout=30)


def _get(path, headers=None, cookies=None, params=None):
    return requests.get(f"{API}{path}", headers=headers or {}, cookies=cookies or {}, params=params, timeout=30)


class TestGemora:
    """Full Tredev lifecycle: seed → auth → catalog → verify → cart → checkout → dispatch → revoke."""

    S = {}  # class-level shared state

    # ---------- 01: Meta & seed ----------
    def test_01_root_public_key(self):
        r = _get("/")
        assert r.status_code == 200
        d = r.json()
        assert d["app"] == "Tredev"
        assert isinstance(d.get("public_key_ed25519_hex"), str) and len(d["public_key_ed25519_hex"]) == 64

    def test_02_seed_idempotent(self):
        r1 = _post("/dev/seed")
        r2 = _post("/dev/seed")
        assert r1.status_code == 200 and r2.status_code == 200
        assert r2.json()["ok"] is True and r2.json()["products"] >= 8

    # ---------- 02: Auth ----------
    def test_03_admin_login(self):
        r = _post("/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["email"] == ADMIN_EMAIL
        assert d["user"]["is_admin"] is True
        TestGemora.S["admin_token"] = d["token"]

    def test_04_buyer_login(self):
        r = _post("/auth/login", {"email": BUYER_EMAIL, "password": BUYER_PASS})
        assert r.status_code == 200, r.text
        TestGemora.S["buyer_token"] = r.json()["token"]

    def test_05_me_with_bearer(self):
        r = _get("/auth/me", headers={"Authorization": f"Bearer {TestGemora.S['buyer_token']}"})
        assert r.status_code == 200
        assert r.json()["email"] == BUYER_EMAIL

    @pytest.mark.skip(
        reason="Stale: /auth/otp/send + /auth/otp/verify were removed in favour of "
               "Firebase-only phone verification (see test_media_events.py::"
               "TestLegacyOTPRemoved, which asserts they 404). This test predates that "
               "change and has been failing since. Signup now needs a real Firebase ID "
               "token via /auth/firebase-verify, which can't be minted from a test "
               "without Firebase credentials — rewrite against the Firebase Auth "
               "emulator to restore coverage.")
    def test_06_signup_and_duplicate(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        phone = f"9222{uuid.uuid4().int % 1000000:06d}"
        _post("/auth/otp/send", {"phone": phone, "purpose": "verify"})
        v = _post("/auth/otp/verify", {"phone": phone, "code": "123456"})
        assert v.status_code == 200, v.text
        tok = v.json().get("otp_verification_token")
        r1 = _post("/auth/signup", {"email": email, "password": "pass1234", "name": "T", "phone": phone, "otp_verification_token": tok})
        assert r1.status_code == 200, r1.text
        assert "token" in r1.json()
        # duplicate email should fail
        _post("/auth/otp/send", {"phone": phone, "purpose": "verify"})
        v2 = _post("/auth/otp/verify", {"phone": phone, "code": "123456"})
        tok2 = v2.json().get("otp_verification_token")
        r2 = _post("/auth/signup", {"email": email, "password": "pass1234", "name": "T", "phone": phone, "otp_verification_token": tok2})
        assert r2.status_code == 400

    # ---------- 03: Catalog ----------
    def test_07_products_list(self):
        r = _get("/products")
        assert r.status_code == 200
        prods = r.json()
        assert isinstance(prods, list) and len(prods) >= 8
        TestGemora.S["products"] = prods

    def test_08_product_detail_and_units(self):
        found = False
        for p in TestGemora.S["products"]:
            slug = p["slug"]
            r = _get(f"/products/{slug}")
            assert r.status_code == 200
            d = r.json()
            units = d.get("available_units") or []
            if units and d.get("is_serialized", True):
                TestGemora.S["product_slug"] = slug
                TestGemora.S["product_id"] = d["product_id"]
                TestGemora.S["unit_id"] = units[0]["unit_id"]
                assert "has_certificate" in units[0]
                found = True
                break
        assert found, "no product with available serialised units"

    def test_09_categories(self):
        r = _get("/categories")
        assert r.status_code == 200
        d = r.json()
        for k in ("categories", "planets", "purposes"):
            assert k in d, f"missing {k} in {d.keys()}"

    def test_10_vernacular_search_pukhraj(self):
        r = _get("/products", params={"q": "pukhraj"})
        assert r.status_code == 200
        results = r.json()
        assert isinstance(results, list) and len(results) >= 1
        haystack = " ".join(
            [(p.get("name") or "") + " " + (p.get("slug") or "") + " " + (p.get("devanagari_name") or "") for p in results]
        ).lower()
        assert "sapphire" in haystack or "pukhraj" in haystack, f"unexpected results: {haystack}"

    # ---------- 04: Verification (crown jewel) ----------
    def test_11_admin_certs_and_pick_activated(self):
        r = _get("/admin/certificates", headers={"Authorization": f"Bearer {TestGemora.S['admin_token']}"})
        assert r.status_code == 200, r.text
        certs = r.json()
        activated = [c for c in certs if c.get("activated")]
        assert activated, "seed should include at least one activated cert"
        TestGemora.S["seed_cert"] = activated[0]

    def test_12_verify_authentic(self):
        tok = TestGemora.S["seed_cert"]["qr_token"]
        r = _get(f"/verify/{tok}")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "AUTHENTIC", d
        assert d["cert"]["signature_ed25519_hex"]
        assert d["cert"]["content_hash_sha256"]
        assert d["unit"] and d["product"]
        assert d["verified_at"]

    def test_13_verify_suspicious_unknown(self):
        r = _get("/verify/qr_DOES_NOT_EXIST_XYZ")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "SUSPICIOUS"
        assert d.get("reason")

    def test_14_qr_png(self):
        tok = TestGemora.S["seed_cert"]["qr_token"]
        r = _get(f"/verify/qr/{tok}.png")
        assert r.status_code == 200
        assert "image/png" in r.headers.get("content-type", "")
        assert len(r.content) > 100

    # ---------- 05: RBAC ----------
    def test_15_rbac_non_admin_forbidden(self):
        r = _get("/admin/certificates", headers={"Authorization": f"Bearer {TestGemora.S['buyer_token']}"})
        assert r.status_code == 403

    # ---------- 06: Cart + double-sell prevention ----------
    def test_16_cart_add_anon_a(self):
        s = requests.Session()
        r = s.post(
            f"{API}/cart/add",
            json={"product_id": TestGemora.S["product_id"], "unit_id": TestGemora.S["unit_id"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        cart = r.json()
        assert cart.get("items") and cart["items"][0]["unit_id"] == TestGemora.S["unit_id"]
        TestGemora.S["cookies_a"] = s.cookies.get_dict()
        TestGemora.S["line_id"] = cart["items"][0]["line_id"]

    def test_17_double_sell_returns_409(self):
        # different anon cart tries same unit
        s2 = requests.Session()
        r = s2.post(
            f"{API}/cart/add",
            json={"product_id": TestGemora.S["product_id"], "unit_id": TestGemora.S["unit_id"]},
            timeout=30,
        )
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:200]}"

    def test_18_cart_remove_releases_reservation(self):
        cookies = TestGemora.S["cookies_a"]
        r = requests.post(f"{API}/cart/remove/{TestGemora.S['line_id']}", cookies=cookies, timeout=30)
        assert r.status_code == 200
        # a fresh anon cart should now be able to reserve
        s3 = requests.Session()
        r2 = s3.post(
            f"{API}/cart/add",
            json={"product_id": TestGemora.S["product_id"], "unit_id": TestGemora.S["unit_id"]},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        TestGemora.S["checkout_cookies"] = s3.cookies.get_dict()
        TestGemora.S["checkout_line_id"] = r2.json()["items"][0]["line_id"]

    # ---------- 07: Checkout, mock-pay ----------
    def test_19_checkout_creates_mock_order(self):
        headers = {"Authorization": f"Bearer {TestGemora.S['buyer_token']}"}
        # buyer is now logged in; but their cart is server-side keyed by user_id.
        # Move the anon reservation to the buyer by re-adding under the buyer cart:
        #   The reservation for the unit exists under anon; buyer has no items.
        # Simpler: place the order using the anon cookies + no auth, so user_id=None.
        # But we need the buyer to receive verified-items → order must have user_id.
        # Approach: add to buyer's cart while anon reservation is released, then checkout.
        # First release the anon reservation, then add as buyer.
        requests.post(
            f"{API}/cart/remove/{TestGemora.S['checkout_line_id']}",
            cookies=TestGemora.S["checkout_cookies"],
            timeout=30,
        )
        r_add = requests.post(
            f"{API}/cart/add",
            json={"product_id": TestGemora.S["product_id"], "unit_id": TestGemora.S["unit_id"]},
            headers=headers,
            timeout=30,
        )
        assert r_add.status_code == 200, r_add.text

        payload = {
            "shipping_name": "Priya Test",
            "shipping_phone": "9999999999",
            "shipping_address": "1 Test Lane",
            "shipping_city": "Mumbai",
            "shipping_state": "MH",
            "shipping_pincode": "400001",
            "email": BUYER_EMAIL,
        }
        r = requests.post(f"{API}/checkout", json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order"]["mock_payment"] is True
        assert d["order"]["status"] == "pending_payment"
        TestGemora.S["order_id"] = d["order"]["order_id"]

    def test_20_mock_pay_flips_status(self):
        r = requests.post(f"{API}/checkout/mock-pay/{TestGemora.S['order_id']}", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"

    # ---------- 08: Dispatch → activation + vault ----------
    def test_21_admin_dispatch_activates(self):
        headers = {"Authorization": f"Bearer {TestGemora.S['admin_token']}"}
        r = requests.post(
            f"{API}/admin/dispatch",
            json={
                "order_id": TestGemora.S["order_id"],
                "unit_id": TestGemora.S["unit_id"],
                "tracking_number": "TRK123",
                "courier": "BlueDart",
            },
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        certs = requests.get(f"{API}/admin/certificates", headers=headers, timeout=30).json()
        unit_cert = next((c for c in certs if c.get("unit_id") == TestGemora.S["unit_id"]), None)
        assert unit_cert and unit_cert["activated"] is True
        TestGemora.S["dispatched_cert_id"] = unit_cert["cert_id"]
        TestGemora.S["dispatched_qr_token"] = unit_cert["qr_token"]

    def test_22_verified_items_vault(self):
        headers = {"Authorization": f"Bearer {TestGemora.S['buyer_token']}"}
        r = requests.get(f"{API}/me/verified-items", headers=headers, timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert any(i.get("item", {}).get("unit_id") == TestGemora.S["unit_id"] for i in items), f"vault: {items}"

    def test_23_verify_still_authentic_after_dispatch(self):
        r = _get(f"/verify/{TestGemora.S['dispatched_qr_token']}")
        assert r.status_code == 200
        assert r.json()["status"] == "AUTHENTIC"

    # ---------- 09: Revoke ----------
    def test_24_revoke_then_verify_revoked(self):
        headers = {"Authorization": f"Bearer {TestGemora.S['admin_token']}"}
        r = requests.post(
            f"{API}/admin/certificates/revoke/{TestGemora.S['dispatched_cert_id']}",
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        v = _get(f"/verify/{TestGemora.S['dispatched_qr_token']}")
        assert v.status_code == 200
        assert v.json()["status"] == "REVOKED", v.json()

    # ---------- 10: Emergent session bearer fallback ----------
    def test_25_emergent_session_bearer(self):
        # Reaches past the API into the session store, so it follows the store: this
        # used to insert into Mongo's user_sessions; sessions now live in Postgres.
        # Intent is unchanged — a live session token must authenticate via Bearer.
        import asyncio
        import asyncpg
        from datetime import datetime, timedelta, timezone

        dsn = os.environ.get("DATABASE_URL")
        if not dsn:  # pytest doesn't load backend/.env the way the server does
            from pathlib import Path

            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parents[1] / ".env")
            dsn = os.environ.get("DATABASE_URL")
        assert dsn, "DATABASE_URL not set (backend/.env)"
        session_token = f"sess_{uuid.uuid4().hex}"
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)

        async def _mint():
            conn = await asyncpg.connect(dsn, statement_cache_size=0)
            try:
                uid_ = await conn.fetchval(
                    "SELECT id FROM users WHERE email = $1::citext", BUYER_EMAIL)
                assert uid_, "buyer not seeded"
                await conn.execute(
                    """INSERT INTO user_sessions (session_token, user_id, expires_at)
                       VALUES ($1, $2, $3)
                       ON CONFLICT (session_token) DO UPDATE
                          SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at""",
                    session_token, uid_, expires_at)
            finally:
                await conn.close()

        asyncio.run(_mint())
        r = _get("/auth/me", headers={"Authorization": f"Bearer {session_token}"})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == BUYER_EMAIL

    # ---------- 11: Consultation ----------
    def test_26_list_astrologers(self):
        r = _get("/consultation/astrologers")
        assert r.status_code == 200
        astros = r.json()
        assert isinstance(astros, list) and len(astros) >= 3
        TestGemora.S["astro_id"] = astros[0]["astrologer_id"]

    def test_27_consultation_book(self):
        r = _post("/consultation/book", {
            "astrologer_id": TestGemora.S["astro_id"],
            "slot_iso": "2026-02-01T10:00:00Z",
            "name": "Anon",
            "phone": "9999999999",
            "email": "anon@example.com",
            "concern": "career",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("booking_id")
