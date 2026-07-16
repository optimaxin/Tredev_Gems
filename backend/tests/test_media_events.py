"""Backend tests for Media library, Site-assets, Events, and Legacy OTP removal."""
import io
import os
import uuid
import struct
import zlib
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://verified-stone.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@gemora.in"
ADMIN_PASSWORD = "admin@1234"


def _tiny_png_bytes() -> bytes:
    """Return a valid 1x1 PNG."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"  # filter byte + RGB pixel
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ── Legacy OTP endpoints removed ────────────────────────────────────────────
class TestLegacyOTPRemoved:
    def test_otp_send_removed(self):
        r = requests.post(f"{API}/auth/otp/send", json={"phone": "9999900001", "purpose": "login"}, timeout=10)
        assert r.status_code == 404, f"expected 404 got {r.status_code}: {r.text[:200]}"

    def test_otp_verify_removed(self):
        r = requests.post(f"{API}/auth/otp/verify", json={"phone": "9999900001", "code": "123456"}, timeout=10)
        assert r.status_code == 404

    def test_login_otp_removed(self):
        r = requests.post(f"{API}/auth/login-otp", json={"phone": "9999900001", "code": "123456"}, timeout=10)
        assert r.status_code == 404


# ── Firebase verify still present ───────────────────────────────────────────
class TestFirebaseVerify:
    def test_firebase_verify_bogus(self):
        r = requests.post(f"{API}/auth/firebase-verify", json={"id_token": "bogus"}, timeout=10)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"


# ── Admin auth gate ────────────────────────────────────────────────────────
class TestAdminAuthGate:
    @pytest.mark.parametrize("method,path,kwargs", [
        ("get", "/admin/media", {}),
        ("post", "/admin/media/upload", {"files": {"file": ("x.png", b"x", "image/png")}}),
        ("delete", "/admin/media/nonexistent", {}),
        ("get", "/admin/site-assets", {}),
        ("put", "/admin/site-assets/home_hero_1", {"json": {"media_id": None}}),
        ("get", "/admin/events", {}),
        ("post", "/admin/events", {"json": {"title": "x"}}),
        ("patch", "/admin/events/x", {"json": {"title": "x"}}),
        ("delete", "/admin/events/x", {}),
    ])
    def test_requires_auth(self, method, path, kwargs):
        r = requests.request(method, f"{API}{path}", timeout=10, **kwargs)
        assert r.status_code in (401, 403), f"{method.upper()} {path} → {r.status_code}: {r.text[:200]}"


# ── Media upload / list / serve ─────────────────────────────────────────────
class TestMedia:
    def test_upload_list_serve(self, admin_headers):
        png = _tiny_png_bytes()
        r = requests.post(
            f"{API}/admin/media/upload",
            headers=admin_headers,
            files={"file": ("test.png", png, "image/png")},
            timeout=30,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        # IDs are uuids since the Postgres migration (were "m_"-prefixed in Mongo).
        # The API field name is unchanged; only the value format moved.
        assert "media_id" in data and uuid.UUID(data["media_id"])
        assert data.get("storage_path")
        assert data.get("url", "").startswith("/api/media/file/")
        pytest._media_id = data["media_id"]
        pytest._media_url = data["url"]

        # serve
        img = requests.get(f"{BASE_URL}{data['url']}", timeout=15)
        assert img.status_code == 200, f"media serve failed: {img.status_code}"
        assert img.headers.get("Content-Type", "").startswith("image/")
        assert len(img.content) > 0

        # list
        lst = requests.get(f"{API}/admin/media", headers=admin_headers, timeout=15)
        assert lst.status_code == 200
        items = lst.json()
        assert isinstance(items, list)
        assert any(m.get("media_id") == data["media_id"] for m in items)


# ── Site-assets ─────────────────────────────────────────────────────────────
class TestSiteAssets:
    def test_slot_validation_bad_key(self, admin_headers):
        # URL-encoded space produces "BAD%20SLOT" which contains uppercase and %20, invalid
        r = requests.put(
            f"{API}/admin/site-assets/BAD%20SLOT",
            headers=admin_headers,
            json={"media_id": None},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"

    def test_set_and_clear_slot(self, admin_headers):
        # Upload own media to avoid cross-worker fixture dependency under xdist
        png = _tiny_png_bytes()
        up = requests.post(
            f"{API}/admin/media/upload",
            headers=admin_headers,
            files={"file": ("t.png", png, "image/png")},
            timeout=30,
        )
        assert up.status_code == 200, up.text
        media_id = up.json()["media_id"]

        # set
        r = requests.put(
            f"{API}/admin/site-assets/home_hero_1",
            headers=admin_headers,
            json={"media_id": media_id},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("url", "").startswith("/api/media/file/")

        # public
        pub = requests.get(f"{API}/site-assets", timeout=10)
        assert pub.status_code == 200
        assert pub.json().get("home_hero_1", "").startswith("/api/media/file/")

        # clear
        r2 = requests.put(
            f"{API}/admin/site-assets/home_hero_1",
            headers=admin_headers,
            json={"media_id": None},
            timeout=15,
        )
        assert r2.status_code == 200

        pub2 = requests.get(f"{API}/site-assets", timeout=10)
        assert pub2.status_code == 200
        assert "home_hero_1" not in pub2.json()


# ── Events ───────────────────────────────────────────────────────────────────
def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class TestEvents:
    def test_events_crud_and_active(self, admin_headers):
        now = datetime.now(timezone.utc)
        payload = {
            "title": "Diwali Giveaway",
            "subtitle": "Buy any Pukhraj, win a free Sri Yantra",
            "coupon_code": "DIWALI25",
            "cta_text": "Shop Yellow Sapphires",
            "cta_link": "/shop?category=gemstone",
            "priority": 10,
            "active": True,
            "show_in_strip": True,
            "show_in_section": True,
            "starts_at": _iso(now - timedelta(days=2)),
            "ends_at": _iso(now + timedelta(days=7)),
        }
        r = requests.post(f"{API}/admin/events", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        ev = r.json()
        # uuid since the Postgres migration (was "ev_"-prefixed in Mongo).
        assert uuid.UUID(ev["event_id"])
        event_id = ev["event_id"]

        # admin list contains
        lst = requests.get(f"{API}/admin/events", headers=admin_headers, timeout=10)
        assert lst.status_code == 200
        assert any(e["event_id"] == event_id for e in lst.json())

        # public active includes
        act = requests.get(f"{API}/events/active", timeout=10)
        assert act.status_code == 200
        assert any(e["event_id"] == event_id for e in act.json())

        # patch active=false
        p = requests.patch(
            f"{API}/admin/events/{event_id}",
            headers=admin_headers,
            json={**payload, "active": False},
            timeout=15,
        )
        assert p.status_code == 200
        act2 = requests.get(f"{API}/events/active", timeout=10)
        assert not any(e["event_id"] == event_id for e in act2.json())

        # delete
        d = requests.delete(f"{API}/admin/events/{event_id}", headers=admin_headers, timeout=10)
        assert d.status_code == 200
        lst2 = requests.get(f"{API}/admin/events", headers=admin_headers, timeout=10)
        assert not any(e["event_id"] == event_id for e in lst2.json())

    def test_past_ended_filtered(self, admin_headers):
        now = datetime.now(timezone.utc)
        payload = {
            "title": "Expired Test",
            "active": True,
            "starts_at": _iso(now - timedelta(days=2)),
            "ends_at": _iso(now - timedelta(hours=1)),
        }
        r = requests.post(f"{API}/admin/events", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200
        eid = r.json()["event_id"]
        try:
            act = requests.get(f"{API}/events/active", timeout=10)
            assert act.status_code == 200
            assert not any(e["event_id"] == eid for e in act.json()), "past-ended event should be filtered"
        finally:
            requests.delete(f"{API}/admin/events/{eid}", headers=admin_headers, timeout=10)
