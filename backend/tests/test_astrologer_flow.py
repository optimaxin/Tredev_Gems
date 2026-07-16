"""Tredev — Astrologer-side workspace + Affiliate commission system tests."""
import os
import re
import uuid
import time
import urllib.parse
import requests
import pytest

# All classes in this file share module-level fixture state (_jwt, _booking_id, etc.)
# so we force xdist to keep them together on one worker.
pytestmark = pytest.mark.xdist_group("astrologer_flow")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://verified-stone.preview.emergentagent.com").rstrip("/")
# Welcome/reset links point at the frontend (PUBLIC_APP_URL), which only equals
# BASE_URL when frontend and backend share a host, as on the old preview deploy.
APP_URL = os.environ.get("PUBLIC_APP_URL", BASE_URL).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@gemora.in"
ADMIN_PASS = "admin@1234"


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    requests.post(f"{API}/dev/seed", timeout=60)
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def rand():
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def created_astrologer(owner_token, rand):
    """Create an astrologer, set password, log in, book a consultation. Returns full state dict."""
    email = f"qa+{rand}@example.com"
    payload = {
        "name": f"QA Astro {rand}",
        "email": email,
        "price": 200000,
        "commission_pct": 15,
        "expertise": ["Vedic"],
        "years": 5,
    }
    r = requests.post(f"{API}/admin/astrologers", json=payload, headers=_headers(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("astrologer_id"), data
    assert data.get("affiliate_code"), data
    assert data.get("welcome_url", "").startswith(f"{APP_URL}/astrologer/set-password?token="), data.get("welcome_url")
    q = urllib.parse.urlparse(data["welcome_url"]).query
    token = urllib.parse.parse_qs(q)["token"][0]
    data["_set_token"] = token
    data["_email"] = email
    data["_password"] = "astro@1234"

    # Immediately set password + log in so subsequent tests (in any order) have _jwt
    sp = requests.post(f"{API}/astrologer/auth/set-password", json={"token": token, "password": "astro@1234"}, timeout=30)
    assert sp.status_code == 200, sp.text
    data["_jwt"] = sp.json()["token"]
    return data


class TestAdminAstrologerCRUD:

    def test_01_create_response_shape(self, created_astrologer):
        # IDs are uuids since the Postgres migration (were "astro_"-prefixed in Mongo).
        # The API field name is unchanged; only the value format moved.
        uuid.UUID(created_astrologer["astrologer_id"])
        assert isinstance(created_astrologer["affiliate_code"], str) and len(created_astrologer["affiliate_code"]) >= 4
        # Scheme follows PUBLIC_APP_URL — https in deploys, http for local dev.
        assert created_astrologer["welcome_url"].startswith(("https://", "http://"))

    def test_02_regen_welcome_link(self, owner_token, created_astrologer):
        aid = created_astrologer["astrologer_id"]
        r = requests.post(f"{API}/admin/astrologers/{aid}/welcome-link", headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["welcome_url"].startswith(f"{APP_URL}/astrologer/set-password?token=")
        assert data["email"] == created_astrologer["_email"]

    def test_03_patch_commission_pct_valid(self, owner_token, created_astrologer):
        aid = created_astrologer["astrologer_id"]
        r = requests.patch(f"{API}/admin/astrologers/{aid}", json={"commission_pct": 25}, headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["commission_pct"] == 25

    def test_04_patch_commission_pct_invalid(self, owner_token, created_astrologer):
        aid = created_astrologer["astrologer_id"]
        r1 = requests.patch(f"{API}/admin/astrologers/{aid}", json={"commission_pct": -1}, headers=_headers(owner_token), timeout=30)
        r2 = requests.patch(f"{API}/admin/astrologers/{aid}", json={"commission_pct": 101}, headers=_headers(owner_token), timeout=30)
        assert r1.status_code == 400, r1.text
        assert r2.status_code == 400, r2.text

    def test_05_admin_affiliate_summary_fresh(self, owner_token, created_astrologer):
        aid = created_astrologer["astrologer_id"]
        r = requests.get(f"{API}/admin/astrologers/{aid}/affiliate", headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "astrologer" in d and "summary" in d and "commissions" in d
        s = d["summary"]
        for k in ("visits", "orders", "total_commission", "pending_commission", "paid_commission"):
            assert k in s, s
        assert s["orders"] == 0
        assert s["total_commission"] == 0
        assert s["pending_commission"] == 0
        assert s["paid_commission"] == 0
        assert d["commissions"] == []


class TestAstrologerAuth:

    def test_01_set_password_and_get_jwt(self, created_astrologer):
        r = requests.post(f"{API}/astrologer/auth/set-password", json={
            "token": created_astrologer["_set_token"], "password": "astro@1234"
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("token")
        assert d["astrologer"]["astrologer_id"] == created_astrologer["astrologer_id"]
        assert "password_hash" not in d["astrologer"]
        created_astrologer["_jwt"] = d["token"]

    def test_02_me(self, created_astrologer):
        r = requests.get(f"{API}/astrologer/me", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "password_hash" not in d
        assert d["email"] == created_astrologer["_email"]

    def test_03_login_correct(self, created_astrologer):
        r = requests.post(f"{API}/astrologer/auth/login", json={
            "email": created_astrologer["_email"], "password": "astro@1234"
        }, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("token")

    def test_04_login_wrong(self, created_astrologer):
        r = requests.post(f"{API}/astrologer/auth/login", json={
            "email": created_astrologer["_email"], "password": "WRONG"
        }, timeout=30)
        assert r.status_code == 401, r.text


class TestAstrologerWorkspace:

    def test_01_dashboard(self, created_astrologer):
        r = requests.get(f"{API}/astrologer/dashboard", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_bookings", "upcoming", "completed", "affiliate_orders", "total_commission", "pending_commission"):
            assert k in d, d
            assert isinstance(d[k], (int, float))

    def test_02_consultations_empty(self, created_astrologer):
        r = requests.get(f"{API}/astrologer/consultations", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_03_availability_put_and_get(self, created_astrologer):
        r = requests.put(f"{API}/astrologer/availability", json={
            "weekly_slots": [{"day": 0, "start": "10:00", "end": "12:00"}],
            "blackout_dates": ["2026-03-01"],
        }, headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 200, r.text
        g = requests.get(f"{API}/astrologer/availability", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert g.status_code == 200
        d = g.json()
        assert d["weekly_slots"] == [{"day": 0, "start": "10:00", "end": "12:00"}]
        assert d["blackout_dates"] == ["2026-03-01"]

    def test_04_availability_end_before_start(self, created_astrologer):
        r = requests.put(f"{API}/astrologer/availability", json={
            "weekly_slots": [{"day": 1, "start": "12:00", "end": "10:00"}],
            "blackout_dates": [],
        }, headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 400, r.text

    def test_05_availability_bad_time(self, created_astrologer):
        r = requests.put(f"{API}/astrologer/availability", json={
            "weekly_slots": [{"day": 1, "start": "9:00", "end": "10:00"}],
            "blackout_dates": [],
        }, headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 400, r.text

    def test_06_availability_bad_date(self, created_astrologer):
        r = requests.put(f"{API}/astrologer/availability", json={
            "weekly_slots": [],
            "blackout_dates": ["2026/03/01"],
        }, headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 400, r.text


class TestConsultationBooking:

    def test_01_book_and_visible_to_astrologer(self, created_astrologer):
        aid = created_astrologer["astrologer_id"]
        r = requests.post(f"{API}/consultation/book", json={
            "astrologer_id": aid,
            "slot_iso": "2030-01-01T10:00:00Z",
            "name": "Test Buyer",
            "email": "buyer@example.com",
            "phone": "+919000000000",
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["jitsi_room"].startswith("gemora-")
        assert d["meeting_link"].startswith("https://meet.jit.si/gemora-")
        created_astrologer["_booking_id"] = d["booking_id"]

        # visible in astro consultations
        c = requests.get(f"{API}/astrologer/consultations", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert c.status_code == 200
        bookings = c.json()
        assert any(b["booking_id"] == d["booking_id"] for b in bookings)

    def test_02_patch_booking(self, created_astrologer):
        bid = created_astrologer["_booking_id"]
        r = requests.patch(f"{API}/astrologer/consultations/{bid}", json={
            "status": "completed", "notes": "Session complete"
        }, headers=_headers(created_astrologer["_jwt"]), timeout=30)
        assert r.status_code == 200, r.text
        c = requests.get(f"{API}/astrologer/consultations", headers=_headers(created_astrologer["_jwt"]), timeout=30)
        booking = next(b for b in c.json() if b["booking_id"] == bid)
        assert booking["status"] == "completed"
        assert booking.get("notes") == "Session complete"

    def test_03_cannot_patch_others_booking(self, owner_token, created_astrologer, rand):
        # Create a second astrologer, log them in, then try patching booking of first astrologer.
        email = f"qa+other{rand}@example.com"
        cr = requests.post(f"{API}/admin/astrologers", json={
            "name": f"QA Astro Other {rand}", "email": email, "price": 100000,
            "commission_pct": 5, "expertise": ["X"], "years": 1
        }, headers=_headers(owner_token), timeout=30)
        assert cr.status_code == 200
        wl = cr.json()["welcome_url"]
        tok = urllib.parse.parse_qs(urllib.parse.urlparse(wl).query)["token"][0]
        sp = requests.post(f"{API}/astrologer/auth/set-password", json={"token": tok, "password": "astro@1234"}, timeout=30).json()
        jwt2 = sp["token"]
        bid = created_astrologer["_booking_id"]
        r = requests.patch(f"{API}/astrologer/consultations/{bid}", json={"status": "completed"}, headers=_headers(jwt2), timeout=30)
        assert r.status_code == 404, r.text


class TestPublicAffiliateResolver:

    def test_01_resolve_and_dedupe_visits(self, owner_token, created_astrologer):
        code = created_astrologer["affiliate_code"]
        cookies = {"gemora_anon": f"anon_test_{uuid.uuid4().hex[:12]}"}
        r = requests.get(f"{API}/r/{code}", cookies=cookies, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["astrologer_id"] == created_astrologer["astrologer_id"]
        assert d["affiliate_code"] == code
        assert d["name"]
        # Second hit same anon cookie -> should dedupe
        requests.get(f"{API}/r/{code}", cookies=cookies, timeout=30)
        aff = requests.get(f"{API}/admin/astrologers/{created_astrologer['astrologer_id']}/affiliate",
                           headers=_headers(owner_token), timeout=30).json()
        assert aff["summary"]["visits"] == 1, aff["summary"]

    def test_02_unknown_code_404(self):
        r = requests.get(f"{API}/r/DOES_NOT_EXIST_xyz", timeout=30)
        assert r.status_code == 404


def _pick_product():
    """Prefer a non-serialized product (no unit_id needed); fall back to serialized with available unit."""
    r = requests.get(f"{API}/products", timeout=30)
    assert r.status_code == 200
    prods = r.json()
    # First: non-serialized
    for p in prods:
        if not p.get("is_serialized", True):
            return p, None
    # Second: serialized with an available unit
    for p in prods:
        slug = p.get("slug") or p.get("product_id")
        det = requests.get(f"{API}/products/{slug}", timeout=30)
        if det.status_code == 200:
            units = det.json().get("available_units") or det.json().get("units") or []
            avail = next((u for u in units if u.get("status") in (None, "available")), None)
            if avail:
                return p, avail
    return None, None


class TestAffiliateCommission:

    def test_01_end_to_end_commission(self, owner_token, created_astrologer):
        product, unit = _pick_product()
        assert product, "No product available"
        s = requests.Session()
        cart_payload = {"product_id": product["product_id"], "qty": 1}
        if unit:
            cart_payload["unit_id"] = unit["unit_id"]
        r = s.post(f"{API}/cart/add", json=cart_payload, timeout=30)
        assert r.status_code == 200, r.text
        code = created_astrologer["affiliate_code"]
        co = s.post(f"{API}/checkout", json={
            "shipping_name": "Test", "shipping_phone": "+919000000000",
            "shipping_address": "123", "shipping_city": "X", "shipping_state": "Y",
            "shipping_pincode": "560001", "email": "b@b.com",
            "affiliate_ref": code,
        }, timeout=30)
        assert co.status_code == 200, co.text
        order = co.json()["order"]
        assert order["affiliate_code"] == code
        assert order["affiliate_astrologer_id"] == created_astrologer["astrologer_id"]
        subtotal = order["subtotal"]

        pay = s.post(f"{API}/checkout/mock-pay/{order['order_id']}", timeout=30)
        assert pay.status_code == 200, pay.text

        # Check admin affiliate view
        aff = requests.get(f"{API}/admin/astrologers/{created_astrologer['astrologer_id']}/affiliate",
                           headers=_headers(owner_token), timeout=30).json()
        commissions = aff["commissions"]
        assert len(commissions) == 1, commissions
        c = commissions[0]
        expected = int(round(subtotal * 25 / 100))
        assert c["commission_amount"] == expected, (c, expected, subtotal)
        assert c["order_id"] == order["order_id"]

        # Astrologer's own affiliate view
        aff2 = requests.get(f"{API}/astrologer/affiliate", headers=_headers(created_astrologer["_jwt"]), timeout=30).json()
        assert len(aff2["commissions"]) == 1
        assert aff2["summary"]["orders"] == 1
        assert aff2["summary"]["total_commission"] == expected

    def test_02_zero_pct_no_commission(self, owner_token, rand):
        # Create fresh astrologer with pct=0
        email = f"qa+zero{rand}@example.com"
        cr = requests.post(f"{API}/admin/astrologers", json={
            "name": f"QA Zero {rand}", "email": email, "price": 100000,
            "commission_pct": 0, "expertise": ["X"], "years": 1
        }, headers=_headers(owner_token), timeout=30)
        assert cr.status_code == 200
        code = cr.json()["affiliate_code"]
        aid = cr.json()["astrologer_id"]

        product, unit = _pick_product()
        if not product:
            pytest.skip("no product available")
        s = requests.Session()
        cart_payload = {"product_id": product["product_id"], "qty": 1}
        if unit:
            cart_payload["unit_id"] = unit["unit_id"]
        r = s.post(f"{API}/cart/add", json=cart_payload, timeout=30)
        assert r.status_code == 200, r.text
        co = s.post(f"{API}/checkout", json={
            "shipping_name": "T", "shipping_phone": "+919000000000",
            "shipping_address": "1", "shipping_city": "X", "shipping_state": "Y",
            "shipping_pincode": "560001", "email": "z@z.com",
            "affiliate_ref": code,
        }, timeout=30)
        assert co.status_code == 200, co.text
        oid = co.json()["order"]["order_id"]
        pay = s.post(f"{API}/checkout/mock-pay/{oid}", timeout=30)
        assert pay.status_code == 200
        aff = requests.get(f"{API}/admin/astrologers/{aid}/affiliate", headers=_headers(owner_token), timeout=30).json()
        assert aff["commissions"] == [], aff
