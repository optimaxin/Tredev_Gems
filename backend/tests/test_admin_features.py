"""Tredev — new admin features (owner-only ops, audit log, staff invite, low-stock).

These tests run AFTER test_gemora_backend.py; they re-seed to ensure a clean state.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://verified-stone.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@gemora.in"
ADMIN_PASS = "admin@1234"
BUYER_EMAIL = "priya@example.com"
BUYER_PASS = "priya@1234"


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(f"{API}/auth/login", json={"email": BUYER_EMAIL, "password": BUYER_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def seeded():
    r = requests.post(f"{API}/dev/seed", timeout=60)
    assert r.status_code == 200
    return r.json()


class TestAdminOwnerOps:

    def test_01_low_stock_owner(self, owner_token, seeded):
        r = requests.get(f"{API}/admin/inventory/low-stock", headers=_headers(owner_token), params={"threshold": 2}, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        it = items[0]
        for k in ("name", "slug", "available", "image"):
            assert k in it, f"missing {k} in {it}"

    def test_02_low_stock_customer_forbidden(self, buyer_token):
        r = requests.get(f"{API}/admin/inventory/low-stock", headers=_headers(buyer_token), timeout=30)
        assert r.status_code == 403

    def test_03_create_staff_no_password(self, owner_token):
        email = f"staff_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(
            f"{API}/admin/staff",
            json={"name": "Ravi Test", "email": email, "permissions": ["products", "inventory", "orders"], "phone": "+919111100022"},
            headers=_headers(owner_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("temp_password") and len(d["temp_password"]) >= 8
        assert d.get("invite_channel") in ("whatsapp", "mock")
        # invite_sent may be True/False depending on env vars — but with mock META, wa_send_utility returns cleanly → True
        assert isinstance(d.get("invite_sent"), bool)
        pytest.staff_email = email  # type: ignore[attr-defined]
        pytest.staff_pw = d["temp_password"]  # type: ignore[attr-defined]
        pytest.staff_user_id = d["user_id"]  # type: ignore[attr-defined]

    def test_04_staff_can_login(self):
        r = requests.post(f"{API}/auth/login", json={"email": pytest.staff_email, "password": pytest.staff_pw}, timeout=30)  # type: ignore[attr-defined]
        assert r.status_code == 200, r.text
        pytest.staff_token = r.json()["token"]  # type: ignore[attr-defined]

    def test_05_staff_with_inventory_perm_can_see_low_stock(self):
        r = requests.get(f"{API}/admin/inventory/low-stock", headers=_headers(pytest.staff_token), timeout=30)  # type: ignore[attr-defined]
        assert r.status_code == 200

    def test_06_staff_without_orders_perm_forbidden_on_purge(self, owner_token):
        # Create another staff WITHOUT orders perm
        email = f"staff2_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(
            f"{API}/admin/staff",
            json={"name": "NoOrders Staff", "email": email, "permissions": ["products"]},
            headers=_headers(owner_token),
            timeout=30,
        )
        assert r.status_code == 200
        pw = r.json()["temp_password"]
        tok = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30).json()["token"]
        # Purge is owner-only
        r2 = requests.post(f"{API}/admin/orders/purge", headers=_headers(tok), timeout=30)
        assert r2.status_code == 403

    @pytest.mark.skip(
        reason="Stale: builds its throwaway user via /auth/otp/send + /auth/otp/verify, "
               "which were removed in favour of Firebase-only phone verification "
               "(test_media_events.py::TestLegacyOTPRemoved asserts they 404). Same "
               "root cause as test_gemora_backend.py::test_06. The delete path itself "
               "is fine — it needs a user created some other way (Firebase Auth "
               "emulator, or a direct DB insert).")
    def test_07_delete_user_owner(self, owner_token):
        # signup a throwaway customer (via OTP dev flow), delete via admin endpoint
        email = f"del_{uuid.uuid4().hex[:6]}@example.com"
        phone = f"9111{uuid.uuid4().int % 1000000:06d}"
        requests.post(f"{API}/auth/otp/send", json={"phone": phone, "purpose": "verify"}, timeout=30)
        v = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "123456"}, timeout=30)
        assert v.status_code == 200, v.text
        tok = v.json().get("otp_verification_token")
        r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "pw12345678", "name": "Del", "phone": phone, "otp_verification_token": tok}, timeout=30)
        assert r.status_code == 200, r.text
        # find their user_id via admin/users
        users = requests.get(f"{API}/admin/users", headers=_headers(owner_token), timeout=30).json()
        u = next(x for x in users if x["email"] == email)
        r2 = requests.delete(f"{API}/admin/users/{u['user_id']}", headers=_headers(owner_token), timeout=30)
        assert r2.status_code == 200, r2.text
        # confirm gone
        users2 = requests.get(f"{API}/admin/users", headers=_headers(owner_token), timeout=30).json()
        assert not any(x["email"] == email for x in users2)

    def test_08_delete_user_forbidden_for_customer(self, buyer_token):
        r = requests.delete(f"{API}/admin/users/anything", headers=_headers(buyer_token), timeout=30)
        assert r.status_code == 403

    def test_09_purge_orders_returns_count(self, owner_token):
        # ensure at least one order exists to test purge nontrivially — but even 0 is fine
        r = requests.post(f"{API}/admin/orders/purge", headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True and isinstance(d.get("deleted"), int)
        # subsequent purge should return 0
        r2 = requests.post(f"{API}/admin/orders/purge", headers=_headers(owner_token), timeout=30)
        assert r2.status_code == 200 and r2.json()["deleted"] == 0

    def test_10_delete_order_flow(self, owner_token, buyer_token):
        # Re-seed to have units available
        requests.post(f"{API}/dev/seed", timeout=60)
        products = requests.get(f"{API}/products").json()
        # find first product with available serialised units
        pid, uid_ = None, None
        for p in products:
            det = requests.get(f"{API}/products/{p['slug']}").json()
            units = det.get("available_units") or []
            if units:
                pid, uid_ = det["product_id"], units[0]["unit_id"]
                break
        assert pid and uid_
        # buyer adds & checks out
        r_add = requests.post(f"{API}/cart/add", json={"product_id": pid, "unit_id": uid_}, headers=_headers(buyer_token), timeout=30)
        assert r_add.status_code == 200, r_add.text
        co = requests.post(f"{API}/checkout", json={
            "shipping_name": "P", "shipping_phone": "9999999999", "shipping_address": "1", "shipping_city": "M",
            "shipping_state": "MH", "shipping_pincode": "400001", "email": BUYER_EMAIL,
        }, headers=_headers(buyer_token), timeout=30)
        assert co.status_code == 200, co.text
        order_id = co.json()["order"]["order_id"]
        # delete order
        r_del = requests.delete(f"{API}/admin/orders/{order_id}", headers=_headers(owner_token), timeout=30)
        assert r_del.status_code == 200, r_del.text
        # confirm gone
        r_get = requests.get(f"{API}/admin/orders", headers=_headers(owner_token), timeout=30)
        assert r_get.status_code == 200
        assert not any(o.get("order_id") == order_id for o in r_get.json())

    def test_11_audit_log_has_entries(self, owner_token):
        r = requests.get(f"{API}/admin/audit-log", headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        actions = {e["action"] for e in events}
        # after prior tests we should see these:
        expected = {"staff.create", "orders.purge_all", "user.delete", "order.delete"}
        missing = expected - actions
        assert not missing, f"missing audit actions: {missing}; seen: {actions}"

    def test_12_audit_log_forbidden_customer(self, buyer_token):
        r = requests.get(f"{API}/admin/audit-log", headers=_headers(buyer_token), timeout=30)
        assert r.status_code == 403
