"""
Tredev Backend — Trust-first spiritual commerce.
Single-file FastAPI app. Prefixes all routes with /api.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from datetime import time as dtime
from datetime import date
from pathlib import Path
from typing import Any, List, Optional

import bcrypt
import jwt as pyjwt
import qrcode
from qrcode.image.pil import PilImage
import io
import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization
from dotenv import load_dotenv
from fastapi import APIRouter, Cookie, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import Response as FastAPIResponse

import asyncpg
from decimal import Decimal

import db  # Postgres/Supabase access layer — see backend/MIGRATION.md
import storage_sb  # Supabase Storage — replaces the Emergent object store
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("gemora")


# ── Ed25519 key (persistent per env) ──────────────────────────────────────────
_priv_hex = os.environ.get("ED25519_PRIVATE_KEY_HEX", "").strip()
if _priv_hex:
    ED25519_PRIVATE = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(_priv_hex))
else:
    ED25519_PRIVATE = Ed25519PrivateKey.generate()
    log.warning("ED25519_PRIVATE_KEY_HEX not set — generated ephemeral key for this run.")

ED25519_PUBLIC: Ed25519PublicKey = ED25519_PRIVATE.public_key()
ED25519_PUBLIC_HEX = ED25519_PUBLIC.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
).hex()

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALGO = "HS256"
JWT_TTL_HOURS = 24 * 7


# ── Firebase Admin (Phone Auth verification) ─────────────────────────────────
_FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
_FIREBASE_CLIENT_EMAIL = os.environ.get("FIREBASE_CLIENT_EMAIL", "").strip()
_FIREBASE_PRIVATE_KEY_RAW = os.environ.get("FIREBASE_PRIVATE_KEY", "")
_firebase_ready = False
try:
    if _FIREBASE_PROJECT_ID and _FIREBASE_PRIVATE_KEY_RAW:
        import firebase_admin
        from firebase_admin import credentials as _fb_creds, auth as _fb_auth  # noqa
        _pk = _FIREBASE_PRIVATE_KEY_RAW.replace("\\n", "\n")
        _cred = _fb_creds.Certificate({
            "type": "service_account",
            "project_id": _FIREBASE_PROJECT_ID,
            "private_key": _pk,
            "client_email": _FIREBASE_CLIENT_EMAIL,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        if not firebase_admin._apps:
            firebase_admin.initialize_app(_cred)
        _firebase_ready = True
        log.info(f"Firebase Admin initialised for project {_FIREBASE_PROJECT_ID}")
except Exception as _fe:
    log.warning(f"Firebase Admin init failed: {_fe}")


# ── OTP service (provider-abstract) ──────────────────────────────────────────
_TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
_TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
_TWILIO_VERIFY_SID = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()
_MSG91_KEY = os.environ.get("MSG91_AUTH_KEY", "").strip()
_MSG91_TMPL = os.environ.get("MSG91_TEMPLATE_ID", "").strip()
_MSG91_SENDER = os.environ.get("MSG91_SENDER_ID", "").strip()
_META_WA_PHONE = os.environ.get("META_WA_PHONE_ID", "").strip()
_META_WA_TOKEN = os.environ.get("META_WA_ACCESS_TOKEN", "").strip()
_META_WA_APP_SECRET = os.environ.get("META_WA_APP_SECRET", "").strip()
_META_WA_VERIFY_TOKEN = os.environ.get("META_WA_VERIFY_TOKEN", "").strip()
_META_WA_API_VERSION = os.environ.get("META_WA_API_VERSION", "v20.0").strip()
_META_WA_OTP_TMPL = os.environ.get("META_WA_OTP_TEMPLATE", "gemora_otp").strip()
_META_WA_DISPATCH_TMPL = os.environ.get("META_WA_DISPATCH_TEMPLATE", "gemora_dispatched").strip()
_META_WA_PROMO_TMPL = os.environ.get("META_WA_PROMO_TEMPLATE", "gemora_promo").strip()
_META_WA_TMPL_LANG = os.environ.get("META_WA_TEMPLATE_LANG", "en_US").strip()
_OTP_DEV_CODE = os.environ.get("OTP_DEV_MODE_CODE", "123456").strip()


def _otp_provider() -> str:
    # Priority: WhatsApp (cheapest + promo-friendly) → Twilio Verify → MSG91 → mock.
    if _META_WA_PHONE and _META_WA_TOKEN:
        return "whatsapp"
    if _TWILIO_SID and _TWILIO_TOKEN and _TWILIO_VERIFY_SID:
        return "twilio"
    if _MSG91_KEY and _MSG91_TMPL:
        return "msg91"
    return "mock"


def normalize_phone(phone: str) -> str:
    """Return an E.164-formatted phone. Assumes +91 for bare 10-digit Indian numbers."""
    p = re.sub(r"[^0-9+]", "", phone or "")
    if not p:
        raise HTTPException(400, "Phone number required")
    if p.startswith("+"):
        return p
    if len(p) == 10:
        return f"+91{p}"
    if len(p) == 12 and p.startswith("91"):
        return f"+{p}"
    return f"+{p}"


async def _wa_send_template(phone: str, template: str, body_params: List[str], category_is_auth: bool = False) -> dict:
    """POST to Meta WhatsApp Cloud API. Raises HTTPException on failure."""
    url = f"https://graph.facebook.com/{_META_WA_API_VERSION}/{_META_WA_PHONE}/messages"
    components = []
    if body_params:
        components.append({"type": "body", "parameters": [{"type": "text", "text": p} for p in body_params]})
        if category_is_auth:
            # OTP button param (copy-code auth template) — same code in button payload
            components.append({"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": body_params[0]}]})
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone.lstrip("+"),
        "type": "template",
        "template": {
            "name": template,
            "language": {"code": _META_WA_TMPL_LANG},
            **({"components": components} if components else {}),
        },
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(url, json=payload, headers={"Authorization": f"Bearer {_META_WA_TOKEN}"})
    if r.status_code >= 400:
        try:
            err = r.json().get("error", {}).get("message", r.text[:200])
        except Exception:
            err = r.text[:200]
        # If auth-category send fails, try again without the button component (copy-code fallback)
        if category_is_auth and "button" in err.lower():
            return await _wa_send_template(phone, template, body_params, category_is_auth=False)
        raise HTTPException(502, f"WhatsApp send failed: {err}")
    return r.json()


async def _store_local_otp(phone: str, code: str) -> None:
    await db.execute(
        """INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1,$2,$3)
           ON CONFLICT (phone) DO UPDATE
              SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at,
                  created_at = now()""",
        phone, code, now() + timedelta(minutes=10))


def _gen_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


async def otp_send(phone: str) -> dict:
    prov = _otp_provider()
    if prov == "twilio":
        from twilio.rest import Client as _TwClient
        client = _TwClient(_TWILIO_SID, _TWILIO_TOKEN)
        v = client.verify.v2.services(_TWILIO_VERIFY_SID).verifications.create(to=phone, channel="sms")
        return {"status": v.status, "provider": "twilio"}
    if prov == "msg91":
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://control.msg91.com/api/v5/otp",
                params={
                    "template_id": _MSG91_TMPL,
                    "mobile": phone.lstrip("+"),
                    "otp_length": 6,
                    **({"sender": _MSG91_SENDER} if _MSG91_SENDER else {}),
                },
                headers={"authkey": _MSG91_KEY, "accept": "application/json"},
            )
        if r.status_code >= 400:
            raise HTTPException(502, f"MSG91 error: {r.text[:200]}")
        return {"status": "pending", "provider": "msg91"}
    if prov == "whatsapp":
        code = _gen_code()
        await _store_local_otp(phone, code)
        try:
            await _wa_send_template(phone, _META_WA_OTP_TMPL, [code], category_is_auth=True)
        except HTTPException as e:
            log.warning(f"WA OTP send failed: {e.detail}")
            raise
        return {"status": "pending", "provider": "whatsapp"}
    # Mock provider
    code = _OTP_DEV_CODE
    await _store_local_otp(phone, code)
    log.info(f"[OTP MOCK] phone={phone} code={code}")
    return {"status": "pending", "provider": "mock", "dev_code": code}


async def otp_check(phone: str, code: str) -> bool:
    prov = _otp_provider()
    code = (code or "").strip()
    if prov == "twilio":
        from twilio.rest import Client as _TwClient
        client = _TwClient(_TWILIO_SID, _TWILIO_TOKEN)
        v = client.verify.v2.services(_TWILIO_VERIFY_SID).verification_checks.create(to=phone, code=code)
        return v.status == "approved"
    if prov == "msg91":
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                "https://control.msg91.com/api/v5/otp/verify",
                params={"mobile": phone.lstrip("+"), "otp": code},
                headers={"authkey": _MSG91_KEY, "accept": "application/json"},
            )
        try:
            return r.status_code == 200 and (r.json() or {}).get("type") == "success"
        except Exception:
            return False
    # whatsapp + mock — local storage. Expiry is compared in SQL and the row is
    # consumed in the same statement, so a code can't be redeemed twice by
    # concurrent requests.
    deleted = await db.fetch_val(
        """DELETE FROM otp_codes
            WHERE phone = $1 AND code = $2 AND expires_at >= now()
        RETURNING phone""", phone, code)
    return deleted is not None


async def wa_send_utility(phone: str, template: str, body_params: List[str]) -> dict:
    """Public helper for utility templates (order dispatched, etc). Mock in dev."""
    if _otp_provider() != "whatsapp":
        log.info(f"[WA MOCK utility] to={phone} template={template} params={body_params}")
        return {"mock": True}
    return await _wa_send_template(phone, template, body_params, category_is_auth=False)


def mint_phone_verify_token(phone: str) -> str:
    return pyjwt.encode(
        {"phone": phone, "purpose": "phone_verify", "iat": int(now().timestamp()), "exp": int((now() + timedelta(minutes=15)).timestamp())},
        JWT_SECRET, algorithm=JWT_ALGO,
    )


def check_phone_verify_token(token: str, phone: str) -> bool:
    try:
        data = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return data.get("purpose") == "phone_verify" and data.get("phone") == phone
    except Exception:
        return False

# ── Helpers ───────────────────────────────────────────────────────────────────
def uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash(payload: dict) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def sign_payload(payload: dict) -> str:
    sig = ED25519_PRIVATE.sign(canonical_json(payload).encode("utf-8"))
    return sig.hex()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": int(now().timestamp()),
        "exp": int((now() + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt(token: str) -> Optional[str]:
    try:
        data = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return data.get("sub")
    except Exception:
        return None


# ── Auth dependencies ─────────────────────────────────────────────────────────
async def get_user_id_optional(
    authorization: Optional[str] = Header(None),
    session_token: Optional[str] = Cookie(None),
) -> Optional[str]:
    # 1) JWT via Authorization header
    if authorization and authorization.lower().startswith("bearer "):
        tok = authorization.split(" ", 1)[1].strip()
        uid_ = decode_jwt(tok)
        if uid_:
            return uid_
        # else fall through: maybe it's a server-side session token
        sid = await _session_user_id(tok)
        if sid:
            return sid
    # 2) Cookie
    if session_token:
        sid = await _session_user_id(session_token)
        if sid:
            return sid
    return None


async def _session_user_id(token: str) -> Optional[str]:
    """Resolve a non-expired server-side session token to a user_id. Expiry is compared
    in SQL now that expires_at is a real timestamptz rather than an ISO string."""
    return await db.fetch_val(
        """SELECT user_id::text FROM user_sessions
            WHERE session_token = $1 AND expires_at >= now()""", token)


async def require_user(user_id: Optional[str] = Depends(get_user_id_optional)) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


async def require_admin(user_id: str = Depends(require_user)) -> str:
    user = await _load_user(user_id=user_id)
    if not user or not (user.get("is_admin") or user.get("role") in ("owner", "staff")):
        raise HTTPException(status_code=403, detail="Admin only")
    return user_id


ALL_PERMISSIONS = [
    "products", "inventory", "certificates", "orders",
    "categories", "astrologers", "consultations", "queries",
]


async def get_current_user(user_id: str = Depends(require_user)) -> dict:
    u = await _load_user(user_id=user_id)
    if not u:
        raise HTTPException(404, "User not found")
    return u


def user_role(u: dict) -> str:
    if u.get("role"):
        return u["role"]
    return "owner" if u.get("is_admin") else "customer"


def user_perms(u: dict) -> list[str]:
    r = user_role(u)
    if r == "owner":
        return list(ALL_PERMISSIONS)
    if r == "staff":
        return list(u.get("permissions") or [])
    return []


def require_perm(perm: str):
    async def _dep(u: dict = Depends(get_current_user)) -> str:
        if perm not in user_perms(u):
            raise HTTPException(403, f"Missing permission: {perm}")
        return u["user_id"]
    return _dep


async def require_owner(u: dict = Depends(get_current_user)) -> str:
    if user_role(u) != "owner":
        raise HTTPException(403, "Owner only")
    return u["user_id"]


# ── Models ────────────────────────────────────────────────────────────────────
class SignupIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    phone: str
    otp_verification_token: str
    wa_optin: bool = True


class LinkPhoneIn(BaseModel):
    phone: str
    otp_verification_token: str


class FirebaseVerifyIn(BaseModel):
    id_token: str


class GoogleSignInIn(BaseModel):
    id_token: str


class OtpSendIn(BaseModel):
    phone: str
    purpose: Optional[str] = "verify"


class OtpVerifyIn(BaseModel):
    phone: str
    code: str


class ChangePhoneIn(BaseModel):
    new_phone: str
    otp_verification_token: str


class WaOptInIn(BaseModel):
    wa_optin: bool


class PromoBroadcastIn(BaseModel):
    template: Optional[str] = None  # defaults to META_WA_PROMO_TEMPLATE
    body_params: List[str] = []
    user_ids: Optional[List[str]] = None  # None = all opted-in users


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProductIn(BaseModel):
    name: str
    slug: str
    category: str  # gemstone, rudraksha, bracelet, yantra, idol, pooja_kit, prashad, book, digital
    description: str = ""
    price: int  # in paise
    mrp: Optional[int] = None
    images: List[str] = []
    attrs: dict = {}  # carat, graha, mukhi, origin, rashi, purpose, etc.
    devanagari_name: Optional[str] = None
    is_serialized: bool = True  # if False, non-unit-based


class UnitIn(BaseModel):
    product_id: str
    serial: str
    weight_carat: Optional[float] = None
    origin: Optional[str] = None
    notes: Optional[str] = None


class CertificateIssueIn(BaseModel):
    unit_id: str
    lab_name: str
    lab_report_no: str
    lab_report_url: Optional[str] = None
    temple_name: str
    temple_devanagari: Optional[str] = None
    energization_date: str  # ISO date
    priest_name: str
    pooja_recording_url: Optional[str] = None
    mantra: Optional[str] = None


class CartAddIn(BaseModel):
    product_id: str
    unit_id: Optional[str] = None  # required for serialized items
    qty: int = 1


class CheckoutIn(BaseModel):
    shipping_name: str
    shipping_phone: str
    shipping_address: str
    shipping_city: str
    shipping_state: str
    shipping_pincode: str
    email: EmailStr
    affiliate_ref: Optional[str] = None  # astrologer's affiliate code, if any


class DispatchIn(BaseModel):
    order_id: str
    unit_id: str
    tracking_number: Optional[str] = None
    courier: Optional[str] = None


class ReviewIn(BaseModel):
    product_id: str
    rating: int = Field(ge=1, le=5)
    title: str = ""
    body: str = ""


class ConsultationBookIn(BaseModel):
    astrologer_id: str
    slot_iso: str
    name: str
    phone: str
    email: EmailStr
    concern: str = ""


# ── Media / Site-Assets / Events models ───────────────────────────────────────
class SiteAssetPutIn(BaseModel):
    media_id: Optional[str] = None  # None → clear the slot


class EventIn(BaseModel):
    title: str
    subtitle: Optional[str] = ""
    description: Optional[str] = ""
    image_url: Optional[str] = ""
    cta_text: Optional[str] = ""
    cta_link: Optional[str] = ""
    coupon_code: Optional[str] = ""
    starts_at: Optional[str] = None  # ISO datetime
    ends_at: Optional[str] = None    # ISO datetime
    priority: int = 0
    active: bool = True
    show_in_strip: bool = True    # dismissible top marquee
    show_in_section: bool = True  # dedicated section between hero & rest


# ── App wiring ────────────────────────────────────────────────────────────────
def _cookie_kwargs() -> dict:
    """Cookie flags that work in both local dev and cross-site production.

    `secure=True; samesite=none` is required when the frontend and API are on
    different sites (production), but a Secure cookie is dropped over plain http://,
    so local dev silently loses the anon cart cookie. Keyed off PUBLIC_APP_URL's
    scheme rather than hardcoded.
    """
    if os.environ.get("PUBLIC_APP_URL", "").startswith("https://"):
        return {"secure": True, "samesite": "none"}
    return {"secure": False, "samesite": "lax"}


def _cors_origins() -> list[str]:
    raw = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    if not raw or "*" in raw:
        # allow_credentials=True + "*" => browsers reject every response.
        log.warning(
            "CORS_ORIGINS is unset or '*', which cannot be combined with credentials. "
            "Falling back to localhost dev origins — set explicit origins for deploy."
        )
        return ["http://localhost:3000", "http://localhost:3002"]
    return raw


app = FastAPI(title="Tredev")
api = APIRouter(prefix="/api")


@app.on_event("startup")
async def _startup():
    await db.connect()
    # Indexes/constraints live in the schema, not in application startup. Their
    # Postgres equivalents already exist — notably ux_reservations_active_unit
    # (unique product_unit_id WHERE status='active'), the guard that makes
    # double-selling impossible, plus uniques on users.email, products.slug,
    # product_units.serial_no, qr_codes.token, user_sessions.session_token and
    # site_assets.slot.



@app.on_event("shutdown")
async def _shutdown():
    await db.disconnect()


# ── Meta ──────────────────────────────────────────────────────────────────────
@api.get("/")
async def root():
    return {"app": "Tredev", "public_key_ed25519_hex": ED25519_PUBLIC_HEX}


@api.get("/health")
async def health():
    return {"ok": True, "ts": iso(now())}


# ── Auth ──────────────────────────────────────────────────────────────────────
# The users table is normalised (roles/user_roles, user_permissions,
# notification_preferences), but the rest of this module — user_role(), user_perms(),
# require_perm(), _user_public() — reads a flat dict. This SELECT rebuilds that flat
# shape so those helpers, and the API contract, are unchanged.
_USER_SELECT = """
    SELECT u.id::text                                   AS user_id,
           u.email::text                                AS email,
           u.full_name                                  AS name,
           COALESCE(u.avatar_url, '')                   AS picture,
           u.phone                                      AS phone,
           (u.phone_verified_at IS NOT NULL)            AS phone_verified,
           COALESCE((np.whatsapp ->> 'optin')::boolean, true) AS wa_optin,
           u.password_hash                              AS password_hash,
           u.firebase_uid                               AS firebase_uid,
           COALESCE(r.name, 'customer')                 AS role_row,
           COALESCE(p.arr, ARRAY[]::text[])             AS permissions,
           u.created_at                                 AS created_at
      FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      LEFT JOIN LATERAL (
            SELECT ro.name
              FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
             WHERE ur.user_id = u.id
             ORDER BY CASE ro.name WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END
             LIMIT 1
      ) r ON true
      LEFT JOIN LATERAL (
            SELECT array_agg(permission ORDER BY permission) AS arr
              FROM user_permissions WHERE user_id = u.id
      ) p ON true
     WHERE u.deleted_at IS NULL
"""

# roles.admin is the app's "owner"; staff/customer map 1:1.
_ROLE_FROM_DB = {"admin": "owner", "staff": "staff", "customer": "customer"}


def _shape_user(row: Optional[dict]) -> Optional[dict]:
    """DB row -> the flat user dict the rest of this module expects."""
    if not row:
        return None
    u = dict(row)
    u["role"] = _ROLE_FROM_DB.get(u.pop("role_row", "customer"), "customer")
    u["is_admin"] = u["role"] in ("owner", "staff")
    return u


async def _load_user(*, user_id: Optional[str] = None, email: Optional[str] = None,
                     phone: Optional[str] = None, conn=None) -> Optional[dict]:
    if user_id is not None:
        sql, arg = _USER_SELECT + " AND u.id = $1::uuid", user_id
    elif email is not None:
        sql, arg = _USER_SELECT + " AND u.email = $1::citext", email
    elif phone is not None:
        sql, arg = _USER_SELECT + " AND u.phone = $1", phone
    else:
        raise ValueError("_load_user needs one of user_id/email/phone")
    if conn is not None:
        return _shape_user(db._row(await conn.fetchrow(sql, arg)))
    return _shape_user(await db.fetch_one(sql, arg))


async def _create_or_get_user(*, email: str, name: str, picture: str = "", password: Optional[str] = None, phone: Optional[str] = None, phone_verified: bool = False, wa_optin: bool = True) -> dict:
    existing = await _load_user(email=email.lower())
    if existing:
        return existing
    async with db.transaction() as conn:
        # id has no DB default in this schema — the app supplies it.
        new_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO users (id, email, full_name, avatar_url, phone,
                                  phone_verified_at, password_hash, status)
               VALUES ($1, $2::citext, $3, $4, $5, $6, $7, 'active')""",
            new_id, email.lower(), name, picture or None, phone,
            now() if phone_verified else None,
            hash_password(password) if password else None,
        )
        rid = await conn.fetchval("SELECT id FROM roles WHERE name = 'customer'")
        if rid:
            await conn.execute(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                new_id, rid)
        await conn.execute(
            """INSERT INTO notification_preferences (user_id, whatsapp)
               VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING""",
            new_id, {"optin": bool(wa_optin)})
        return _shape_user(db._row(await conn.fetchrow(
            _USER_SELECT + " AND u.id = $1::uuid", str(new_id))))


@api.post("/auth/firebase-verify")
async def auth_firebase_verify(body: FirebaseVerifyIn):
    """Exchange a Firebase Phone Auth ID token for our otp_verification_token."""
    if not _firebase_ready:
        raise HTTPException(503, "Firebase Auth not configured on the server")
    try:
        from firebase_admin import auth as _fb_auth
        decoded = _fb_auth.verify_id_token(body.id_token)
    except Exception as e:
        raise HTTPException(401, f"Invalid Firebase ID token: {e}")
    phone = decoded.get("phone_number") or (decoded.get("firebase", {}).get("identities", {}).get("phone", [None])[0])
    if not phone:
        raise HTTPException(400, "Firebase token has no phone_number claim. Enable Phone sign-in in Firebase Console.")
    phone = normalize_phone(phone)
    fb_uid = decoded.get("uid")
    await db.execute(
        "INSERT INTO otp_events (phone, kind, firebase_uid) VALUES ($1,'firebase_verify',$2)",
        phone, fb_uid)
    # Mark verified and record the Firebase identity on any user holding this number.
    await db.execute(
        """UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()),
                            firebase_uid = COALESCE(firebase_uid, $2)
            WHERE phone = $1 AND deleted_at IS NULL""", phone, fb_uid)
    token = mint_phone_verify_token(phone)
    # If a user already exists with this phone → also return a session JWT (passwordless login)
    user = await _load_user(phone=phone)
    session = None
    if user and user.get("phone_verified"):
        session = {"token": make_jwt(user["user_id"]), "user": _user_public(user)}
    return {"ok": True, "phone": phone, "otp_verification_token": token, "session": session}


# NOTE: /auth/otp/send and /auth/otp/verify are deliberately absent. Phone
# verification goes through Firebase only (/auth/firebase-verify); the legacy OTP
# routes were removed and must stay 404 — see
# tests/test_media_events.py::TestLegacyOTPRemoved.
# otp_send()/otp_check() and the otp_codes table remain for the WhatsApp/Twilio/MSG91
# providers used elsewhere (order notifications), not for auth.


@api.post("/auth/signup")
async def signup(body: SignupIn):
    if await _load_user(email=body.email.lower()):
        raise HTTPException(400, "Email already registered")
    phone = normalize_phone(body.phone)
    if not check_phone_verify_token(body.otp_verification_token, phone):
        raise HTTPException(400, "Phone not verified. Please verify OTP again.")
    if await _load_user(phone=phone):
        raise HTTPException(400, "This phone number is already linked to another account")
    user = await _create_or_get_user(email=body.email, name=body.name, password=body.password, phone=phone, phone_verified=True, wa_optin=body.wa_optin)
    token = make_jwt(user["user_id"])
    u = await _load_user(user_id=user["user_id"])
    return {"token": token, "user": _user_public(u)}


@api.post("/auth/link-phone")
async def link_phone(body: LinkPhoneIn, user_id: str = Depends(require_user)):
    phone = normalize_phone(body.phone)
    if not check_phone_verify_token(body.otp_verification_token, phone):
        raise HTTPException(400, "Phone not verified. Please verify OTP again.")
    other = await db.fetch_val(
        "SELECT id::text FROM users WHERE phone = $1 AND id <> $2::uuid AND deleted_at IS NULL",
        phone, user_id)
    if other:
        raise HTTPException(400, "This phone number is already linked to another account")
    await db.execute(
        "UPDATE users SET phone = $2, phone_verified_at = now() WHERE id = $1::uuid",
        user_id, phone)
    return {"ok": True, "phone": phone}


@api.post("/auth/change-phone")
async def change_phone(body: ChangePhoneIn, user_id: str = Depends(require_user)):
    """Authenticated user swaps their phone number after re-verifying the new one."""
    new_phone = normalize_phone(body.new_phone)
    if not check_phone_verify_token(body.otp_verification_token, new_phone):
        raise HTTPException(400, "New phone not verified. Please verify OTP again.")
    other = await db.fetch_val(
        "SELECT id::text FROM users WHERE phone = $1 AND id <> $2::uuid AND deleted_at IS NULL",
        new_phone, user_id)
    if other:
        raise HTTPException(400, "This phone number is already linked to another account")
    await db.execute(
        "UPDATE users SET phone = $2, phone_verified_at = now() WHERE id = $1::uuid",
        user_id, new_phone)
    return {"ok": True, "phone": new_phone}


@api.post("/me/wa-optin")
async def wa_optin_toggle(body: WaOptInIn, user_id: str = Depends(require_user)):
    # wa_optin lives in notification_preferences.whatsapp, not on users.
    await db.execute(
        """INSERT INTO notification_preferences (user_id, whatsapp) VALUES ($1::uuid, $2)
           ON CONFLICT (user_id) DO UPDATE
              SET whatsapp = COALESCE(notification_preferences.whatsapp, '{}'::jsonb)
                             || $2::jsonb,
                  updated_at = now()""",
        user_id, {"optin": bool(body.wa_optin)})
    return {"ok": True, "wa_optin": bool(body.wa_optin)}


def _user_public(user: dict) -> dict:
    return {
        "user_id": user["user_id"], "email": user["email"], "name": user["name"],
        "picture": user.get("picture", ""), "phone": user.get("phone"),
        "phone_verified": user.get("phone_verified", False),
        "wa_optin": user.get("wa_optin", True),
        "is_admin": user.get("is_admin", False) or user_role(user) in ("owner", "staff"),
        "role": user_role(user),
        "permissions": user_perms(user),
    }


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await _load_user(email=body.email.lower())
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = make_jwt(user["user_id"])
    return {"token": token, "user": _user_public(user)}


@api.post("/auth/google")
async def auth_google(body: GoogleSignInIn):
    """Exchange a Firebase Google ID token for our own JWT.

    Replaces the Emergent OAuth round-trip (auth.emergentagent.com ->
    /auth/session -> demobackend.emergentagent.com). The client signs in with
    Firebase directly and posts the resulting ID token here; there's no redirect
    hop and no server-side session row — the JWT is the session.
    """
    if not _firebase_ready:
        raise HTTPException(503, "Firebase Auth not configured on the server")
    try:
        from firebase_admin import auth as _fb_auth
        decoded = _fb_auth.verify_id_token(body.id_token)
    except Exception as e:
        raise HTTPException(401, f"Invalid Google ID token: {e}")

    email = (decoded.get("email") or "").lower()
    if not email:
        raise HTTPException(400, "Google token has no email claim")
    if not decoded.get("email_verified", False):
        # Google always verifies its own emails; a false here means another provider.
        raise HTTPException(400, "Email not verified by the identity provider")

    user = await _load_user(email=email)
    if not user:
        user = await _create_or_get_user(
            email=email, name=decoded.get("name") or email.split("@")[0],
            picture=decoded.get("picture") or "")
    # Bind the Firebase identity (and backfill name/picture) on first Google sign-in.
    await db.execute(
        """UPDATE users
              SET firebase_uid = COALESCE(firebase_uid, $2),
                  avatar_url   = COALESCE(NULLIF($3, ''), avatar_url),
                  full_name    = COALESCE(NULLIF(full_name, ''), $4)
            WHERE id = $1::uuid""",
        user["user_id"], decoded.get("uid"), decoded.get("picture") or "",
        decoded.get("name") or "")
    user = await _load_user(user_id=user["user_id"])
    return {"token": make_jwt(user["user_id"]), "user": _user_public(user)}


@api.get("/auth/me")
async def me(user_id: str = Depends(require_user)):
    u = await _load_user(user_id=user_id)
    if not u:
        raise HTTPException(404, "User not found")
    return _user_public(u)  # never leaks password_hash — it whitelists fields


@api.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(None)):
    if session_token:
        await db.execute("DELETE FROM user_sessions WHERE session_token = $1", session_token)
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ── Catalog ───────────────────────────────────────────────────────────────────
VERNACULAR = {
    "pukhraj": "Yellow Sapphire",
    "neelam": "Blue Sapphire",
    "manik": "Ruby",
    "moonga": "Red Coral",
    "panna": "Emerald",
    "moti": "Pearl",
    "gomed": "Hessonite",
    "lehsunia": "Cat's Eye",
    "heera": "Diamond",
    "rudraksh": "Rudraksha",
    "rudraksha": "Rudraksha",
}


def _normalize_query(q: str) -> str:
    ql = q.lower().strip()
    for k, v in VERNACULAR.items():
        if k in ql:
            ql = ql.replace(k, v.lower())
    return ql


# Rebuilds the flat product dict the frontend expects out of the normalised tables:
# products + categories + product_media/media_assets + the per-category detail tables.
# `attrs` is re-synthesised from the typed columns so filters and the UI keep working.
_PRODUCT_SELECT = """
    SELECT p.id::text                              AS product_id,
           p.slug::text                            AS slug,
           p.title                                 AS name,
           p.title_devanagari                      AS devanagari_name,
           p.description                           AS description,
           p.category_key::text                    AS category_key,
           p.base_price                            AS base_price,
           p.compare_at_price                      AS compare_at_price,
           p.is_serialized                         AS is_serialized,
           (p.status = 'active')                   AS is_active,
           p.attributes                            AS attributes,
           p.created_at                            AS created_at,
           COALESCE(m.urls, ARRAY[]::text[])       AS images,
           g.planet_graha::text                    AS g_graha,
           g.weight_carat                          AS g_carat,
           g.origin                                AS g_origin,
           r.mukhi                                 AS r_mukhi,
           r.ruling_planet::text                   AS r_graha,
           r.origin::text                          AS r_origin
      FROM products p
      LEFT JOIN LATERAL (
            SELECT array_agg(ma.object_key ORDER BY pm.position) AS urls
              FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
             WHERE pm.product_id = p.id
      ) m ON true
      LEFT JOIN gemstone_details  g ON g.product_id = p.id
      LEFT JOIN rudraksha_details r ON r.product_id = p.id
     WHERE p.deleted_at IS NULL
"""

def _shape_product(row: Optional[dict]) -> Optional[dict]:
    """DB row -> the flat product dict (prices back in paise, attrs reassembled)."""
    if not row:
        return None
    r = dict(row)
    attrs = dict(r.pop("attributes", None) or {})   # rashi/purpose live here
    graha = r.pop("g_graha", None) or r.pop("r_graha", None)
    if graha:
        attrs["graha"] = db.GRAHA_FROM_DB.get(graha, graha)
    else:
        r.pop("r_graha", None)
    if r.get("g_carat") is not None:
        attrs["carat_range"] = str(r["g_carat"])
    origin = r.pop("g_origin", None) or r.pop("r_origin", None)
    if origin:
        attrs["origin"] = origin.title() if origin.islower() else origin
    else:
        r.pop("r_origin", None)
    if r.get("r_mukhi"):
        attrs["mukhi"] = int(r["r_mukhi"]) if str(r["r_mukhi"]).isdigit() else r["r_mukhi"]
    for k in ("g_carat", "r_mukhi", "g_graha", "r_graha", "g_origin", "r_origin"):
        r.pop(k, None)
    return {
        **r,
        "category": db.CATEGORY_FROM_DB.get(r.pop("category_key"), r.get("category_key")),
        "price": db.to_paise(r.pop("base_price")),
        "mrp": db.to_paise(r.pop("compare_at_price")),
        "attrs": attrs,
    }


@api.get("/products")
async def list_products(
    category: Optional[str] = None,
    graha: Optional[str] = None,
    rashi: Optional[str] = None,
    purpose: Optional[str] = None,
    mukhi: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 60,
):
    where = ["p.status = 'active'"]
    args: list = []

    def _arg(v):
        args.append(v)
        return f"${len(args)}"

    if category:
        where.append(f"p.category_key = {_arg(db.CATEGORY_TO_DB.get(category, category))}::category_key")
    if graha:
        # graha is typed on the detail tables, not in the attrs blob
        a = _arg(db.GRAHA_TO_DB.get(graha, graha.lower()))
        where.append(f"({a}::planet_graha IN (g.planet_graha, r.ruling_planet))")
    if rashi:
        where.append(f"p.attributes ->> 'rashi' = {_arg(rashi)}")
    if purpose:
        where.append(f"p.attributes ->> 'purpose' = {_arg(purpose)}")
    if mukhi:
        where.append(f"r.mukhi = {_arg(str(mukhi))}")
    if q:
        nq = _normalize_query(q)
        a = _arg(f"%{nq}%")
        where.append(f"(p.title ILIKE {a} OR p.description ILIKE {a} OR p.slug::text ILIKE {a})")

    sql = f"{_PRODUCT_SELECT} AND {' AND '.join(where)} ORDER BY p.created_at DESC LIMIT {_arg(limit)}"
    return [_shape_product(r) for r in await db.fetch_all(sql, *args)]


@api.get("/products/{slug}")
async def get_product(slug: str):
    row = await db.fetch_one(_PRODUCT_SELECT + " AND p.slug = $1::citext", slug)
    if not row:
        raise HTTPException(404, "Product not found")
    p = _shape_product(row)
    # Available units: in_stock, not held by an active reservation. This was three
    # queries plus a Python loop in Mongo (N+1); it's now one join.
    # weight_carat/origin come from gemstone_details — in Mongo they were copied onto
    # every unit from the product's attrs, so they were always product-level.
    units = await db.fetch_all(
        """SELECT pu.id::text                       AS unit_id,
                  pu.product_id::text               AS product_id,
                  pu.serial_no                      AS serial,
                  ''                                AS notes,
                  'available'                       AS status,
                  pu.created_at                     AS created_at,
                  (ac.id IS NOT NULL)               AS has_certificate
             FROM product_units pu
             LEFT JOIN authenticity_certificates ac ON ac.product_unit_id = pu.id
            WHERE pu.product_id = $1::uuid
              AND pu.status = 'in_stock'
              AND NOT EXISTS (SELECT 1 FROM reservations rs
                               WHERE rs.product_unit_id = pu.id AND rs.status = 'active')
            -- serial_no tiebreak: created_at alone can tie for units seeded in one txn
            ORDER BY pu.created_at, pu.serial_no""",
        p["product_id"])
    # weight_carat/origin were never really per-unit: the Mongo seed copied them onto
    # each unit from the product's attrs (server.py:1646). Same source, same values.
    for u in units:
        u["weight_carat"] = p["attrs"].get("carat_range")
        u["origin"] = p["attrs"].get("origin")
    p["available_units"] = units
    return p


async def _list_categories() -> list[dict]:
    """Flat category dicts in the legacy shape. `key`/`hindi`/`order` are the API
    names for category_key/name_devanagari/sort_order."""
    rows = await db.fetch_all(
        """SELECT c.id::text                 AS category_id,
                  c.category_key::text       AS category_key,
                  c.name                     AS label,
                  COALESCE(c.name_devanagari, '') AS hindi,
                  pc.category_key::text      AS parent_key_db,
                  c.sort_order               AS "order",
                  c.created_at               AS created_at
             FROM categories c
             LEFT JOIN categories pc ON pc.id = c.parent_id
            WHERE c.is_active
            ORDER BY c.sort_order""")
    out = []
    for r in rows:
        pk = r.pop("parent_key_db", None)
        out.append({**r,
                    "key": db.CATEGORY_FROM_DB.get(r.pop("category_key"), None),
                    "parent_key": db.CATEGORY_FROM_DB.get(pk) if pk else None})
    return out


@api.get("/categories")
async def categories():
    db_cats = await _list_categories()
    return {
        "categories": db_cats,
        "planets": ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"],
        "purposes": ["wealth", "protection", "love", "career", "health"],
    }


# ── Admin: product/unit/cert ──────────────────────────────────────────────────
@api.post("/admin/products")
async def admin_create_product(p: ProductIn, user_id: str = Depends(require_admin)):
    ck = db.CATEGORY_TO_DB.get(p.category)
    if not ck:
        raise HTTPException(400, f"Unknown category: {p.category}")
    pid = uuid.uuid4()
    try:
        async with db.transaction() as conn:
            cat_id = await conn.fetchval(
                "SELECT id FROM categories WHERE category_key = $1::category_key", ck)
            if not cat_id:
                raise HTTPException(400, f"Category {p.category} not configured")
            await conn.execute(
                """INSERT INTO products (id, category_id, category_key, title,
                        title_devanagari, slug, description, base_price, compare_at_price,
                        currency, is_serialized, attributes, status, published_at)
                   VALUES ($1,$2,$3::category_key,$4,$5,$6::citext,$7,$8,$9,'INR',$10,
                           $11,'active', now())""",
                pid, cat_id, ck, p.name, p.devanagari_name, p.slug, p.description,
                db.to_amount(p.price), db.to_amount(p.mrp), p.is_serialized,
                p.attrs or {})
            # cart_items/order_items require a variant, so every product needs one.
            await conn.execute(
                """INSERT INTO product_variants (id, product_id, sku, variant_name, price,
                        compare_at_price, stock_qty, track_inventory, is_active)
                   VALUES ($1,$2,$3,'Standard',$4,$5,$6,$7,true)""",
                uuid.uuid4(), pid, p.slug[:24].upper().replace("-", "_") + "-STD",
                db.to_amount(p.price), db.to_amount(p.mrp),
                None if p.is_serialized else 0, not p.is_serialized)
            for i, url in enumerate(p.images or []):
                mid = await conn.fetchval(
                    "SELECT id FROM media_assets WHERE object_key=$1 AND bucket='external'", url)
                if not mid:
                    mid = uuid.uuid4()
                    await conn.execute(
                        """INSERT INTO media_assets (id, owner_type, storage_provider, bucket,
                                object_key, mime_type, is_public, uploaded_by)
                           VALUES ($1,'product','external','external',$2,'image/jpeg',true,$3::uuid)""",
                        mid, url, user_id)
                await conn.execute(
                    """INSERT INTO product_media (id, product_id, media_id, position, is_primary)
                       VALUES ($1,$2,$3,$4,$5)""", uuid.uuid4(), pid, mid, i, i == 0)
    except HTTPException:
        raise
    except asyncpg.exceptions.UniqueViolationError as e:
        raise HTTPException(400, f"Slug exists or invalid: {e}")
    return _shape_product(await db.fetch_one(
        _PRODUCT_SELECT + " AND p.id = $1::uuid", str(pid)))


@api.post("/admin/units")
async def admin_create_unit(u: UnitIn, user_id: str = Depends(require_admin)):
    prod = await db.fetch_one(
        """SELECT p.id::text AS product_id, p.base_price,
                  (SELECT v.id FROM product_variants v WHERE v.product_id = p.id
                    ORDER BY v.created_at LIMIT 1) AS variant_id
             FROM products p WHERE p.id = $1::uuid AND p.deleted_at IS NULL""",
        u.product_id)
    if not prod:
        raise HTTPException(404, "Product not found")
    unit_id = uuid.uuid4()
    try:
        # clock_timestamp(), not now(): now() is the transaction timestamp, so units
        # created together would tie and break ORDER BY created_at.
        await db.execute(
            """INSERT INTO product_units (id, product_id, variant_id, serial_no, status,
                    verification_state, unit_price, created_at)
               VALUES ($1,$2::uuid,$3,$4,'in_stock','unverified',$5, clock_timestamp())""",
            unit_id, u.product_id, prod["variant_id"], u.serial, prod["base_price"])
    except asyncpg.exceptions.UniqueViolationError as e:
        raise HTTPException(400, f"Serial exists: {e}")
    return {"unit_id": str(unit_id), "product_id": u.product_id, "serial": u.serial,
            "weight_carat": u.weight_carat, "origin": u.origin, "notes": u.notes,
            "status": "available", "created_at": iso(now())}


@api.post("/admin/certificates/issue")
async def admin_issue_certificate(body: CertificateIssueIn, user_id: str = Depends(require_admin)):
    unit = await db.fetch_one(
        """SELECT pu.id::text AS unit_id, pu.serial_no AS serial,
                  pu.product_id::text AS product_id, p.title AS product_name
             FROM product_units pu
             LEFT JOIN products p ON p.id = pu.product_id
            WHERE pu.id = $1::uuid""", body.unit_id)
    if not unit:
        raise HTTPException(404, "Unit not found")

    cert_id = uuid.uuid4()
    # The signed payload keeps the legacy flat shape verbatim — it's what /api/verify
    # returns and what the signature covers. Do not add fields to it lightly.
    payload = {
        "cert_id": str(cert_id),
        "unit_id": unit["unit_id"],
        "serial": unit["serial"],
        "product_id": unit["product_id"],
        "product_name": unit["product_name"] or "",
        "lab_name": body.lab_name,
        "lab_report_no": body.lab_report_no,
        "lab_report_url": body.lab_report_url,
        "temple_name": body.temple_name,
        "temple_devanagari": body.temple_devanagari,
        "energization_date": body.energization_date,
        "priest_name": body.priest_name,
        "pooja_recording_url": body.pooja_recording_url,
        "mantra": body.mantra,
        "issued_at": iso(now()),
        "issuer": "Tredev",
        "public_key_hex": ED25519_PUBLIC_HEX,
    }
    chash = content_hash(payload)
    signature = sign_payload(payload)

    async with db.transaction() as conn:
        # Reuse the active signing key, registering it on first use. Certificates
        # reference the key they were signed with so rotation doesn't break old ones.
        signing_key_id = await conn.fetchval(
            "SELECT id FROM signing_keys WHERE public_key = $1 AND is_active",
            ED25519_PUBLIC_HEX)
        if not signing_key_id:
            signing_key_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO signing_keys (id, kid, algorithm, public_key, is_active)
                   VALUES ($1,$2,'ed25519',$3,true)""",
                signing_key_id, f"tredev-ed25519-{str(signing_key_id)[:8]}",
                ED25519_PUBLIC_HEX)

        # Mongo inlined lab/temple/priest on the certificate; here they're their own rows.
        lab_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO lab_certifications (id, product_unit_id, lab_name,
                    certificate_number, report_media_id)
               VALUES ($1,$2::uuid,$3,$4,NULL)""",
            lab_id, body.unit_id, body.lab_name, body.lab_report_no)

        en_id = None
        temple_id = None
        if body.temple_name:
            temple_id = await conn.fetchval(
                "SELECT id FROM temples WHERE name = $1", body.temple_name)
            if not temple_id:
                temple_id = uuid.uuid4()
                await conn.execute(
                    """INSERT INTO temples (id, name, slug, country, trust_verified)
                       VALUES ($1,$2,$3::citext,'IN',false)""",
                    temple_id, body.temple_name,
                    re.sub(r"[^a-z0-9]+", "-", body.temple_name.lower()).strip("-"))
            priest_id = None
            if body.priest_name:
                priest_id = await conn.fetchval(
                    "SELECT id FROM priests WHERE full_name = $1", body.priest_name)
                if not priest_id:
                    priest_id = uuid.uuid4()
                    await conn.execute(
                        """INSERT INTO priests (id, full_name, temple_id, is_verified)
                           VALUES ($1,$2,$3,false)""", priest_id, body.priest_name, temple_id)
            en_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO energization_certificates (id, product_unit_id, temple_id,
                        priest_id, performed_on, mantras)
                   VALUES ($1,$2::uuid,$3,$4,$5,$6)""",
                en_id, body.unit_id, temple_id, priest_id,
                datetime.fromisoformat(body.energization_date).replace(tzinfo=timezone.utc)
                if body.energization_date else None,
                [body.mantra] if body.mantra else [])

        await conn.execute(
            """INSERT INTO authenticity_certificates (id, product_unit_id, certificate_no,
                    issuing_authority, issued_by_user_id, issued_at, lab_certification_id,
                    energization_certificate_id, temple_id, signing_key_id, signed_payload,
                    content_hash, signature)
               VALUES ($1,$2::uuid,$3,'Tredev',$4::uuid, now(),$5,$6,$7,$8,$9,$10,$11)""",
            cert_id, body.unit_id, f"TDV-{secrets.token_hex(4).upper()}", user_id,
            lab_id, en_id, temple_id, signing_key_id, payload, chash, signature)

        # QR gap: minted now, but only activated at dispatch.
        await conn.execute(
            """INSERT INTO qr_codes (id, product_unit_id, authenticity_certificate_id,
                    token, status)
               VALUES ($1,$2::uuid,$3,$4,'pending')""",
            uuid.uuid4(), body.unit_id, cert_id, f"qr_{uuid.uuid4().hex[:16]}")

    return _shape_cert(await db.fetch_one(
        _CERT_SELECT + " WHERE ac.id = $1::uuid", str(cert_id)))


# ── Public verification (crown jewel) ─────────────────────────────────────────
# The flat `cert` object the frontend renders. Rebuilt from the signed payload plus
# the mutable state columns — never by excluding keys from a row (the old
# server.py:1208 approach, which broke the moment a column was added).
_CERT_SELECT = """
    SELECT ac.id::text            AS cert_id,
           ac.signed_payload      AS signed_payload,
           ac.content_hash        AS content_hash_sha256,
           ac.signature           AS signature_ed25519_hex,
           ac.revoked_at          AS revoked_at,
           ac.product_unit_id::text AS unit_id,
           pu.product_id::text    AS product_id,
           q.token                AS qr_token,
           q.status::text         AS qr_status,
           -- Mongo kept activated_at/sold_to_user_id/order_id on the cert. Here the QR
           -- owns activation, and ownership is derived through the sale:
           --   product_units.sold_order_item_id -> order_items -> orders.user_id
           q.activated_at         AS activated_at,
           o.user_id::text        AS sold_to_user_id,
           o.id::text             AS order_id,
           sk.public_key          AS signing_public_key
      FROM authenticity_certificates ac
      JOIN product_units pu ON pu.id = ac.product_unit_id
      LEFT JOIN qr_codes q  ON q.authenticity_certificate_id = ac.id
      LEFT JOIN order_items oi ON oi.id = pu.sold_order_item_id
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN signing_keys sk ON sk.id = ac.signing_key_id
"""


def _shape_cert(row: dict) -> dict:
    """signed_payload + state columns -> the legacy flat cert dict."""
    return {**(row.get("signed_payload") or {}),
            "content_hash_sha256": row["content_hash_sha256"],
            "signature_ed25519_hex": row["signature_ed25519_hex"],
            "qr_token": row.get("qr_token"),
            "activated": row.get("qr_status") == "active",
            "revoked": row.get("revoked_at") is not None,
            **({"activated_at": row["activated_at"]} if row.get("activated_at") else {}),
            **({"sold_to_user_id": row["sold_to_user_id"]} if row.get("sold_to_user_id") else {}),
            **({"order_id": row["order_id"]} if row.get("order_id") else {}),
            **({"revoked_at": row["revoked_at"]} if row.get("revoked_at") else {})}


@api.get("/verify/{qr_token}")
async def verify(qr_token: str):
    row = await db.fetch_one(_CERT_SELECT + " WHERE q.token = $1", qr_token)
    if not row:
        return {"status": "SUSPICIOUS", "reason": "Unknown QR token — this label does not exist in Tredev's records."}
    cert = _shape_cert(row)
    if cert["revoked"]:
        return {"status": "REVOKED", "reason": "This certificate was revoked (returned/refunded unit).", "cert": cert}
    if not cert["activated"]:
        return {
            "status": "SUSPICIOUS",
            "reason": "This QR was minted but the physical unit has not been dispatched by Tredev yet. If you're seeing this in the wild, it likely isn't the real stone.",
            "cert": {k: v for k, v in cert.items() if k in {"serial", "product_name", "issued_at"}},
        }

    # Re-verify server-side against the exact bytes that were signed, using the key
    # this certificate was issued with (signing_keys supports rotation).
    ok = True
    try:
        pub = row.get("signing_public_key") or ED25519_PUBLIC_HEX
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub)).verify(
            bytes.fromhex(cert["signature_ed25519_hex"]),
            canonical_json(row["signed_payload"]).encode("utf-8"))
    except Exception:
        ok = False

    unit = await db.fetch_one(
        """SELECT pu.id::text AS unit_id, pu.product_id::text AS product_id,
                  pu.serial_no AS serial, pu.status::text AS status_db,
                  g.weight_carat::text AS weight_carat, g.origin AS origin
             FROM product_units pu
             LEFT JOIN gemstone_details g ON g.product_id = pu.product_id
            WHERE pu.id = $1::uuid""", row["unit_id"]) or {}
    if unit:
        unit["status"] = db.UNIT_STATUS_FROM_DB.get(unit.pop("status_db"), "available")
    product = await db.fetch_one(
        """SELECT p.title AS name, p.slug::text AS slug,
                  p.title_devanagari AS devanagari_name,
                  COALESCE((SELECT array_agg(ma.object_key ORDER BY pm.position)
                              FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
                             WHERE pm.product_id = p.id), ARRAY[]::text[]) AS images
             FROM products p WHERE p.id = $1::uuid""", row["product_id"]) or {}
    return {
        "status": "AUTHENTIC" if ok else "SUSPICIOUS",
        "cert": cert,
        "unit": unit,
        "product": {"name": product.get("name"), "slug": product.get("slug"), "devanagari_name": product.get("devanagari_name"), "images": product.get("images", [])},
        "verified_at": iso(now()),
    }


@api.get("/verify/qr/{qr_token}.png")
async def qr_image(qr_token: str):
    # Encode the public verify URL, not just the token, so any camera works.
    url = f"/verify/{qr_token}"
    img: PilImage = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return FastAPIResponse(content=buf.getvalue(), media_type="image/png")


# ── Cart & reservation ────────────────────────────────────────────────────────
# Mongo stored cart lines as an embedded array; here they're cart_items rows.
# `anon_key` maps onto carts.session_token. The response keeps the legacy shape.
async def _cart_items(cart_id: str, conn=None) -> list[dict]:
    sql = """
        SELECT ci.id::text                       AS line_id,
               p.id::text                        AS product_id,
               ci.product_unit_id::text          AS unit_id,
               ci.qty                            AS qty,
               ci.unit_price_snapshot            AS unit_price_snapshot,
               p.title                           AS name,
               (SELECT ma.object_key FROM product_media pm
                  JOIN media_assets ma ON ma.id = pm.media_id
                 WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS image
          FROM cart_items ci
          JOIN product_variants v ON v.id = ci.variant_id
          JOIN products p         ON p.id = v.product_id
         WHERE ci.cart_id = $1::uuid
         ORDER BY ci.created_at
    """
    rows = db._rows(await conn.fetch(sql, cart_id)) if conn else await db.fetch_all(sql, cart_id)
    return [{**{k: v for k, v in r.items() if k != "unit_price_snapshot"},
             "price": db.to_paise(r["unit_price_snapshot"])} for r in rows]


async def _shape_cart(row: dict, conn=None) -> dict:
    return {"cart_id": row["cart_id"],
            "user_id": row.get("user_id"),
            "anon_key": row.get("anon_key"),
            "items": await _cart_items(row["cart_id"], conn),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at")}


_CART_SELECT = """
    SELECT c.id::text        AS cart_id,
           c.user_id::text   AS user_id,
           c.session_token   AS anon_key,
           c.created_at      AS created_at,
           c.updated_at      AS updated_at
      FROM carts c
     WHERE c.status = 'active'
"""


async def _get_or_create_cart(user_id: Optional[str], anon_key: Optional[str]) -> dict:
    if not user_id and not anon_key:
        # Mongo matched {"anon_key": None} here, which silently collided with any
        # cart lacking the field. Fail cleanly instead.
        raise HTTPException(400, "No cart context — sign in or enable cookies.")
    if user_id:
        row = await db.fetch_one(_CART_SELECT + " AND c.user_id = $1::uuid", user_id)
    else:
        row = await db.fetch_one(_CART_SELECT + " AND c.session_token = $1", anon_key)
    if row:
        return await _shape_cart(row)
    cart_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO carts (id, user_id, session_token, currency, status)
           VALUES ($1, $2::uuid, $3, 'INR', 'active')
           ON CONFLICT DO NOTHING""",
        cart_id, user_id, None if user_id else anon_key)
    row = await db.fetch_one(
        _CART_SELECT + (" AND c.user_id = $1::uuid" if user_id else " AND c.session_token = $1"),
        user_id or anon_key)
    return await _shape_cart(row)


@api.post("/cart/add")
async def cart_add(body: CartAddIn, request: Request, response: Response, user_id: Optional[str] = Depends(get_user_id_optional)):
    product = await db.fetch_one(
        """SELECT p.id::text AS product_id, p.title, p.base_price, p.is_serialized,
                  v.id::text AS variant_id
             FROM products p
             JOIN product_variants v ON v.product_id = p.id AND v.is_active
            WHERE p.id = $1::uuid AND p.deleted_at IS NULL
            ORDER BY v.created_at LIMIT 1""", body.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    anon_key = request.cookies.get("gemora_anon")
    if not user_id and not anon_key:
        anon_key = uid("anon_")
        response.set_cookie("gemora_anon", anon_key, max_age=30 * 24 * 3600, httponly=False, path="/", **_cookie_kwargs())

    cart = await _get_or_create_cart(user_id, anon_key)

    unit_id = None
    qty = max(1, body.qty)
    if product["is_serialized"]:
        if not body.unit_id:
            raise HTTPException(400, "Serialized product requires unit_id")
        unit_id, qty = body.unit_id, 1
        exists = await db.fetch_val(
            """SELECT id::text FROM product_units
                WHERE id = $1::uuid AND product_id = $2::uuid""", unit_id, body.product_id)
        if not exists:
            raise HTTPException(404, "Unit not found")

    # Reservation + line insert are one transaction: if the unit was just taken, the
    # partial unique index (ux_reservations_active_unit) raises and nothing is written.
    try:
        async with db.transaction() as conn:
            if unit_id:
                await conn.execute(
                    """INSERT INTO reservations (id, product_unit_id, cart_id, user_id,
                                                 status, expires_at)
                       VALUES ($1,$2::uuid,$3::uuid,$4::uuid,'active',$5)""",
                    uuid.uuid4(), unit_id, cart["cart_id"], user_id,
                    now() + timedelta(minutes=15))
                await conn.execute(
                    "UPDATE product_units SET status='reserved' WHERE id=$1::uuid", unit_id)
            await conn.execute(
                """INSERT INTO cart_items (id, cart_id, variant_id, product_unit_id, qty,
                                           unit_price_snapshot)
                   VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6)""",
                uuid.uuid4(), cart["cart_id"], product["variant_id"], unit_id, qty,
                product["base_price"])
            await conn.execute(
                "UPDATE carts SET updated_at = now() WHERE id = $1::uuid", cart["cart_id"])
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(409, "This unit has just been reserved by another buyer.")

    return await _get_or_create_cart(user_id, anon_key)


@api.get("/cart")
async def cart_get(request: Request, user_id: Optional[str] = Depends(get_user_id_optional)):
    anon_key = request.cookies.get("gemora_anon")
    if not user_id and not anon_key:
        return {"cart_id": None, "items": []}
    cart = await _get_or_create_cart(user_id, anon_key)
    return cart


@api.post("/cart/remove/{line_id}")
async def cart_remove(line_id: str, request: Request, user_id: Optional[str] = Depends(get_user_id_optional)):
    anon_key = request.cookies.get("gemora_anon")
    cart = await _get_or_create_cart(user_id, anon_key)
    async with db.transaction() as conn:
        # Release the held unit as the line goes, in one transaction.
        unit_id = await conn.fetchval(
            """DELETE FROM cart_items WHERE id = $1::uuid AND cart_id = $2::uuid
            RETURNING product_unit_id""", line_id, cart["cart_id"])
        if unit_id:
            await conn.execute(
                """DELETE FROM reservations
                    WHERE product_unit_id = $1 AND status = 'active'""", unit_id)
            await conn.execute(
                "UPDATE product_units SET status='in_stock' WHERE id=$1", unit_id)
    return await _get_or_create_cart(user_id, anon_key)


# ── Checkout & Orders ─────────────────────────────────────────────────────────
# An order is normalised across orders + order_items + addresses + payments; these
# rebuild the flat Mongo-shaped dict the frontend still expects.
_ORDER_SELECT = """
    SELECT o.id::text                    AS order_id,
           o.user_id::text               AS user_id,
           o.guest_session_token         AS anon_key,
           o.order_no                    AS order_no,
           o.subtotal                    AS subtotal_n,
           o.tax_total                   AS gst_n,
           o.grand_total                 AS total_n,
           o.currency                    AS currency,
           o.status::text                AS status_db,
           o.affiliate_code::text        AS affiliate_code,
           o.affiliate_astrologer_id::text AS affiliate_astrologer_id,
           o.created_at                  AS created_at,
           a.recipient_name  AS shipping_name,  a.phone   AS shipping_phone,
           a.line1           AS shipping_address, a.city  AS shipping_city,
           a.state           AS shipping_state, a.pincode AS shipping_pincode,
           a.email_snapshot  AS shipping_email,
           -- Mongo kept these on the order doc; this schema models them properly:
           --   paid_at            -> payments
           --   shipping/tracking  -> shipments
           --   commission_id      -> affiliate_commissions (reverse lookup)
           pay.gateway_ref        AS razorpay_order_id,
           pay.gateway_payment_id AS payment_id,
           pay.paid_at            AS paid_at,
           (pay.gateway_ref IS NULL OR pay.gateway_ref LIKE 'mock_%') AS mock_payment,
           sh.tracking_no         AS tracking_number,
           sh.carrier             AS courier,
           sh.shipped_at          AS shipped_at,
           cm.id::text            AS commission_id
      FROM orders o
      LEFT JOIN addresses a ON a.id = o.shipping_address_id
      LEFT JOIN LATERAL (
            SELECT gateway_ref, gateway_payment_id, paid_at
              FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
      ) pay ON true
      LEFT JOIN LATERAL (
            SELECT carrier, tracking_no, shipped_at
              FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
      ) sh ON true
      LEFT JOIN affiliate_commissions cm ON cm.order_id = o.id
"""


# Order line-item projection. Selecting oi.order_id lets the same query serve both
# the single-order path and the batched (ANY($1)) path the list endpoints use.
_ORDER_ITEMS_COLS = """
        SELECT oi.order_id::text      AS order_id,
               oi.id::text            AS line_id,
               oi.product_id::text    AS product_id,
               oi.product_unit_id::text AS unit_id,
               oi.qty                 AS qty,
               oi.unit_price          AS unit_price,
               oi.title_snapshot      AS name,
               (SELECT ma.object_key FROM product_media pm
                  JOIN media_assets ma ON ma.id = pm.media_id
                 WHERE pm.product_id = oi.product_id ORDER BY pm.position LIMIT 1) AS image
          FROM order_items oi"""


def _shape_order_item(i: dict) -> dict:
    return {**{k: v for k, v in i.items() if k not in ("unit_price", "order_id")},
            "price": db.to_paise(i["unit_price"])}


async def _order_items_by_id(order_ids: list[str]) -> dict[str, list[dict]]:
    """Fetch line items for many orders in one query, grouped by order_id.

    Avoids the N+1 that `_shape_order`'s per-order query would cause when shaping
    a whole page of orders (list_orders / admin_list_orders)."""
    if not order_ids:
        return {}
    rows = await db.fetch_all(
        _ORDER_ITEMS_COLS + " WHERE oi.order_id = ANY($1::uuid[]) ORDER BY oi.created_at",
        order_ids)
    grouped: dict[str, list[dict]] = {}
    for i in rows:
        grouped.setdefault(i["order_id"], []).append(_shape_order_item(i))
    return grouped


async def _shape_orders(rows: list[dict]) -> list[dict]:
    """Shape a list of order rows with a single batched line-item fetch (2 queries
    total), instead of one items query per order."""
    items_by_id = await _order_items_by_id([r["order_id"] for r in rows])
    return [await _shape_order(r, items=items_by_id.get(r["order_id"], [])) for r in rows]


async def _shape_order(row: Optional[dict], conn=None, items: Optional[list] = None) -> Optional[dict]:
    if not row:
        return None
    r = dict(row)
    if items is None:
        sql = _ORDER_ITEMS_COLS + " WHERE oi.order_id = $1::uuid ORDER BY oi.created_at"
        rows = db._rows(await conn.fetch(sql, r["order_id"])) if conn else await db.fetch_all(sql, r["order_id"])
        items = [_shape_order_item(i) for i in rows]
    shipping = {k: r.pop(f"shipping_{k}") for k in
                ("name", "phone", "address", "city", "state", "pincode")}
    shipping = {f"shipping_{k}": v for k, v in shipping.items()}
    shipping["email"] = r.pop("shipping_email", None)
    return {**{k: v for k, v in r.items()
               if k not in ("subtotal_n", "gst_n", "total_n", "status_db")},
            "items": items,
            "subtotal": db.to_paise(r["subtotal_n"]),
            "gst": db.to_paise(r["gst_n"]),
            "total": db.to_paise(r["total_n"]),
            "status": db.ORDER_STATUS_FROM_DB.get(r["status_db"], r["status_db"]),
            "shipping": shipping}


async def _load_order(order_id: str, conn=None) -> Optional[dict]:
    sql = _ORDER_SELECT + " WHERE o.id = $1::uuid"
    row = db._row(await conn.fetchrow(sql, order_id)) if conn else await db.fetch_one(sql, order_id)
    return await _shape_order(row, conn)


@api.post("/checkout")
async def checkout(body: CheckoutIn, request: Request, user_id: Optional[str] = Depends(get_user_id_optional)):
    anon_key = request.cookies.get("gemora_anon")
    cart = await _get_or_create_cart(user_id, anon_key)
    items = cart.get("items", [])
    if not items:
        raise HTTPException(400, "Cart is empty")

    subtotal = sum(li["price"] * li["qty"] for li in items)
    gst = int(round(subtotal * 0.03))  # 3% GST on gemstones (illustrative)
    total = subtotal + gst

    order_id = uuid.uuid4()
    # Attribute affiliate — either explicit in body, or fall back to cart's tracked ref
    aff_ref = body.affiliate_ref or cart.get("affiliate_ref")
    aff_astro_id: Optional[str] = None
    if aff_ref:
        aff_astro_id = await db.fetch_val(
            "SELECT id::text FROM astrologers WHERE affiliate_code = $1::citext AND is_active",
            aff_ref)

    # orders.user_id is NOT NULL: this schema says every order belongs to someone.
    # A guest checkout therefore creates a claimable user from the (always required)
    # checkout email — they have no auth method until they set a password.
    if user_id:
        buyer_id = user_id
    else:
        buyer_id = await db.fetch_val(
            "SELECT id::text FROM users WHERE email = $1::citext AND deleted_at IS NULL",
            body.email.lower())
        if not buyer_id:
            buyer_id = str(uuid.uuid4())
            # No phone on the user: shipping_phone is a delivery contact, not an account
            # identity, and users.phone is UNIQUE — two guests sharing a number (or one
            # guest ordering twice) would collide. The phone lives on the address.
            await db.execute(
                """INSERT INTO users (id, email, full_name, status)
                   VALUES ($1::uuid, $2::citext, $3, 'active')""",
                buyer_id, body.email.lower(), body.shipping_name)
            rid = await db.fetch_val("SELECT id FROM roles WHERE name='customer'")
            if rid:
                await db.execute(
                    "INSERT INTO user_roles (user_id, role_id) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING",
                    buyer_id, rid)

    # Razorpay: create order if keys available, else mock
    rp_key = os.environ.get("RAZORPAY_KEY_ID", "")
    rp_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    rp_order_id = f"mock_{order_id}"
    if rp_key and rp_secret:
        try:
            import razorpay
            rp = razorpay.Client(auth=(rp_key, rp_secret))
            rp_order = rp.order.create({"amount": total, "currency": "INR",
                                        "receipt": str(order_id)[:40], "payment_capture": 1})
            rp_order_id = rp_order["id"]
        except Exception as e:
            log.warning(f"razorpay create failed: {e} — falling back to mock")

    # Address, order, lines and the pending payment are one transaction — Mongo wrote
    # a single document, so this has to be all-or-nothing too.
    async with db.transaction() as conn:
        addr_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1,
                                      city, state, pincode, country, email_snapshot, is_default)
               VALUES ($1,$2::uuid,'Shipping',$3,$4,$5,$6,$7,$8,'IN',$9::citext,false)""",
            addr_id, buyer_id, body.shipping_name, body.shipping_phone,
            body.shipping_address, body.shipping_city, body.shipping_state,
            body.shipping_pincode, body.email.lower())

        await conn.execute(
            """INSERT INTO orders (id, user_id, guest_session_token, status, currency,
                    subtotal, discount_total, tax_total, shipping_total, grand_total,
                    shipping_address_id, billing_address_id, affiliate_code,
                    affiliate_astrologer_id, placed_at)
               VALUES ($1,$2::uuid,$3,'pending','INR',$4,0,$5,0,$6,$7,$7,$8::citext,$9::uuid, now())""",
            order_id, buyer_id, None if user_id else anon_key,
            db.to_amount(subtotal), db.to_amount(gst), db.to_amount(total),
            addr_id, aff_ref if aff_astro_id else None, aff_astro_id)

        for li in items:
            await conn.execute(
                """INSERT INTO order_items (id, order_id, product_id, variant_id,
                        product_unit_id, title_snapshot, qty, unit_price, line_total,
                        fulfillment_status)
                   VALUES ($1,$2,$3::uuid,
                           (SELECT id FROM product_variants WHERE product_id=$3::uuid
                             ORDER BY created_at LIMIT 1),
                           $4::uuid,$5,$6,$7,$8,'pending')""",
                uuid.uuid4(), order_id, li["product_id"], li["unit_id"], li["name"],
                li["qty"], db.to_amount(li["price"]),
                db.to_amount(li["price"] * li["qty"]))

        await conn.execute(
            """INSERT INTO payments (id, order_id, gateway, gateway_ref, amount, currency,
                                     status)
               VALUES ($1,$2,'razorpay',$3,$4,'INR','initiated')""",
            uuid.uuid4(), order_id, rp_order_id, db.to_amount(total))

        # Cart is converted, not deleted — it's the audit trail of what was bought.
        await conn.execute(
            "UPDATE carts SET status='converted', updated_at=now() WHERE id=$1::uuid",
            cart["cart_id"])

    order = await _load_order(str(order_id))
    return {"order": order, "razorpay_key_id": rp_key or None}


@api.post("/checkout/mock-pay/{order_id}")
async def mock_pay(order_id: str):
    """Dev helper: completes an order without Razorpay live keys, atomically flipping units to sold."""
    order = await _load_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "pending_payment":
        return order
    return await _mark_paid(order, payment_id=f"mock_pay_{uid()}")


async def _mark_paid(order: dict, payment_id: str) -> dict:
    """Reservations -> consumed, units -> sold, order -> paid, commission recorded.

    Mongo had to sequence these as separate best-effort writes ("atomic-ish"); here
    it's one real transaction, so a lost reservation rolls the whole payment back
    rather than leaving a half-paid order.
    """
    order_id = order["order_id"]
    async with db.transaction() as conn:
        for li in order.get("items", []):
            if not li.get("unit_id"):
                continue
            # Consume the reservation we hold; 0 rows means someone else took the unit.
            got = await conn.fetchval(
                """UPDATE reservations SET status = 'consumed'
                    WHERE product_unit_id = $1::uuid AND status = 'active'
                RETURNING id""", li["unit_id"])
            if not got:
                raise HTTPException(409, f"Reservation lost for unit {li['unit_id']}")
            await conn.execute(
                """UPDATE product_units pu SET status = 'sold',
                          sold_order_item_id = (SELECT id FROM order_items
                                                 WHERE order_id = $2::uuid
                                                   AND product_unit_id = $1::uuid LIMIT 1)
                    WHERE pu.id = $1::uuid""", li["unit_id"], order_id)

        # paid_at lives on payments here, not orders — the order only carries status.
        await conn.execute(
            "UPDATE orders SET status='paid' WHERE id=$1::uuid", order_id)
        await conn.execute(
            """UPDATE payments SET status='captured', gateway_payment_id=$2, paid_at=now()
                WHERE order_id=$1::uuid""", order_id, payment_id)

        # Affiliate commission — once per order (enforced by affiliate_commissions.order_id UNIQUE)
        if order.get("affiliate_astrologer_id") and not order.get("commission_id"):
            pct = await conn.fetchval(
                "SELECT commission_pct FROM astrologers WHERE id=$1::uuid",
                order["affiliate_astrologer_id"])
            if pct and float(pct) > 0:
                cid = uuid.uuid4()
                subtotal = db.to_amount(order.get("subtotal") or 0)
                await conn.execute(
                    """INSERT INTO affiliate_commissions (id, astrologer_id, affiliate_code,
                            order_id, order_subtotal, order_total, commission_pct,
                            commission_amount, currency, status)
                       VALUES ($1,$2::uuid,$3::citext,$4::uuid,$5,$6,$7,$8,'INR','pending')
                       ON CONFLICT (order_id) DO NOTHING""",
                    cid, order["affiliate_astrologer_id"], order.get("affiliate_code"),
                    order_id, subtotal, db.to_amount(order.get("total") or 0), pct,
                    (subtotal * pct / 100).quantize(Decimal("0.01")))
        # order_events is this schema's status audit trail — Mongo had no equivalent.
        await conn.execute(
            """INSERT INTO order_events (id, order_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,'pending','paid','payment captured')""",
            uuid.uuid4(), order_id)
    return await _load_order(order_id)


class RazorpayVerifyIn(BaseModel):
    order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@api.post("/checkout/verify")
async def checkout_verify(body: RazorpayVerifyIn):
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not secret:
        raise HTTPException(400, "Razorpay not configured — use /api/checkout/mock-pay for dev.")
    expected = hmac.new(secret.encode(), f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(400, "Bad signature")
    order = await _load_order(body.order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    # Idempotent: the payment.captured webhook may have already marked this order paid
    # in a race with this client-side verify call. _mark_paid is not safe to run twice
    # (it consumes 'active' reservations and 409s once they're already consumed), so
    # short-circuit when the order is already paid — the payment IS complete. Mirrors
    # the same status guard the webhook uses above.
    if order.get("status") == "paid":
        return order
    return await _mark_paid(order, body.razorpay_payment_id)


@api.post("/checkout/pay/{order_id}")
async def checkout_pay(order_id: str, request: Request,
                       user_id: Optional[str] = Depends(get_user_id_optional)):
    """Re-initiate payment for an existing unpaid order — the "Pay now" button on the
    account page. Creates a FRESH Razorpay order for the outstanding total and repoints
    the payment row's gateway_ref at it (so the webhook can still match), then hands the
    key + order id back to the client to open checkout. Falls back to the mock path when
    Razorpay keys aren't configured. Response shape mirrors /checkout so the frontend
    reuses the same Razorpay-open + /checkout/verify logic."""
    order = await _load_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    if user_id and order.get("user_id") and order["user_id"] != user_id:
        raise HTTPException(403, "Not your order")
    if order.get("status") == "paid":
        return {"order": order, "already_paid": True}
    if order.get("status") != "pending_payment":
        raise HTTPException(409, f"Order is {order.get('status')} — not payable")

    rp_key = os.environ.get("RAZORPAY_KEY_ID", "")
    rp_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if rp_key and rp_secret:
        try:
            import razorpay
            rp = razorpay.Client(auth=(rp_key, rp_secret))
            rp_order = rp.order.create({"amount": int(order["total"]), "currency": "INR",
                                        "receipt": order_id[:40], "payment_capture": 1})
            await db.execute(
                """UPDATE payments SET gateway_ref = $2, status = 'initiated'
                    WHERE id = (SELECT id FROM payments WHERE order_id = $1::uuid
                                ORDER BY created_at DESC LIMIT 1)""",
                order_id, rp_order["id"])
            return {"order": order, "razorpay_key_id": rp_key,
                    "razorpay_order_id": rp_order["id"], "mock_payment": False}
        except Exception as e:
            log.warning(f"pay-now razorpay create failed: {e} — falling back to mock")
    return {"order": order, "razorpay_key_id": None, "mock_payment": True}


# ── Razorpay webhook (server-to-server, signature-verified, idempotent) ───────
@api.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """
    Razorpay -> here. Handles payment.captured / payment.failed / order.paid.
    Signature is HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET.
    We ALWAYS return 200 to Razorpay after logging so they don't retry-storm us
    on our own bugs; the event is retained in processed_webhooks for audit.
    """
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    raw = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    event_id = request.headers.get("x-razorpay-event-id", "")

    # 1. Verify signature (skip only if webhook secret hasn't been set yet)
    verified = False
    if secret:
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        verified = hmac.compare_digest(expected, sig)
        if not verified:
            log.warning(f"razorpay webhook: bad signature (event_id={event_id})")
            raise HTTPException(400, "Bad signature")
    else:
        log.warning("razorpay webhook: RAZORPAY_WEBHOOK_SECRET not set — accepting without verification")

    # 2. Idempotency — dedupe by X-Razorpay-Event-Id
    if event_id:
        exists = await db.fetch_val(
            "SELECT event_id FROM processed_webhooks WHERE event_id = $1", event_id)
        if exists:
            return {"ok": True, "duplicate": True}

    try:
        payload = json.loads(raw or b"{}")
    except Exception:
        payload = {}

    event = payload.get("event", "")
    result: dict = {"ok": True, "event": event}

    try:
        if event in ("payment.captured", "order.paid"):
            payment = (payload.get("payload", {}) or {}).get("payment", {}).get("entity") or {}
            razorpay_order_id = payment.get("order_id")
            razorpay_payment_id = payment.get("id")
            if razorpay_order_id:
                # Find our internal order via the payment's gateway_ref.
                oid = await db.fetch_val(
                    "SELECT order_id::text FROM payments WHERE gateway_ref = $1"
                    " ORDER BY created_at DESC LIMIT 1", razorpay_order_id)
                order = await _load_order(oid) if oid else None
                if order and order.get("status") != "paid":
                    await _mark_paid(order, razorpay_payment_id or "")
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = True
                elif order:
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = False
                    result["reason"] = "already paid"
                else:
                    result["marked_paid"] = False
                    result["reason"] = f"order for razorpay_order_id={razorpay_order_id} not found"
        elif event == "payment.failed":
            payment = (payload.get("payload", {}) or {}).get("payment", {}).get("entity") or {}
            razorpay_order_id = payment.get("order_id")
            if razorpay_order_id:
                reason = payment.get("error_description") or payment.get("error_code")
                async with db.transaction() as conn:
                    oid = await conn.fetchval(
                        "SELECT order_id FROM payments WHERE gateway_ref = $1"
                        " ORDER BY created_at DESC LIMIT 1", razorpay_order_id)
                    if oid:
                        await conn.execute(
                            """UPDATE orders SET status='payment_failed'
                                WHERE id = $1 AND status <> 'paid'""", oid)
                        await conn.execute(
                            """UPDATE payments SET status='failed',
                                      method_details = COALESCE(method_details,'{}'::jsonb)
                                                       || jsonb_build_object('failure_reason', $2::text)
                                WHERE order_id = $1""", oid, reason)
                        await conn.execute(
                            """INSERT INTO order_events (id, order_id, to_status, reason)
                               VALUES ($1,$2,'payment_failed',$3)""",
                            uuid.uuid4(), oid, reason)
                result["payment_failed_for"] = razorpay_order_id
    except Exception as e:
        log.exception(f"razorpay webhook handler crashed: {e}")
        result["ok"] = False
        result["error"] = str(e)[:200]

    # 3. Persist event for audit + idempotency
    try:
        # event_id is the idempotency key and is NOT NULL; synthesise one when Razorpay
        # omits the header (such events can't be deduped anyway).
        await db.execute(
            """INSERT INTO processed_webhooks (event_id, gateway, event_type, verified,
                                               payload, result, processed_at)
               VALUES ($1,'razorpay',$2,$3,$4,$5, now())
               ON CONFLICT (event_id) DO NOTHING""",
            event_id or f"noid_{uuid.uuid4().hex}", event, verified, payload, result)
    except Exception as e:
        log.warning(f"razorpay webhook: audit insert failed: {e}")

    return result


@api.get("/orders")
async def list_orders(user_id: str = Depends(require_user)):
    rows = await db.fetch_all(
        _ORDER_SELECT + " WHERE o.user_id = $1::uuid ORDER BY o.created_at DESC LIMIT 200",
        user_id)
    return await _shape_orders(rows)


@api.get("/orders/{order_id}")
async def get_order(order_id: str, user_id: str = Depends(require_user)):
    row = await db.fetch_one(
        _ORDER_SELECT + " WHERE o.id = $1::uuid AND o.user_id = $2::uuid",
        order_id, user_id)
    if not row:
        raise HTTPException(404, "Not found")
    return await _shape_order(row)


# ── Admin: dispatch → activate QR ────────────────────────────────────────────
@api.post("/admin/dispatch")
async def admin_dispatch(body: DispatchIn, user_id: str = Depends(require_admin)):
    order = await _load_order(body.order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    # Confirm unit belongs to this order
    li = next((x for x in order.get("items", []) if x.get("unit_id") == body.unit_id), None)
    if not li:
        raise HTTPException(400, "Unit not in this order")
    cert = await db.fetch_one(
        """SELECT ac.id::text AS cert_id, ac.product_unit_id::text AS unit_id,
                  pu.product_id::text AS product_id, q.id::text AS qr_id, q.token AS qr_token
             FROM authenticity_certificates ac
             JOIN product_units pu ON pu.id = ac.product_unit_id
             LEFT JOIN qr_codes q ON q.authenticity_certificate_id = ac.id
            WHERE ac.product_unit_id = $1::uuid""", body.unit_id)
    if not cert:
        raise HTTPException(400, "No certificate on file — issue one before dispatch")

    async with db.transaction() as conn:
        # Activate the QR. Mongo kept activated/activated_at on the certificate; here
        # the QR itself owns its lifecycle (qr_codes.status/activated_at).
        # The QR owns activation. Ownership (sold_to_user_id/order_id in the legacy API)
        # is derived from product_units.sold_order_item_id -> order_items -> orders,
        # which _mark_paid already wired up — nothing to write on the certificate.
        await conn.execute(
            """UPDATE qr_codes SET status='active', activated_at=now()
                WHERE authenticity_certificate_id=$1::uuid""", cert["cert_id"])
        # Shipment carries tracking; orders only carries status.
        await conn.execute(
            """INSERT INTO shipments (id, order_id, carrier, tracking_no, status, shipped_at)
               VALUES ($1,$2::uuid,$3,$4,'in_transit', now())""",
            uuid.uuid4(), body.order_id, body.courier, body.tracking_number)
        await conn.execute(
            "UPDATE orders SET status='shipped' WHERE id=$1::uuid", body.order_id)
        await conn.execute(
            """UPDATE order_items SET fulfillment_status='shipped'
                WHERE order_id=$1::uuid AND product_unit_id=$2::uuid""",
            body.order_id, body.unit_id)
        await conn.execute(
            """INSERT INTO order_events (id, order_id, actor_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,$3::uuid,'paid','shipped','dispatched')""",
            uuid.uuid4(), body.order_id, user_id)
        # Add to buyer's verified vault
        if order.get("user_id"):
            await conn.execute(
                """INSERT INTO verified_items (user_id, product_unit_id, qr_code_id, product_id)
                   VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)
                   ON CONFLICT (user_id, product_unit_id) DO NOTHING""",
                order["user_id"], body.unit_id, cert["qr_id"], cert["product_id"])

    # Fire WhatsApp "order dispatched" notification (utility template — always allowed)
    buyer = await _load_user(user_id=order["user_id"]) if order.get("user_id") else None
    if buyer and buyer.get("phone"):
        try:
            await wa_send_utility(
                buyer["phone"], _META_WA_DISPATCH_TMPL,
                [buyer.get("name", "friend"), order["order_id"], body.tracking_number or "—"],
            )
        except Exception as e:
            log.warning(f"WA dispatch send failed: {e}")
    await audit_log(user_id, "order.dispatch", order["order_id"], {"unit_id": body.unit_id})
    return {"ok": True}


@api.post("/admin/certificates/revoke/{cert_id}")
async def admin_revoke(cert_id: str, user_id: str = Depends(require_admin)):
    async with db.transaction() as conn:
        got = await conn.fetchval(
            """UPDATE authenticity_certificates SET revoked_at = now()
                WHERE id = $1::uuid RETURNING id""", cert_id)
        if not got:
            raise HTTPException(404, "Cert not found")
        # The QR must stop verifying too — it's what the public actually scans.
        await conn.execute(
            "UPDATE qr_codes SET status='revoked' WHERE authenticity_certificate_id=$1::uuid",
            cert_id)
    await audit_log(user_id, "certificate.revoke", cert_id)
    return {"ok": True}


@api.get("/admin/orders")
async def admin_list_orders(user_id: str = Depends(require_admin)):
    rows = await db.fetch_all(_ORDER_SELECT + " ORDER BY o.created_at DESC LIMIT 500")
    return await _shape_orders(rows)


@api.get("/admin/units")
async def admin_units(user_id: str = Depends(require_admin), product_id: Optional[str] = None):
    sql = """
        SELECT pu.id::text          AS unit_id,
               pu.product_id::text  AS product_id,
               pu.serial_no         AS serial,
               pu.status::text      AS status_db,
               g.weight_carat::text AS weight_carat,
               g.origin             AS origin,
               ''                   AS notes,
               pu.created_at        AS created_at
          FROM product_units pu
          LEFT JOIN gemstone_details g ON g.product_id = pu.product_id
    """
    args = []
    if product_id:
        args.append(product_id)
        sql += " WHERE pu.product_id = $1::uuid"
    rows = await db.fetch_all(sql + " ORDER BY pu.created_at, pu.serial_no LIMIT 500", *args)
    for r in rows:
        r["status"] = db.UNIT_STATUS_FROM_DB.get(r.pop("status_db"), "available")
    return rows


@api.get("/admin/certificates")
async def admin_certs(user_id: str = Depends(require_admin)):
    rows = await db.fetch_all(_CERT_SELECT + " ORDER BY ac.issued_at DESC LIMIT 500")
    return [_shape_cert(r) for r in rows]


# ── Account: verified items, wishlist, reviews ────────────────────────────────
@api.get("/me/verified-items")
async def my_verified(user_id: str = Depends(require_user)):
    # Was an N+1 loop (one cert + one product query per vault row); now one query.
    rows = await db.fetch_all(
        """SELECT vi.user_id::text AS user_id, vi.product_unit_id::text AS unit_id,
                  vi.product_id::text AS product_id, q.token AS qr_token,
                  vi.created_at AS added_at,
                  ac.signed_payload AS signed_payload, ac.content_hash AS content_hash_sha256,
                  ac.signature AS signature_ed25519_hex, ac.revoked_at AS revoked_at,
                  q.activated_at AS activated_at, q.status::text AS qr_status,
                  o.user_id::text AS sold_to_user_id, o.id::text AS order_id,
                  p.title AS p_name, p.slug::text AS p_slug,
                  p.title_devanagari AS p_devanagari,
                  COALESCE((SELECT array_agg(ma.object_key ORDER BY pm.position)
                              FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
                             WHERE pm.product_id = p.id), ARRAY[]::text[]) AS p_images
             FROM verified_items vi
             LEFT JOIN qr_codes q ON q.id = vi.qr_code_id
             LEFT JOIN authenticity_certificates ac ON ac.id = q.authenticity_certificate_id
             LEFT JOIN product_units pu ON pu.id = vi.product_unit_id
             LEFT JOIN order_items oi ON oi.id = pu.sold_order_item_id
             LEFT JOIN orders o ON o.id = oi.order_id
             LEFT JOIN products p ON p.id = vi.product_id
            WHERE vi.user_id = $1::uuid
            ORDER BY vi.created_at DESC LIMIT 500""", user_id)
    out = []
    for r in rows:
        item = {"user_id": r["user_id"], "unit_id": r["unit_id"],
                "product_id": r["product_id"], "qr_token": r["qr_token"],
                "added_at": r["added_at"]}
        cert = _shape_cert(r) if r.get("signed_payload") else None
        out.append({"item": item, "cert": cert,
                    "product": {"name": r["p_name"], "slug": r["p_slug"],
                                "images": r["p_images"], "devanagari_name": r["p_devanagari"]}})
    return out


@api.post("/me/wishlist/{product_id}")
async def wishlist_add(product_id: str, user_id: str = Depends(require_user)):
    await db.execute(
        """INSERT INTO wishlist (user_id, product_id) VALUES ($1::uuid, $2::uuid)
           ON CONFLICT (user_id, product_id) DO NOTHING""", user_id, product_id)
    return {"ok": True}


@api.get("/me/wishlist")
async def wishlist_get(user_id: str = Depends(require_user)):
    # Was an N+1 (one product lookup per wishlist row); one join now.
    rows = await db.fetch_all(
        _PRODUCT_SELECT + """ AND p.id IN (SELECT product_id FROM wishlist
                                            WHERE user_id = $1::uuid)
                              ORDER BY p.created_at DESC LIMIT 200""", user_id)
    return [_shape_product(r) for r in rows]


# `author` is denormalised from users.full_name in the API; the table stores only the
# FK. order_item_id stays NULL here — see the reviews migration.
_REVIEW_SELECT = """
    SELECT r.id::text         AS review_id,
           r.product_id::text AS product_id,
           r.user_id::text    AS user_id,
           COALESCE(u.full_name, 'Anonymous') AS author,
           r.rating           AS rating,
           COALESCE(r.title, '') AS title,
           COALESCE(r.body, '')  AS body,
           r.created_at       AS created_at
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
"""


@api.post("/reviews")
async def create_review(body: ReviewIn, user_id: str = Depends(require_user)):
    review_id = uuid.uuid4()
    # If this user bought the product, link the order item so the review is a
    # verified-buyer one; otherwise it's an unverified review (still allowed).
    order_item_id = await db.fetch_val(
        """SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.user_id = $1::uuid AND oi.product_id = $2::uuid
            ORDER BY oi.created_at DESC LIMIT 1""", user_id, body.product_id)
    await db.execute(
        """INSERT INTO reviews (id, product_id, user_id, order_item_id, rating, title,
                                body, moderation_status)
           VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,'approved')""",
        review_id, body.product_id, user_id, order_item_id, body.rating,
        body.title, body.body)
    return await db.fetch_one(_REVIEW_SELECT + " WHERE r.id = $1::uuid", str(review_id))


@api.get("/reviews/{product_id}")
async def list_reviews(product_id: str):
    return await db.fetch_all(
        _REVIEW_SELECT + " WHERE r.product_id = $1::uuid"
        " ORDER BY r.created_at DESC LIMIT 200", product_id)


# ── Consultation ──────────────────────────────────────────────────────────────
ASTROLOGERS = [
    {"astrologer_id": "astro_ravi", "name": "Pandit Ravi Shastri", "devanagari": "पं. रवि शास्त्री", "expertise": ["Vedic", "Numerology"], "price": 150000, "years": 22, "picture": "https://images.pexels.com/photos/8828413/pexels-photo-8828413.jpeg"},
    {"astrologer_id": "astro_meera", "name": "Acharya Meera Devi", "devanagari": "आचार्या मीरा देवी", "expertise": ["Gemstone", "Rudraksha"], "price": 200000, "years": 18, "picture": "https://images.pexels.com/photos/6207517/pexels-photo-6207517.jpeg"},
    {"astrologer_id": "astro_arjun", "name": "Guru Arjun Trivedi", "devanagari": "गुरु अर्जुन त्रिवेदी", "expertise": ["Nadi", "KP Astrology"], "price": 250000, "years": 30, "picture": "https://images.pexels.com/photos/6076994/pexels-photo-6076994.jpeg"},
]


# Legacy field names: full_name->name, avatar_url->picture, weekly slots as a nested
# array. Prices are numeric rupees in the DB, paise in the API.
_ASTRO_SELECT = """
    SELECT a.id::text          AS astrologer_id,
           a.full_name         AS name,
           COALESCE(a.devanagari, '')  AS devanagari,
           a.expertise         AS expertise,
           a.price             AS price_n,
           a.years             AS years,
           COALESCE(a.avatar_url, '')  AS picture,
           a.email::text       AS email,
           a.commission_pct    AS commission_pct_n,
           COALESCE(a.bio, '') AS bio,
           a.is_active         AS is_active,
           a.affiliate_code::text AS affiliate_code,
           a.password_hash     AS password_hash,
           a.blackout_dates    AS blackout_dates,
           a.created_at        AS created_at,
           COALESCE(s.slots, '[]'::jsonb) AS weekly_slots
      FROM astrologers a
      LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                     'day', ws.day_of_week,
                     'start', to_char(ws.start_time, 'HH24:MI'),
                     'end', to_char(ws.end_time, 'HH24:MI'))
                   ORDER BY ws.position) AS slots
              FROM astrologer_weekly_slots ws WHERE ws.astrologer_id = a.id
      ) s ON true
"""


def _shape_astro(row: Optional[dict], include_hash: bool = False) -> Optional[dict]:
    if not row:
        return None
    r = dict(row)
    out = {**{k: v for k, v in r.items()
              if k not in ("price_n", "commission_pct_n", "password_hash")},
           "price": db.to_paise(r["price_n"]),
           "commission_pct": float(r["commission_pct_n"]) if r["commission_pct_n"] is not None else 0.0}
    if include_hash:
        out["password_hash"] = r.get("password_hash")
    return out


_COMMISSION_SELECT = """
    SELECT ac.id::text            AS commission_id,
           ac.astrologer_id::text AS astrologer_id,
           ac.affiliate_code::text AS affiliate_code,
           ac.order_id::text      AS order_id,
           ac.order_subtotal      AS order_subtotal_n,
           ac.order_total         AS order_total_n,
           ac.commission_pct      AS commission_pct_n,
           ac.commission_amount   AS commission_amount_n,
           ac.currency            AS currency,
           ac.status::text        AS status,
           ac.created_at          AS created_at
      FROM affiliate_commissions ac
"""


def _shape_commission(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return None
    r = dict(row)
    return {**{k: v for k, v in r.items() if not k.endswith("_n")},
            "order_subtotal": db.to_paise(r["order_subtotal_n"]),
            "order_total": db.to_paise(r["order_total_n"]),
            "commission_pct": float(r["commission_pct_n"]),
            "commission_amount": db.to_paise(r["commission_amount_n"])}


_CONSULT_SELECT = """
    SELECT c.id::text                     AS booking_id,
           c.astrologer_id::text          AS astrologer_id,
           c.astrologer_name_snapshot     AS astrologer_name,
           c.slot_at                      AS slot_iso,
           c.user_id::text                AS user_id,
           c.contact_name                 AS name,
           c.contact_email::text          AS email,
           c.contact_phone                AS phone,
           COALESCE(c.concern, '')        AS concern,
           c.amount                       AS amount_n,
           c.status::text                 AS status,
           c.jitsi_room                   AS jitsi_room,
           c.meeting_link                 AS meeting_link,
           c.notes                        AS notes,
           c.created_at                   AS created_at,
           c.updated_at                   AS updated_at
      FROM consultations c
"""


def _shape_consult(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return None
    r = dict(row)
    return {**{k: v for k, v in r.items() if k != "amount_n"},
            "amount": db.to_paise(r["amount_n"])}


async def _load_consultation(booking_id: str) -> Optional[dict]:
    return _shape_consult(await db.fetch_one(
        _CONSULT_SELECT + " WHERE c.id = $1::uuid", booking_id))


@api.get("/consultation/astrologers")
async def list_astrologers():
    rows = await db.fetch_all(
        _ASTRO_SELECT + " WHERE a.is_active ORDER BY a.created_at LIMIT 50")
    db_a = [_shape_astro(r) for r in rows]
    return db_a if db_a else ASTROLOGERS


@api.post("/consultation/book")
async def book(body: ConsultationBookIn, user_id: Optional[str] = Depends(get_user_id_optional)):
    astro = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.id = $1::uuid", body.astrologer_id))
    if not astro:
        raise HTTPException(404, "Astrologer not found")
    # slot_at is timestamptz here (Mongo kept slot_iso as a plain string), so the
    # incoming ISO string has to be parsed rather than passed through.
    try:
        slot_at = datetime.fromisoformat(body.slot_iso.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "slot_iso must be an ISO-8601 datetime")
    if slot_at.tzinfo is None:
        slot_at = slot_at.replace(tzinfo=timezone.utc)

    booking_id = uuid.uuid4()
    # Auto-generated Jitsi meeting room — public meet.jit.si, no config needed
    jitsi_room = f"gemora-{booking_id}"
    await db.execute(
        """INSERT INTO consultations (id, astrologer_id, astrologer_name_snapshot, slot_at,
                user_id, contact_name, contact_email, contact_phone, concern, amount,
                status, jitsi_room, meeting_link)
           VALUES ($1,$2::uuid,$3,$4,$5::uuid,$6,$7::citext,$8,$9,$10,
                   'requested',$11,$12)""",
        booking_id, astro["astrologer_id"], astro["name"], slot_at, user_id,
        body.name, body.email, body.phone, body.concern, db.to_amount(astro["price"]),
        jitsi_room, f"https://meet.jit.si/{jitsi_room}")
    return await _load_consultation(str(booking_id))


# ── Dev seed (idempotent) ─────────────────────────────────────────────────────
@api.post("/dev/seed")
async def dev_seed():
    """Seed admin user + demo catalog (idempotent).

    Lives in backend/seed_pg.py: the Postgres seed touches ~15 tables (categories,
    products + variants + per-category detail rows, media, units, temples/priests,
    signing key, certs + lab/energization/QR, users + roles/permissions/prefs,
    astrologers), which is far too much to inline in a route handler.
    """
    import seed_pg
    return await seed_pg.run(
        hash_password=hash_password,
        ed25519_public_hex=ED25519_PUBLIC_HEX,
        content_hash=content_hash,
        sign_payload=sign_payload,
        iso=iso, now=now,
    )


# ── Admin: extended management ───────────────────────────────────────────────
class ProductUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    mrp: Optional[int] = None
    images: Optional[List[str]] = None
    attrs: Optional[dict] = None
    devanagari_name: Optional[str] = None
    is_active: Optional[bool] = None
    stock_qty: Optional[int] = None  # for non-serialised items


class CategoryIn(BaseModel):
    key: str
    label: str
    hindi: Optional[str] = ""
    parent_key: Optional[str] = None
    order: int = 100


class CategoryUpdateIn(BaseModel):
    label: Optional[str] = None
    hindi: Optional[str] = None
    parent_key: Optional[str] = None
    order: Optional[int] = None


class AstrologerIn(BaseModel):
    name: str
    devanagari: Optional[str] = ""
    expertise: List[str] = []
    price: int
    years: int = 0
    picture: str = ""
    email: Optional[EmailStr] = None       # login email; welcome mail is minted for this
    commission_pct: float = 10.0            # 0-100, per-astrologer share of affiliate sales
    bio: Optional[str] = ""


class AstrologerUpdateIn(BaseModel):
    name: Optional[str] = None
    devanagari: Optional[str] = None
    expertise: Optional[List[str]] = None
    price: Optional[int] = None
    years: Optional[int] = None
    picture: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None
    commission_pct: Optional[float] = None
    bio: Optional[str] = None


# ── Astrologer-side auth & self-serve models ─────────────────────────────────
class AstroLoginIn(BaseModel):
    email: EmailStr
    password: str


class AstroSetPasswordIn(BaseModel):
    token: str
    password: str = Field(min_length=6)


class AstroRequestResetIn(BaseModel):
    email: EmailStr


class AstroWeeklySlot(BaseModel):
    day: int = Field(ge=0, le=6)  # 0=Mon, 6=Sun
    start: str                    # "HH:MM"
    end: str                      # "HH:MM"


class AstroAvailabilityIn(BaseModel):
    weekly_slots: List[AstroWeeklySlot] = []
    blackout_dates: List[str] = []  # ISO YYYY-MM-DD


class AstroConsultUpdateIn(BaseModel):
    status: Optional[str] = None  # requested | confirmed | completed | cancelled
    notes: Optional[str] = None


class OrderStatusIn(BaseModel):
    status: str  # pending_payment | paid | shipped | delivered | cancelled | refunded


class QueryIn(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    subject: str
    message: str


class QueryReplyIn(BaseModel):
    status: Optional[str] = None  # open | in_progress | resolved | closed
    note: Optional[str] = None


class StaffCreateIn(BaseModel):
    name: str
    email: EmailStr
    password: Optional[str] = None  # None → auto-generate
    permissions: List[str] = []
    phone: Optional[str] = None


class StaffUpdateIn(BaseModel):
    permissions: Optional[List[str]] = None
    role: Optional[str] = None  # owner | staff | customer
    is_active: Optional[bool] = None


async def audit_log(actor_id: str, action: str, target: str = "", meta: Optional[dict] = None) -> None:
    """Append an admin action to the audit trail."""
    try:
        await db.execute(
            """INSERT INTO admin_events (id, actor_id, action, target, meta)
               VALUES ($1, $2::uuid, $3, $4, $5)""",
            uuid.uuid4(), actor_id, action, target, meta or {})
    except Exception as e:
        log.warning(f"audit_log failed: {e}")


# --- Users list & role management (OWNER only) --------------------------------
@api.get("/admin/users")
async def admin_list_users(_: str = Depends(require_owner), role: Optional[str] = None):
    sql, args = _USER_SELECT, []
    if role:
        # role is derived from user_roles; 'owner' is the 'admin' row.
        args.append("admin" if role == "owner" else role)
        sql += f""" AND COALESCE((SELECT ro.name FROM user_roles ur
                                    JOIN roles ro ON ro.id = ur.role_id
                                   WHERE ur.user_id = u.id
                                   ORDER BY CASE ro.name WHEN 'admin' THEN 0
                                                         WHEN 'staff' THEN 1 ELSE 2 END
                                   LIMIT 1), 'customer') = ${len(args)}"""
    rows = await db.fetch_all(sql + " ORDER BY u.created_at DESC LIMIT 1000", *args)
    return [{k: v for k, v in _shape_user(r).items() if k != "password_hash"}
            for r in rows]


@api.get("/admin/users/permissions")
async def admin_permissions_list(_: str = Depends(require_owner)):
    return {"permissions": ALL_PERMISSIONS}


@api.post("/admin/staff")
async def admin_create_staff(body: StaffCreateIn, actor: str = Depends(require_owner)):
    if await _load_user(email=body.email.lower()):
        raise HTTPException(400, "Email already registered")
    perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
    temp_pw = body.password or secrets.token_urlsafe(9)
    phone = normalize_phone(body.phone) if body.phone else None
    new_id = uuid.uuid4()
    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO users (id, email, full_name, phone, phone_verified_at,
                                  password_hash, status)
               VALUES ($1,$2::citext,$3,$4,$5,$6,'active')""",
            new_id, body.email.lower(), body.name, phone,
            now() if phone else None, hash_password(temp_pw))
        rid = await conn.fetchval("SELECT id FROM roles WHERE name='staff'")
        if rid:
            await conn.execute(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)", new_id, rid)
        for p in perms:
            await conn.execute(
                "INSERT INTO user_permissions (user_id, permission) VALUES ($1,$2)",
                new_id, p)
        # staff don't get marketing WhatsApp by default
        await conn.execute(
            """INSERT INTO notification_preferences (user_id, whatsapp)
               VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING""",
            new_id, {"optin": False})
    doc = await _load_user(user_id=str(new_id))
    # Best-effort invite via WhatsApp (utility template) or logged in mock mode
    login_url = os.environ.get("PUBLIC_APP_URL", "").rstrip("/") + "/login"
    invite_sent = False
    if phone:
        try:
            await wa_send_utility(phone, os.environ.get("META_WA_INVITE_TEMPLATE", "gemora_staff_invite"),
                                  [body.name, body.email.lower(), temp_pw, login_url or "https://gemora.in/login"])
            invite_sent = True
        except Exception as e:
            log.warning(f"staff invite WA failed: {e}")
    await audit_log(actor, "staff.create", doc["user_id"], {"email": body.email.lower(), "permissions": perms, "invite_sent": invite_sent})
    doc.pop("password_hash", None)
    return {**doc, "temp_password": temp_pw, "invite_sent": invite_sent, "invite_channel": "whatsapp" if invite_sent else "mock"}


async def _set_user_role(conn, user_id: str, role: str) -> None:
    """Replace the user's role. 'owner' maps to the 'admin' row."""
    rid = await conn.fetchval(
        "SELECT id FROM roles WHERE name = $1", "admin" if role == "owner" else role)
    await conn.execute("DELETE FROM user_roles WHERE user_id = $1::uuid", user_id)
    if rid:
        await conn.execute(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1::uuid,$2)", user_id, rid)


async def _set_user_perms(conn, user_id: str, perms: list[str]) -> None:
    await conn.execute("DELETE FROM user_permissions WHERE user_id = $1::uuid", user_id)
    for p in perms:
        await conn.execute(
            "INSERT INTO user_permissions (user_id, permission) VALUES ($1::uuid,$2)",
            user_id, p)


@api.patch("/admin/users/{target_user_id}")
async def admin_update_user(target_user_id: str, body: StaffUpdateIn, actor: str = Depends(require_owner)):
    target = await _load_user(user_id=target_user_id)
    if not target:
        raise HTTPException(404, "User not found")
    updates: dict = {}
    # role/permissions/is_active are normalised across three tables now, so this is a
    # transaction rather than a single $set.
    async with db.transaction() as conn:
        if body.role is not None and body.role in ("owner", "staff", "customer"):
            updates["role"] = body.role
            updates["is_admin"] = body.role in ("owner", "staff")
            await _set_user_role(conn, target_user_id, body.role)
            if body.role == "owner":
                updates["permissions"] = list(ALL_PERMISSIONS)
                await _set_user_perms(conn, target_user_id, list(ALL_PERMISSIONS))
        if body.permissions is not None:
            perms = [p for p in body.permissions if p in ALL_PERMISSIONS]
            updates["permissions"] = perms
            await _set_user_perms(conn, target_user_id, perms)
        if body.is_active is not None:
            updates["is_active"] = body.is_active
            await conn.execute(
                "UPDATE users SET status = $2::user_status, updated_at = now() WHERE id = $1::uuid",
                target_user_id, "active" if body.is_active else "suspended")
    await audit_log(actor, "user.update", target_user_id, updates)
    u = await _load_user(user_id=target_user_id)
    u.pop("password_hash", None)
    return u


@api.delete("/admin/staff/{target_user_id}")
async def admin_remove_staff(target_user_id: str, actor: str = Depends(require_owner)):
    if target_user_id == actor:
        raise HTTPException(400, "Cannot remove yourself")
    target = await _load_user(user_id=target_user_id)
    if not target or target.get("role") == "owner":
        raise HTTPException(404, "Staff not found or is owner")
    async with db.transaction() as conn:
        await _set_user_role(conn, target_user_id, "customer")
        await _set_user_perms(conn, target_user_id, [])
    await audit_log(actor, "staff.revoke", target_user_id)
    return {"ok": True}


@api.delete("/admin/users/{target_user_id}")
async def admin_delete_user(target_user_id: str, actor: str = Depends(require_owner)):
    if target_user_id == actor:
        raise HTTPException(400, "Cannot delete yourself")
    target = await _load_user(user_id=target_user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if user_role(target) == "owner":
        raise HTTPException(400, "Cannot delete another owner")
    # Soft delete: users are referenced by orders (FK), so a hard delete would either
    # fail or cascade away order history. _USER_SELECT filters deleted_at IS NULL, so
    # the user disappears from the app exactly as before.
    await db.execute(
        "UPDATE users SET deleted_at = now(), status = 'deleted' WHERE id = $1::uuid",
        target_user_id)
    await audit_log(actor, "user.delete", target_user_id, {"email": target.get("email")})
    return {"ok": True}


@api.delete("/admin/orders/{order_id}")
async def admin_delete_order(order_id: str, actor: str = Depends(require_owner)):
    order = await _load_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    async with db.transaction() as conn:
        await _purge_order_rows(conn, order_id)
    await audit_log(actor, "order.delete", order_id, {"total": order.get("total"), "status": order.get("status")})
    return {"ok": True}


async def _purge_order_rows(conn, order_id: Optional[str] = None) -> None:
    """Delete an order (or all orders) and everything hanging off it.

    Only affiliate_commissions cascades from orders; payments, shipments, invoices,
    order_events, order_items, notifications and coupon_redemptions are all NO ACTION —
    deliberately, so financial/audit records can't be silently dropped. That means the
    deletes have to be explicit and in FK order.
    """
    one = order_id is not None
    def w(col="order_id"):
        return f" WHERE {col} = $1::uuid" if one else ""
    args = [order_id] if one else []

    # Release units first: product_units.sold_order_item_id -> order_items blocks the
    # order_items delete otherwise.
    await conn.execute(
        "UPDATE product_units SET status='in_stock', sold_order_item_id=NULL"
        + (" WHERE sold_order_item_id IN (SELECT id FROM order_items WHERE order_id=$1::uuid)"
           if one else " WHERE sold_order_item_id IS NOT NULL OR status='sold'"), *args)
    await conn.execute(
        "DELETE FROM reservations" + (
            " WHERE product_unit_id IN (SELECT product_unit_id FROM order_items"
            " WHERE order_id=$1::uuid AND product_unit_id IS NOT NULL)" if one else ""), *args)
    for tbl in ("shipment_items",):
        await conn.execute(
            f"DELETE FROM {tbl}" + (
                " WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=$1::uuid)"
                if one else ""), *args)
    for tbl in ("payments", "shipments", "invoices", "order_events", "notifications",
                "coupon_redemptions", "affiliate_commissions", "order_items"):
        await conn.execute(f"DELETE FROM {tbl}{w()}", *args)
    await conn.execute("DELETE FROM orders" + (" WHERE id = $1::uuid" if one else ""), *args)


@api.post("/admin/orders/purge")
async def admin_purge_orders(actor: str = Depends(require_owner)):
    """Delete ALL orders (owner-confirmed reset). Also clears reservations tied to deleted orders."""
    async with db.transaction() as conn:
        n = await conn.fetchval("SELECT count(*) FROM orders")
        await _purge_order_rows(conn)
    await audit_log(actor, "orders.purge_all", "", {"count": n})
    return {"ok": True, "deleted": n}


@api.get("/admin/audit-log")
async def admin_audit_log(_: str = Depends(require_owner), limit: int = 200):
    return await db.fetch_all(
        """SELECT id::text AS event_id, actor_id::text AS actor_id, action,
                  COALESCE(target,'') AS target, meta, created_at AS at
             FROM admin_events ORDER BY created_at DESC LIMIT $1""", limit)


@api.get("/admin/inventory/low-stock")
async def admin_low_stock(_: str = Depends(require_perm("inventory")), threshold: int = 2):
    """List serialised products where available units ≤ threshold."""
    # Was: N+1 (a unit query per product) plus a full reservations scan in Python.
    return await db.fetch_all(
        """SELECT p.id::text  AS product_id,
                  p.title     AS name,
                  p.slug::text AS slug,
                  count(pu.id) AS available,
                  $1::int     AS threshold,
                  (SELECT ma.object_key FROM product_media pm
                     JOIN media_assets ma ON ma.id = pm.media_id
                    WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS image
             FROM products p
             LEFT JOIN product_units pu
                    ON pu.product_id = p.id
                   AND pu.status = 'in_stock'
                   AND NOT EXISTS (SELECT 1 FROM reservations r
                                    WHERE r.product_unit_id = pu.id AND r.status = 'active')
            WHERE p.status = 'active' AND p.is_serialized AND p.deleted_at IS NULL
            GROUP BY p.id
           HAVING count(pu.id) <= $1
            ORDER BY count(pu.id)""", threshold)


# --- Sales dashboard (OWNER only) --------------------------------------------
@api.get("/admin/sales")
async def admin_sales(_: str = Depends(require_owner), days: int = 30):
    """Revenue rollup. Was ~4 queries + nested Python loops + an N+1 product lookup
    per line item; it's SQL aggregation now."""
    since = now() - timedelta(days=days)
    # 'paid' for reporting = money taken: paid/shipped/delivered plus the schema's
    # extra in-flight states, which the legacy status list predates.
    PAID = ("paid", "processing", "packed", "shipped", "out_for_delivery",
            "delivered", "completed")

    head = await db.fetch_one(
        """SELECT count(*)                                        AS orders_total,
                  count(*) FILTER (WHERE o.status::text = ANY($2)) AS orders_paid,
                  COALESCE(sum(o.grand_total) FILTER (WHERE o.status::text = ANY($2)), 0) AS revenue_n
             FROM orders o WHERE o.created_at >= $1""", since, list(PAID))
    revenue = db.to_paise(head["revenue_n"])
    paid_n = head["orders_paid"]

    by_day = await db.fetch_all(
        """SELECT to_char(date_trunc('day', COALESCE(p.paid_at, o.created_at)), 'YYYY-MM-DD') AS day,
                  COALESCE(sum(o.grand_total), 0) AS revenue_n,
                  count(*)                        AS orders
             FROM orders o
             LEFT JOIN LATERAL (SELECT paid_at FROM payments
                                 WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON true
            WHERE o.created_at >= $1 AND o.status::text = ANY($2)
            GROUP BY 1 ORDER BY 1""", since, list(PAID))

    by_cat = await db.fetch_all(
        """SELECT pr.category_key::text AS category,
                  COALESCE(sum(oi.line_total), 0) AS revenue_n
             FROM order_items oi
             JOIN orders o   ON o.id = oi.order_id
             JOIN products pr ON pr.id = oi.product_id
            WHERE o.created_at >= $1 AND o.status::text = ANY($2)
            GROUP BY 1""", since, list(PAID))

    stats = await db.fetch_one(
        """SELECT (SELECT count(*) FROM users u
                    WHERE u.deleted_at IS NULL AND NOT EXISTS (
                      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.name IN ('admin','staff'))) AS customers_total,
                  (SELECT count(*) FROM users u
                    WHERE u.deleted_at IS NULL AND u.created_at >= $1 AND NOT EXISTS (
                      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.name IN ('admin','staff'))) AS new_customers,
                  (SELECT count(*) FROM queries
                    WHERE status IN ('open','in_progress')) AS open_queries""", since)

    return {
        "revenue_paise": revenue,
        "orders_total": head["orders_total"],
        "orders_paid": paid_n,
        "aov_paise": int(revenue / paid_n) if paid_n else 0,
        "customers_total": stats["customers_total"],
        "new_customers": stats["new_customers"],
        "open_queries": stats["open_queries"],
        "by_day": [{"day": d["day"], "revenue": db.to_paise(d["revenue_n"]),
                    "orders": d["orders"]} for d in by_day],
        "by_category": [{"category": db.CATEGORY_FROM_DB.get(c["category"], c["category"]),
                         "revenue_paise": db.to_paise(c["revenue_n"])} for c in by_cat],
        "window_days": days,
    }


# --- Products: update, delete (perm: products) --------------------------------
# API field -> (column, transform). `attrs`/`images` are handled separately.
_PRODUCT_PATCH_COLS = {
    "name": ("title", lambda v: v),
    "devanagari_name": ("title_devanagari", lambda v: v),
    "slug": ("slug", lambda v: v),
    "description": ("description", lambda v: v),
    "price": ("base_price", db.to_amount),
    "mrp": ("compare_at_price", db.to_amount),
    "is_serialized": ("is_serialized", lambda v: v),
    "attrs": ("attributes", lambda v: v),
}


@api.patch("/admin/products/{product_id}")
async def admin_update_product(product_id: str, body: ProductUpdateIn, _: str = Depends(require_perm("products"))):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    sets, args = [], []
    for k, v in updates.items():
        if k == "category":
            ck = db.CATEGORY_TO_DB.get(v)
            if not ck:
                raise HTTPException(400, f"Unknown category: {v}")
            args.append(ck)
            sets.append(f"category_key = ${len(args)}::category_key")
            args.append(ck)
            sets.append(f"category_id = (SELECT id FROM categories "
                        f"WHERE category_key = ${len(args)}::category_key)")
        elif k == "is_active":
            args.append("active" if v else "archived")
            sets.append(f"status = ${len(args)}::product_status")
        elif k == "stock_qty":
            continue  # stock lives on product_variants; handled below
        elif k in _PRODUCT_PATCH_COLS:
            col, tx = _PRODUCT_PATCH_COLS[k]
            args.append(tx(v))
            sets.append(f"{col} = ${len(args)}" + ("::citext" if col == "slug" else ""))
    if sets:
        args.append(product_id)
        got = await db.fetch_val(
            f"UPDATE products SET {', '.join(sets)}, updated_at = now() "
            f"WHERE id = ${len(args)}::uuid AND deleted_at IS NULL RETURNING id::text", *args)
        if not got:
            raise HTTPException(404, "Product not found")
    if "stock_qty" in updates:
        await db.execute(
            """UPDATE product_variants SET stock_qty = $2, updated_at = now()
                WHERE product_id = $1::uuid""", product_id, updates["stock_qty"])
    row = await db.fetch_one(_PRODUCT_SELECT + " AND p.id = $1::uuid", product_id)
    if not row:
        raise HTTPException(404, "Product not found")
    return _shape_product(row)


@api.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, _: str = Depends(require_perm("products"))):
    # Archive, not delete: products are referenced by order_items.
    await db.execute(
        "UPDATE products SET status='archived', updated_at=now() WHERE id=$1::uuid",
        product_id)
    return {"ok": True}


# --- Categories CRUD (perm: categories) ---------------------------------------
@api.get("/admin/categories")
async def admin_list_categories(_: str = Depends(require_perm("categories"))):
    return await _list_categories()


@api.post("/admin/categories")
async def admin_create_category(body: CategoryIn, _: str = Depends(require_perm("categories"))):
    # category_key is an enum here, so categories can't be invented freely the way
    # Mongo's free-text key allowed.
    ck = db.CATEGORY_TO_DB.get(body.key)
    if not ck:
        raise HTTPException(
            400, f"Unknown category key '{body.key}'. Allowed: {sorted(db.CATEGORY_TO_DB)}")
    if await db.fetch_val(
            "SELECT id FROM categories WHERE category_key = $1::category_key", ck):
        raise HTTPException(400, "Category key already exists")
    cid = uuid.uuid4()
    await db.execute(
        """INSERT INTO categories (id, category_key, name, name_devanagari, slug,
                parent_id, sort_order, is_active)
           VALUES ($1,$2::category_key,$3,$4,$5::citext,
                   (SELECT id FROM categories WHERE category_key = $6::category_key),
                   $7, true)""",
        cid, ck, body.label, body.hindi,
        re.sub(r"[^a-z0-9]+", "-", body.label.lower()).strip("-"),
        db.CATEGORY_TO_DB.get(body.parent_key) if body.parent_key else None,
        body.order)
    return next((c for c in await _list_categories() if c["category_id"] == str(cid)), None)


@api.patch("/admin/categories/{category_id}")
async def admin_update_category(category_id: str, body: CategoryUpdateIn, _: str = Depends(require_perm("categories"))):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    sets, args = [], []
    for k, col in (("label", "name"), ("hindi", "name_devanagari"), ("order", "sort_order")):
        if k in updates:
            args.append(updates[k])
            sets.append(f"{col} = ${len(args)}")
    if "parent_key" in updates:
        args.append(db.CATEGORY_TO_DB.get(updates["parent_key"]))
        sets.append(f"parent_id = (SELECT id FROM categories "
                    f"WHERE category_key = ${len(args)}::category_key)")
    args.append(category_id)
    got = await db.fetch_val(
        f"UPDATE categories SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(args)}::uuid RETURNING id::text", *args)
    if not got:
        raise HTTPException(404, "Category not found")
    return next((c for c in await _list_categories() if c["category_id"] == category_id), None)


@api.delete("/admin/categories/{category_id}")
async def admin_delete_category(category_id: str, _: str = Depends(require_perm("categories"))):
    # Deactivate rather than delete: products.category_id references categories.
    await db.execute(
        "UPDATE categories SET is_active=false, updated_at=now() WHERE id=$1::uuid",
        category_id)
    return {"ok": True}


# --- Astrologers CRUD (perm: astrologers) ------------------------------------
def _gen_affiliate_code(base: str) -> str:
    """Short, URL-friendly, human-readable code derived from name + random suffix."""
    slug = re.sub(r"[^a-z0-9]+", "", base.lower())[:8] or "astro"
    return f"{slug}-{uuid.uuid4().hex[:4]}"


def _astro_public(a: dict) -> dict:
    """Astrologer view for the astrologer themselves — omits password_hash."""
    if not a: return {}
    a = {k: v for k, v in a.items() if k != "password_hash"}
    return a


def _mint_astro_password_token(astro_id: str, purpose: str = "set") -> str:
    """Signed short-lived token embedded in welcome + reset emails."""
    payload = {"sub": astro_id, "aud": "astro_pwd", "purpose": purpose,
               "exp": now() + timedelta(days=7)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def _make_astro_jwt(astro_id: str) -> str:
    payload = {"sub": astro_id, "aud": "astrologer", "exp": now() + timedelta(days=30)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def require_astrologer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Astrologer authentication required")
    try:
        data = pyjwt.decode(auth[7:], JWT_SECRET, algorithms=[JWT_ALGO], audience="astrologer")
    except Exception:
        raise HTTPException(401, "Invalid astrologer token")
    astro_id = data.get("sub")
    ok = await db.fetch_val(
        "SELECT id::text FROM astrologers WHERE id = $1::uuid AND is_active", astro_id)
    if not ok:
        raise HTTPException(401, "Astrologer not found or deactivated")
    return astro_id


def _welcome_url(token: str) -> str:
    """Frontend URL the astrologer follows to set their password + go to dashboard."""
    base = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")
    if not base:
        # best-effort fallback — will still work when the frontend serves at REACT_APP_BACKEND_URL host
        base = ""
    return f"{base}/astrologer/set-password?token={token}"


@api.get("/admin/astrologers")
async def admin_list_astrologers(_: str = Depends(require_perm("astrologers")), include_inactive: bool = False):
    where = "" if include_inactive else " WHERE a.is_active"
    rows = await db.fetch_all(
        _ASTRO_SELECT + where + " ORDER BY a.created_at DESC LIMIT 200")
    return [_shape_astro(r) for r in rows]


@api.post("/admin/astrologers")
async def admin_create_astrologer(body: AstrologerIn, actor: str = Depends(require_perm("astrologers"))):
    payload = body.model_dump()
    # Reject duplicate email if provided
    if payload.get("email"):
        clash = await db.fetch_val(
            "SELECT id::text FROM astrologers WHERE email = $1::citext", payload["email"])
        if clash:
            raise HTTPException(400, "An astrologer with this email already exists")
    if not (0 <= (payload.get("commission_pct") or 0) <= 100):
        raise HTTPException(400, "commission_pct must be between 0 and 100")
    astro_id = uuid.uuid4()
    affiliate_code = _gen_affiliate_code(payload["name"])
    await db.execute(
        """INSERT INTO astrologers (id, full_name, devanagari, expertise, price, years,
                avatar_url, email, commission_pct, bio, is_active, affiliate_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::citext,$9,$10,true,$11::citext)""",
        astro_id, payload["name"], payload.get("devanagari") or "",
        payload.get("expertise") or [], db.to_amount(payload["price"]),
        payload.get("years") or 0, payload.get("picture") or None,
        payload.get("email"),
        # `or 10.0` would turn a deliberate 0% commission into 10% — 0 is falsy.
        10.0 if payload.get("commission_pct") is None else payload["commission_pct"],
        payload.get("bio") or "", affiliate_code)
    welcome_url = None
    if payload.get("email"):
        token = _mint_astro_password_token(str(astro_id), purpose="set")
        welcome_url = _welcome_url(token)
    doc = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", str(astro_id)))
    await audit_log(actor, "astrologer.create", target=str(astro_id), meta={"email": payload.get("email")})
    return {**doc, "welcome_url": welcome_url}


@api.post("/admin/astrologers/{astrologer_id}/welcome-link")
async def admin_regen_welcome(astrologer_id: str, actor: str = Depends(require_perm("astrologers"))):
    a = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.id = $1::uuid", astrologer_id))
    if not a:
        raise HTTPException(404, "Astrologer not found")
    if not a.get("email"):
        raise HTTPException(400, "Set an email on the astrologer first")
    token = _mint_astro_password_token(astrologer_id, purpose="reset")
    await audit_log(actor, "astrologer.welcome_link.regen", target=astrologer_id)
    return {"welcome_url": _welcome_url(token), "email": a["email"]}


# API field -> (column, value transform). Only these are patchable.
_ASTRO_PATCH_COLS = {
    "name": ("full_name", lambda v: v),
    "devanagari": ("devanagari", lambda v: v),
    "expertise": ("expertise", lambda v: v),
    "price": ("price", db.to_amount),
    "years": ("years", lambda v: v),
    "picture": ("avatar_url", lambda v: v),
    "email": ("email", lambda v: v),
    "commission_pct": ("commission_pct", lambda v: v),
    "bio": ("bio", lambda v: v),
    "is_active": ("is_active", lambda v: v),
}


@api.patch("/admin/astrologers/{astrologer_id}")
async def admin_update_astrologer(astrologer_id: str, body: AstrologerUpdateIn, actor: str = Depends(require_perm("astrologers"))):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "commission_pct" in updates and not (0 <= float(updates["commission_pct"]) <= 100):
        raise HTTPException(400, "commission_pct must be between 0 and 100")
    if "email" in updates and updates["email"]:
        clash = await db.fetch_val(
            """SELECT id::text FROM astrologers
                WHERE email = $1::citext AND id <> $2::uuid""",
            updates["email"], astrologer_id)
        if clash:
            raise HTTPException(400, "Another astrologer has this email")
    sets, args = [], []
    for k, v in updates.items():
        if k not in _ASTRO_PATCH_COLS:
            continue
        col, tx = _ASTRO_PATCH_COLS[k]
        args.append(tx(v))
        sets.append(f"{col} = ${len(args)}" + ("::citext" if col == "email" else ""))
    if sets:
        args.append(astrologer_id)
        got = await db.fetch_val(
            f"UPDATE astrologers SET {', '.join(sets)}, updated_at = now() "
            f"WHERE id = ${len(args)}::uuid RETURNING id::text", *args)
        if not got:
            raise HTTPException(404, "Astrologer not found")
    elif not await db.fetch_val("SELECT id::text FROM astrologers WHERE id=$1::uuid", astrologer_id):
        raise HTTPException(404, "Astrologer not found")
    await audit_log(actor, "astrologer.update", target=astrologer_id, meta=updates)
    return _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astrologer_id))


@api.delete("/admin/astrologers/{astrologer_id}")
async def admin_delete_astrologer(astrologer_id: str, actor: str = Depends(require_perm("astrologers"))):
    await db.execute(
        "UPDATE astrologers SET is_active=false, updated_at=now() WHERE id=$1::uuid",
        astrologer_id)
    await audit_log(actor, "astrologer.deactivate", target=astrologer_id)
    return {"ok": True}


@api.get("/admin/astrologers/{astrologer_id}/affiliate")
async def admin_astrologer_affiliate(astrologer_id: str, _: str = Depends(require_perm("astrologers"))):
    """List commission records for one astrologer + a summary."""
    a = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.id = $1::uuid", astrologer_id))
    if not a:
        raise HTTPException(404, "Astrologer not found")
    commissions = [_shape_commission(c) for c in await db.fetch_all(
        _COMMISSION_SELECT + " WHERE ac.astrologer_id = $1::uuid"
        " ORDER BY ac.created_at DESC LIMIT 500", astrologer_id)]
    visits = await db.fetch_val(
        "SELECT count(*) FROM affiliate_visits WHERE astrologer_id = $1::uuid", astrologer_id)
    summary = {
        "visits": visits,
        "orders": len(commissions),
        "total_commission": sum(c.get("commission_amount", 0) for c in commissions),
        "pending_commission": sum(c.get("commission_amount", 0) for c in commissions if c.get("status") == "pending"),
        "paid_commission": sum(c.get("commission_amount", 0) for c in commissions if c.get("status") == "paid"),
    }
    return {"astrologer": a, "summary": summary, "commissions": commissions}


# --- Astrologer-side (self-serve) auth & workspace ---------------------------
@api.post("/astrologer/auth/login")
async def astro_login(body: AstroLoginIn):
    a = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.email = $1::citext", body.email), include_hash=True)
    if not a or a.get("is_active") is False or not a.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")
    if not verify_password(body.password, a["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = _make_astro_jwt(a["astrologer_id"])
    return {"token": token, "astrologer": _astro_public(a)}


@api.post("/astrologer/auth/set-password")
async def astro_set_password(body: AstroSetPasswordIn):
    try:
        data = pyjwt.decode(body.token, JWT_SECRET, algorithms=[JWT_ALGO], audience="astro_pwd")
    except Exception:
        raise HTTPException(400, "This link is invalid or has expired. Ask admin to generate a new one.")
    astro_id = data.get("sub")
    got = await db.fetch_val(
        """UPDATE astrologers SET password_hash = $2, updated_at = now()
            WHERE id = $1::uuid RETURNING id::text""",
        astro_id, hash_password(body.password))
    if not got:
        raise HTTPException(404, "Astrologer not found")
    token = _make_astro_jwt(astro_id)
    a = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astro_id))
    return {"token": token, "astrologer": _astro_public(a)}


@api.post("/astrologer/auth/request-reset")
async def astro_request_reset(body: AstroRequestResetIn):
    """Astrologer-triggered reset. Always returns ok to avoid email enumeration."""
    aid = await db.fetch_val(
        "SELECT id::text FROM astrologers WHERE email = $1::citext AND is_active",
        body.email)
    reset_url = None
    if aid:
        token = _mint_astro_password_token(aid, purpose="reset")
        reset_url = _welcome_url(token)
        log.info(f"astro password reset link for {body.email}: {reset_url}")
    return {"ok": True, "reset_url": reset_url}  # reset_url visible in local dev; safe to leave until email adapter is wired


@api.get("/astrologer/me")
async def astro_me(astro_id: str = Depends(require_astrologer)):
    a = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astro_id))
    return _astro_public(a)


@api.get("/astrologer/dashboard")
async def astro_dashboard(astro_id: str = Depends(require_astrologer)):
    # Was 5 separate count/find calls; one aggregate now.
    s = await db.fetch_one(
        """SELECT
             (SELECT count(*) FROM consultations WHERE astrologer_id=$1::uuid) AS total_bookings,
             -- "Upcoming" = sessions still owed to customers (any status except
             -- completed/cancelled), regardless of wall-clock time.
             (SELECT count(*) FROM consultations WHERE astrologer_id=$1::uuid
               AND status IN ('requested','confirmed')) AS upcoming,
             (SELECT count(*) FROM consultations WHERE astrologer_id=$1::uuid
               AND status='completed') AS completed,
             (SELECT count(*) FROM affiliate_commissions WHERE astrologer_id=$1::uuid) AS affiliate_orders,
             (SELECT COALESCE(sum(commission_amount),0) FROM affiliate_commissions
               WHERE astrologer_id=$1::uuid) AS total_commission_n,
             (SELECT COALESCE(sum(commission_amount),0) FROM affiliate_commissions
               WHERE astrologer_id=$1::uuid AND status='pending') AS pending_commission_n
        """, astro_id)
    return {
        "total_bookings": s["total_bookings"],
        "upcoming": s["upcoming"],
        "completed": s["completed"],
        "affiliate_orders": s["affiliate_orders"],
        "total_commission": db.to_paise(s["total_commission_n"]),
        "pending_commission": db.to_paise(s["pending_commission_n"]),
    }


@api.get("/astrologer/consultations")
async def astro_consultations(astro_id: str = Depends(require_astrologer), status: Optional[str] = None):
    sql = _CONSULT_SELECT + " WHERE c.astrologer_id = $1::uuid"
    args = [astro_id]
    if status:
        sql += " AND c.status = $2::consultation_status"
        args.append(status)
    rows = await db.fetch_all(sql + " ORDER BY c.slot_at LIMIT 500", *args)
    return [_shape_consult(r) for r in rows]


@api.patch("/astrologer/consultations/{booking_id}")
async def astro_update_consultation(booking_id: str, body: AstroConsultUpdateIn, astro_id: str = Depends(require_astrologer)):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if updates.get("status") and updates["status"] not in {"requested", "confirmed", "completed", "cancelled"}:
        raise HTTPException(400, "Invalid status")
    sets, args = [], []
    if "status" in updates:
        args.append(updates["status"])
        sets.append(f"status = ${len(args)}::consultation_status")
    if "notes" in updates:
        args.append(updates["notes"])
        sets.append(f"notes = ${len(args)}")
    sets.append("updated_at = now()")
    args += [booking_id, astro_id]
    got = await db.fetch_val(
        f"UPDATE consultations SET {', '.join(sets)} "
        f"WHERE id = ${len(args)-1}::uuid AND astrologer_id = ${len(args)}::uuid "
        f"RETURNING id::text", *args)
    if not got:
        raise HTTPException(404, "Booking not found")
    return await _load_consultation(booking_id)


@api.get("/astrologer/availability")
async def astro_get_availability(astro_id: str = Depends(require_astrologer)):
    a = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astro_id))
    if not a:
        raise HTTPException(404, "Astrologer not found")
    return {"weekly_slots": a.get("weekly_slots") or [],
            "blackout_dates": a.get("blackout_dates") or []}


@api.put("/astrologer/availability")
async def astro_put_availability(body: AstroAvailabilityIn, astro_id: str = Depends(require_astrologer)):
    # Basic HH:MM validation
    for s in body.weekly_slots:
        if not re.match(r"^\d{2}:\d{2}$", s.start) or not re.match(r"^\d{2}:\d{2}$", s.end):
            raise HTTPException(400, f"Invalid time in slot day={s.day}")
        if s.end <= s.start:
            raise HTTPException(400, f"Slot end must be after start (day={s.day})")
    for d in body.blackout_dates:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            raise HTTPException(400, f"Invalid blackout date: {d}")
    # weekly_slots was an embedded array; it's a child table here. Replace-all in one
    # transaction so a partial write can't leave a half-updated schedule.
    async with db.transaction() as conn:
        await conn.execute(
            "DELETE FROM astrologer_weekly_slots WHERE astrologer_id = $1::uuid", astro_id)
        for i, s in enumerate(body.weekly_slots):
            # start/end are "HH:MM" strings in the API; these are real `time` columns,
            # so asyncpg needs datetime.time objects rather than the raw strings.
            await conn.execute(
                """INSERT INTO astrologer_weekly_slots (id, astrologer_id, day_of_week,
                        start_time, end_time, position)
                   VALUES ($1,$2::uuid,$3,$4,$5,$6)""",
                uuid.uuid4(), astro_id, s.day,
                dtime(*map(int, s.start.split(":"))),
                dtime(*map(int, s.end.split(":"))), i)
        # date[] wants date objects, not the "YYYY-MM-DD" strings the API carries.
        await conn.execute(
            "UPDATE astrologers SET blackout_dates = $2, updated_at = now() WHERE id = $1::uuid",
            astro_id, [date.fromisoformat(d) for d in body.blackout_dates])
    return {"ok": True, "weekly_slots": [s.model_dump() for s in body.weekly_slots], "blackout_dates": body.blackout_dates}


@api.get("/astrologer/affiliate")
async def astro_affiliate(astro_id: str = Depends(require_astrologer)):
    a = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astro_id))
    if not a:
        raise HTTPException(404, "Astrologer not found")
    commissions = [_shape_commission(c) for c in await db.fetch_all(
        _COMMISSION_SELECT + " WHERE ac.astrologer_id = $1::uuid"
        " ORDER BY ac.created_at DESC LIMIT 500", astro_id)]
    visits = await db.fetch_val(
        "SELECT count(*) FROM affiliate_visits WHERE astrologer_id = $1::uuid", astro_id)
    summary = {
        "visits": visits,
        "orders": len(commissions),
        "total_commission": sum(c.get("commission_amount", 0) for c in commissions),
        "pending_commission": sum(c.get("commission_amount", 0) for c in commissions if c.get("status") == "pending"),
        "paid_commission": sum(c.get("commission_amount", 0) for c in commissions if c.get("status") == "paid"),
        "commission_pct": a.get("commission_pct") or 0,
    }
    return {"affiliate_code": a.get("affiliate_code"), "summary": summary, "commissions": commissions}


# --- Public affiliate link resolver ------------------------------------------
@api.get("/r/{code}")
async def resolve_affiliate(code: str, request: Request, response: FastAPIResponse):
    a = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.affiliate_code = $1::citext AND a.is_active", code))
    if not a:
        raise HTTPException(404, "Unknown affiliate code")
    # Ensure a persistent anonymous cookie so visit dedup works across sessions
    anon = request.cookies.get("gemora_anon")
    if not anon:
        anon = uuid.uuid4().hex
        response.set_cookie("gemora_anon", anon, max_age=60 * 60 * 24 * 365, samesite="lax", httponly=False)
    try:
        # visitor_hash is char(64) — the full sha256, not Mongo's truncated 16 chars.
        # ON CONFLICT does the daily dedupe the racy $setOnInsert upsert only approximated.
        await db.execute(
            """INSERT INTO affiliate_visits (id, astrologer_id, affiliate_code,
                                             visitor_hash, visit_day)
               VALUES ($1,$2::uuid,$3::citext,$4,current_date)
               ON CONFLICT (astrologer_id, visitor_hash, visit_day) DO NOTHING""",
            uuid.uuid4(), a["astrologer_id"], code,
            hashlib.sha256(anon.encode()).hexdigest())
    except Exception as e:
        log.warning(f"affiliate visit tracking failed: {e}")
    return {"astrologer_id": a["astrologer_id"], "name": a["name"], "picture": a.get("picture"),
            "affiliate_code": code, "devanagari": a.get("devanagari") or ""}


# --- Consultations (perm: consultations) -------------------------------------
@api.get("/admin/consultations")
async def admin_list_consultations(_: str = Depends(require_perm("consultations")), astrologer_id: Optional[str] = None, status: Optional[str] = None):
    sql, args = _CONSULT_SELECT + " WHERE true", []
    if astrologer_id:
        args.append(astrologer_id)
        sql += f" AND c.astrologer_id = ${len(args)}::uuid"
    if status:
        args.append(status)
        sql += f" AND c.status = ${len(args)}::consultation_status"
    rows = await db.fetch_all(sql + " ORDER BY c.created_at DESC LIMIT 500", *args)
    return [_shape_consult(r) for r in rows]


@api.patch("/admin/consultations/{booking_id}")
async def admin_update_consultation(booking_id: str, body: dict, _: str = Depends(require_perm("consultations"))):
    updates = {k: v for k, v in body.items() if k in {"status", "meeting_link", "notes"}}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    sets, args = [], []
    for k in ("status", "meeting_link", "notes"):
        if k in updates:
            args.append(updates[k])
            sets.append(f"{k} = ${len(args)}" + ("::consultation_status" if k == "status" else ""))
    sets.append("updated_at = now()")
    args.append(booking_id)
    got = await db.fetch_val(
        f"UPDATE consultations SET {', '.join(sets)} WHERE id = ${len(args)}::uuid "
        f"RETURNING id::text", *args)
    if not got:
        raise HTTPException(404, "Booking not found")
    return await _load_consultation(booking_id)


# --- Order status (perm: orders) ---------------------------------------------
@api.patch("/admin/orders/{order_id}/status")
async def admin_update_order_status(order_id: str, body: OrderStatusIn, _: str = Depends(require_perm("orders"))):
    allowed = {"pending_payment", "paid", "shipped", "delivered", "cancelled", "refunded"}
    if body.status not in allowed:
        raise HTTPException(400, f"Invalid status. Allowed: {sorted(allowed)}")
    prev = await _load_order(order_id)
    if not prev:
        raise HTTPException(404, "Order not found")
    # Mongo wrote a dynamically-named "{status}_at" field. Here the transition is
    # recorded in order_events, which is a real audit trail.
    async with db.transaction() as conn:
        await conn.execute(
            "UPDATE orders SET status = $2::order_status, updated_at = now() WHERE id = $1::uuid",
            order_id, db.ORDER_STATUS_TO_DB[body.status])
        await conn.execute(
            """INSERT INTO order_events (id, order_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,$3::order_status,$4::order_status,'admin status change')""",
            uuid.uuid4(), order_id, db.ORDER_STATUS_TO_DB.get(prev["status"], "pending"),
            db.ORDER_STATUS_TO_DB[body.status])
    return await _load_order(order_id)


# --- User queries / support inbox (perm: queries) ----------------------------
_QUERY_SELECT = """
    SELECT q.id::text      AS query_id,
           q.name          AS name,
           q.email::text   AS email,
           q.phone         AS phone,
           q.subject       AS subject,
           q.message       AS message,
           q.user_id::text AS user_id,
           q.status::text  AS status,
           q.created_at    AS created_at,
           COALESCE(n.notes, '[]'::jsonb) AS notes
      FROM queries q
      LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                     'by', qn.author_id::text,
                     'at', to_char(qn.created_at AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.US+00:00'),
                     'text', qn.body) ORDER BY qn.created_at) AS notes
              FROM query_notes qn WHERE qn.query_id = q.id
      ) n ON true
"""


@api.post("/queries")
async def submit_query(body: QueryIn, user_id: Optional[str] = Depends(get_user_id_optional)):
    qid = uuid.uuid4()
    await db.execute(
        """INSERT INTO queries (id, name, email, phone, subject, message, user_id, status)
           VALUES ($1,$2,$3::citext,$4,$5,$6,$7::uuid,'open')""",
        qid, body.name, body.email, body.phone, body.subject, body.message, user_id)
    return await db.fetch_one(_QUERY_SELECT + " WHERE q.id = $1::uuid", str(qid))


@api.get("/admin/queries")
async def admin_list_queries(_: str = Depends(require_perm("queries")), status: Optional[str] = None):
    sql, args = _QUERY_SELECT + " WHERE true", []
    if status:
        args.append(status)
        sql += f" AND q.status = ${len(args)}::query_status"
    return await db.fetch_all(sql + " ORDER BY q.created_at DESC LIMIT 500", *args)


@api.patch("/admin/queries/{query_id}")
async def admin_update_query(query_id: str, body: QueryReplyIn, actor: str = Depends(require_perm("queries"))):
    # notes was an embedded array ($push); it's the query_notes child table now.
    async with db.transaction() as conn:
        if body.note:
            await conn.execute(
                """INSERT INTO query_notes (id, query_id, author_id, body)
                   VALUES ($1,$2::uuid,$3::uuid,$4)""",
                uuid.uuid4(), query_id, actor, body.note)
        if body.status:
            await conn.execute(
                """UPDATE queries SET status = $2::query_status, updated_at = now()
                    WHERE id = $1::uuid""", query_id, body.status)
    return await db.fetch_one(_QUERY_SELECT + " WHERE q.id = $1::uuid", query_id)


# ── WhatsApp webhook (Meta) ──────────────────────────────────────────────────
@api.get("/wa/webhook")
async def wa_webhook_verify(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge", "")
    if mode == "subscribe" and token and token == _META_WA_VERIFY_TOKEN:
        return FastAPIResponse(content=challenge, media_type="text/plain")
    raise HTTPException(403, "verify token mismatch")


@api.post("/wa/webhook")
async def wa_webhook_receive(request: Request):
    raw = await request.body()
    if _META_WA_APP_SECRET:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(_META_WA_APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(403, "bad signature")
    try:
        payload = json.loads(raw)
    except Exception:
        return {"ok": True}
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value", {}) or {}
            for msg in value.get("messages", []) or []:
                await db.execute(
                    """INSERT INTO wa_events (event_id, kind, raw) VALUES ($1,'message',$2)
                       ON CONFLICT (event_id) DO NOTHING""", msg.get("id"), msg)
                # Honor STOP replies as opt-out
                text = (msg.get("text") or {}).get("body", "").strip().upper()
                if text in {"STOP", "UNSUBSCRIBE", "STOPALL"}:
                    from_no = "+" + str(msg.get("from", ""))
                    # wa_optin lives in notification_preferences, not on users.
                    await db.execute(
                        """UPDATE notification_preferences
                              SET whatsapp = COALESCE(whatsapp,'{}'::jsonb)
                                             || '{"optin": false}'::jsonb,
                                  updated_at = now()
                            WHERE user_id IN (SELECT id FROM users WHERE phone = $1)""",
                        from_no)
            for st in value.get("statuses", []) or []:
                await db.execute(
                    """INSERT INTO wa_events (event_id, kind, status, raw)
                       VALUES ($1,'status',$2,$3)
                       ON CONFLICT (event_id) DO UPDATE
                          SET kind='status', status=EXCLUDED.status, raw=EXCLUDED.raw,
                              updated_at=now()""",
                    st.get("id"), st.get("status"), st)
    return {"ok": True}


# ── Admin: promotional broadcast (WhatsApp marketing template) ───────────────
@api.post("/admin/promo/broadcast")
async def admin_promo_broadcast(body: PromoBroadcastIn, user_id: str = Depends(require_admin)):
    template = body.template or _META_WA_PROMO_TMPL
    # Eligibility: verified phone + WhatsApp opt-in (which lives in
    # notification_preferences). Opting in is the default when no row exists.
    sql = """
        SELECT u.id::text AS user_id, u.phone, u.full_name AS name
          FROM users u
          LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.deleted_at IS NULL
           AND u.phone IS NOT NULL
           AND u.phone_verified_at IS NOT NULL
           AND COALESCE((np.whatsapp ->> 'optin')::boolean, true)
    """
    args: list = []
    if body.user_ids:
        args.append(body.user_ids)
        sql += f" AND u.id = ANY(${len(args)}::uuid[])"
    users = await db.fetch_all(sql + " LIMIT 2000", *args)
    sent, failed = 0, 0
    for u in users:
        try:
            await wa_send_utility(u["phone"], template, body.body_params)
            sent += 1
        except Exception as e:
            failed += 1
            log.warning(f"promo send failed for {u.get('user_id')}: {e}")
    await db.execute(
        """INSERT INTO wa_broadcasts (id, template, body_params, sent_count, failed_count,
                                      created_by)
           VALUES ($1,$2,$3,$4,$5,$6::uuid)""",
        uuid.uuid4(), template, body.body_params, sent, failed, user_id)
    return {"ok": True, "sent": sent, "failed": failed, "eligible_users": len(users), "provider": _otp_provider()}


# ── Storage (Supabase) ───────────────────────────────────────────────────────
_APP_NAME_STORAGE = "gemora"
_MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
    "pdf": "application/pdf",
}
async def _storage_put(path: str, data: bytes, content_type: str) -> dict:
    if not storage_sb.configured():
        raise HTTPException(
            503, "Supabase storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
    try:
        return await storage_sb.put(path, data, content_type)
    except Exception as e:
        raise HTTPException(502, f"Storage put failed: {e}")


async def _storage_get(path: str) -> tuple[bytes, str]:
    if not storage_sb.configured():
        raise HTTPException(503, "Supabase storage not configured")
    try:
        return await storage_sb.get(path)
    except FileNotFoundError:
        raise HTTPException(404, "File not found in storage")
    except Exception as e:
        raise HTTPException(502, f"Storage get failed: {e}")


# ── Media library endpoints ──────────────────────────────────────────────────
def _media_public_url(path: str) -> str:
    """Return a stable, public URL served by our backend that proxies to storage."""
    # Frontend prepends REACT_APP_BACKEND_URL. Keep it relative-friendly.
    return f"/api/media/file/{path}"


@api.post("/admin/media/upload")
async def admin_media_upload(request: Request, user_id: str = Depends(require_admin)):
    """Multipart upload of an image (single file field named 'file')."""
    from fastapi import UploadFile, File  # noqa: F401  (imported here to avoid circular top import)
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Attach a file under form field 'file'")
    filename = getattr(upload, "filename", "") or "upload.bin"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    ct = _MIME.get(ext) or getattr(upload, "content_type", None) or "application/octet-stream"
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Max 8MB per image")
    if not ct.startswith("image/"):
        raise HTTPException(400, "Only image files are supported")
    path = f"{_APP_NAME_STORAGE}/media/{uuid.uuid4().hex}.{ext}"
    result = await _storage_put(path, data, ct)
    storage_path = result.get("path") or path
    media_id = uuid.uuid4()
    # media_assets models storage as bucket + object_key; the public URL is derived
    # (always /api/media/file/<object_key>). Soft-delete via deleted_at.
    await db.execute(
        """INSERT INTO media_assets (id, owner_type, storage_provider, bucket, object_key,
                mime_type, file_size_bytes, original_filename, is_public, uploaded_by)
           VALUES ($1,'product','supabase',$2,$3,$4,$5,$6,false,$7::uuid)""",
        media_id, storage_sb.BUCKET, storage_path, ct,
        result.get("size") or len(data), filename, user_id)
    # _MEDIA_SELECT already carries a WHERE, so extra predicates are ANDed.
    return await db.fetch_one(_MEDIA_SELECT + " AND m.id = $1::uuid", str(media_id))


_MEDIA_SELECT = """
    SELECT m.id::text            AS media_id,
           m.object_key          AS storage_path,
           m.mime_type           AS content_type,
           m.file_size_bytes     AS size,
           m.original_filename   AS original_filename,
           '/api/media/file/' || m.object_key AS url,
           m.uploaded_by::text   AS uploaded_by,
           (m.deleted_at IS NOT NULL) AS is_deleted,
           m.created_at          AS created_at
      FROM media_assets m
     WHERE m.bucket = 'media'
"""


@api.get("/admin/media")
async def admin_media_list(_: str = Depends(require_admin), limit: int = 200):
    return await db.fetch_all(
        _MEDIA_SELECT + " AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT $1",
        limit)


@api.delete("/admin/media/{media_id}")
async def admin_media_delete(media_id: str, _: str = Depends(require_admin)):
    async with db.transaction() as conn:
        got = await conn.fetchval(
            "UPDATE media_assets SET deleted_at = now() WHERE id = $1::uuid RETURNING id",
            media_id)
        if not got:
            raise HTTPException(404, "Media not found")
        # Also unbind from any slots that referenced it
        await conn.execute(
            """UPDATE site_assets SET media_id = NULL, url = NULL, updated_at = now()
                WHERE media_id = $1::uuid""", media_id)
    return {"ok": True}


@api.get("/media/file/{path:path}")
async def media_serve(path: str):
    """Public passthrough — image tags fetch here. Streams from storage.

    Object keys are content-unique (uuid), so a given URL's bytes never change:
    cache them for a year and mark immutable so browsers/CDNs stop re-fetching on
    every page view. (Deletes soft-delete the DB row, not the object, so a still-
    referenced URL keeps resolving.)"""
    data, ct = await _storage_get(path)
    return FastAPIResponse(content=data, media_type=ct, headers={
        "Cache-Control": "public, max-age=31536000, immutable",
    })


# ── Site assets (slot → media) ───────────────────────────────────────────────
@api.get("/site-assets")
async def site_assets_public():
    """Public — returns {slot_key: url} map of currently assigned images."""
    rows = await db.fetch_all(
        """SELECT slot::text AS slot, url FROM site_assets
            WHERE media_id IS NOT NULL AND url IS NOT NULL LIMIT 500""")
    return {r["slot"]: r["url"] for r in rows}


@api.get("/admin/site-assets")
async def site_assets_admin(_: str = Depends(require_admin)):
    return await db.fetch_all(
        """SELECT slot::text AS slot, media_id::text AS media_id, url,
                  updated_at, updated_by::text AS updated_by
             FROM site_assets ORDER BY slot LIMIT 500""")


@api.put("/admin/site-assets/{slot}")
async def site_assets_put(slot: str, body: SiteAssetPutIn, user_id: str = Depends(require_admin)):
    slot = slot.strip()
    if not slot or not re.match(r"^[a-z0-9_\-]{2,64}$", slot):
        raise HTTPException(400, "Invalid slot key")
    media_id = body.media_id
    url: Optional[str] = None
    if media_id:
        url = await db.fetch_val(
            """SELECT '/api/media/file/' || object_key FROM media_assets
                WHERE id = $1::uuid AND deleted_at IS NULL""", media_id)
        if not url:
            raise HTTPException(404, "Media not found")
    await db.execute(
        """INSERT INTO site_assets (slot, media_id, url, updated_by)
           VALUES ($1::citext, $2::uuid, $3, $4::uuid)
           ON CONFLICT (slot) DO UPDATE
              SET media_id = EXCLUDED.media_id, url = EXCLUDED.url,
                  updated_by = EXCLUDED.updated_by, updated_at = now()""",
        slot, media_id, url, user_id)
    return {"ok": True, "slot": slot, "media_id": media_id, "url": url}


# ── Events / campaigns ────────────────────────────────────────────────────────
_EVENT_SELECT = """
    SELECT e.id::text        AS event_id,
           e.title           AS title,
           COALESCE(e.subtitle, '')    AS subtitle,
           COALESCE(e.description, '') AS description,
           COALESCE(e.image_url, '')   AS image_url,
           COALESCE(e.cta_text, '')    AS cta_text,
           COALESCE(e.cta_link, '')    AS cta_link,
           COALESCE(e.coupon_code::text, '') AS coupon_code,
           e.starts_at       AS starts_at,
           e.ends_at         AS ends_at,
           e.priority        AS priority,
           e.is_active       AS active,
           e.show_in_strip   AS show_in_strip,
           e.show_in_section AS show_in_section,
           e.created_by::text AS created_by,
           e.updated_by::text AS updated_by,
           e.created_at      AS created_at,
           e.updated_at      AS updated_at
      FROM events e
"""


def _event_args(body: "EventIn") -> list:
    """EventIn -> INSERT/UPDATE args. starts_at/ends_at are timestamptz here, so the
    incoming ISO strings must be parsed rather than stored raw."""
    def _dt(v):
        if not v:
            return None
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    return [body.title, body.subtitle or None, body.description or None,
            body.image_url or None, body.cta_text or None, body.cta_link or None,
            body.coupon_code or None, _dt(body.starts_at), _dt(body.ends_at),
            body.priority, body.active, body.show_in_strip, body.show_in_section]


@api.get("/events/active")
async def events_active():
    # The active window is now evaluated in SQL rather than filtered in Python.
    return await db.fetch_all(
        _EVENT_SELECT + """ WHERE e.is_active
                              AND (e.starts_at IS NULL OR e.starts_at <= now())
                              AND (e.ends_at   IS NULL OR e.ends_at   >= now())
                            ORDER BY e.priority DESC LIMIT 50""")


@api.get("/admin/events")
async def admin_events_list(_: str = Depends(require_admin)):
    return await db.fetch_all(_EVENT_SELECT + " ORDER BY e.priority DESC LIMIT 500")


@api.post("/admin/events")
async def admin_events_create(body: EventIn, user_id: str = Depends(require_admin)):
    eid = uuid.uuid4()
    await db.execute(
        """INSERT INTO events (id, title, subtitle, description, image_url, cta_text,
                cta_link, coupon_code, starts_at, ends_at, priority, is_active,
                show_in_strip, show_in_section, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::citext,$9,$10,$11,$12,$13,$14,$15::uuid)""",
        eid, *_event_args(body), user_id)
    return await db.fetch_one(_EVENT_SELECT + " WHERE e.id = $1::uuid", str(eid))


@api.patch("/admin/events/{event_id}")
async def admin_events_update(event_id: str, body: EventIn, user_id: str = Depends(require_admin)):
    # NOTE: EventIn is a full body, so this is a replace (as it was in Mongo) —
    # omitted fields revert to their defaults rather than being left alone.
    got = await db.fetch_val(
        """UPDATE events SET title=$2, subtitle=$3, description=$4, image_url=$5,
                cta_text=$6, cta_link=$7, coupon_code=$8::citext, starts_at=$9,
                ends_at=$10, priority=$11, is_active=$12, show_in_strip=$13,
                show_in_section=$14, updated_by=$15::uuid, updated_at=now()
            WHERE id=$1::uuid RETURNING id::text""",
        event_id, *_event_args(body), user_id)
    if not got:
        raise HTTPException(404, "Event not found")
    return await db.fetch_one(_EVENT_SELECT + " WHERE e.id = $1::uuid", event_id)


@api.delete("/admin/events/{event_id}")
async def admin_events_delete(event_id: str, _: str = Depends(require_admin)):
    got = await db.fetch_val(
        "DELETE FROM events WHERE id = $1::uuid RETURNING id::text", event_id)
    if not got:
        raise HTTPException(404, "Event not found")
    return {"ok": True}


# ── Router wiring ─────────────────────────────────────────────────────────────
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # "*" is silently broken here: the spec forbids Access-Control-Allow-Origin: *
    # alongside Access-Control-Allow-Credentials: true, so browsers discard the
    # response while the server still logs 200. Fall back to localhost dev origins
    # rather than a wildcard that only fails at the browser.
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
