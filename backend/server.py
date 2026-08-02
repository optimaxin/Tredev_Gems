"""
Tredev Backend — Trust-first spiritual commerce.
Single-file FastAPI app. Prefixes all routes with /api.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import asyncio
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from datetime import time as dtime
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
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
from fastapi.responses import RedirectResponse
from fastapi.responses import Response as FastAPIResponse

import asyncpg
from decimal import Decimal

import db  # Postgres/Supabase access layer — see backend/MIGRATION.md
import storage_sb  # Supabase Storage — replaces the Emergent object store
from circuit import CircuitOpenError, get_circuit
import respcache
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from collections import defaultdict, deque

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# wa_openwa reads OPENWA_* as module-level constants AT IMPORT TIME, so it must be
# imported only after load_dotenv() has populated os.environ from backend/.env —
# importing it earlier (as a normal top-of-file import would) silently bakes in
# empty values no matter what backend/.env actually contains.
import wa_openwa  # noqa: E402  (OpenWA gateway — two-way WhatsApp send/receive/campaigns)

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

# ── Environment gate ──────────────────────────────────────────────────────────
# Dev-only helper routes (mock payments, DB seeding) must never be reachable in
# production. Set APP_ENV=production on the live deploy; anything else is treated
# as a development environment.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in ("production", "prod")


def _require_dev_env() -> None:
    """Return 404 (never confirm the route exists) when running in production."""
    if IS_PRODUCTION:
        raise HTTPException(status_code=404, detail="Not found")


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
_OTP_DEV_CODE = os.environ.get("OTP_DEV_MODE_CODE", "123456").strip()

# Each of these is a separate outside service with its own failure mode. A slow or
# down provider must not let OTP/notification requests pile up waiting on it — cap
# concurrency and fail fast (falling back to mock/another provider) once it trips.
_twilio_circuit = get_circuit("twilio", failure_threshold=3, reset_timeout=30.0,
                              call_timeout=10.0, max_concurrency=5)
_cashfree_circuit = get_circuit("cashfree", failure_threshold=3, reset_timeout=20.0,
                                call_timeout=8.0, max_concurrency=10)
# firebase_admin's verify_id_token is synchronous and, on a cold cert cache, fetches
# Google's public keys over the network — on the login hot path, so it gets the
# same worker-thread + timeout + concurrency-cap treatment as the others.
_firebase_circuit = get_circuit("firebase_auth", failure_threshold=5, reset_timeout=15.0,
                                call_timeout=8.0, max_concurrency=15)

_CASHFREE_API_VERSION = "2023-08-01"


def _cashfree_base_url() -> str:
    return ("https://api.cashfree.com/pg" if os.environ.get("CASHFREE_ENV") == "production"
            else "https://sandbox.cashfree.com/pg")


def _cashfree_headers(app_id: str, secret: str) -> dict:
    return {"x-client-id": app_id, "x-client-secret": secret,
            "x-api-version": _CASHFREE_API_VERSION, "Content-Type": "application/json"}


async def _cashfree_create_order(app_id: str, secret: str, amount: int, currency: str,
                                 receipt: str, customer: dict, return_url: str) -> dict:
    """Create a Cashfree order. `amount` is in paise/cents (this backend's usual
    minor-unit convention); Cashfree wants the major unit.

    Cashfree's order_id is caller-chosen and must be globally unique per attempt
    (unlike Razorpay, which mints its own) — a checkout retry (checkout_pay) can't
    reuse the id from a first, abandoned attempt. So it's `receipt` (our internal
    order/booking id) plus a random suffix, not `receipt` verbatim; the returned
    order_id is what callers store as payments.gateway_ref to look the attempt back
    up later (webhook, verify).

    httpx is natively async, so — unlike the old Razorpay SDK — this needs no
    worker-thread wrapping; the circuit still caps concurrency/timeout/trips open.
    Raises on any failure; every caller already falls back to a mock order id.
    """
    cf_order_id = f"{receipt[:35]}-{uuid.uuid4().hex[:8]}"

    async def _create():
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{_cashfree_base_url()}/orders",
                headers=_cashfree_headers(app_id, secret),
                json={
                    "order_id": cf_order_id,
                    "order_amount": float(db.to_amount(amount)),
                    "order_currency": currency,
                    "customer_details": customer,
                    "order_meta": {"return_url": return_url} if return_url else {},
                })
            resp.raise_for_status()
            return resp.json()

    data = await _cashfree_circuit.call(_create)
    return {"order_id": data["order_id"], "payment_session_id": data["payment_session_id"]}


async def _cashfree_get_order_payments(app_id: str, secret: str, order_id: str) -> list[dict]:
    """The payment attempts for a Cashfree order — used to confirm SUCCESS server-side.
    Cashfree has no client-passed signature to check (unlike Razorpay's checkout.js
    handler callback), so this IS the verify step."""
    async def _get():
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{_cashfree_base_url()}/orders/{order_id}/payments",
                headers=_cashfree_headers(app_id, secret))
            resp.raise_for_status()
            return resp.json()

    return await _cashfree_circuit.call(_get)


async def _cashfree_create_refund(app_id: str, secret: str, order_id: str, refund_id: str,
                                  amount_paise: int) -> dict:
    """Refund a captured Cashfree payment. Returns Cashfree's refund object
    ({refund_id, refund_status, ...}) — status is 'SUCCESS' or 'PENDING' depending
    on the payment method. Raises on any failure; callers must not mark an order
    cancelled+refunded unless this succeeds."""
    async def _refund():
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{_cashfree_base_url()}/orders/{order_id}/refunds",
                headers=_cashfree_headers(app_id, secret),
                json={"refund_id": refund_id[:40],
                      "refund_amount": float(db.to_amount(amount_paise)),
                      "refund_speed": "STANDARD"})
            resp.raise_for_status()
            return resp.json()

    return await _cashfree_circuit.call(_refund)


# ── Razorpay (international / non-INR checkout only — Cashfree still handles INR) ──
_razorpay_circuit = get_circuit("razorpay", failure_threshold=3, reset_timeout=20.0,
                                call_timeout=8.0, max_concurrency=10)
_RAZORPAY_BASE_URL = "https://api.razorpay.com/v1"


def _razorpay_keys() -> tuple[str, str]:
    return (os.environ.get("RAZORPAY_KEY_ID", "").strip(),
            os.environ.get("RAZORPAY_KEY_SECRET", "").strip())


async def _razorpay_create_order(key_id: str, key_secret: str, amount: int, currency: str,
                                  receipt: str) -> dict:
    """Create a Razorpay order for a non-INR checkout. `amount` is in paise/cents
    (this backend's usual minor-unit convention) — Razorpay's REST API already wants
    the same minor unit, unlike Cashfree which wants the major unit.

    Razorpay mints its own order id (unlike Cashfree's caller-chosen one); callers
    store it as payments.gateway_ref to look the attempt back up later (webhook,
    signature verify). httpx is natively async, so — unlike the old Razorpay SDK —
    this needs no worker-thread wrapping; the circuit still caps concurrency/timeout.
    """
    async def _create():
        async with httpx.AsyncClient(timeout=8.0, auth=(key_id, key_secret)) as client:
            resp = await client.post(
                f"{_RAZORPAY_BASE_URL}/orders",
                json={"amount": amount, "currency": currency, "receipt": receipt[:40]})
            resp.raise_for_status()
            return resp.json()

    data = await _razorpay_circuit.call(_create)
    return {"order_id": data["id"]}


def _razorpay_verify_signature(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    """Unlike Cashfree, Razorpay's checkout.js hands the client a signed
    order_id/payment_id/signature triple on success — HMAC-SHA256("order_id|payment_id",
    key_secret) — so the server verifies that signature itself rather than trusting
    the client outright."""
    expected = hmac.new(key_secret.encode(), f"{order_id}|{payment_id}".encode(),
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


async def _razorpay_create_refund(key_id: str, key_secret: str, payment_id: str,
                                   amount_paise: int) -> dict:
    """Refund a captured Razorpay payment — keyed by the gateway *payment* id
    (unlike Cashfree's refund, which is keyed by the order id)."""
    async def _refund():
        async with httpx.AsyncClient(timeout=8.0, auth=(key_id, key_secret)) as client:
            resp = await client.post(
                f"{_RAZORPAY_BASE_URL}/payments/{payment_id}/refund",
                json={"amount": amount_paise})
            resp.raise_for_status()
            return resp.json()

    return await _razorpay_circuit.call(_refund)


def _otp_provider() -> str:
    # Priority: Twilio Verify → mock.
    if _TWILIO_SID and _TWILIO_TOKEN and _TWILIO_VERIFY_SID:
        return "twilio"
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

        def _create():
            # twilio's SDK is synchronous (blocking network I/O); the circuit runs
            # it in a worker thread so a hang there can't freeze the event loop.
            client = _TwClient(_TWILIO_SID, _TWILIO_TOKEN)
            return client.verify.v2.services(_TWILIO_VERIFY_SID).verifications.create(
                to=phone, channel="sms")

        try:
            v = await _twilio_circuit.call(_create)
        except CircuitOpenError as e:
            raise HTTPException(503, f"SMS verification temporarily unavailable: {e}")
        return {"status": v.status, "provider": "twilio"}
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

        def _check():
            client = _TwClient(_TWILIO_SID, _TWILIO_TOKEN)
            return client.verify.v2.services(_TWILIO_VERIFY_SID).verification_checks.create(
                to=phone, code=code)

        try:
            v = await _twilio_circuit.call(_check)
        except CircuitOpenError:
            return False
        return v.status == "approved"
    # mock — local storage. Expiry is compared in SQL and the row is consumed in
    # the same statement, so a code can't be redeemed twice by concurrent requests.
    deleted = await db.fetch_val(
        """DELETE FROM otp_codes
            WHERE phone = $1 AND code = $2 AND expires_at >= now()
        RETURNING phone""", phone, code)
    return deleted is not None


async def wa_send_utility(phone: str, text: str) -> dict:
    """Send a plain-text WhatsApp message via the OpenWA gateway (staff invites,
    promo broadcasts). Logs and no-ops when the gateway isn't configured, so this
    never blocks a flow that merely wants to notify someone."""
    if not wa_openwa.configured():
        log.info(f"[WA MOCK utility] to={phone} text={text!r}")
        return {"mock": True}
    return await wa_openwa.send_text(wa_openwa.to_chat_id(phone), text)


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


# Short human-readable verification code from a hex value. MUST stay byte-for-byte
# identical to the frontend's shortCode() (src/lib/fingerprint.js) so the code stored
# in the DB matches the seal a customer sees. Crockford-ish alphabet (no 0/O/1/I/L/U);
# every byte mixes into every character; 32-bit unsigned arithmetic like JS's `>>> 0`.
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"


def short_code(hex_str: str, length: int = 6) -> str:
    clean = re.sub(r"[^0-9a-f]", "", (hex_str or "").lower())
    b = [int(clean[i:i + 2], 16) for i in range(0, len(clean) - 1, 2)]
    if not b:
        return ""
    M = 1 << 32
    out = []
    for i in range(length):
        acc = (i * 2654435761) % M
        for j, bj in enumerate(b):
            acc = ((acc * 31) + bj + ((i + 1) * (j + 3))) % M
        out.append(_CODE_ALPHABET[acc % len(_CODE_ALPHABET)])
    return "".join(out)


def sign_payload(payload: dict) -> str:
    sig = ED25519_PRIVATE.sign(canonical_json(payload).encode("utf-8"))
    return sig.hex()


_argon2 = PasswordHasher()  # defaults: time_cost=3, memory_cost=64 MiB, parallelism=4, type=Argon2id


def hash_password(pw: str) -> str:
    return _argon2.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    # Existing accounts still carry bcrypt hashes from before the Argon2id switch —
    # verify those with bcrypt; needs_rehash() below tells callers to upgrade the
    # stored hash to Argon2id right after a successful login, so accounts migrate
    # on their own next sign-in rather than forcing a mass password reset.
    if not hashed.startswith("$argon2"):
        try:
            return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
        except Exception:
            return False
    try:
        return _argon2.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHash):
        return False
    except Exception:
        return False


def needs_rehash(hashed: str) -> bool:
    return not (hashed or "").startswith("$argon2id$")


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
    "content", "taxonomy",
    # Reading the support inbox exposes customer conversations, so it is its own
    # permission rather than being folded into a broader one.
    "whatsapp",
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
    message: str
    user_ids: Optional[List[str]] = None  # None = all opted-in users


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class OptionChoiceIn(BaseModel):
    label: str
    surcharge: int = 0  # paise, added to base price when this choice is selected
    surcharge_usd: Optional[int] = None  # cents — region_pricing's USD fallback for this choice


class OptionShowIfIn(BaseModel):
    """Renders this group only when `group`'s selected value is one of `values` —
    e.g. Metal/Designs only appear once the buyer picks Ring or Pendant. Chains: a
    group whose parent is itself hidden is hidden too."""
    group: str
    values: List[str] = []


class OptionGroupIn(BaseModel):
    """One buyer-facing selector on the product page. `key` is the stable id stored in
    selected_options; `type` decides how it renders. The FIRST choice is the default
    and is always free — see _normalize_variant_options."""
    key: str
    label: str
    type: str = "dropdown"  # "dropdown" | "buttons" | "images"
    choices: List[OptionChoiceIn] = []
    show_if: Optional[OptionShowIfIn] = None
    # Optional groups have no default: nothing is preselected and the buyer may leave
    # them blank (the Ring Size System starts on "Select Ring System").
    optional: bool = False
    # Unpriced groups never carry a surcharge — Form and Metal just decide *what* is
    # being made; the money is on the Design the buyer then picks. The admin form hides
    # the ₹ inputs for these and any surcharge sent is zeroed out.
    priced: bool = True


class VariantOptionsIn(BaseModel):
    """The product's selectors. Which groups a product gets is seeded from its
    category's template (CATEGORY_OPTION_TEMPLATES); the ₹ surcharges are then set
    per product by an admin."""
    groups: List[OptionGroupIn] = []


class ProductIn(BaseModel):
    name: str
    slug: str
    category: str  # gemstone, rudraksha, bracelet, gemstone_jewellery, mala, yantra, idol, pooja_kit, prashad, book, digital
    # Optional: a subcategory (category_id) under the chosen top-level category. Files
    # the product precisely under the sub while it keeps the parent's type/behaviour.
    subcategory_id: Optional[str] = None
    description: str = ""
    price: int  # in paise
    price_usd: Optional[int] = None  # cents — shown/charged to visitors outside India
    mrp: Optional[int] = None
    images: List[str] = []
    attrs: dict = {}  # carat, graha, mukhi, origin, rashi, purpose, etc.
    devanagari_name: Optional[str] = None
    shipping_charges: Dict[str, float] = {}  # region label -> USD amount; unlisted = free (India)
    is_serialized: bool = True  # if False, non-unit-based
    quantity: int = 0  # serialized only: auto-generate this many units with serial numbers
    care_instructions: List[str] = []  # rendered as bullet points on the product page
    # Omitted -> the category's template is used as-is (all surcharges at 0).
    variant_options: Optional[VariantOptionsIn] = None


class UnitIn(BaseModel):
    product_id: str
    serial: str
    weight_carat: Optional[float] = None
    origin: Optional[str] = None
    notes: Optional[str] = None


class BulkUnitsIn(BaseModel):
    product_id: str
    quantity: int  # how many pieces to stock; serials are auto-generated


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


class PoojaDetailsIn(BaseModel):
    """Wearer/sankalp details for a video Pooja Energization — everything here is
    re-validated server-side (see _validated_pooja_details), never trusted as-is."""
    name: str = ""
    dob: str = ""            # YYYY-MM-DD
    birth_place: str = ""
    birth_time: str = ""     # HH:MM 24h, optional
    gender: str = ""
    gotra: str = ""          # optional
    purpose: str = ""        # key into site_content.pooja_purposes


class CartAddIn(BaseModel):
    product_id: str
    unit_id: Optional[str] = None  # required for serialized items
    qty: int = 1
    # {group_key: choice_label} — the buyer's picks. Always validated and priced
    # server-side against the product's variant_options; the client never asserts a
    # price. Missing groups fall back to their (free) default choice.
    options: Dict[str, str] = {}
    # Required only when `options["pooja_energization"]` resolves to one of
    # _POOJA_VIDEO_LABELS — see cart_add. Ignored (and NULLed) otherwise, so a
    # client can't attach wearer details to an arbitrary line.
    pooja_details: Optional[PoojaDetailsIn] = None


class CheckoutIn(BaseModel):
    shipping_name: str
    shipping_phone: str
    shipping_address: str
    shipping_city: str
    shipping_state: str
    shipping_pincode: str
    email: EmailStr
    affiliate_ref: Optional[str] = None  # astrologer's affiliate code, if any
    # Required for a USD (outside-India) checkout — the buyer's exact country, an
    # ISO-3166-1 alpha-2 code from SHIPPING_COUNTRIES. Resolved server-side to a
    # shipping region (_shipping_region_for_country) to look up each product's
    # shipping_charges dict. Ignored for INR (always free within India).
    shipping_country: Optional[str] = None


class DispatchIn(BaseModel):
    order_id: str
    # Provenance is captured AT dispatch (not intake): the lab report, temple
    # energisation and Ed25519 signature are issued for every sold unit on the order.
    lab_name: str
    lab_report_no: str
    lab_report_url: Optional[str] = None
    temple_name: str
    temple_devanagari: Optional[str] = None
    energization_date: str  # ISO date
    priest_name: str
    pooja_recording_url: Optional[str] = None
    mantra: Optional[str] = None
    estimated_delivery_date: Optional[str] = None  # ISO date shown to the buyer
    tracking_number: Optional[str] = None
    courier: Optional[str] = None


class SetQtyIn(BaseModel):
    line_id: str
    qty: int  # new quantity for the cart line; <= 0 removes it


class ReviewIn(BaseModel):
    product_id: str
    rating: int = Field(ge=1, le=5)
    title: str = ""
    body: str = ""
    # Up to 3 image URLs (paths returned by POST /reviews/photo).
    photos: List[str] = Field(default_factory=list, max_length=3)


class ConsultationBookIn(BaseModel):
    astrologer_id: str
    slot_iso: str
    name: str
    phone: str
    email: EmailStr
    concern: str = ""


_TIME_OF_DAY_HOUR = {"morning": 10, "afternoon": 14, "evening": 18}
IST = timezone(timedelta(hours=5, minutes=30))
CONSULTATION_DURATION_MINUTES = 30


class ConsultationRequestIn(BaseModel):
    preferred_date: str          # "YYYY-MM-DD"
    time_of_day: str             # morning | afternoon | evening
    name: str
    phone: str
    email: EmailStr
    concern: str = ""

    @field_validator("time_of_day")
    @classmethod
    def _valid_time_of_day(cls, v):
        if v not in _TIME_OF_DAY_HOUR:
            raise ValueError("time_of_day must be morning, afternoon or evening")
        return v


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


def _backend_base_url(request: Request) -> str:
    """This service's own public URL — for webhook/join links plugNmeet or a
    customer's browser must reach from outside. Render injects RENDER_EXTERNAL_URL
    automatically; local dev falls back to the request's own host."""
    return os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/") or str(request.base_url).rstrip("/")


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

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Brute-force protection for auth and other sensitive endpoints (§6). A per-IP
# sliding-window limiter implemented as a FastAPI dependency, so it never disturbs
# request-body parsing. In-memory: fine for a single instance; front with Redis if
# the API is ever scaled to multiple workers/instances.
def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


_rate_buckets: dict[str, deque] = defaultdict(deque)


def rate_limit(max_calls: int, window_secs: int):
    """Dependency factory: allow at most `max_calls` per `window_secs` per IP+route.

    Runs on the event loop with no awaits between the check and the append, so no
    lock is needed. Raises 429 when the window is full.
    """
    async def _dep(request: Request) -> None:
        key = f"{request.url.path}:{_client_ip(request)}"
        cutoff = time.time() - window_secs
        dq = _rate_buckets[key]
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if not dq:
            _rate_buckets.pop(key, None)
            dq = _rate_buckets[key]
        if len(dq) >= max_calls:
            raise HTTPException(429, "Too many requests. Please try again later.")
        dq.append(time.time())
    return _dep


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


@app.api_route("/health", methods=["GET", "HEAD"])
@api.api_route("/health", methods=["GET", "HEAD"])
async def health():
    # methods includes HEAD — uptime monitors commonly probe with HEAD instead of
    # GET to save bandwidth; GET-only left it 405ing for those checks.
    return {"success": True, "message": "Server is healthy", "timestamp": iso(now())}


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
async def auth_firebase_verify(body: FirebaseVerifyIn, _rl: None = Depends(rate_limit(15, 60))):
    """Exchange a Firebase Phone Auth ID token for our otp_verification_token."""
    if not _firebase_ready:
        raise HTTPException(503, "Firebase Auth not configured on the server")
    try:
        from firebase_admin import auth as _fb_auth
        decoded = await _firebase_circuit.call(_fb_auth.verify_id_token, body.id_token)
    except CircuitOpenError:
        raise HTTPException(503, "Sign-in temporarily unavailable. Please try again shortly.")
    except Exception as e:
        log.warning(f"Firebase ID token verification failed: {e}")
        raise HTTPException(401, "Invalid or expired Firebase ID token")
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
# otp_send()/otp_check() and the otp_codes table remain, provider-abstract
# (Twilio/mock), for future reactivation — not currently wired to any route.


@api.post("/auth/signup")
async def signup(body: SignupIn, request: Request, _rl: None = Depends(rate_limit(10, 60))):
    if await _load_user(email=body.email.lower()):
        raise HTTPException(400, "Email already registered")
    phone = normalize_phone(body.phone)
    if not check_phone_verify_token(body.otp_verification_token, phone):
        raise HTTPException(400, "Phone not verified. Please verify OTP again.")
    if await _load_user(phone=phone):
        raise HTTPException(400, "This phone number is already linked to another account")
    user = await _create_or_get_user(email=body.email, name=body.name, password=body.password, phone=phone, phone_verified=True, wa_optin=body.wa_optin)
    await _claim_anon_cart(user["user_id"], request.cookies.get("gemora_anon"))
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
async def login(body: LoginIn, request: Request, _rl: None = Depends(rate_limit(10, 60))):
    user = await _load_user(email=body.email.lower())
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    if needs_rehash(user["password_hash"]):
        await db.execute("UPDATE users SET password_hash = $2 WHERE id = $1::uuid",
                          user["user_id"], hash_password(body.password))
    await _claim_anon_cart(user["user_id"], request.cookies.get("gemora_anon"))
    token = make_jwt(user["user_id"])
    return {"token": token, "user": _user_public(user)}


@api.post("/auth/google")
async def auth_google(body: GoogleSignInIn, request: Request, _rl: None = Depends(rate_limit(15, 60))):
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
        decoded = await _firebase_circuit.call(_fb_auth.verify_id_token, body.id_token)
    except CircuitOpenError:
        raise HTTPException(503, "Sign-in temporarily unavailable. Please try again shortly.")
    except Exception as e:
        log.warning(f"Google ID token verification failed: {e}")
        raise HTTPException(401, "Invalid or expired Google ID token")

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
    await _claim_anon_cart(user["user_id"], request.cookies.get("gemora_anon"))
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


# ── region pricing ──────────────────────────────────────────────────────────
# Binary: India sees INR (the base price stored directly on products/astrologers);
# everyone else sees USD (the price_usd sibling column, optional — falls back to
# the INR base if a product/astrologer doesn't have one set).
SUPPORTED_CURRENCIES = {"INR", "USD"}

# Shipping is free within India; everywhere else, a product can carry a USD
# shipping charge per region (admin-configured, coarse on purpose — a handful of
# tiers, not one price per country). The buyer instead picks their exact COUNTRY at
# checkout (see SHIPPING_COUNTRIES below) — far less error-prone than asking them to
# self-classify into a region name — and the server resolves that to the region for
# pricing (_shipping_region_for_country).
SHIPPING_REGIONS = ["North America", "Europe", "Asia-Pacific", "South Asia",
                    "Middle East & Africa", "South America", "Rest of World"]

# {code, name, region} for every country this store ships to (all but India, which
# is the INR/domestic case). `code` is the ISO-3166-1 alpha-2 code — also what's
# stored on addresses.country; `region` is one of SHIPPING_REGIONS above. Mirrors
# frontend/src/lib/shipping.js — keep both in sync if this list changes.
SHIPPING_COUNTRIES = [
    {"code": "AF", "name": "Afghanistan", "region": "South Asia"},
    {"code": "AL", "name": "Albania", "region": "Europe"},
    {"code": "DZ", "name": "Algeria", "region": "Middle East & Africa"},
    {"code": "AD", "name": "Andorra", "region": "Europe"},
    {"code": "AO", "name": "Angola", "region": "Middle East & Africa"},
    {"code": "AG", "name": "Antigua and Barbuda", "region": "North America"},
    {"code": "AR", "name": "Argentina", "region": "South America"},
    {"code": "AM", "name": "Armenia", "region": "Europe"},
    {"code": "AU", "name": "Australia", "region": "Asia-Pacific"},
    {"code": "AT", "name": "Austria", "region": "Europe"},
    {"code": "AZ", "name": "Azerbaijan", "region": "Europe"},
    {"code": "BS", "name": "Bahamas", "region": "North America"},
    {"code": "BH", "name": "Bahrain", "region": "Middle East & Africa"},
    {"code": "BD", "name": "Bangladesh", "region": "South Asia"},
    {"code": "BB", "name": "Barbados", "region": "North America"},
    {"code": "BY", "name": "Belarus", "region": "Europe"},
    {"code": "BE", "name": "Belgium", "region": "Europe"},
    {"code": "BZ", "name": "Belize", "region": "North America"},
    {"code": "BJ", "name": "Benin", "region": "Middle East & Africa"},
    {"code": "BT", "name": "Bhutan", "region": "South Asia"},
    {"code": "BO", "name": "Bolivia", "region": "South America"},
    {"code": "BA", "name": "Bosnia and Herzegovina", "region": "Europe"},
    {"code": "BW", "name": "Botswana", "region": "Middle East & Africa"},
    {"code": "BR", "name": "Brazil", "region": "South America"},
    {"code": "BN", "name": "Brunei", "region": "Asia-Pacific"},
    {"code": "BG", "name": "Bulgaria", "region": "Europe"},
    {"code": "BF", "name": "Burkina Faso", "region": "Middle East & Africa"},
    {"code": "BI", "name": "Burundi", "region": "Middle East & Africa"},
    {"code": "CV", "name": "Cabo Verde", "region": "Middle East & Africa"},
    {"code": "KH", "name": "Cambodia", "region": "Asia-Pacific"},
    {"code": "CM", "name": "Cameroon", "region": "Middle East & Africa"},
    {"code": "CA", "name": "Canada", "region": "North America"},
    {"code": "CF", "name": "Central African Republic", "region": "Middle East & Africa"},
    {"code": "TD", "name": "Chad", "region": "Middle East & Africa"},
    {"code": "CL", "name": "Chile", "region": "South America"},
    {"code": "CN", "name": "China", "region": "Asia-Pacific"},
    {"code": "CO", "name": "Colombia", "region": "South America"},
    {"code": "KM", "name": "Comoros", "region": "Middle East & Africa"},
    {"code": "CG", "name": "Congo (Republic of the)", "region": "Middle East & Africa"},
    {"code": "CD", "name": "Congo (DRC)", "region": "Middle East & Africa"},
    {"code": "CR", "name": "Costa Rica", "region": "North America"},
    {"code": "CI", "name": "Côte d'Ivoire", "region": "Middle East & Africa"},
    {"code": "HR", "name": "Croatia", "region": "Europe"},
    {"code": "CU", "name": "Cuba", "region": "Rest of World"},
    {"code": "CY", "name": "Cyprus", "region": "Europe"},
    {"code": "CZ", "name": "Czechia", "region": "Europe"},
    {"code": "DK", "name": "Denmark", "region": "Europe"},
    {"code": "DJ", "name": "Djibouti", "region": "Middle East & Africa"},
    {"code": "DM", "name": "Dominica", "region": "North America"},
    {"code": "DO", "name": "Dominican Republic", "region": "North America"},
    {"code": "EC", "name": "Ecuador", "region": "South America"},
    {"code": "EG", "name": "Egypt", "region": "Middle East & Africa"},
    {"code": "SV", "name": "El Salvador", "region": "North America"},
    {"code": "GQ", "name": "Equatorial Guinea", "region": "Middle East & Africa"},
    {"code": "ER", "name": "Eritrea", "region": "Middle East & Africa"},
    {"code": "EE", "name": "Estonia", "region": "Europe"},
    {"code": "SZ", "name": "Eswatini", "region": "Middle East & Africa"},
    {"code": "ET", "name": "Ethiopia", "region": "Middle East & Africa"},
    {"code": "FJ", "name": "Fiji", "region": "Asia-Pacific"},
    {"code": "FI", "name": "Finland", "region": "Europe"},
    {"code": "FR", "name": "France", "region": "Europe"},
    {"code": "GA", "name": "Gabon", "region": "Middle East & Africa"},
    {"code": "GM", "name": "Gambia", "region": "Middle East & Africa"},
    {"code": "GE", "name": "Georgia", "region": "Europe"},
    {"code": "DE", "name": "Germany", "region": "Europe"},
    {"code": "GH", "name": "Ghana", "region": "Middle East & Africa"},
    {"code": "GR", "name": "Greece", "region": "Europe"},
    {"code": "GD", "name": "Grenada", "region": "North America"},
    {"code": "GT", "name": "Guatemala", "region": "North America"},
    {"code": "GN", "name": "Guinea", "region": "Middle East & Africa"},
    {"code": "GW", "name": "Guinea-Bissau", "region": "Middle East & Africa"},
    {"code": "GY", "name": "Guyana", "region": "South America"},
    {"code": "HT", "name": "Haiti", "region": "North America"},
    {"code": "HN", "name": "Honduras", "region": "North America"},
    {"code": "HU", "name": "Hungary", "region": "Europe"},
    {"code": "IS", "name": "Iceland", "region": "Europe"},
    {"code": "ID", "name": "Indonesia", "region": "Asia-Pacific"},
    {"code": "IR", "name": "Iran", "region": "Middle East & Africa"},
    {"code": "IQ", "name": "Iraq", "region": "Middle East & Africa"},
    {"code": "IE", "name": "Ireland", "region": "Europe"},
    {"code": "IL", "name": "Israel", "region": "Middle East & Africa"},
    {"code": "IT", "name": "Italy", "region": "Europe"},
    {"code": "JM", "name": "Jamaica", "region": "North America"},
    {"code": "JP", "name": "Japan", "region": "Asia-Pacific"},
    {"code": "JO", "name": "Jordan", "region": "Middle East & Africa"},
    {"code": "KZ", "name": "Kazakhstan", "region": "Asia-Pacific"},
    {"code": "KE", "name": "Kenya", "region": "Middle East & Africa"},
    {"code": "KI", "name": "Kiribati", "region": "Asia-Pacific"},
    {"code": "XK", "name": "Kosovo", "region": "Europe"},
    {"code": "KW", "name": "Kuwait", "region": "Middle East & Africa"},
    {"code": "KG", "name": "Kyrgyzstan", "region": "Asia-Pacific"},
    {"code": "LA", "name": "Laos", "region": "Asia-Pacific"},
    {"code": "LV", "name": "Latvia", "region": "Europe"},
    {"code": "LB", "name": "Lebanon", "region": "Middle East & Africa"},
    {"code": "LS", "name": "Lesotho", "region": "Middle East & Africa"},
    {"code": "LR", "name": "Liberia", "region": "Middle East & Africa"},
    {"code": "LY", "name": "Libya", "region": "Middle East & Africa"},
    {"code": "LI", "name": "Liechtenstein", "region": "Europe"},
    {"code": "LT", "name": "Lithuania", "region": "Europe"},
    {"code": "LU", "name": "Luxembourg", "region": "Europe"},
    {"code": "MG", "name": "Madagascar", "region": "Middle East & Africa"},
    {"code": "MW", "name": "Malawi", "region": "Middle East & Africa"},
    {"code": "MY", "name": "Malaysia", "region": "Asia-Pacific"},
    {"code": "MV", "name": "Maldives", "region": "South Asia"},
    {"code": "ML", "name": "Mali", "region": "Middle East & Africa"},
    {"code": "MT", "name": "Malta", "region": "Europe"},
    {"code": "MH", "name": "Marshall Islands", "region": "Asia-Pacific"},
    {"code": "MR", "name": "Mauritania", "region": "Middle East & Africa"},
    {"code": "MU", "name": "Mauritius", "region": "Middle East & Africa"},
    {"code": "MX", "name": "Mexico", "region": "North America"},
    {"code": "FM", "name": "Micronesia", "region": "Asia-Pacific"},
    {"code": "MD", "name": "Moldova", "region": "Europe"},
    {"code": "MC", "name": "Monaco", "region": "Europe"},
    {"code": "MN", "name": "Mongolia", "region": "Asia-Pacific"},
    {"code": "ME", "name": "Montenegro", "region": "Europe"},
    {"code": "MA", "name": "Morocco", "region": "Middle East & Africa"},
    {"code": "MZ", "name": "Mozambique", "region": "Middle East & Africa"},
    {"code": "MM", "name": "Myanmar", "region": "Asia-Pacific"},
    {"code": "NA", "name": "Namibia", "region": "Middle East & Africa"},
    {"code": "NR", "name": "Nauru", "region": "Asia-Pacific"},
    {"code": "NP", "name": "Nepal", "region": "South Asia"},
    {"code": "NL", "name": "Netherlands", "region": "Europe"},
    {"code": "NZ", "name": "New Zealand", "region": "Asia-Pacific"},
    {"code": "NI", "name": "Nicaragua", "region": "North America"},
    {"code": "NE", "name": "Niger", "region": "Middle East & Africa"},
    {"code": "NG", "name": "Nigeria", "region": "Middle East & Africa"},
    {"code": "KP", "name": "North Korea", "region": "Rest of World"},
    {"code": "MK", "name": "North Macedonia", "region": "Europe"},
    {"code": "NO", "name": "Norway", "region": "Europe"},
    {"code": "OM", "name": "Oman", "region": "Middle East & Africa"},
    {"code": "PK", "name": "Pakistan", "region": "South Asia"},
    {"code": "PW", "name": "Palau", "region": "Asia-Pacific"},
    {"code": "PS", "name": "Palestine", "region": "Middle East & Africa"},
    {"code": "PA", "name": "Panama", "region": "North America"},
    {"code": "PG", "name": "Papua New Guinea", "region": "Asia-Pacific"},
    {"code": "PY", "name": "Paraguay", "region": "South America"},
    {"code": "PE", "name": "Peru", "region": "South America"},
    {"code": "PH", "name": "Philippines", "region": "Asia-Pacific"},
    {"code": "PL", "name": "Poland", "region": "Europe"},
    {"code": "PT", "name": "Portugal", "region": "Europe"},
    {"code": "QA", "name": "Qatar", "region": "Middle East & Africa"},
    {"code": "RO", "name": "Romania", "region": "Europe"},
    {"code": "RU", "name": "Russia", "region": "Rest of World"},
    {"code": "RW", "name": "Rwanda", "region": "Middle East & Africa"},
    {"code": "KN", "name": "Saint Kitts and Nevis", "region": "North America"},
    {"code": "LC", "name": "Saint Lucia", "region": "North America"},
    {"code": "VC", "name": "Saint Vincent and the Grenadines", "region": "North America"},
    {"code": "WS", "name": "Samoa", "region": "Asia-Pacific"},
    {"code": "SM", "name": "San Marino", "region": "Europe"},
    {"code": "ST", "name": "Sao Tome and Principe", "region": "Middle East & Africa"},
    {"code": "SA", "name": "Saudi Arabia", "region": "Middle East & Africa"},
    {"code": "SN", "name": "Senegal", "region": "Middle East & Africa"},
    {"code": "RS", "name": "Serbia", "region": "Europe"},
    {"code": "SC", "name": "Seychelles", "region": "Middle East & Africa"},
    {"code": "SL", "name": "Sierra Leone", "region": "Middle East & Africa"},
    {"code": "SG", "name": "Singapore", "region": "Asia-Pacific"},
    {"code": "SK", "name": "Slovakia", "region": "Europe"},
    {"code": "SI", "name": "Slovenia", "region": "Europe"},
    {"code": "SB", "name": "Solomon Islands", "region": "Asia-Pacific"},
    {"code": "SO", "name": "Somalia", "region": "Middle East & Africa"},
    {"code": "ZA", "name": "South Africa", "region": "Middle East & Africa"},
    {"code": "KR", "name": "South Korea", "region": "Asia-Pacific"},
    {"code": "SS", "name": "South Sudan", "region": "Middle East & Africa"},
    {"code": "ES", "name": "Spain", "region": "Europe"},
    {"code": "LK", "name": "Sri Lanka", "region": "South Asia"},
    {"code": "SD", "name": "Sudan", "region": "Middle East & Africa"},
    {"code": "SR", "name": "Suriname", "region": "South America"},
    {"code": "SE", "name": "Sweden", "region": "Europe"},
    {"code": "CH", "name": "Switzerland", "region": "Europe"},
    {"code": "SY", "name": "Syria", "region": "Middle East & Africa"},
    {"code": "TW", "name": "Taiwan", "region": "Asia-Pacific"},
    {"code": "TJ", "name": "Tajikistan", "region": "Asia-Pacific"},
    {"code": "TZ", "name": "Tanzania", "region": "Middle East & Africa"},
    {"code": "TH", "name": "Thailand", "region": "Asia-Pacific"},
    {"code": "TL", "name": "Timor-Leste", "region": "Asia-Pacific"},
    {"code": "TG", "name": "Togo", "region": "Middle East & Africa"},
    {"code": "TO", "name": "Tonga", "region": "Asia-Pacific"},
    {"code": "TT", "name": "Trinidad and Tobago", "region": "North America"},
    {"code": "TN", "name": "Tunisia", "region": "Middle East & Africa"},
    {"code": "TR", "name": "Turkey", "region": "Middle East & Africa"},
    {"code": "TM", "name": "Turkmenistan", "region": "Asia-Pacific"},
    {"code": "TV", "name": "Tuvalu", "region": "Asia-Pacific"},
    {"code": "UG", "name": "Uganda", "region": "Middle East & Africa"},
    {"code": "UA", "name": "Ukraine", "region": "Europe"},
    {"code": "AE", "name": "United Arab Emirates", "region": "Middle East & Africa"},
    {"code": "GB", "name": "United Kingdom", "region": "Europe"},
    {"code": "US", "name": "United States", "region": "North America"},
    {"code": "UY", "name": "Uruguay", "region": "South America"},
    {"code": "UZ", "name": "Uzbekistan", "region": "Asia-Pacific"},
    {"code": "VU", "name": "Vanuatu", "region": "Asia-Pacific"},
    {"code": "VA", "name": "Vatican City", "region": "Europe"},
    {"code": "VE", "name": "Venezuela", "region": "South America"},
    {"code": "VN", "name": "Vietnam", "region": "Asia-Pacific"},
    {"code": "YE", "name": "Yemen", "region": "Middle East & Africa"},
    {"code": "ZM", "name": "Zambia", "region": "Middle East & Africa"},
    {"code": "ZW", "name": "Zimbabwe", "region": "Middle East & Africa"},
]

_COUNTRY_REGION = {c["code"]: c["region"] for c in SHIPPING_COUNTRIES}
_SHIPPING_COUNTRY_CODES = set(_COUNTRY_REGION)


def _shipping_region_for_country(country_code: str) -> str:
    return _COUNTRY_REGION.get((country_code or "").upper(), "Rest of World")


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
           p.category_id::text                     AS category_id,
           -- The subcategory this product is filed under, if any (a category row with a
           -- parent). Top-level placement leaves these null.
           CASE WHEN cat.parent_id IS NOT NULL THEN cat.id::text END AS subcategory_id,
           CASE WHEN cat.parent_id IS NOT NULL THEN cat.name END     AS subcategory,
           p.base_price                            AS base_price,
           p.price_usd                             AS price_usd,
           p.compare_at_price                      AS compare_at_price,
           p.is_serialized                         AS is_serialized,
           (p.status = 'active')                   AS is_active,
           p.attributes                            AS attributes,
           COALESCE(p.care_instructions, ARRAY[]::text[]) AS care_instructions,
           p.variant_options                       AS variant_options,
           p.created_at                            AS created_at,
           COALESCE(m.urls, ARRAY[]::text[])       AS images,
           g.planet_graha::text                    AS g_graha,
           g.weight_carat                          AS g_carat,
           g.origin                                AS g_origin,
           r.mukhi                                 AS r_mukhi,
           r.ruling_planet::text                   AS r_graha,
           r.origin::text                          AS r_origin
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
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
        "price_usd": db.to_paise(r.pop("price_usd")),
        "mrp": db.to_paise(r.pop("compare_at_price")),
        "currency": "INR",
        "attrs": attrs,
    }


def _apply_product_currency(products: list[dict], currency: str) -> list[dict]:
    """Binary region pricing: outside India, show price_usd if the product has
    one set, else leave the INR base price showing — there's nothing else to
    show. `mrp` has no USD equivalent, so it's dropped whenever price_usd is used."""
    if currency != "USD":
        return products
    for p in products:
        if p.get("price_usd") is not None:
            p["price"], p["currency"], p["mrp"] = p["price_usd"], "USD", None
    return products


@api.get("/products")
async def list_products(
    category: Optional[str] = None,
    graha: Optional[str] = None,
    rashi: Optional[str] = None,
    purpose: Optional[str] = None,
    mukhi: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 60,
    currency: str = "INR",
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
    products = [_shape_product(r) for r in await db.fetch_all(sql, *args)]
    return _apply_product_currency(products, currency if currency in SUPPORTED_CURRENCIES else "INR")


@api.get("/products/{slug}")
async def get_product(slug: str, currency: str = "INR"):
    row = await db.fetch_one(_PRODUCT_SELECT + " AND p.slug = $1::citext", slug)
    if not row:
        raise HTTPException(404, "Product not found")
    p = _shape_product(row)
    _apply_product_currency([p], currency if currency in SUPPORTED_CURRENCIES else "INR")
    # Buyers no longer pick a specific serial — they choose a quantity and units are
    # auto-assigned at payment. The page only needs the count of pieces still in stock
    # so it can cap the quantity selector. Non-serialized products aren't unit-tracked,
    # so they're treated as unlimited (in_stock = None).
    if p["is_serialized"]:
        p["in_stock"] = await db.fetch_val(
            """SELECT count(*) FROM product_units
                WHERE product_id = $1::uuid AND status = 'in_stock'""",
            p["product_id"])
    else:
        p["in_stock"] = None
    # Out of stock = staff's manual override (works for any product, set from Admin →
    # Products), or — for serialized items only — genuinely zero pieces in the vault.
    # The count itself isn't part of the buyer-facing contract, only this flag.
    p["out_of_stock"] = bool(p["attrs"].get("out_of_stock")) or (p["is_serialized"] and p["in_stock"] == 0)
    # Merge in the selectors that aren't stored per product (shared designs catalog,
    # standard ring sizes) so the page renders the complete option set.
    p["variant_options"] = _effective_variant_options(
        db.CATEGORY_TO_DB.get(p["category"], p["category"]), p.get("variant_options"),
        await _design_groups_for_product(p["product_id"]))
    return p


# The collection banner an admin can set per category. Anything left blank falls back
# to the frontend's built-in copy, so a bare category still renders fully.
_BANNER_ICONS = ["drop", "sun", "moon", "leaf", "lotus", "hand", "shield", "qr",
                 "sparkle", "compass", "ruler", "package", "clock", "scroll"]
_BANNER_TEXT_FIELDS = ("image", "badge_label", "intro", "about", "who_should_wear",
                       "quality", "price")
_BANNER_STEP_FIELDS = ("how_to_wear", "how_to_care", "benefits")


def _normalize_category_banner(b: Optional[dict]) -> dict:
    """Sanitise the banner blob before it's stored: keep only known fields, coerce the
    repeatable sections to clean [{icon,title,body}] / [{q,a}] lists, and drop empties so
    a blank field transparently falls through to the frontend default."""
    b = b or {}
    out: dict = {}
    for f in _BANNER_TEXT_FIELDS:
        v = (b.get(f) or "").strip() if isinstance(b.get(f), str) else b.get(f)
        if v:
            out[f] = v
    for cta in ("cta_primary", "cta_secondary"):
        c = b.get(cta) or {}
        label = (c.get("label") or "").strip()
        href = (c.get("href") or "").strip()
        if label or href:
            out[cta] = {"label": label, "href": href}
    for f in _BANNER_STEP_FIELDS:
        steps = []
        for s in (b.get(f) or []):
            title = (s.get("title") or "").strip()
            body = (s.get("body") or "").strip()
            if not (title or body):
                continue
            icon = s.get("icon") if s.get("icon") in _BANNER_ICONS else "sparkle"
            steps.append({"icon": icon, "title": title, "body": body})
        if steps:
            out[f] = steps
    faqs = []
    for fq in (b.get("faqs") or []):
        q = (fq.get("q") or "").strip()
        a = (fq.get("a") or "").strip()
        if q or a:
            faqs.append({"q": q, "a": a})
    if faqs:
        out["faqs"] = faqs
    return out


async def _list_categories() -> list[dict]:
    """Flat category dicts. `key`/`hindi`/`order` are the API names for
    category_key/name_devanagari/sort_order.

    `key` is the *type* (the category_key enum) and is NOT unique — a subcategory shares
    its parent's type/key. `category_id` and `slug` are the stable identifiers; a product
    is mapped to a specific row by category_id. `parent_category_id` gives the tree."""
    rows = await db.fetch_all(
        """SELECT c.id::text                 AS category_id,
                  c.category_key::text       AS category_key,
                  c.name                     AS label,
                  c.slug::text               AS slug,
                  COALESCE(c.name_devanagari, '') AS hindi,
                  c.parent_id::text          AS parent_category_id,
                  pc.category_key::text      AS parent_key_db,
                  c.sort_order               AS "order",
                  COALESCE(c.banner, '{}'::jsonb) AS banner,
                  c.created_at               AS created_at
             FROM categories c
             LEFT JOIN categories pc ON pc.id = c.parent_id
            WHERE c.is_active
            ORDER BY c.sort_order, c.name""")
    out = []
    for r in rows:
        pk = r.pop("parent_key_db", None)
        out.append({**r,
                    "key": db.CATEGORY_FROM_DB.get(r.pop("category_key"), None),
                    "is_sub": r["parent_category_id"] is not None,
                    "parent_key": db.CATEGORY_FROM_DB.get(pk) if pk else None})
    return out


# ── Editable site content (announcement bar, footer, purposes/rashi taxonomy) ──
# key -> default value. A stored row overrides the default; a blank field in a stored
# row falls back to the default via _merged_content(), so the site never renders empty.
_DEFAULT_PURPOSES = [
    {"key": "wealth", "label": "Wealth"}, {"key": "protection", "label": "Protection"},
    {"key": "love", "label": "Love"}, {"key": "career", "label": "Career"},
    {"key": "health", "label": "Health"},
]
_DEFAULT_RASHI = [
    {"key": "mesha", "label": "Mesha (Aries)", "stone": "", "url": ""},
    {"key": "vrishabha", "label": "Vrishabha (Taurus)", "stone": "", "url": ""},
    {"key": "mithuna", "label": "Mithuna (Gemini)", "stone": "", "url": ""},
    {"key": "karka", "label": "Karka (Cancer)", "stone": "", "url": ""},
    {"key": "simha", "label": "Simha (Leo)", "stone": "", "url": ""},
    {"key": "kanya", "label": "Kanya (Virgo)", "stone": "", "url": ""},
    {"key": "tula", "label": "Tula (Libra)", "stone": "", "url": ""},
    {"key": "vrishchika", "label": "Vrishchika (Scorpio)", "stone": "", "url": ""},
    {"key": "dhanu", "label": "Dhanu (Sagittarius)", "stone": "", "url": ""},
    {"key": "makara", "label": "Makara (Capricorn)", "stone": "", "url": ""},
    {"key": "kumbha", "label": "Kumbha (Aquarius)", "stone": "", "url": ""},
    {"key": "meena", "label": "Meena (Pisces)", "stone": "", "url": ""},
]
_DEFAULT_ANNOUNCEMENT = {"messages": [
    {"text": "100% Lab-Certified · Ed25519 signed · Dispatched in 48h", "deva": "प्रमाणित"},
    {"text": "Free insured shipping on orders above ₹5,000", "deva": "मुफ्त शिपिंग"},
    {"text": "5% prepaid discount · WhatsApp assistance daily 9–9", "deva": "छूट"},
]}
_DEFAULT_FOOTER = {
    "brand": "Tredev", "devanagari": "रत्न · प्रमाण · परंपरा",
    "description": "A first-party house for authentic spiritual products. Every serialised item carries a cryptographically signed provenance chain — a claim you can verify with a public key.",
    "badge": "Ed25519-signed certificates",
    "columns": [
        {"title": "Shop", "links": [
            {"label": "Gemstones · रत्न", "href": "/shop?category=gemstone"},
            {"label": "Rudraksha · रुद्राक्ष", "href": "/shop?category=rudraksha"},
            {"label": "Bracelets", "href": "/shop?category=bracelet"},
            {"label": "Yantras · यंत्र", "href": "/shop?category=yantra"},
            {"label": "Idols · मूर्ति", "href": "/shop?category=idol"},
            {"label": "Temple Prashad", "href": "/shop?category=prashad"},
        ]},
        {"title": "Trust", "links": [
            {"label": "Verify a QR", "href": "/verify"},
            {"label": "Carat ↔ Ratti Converter", "href": "/tools/carat-ratti"},
            {"label": "Shop by Planet", "href": "/shop-by-planet"},
            {"label": "Shop by Purpose", "href": "/shop-by-purpose"},
        ]},
        {"title": "Company", "links": [
            {"label": "Book a consultation", "href": "/consultation"},
            {"label": "Kolkata · Mumbai · Varanasi", "href": ""},
            {"label": "hello@gemora.in", "href": "mailto:hello@gemora.in"},
            {"label": "+91 90-000-000-00", "href": ""},
        ]},
    ],
    "copyright": "An honest house for sacred things · Made with care in India",
}
# Homepage copy. Titles support a light markup: "*...*" renders as the gold
# gradient highlight and "\n" is a line break. Section images stay in Site Images.
_DEFAULT_HOME = {
    "ambassador": {
        "eyebrow": "",
        "name": "Shri Raghavendra",
        "role": "The face of our faith",
        "quote": "Every stone we bless carries the same truth we live by.",
        "primaryCta": {"label": "Shop his picks", "href": "/shop"},
        "secondaryCta": {"label": "Book a consultation", "href": "/consultation"},
    },
    "hero": [
        {"tag": "Est. Kashi · 2024",
         "title": "Anyone can claim a stone is real.\nWe let you *prove it.*",
         "sub": "Every gemstone, rudraksha and yantra you buy is a serialised, cryptographically signed physical unit. Verifiable with a public key from anywhere.",
         "cta1_to": "/shop", "cta1_label": "Enter the store",
         "cta2_to": "/verify", "cta2_label": "Verify a QR",
         "deva": "सत्यम् एव जयते", "devaSub": "Only truth prevails"},
        {"tag": "The Navratna, individually signed",
         "title": "Nine stones.\n*Nine planets.* One promise.",
         "sub": "Pukhraj, Neelam, Manik, Panna, Moti, Moonga, Heera, Gomed, Lehsuniya — every stone paired to its ruler, with its own lab report and temple energisation.",
         "cta1_to": "/shop-by-planet", "cta1_label": "Shop the Navagraha",
         "cta2_to": "/tools/carat-ratti", "cta2_label": "Carat ↔ Ratti tool",
         "deva": "नवग्रह", "devaSub": "The nine graha"},
        {"tag": "Rudraksha · Nepal Original",
         "title": "Every bead, a blessing.\n*Every mukhi, a lineage.*",
         "sub": "Authentic 1 to 21 mukhi Nepal rudraksha, X-ray verified and energised at partner temples. No lookalike Indonesian passing off allowed.",
         "cta1_to": "/shop?category=rudraksha", "cta1_label": "Explore Rudraksha",
         "cta2_to": "/verify", "cta2_label": "How we verify",
         "deva": "रुद्राक्ष", "devaSub": "The tears of Rudra"},
    ],
    "stats": [
        {"value": 1200, "suffix": "+", "decimals": 0, "label": "Verified reviews", "deva": "समीक्षा"},
        {"value": 4.9, "suffix": "", "decimals": 1, "label": "Average rating", "deva": "औसत"},
        {"value": 9, "suffix": "", "decimals": 0, "label": "Navagraha stones", "deva": "नवग्रह"},
        {"value": 100, "suffix": "%", "decimals": 0, "label": "Signed & serialised", "deva": "प्रमाणित"},
    ],
    "astroBand": {
        "eyebrow": "Guidance · परामर्श",
        "title": "Talk to a real person,\nnot a chatbot.",
        "body": "A human, on a scheduled call — who reads your chart and tells you honestly which stone or rudraksha suits you, or whether you need one at all. No guesswork, no upsell.",
        "name": "Shri Raghavendra", "role": "Founder & Guide",
        "features": ["Scheduled call", "Reads your chart", "Honest advice"],
        "primaryCta": {"label": "Book a call", "href": "/consultation"},
        "secondaryCta": {"label": "Free carat ↔ ratti tool", "href": "/tools/carat-ratti"},
    },
    "categories": [
        {"key": "gemstone", "label": "Gemstones", "hindi": "रत्न"},
        {"key": "rudraksha", "label": "Rudraksha", "hindi": "रुद्राक्ष"},
        {"key": "bracelet", "label": "Bracelets", "hindi": "कड़ा"},
        {"key": "yantra", "label": "Yantras", "hindi": "यंत्र"},
        {"key": "idol", "label": "Idols", "hindi": "मूर्ति"},
        {"key": "prashad", "label": "Temple Prashad", "hindi": "प्रसाद"},
    ],
    "planets": [
        {"name": "Sun", "deva": "सूर्य", "stone": "Ruby"},
        {"name": "Moon", "deva": "चंद्र", "stone": "Pearl"},
        {"name": "Mars", "deva": "मंगल", "stone": "Red Coral"},
        {"name": "Mercury", "deva": "बुध", "stone": "Emerald"},
        {"name": "Jupiter", "deva": "गुरु", "stone": "Yellow Sapphire"},
        {"name": "Venus", "deva": "शुक्र", "stone": "Diamond"},
        {"name": "Saturn", "deva": "शनि", "stone": "Blue Sapphire"},
        {"name": "Rahu", "deva": "राहु", "stone": "Hessonite"},
        {"name": "Ketu", "deva": "केतु", "stone": "Cat's Eye"},
    ],
    "house": {
        "eyebrow": "The house · घर",
        "title": "Sourced by hand.\nSigned by us.",
        "body": "Our team walks the same mines in Ceylon, the same tantric ateliers in Kanchi, the same forests of Kathmandu that families have visited for generations. Every unit is intake-photographed, weighed, X-rayed where needed, and stored in the Tredev vault before it's ever offered for sale.",
        "bullets": [
            "First-party: we own every SKU we sell.",
            "Serialised: every unit gets a fingerprint.",
            "Reverent: priests, not marketers, do the pooja.",
        ],
    },
    "mantras": [
        "सत्यम् एव जयते", "न हि सत्यात् परो धर्मः", "ॐ नमः शिवाय",
        "शुभम् भवतु", "असतो मा सद्गमय", "सर्वे भवन्तु सुखिनः",
    ],
    "testimonials": [
        {"by": "Priya S., Mumbai", "rating": 5, "title": "Trust is what won me over", "body": "The Pukhraj arrived with a signed certificate I could actually verify. I've never felt more sure about a stone in 15 years."},
        {"by": "Arjun T., Bengaluru", "rating": 5, "title": "Beautiful Sri Yantra", "body": "Energised at Kanchi as promised. Pooja recording was a lovely touch."},
        {"by": "Neha K., Delhi", "rating": 5, "title": "The QR sold me", "body": "I scanned before opening. Seeing the temple video and lab report right there is next-level."},
    ],
    "posts": [
        {"title": "How to wear a Yellow Sapphire (Pukhraj) — a complete guide", "tag": "Guides", "link": ""},
        {"title": "Rudraksha mukhi meanings — 1 through 21", "tag": "Rudraksha", "link": ""},
        {"title": "Why Tredev signs every certificate with Ed25519", "tag": "Trust", "link": ""},
    ],
    "trustBadges": [
        {"abbr": "GJEPC", "name": "Gem & Jewellery Export Promotion Council"},
        {"abbr": "GIA", "name": "Gemological Institute of America"},
        {"abbr": "IGI", "name": "International Gemological Institute"},
        {"abbr": "BIS", "name": "Bureau of Indian Standards"},
    ],
    "marketplaces": [
        {"name": "Amazon", "url": ""},
        {"name": "Flipkart", "url": ""},
        {"name": "Myntra", "url": ""},
        {"name": "Blinkit", "url": ""},
    ],
}
_DEFAULT_CONSULTATION = {"fee_paise": 39900}   # ₹399 — admin-editable via /admin/site-content/consultation

# The "Primary Purpose" a buyer states for a video Pooja Energization — the intention
# the priest names in the sankalp. Deliberately SEPARATE from _DEFAULT_PURPOSES, which
# is the "Shop by Purpose" browsing taxonomy: those drive category links and are worded
# for merchandising, so folding the two together would make a navigation edit silently
# rewrite the pooja form (and vice versa).
_DEFAULT_POOJA_PURPOSES = [
    {"key": "career", "label": "Career & Business"},
    {"key": "health", "label": "Health & Healing"},
    {"key": "marriage", "label": "Marriage & Relationships"},
    {"key": "wealth", "label": "Wealth & Prosperity"},
    {"key": "education", "label": "Education & Focus"},
    {"key": "protection", "label": "Protection from Negativity"},
    {"key": "spiritual", "label": "Spiritual Growth"},
    {"key": "other", "label": "Other"},
]
_CONTENT_DEFAULTS = {
    "announcement": _DEFAULT_ANNOUNCEMENT, "footer": _DEFAULT_FOOTER,
    "home": _DEFAULT_HOME,
    "purposes": _DEFAULT_PURPOSES, "rashi": _DEFAULT_RASHI,
    "pooja_purposes": _DEFAULT_POOJA_PURPOSES,
    "consultation": _DEFAULT_CONSULTATION,
}
_CONTENT_KEYS = {"announcement", "footer", "home", "consultation"}   # gated by the "content" permission
_TAXONOMY_KEYS = {"purposes", "rashi", "pooja_purposes"}   # gated by the "taxonomy" permission


async def _site_content(key: str):
    """Stored value for a content key, or its built-in default if unset/blank."""
    row = await db.fetch_val("SELECT value FROM site_content WHERE key = $1", key)
    return row if row else _CONTENT_DEFAULTS.get(key)


_POOJA_GENDERS = {"male", "female", "other"}
_POOJA_TEXT_MAX = 200  # sanity cap on free-text fields — this isn't a storage hole


async def _validated_pooja_details(details: Optional[PoojaDetailsIn]) -> dict:
    """Cross-checks buyer-submitted wearer details against the current purpose
    taxonomy and basic sanity rules, and snapshots the purpose's label at purchase
    time (so a later admin edit to pooja_purposes can't retroactively change what
    was sankalp'd). Raises 400 on anything invalid."""
    if not details:
        raise HTTPException(400, "Wearer details are required for this Pooja Energization option")
    name = details.name.strip()[:_POOJA_TEXT_MAX]
    dob_raw = details.dob.strip()
    birth_place = details.birth_place.strip()[:_POOJA_TEXT_MAX]
    birth_time = details.birth_time.strip()[:10]
    gender = details.gender.strip().lower()
    gotra = details.gotra.strip()[:_POOJA_TEXT_MAX]
    purpose_key = details.purpose.strip()
    if not name or not dob_raw or not birth_place or not gender or not purpose_key:
        raise HTTPException(
            400, "Name, date of birth, birth place, gender and purpose are required")
    try:
        dob = date.fromisoformat(dob_raw)
    except ValueError:
        raise HTTPException(400, "Date of birth must be a valid date (YYYY-MM-DD)")
    if dob >= date.today():
        raise HTTPException(400, "Date of birth must be in the past")
    if birth_time and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", birth_time):
        raise HTTPException(400, "Birth time must be HH:MM (24-hour)")
    if gender not in _POOJA_GENDERS:
        raise HTTPException(400, f"Gender must be one of {sorted(_POOJA_GENDERS)}")
    purposes = await _site_content("pooja_purposes")
    match = next((p for p in (purposes or []) if p.get("key") == purpose_key), None)
    if not match:
        raise HTTPException(400, "Unknown pooja purpose")
    return {
        "name": name, "dob": dob.isoformat(), "birth_place": birth_place,
        "birth_time": birth_time, "gender": gender, "gotra": gotra,
        "purpose": purpose_key, "purpose_label": match.get("label", purpose_key),
    }


async def _categories_body() -> dict:
    db_cats = await _list_categories()
    return {
        "categories": db_cats,
        "planets": ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"],
        "purposes": await _site_content("purposes"),
        "rashi": await _site_content("rashi"),
    }


@api.get("/categories")
async def categories():
    # Same for every visitor, changes only via admin category/taxonomy edits —
    # cached with a 5-minute TTL and invalidated immediately on those writes.
    return await respcache.get_or_set("categories", ttl=300, tag="categories",
                                      compute=_categories_body)


async def _site_content_body() -> dict:
    rows = await db.fetch_all("SELECT key, value FROM site_content")
    stored = {r["key"]: r["value"] for r in rows}
    return {k: (stored.get(k) or default) for k, default in _CONTENT_DEFAULTS.items()}


@api.get("/site-content")
async def site_content_public():
    """All buyer-facing editable content in one call — the frontend fetches this once."""
    return await respcache.get_or_set("site_content", ttl=300, tag="site_content",
                                      compute=_site_content_body)


class SiteContentIn(BaseModel):
    value: Any  # the JSON block for this key (shape depends on the key)


async def _upsert_content(key: str, value) -> None:
    await db.execute(
        """INSERT INTO site_content (key, value, updated_at) VALUES ($1,$2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        key, value)
    # Shared choke point for both /admin/site-content/{key} and /admin/taxonomy/{name}
    # (taxonomy keys live in the same table) — invalidate both cached bodies that read
    # from site_content, whichever key this was.
    respcache.invalidate("site_content")
    respcache.invalidate("categories")


@api.get("/admin/site-content")
async def admin_site_content(_: str = Depends(require_perm("content"))):
    """Announcement + footer content for the Website editor, each with its current
    (stored or default) value so the form is always populated."""
    rows = await db.fetch_all("SELECT key, value FROM site_content WHERE key = ANY($1)",
                              list(_CONTENT_KEYS))
    stored = {r["key"]: r["value"] for r in rows}
    return {k: (stored.get(k) or _CONTENT_DEFAULTS[k]) for k in _CONTENT_KEYS}


@api.put("/admin/site-content/{key}")
async def admin_put_site_content(key: str, body: SiteContentIn,
                                 actor: str = Depends(require_perm("content"))):
    if key not in _CONTENT_KEYS:
        raise HTTPException(400, f"Unknown content key. Allowed: {sorted(_CONTENT_KEYS)}")
    await _upsert_content(key, body.value)
    await audit_log(actor, "site_content.update", key, {})
    return {"ok": True, "key": key, "value": await _site_content(key)}


@api.get("/admin/taxonomy")
async def admin_taxonomy(_: str = Depends(require_perm("taxonomy"))):
    """The editable purposes + rashi lists (stored or default)."""
    return {k: await _site_content(k) for k in _TAXONOMY_KEYS}


@api.put("/admin/taxonomy/{name}")
async def admin_put_taxonomy(name: str, body: SiteContentIn,
                             actor: str = Depends(require_perm("taxonomy"))):
    if name not in _TAXONOMY_KEYS:
        raise HTTPException(400, f"Unknown taxonomy. Allowed: {sorted(_TAXONOMY_KEYS)}")
    # Normalise to a clean [{key,label}] list: label required, key slugified from it
    # if missing, duplicates and blanks dropped. Rashi additionally carries the
    # mapped stone name + an optional page URL (custom link, else the shop filter
    # is used as the default destination on the frontend).
    items, seen = [], set()
    for it in (body.value or []):
        label = (it.get("label") or "").strip()
        if not label:
            continue
        k = (it.get("key") or "").strip().lower() or _slugify(label).replace("-", "_")
        if not k or k in seen:
            continue
        seen.add(k)
        entry = {"key": k, "label": label}
        if name == "rashi":
            entry["stone"] = (it.get("stone") or "").strip()
            entry["url"] = (it.get("url") or "").strip()
        items.append(entry)
    await _upsert_content(name, items)
    await audit_log(actor, "taxonomy.update", name, {"count": len(items)})
    return {"ok": True, "name": name, "items": items}


# ── Admin: product/unit/cert ──────────────────────────────────────────────────
def _serial_prefix(slug: str, category_key: str) -> str:
    """Compact, readable serial prefix from the product slug (fallback: category)."""
    base = re.sub(r"[^A-Za-z0-9]", "", (slug or category_key or "ITEM")).upper()
    return base[:8] or "ITEM"


_BULK_INSERT_CHUNK = 500  # keeps each bulk INSERT's array params small


async def _generate_units(conn, product_id: str, slug: str, category_key: str,
                          variant_id, unit_price, qty: int):
    """Auto-create `qty` product_units with sequential, collision-safe serial numbers.

    Numbering continues after any units the product already has, so re-stocking a
    product doesn't reuse serials. serial_no is globally unique: existing serials
    sharing this prefix are fetched once so collisions are resolved in Python instead
    of one probe query per unit, then all rows are bulk-inserted via unnest().
    """
    prefix = _serial_prefix(slug, category_key)
    seq = await conn.fetchval(
        "SELECT count(*) FROM product_units WHERE product_id = $1::uuid", product_id)
    existing = {r["serial_no"] for r in await conn.fetch(
        "SELECT serial_no FROM product_units WHERE serial_no LIKE $1", f"{prefix}-%")}
    # clock_timestamp(), not now(): units created in one txn must get distinct
    # created_at so ORDER BY created_at stays deterministic (see admin_create_unit).
    # Fetched once and offset in Python rather than re-evaluated per row, so ordering
    # doesn't depend on how the executor evaluates volatile functions in a bulk insert.
    base_ts = await conn.fetchval("SELECT clock_timestamp()")

    created = []
    ids, serials, created_ats = [], [], []
    for i in range(max(0, qty)):
        serial = None
        for _attempt in range(50):
            seq += 1
            candidate = f"{prefix}-{seq:04d}"
            if candidate not in existing:
                serial = candidate
                break
        if serial is None:
            serial = f"{prefix}-{seq:04d}-{secrets.token_hex(2).upper()}"
        existing.add(serial)
        unit_id = uuid.uuid4()
        ids.append(unit_id)
        serials.append(serial)
        created_ats.append(base_ts + timedelta(microseconds=i))
        created.append({"unit_id": str(unit_id), "serial": serial})

    for start in range(0, len(ids), _BULK_INSERT_CHUNK):
        end = start + _BULK_INSERT_CHUNK
        await conn.execute(
            """INSERT INTO product_units (id, product_id, variant_id, serial_no, status,
                    verification_state, unit_price, created_at)
               SELECT u.id, $4::uuid, $5, u.serial_no, 'in_stock', 'unverified', $6, u.created_at
                 FROM unnest($1::uuid[], $2::text[], $3::timestamptz[]) AS u(id, serial_no, created_at)""",
            ids[start:end], serials[start:end], created_ats[start:end],
            product_id, variant_id, unit_price)
    return created


# ── Product option groups (the buyer-facing selectors) ────────────────────────
# What a product offers is decided by its CATEGORY; the ₹ surcharges on each choice
# are then set per product by an admin. The first choice of every group is the
# default and is always free, so a buyer who touches nothing pays exactly base_price.
#
# Mantra Jaap is an add-on ritual that applies to every category, so it's appended
# to every template by _category_option_template() rather than repeated below.
_MANTRA_JAAP_GROUP = {
    "key": "mantra_jaap", "label": "Mantra Jaap", "type": "dropdown",
    "choices": [
        {"label": "No Mantra Jaap", "surcharge": 0},
        {"label": "111 Mantra Jaap", "surcharge": 0},
        {"label": "2100 Mantra Jaap", "surcharge": 0},
        {"label": "5100 Mantra Jaap", "surcharge": 0},
        {"label": "11000 Mantra Jaap", "surcharge": 0},
        {"label": "21000 Mantra Jaap", "surcharge": 0},
        {"label": "51000 Mantra Jaap", "surcharge": 0},
    ],
}

_METALS = ["18k Gold", "22k Gold", "Silver", "Panchdhatu"]

# Keyed by DB category_key. Categories absent here (books, idols, prashad, digital,
# gemstone_jewellery, mala, yantra) intentionally get Mantra Jaap only — jewellery and
# malas are pre-made, and yantras have no variants.
_CATEGORY_OPTION_TEMPLATES: dict[str, list[dict]] = {
    "rudraksha": [
        {"key": "certification", "label": "Certification", "type": "dropdown",
         "choices": [{"label": "Without certification", "surcharge": 0},
                     {"label": "With certification", "surcharge": 0}]},
        {"key": "style", "label": "Style", "type": "dropdown",
         "choices": [{"label": "Without silver pendant", "surcharge": 0},
                     {"label": "With silver pendant", "surcharge": 0}]},
        {"key": "size", "label": "Size", "type": "dropdown",
         "choices": [{"label": "Regular", "surcharge": 0}]},
    ],
    "gemstone": [
        {"key": "pooja_energization", "label": "Pooja Energization", "type": "dropdown",
         "choices": [
             {"label": "SHUDH - Basic Energization", "surcharge": 0},
             {"label": "SHUDH - Vedic Pooja with Video (Extra 2 Day)", "surcharge": 0},
             {"label": "SHUDH - Prana Pratishta Pooja with Video (Extra 2 Day)", "surcharge": 0},
         ]},
        # Form and Metal are unpriced: they narrow down *which* designs apply, and the
        # chosen design carries the whole mounting price for that metal.
        {"key": "form", "label": "Form", "type": "buttons", "priced": False,
         "choices": [{"label": "Loose Gemstone", "surcharge": 0},
                     {"label": "Ring", "surcharge": 0},
                     {"label": "Pendant", "surcharge": 0}]},
        # A loose stone isn't mounted, so metal only matters once it's a Ring/Pendant.
        {"key": "metal", "label": "Metal", "type": "buttons", "priced": False,
         "show_if": {"group": "form", "values": ["Ring", "Pendant"]},
         "choices": [{"label": m, "surcharge": 0} for m in _METALS]},
    ],
    "gem_bracelet": [
        {"key": "size", "label": "Size", "type": "dropdown",
         "choices": [{"label": "8mm", "surcharge": 0}, {"label": "10mm", "surcharge": 0}]},
    ],
}

# The two "video" Pooja Energization choices that require wearer/sankalp details —
# "SHUDH - Basic Energization" is the free default on every gemstone and needs none.
# Single source of truth: cart_add's pooja_details validation reads this, nothing else.
_POOJA_VIDEO_LABELS = {
    "SHUDH - Vedic Pooja with Video (Extra 2 Day)",
    "SHUDH - Prana Pratishta Pooja with Video (Extra 2 Day)",
}

_OPTION_GROUP_TYPES = {"dropdown", "buttons", "images"}

# Ring sizing is an international standard, not per-product data, so the scales are
# fixed here. "I don't know" is a deliberate escape hatch: the buyer isn't blocked from
# ordering, the order is flagged instead and staff follow up (see _line_flags).
_RING_SIZE_UNKNOWN = "I don't know"
_RING_SIZE_SYSTEMS = ["Indian", "US", _RING_SIZE_UNKNOWN]
_INDIAN_RING_SIZES = [str(n) for n in range(1, 31)]           # 1–30
# 3–13 in half steps, rendered as "3", "3.5", … (not "3.0").
_US_RING_SIZES = [f"{x / 2:g}" for x in range(6, 27)]


def _category_option_template(category_key: str) -> dict:
    """The default variant_options for a category — its own groups plus Mantra Jaap
    (which every category offers). Returned with all surcharges at 0 for the admin to
    price. Deep-copied so callers can mutate freely."""
    groups = copy.deepcopy(_CATEGORY_OPTION_TEMPLATES.get(category_key, []))
    groups.append(copy.deepcopy(_MANTRA_JAAP_GROUP))
    return {"groups": groups}


def _normalize_variant_options(vo: dict) -> dict:
    """Raw variant_options dict (from VariantOptionsIn.model_dump(), used both at create
    and via the PATCH path) -> the jsonb dict stored on products.variant_options.

    Surcharges are clamped non-negative and stored in paise (the API's money unit —
    jsonb has no numeric type of its own, so this keeps the same convention as every
    other price field). A choice may also carry `surcharge_usd` (cents) — shown/
    charged to visitors outside India, same binary INR/USD rule as `products.price_usd`
    and `astrologers.price_usd`. The first choice of
    each group is forced free because it's the default a buyer lands on — the base
    price already covers it — except for `optional` groups, which preselect nothing.
    Unpriced groups (Form, Metal) are zeroed entirely. Groups with fewer than two
    choices are dropped: a selector with one option isn't a choice, it's noise.
    """
    groups = []
    for g in (vo.get("groups") or []):
        key = (g.get("key") or "").strip()
        label = (g.get("label") or "").strip()
        if not key or not label:
            continue
        priced = g.get("priced", True)
        choices = []
        for c in (g.get("choices") or []):
            clabel = (c.get("label") or "").strip()
            if not clabel:
                continue
            choice = {"label": clabel,
                      "surcharge": max(0, int(c.get("surcharge") or 0)) if priced else 0}
            if priced and c.get("surcharge_usd") is not None:
                choice["surcharge_usd"] = max(0, int(c["surcharge_usd"]))
            for extra in ("image", "note"):  # carried through for the images grid
                if c.get(extra):
                    choice[extra] = c[extra]
            choices.append(choice)
        # Drop duplicate labels — selected_options stores the label, so it must be unique.
        seen, deduped = set(), []
        for c in choices:
            if c["label"] not in seen:
                seen.add(c["label"])
                deduped.append(c)
        if len(deduped) < 2:
            continue
        optional = bool(g.get("optional"))
        if not optional:
            deduped[0]["surcharge"] = 0  # the default is always free
            deduped[0].pop("surcharge_usd", None)
        gtype = g.get("type") if g.get("type") in _OPTION_GROUP_TYPES else "dropdown"
        out = {"key": key, "label": label, "type": gtype, "choices": deduped}
        if optional:
            out["optional"] = True
        if not priced:
            out["priced"] = False
        si = g.get("show_if")
        if si and (si.get("group") or "").strip():
            out["show_if"] = {"group": si["group"].strip(), "values": list(si.get("values") or [])}
        groups.append(out)
    return {"groups": groups}


def _visible_groups(groups: list[dict], selected: Dict[str, str]) -> list[dict]:
    """The groups that actually apply given the buyer's picks so far, with each group's
    choices narrowed to the ones available for those picks.

    A group with `show_if` only counts when its controlling group is itself visible AND
    currently holds one of the listed values — so Metal/Designs vanish for a Loose
    Gemstone, and the Indian size list vanishes unless the Indian system is chosen.
    Evaluated in declaration order, so a group can only depend on an earlier one.

    Choices tagged with `metal` are filtered to the chosen metal. That's load-bearing,
    not cosmetic: the same design code exists once per metal ("R14" in 18k and in 22k
    are separate rows at different prices), and selected_options records only the label
    — so without this filter, pricing would match whichever R14 came first and could
    charge the gold price for a silver ring.
    """
    visible: list[dict] = []
    values: Dict[str, str] = {}
    for g in groups:
        si = g.get("show_if")
        if si:
            parent = si["group"]
            if parent not in values or values[parent] not in (si.get("values") or []):
                continue  # parent hidden, unset, or holding a value that doesn't apply
        choices = [c for c in (g.get("choices") or [])
                   if not c.get("metal") or c["metal"] == values.get("metal")]
        if not choices:
            continue  # nothing available for this metal
        g = {**g, "choices": choices}
        visible.append(g)
        picked = selected.get(g["key"])
        if picked is not None and any(c["label"] == picked for c in choices):
            values[g["key"]] = picked
        elif not g.get("optional"):
            values[g["key"]] = choices[0]["label"]  # its default
    return visible


def _compute_variant_price(base_price: Decimal, base_price_usd: Optional[Decimal],
                           variant_options: Optional[dict], options: Dict[str, str],
                           currency: str = "INR") -> tuple[Decimal, dict, bool]:
    """base price + the surcharge of each selected choice, across the groups that apply.

    Returns (unit_price, resolved_options, ok). resolved_options is the buyer's picks
    filled in with each group's default for anything they didn't choose — so what gets
    stored on the cart/order line is always complete and self-describing. Hidden groups
    are skipped entirely: a Loose Gemstone can't be charged for a ring's metal, no
    matter what the client sends. Always run server-side: the client supplies *choices*,
    never a price, so this is the only place a cart/order line's price is decided.

    `currency` is either "INR" (unchanged behaviour) or "USD" (region_pricing's only
    other checkout currency — see _compute_variant_price's caller for why). In USD mode
    `ok` is False when the product has no USD base price, or a *paid* selected choice
    has no `surcharge_usd` — there's no per-currency matrix for choices/designs, only
    USD, so anything without it can't be safely priced outside INR. Callers must refuse
    the add/checkout rather than use `unit_price` when `ok` is False.
    """
    use_usd = currency == "USD"
    if use_usd and base_price_usd is None:
        return Decimal(0), {}, False
    total = base_price_usd if use_usd else base_price
    resolved: dict[str, str] = {}
    ok = True
    for g in _visible_groups(((variant_options or {}).get("groups") or []), options):
        choices = g.get("choices") or []
        if not choices:
            continue
        picked_label = options.get(g["key"])
        if picked_label is None or picked_label == "":
            if g.get("optional"):
                continue  # nothing picked and nothing required — e.g. ring size left blank
            choice = choices[0]  # untouched selector -> its free default
        else:
            choice = next((c for c in choices if c["label"] == picked_label), None)
            if choice is None:
                raise HTTPException(
                    400, f"Unknown {g.get('label', g['key'])} option: {picked_label}")
        resolved[g["key"]] = choice["label"]
        surcharge = choice.get("surcharge") or 0
        if use_usd:
            surcharge_usd = choice.get("surcharge_usd")
            if surcharge > 0 and surcharge_usd is None:
                ok = False
                continue
            total += db.to_amount(surcharge_usd or 0)
        else:
            total += db.to_amount(surcharge)
    return total, resolved, ok


def _shape_selected_options(selected: Optional[dict], variant_options: Optional[dict]) -> list[dict]:
    """selected_options map -> an ordered [{key,label,value,is_default}] list.

    selected_options is a jsonb object, so it has no reliable key order and the labels
    alone don't say which pick was the free default. Resolving against the product's
    groups here gives both: customer views hide the defaults ("Without certification"
    on every line is noise), while the admin/dispatch view shows all of them — staff
    still need to know it's a "Loose Gemstone" even though that's the default.
    Only groups that applied to this line are listed.
    """
    sel = selected or {}
    out = []
    for g in _visible_groups(((variant_options or {}).get("groups") or []), sel):
        choices = g.get("choices") or []
        if not choices:
            continue
        default = None if g.get("optional") else choices[0]["label"]
        value = sel.get(g["key"], default)
        if value is None:
            continue  # optional group the buyer left blank
        out.append({"key": g["key"], "label": g["label"], "value": value,
                    "is_default": value == default})
    return out


def _build_design_groups(rows: list[dict]) -> list[dict]:
    """jewellery_designs rows for ONE product -> its Designs pickers.

    Designs are per product — a sapphire offers the sapphire's ring/pendant designs, not
    every gemstone's. There's one row per metal, each carrying the full flat price of
    that mounting, which is why Form and Metal themselves are unpriced: pick Ring + 22k
    Gold and the grid narrows to the 22k rows whose price already covers the gold.
    Rings and pendants get separate groups because they draw from different sets.
    """
    groups = []
    for form, key, label in (("ring", "ring_design", "Designs"),
                             ("pendant", "pendant_design", "Designs")):
        choices = []
        for r in rows:
            if r["applies_to"] != form:
                continue
            c = {"label": r["code"], "surcharge": db.to_paise(r["price"]) or 0,
                 "metal": r["metal"]}
            usd = db.to_paise(r.get("price_usd"))
            if usd is not None:
                c["surcharge_usd"] = usd
            if r["image_url"]:
                c["image"] = r["image_url"]
            if r["note"]:
                c["note"] = r["note"]
            choices.append(c)
        if not choices:
            continue
        groups.append({
            "key": key, "label": label, "type": "images", "optional": True,
            "show_if": {"group": "form", "values": [form.capitalize()]},
            "choices": choices,
        })
    return groups


async def _design_groups_for_products(product_ids: list[str], conn=None) -> dict[str, list[dict]]:
    """Design groups for many products in one query, keyed by product id.

    Batched because carts and order pages render many lines: fetching per line would be
    an N+1 against a table every gemstone page touches."""
    ids = [p for p in set(product_ids) if p]
    if not ids:
        return {}
    sql = """SELECT product_id::text AS product_id, code, applies_to, metal,
                    image_url, price, price_usd, note
               FROM jewellery_designs
              WHERE is_active AND product_id = ANY($1::uuid[])
              ORDER BY applies_to, sort_order, code"""
    rows = (db._rows(await conn.fetch(sql, ids)) if conn else await db.fetch_all(sql, ids))
    by_product: dict[str, list[dict]] = {}
    for r in rows:
        by_product.setdefault(r["product_id"], []).append(r)
    return {pid: _build_design_groups(rs) for pid, rs in by_product.items()}


async def _design_groups_for_product(product_id: str, conn=None) -> list[dict]:
    return (await _design_groups_for_products([product_id], conn)).get(product_id, [])


def _ring_size_groups() -> list[dict]:
    """Ring Size System + the two scale-specific size lists. All optional: nothing is
    preselected, and "I don't know" lets the buyer through without a size (the order is
    flagged for a callback instead — see _line_flags)."""
    free = lambda labels: [{"label": l, "surcharge": 0, "surcharge_pct": 0.0} for l in labels]
    return [
        {"key": "ring_size_system", "label": "Ring Size System", "type": "dropdown",
         "optional": True, "show_if": {"group": "form", "values": ["Ring"]},
         "choices": free(_RING_SIZE_SYSTEMS)},
        {"key": "indian_ring_size", "label": "Select Indian Ring Size", "type": "dropdown",
         "optional": True, "show_if": {"group": "ring_size_system", "values": ["Indian"]},
         "choices": free(_INDIAN_RING_SIZES)},
        {"key": "us_ring_size", "label": "Select US Ring Size", "type": "dropdown",
         "optional": True, "show_if": {"group": "ring_size_system", "values": ["US"]},
         "choices": free(_US_RING_SIZES)},
    ]


def _effective_variant_options(category_key: str, variant_options: Optional[dict],
                               design_groups: Optional[list[dict]] = None) -> dict:
    """The product's stored groups plus the ones that aren't per-product data.

    Designs come from a shared catalog and ring sizes are fixed standards, so neither is
    stored on the product — they're merged in here instead, which keeps a single source
    of truth and means every read path (product page, cart pricing, order shaping) sees
    the same option set. Injected after Metal so the page reads Form → Metal → Designs →
    Ring Size, as designed. Pure/sync so the per-line shapers can call it freely; pass
    design_groups from _design_groups_for_product(s)().
    """
    groups = copy.deepcopy((variant_options or {}).get("groups") or [])
    if category_key != "gemstone":
        return {"groups": groups}
    dynamic = copy.deepcopy(design_groups or []) + _ring_size_groups()
    idx = next((i + 1 for i, g in enumerate(groups) if g["key"] == "metal"), None)
    if idx is None:
        idx = next((i for i, g in enumerate(groups) if g["key"] == "mantra_jaap"), len(groups))
    groups[idx:idx] = dynamic
    return {"groups": groups}


def _line_flags(selected: Optional[dict], variant_options: Optional[dict]) -> list[str]:
    """Fulfilment warnings for a cart/order line.

    `ring_size_unknown` fires when a ring is ordered without a usable size — either the
    buyer picked "I don't know" or left the size blank. Staff can't dispatch a ring they
    can't size, so the admin panel surfaces this as a red tag to trigger a callback.
    """
    sel = selected or {}
    flags = []
    visible = _visible_groups(((variant_options or {}).get("groups") or []), sel)
    keys = {g["key"] for g in visible}
    if "ring_size_system" in keys:
        system = sel.get("ring_size_system")
        sized = sel.get("indian_ring_size") or sel.get("us_ring_size")
        if system == _RING_SIZE_UNKNOWN or not system or not sized:
            flags.append("ring_size_unknown")
    return flags


async def _resolve_category_id(ck: str, subcategory_id: Optional[str]) -> str:
    """The category row a product files under: the sub if given & valid, else the
    top-level. `ck` (the enum type) can match several rows now that subs share it, so
    the top-level is the one with parent_id NULL, and a sub must be its child."""
    top = await db.fetch_val(
        "SELECT id::text FROM categories WHERE category_key = $1::category_key "
        "AND parent_id IS NULL", ck)
    if not top:
        raise HTTPException(400, "Category not configured")
    if not subcategory_id:
        return top
    sub = await db.fetch_val(
        "SELECT id::text FROM categories WHERE id = $1::uuid AND parent_id = $2::uuid",
        subcategory_id, top)
    if not sub:
        raise HTTPException(400, "That subcategory doesn't belong to the chosen category.")
    return sub


@api.post("/admin/products")
async def admin_create_product(p: ProductIn, user_id: str = Depends(require_admin)):
    ck = db.CATEGORY_TO_DB.get(p.category)
    if not ck:
        raise HTTPException(400, f"Unknown category: {p.category}")
    cat_id = await _resolve_category_id(ck, p.subcategory_id)
    pid = uuid.uuid4()
    try:
        async with db.transaction() as conn:
            await conn.execute(
                """INSERT INTO products (id, category_id, category_key, title,
                        title_devanagari, slug, description, base_price, price_usd,
                        compare_at_price, currency, is_serialized, attributes,
                        shipping_charges, care_instructions,
                        variant_options, status, published_at)
                   VALUES ($1,$2::uuid,$3::category_key,$4,$5,$6::citext,$7,$8,$9,$10,'INR',$11,
                           $12,$13,$14,$15,'active', now())""",
                pid, cat_id, ck, p.name, p.devanagari_name, p.slug, p.description,
                db.to_amount(p.price), db.to_amount(p.price_usd), db.to_amount(p.mrp), p.is_serialized,
                p.attrs or {}, p.shipping_charges or {},
                [s.strip() for s in p.care_instructions if s and s.strip()],
                # No variant_options sent -> fall back to the category's template, so a
                # product always offers the right selectors even via a bare API call.
                # Normalized either way, so both paths behave identically (notably:
                # single-choice groups get dropped).
                _normalize_variant_options(
                    p.variant_options.model_dump() if p.variant_options is not None
                    else _category_option_template(ck)))
            # cart_items/order_items require a variant, so every product needs one.
            variant_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO product_variants (id, product_id, sku, variant_name, price,
                        compare_at_price, stock_qty, track_inventory, is_active)
                   VALUES ($1,$2,$3,'Standard',$4,$5,$6,$7,true)""",
                variant_id, pid, p.slug[:24].upper().replace("-", "_") + "-STD",
                db.to_amount(p.price), db.to_amount(p.mrp),
                None if p.is_serialized else 0, not p.is_serialized)
            # Serialized products stock as individual units — auto-generate the
            # requested number of pieces, each with its own serial number.
            if p.is_serialized and p.quantity > 0:
                await _generate_units(conn, str(pid), p.slug, ck, variant_id,
                                      db.to_amount(p.price), p.quantity)
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
        log.warning(f"product create unique violation: {e}")
        raise HTTPException(400, "A product with that slug already exists")
    await audit_log(user_id, "product.create", str(pid),
                    {"name": p.name, "slug": p.slug, "category": p.category, "price": p.price})
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
        log.warning(f"unit create unique violation: {e}")
        raise HTTPException(400, "A unit with that serial already exists")
    await audit_log(user_id, "unit.create", str(unit_id),
                    {"serial": u.serial, "product_id": u.product_id})
    return {"unit_id": str(unit_id), "product_id": u.product_id, "serial": u.serial,
            "weight_carat": u.weight_carat, "origin": u.origin, "notes": u.notes,
            "status": "available", "created_at": iso(now())}


@api.post("/admin/units/bulk")
async def admin_create_units_bulk(b: BulkUnitsIn, user_id: str = Depends(require_admin)):
    """Stock N pieces of a product at once, auto-generating serial numbers for each."""
    if b.quantity < 1 or b.quantity > 500:
        raise HTTPException(400, "Quantity must be between 1 and 500")
    prod = await db.fetch_one(
        """SELECT p.id::text AS product_id, p.slug::text AS slug,
                  p.category_key::text AS category_key, p.base_price, p.is_serialized,
                  (SELECT v.id FROM product_variants v WHERE v.product_id = p.id
                    ORDER BY v.created_at LIMIT 1) AS variant_id
             FROM products p WHERE p.id = $1::uuid AND p.deleted_at IS NULL""",
        b.product_id)
    if not prod:
        raise HTTPException(404, "Product not found")
    if not prod["is_serialized"]:
        raise HTTPException(400, "Product is not serialized — set stock quantity instead")
    async with db.transaction() as conn:
        created = await _generate_units(
            conn, prod["product_id"], prod["slug"], prod["category_key"],
            prod["variant_id"], prod["base_price"], b.quantity)
    await audit_log(user_id, "unit.bulk_create", b.product_id,
                    {"slug": prod["slug"], "count": len(created)})
    return {"product_id": b.product_id, "count": len(created), "units": created}


async def _issue_certificate_tx(conn, unit: dict, body, issued_by_user_id: str) -> str:
    """Sign and persist an authenticity certificate for one unit, inside a transaction.

    `unit` carries unit_id/serial/product_id/product_name; `body` supplies the lab,
    temple, priest and mantra fields (CertificateIssueIn or DispatchIn both fit).
    Returns the new certificate id. The QR is minted 'pending' — the caller activates
    it at dispatch. Shared by intake issuance and dispatch-time issuance.
    """
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
        lab_id, unit["unit_id"], body.lab_name, body.lab_report_no)

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
            en_id, unit["unit_id"], temple_id, priest_id,
            datetime.fromisoformat(body.energization_date).replace(tzinfo=timezone.utc)
            if body.energization_date else None,
            [body.mantra] if body.mantra else [])

    await conn.execute(
        """INSERT INTO authenticity_certificates (id, product_unit_id, certificate_no,
                issuing_authority, issued_by_user_id, issued_at, lab_certification_id,
                energization_certificate_id, temple_id, signing_key_id, signed_payload,
                content_hash, signature, verify_code)
           VALUES ($1,$2::uuid,$3,'Tredev',$4::uuid, now(),$5,$6,$7,$8,$9,$10,$11,$12)""",
        cert_id, unit["unit_id"], f"TDV-{secrets.token_hex(4).upper()}", issued_by_user_id,
        lab_id, en_id, temple_id, signing_key_id, payload, chash, signature,
        short_code(chash))

    # QR gap: minted now, but only activated at dispatch.
    await conn.execute(
        """INSERT INTO qr_codes (id, product_unit_id, authenticity_certificate_id,
                token, status)
           VALUES ($1,$2::uuid,$3,$4,'pending')""",
        uuid.uuid4(), unit["unit_id"], cert_id, f"qr_{uuid.uuid4().hex[:16]}")
    return str(cert_id)


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
    async with db.transaction() as conn:
        cert_id = await _issue_certificate_tx(conn, unit, body, user_id)
    await audit_log(user_id, "certificate.issue", str(cert_id),
                    {"serial": unit["serial"], "product_name": unit.get("product_name"),
                     "lab": body.lab_name, "temple": body.temple_name})
    return _shape_cert(await db.fetch_one(
        _CERT_SELECT + " WHERE ac.id = $1::uuid", cert_id))


# ── Public verification (crown jewel) ─────────────────────────────────────────
# The flat `cert` object the frontend renders. Rebuilt from the signed payload plus
# the mutable state columns — never by excluding keys from a row (the old
# server.py:1208 approach, which broke the moment a column was added).
_CERT_SELECT = """
    SELECT ac.id::text            AS cert_id,
           ac.signed_payload      AS signed_payload,
           ac.content_hash        AS content_hash_sha256,
           ac.signature           AS signature_ed25519_hex,
           ac.verify_code         AS verify_code,
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
            "verify_code": row.get("verify_code"),
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
async def qr_image(qr_token: str, request: Request):
    # Encode an ABSOLUTE verify URL so a phone camera opens the page directly. A bare
    # "/verify/..." is a relative path — scanners can't resolve it to a link and treat
    # it as plain text (which is why a scan ends up as a web search). PUBLIC_APP_URL is
    # the frontend origin (where the /verify/:token route lives); fall back to the
    # request host so the QR is never relative even if the env var is unset.
    base = os.environ.get("PUBLIC_APP_URL", "").rstrip("/") or str(request.base_url).rstrip("/")
    url = f"{base}/verify/{qr_token}"
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
               ci.selected_options               AS options,
               ci.pooja_details                  AS pooja_details,
               p.variant_options                 AS variant_options,
               p.category_key::text              AS category_key,
               p.title                           AS name,
               p.shipping_charges                AS shipping_charges,
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
    # One designs query for the whole cart, not one per line.
    designs = await _design_groups_for_products([r["product_id"] for r in rows], conn)
    out = []
    for r in rows:
        effective = _effective_variant_options(
            r["category_key"], r["variant_options"], designs.get(r["product_id"]))
        out.append({**{k: v for k, v in r.items()
                       if k not in ("unit_price_snapshot", "variant_options", "category_key")},
                    "options_list": _shape_selected_options(r["options"], effective),
                    "flags": _line_flags(r["options"], effective),
                    "price": db.to_paise(r["unit_price_snapshot"])})
    return out


async def _shape_cart(row: dict, conn=None) -> dict:
    return {"cart_id": row["cart_id"],
            "user_id": row.get("user_id"),
            "anon_key": row.get("anon_key"),
            "currency": (row.get("currency") or "INR").strip(),
            "items": await _cart_items(row["cart_id"], conn),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at")}


_CART_SELECT = """
    SELECT c.id::text        AS cart_id,
           c.user_id::text   AS user_id,
           c.session_token   AS anon_key,
           c.currency        AS currency,
           c.created_at      AS created_at,
           c.updated_at      AS updated_at
      FROM carts c
     WHERE c.status = 'active'
"""


async def _claim_anon_cart(user_id: str, anon_key: Optional[str]) -> None:
    """Hand a guest's session cart to the account they just created/logged into.

    Buying now requires an account, so the common path is: browse as a guest, add
    to cart, then sign up specifically to check out. Without this, that signup
    would land them back on an empty account cart — losing everything they just
    added. If the account already has its own non-empty cart, we leave the guest
    cart behind rather than silently merging quantities into it."""
    if not anon_key:
        return
    async with db.transaction() as conn:
        anon_cart = await conn.fetchrow(
            "SELECT id FROM carts WHERE session_token = $1 AND status = 'active'", anon_key)
        if not anon_cart:
            return
        user_cart = await conn.fetchrow(
            "SELECT id FROM carts WHERE user_id = $1::uuid AND status = 'active'", user_id)
        if user_cart:
            has_items = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM cart_items WHERE cart_id = $1)", user_cart["id"])
            if has_items:
                return
            await conn.execute("UPDATE carts SET status = 'converted' WHERE id = $1", user_cart["id"])
        await conn.execute(
            "UPDATE carts SET user_id = $1::uuid, session_token = NULL WHERE id = $2",
            user_id, anon_cart["id"])


async def _get_or_create_cart(user_id: Optional[str], anon_key: Optional[str],
                              currency: str = "INR") -> dict:
    """`currency` only matters the moment a cart is first created — an existing
    cart keeps whatever currency it started with, so a visitor's detected region
    flipping mid-session (VPN, etc.) can't silently reprice items already in it.
    The one exception: a still-EMPTY existing cart carries no repricing risk (there's
    nothing priced yet), so it's safe to re-point its currency at whatever's newly
    detected — this is what lets a stale cart (created before region detection
    settled, or from an earlier visit) recover once its items are removed."""
    if not user_id and not anon_key:
        # Mongo matched {"anon_key": None} here, which silently collided with any
        # cart lacking the field. Fail cleanly instead.
        raise HTTPException(400, "No cart context — sign in or enable cookies.")
    if user_id:
        row = await db.fetch_one(_CART_SELECT + " AND c.user_id = $1::uuid", user_id)
    else:
        row = await db.fetch_one(_CART_SELECT + " AND c.session_token = $1", anon_key)
    if row:
        if (row.get("currency") or "INR").strip() != currency:
            has_items = await db.fetch_val(
                "SELECT EXISTS(SELECT 1 FROM cart_items WHERE cart_id = $1::uuid)", row["cart_id"])
            if not has_items:
                await db.execute(
                    "UPDATE carts SET currency = $2, updated_at = now() WHERE id = $1::uuid",
                    row["cart_id"], currency)
                row["currency"] = currency
        return await _shape_cart(row)
    cart_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO carts (id, user_id, session_token, currency, status)
           VALUES ($1, $2::uuid, $3, $4, 'active')
           ON CONFLICT DO NOTHING""",
        cart_id, user_id, None if user_id else anon_key, currency)
    row = await db.fetch_one(
        _CART_SELECT + (" AND c.user_id = $1::uuid" if user_id else " AND c.session_token = $1"),
        user_id or anon_key)
    return await _shape_cart(row)


@api.post("/cart/add")
async def cart_add(body: CartAddIn, request: Request, response: Response,
                   currency: str = "INR",
                   user_id: Optional[str] = Depends(get_user_id_optional)):
    product = await db.fetch_one(
        """SELECT p.id::text AS product_id, p.title, p.base_price, p.price_usd, p.is_serialized,
                  p.variant_options AS variant_options, p.category_key::text AS category_key,
                  p.attributes AS attributes,
                  v.id::text AS variant_id
             FROM products p
             JOIN product_variants v ON v.product_id = p.id AND v.is_active
            WHERE p.id = $1::uuid AND p.deleted_at IS NULL
            ORDER BY v.created_at LIMIT 1""", body.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if (product["attributes"] or {}).get("out_of_stock"):
        raise HTTPException(409, f"“{product['title']}” is out of stock")

    anon_key = request.cookies.get("gemora_anon")
    if not user_id and not anon_key:
        anon_key = uid("anon_")
        response.set_cookie("gemora_anon", anon_key, max_age=30 * 24 * 3600, httponly=False, path="/", **_cookie_kwargs())

    # A cart's currency is fixed the moment it's first created (see
    # _get_or_create_cart) — every line added later, including this one, prices
    # against THAT currency, not a fresh per-request detection. region_pricing only
    # ever checks out in INR or USD (see _compute_variant_price's docstring for why
    # a visitor's exact local currency can't safely extend to priced add-ons), so
    # anything else collapses to USD here, once, rather than in the frontend.
    normalized_currency = currency if currency == "INR" else "USD"
    cart = await _get_or_create_cart(user_id, anon_key, normalized_currency)

    # Price is decided here, from the product's admin-configured surcharges — the
    # client only ever supplies which choices it wants, never a price. Priced against
    # the effective options so shared designs / ring sizes are honoured too.
    effective = _effective_variant_options(
        product["category_key"], product["variant_options"],
        await _design_groups_for_product(product["product_id"]))
    base_price_usd = product["price_usd"] if cart["currency"] != "INR" else None
    unit_price, selected, priced_ok = _compute_variant_price(
        product["base_price"], base_price_usd, effective, body.options, cart["currency"])
    if not priced_ok:
        raise HTTPException(
            409, f"“{product['title']}” with these options isn't available for "
                 f"{cart['currency']} checkout yet — switch your region to India to order it, "
                 f"or contact us.")

    # Wearer/sankalp details, required only for the two video Pooja Energization
    # choices — anything the client sent for any other choice is discarded, so a
    # client can't attach details to a line that doesn't ask for them.
    pooja_details = (await _validated_pooja_details(body.pooja_details)
                     if selected.get("pooja_energization") in _POOJA_VIDEO_LABELS else None)

    add_qty = max(1, body.qty)

    # Quantity-based cart: no serial is chosen here and nothing is reserved. Adds for
    # the same product AND the same selected options AND the same pooja_details merge
    # into one line (so the +/- stepper works on a single row); a different
    # certification/pendant/size choice — or a different wearer's details — is a
    # distinct line. Specific units are auto-assigned only when payment is captured
    # (_mark_paid) — all option combinations of a product draw from the same physical
    # stock pool.
    async with db.transaction() as conn:
        existing = await conn.fetchrow(
            """SELECT id::text AS id, qty FROM cart_items
                WHERE cart_id = $1::uuid AND variant_id = $2::uuid
                  AND product_unit_id IS NULL AND selected_options = $3::jsonb
                  AND pooja_details IS NOT DISTINCT FROM $4::jsonb
                ORDER BY created_at LIMIT 1""",
            cart["cart_id"], product["variant_id"], selected, pooja_details)
        line_new_qty = (existing["qty"] if existing else 0) + add_qty

        # For serialized products, never let the cart (summed across every options
        # combination of this product) exceed pieces actually in stock.
        if product["is_serialized"]:
            other_qty = await conn.fetchval(
                """SELECT COALESCE(sum(qty),0) FROM cart_items
                    WHERE cart_id = $1::uuid AND variant_id = $2::uuid
                      AND product_unit_id IS NULL AND id IS DISTINCT FROM $3::uuid""",
                cart["cart_id"], product["variant_id"],
                existing["id"] if existing else None)
            available = await conn.fetchval(
                """SELECT count(*) FROM product_units
                    WHERE product_id = $1::uuid AND status = 'in_stock'""",
                product["product_id"])
            if available < 1:
                raise HTTPException(409, "Out of stock.")
            if other_qty + line_new_qty > available:
                raise HTTPException(
                    409, f"Only {available} in stock — can't add more.")

        if existing:
            await conn.execute(
                "UPDATE cart_items SET qty = $2 WHERE id = $1::uuid", existing["id"], line_new_qty)
        else:
            await conn.execute(
                """INSERT INTO cart_items (id, cart_id, variant_id, product_unit_id, qty,
                                           unit_price_snapshot, selected_options, pooja_details)
                   VALUES ($1,$2::uuid,$3::uuid,NULL,$4,$5,$6::jsonb,$7::jsonb)""",
                uuid.uuid4(), cart["cart_id"], product["variant_id"], line_new_qty,
                unit_price, selected, pooja_details)
        await conn.execute(
            "UPDATE carts SET updated_at = now() WHERE id = $1::uuid", cart["cart_id"])

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


@api.post("/cart/set-qty")
async def cart_set_qty(body: SetQtyIn, request: Request, user_id: Optional[str] = Depends(get_user_id_optional)):
    """Set a line's quantity for the +/- stepper. qty <= 0 removes the line; a raise is
    capped at pieces in stock for serialized products."""
    anon_key = request.cookies.get("gemora_anon")
    cart = await _get_or_create_cart(user_id, anon_key)
    async with db.transaction() as conn:
        line = await conn.fetchrow(
            """SELECT ci.id::text AS id, v.product_id::text AS product_id,
                      p.is_serialized AS is_serialized
                 FROM cart_items ci
                 JOIN product_variants v ON v.id = ci.variant_id
                 JOIN products p ON p.id = v.product_id
                WHERE ci.id = $1::uuid AND ci.cart_id = $2::uuid""",
            body.line_id, cart["cart_id"])
        if not line:
            raise HTTPException(404, "Cart line not found")
        if body.qty <= 0:
            await conn.execute("DELETE FROM cart_items WHERE id = $1::uuid", body.line_id)
        else:
            if line["is_serialized"]:
                # Sum every other line of this product (different options = different
                # lines, same shared stock pool) so the cap holds across the whole cart.
                other_qty = await conn.fetchval(
                    """SELECT COALESCE(sum(ci.qty),0) FROM cart_items ci
                         JOIN product_variants v ON v.id = ci.variant_id
                        WHERE v.product_id = $1::uuid AND ci.cart_id = $2::uuid
                          AND ci.id != $3::uuid""",
                    line["product_id"], cart["cart_id"], body.line_id)
                available = await conn.fetchval(
                    """SELECT count(*) FROM product_units
                        WHERE product_id = $1::uuid AND status = 'in_stock'""",
                    line["product_id"])
                if other_qty + body.qty > available:
                    raise HTTPException(409, f"Only {available - other_qty} more in stock.")
            await conn.execute(
                "UPDATE cart_items SET qty = $2 WHERE id = $1::uuid", body.line_id, body.qty)
        await conn.execute(
            "UPDATE carts SET updated_at = now() WHERE id = $1::uuid", cart["cart_id"])
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
           o.shipping_total              AS shipping_n,
           o.grand_total                 AS total_n,
           o.discount_total              AS discount_n,
           o.consultation_credit_id::text AS consultation_credit_id,
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
           pay.gateway_ref        AS gateway_order_id,
           pay.gateway_payment_id AS payment_id,
           pay.paid_at            AS paid_at,
           (pay.gateway_ref IS NULL OR pay.gateway_ref LIKE 'mock_%') AS mock_payment,
           sh.tracking_no         AS tracking_number,
           sh.carrier             AS courier,
           sh.shipped_at          AS shipped_at,
           sh.estimated_delivery_date AS estimated_delivery_date,
           cm.id::text            AS commission_id
      FROM orders o
      LEFT JOIN addresses a ON a.id = o.shipping_address_id
      LEFT JOIN LATERAL (
            SELECT gateway_ref, gateway_payment_id, paid_at
              FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
      ) pay ON true
      LEFT JOIN LATERAL (
            SELECT carrier, tracking_no, shipped_at, estimated_delivery_date
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
               oi.selected_options    AS options,
               oi.pooja_details       AS pooja_details,
               p.variant_options      AS variant_options,
               p.category_key::text   AS category_key,
               p.is_serialized        AS is_serialized,
               -- Units assigned to this line at payment: many units can share one
               -- order_item (product_units.sold_order_item_id), so a qty-3 line lists
               -- all three serials. This is what the admin dispatches/certifies.
               (SELECT array_agg(pu.serial_no ORDER BY pu.serial_no)
                  FROM product_units pu WHERE pu.sold_order_item_id = oi.id) AS serials,
               (SELECT ma.object_key FROM product_media pm
                  JOIN media_assets ma ON ma.id = pm.media_id
                 WHERE pm.product_id = oi.product_id ORDER BY pm.position LIMIT 1) AS image
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id"""


def _shape_order_item(i: dict, design_groups: Optional[list[dict]] = None) -> dict:
    effective = _effective_variant_options(
        i.get("category_key"), i.get("variant_options"), design_groups)
    return {**{k: v for k, v in i.items()
               if k not in ("unit_price", "order_id", "variant_options", "category_key")},
            "serials": list(i.get("serials") or []),
            "options_list": _shape_selected_options(i.get("options"), effective),
            "flags": _line_flags(i.get("options"), effective),
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
    designs = await _design_groups_for_products([i["product_id"] for i in rows])
    grouped: dict[str, list[dict]] = {}
    for i in rows:
        grouped.setdefault(i["order_id"], []).append(
            _shape_order_item(i, designs.get(i["product_id"])))
    return grouped


_ORDER_EVENTS_SELECT = """
    SELECT order_id::text AS order_id, to_status::text AS status, created_at AS at
      FROM order_events"""


async def _order_events_by_id(order_ids: list[str]) -> dict[str, list[dict]]:
    """Fetch the status-change audit trail for many orders in one query, grouped by
    order_id — this is the source for the customer-facing tracking timeline."""
    if not order_ids:
        return {}
    rows = await db.fetch_all(
        _ORDER_EVENTS_SELECT + " WHERE order_id = ANY($1::uuid[]) ORDER BY created_at", order_ids)
    grouped: dict[str, list[dict]] = {}
    for e in rows:
        grouped.setdefault(e["order_id"], []).append(
            {"status": db.ORDER_STATUS_FROM_DB.get(e["status"], e["status"]), "at": e["at"]})
    return grouped


async def _shape_orders(rows: list[dict]) -> list[dict]:
    """Shape a list of order rows with a single batched line-item + event fetch (3
    queries total), instead of one items/events query per order."""
    order_ids = [r["order_id"] for r in rows]
    items_by_id = await _order_items_by_id(order_ids)
    events_by_id = await _order_events_by_id(order_ids)
    return [await _shape_order(r, items=items_by_id.get(r["order_id"], []),
                                events=events_by_id.get(r["order_id"], [])) for r in rows]


async def _shape_order(row: Optional[dict], conn=None, items: Optional[list] = None,
                        events: Optional[list] = None) -> Optional[dict]:
    if not row:
        return None
    r = dict(row)
    if items is None:
        sql = _ORDER_ITEMS_COLS + " WHERE oi.order_id = $1::uuid ORDER BY oi.created_at"
        rows = db._rows(await conn.fetch(sql, r["order_id"])) if conn else await db.fetch_all(sql, r["order_id"])
        designs = await _design_groups_for_products([i["product_id"] for i in rows], conn)
        items = [_shape_order_item(i, designs.get(i["product_id"])) for i in rows]
    if events is None:
        sql = _ORDER_EVENTS_SELECT + " WHERE order_id = $1::uuid ORDER BY created_at"
        rows = db._rows(await conn.fetch(sql, r["order_id"])) if conn else await db.fetch_all(sql, r["order_id"])
        events = [{"status": db.ORDER_STATUS_FROM_DB.get(e["status"], e["status"]), "at": e["at"]} for e in rows]
    shipping = {k: r.pop(f"shipping_{k}") for k in
                ("name", "phone", "address", "city", "state", "pincode")}
    shipping = {f"shipping_{k}": v for k, v in shipping.items()}
    shipping["email"] = r.pop("shipping_email", None)
    return {**{k: v for k, v in r.items()
               if k not in ("subtotal_n", "gst_n", "shipping_n", "total_n", "discount_n", "status_db")},
            "items": items,
            "events": events,
            "subtotal": db.to_paise(r["subtotal_n"]),
            "gst": db.to_paise(r["gst_n"]),
            "shipping_total": db.to_paise(r["shipping_n"]),
            "total": db.to_paise(r["total_n"]),
            "discount": db.to_paise(r["discount_n"]),
            "status": db.ORDER_STATUS_FROM_DB.get(r["status_db"], r["status_db"]),
            "shipping": shipping}


async def _load_order(order_id: str, conn=None) -> Optional[dict]:
    sql = _ORDER_SELECT + " WHERE o.id = $1::uuid"
    row = db._row(await conn.fetchrow(sql, order_id)) if conn else await db.fetch_one(sql, order_id)
    return await _shape_order(row, conn)


@api.post("/checkout")
async def checkout(body: CheckoutIn, request: Request, user_id: str = Depends(require_user)):
    # Buying requires an account — the frontend hides the total and gates this call
    # behind login/signup, and require_user enforces it here too so the rule holds
    # even for a direct API call.
    anon_key = request.cookies.get("gemora_anon")
    cart = await _get_or_create_cart(user_id, anon_key)
    items = cart.get("items", [])
    if not items:
        raise HTTPException(400, "Cart is empty")

    # Shipping is free within India; outside it, each distinct product in the cart
    # can carry its own USD charge per shipping region (admin-set on the product,
    # e.g. a heavier piece costing more to ship) — summed once per product, not per
    # unit/qty. The buyer picks their exact country, not the region directly — much
    # less error-prone (no more guessing "am I 'Asia-Pacific' or 'Rest of World'?")
    # — and the country resolves to a region here, server-side.
    if cart["currency"] != "INR" and (body.shipping_country or "").upper() not in _SHIPPING_COUNTRY_CODES:
        raise HTTPException(400, "Select your shipping country")
    shipping_region = (_shipping_region_for_country(body.shipping_country)
                       if cart["currency"] != "INR" else None)

    # Stock guard before we create a payable order. Sums quantities across every line
    # of the same product — different certification/pendant/size choices are different
    # cart lines, but they draw from the one shared stock pool. Units are only assigned
    # at capture, so this is a best-effort early check — _mark_paid re-checks atomically.
    qty_by_product: dict[str, int] = {}
    for li in items:
        qty_by_product[li["product_id"]] = qty_by_product.get(li["product_id"], 0) + li["qty"]
    shipping_total = 0
    for pid, total_qty in qty_by_product.items():
        chk = await db.fetch_one(
            """SELECT p.is_serialized, p.attributes, p.shipping_charges,
                      (SELECT count(*) FROM product_units pu
                        WHERE pu.product_id = p.id AND pu.status = 'in_stock') AS avail
                 FROM products p WHERE p.id = $1::uuid""", pid)
        if not chk:
            continue
        name = next((li["name"] for li in items if li["product_id"] == pid), "An item")
        if (chk["attributes"] or {}).get("out_of_stock"):
            raise HTTPException(409, f"“{name}” is out of stock")
        if chk["is_serialized"] and chk["avail"] < total_qty:
            raise HTTPException(
                409, f"“{name}” is out of stock — only {chk['avail']} of "
                     f"{total_qty} available.")
        if cart["currency"] != "INR":
            charge = (chk["shipping_charges"] or {}).get(shipping_region)
            if charge:
                shipping_total += db.to_paise(str(charge))

    subtotal = sum(li["price"] * li["qty"] for li in items)
    gst = 0  # prices are GST-inclusive — not added on top of the listed price

    # A paid consultation credits its fee toward the buyer's next purchase. Reserved
    # here by reference (not yet marked redeemed — that happens in _mark_paid, once
    # the payment actually completes) so an abandoned checkout doesn't burn it.
    # Only applied when it matches the order's currency — a ₹399 credit can't
    # discount a $130 order, or vice versa; it just stays available for later.
    credit = await _find_eligible_credit(user_id)
    credit_usable = bool(credit) and (credit.get("currency") or "INR").strip() == cart["currency"]
    discount = min(db.to_paise(credit["amount"]), subtotal) if credit_usable else 0
    total = subtotal + gst + shipping_total - discount

    order_id = uuid.uuid4()
    # Attribute affiliate — either explicit in body, or fall back to cart's tracked ref
    aff_ref = body.affiliate_ref or cart.get("affiliate_ref")
    aff_astro_id: Optional[str] = None
    if aff_ref:
        aff_astro_id = await db.fetch_val(
            "SELECT id::text FROM astrologers WHERE affiliate_code = $1::citext AND is_active",
            aff_ref)

    buyer_id = user_id

    # India/INR stays on Cashfree; everywhere else (USD) goes through Razorpay, which
    # — unlike Cashfree for this merchant — can actually take international cards.
    gateway = "razorpay" if cart["currency"] != "INR" else "cashfree"
    cf_app_id = None
    cf_order_id = f"mock_{order_id}"
    payment_session_id = None
    razorpay_order = None
    if gateway == "razorpay":
        rzp_key_id, rzp_secret = _razorpay_keys()
        if rzp_key_id and rzp_secret:
            try:
                rzp_order = await _razorpay_create_order(
                    rzp_key_id, rzp_secret, total, cart["currency"], str(order_id))
                cf_order_id = rzp_order["order_id"]
                razorpay_order = {"order_id": cf_order_id, "key_id": rzp_key_id,
                                   "amount": total, "currency": cart["currency"]}
            except Exception as e:
                log.warning(f"razorpay create failed: {e} — falling back to mock")
    else:
        cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
        cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
        if cf_app_id and cf_secret:
            try:
                cf_order = await _cashfree_create_order(
                    cf_app_id, cf_secret, total, cart["currency"], str(order_id),
                    {"customer_id": re.sub(r"[^A-Za-z0-9]", "", str(buyer_id))[:50] or "guest",
                     "customer_name": body.shipping_name, "customer_email": body.email,
                     "customer_phone": body.shipping_phone},
                    f"{os.environ.get('PUBLIC_APP_URL', '').rstrip('/')}/order-confirmed/{order_id}")
                cf_order_id = cf_order["order_id"]
                payment_session_id = cf_order["payment_session_id"]
            except Exception as e:
                log.warning(f"cashfree create failed: {e} — falling back to mock")

    # Address, order, lines and the pending payment are one transaction — Mongo wrote
    # a single document, so this has to be all-or-nothing too.
    async with db.transaction() as conn:
        addr_id = uuid.uuid4()
        addr_country = body.shipping_country.upper() if cart["currency"] != "INR" else "IN"
        await conn.execute(
            """INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1,
                                      city, state, pincode, country, email_snapshot, is_default)
               VALUES ($1,$2::uuid,'Shipping',$3,$4,$5,$6,$7,$8,$10,$9::citext,false)""",
            addr_id, buyer_id, body.shipping_name, body.shipping_phone,
            body.shipping_address, body.shipping_city, body.shipping_state,
            body.shipping_pincode, body.email.lower(), addr_country)

        await conn.execute(
            """INSERT INTO orders (id, user_id, guest_session_token, status, currency,
                    subtotal, discount_total, tax_total, shipping_total, grand_total,
                    shipping_address_id, billing_address_id, affiliate_code,
                    affiliate_astrologer_id, placed_at, consultation_credit_id)
               VALUES ($1,$2::uuid,$3,'pending',$12,$4,$5,$6,$13,$7,$8,$8,$9::citext,$10::uuid, now(),$11::uuid)""",
            order_id, buyer_id, None,
            db.to_amount(subtotal), db.to_amount(discount), db.to_amount(gst), db.to_amount(total),
            addr_id, aff_ref if aff_astro_id else None, aff_astro_id,
            credit["id"] if credit_usable else None, cart["currency"], db.to_amount(shipping_total))

        item_ids = [uuid.uuid4() for _ in items]
        product_ids = [li["product_id"] for li in items]
        unit_ids = [li["unit_id"] for li in items]
        names = [li["name"] for li in items]
        qtys = [li["qty"] for li in items]
        unit_prices = [db.to_amount(li["price"]) for li in items]
        line_totals = [db.to_amount(li["price"] * li["qty"]) for li in items]
        options = [db.json_dumps(li.get("options") or {}) for li in items]
        # None (not "null") for lines without pooja_details, so it lands as SQL NULL —
        # not a JSON null — on order_items, same as it is on the cart_items it came from.
        pooja_details = [db.json_dumps(li["pooja_details"]) if li.get("pooja_details") else None
                         for li in items]
        for start in range(0, len(item_ids), _BULK_INSERT_CHUNK):
            end = start + _BULK_INSERT_CHUNK
            await conn.execute(
                """INSERT INTO order_items (id, order_id, product_id, variant_id,
                        product_unit_id, title_snapshot, qty, unit_price, line_total,
                        fulfillment_status, selected_options, pooja_details)
                   SELECT li.id, $10::uuid, li.product_id,
                          (SELECT id FROM product_variants WHERE product_id = li.product_id
                            ORDER BY created_at LIMIT 1),
                          li.unit_id, li.title_snapshot, li.qty, li.unit_price,
                          li.line_total, 'pending', li.selected_options::jsonb,
                          li.pooja_details::jsonb
                     FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::int[],
                                 $6::numeric[], $7::numeric[], $8::text[], $9::text[])
                          AS li(id, product_id, unit_id, title_snapshot, qty, unit_price,
                                line_total, selected_options, pooja_details)""",
                item_ids[start:end], product_ids[start:end], unit_ids[start:end],
                names[start:end], qtys[start:end], unit_prices[start:end],
                line_totals[start:end], options[start:end], pooja_details[start:end], order_id)

        await conn.execute(
            """INSERT INTO payments (id, order_id, gateway, gateway_ref, amount, currency,
                                     status)
               VALUES ($1,$2,$6,$3,$4,$5,'initiated')""",
            uuid.uuid4(), order_id, cf_order_id, db.to_amount(total), cart["currency"], gateway)

        # Cart is converted, not deleted — it's the audit trail of what was bought.
        await conn.execute(
            "UPDATE carts SET status='converted', updated_at=now() WHERE id=$1::uuid",
            cart["cart_id"])

    order = await _load_order(str(order_id))
    return {"order": order, "payment_session_id": payment_session_id, "cf_app_id": cf_app_id or None,
            "razorpay": razorpay_order}


@api.post("/checkout/mock-pay/{order_id}")
async def mock_pay(order_id: str):
    """Dev helper: completes an order without Cashfree live keys, atomically flipping units to sold.

    DEV ONLY — 404s in production. Without this gate any anonymous caller could mark
    an arbitrary order paid (assigning inventory and issuing certificates) without
    paying. Real payments must go through Cashfree + the verified webhook.
    """
    _require_dev_env()
    order = await _load_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "pending_payment":
        return order
    return await _mark_paid(order, payment_id=f"mock_pay_{uid()}")


async def _mark_paid(order: dict, payment_id: str) -> dict:
    """Assign units -> sold, order -> paid, commission recorded — one transaction.

    Units aren't reserved during the cart's life; they're auto-assigned here, when the
    payment is captured. For each serialized line we grab `qty` in-stock units under a
    row lock (FOR UPDATE SKIP LOCKED, so concurrent buyers can't grab the same piece)
    and bind them to the order_item. If a line can't be fully filled the whole payment
    rolls back rather than leaving a half-filled order.
    """
    order_id = order["order_id"]
    async with db.transaction() as conn:
        for li in order.get("items", []):
            if not li.get("is_serialized"):
                continue  # non-serialized products aren't unit-tracked
            qty = li.get("qty") or 1
            # Skip units already bound to this line (idempotency / re-runs).
            already = await conn.fetchval(
                "SELECT count(*) FROM product_units WHERE sold_order_item_id = $1::uuid",
                li["line_id"])
            need = qty - (already or 0)
            if need <= 0:
                continue
            assigned = await conn.fetch(
                """UPDATE product_units SET status = 'sold', sold_order_item_id = $2::uuid
                    WHERE id IN (
                        SELECT id FROM product_units
                         WHERE product_id = $1::uuid AND status = 'in_stock'
                         ORDER BY created_at, serial_no
                         LIMIT $3
                         FOR UPDATE SKIP LOCKED)
                RETURNING id""", li["product_id"], li["line_id"], need)
            if len(assigned) < need:
                raise HTTPException(
                    409, f"“{li.get('name', 'An item')}” is out of stock — "
                         f"only {len(assigned) + (already or 0)} of {qty} available.")

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
                       VALUES ($1,$2::uuid,$3::citext,$4::uuid,$5,$6,$7,$8,$9,'pending')
                       ON CONFLICT (order_id) DO NOTHING""",
                    cid, order["affiliate_astrologer_id"], order.get("affiliate_code"),
                    order_id, subtotal, db.to_amount(order.get("total") or 0), pct,
                    (subtotal * pct / 100).quantize(Decimal("0.01")),
                    order.get("currency") or "INR")
        # order_events is this schema's status audit trail — Mongo had no equivalent.
        await conn.execute(
            """INSERT INTO order_events (id, order_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,'pending','paid','payment captured')""",
            uuid.uuid4(), order_id)

        # Consultation credit was only reserved by reference at checkout — now that
        # payment actually captured, spend it. The status='available' guard makes this
        # a no-op (order keeps its already-applied discount) if it was somehow already
        # redeemed elsewhere, rather than erroring the whole payment out.
        if order.get("consultation_credit_id"):
            await conn.execute(
                """UPDATE consultation_credits SET status='redeemed', redeemed_order_id=$1
                    WHERE id=$2::uuid AND status='available'""",
                order_id, order["consultation_credit_id"])
    result = await _load_order(order_id)

    # WhatsApp "order confirmed" — fired after the transaction commits so a WA outage
    # can never roll back a captured payment. Buyer identity comes from the order.
    buyer = await _load_user(user_id=order["user_id"]) if order.get("user_id") else None
    to_phone = (buyer or {}).get("phone") or result.get("shipping_phone")
    if to_phone:
        items = result.get("items") or []
        _wa_fire_event("order.placed", phone=to_phone,
                 name=(buyer or {}).get("name") or result.get("shipping_name") or "friend",
                 user_id=order.get("user_id"),
                 variables={
                     "order_id": result.get("order_id"),
                     "item_count": sum((li.get("qty") or 1) for li in items) or len(items),
                     "total": _rupees(result.get("total")),
                     "order_url": f"{os.environ.get('PUBLIC_APP_URL', '').rstrip('/')}/account",
                 })
    return result


class CashfreeVerifyIn(BaseModel):
    order_id: str
    # Only set for a Razorpay (non-INR) checkout — Razorpay's checkout.js hands the
    # client this signed triple on success, unlike Cashfree which gives no client-side
    # signal at all.
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


@api.post("/checkout/verify")
async def checkout_verify(body: CashfreeVerifyIn):
    """Cashfree gives the client no signature to check — the checkout modal just
    resolves when the buyer is done, so the server asks Cashfree directly whether
    the order's payment actually succeeded. Razorpay orders instead verify the
    client-supplied signature (see _razorpay_verify_signature)."""
    order = await _load_order(body.order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    # Idempotent: the PAYMENT_SUCCESS_WEBHOOK may have already marked this order paid
    # in a race with this client-side verify call. _mark_paid is not safe to run twice
    # (it consumes 'active' reservations and 409s once they're already consumed), so
    # short-circuit when the order is already paid — the payment IS complete. Mirrors
    # the same status guard the webhook uses below.
    if order.get("status") == "paid":
        return order
    payment = await db.fetch_one(
        """SELECT gateway, gateway_ref FROM payments WHERE order_id = $1::uuid
            ORDER BY created_at DESC LIMIT 1""", body.order_id)
    if not payment or not payment["gateway_ref"]:
        raise HTTPException(404, "No payment attempt found for this order")
    gateway_ref = payment["gateway_ref"]

    if payment["gateway"] == "razorpay":
        rzp_key_id, rzp_secret = _razorpay_keys()
        if not (rzp_key_id and rzp_secret):
            raise HTTPException(400, "Razorpay not configured — use /api/checkout/mock-pay for dev.")
        if not (body.razorpay_payment_id and body.razorpay_signature):
            raise HTTPException(400, "Missing Razorpay payment confirmation")
        if not _razorpay_verify_signature(gateway_ref, body.razorpay_payment_id,
                                          body.razorpay_signature, rzp_secret):
            raise HTTPException(400, "Payment could not be verified")
        return await _mark_paid(order, body.razorpay_payment_id)

    cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
    cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
    if not (cf_app_id and cf_secret):
        raise HTTPException(400, "Cashfree not configured — use /api/checkout/mock-pay for dev.")
    try:
        cf_payments = await _cashfree_get_order_payments(cf_app_id, cf_secret, gateway_ref)
    except Exception as e:
        log.warning(f"cashfree verify fetch failed: {e}")
        raise HTTPException(502, "Could not confirm this payment with Cashfree. Please try again shortly.")
    success = next((p for p in cf_payments if p.get("payment_status") == "SUCCESS"), None)
    if not success:
        raise HTTPException(400, "Payment not confirmed yet")
    return await _mark_paid(order, str(success.get("cf_payment_id")))


@api.post("/checkout/pay/{order_id}")
async def checkout_pay(order_id: str, request: Request,
                       user_id: Optional[str] = Depends(get_user_id_optional)):
    """Re-initiate payment for an existing unpaid order — the "Pay now" button on the
    account page. Creates a FRESH gateway order for the outstanding total (Cashfree for
    INR, Razorpay for everything else — same split as /checkout) and repoints the
    payment row's gateway_ref at it (so the webhook/verify can still match), then hands
    the payment session back to the client to open checkout. Falls back to the mock path
    when no keys are configured. Response shape mirrors /checkout so the frontend reuses
    the same gateway-open + /checkout/verify logic."""
    order = await _load_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    if user_id and order.get("user_id") and order["user_id"] != user_id:
        raise HTTPException(403, "Not your order")
    if order.get("status") == "paid":
        return {"order": order, "already_paid": True}
    if order.get("status") not in ("pending_payment", "payment_failed"):
        raise HTTPException(409, f"Order is {order.get('status')} — not payable")

    # Nothing is held for a pending order — units are assigned at capture (_mark_paid).
    # Guard here so the buyer isn't sent to pay for something already out of stock.
    # Sums across lines of the same product (different options = different lines,
    # same shared stock pool) — an order can hold e.g. both a certified and an
    # uncertified line for the same product.
    qty_by_product: dict[str, int] = {}
    for li in order.get("items", []):
        if li.get("is_serialized"):
            qty_by_product[li["product_id"]] = qty_by_product.get(li["product_id"], 0) + (li.get("qty") or 1)
    for pid, total_qty in qty_by_product.items():
        available = await db.fetch_val(
            """SELECT count(*) FROM product_units
                WHERE product_id = $1::uuid AND status = 'in_stock'""", pid)
        if available < total_qty:
            name = next((li.get("name") for li in order["items"] if li["product_id"] == pid), "This item")
            raise HTTPException(
                409, f"“{name}” is out of stock — only {available} of {total_qty} left.")

    order_currency = order.get("currency") or "INR"
    if order_currency != "INR":
        rzp_key_id, rzp_secret = _razorpay_keys()
        if rzp_key_id and rzp_secret:
            try:
                rzp_order = await _razorpay_create_order(
                    rzp_key_id, rzp_secret, int(order["total"]), order_currency, order_id)
                await db.execute(
                    """UPDATE payments SET gateway = 'razorpay', gateway_ref = $2, status = 'initiated'
                        WHERE id = (SELECT id FROM payments WHERE order_id = $1::uuid
                                    ORDER BY created_at DESC LIMIT 1)""",
                    order_id, rzp_order["order_id"])
                return {"order": order, "payment_session_id": None, "cf_app_id": None,
                        "razorpay": {"order_id": rzp_order["order_id"], "key_id": rzp_key_id,
                                     "amount": int(order["total"]), "currency": order_currency},
                        "mock_payment": False}
            except Exception as e:
                log.warning(f"pay-now razorpay create failed: {e} — falling back to mock")
        return {"order": order, "payment_session_id": None, "cf_app_id": None, "razorpay": None,
                "mock_payment": True}

    cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
    cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
    if cf_app_id and cf_secret:
        try:
            cf_order = await _cashfree_create_order(
                cf_app_id, cf_secret, int(order["total"]), order_currency, order_id,
                {"customer_id": re.sub(r"[^A-Za-z0-9]", "", str(user_id or order.get("user_id") or "guest"))[:50] or "guest",
                 "customer_name": order.get("shipping_name"), "customer_email": order.get("shipping_email"),
                 "customer_phone": order.get("shipping_phone")},
                f"{os.environ.get('PUBLIC_APP_URL', '').rstrip('/')}/order-confirmed/{order_id}")
            await db.execute(
                """UPDATE payments SET gateway = 'cashfree', gateway_ref = $2, status = 'initiated'
                    WHERE id = (SELECT id FROM payments WHERE order_id = $1::uuid
                                ORDER BY created_at DESC LIMIT 1)""",
                order_id, cf_order["order_id"])
            return {"order": order, "payment_session_id": cf_order["payment_session_id"],
                    "cf_app_id": cf_app_id, "razorpay": None, "mock_payment": False}
        except Exception as e:
            log.warning(f"pay-now cashfree create failed: {e} — falling back to mock")
    return {"order": order, "payment_session_id": None, "cf_app_id": None, "razorpay": None, "mock_payment": True}


# ── Cashfree webhook (server-to-server, signature-verified, idempotent) ───────
@api.post("/webhook/cashfree")
async def cashfree_webhook(request: Request):
    """
    Cashfree -> here. Handles PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK.
    Signature is Base64(HMAC-SHA256(x-webhook-timestamp + raw body, CASHFREE_SECRET_KEY))
    compared against x-webhook-signature — Cashfree signs with the client secret
    itself, there's no separate webhook secret the way Razorpay has one.
    We ALWAYS return 200 to Cashfree after logging so they don't retry-storm us on
    our own bugs; the event is retained in processed_webhooks for audit.
    """
    secret = os.environ.get("CASHFREE_SECRET_KEY", "")
    raw = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    timestamp = request.headers.get("x-webhook-timestamp", "")

    # 1. Verify signature (skip only if the secret hasn't been set yet)
    verified = False
    if secret:
        expected = base64.b64encode(
            hmac.new(secret.encode(), (timestamp + raw.decode("utf-8")).encode(),
                     hashlib.sha256).digest()).decode()
        verified = hmac.compare_digest(expected, sig)
        if not verified:
            log.warning("cashfree webhook: bad signature")
            raise HTTPException(400, "Bad signature")
    else:
        log.warning("cashfree webhook: CASHFREE_SECRET_KEY not set — accepting without verification")

    try:
        payload = json.loads(raw or b"{}")
    except Exception:
        payload = {}

    event = payload.get("type", "")
    data = payload.get("data") or {}
    cf_order_id = (data.get("order") or {}).get("order_id")
    cf_payment = data.get("payment") or {}
    # cf_payment_id is Cashfree's idempotency key — they don't send a separate
    # event-id header the way Razorpay does (x-razorpay-event-id).
    event_id = str(cf_payment.get("cf_payment_id") or "") or None

    # 2. Idempotency — dedupe by cf_payment_id
    if event_id:
        exists = await db.fetch_val(
            "SELECT event_id FROM processed_webhooks WHERE event_id = $1", event_id)
        if exists:
            return {"ok": True, "duplicate": True}

    result: dict = {"ok": True, "event": event}

    try:
        if event == "PAYMENT_SUCCESS_WEBHOOK" and cf_payment.get("payment_status") == "SUCCESS":
            if cf_order_id:
                # Find our internal order via the payment's gateway_ref.
                oid = await db.fetch_val(
                    "SELECT order_id::text FROM payments WHERE gateway_ref = $1"
                    " ORDER BY created_at DESC LIMIT 1", cf_order_id)
                order = await _load_order(oid) if oid else None
                if order and order.get("status") != "paid":
                    await _mark_paid(order, str(cf_payment.get("cf_payment_id") or ""))
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = True
                elif order:
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = False
                    result["reason"] = "already paid"
                else:
                    result["marked_paid"] = False
                    result["reason"] = f"order for cf_order_id={cf_order_id} not found"
        elif event == "PAYMENT_FAILED_WEBHOOK":
            if cf_order_id:
                reason = cf_payment.get("payment_message")
                async with db.transaction() as conn:
                    oid = await conn.fetchval(
                        "SELECT order_id FROM payments WHERE gateway_ref = $1"
                        " ORDER BY created_at DESC LIMIT 1", cf_order_id)
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
                result["payment_failed_for"] = cf_order_id
    except Exception as e:
        log.exception(f"cashfree webhook handler crashed: {e}")
        result["ok"] = False
        result["error"] = str(e)[:200]

    # 3. Persist event for audit + idempotency
    try:
        # event_id is the idempotency key and is NOT NULL; synthesise one when
        # Cashfree omits cf_payment_id (such events can't be deduped anyway).
        await db.execute(
            """INSERT INTO processed_webhooks (event_id, gateway, event_type, verified,
                                               payload, result, processed_at)
               VALUES ($1,'cashfree',$2,$3,$4,$5, now())
               ON CONFLICT (event_id) DO NOTHING""",
            event_id or f"noid_{uuid.uuid4().hex}", event, verified, payload, result)
    except Exception as e:
        log.warning(f"cashfree webhook: audit insert failed: {e}")

    return result


# ── Razorpay webhook (server-to-server, signature-verified, idempotent) ───────
@api.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """
    Razorpay -> here, for the non-INR (international) orders /checkout routes to
    Razorpay. Handles payment.captured / payment.failed. Signature is
    hex(HMAC-SHA256(raw body, RAZORPAY_WEBHOOK_SECRET)) compared against
    x-razorpay-signature — a separate webhook secret, unlike Cashfree which signs
    with the client secret itself.
    We ALWAYS return 200 after logging so Razorpay doesn't retry-storm us on our
    own bugs; the event is retained in processed_webhooks for audit.
    """
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
    raw = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")

    verified = False
    if secret:
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        verified = hmac.compare_digest(expected, sig)
        if not verified:
            log.warning("razorpay webhook: bad signature")
            raise HTTPException(400, "Bad signature")
    else:
        log.warning("razorpay webhook: RAZORPAY_WEBHOOK_SECRET not set — accepting without verification")

    try:
        payload = json.loads(raw or b"{}")
    except Exception:
        payload = {}

    event = payload.get("event", "")
    rzp_payment = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
    rzp_order_id = rzp_payment.get("order_id")
    # rzp_payment.id is Razorpay's idempotency key here — same role as Cashfree's
    # cf_payment_id above.
    event_id = str(rzp_payment.get("id") or "") or None

    if event_id:
        exists = await db.fetch_val(
            "SELECT event_id FROM processed_webhooks WHERE event_id = $1", event_id)
        if exists:
            return {"ok": True, "duplicate": True}

    result: dict = {"ok": True, "event": event}

    try:
        if event == "payment.captured":
            if rzp_order_id:
                oid = await db.fetch_val(
                    "SELECT order_id::text FROM payments WHERE gateway_ref = $1"
                    " ORDER BY created_at DESC LIMIT 1", rzp_order_id)
                order = await _load_order(oid) if oid else None
                if order and order.get("status") != "paid":
                    await _mark_paid(order, str(rzp_payment.get("id") or ""))
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = True
                elif order:
                    result["order_id"] = order.get("order_id")
                    result["marked_paid"] = False
                    result["reason"] = "already paid"
                else:
                    result["marked_paid"] = False
                    result["reason"] = f"order for razorpay_order_id={rzp_order_id} not found"
        elif event == "payment.failed":
            if rzp_order_id:
                reason = rzp_payment.get("error_description")
                async with db.transaction() as conn:
                    oid = await conn.fetchval(
                        "SELECT order_id FROM payments WHERE gateway_ref = $1"
                        " ORDER BY created_at DESC LIMIT 1", rzp_order_id)
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
                result["payment_failed_for"] = rzp_order_id
    except Exception as e:
        log.exception(f"razorpay webhook handler crashed: {e}")
        result["ok"] = False
        result["error"] = str(e)[:200]

    try:
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


# Statuses a customer may still self-cancel from — anything before the order has
# actually left the vault. Once shipped/delivered/cancelled/refunded, self-cancel
# is no longer offered (a shipped order needs a return, not a cancellation).
_CANCELLABLE_DB_STATUSES = {"pending", "payment_failed", "paid", "processing", "packed"}
_CANCEL_WINDOW = timedelta(hours=24)


class OrderCancelIn(BaseModel):
    reason: Optional[str] = None


@api.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str, body: OrderCancelIn, user_id: str = Depends(require_user)):
    order = await db.fetch_one(
        _ORDER_SELECT + " WHERE o.id = $1::uuid AND o.user_id = $2::uuid",
        order_id, user_id)
    if not order:
        raise HTTPException(404, "Order not found")

    status_db = order["status_db"]
    if status_db not in _CANCELLABLE_DB_STATUSES:
        raise HTTPException(409, "This order can no longer be cancelled.")
    # db.fetch_one renders timestamps as ISO strings, not datetimes — parse before subtracting.
    if now() - datetime.fromisoformat(order["created_at"]) > _CANCEL_WINDOW:
        raise HTTPException(409, "The 24-hour cancellation window for this order has passed.")

    payment = await db.fetch_one(
        """SELECT id::text AS payment_id, gateway, gateway_payment_id, gateway_ref, status, amount
             FROM payments WHERE order_id = $1::uuid ORDER BY created_at DESC LIMIT 1""",
        order_id)
    # A mock/dev payment never actually took money, so it never needs a real refund —
    # only a genuinely captured, real-gateway payment does.
    needs_refund = bool(
        payment and payment["status"] == "captured"
        and payment.get("gateway_payment_id")
        and not str(payment["gateway_payment_id"]).startswith("mock_")
        and not str(payment.get("gateway_ref") or "").startswith("mock_"))

    refund_result = None
    if needs_refund and payment["gateway"] == "razorpay":
        rzp_key_id, rzp_secret = _razorpay_keys()
        if not (rzp_key_id and rzp_secret):
            raise HTTPException(503, "Refunds are temporarily unavailable. Please contact support.")
        try:
            # Razorpay refunds are keyed by the captured payment id, unlike Cashfree's
            # order-id-keyed refund.
            rzp_refund = await _razorpay_create_refund(
                rzp_key_id, rzp_secret, payment["gateway_payment_id"], db.to_paise(payment["amount"]))
            refund_result = {"refund_id": rzp_refund.get("id"),
                             "refund_status": "SUCCESS" if rzp_refund.get("status") == "processed" else "PENDING"}
        except CircuitOpenError:
            raise HTTPException(503, "Refund service temporarily unavailable. Please try again shortly.")
        except Exception as e:
            log.warning(f"razorpay refund failed for order {order_id}: {e}")
            raise HTTPException(502, "Could not process the refund. Please contact support.")
    elif needs_refund:
        cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
        cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
        if not (cf_app_id and cf_secret):
            raise HTTPException(503, "Refunds are temporarily unavailable. Please contact support.")
        try:
            refund_result = await _cashfree_create_refund(
                cf_app_id, cf_secret, payment["gateway_ref"], f"rfnd_{uid()}",
                db.to_paise(payment["amount"]))
        except CircuitOpenError:
            raise HTTPException(503, "Refund service temporarily unavailable. Please try again shortly.")
        except Exception as e:
            log.warning(f"cashfree refund failed for order {order_id}: {e}")
            raise HTTPException(502, "Could not process the refund. Please contact support.")

    async with db.transaction() as conn:
        # Units are only ever bound to order_items at payment capture (_mark_paid) —
        # release them back to sale so cancelling doesn't strand stock as phantom-sold.
        await conn.execute(
            """UPDATE product_units SET status = 'in_stock', sold_order_item_id = NULL
                WHERE sold_order_item_id IN (
                    SELECT id FROM order_items WHERE order_id = $1::uuid)""",
            order_id)
        await conn.execute(
            "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1::uuid",
            order_id)
        await conn.execute(
            """INSERT INTO order_events (id, order_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,$3::order_status,'cancelled',$4)""",
            uuid.uuid4(), order_id, status_db,
            (f"customer cancellation: {body.reason}" if body.reason else "customer cancellation")[:200])
        if order.get("consultation_credit_id"):
            await conn.execute(
                """UPDATE consultation_credits SET status = 'available', redeemed_order_id = NULL
                    WHERE id = $1::uuid AND redeemed_order_id = $2::uuid""",
                order["consultation_credit_id"], order_id)
        if needs_refund and refund_result:
            refunded_now = refund_result.get("refund_status") == "SUCCESS"
            await conn.execute(
                """INSERT INTO refunds (id, payment_id, amount, status, gateway_ref, processed_at)
                   VALUES ($1,$2::uuid,$3,$4::refund_status,$5,$6)""",
                uuid.uuid4(), payment["payment_id"], payment["amount"],
                "completed" if refunded_now else "processing",
                refund_result.get("refund_id"), now() if refunded_now else None)
            await conn.execute(
                "UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1::uuid",
                payment["payment_id"])

    await audit_log(user_id, "order.cancel", order_id,
                    {"reason": body.reason, "refund_initiated": needs_refund})
    return {"ok": True, "order_id": order_id, "refund_initiated": needs_refund}


# ── Admin: dispatch → activate QR ────────────────────────────────────────────
@api.post("/admin/dispatch")
async def admin_dispatch(body: DispatchIn, user_id: str = Depends(require_admin)):
    """Dispatch a paid order: issue the provenance certificate (lab + temple + Ed25519
    signature) for every unit assigned to it, activate their QRs, record the shipment
    with an estimated delivery date, and mark the order shipped. Provenance is captured
    here — not at intake — so the admin fills the lab/temple details at this step."""
    order = await _load_order(body.order_id)
    if not order:
        raise HTTPException(404, "Order not found")

    est_date = None
    if body.estimated_delivery_date:
        try:
            est_date = date.fromisoformat(body.estimated_delivery_date)
        except ValueError:
            raise HTTPException(400, "estimated_delivery_date must be YYYY-MM-DD")

    async with db.transaction() as conn:
        # Every unit assigned to this order at payment (many units can hang off one line).
        # The cert lookup only counts a *live* (non-revoked) certificate — a unit that
        # was returned/refunded and had its cert revoked must get a fresh one here, and
        # the LATERAL + LIMIT 1 keeps this to one row per unit even if it has several
        # certs in its history (original + reissued after a revoke).
        units = db._rows(await conn.fetch(
            """SELECT pu.id::text AS unit_id, pu.serial_no AS serial,
                      pu.product_id::text AS product_id, p.title AS product_name,
                      ac.cert_id AS cert_id
                 FROM product_units pu
                 JOIN order_items oi ON oi.id = pu.sold_order_item_id
                 LEFT JOIN products p ON p.id = pu.product_id
                 LEFT JOIN LATERAL (
                       SELECT id::text AS cert_id FROM authenticity_certificates
                        WHERE product_unit_id = pu.id AND revoked_at IS NULL
                        ORDER BY issued_at DESC LIMIT 1
                 ) ac ON true
                WHERE oi.order_id = $1::uuid""", body.order_id))
        if not units:
            raise HTTPException(400, "No paid units on this order — capture payment first.")

        # Issue a signed certificate for any unit that doesn't already have a live one.
        for u in units:
            if not u["cert_id"]:
                await _issue_certificate_tx(conn, u, body, user_id)

        # Activate only the QR on each unit's LIVE certificate — this is what makes a
        # public scan verify. Scoping to authenticity_certificate_id (not just
        # product_unit_id) matters: a unit re-dispatched after a revoke has an old,
        # already-revoked QR sitting in the same table, and reactivating that one would
        # let a stale label out in the wild start verifying as AUTHENTIC again.
        await conn.execute(
            """UPDATE qr_codes SET status='active', activated_at=now()
                WHERE authenticity_certificate_id IN (
                    SELECT ac.id
                      FROM product_units pu
                      JOIN order_items oi ON oi.id = pu.sold_order_item_id
                      JOIN authenticity_certificates ac ON ac.product_unit_id = pu.id
                                                        AND ac.revoked_at IS NULL
                     WHERE oi.order_id = $1::uuid)""", body.order_id)

        # Shipment carries tracking + the buyer-facing ETA; orders only carries status.
        await conn.execute(
            """INSERT INTO shipments (id, order_id, carrier, tracking_no, status,
                    shipped_at, estimated_delivery_date)
               VALUES ($1,$2::uuid,$3,$4,'in_transit', now(), $5)""",
            uuid.uuid4(), body.order_id, body.courier, body.tracking_number, est_date)
        await conn.execute(
            "UPDATE orders SET status='shipped' WHERE id=$1::uuid", body.order_id)
        await conn.execute(
            """UPDATE order_items SET fulfillment_status='shipped'
                WHERE order_id=$1::uuid""", body.order_id)
        await conn.execute(
            """INSERT INTO order_events (id, order_id, actor_id, from_status, to_status, reason)
               VALUES ($1,$2::uuid,$3::uuid,'paid','shipped','dispatched')""",
            uuid.uuid4(), body.order_id, user_id)
        # Add every dispatched unit to the buyer's verified vault — via the same live
        # (non-revoked) certificate's QR, for the reasons above.
        if order.get("user_id"):
            await conn.execute(
                """INSERT INTO verified_items (user_id, product_unit_id, qr_code_id, product_id)
                   SELECT $2::uuid, pu.id, q.id, pu.product_id
                     FROM product_units pu
                     JOIN order_items oi ON oi.id = pu.sold_order_item_id
                     JOIN authenticity_certificates ac ON ac.product_unit_id = pu.id
                                                       AND ac.revoked_at IS NULL
                     JOIN qr_codes q ON q.authenticity_certificate_id = ac.id
                    WHERE oi.order_id = $1::uuid
                   ON CONFLICT (user_id, product_unit_id) DO NOTHING""",
                body.order_id, order["user_id"])

    # WhatsApp "order shipped" — via the OpenWA gateway + the editable order_shipped
    # template (was a fixed Meta utility template).
    buyer = await _load_user(user_id=order["user_id"]) if order.get("user_id") else None
    to_phone = (buyer or {}).get("phone")
    if to_phone:
        _wa_fire_event("order.shipped", phone=to_phone,
                 name=(buyer or {}).get("name") or "friend", user_id=order.get("user_id"),
                 variables={
                     "order_id": order["order_id"],
                     "courier": body.courier or "our courier partner",
                     "tracking_number": body.tracking_number or "—",
                     "eta": body.estimated_delivery_date or "soon",
                 })
    await audit_log(user_id, "order.dispatch", order["order_id"],
                    {"units": len(units), "eta": body.estimated_delivery_date})
    return {"ok": True, "units": len(units)}


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


_LEADS_SELECT = """
    WITH wl AS (
        SELECT w.user_id, count(*) AS cnt, max(w.created_at) AS last_at,
               array_agg(p.title ORDER BY w.created_at DESC) AS items
          FROM wishlist w JOIN products p ON p.id = w.product_id
         GROUP BY w.user_id
    ),
    cart AS (
        SELECT c.user_id, count(ci.id) AS cnt,
               sum(ci.qty * ci.unit_price_snapshot) AS value_n,
               max(ci.updated_at) AS last_at,
               array_agg(p.title ORDER BY ci.updated_at DESC) AS items
          FROM carts c
          JOIN cart_items ci ON ci.cart_id = c.id
          JOIN product_variants pv ON pv.id = ci.variant_id
          JOIN products p ON p.id = pv.product_id
         WHERE c.user_id IS NOT NULL
         GROUP BY c.user_id
    ),
    unpaid AS (
        SELECT o.user_id, count(*) AS cnt, sum(o.grand_total) AS value_n,
               max(o.created_at) AS last_at,
               (array_agg(o.status::text ORDER BY o.created_at DESC))[1] AS latest_status,
               (array_agg(o.id::text ORDER BY o.created_at DESC))[1] AS latest_order_id
          FROM orders o
         WHERE o.status IN ('pending', 'payment_failed') AND o.user_id IS NOT NULL
         GROUP BY o.user_id
    )
    SELECT u.id::text AS user_id, u.full_name AS name, u.email::text AS email, u.phone AS phone,
           wl.cnt AS wishlist_count, wl.items[1:3] AS wishlist_items, wl.last_at AS wishlist_at,
           cart.cnt AS cart_count, cart.value_n AS cart_value_n, cart.items[1:3] AS cart_items,
           cart.last_at AS cart_at,
           unpaid.cnt AS unpaid_count, unpaid.value_n AS unpaid_value_n,
           unpaid.latest_status AS unpaid_status, unpaid.latest_order_id AS unpaid_order_id,
           unpaid.last_at AS unpaid_at, uoi.items AS unpaid_items,
           GREATEST(wl.last_at, cart.last_at, unpaid.last_at) AS last_activity
      FROM users u
      LEFT JOIN wl ON wl.user_id = u.id
      LEFT JOIN cart ON cart.user_id = u.id
      LEFT JOIN unpaid ON unpaid.user_id = u.id
      LEFT JOIN LATERAL (
            SELECT (array_agg(oi.title_snapshot ORDER BY oi.created_at))[1:3] AS items
              FROM order_items oi WHERE oi.order_id = unpaid.latest_order_id::uuid
      ) uoi ON unpaid.user_id IS NOT NULL
     WHERE wl.user_id IS NOT NULL OR cart.user_id IS NOT NULL OR unpaid.user_id IS NOT NULL
"""


@api.get("/admin/leads")
async def admin_list_leads(_: str = Depends(require_perm("orders"))):
    """Customers who showed buying intent but didn't complete it — wishlisted,
    left items in cart, or started checkout without a successful payment — so
    staff can follow up by call/WhatsApp. Stage is whichever signal is furthest
    along (checkout > cart > wishlist); a customer can carry more than one.
    Anonymous carts are excluded — nothing to call without a phone number."""
    rows = await db.fetch_all(_LEADS_SELECT + " ORDER BY last_activity DESC LIMIT 300")
    leads = []
    for r in rows:
        stage = "checkout_started" if r["unpaid_count"] else "cart" if r["cart_count"] else "wishlist"
        leads.append({
            "user_id": r["user_id"], "name": r["name"], "email": r["email"], "phone": r["phone"],
            "stage": stage, "last_activity": r["last_activity"],
            "wishlist": {"count": r["wishlist_count"], "items": r["wishlist_items"],
                         "at": r["wishlist_at"]} if r["wishlist_count"] else None,
            "cart": {"count": r["cart_count"], "value": db.to_paise(r["cart_value_n"]),
                     "items": r["cart_items"], "at": r["cart_at"]} if r["cart_count"] else None,
            "checkout": {"count": r["unpaid_count"], "value": db.to_paise(r["unpaid_value_n"]),
                         "status": db.ORDER_STATUS_FROM_DB.get(r["unpaid_status"], r["unpaid_status"]),
                         "order_id": r["unpaid_order_id"],
                         "items": r["unpaid_items"], "at": r["unpaid_at"]} if r["unpaid_count"] else None,
        })
    return leads


@api.get("/admin/customers/{user_id}")
async def admin_customer_detail(user_id: str, _: str = Depends(require_admin)):
    """Buyer profile + order history — surfaced on the dispatch panel so staff can see
    who they're shipping to and what else this buyer has ordered before they dispatch
    a package. require_admin (not require_owner): dispatch is an operational task any
    admin/staff performs, so this needs the same access as /admin/orders and /admin/dispatch.
    """
    profile = await _load_user(user_id=user_id)
    if not profile:
        raise HTTPException(404, "Customer not found")
    rows = await db.fetch_all(
        _ORDER_SELECT + " WHERE o.user_id = $1::uuid ORDER BY o.created_at DESC LIMIT 20",
        user_id)
    orders = await _shape_orders(rows)
    return {
        "profile": {k: v for k, v in profile.items() if k != "password_hash"},
        "orders": [
            {"order_id": o["order_id"], "order_no": o.get("order_no"),
             "status": o["status"], "total": o["total"],
             "created_at": o["created_at"], "item_count": len(o["items"])}
            for o in orders
        ],
    }


@api.get("/admin/products/stock")
async def admin_product_stock(_: str = Depends(require_perm("products"))):
    """In-stock unit count per product, so the Products screen can show live stock and
    add-units without pulling every unit row. One grouped query, not an N+1."""
    rows = await db.fetch_all(
        """SELECT product_id::text AS product_id, count(*) AS in_stock
             FROM product_units WHERE status = 'in_stock' GROUP BY product_id""")
    return {r["product_id"]: r["in_stock"] for r in rows}


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
    # Dedicated admin query: unlike the public verify shape, this exposes WHO the
    # certificate is assigned to (buyer name/email + order) so staff can see, for each
    # certificate, which user owns it and for what product. Buyer identity is only
    # populated once the unit is sold/dispatched — otherwise it's unassigned stock.
    rows = await db.fetch_all("""
        SELECT ac.id::text                       AS cert_id,
               ac.verify_code                     AS verify_code,
               ac.signed_payload->>'product_name' AS product_name,
               ac.signed_payload->>'serial'       AS serial,
               ac.signature                       AS signature_ed25519_hex,
               ac.revoked_at                      AS revoked_at,
               ac.product_unit_id::text           AS unit_id,
               pu.product_id::text                AS product_id,
               q.token                            AS qr_token,
               q.status::text                     AS qr_status,
               o.id::text                         AS order_id,
               o.order_no                         AS order_no,
               u.id::text                         AS buyer_id,
               u.full_name                        AS buyer_name,
               u.email::text                      AS buyer_email
          FROM authenticity_certificates ac
          JOIN product_units pu ON pu.id = ac.product_unit_id
          LEFT JOIN qr_codes q  ON q.authenticity_certificate_id = ac.id
          LEFT JOIN order_items oi ON oi.id = pu.sold_order_item_id
          LEFT JOIN orders o ON o.id = oi.order_id
          LEFT JOIN users u ON u.id = o.user_id
         ORDER BY ac.issued_at DESC LIMIT 500""")
    return [{k: v for k, v in r.items() if k not in ("qr_status", "revoked_at")} | {
        "activated": r["qr_status"] == "active",
        "revoked": r["revoked_at"] is not None,
    } for r in rows]


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
           COALESCE(r.photos, '[]'::jsonb) AS photos,
           (r.order_item_id IS NOT NULL) AS verified_buyer,
           r.created_at       AS created_at
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
"""


def _shape_review(row) -> dict:
    """Rows come back with `photos` as a JSON string (jsonb). Decode it so the API
    emits a real array; everything else passes through."""
    d = dict(row)
    photos = d.get("photos")
    if isinstance(photos, str):
        try:
            photos = json.loads(photos)
        except (ValueError, TypeError):
            photos = []
    d["photos"] = photos or []
    return d


@api.post("/reviews/photo")
async def upload_review_photo(request: Request, user_id: str = Depends(require_user)):
    """Logged-in users attach photos to a review. Single image under form field
    'file'; returns a servable URL to include in ReviewIn.photos (max 3 per review)."""
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Attach a file under form field 'file'")
    filename = getattr(upload, "filename", "") or "photo.bin"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    ct = _MIME.get(ext) or getattr(upload, "content_type", None) or "application/octet-stream"
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Max 8MB per photo")
    if not ct.startswith("image/"):
        raise HTTPException(400, "Only image files are supported")
    path = f"{_APP_NAME_STORAGE}/reviews/{uuid.uuid4().hex}.{ext}"
    result = await _storage_put(path, data, ct)
    storage_path = result.get("path") or path
    media_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO media_assets (id, owner_type, storage_provider, bucket, object_key,
                mime_type, file_size_bytes, original_filename, is_public, uploaded_by)
           VALUES ($1,'user','supabase',$2,$3,$4,$5,$6,true,$7::uuid)""",
        media_id, storage_sb.BUCKET, storage_path, ct,
        result.get("size") or len(data), filename, user_id)
    return {"media_id": str(media_id), "url": _media_public_url(storage_path)}


@api.post("/reviews")
async def create_review(body: ReviewIn, user_id: str = Depends(require_user)):
    review_id = uuid.uuid4()
    # If this user bought the product, link the order item so the review is a
    # verified-buyer one; otherwise it's an unverified review (still allowed).
    order_item_id = await db.fetch_val(
        """SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.user_id = $1::uuid AND oi.product_id = $2::uuid
            ORDER BY oi.created_at DESC LIMIT 1""", user_id, body.product_id)
    photos = [str(u) for u in (body.photos or [])][:3]
    await db.execute(
        """INSERT INTO reviews (id, product_id, user_id, order_item_id, rating, title,
                                body, photos, moderation_status)
           VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::jsonb,'approved')""",
        review_id, body.product_id, user_id, order_item_id, body.rating,
        body.title, body.body, photos)
    row = await db.fetch_one(_REVIEW_SELECT + " WHERE r.id = $1::uuid", str(review_id))
    return _shape_review(row)


@api.get("/reviews/{product_id}")
async def list_reviews(product_id: str):
    # Only approved reviews are shown publicly (admins can delete unwanted ones).
    rows = await db.fetch_all(
        _REVIEW_SELECT + " WHERE r.product_id = $1::uuid"
        " AND r.moderation_status = 'approved'"
        " ORDER BY r.created_at DESC LIMIT 200", product_id)
    return [_shape_review(r) for r in rows]


# ── Admin: review moderation ─────────────────────────────────────────────────
# Same shape as _REVIEW_SELECT but joins the product so staff see what was reviewed.
_ADMIN_REVIEW_SELECT = """
    SELECT r.id::text         AS review_id,
           r.product_id::text AS product_id,
           r.user_id::text    AS user_id,
           COALESCE(u.full_name, 'Anonymous') AS author,
           COALESCE(u.email::text, '') AS author_email,
           p.title            AS product_title,
           p.slug::text       AS product_slug,
           r.rating           AS rating,
           COALESCE(r.title, '') AS title,
           COALESCE(r.body, '')  AS body,
           COALESCE(r.photos, '[]'::jsonb) AS photos,
           (r.order_item_id IS NOT NULL) AS verified_buyer,
           r.created_at       AS created_at
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN products p ON p.id = r.product_id
"""


@api.get("/admin/reviews")
async def admin_list_reviews(_: str = Depends(require_admin), limit: int = 500):
    rows = await db.fetch_all(
        _ADMIN_REVIEW_SELECT + " ORDER BY r.created_at DESC LIMIT $1", limit)
    return [_shape_review(r) for r in rows]


@api.delete("/admin/reviews/{review_id}")
async def admin_delete_review(review_id: str, actor: str = Depends(require_admin)):
    got = await db.fetch_val(
        "DELETE FROM reviews WHERE id = $1::uuid RETURNING id", review_id)
    if not got:
        raise HTTPException(404, "Review not found")
    await audit_log(actor, "review.delete", review_id)
    return {"ok": True}


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
           a.price_usd         AS price_usd_n,
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
              if k not in ("price_n", "price_usd_n", "commission_pct_n", "password_hash")},
           "price": db.to_paise(r["price_n"]),
           "price_usd": db.to_paise(r["price_usd_n"]),
           "currency": "INR",
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
           c.currency                     AS currency,
           c.status::text                 AS status,
           c.payment_status                AS payment_status,
           c.preferred_date                AS preferred_date,
           c.time_of_day                   AS time_of_day,
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


async def _astrologers_body(currency: str = "INR") -> list:
    rows = await db.fetch_all(
        _ASTRO_SELECT + " WHERE a.is_active ORDER BY a.created_at LIMIT 50")
    db_a = [_shape_astro(r) for r in rows]
    if not db_a:
        return [{"currency": "INR", **a} for a in ASTROLOGERS]
    if currency == "USD":
        for a in db_a:
            if a.get("price_usd") is not None:
                a["price"], a["currency"] = a["price_usd"], "USD"
    return db_a


@api.get("/consultation/astrologers")
async def list_astrologers(currency: str = "INR"):
    currency = currency if currency in SUPPORTED_CURRENCIES else "INR"
    return await respcache.get_or_set(f"astrologers:{currency}", ttl=120, tag="astrologers",
                                      compute=lambda: _astrologers_body(currency))


@api.post("/consultation/book")
async def book(body: ConsultationBookIn, request: Request,
                user_id: Optional[str] = Depends(get_user_id_optional)):
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

    await db.execute(
        """INSERT INTO consultations (id, astrologer_id, astrologer_name_snapshot, slot_at,
                user_id, contact_name, contact_email, contact_phone, concern, amount,
                status)
           VALUES ($1,$2::uuid,$3,$4,$5::uuid,$6,$7::citext,$8,$9,$10,
                   'requested')""",
        booking_id, astro["astrologer_id"], astro["name"], slot_at, user_id,
        body.name, body.email, body.phone, body.concern, db.to_amount(astro["price"]))

    # WhatsApp confirmation — astrologer/exact time follow separately once staff
    # set up the meeting link (see admin_update_consultation).
    if body.phone:
        slot_human = slot_at.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
        _wa_fire_event("consultation.booked", phone=body.phone, name=body.name, user_id=user_id,
                 variables={"astrologer_name": astro["name"], "slot": slot_human,
                            "amount": f"₹{astro['price'] / 100:,.0f}"})
    return await _load_consultation(str(booking_id))


# ── Consultation v2: pay-first, astrologer assigned by admin afterward ────────
# No astrologer picker on the public page — the buyer pays a fixed fee, picks a
# date + time-of-day preference, and we assign whoever's free from the admin
# panel (see admin_update_consultation below), which is when the video room is
# created and both parties are WhatsApp-notified with the meet link.
async def _consultation_fee_body(currency: str = "INR") -> dict:
    content = await _site_content("consultation") or _DEFAULT_CONSULTATION
    fee_paise = content["fee_paise"]
    # fee_usd (cents) is an optional sibling key on the same site_content doc — set
    # via the existing generic /admin/site-content/consultation PUT, no new schema.
    fee_usd = content.get("fee_usd")
    if currency == "USD" and fee_usd is not None:
        return {"fee": fee_usd, "currency": "USD"}
    return {"fee": fee_paise, "currency": "INR"}


@api.get("/consultation/fee")
async def consultation_fee(currency: str = "INR"):
    currency = currency if currency in SUPPORTED_CURRENCIES else "INR"
    # Reads the "consultation" site_content key, so it shares that tag — a fee
    # edit via /admin/site-content/consultation invalidates this too.
    return await respcache.get_or_set(f"consultation_fee:{currency}", ttl=300, tag="site_content",
                                      compute=lambda: _consultation_fee_body(currency))


@api.post("/consultation/request")
async def consultation_request(body: ConsultationRequestIn, currency: str = "INR",
                               user_id: Optional[str] = Depends(get_user_id_optional)):
    try:
        pref_date = date.fromisoformat(body.preferred_date)
    except ValueError:
        raise HTTPException(400, "preferred_date must be YYYY-MM-DD")
    # Nominal hour per bucket — the real time is agreed over WhatsApp once we assign
    # an astrologer. Kept as a real timestamptz so existing slot_at consumers (the
    # calendar-link helper, admin listing) don't need a second code path.
    slot_at = datetime.combine(pref_date, dtime(hour=_TIME_OF_DAY_HOUR[body.time_of_day]),
                               tzinfo=timezone.utc)

    # No surcharge/options concept here (unlike products), so — unlike checkout —
    # the consultation can safely charge in the visitor's exact regional currency,
    # not just INR/USD: _consultation_fee_body already does the full exact-currency
    # -> USD -> INR fallback (region_pricing, Phase 1).
    fee_resolved = await _consultation_fee_body(currency if currency in SUPPORTED_CURRENCIES else "INR")
    fee, resolved_currency = fee_resolved["fee"], fee_resolved["currency"]
    booking_id = uuid.uuid4()

    # Same INR-stays-on-Cashfree / everything-else-goes-to-Razorpay split as /checkout.
    cf_app_id = None
    cf_order_id = f"mock_{booking_id}"
    payment_session_id = None
    razorpay_order = None
    if resolved_currency != "INR":
        rzp_key_id, rzp_secret = _razorpay_keys()
        if rzp_key_id and rzp_secret:
            try:
                rzp_order = await _razorpay_create_order(
                    rzp_key_id, rzp_secret, fee, resolved_currency, str(booking_id))
                cf_order_id = rzp_order["order_id"]
                razorpay_order = {"order_id": cf_order_id, "key_id": rzp_key_id,
                                   "amount": fee, "currency": resolved_currency}
            except Exception as e:
                log.warning(f"razorpay create failed (consultation): {e} — falling back to mock")
    else:
        cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
        cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
        if cf_app_id and cf_secret:
            try:
                cf_order = await _cashfree_create_order(
                    cf_app_id, cf_secret, fee, resolved_currency, str(booking_id),
                    {"customer_id": re.sub(r"[^A-Za-z0-9]", "", str(user_id or booking_id))[:50],
                     "customer_name": body.name, "customer_email": body.email,
                     "customer_phone": body.phone},
                    f"{os.environ.get('PUBLIC_APP_URL', '').rstrip('/')}/consultation")
                cf_order_id = cf_order["order_id"]
                payment_session_id = cf_order["payment_session_id"]
            except Exception as e:
                log.warning(f"cashfree create failed (consultation): {e} — falling back to mock")

    # razorpay_order_id/razorpay_payment_id are gateway-agnostic gateway-ref columns
    # in practice (they just predate the Cashfree switch) — reused as-is rather than
    # renamed, to avoid a migration for what's purely a naming nicety. They now hold
    # an actual Razorpay order id again for non-INR bookings.
    await db.execute(
        """INSERT INTO consultations (id, astrologer_id, astrologer_name_snapshot, slot_at,
                preferred_date, time_of_day, user_id, contact_name, contact_email,
                contact_phone, concern, amount, currency, status, payment_status, razorpay_order_id)
           VALUES ($1,NULL,NULL,$2,$3,$4,$5::uuid,$6,$7::citext,$8,$9,$10,$11,
                   'requested','pending',$12)""",
        booking_id, slot_at, pref_date, body.time_of_day, user_id,
        body.name, body.email, body.phone, body.concern, db.to_amount(fee), resolved_currency, cf_order_id)

    consult = await _load_consultation(str(booking_id))
    return {"consultation": consult, "payment_session_id": payment_session_id, "cf_app_id": cf_app_id or None,
            "razorpay": razorpay_order}


class ConsultationVerifyIn(BaseModel):
    # Only set for a Razorpay (non-INR) booking — see CashfreeVerifyIn's twin fields.
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


@api.post("/consultation/{booking_id}/verify")
async def consultation_verify(booking_id: str, body: Optional[ConsultationVerifyIn] = None):
    """Same reasoning as /checkout/verify: Cashfree gives no client-side signature,
    so the server asks Cashfree directly whether the payment succeeded. A non-INR
    booking instead verifies the Razorpay-signed payment/order/signature triple."""
    consult = await _load_consultation(booking_id)
    if not consult:
        raise HTTPException(404, "Consultation not found")
    if consult["payment_status"] == "paid":
        return consult
    gateway_ref = await db.fetch_val(
        "SELECT razorpay_order_id FROM consultations WHERE id = $1::uuid", booking_id)
    if not gateway_ref:
        raise HTTPException(404, "No payment attempt found for this booking")

    if (consult.get("currency") or "INR") != "INR":
        body = body or ConsultationVerifyIn()
        rzp_key_id, rzp_secret = _razorpay_keys()
        if not (rzp_key_id and rzp_secret):
            raise HTTPException(400, "Razorpay not configured — use /api/consultation/{id}/mock-pay for dev.")
        if not (body.razorpay_payment_id and body.razorpay_signature):
            raise HTTPException(400, "Missing Razorpay payment confirmation")
        if not _razorpay_verify_signature(gateway_ref, body.razorpay_payment_id,
                                          body.razorpay_signature, rzp_secret):
            raise HTTPException(400, "Payment could not be verified")
        return await _mark_consultation_paid(booking_id, body.razorpay_payment_id)

    cf_app_id = os.environ.get("CASHFREE_APP_ID", "")
    cf_secret = os.environ.get("CASHFREE_SECRET_KEY", "")
    if not (cf_app_id and cf_secret):
        raise HTTPException(400, "Cashfree not configured — use /api/consultation/{id}/mock-pay for dev.")
    try:
        cf_payments = await _cashfree_get_order_payments(cf_app_id, cf_secret, gateway_ref)
    except Exception as e:
        log.warning(f"cashfree verify fetch failed (consultation): {e}")
        raise HTTPException(502, "Could not confirm this payment with Cashfree. Please try again shortly.")
    success = next((p for p in cf_payments if p.get("payment_status") == "SUCCESS"), None)
    if not success:
        raise HTTPException(400, "Payment not confirmed yet")
    return await _mark_consultation_paid(booking_id, str(success.get("cf_payment_id")))


@api.post("/consultation/{booking_id}/mock-pay")
async def consultation_mock_pay(booking_id: str):
    _require_dev_env()
    consult = await _load_consultation(booking_id)
    if not consult:
        raise HTTPException(404, "Consultation not found")
    if consult["payment_status"] == "paid":
        return consult
    return await _mark_consultation_paid(booking_id, f"mock_pay_{uid()}")


async def _mark_consultation_paid(booking_id: str, payment_id: str) -> dict:
    consult = await _load_consultation(booking_id)
    async with db.transaction() as conn:
        await conn.execute(
            """UPDATE consultations
                  SET payment_status='paid', razorpay_payment_id=$2, updated_at=now()
                WHERE id=$1::uuid""", booking_id, payment_id)
        # 'pending' rather than the column default 'available' — the credit isn't
        # usable until the astrologer actually delivers the session (see
        # _activate_consultation_credit, fired when status flips to 'completed').
        await conn.execute(
            """INSERT INTO consultation_credits (id, consultation_id, user_id, phone, email,
                    amount, currency, status, expires_at)
               VALUES ($1,$2::uuid,$3::uuid,$4,$5::citext,$6,$7,'pending', now() + interval '90 days')""",
            uuid.uuid4(), booking_id, consult["user_id"], consult["phone"], consult["email"],
            db.to_amount(consult["amount"]), consult.get("currency") or "INR")
    # Instant confirmation — astrologer + exact time + meet link follow separately
    # once staff assign them (see admin_update_consultation).
    if consult.get("phone"):
        amount_label = (f"₹{consult['amount'] / 100:,.0f}" if (consult.get("currency") or "INR") == "INR"
                        else f"{consult['amount'] / 100:,.2f} {consult.get('currency')}")
        _wa_fire_event("consultation.booked", phone=consult["phone"], name=consult["name"],
                      user_id=consult.get("user_id"),
                      variables={"amount": amount_label})
    return await _load_consultation(booking_id)


async def _activate_consultation_credit(booking_id: str) -> None:
    """Flip a paid consultation's credit from 'pending' to spendable 'available' —
    called when the consultation's status becomes 'completed', whether that's the
    astrologer marking their own session done or staff doing it from admin. Guarded
    by status='pending' so calling this on an already-active or non-existent credit
    is a safe no-op."""
    await db.execute(
        "UPDATE consultation_credits SET status='available' WHERE consultation_id=$1::uuid"
        " AND status='pending'", booking_id)


@api.get("/me/consultations")
async def my_consultations(user_id: str = Depends(require_user)):
    rows = await db.fetch_all(
        _CONSULT_SELECT + " WHERE c.user_id = $1::uuid ORDER BY c.created_at DESC LIMIT 100",
        user_id)
    return [_shape_consult(r) for r in rows]


async def _find_eligible_credit(user_id: str) -> Optional[dict]:
    """The buyer's oldest unexpired, unredeemed consultation credit — matched by their
    own account id, or (for a guest-booked consultation) by their own verified phone/
    email. Both sides of the phone/email match come from the `users` row for user_id,
    never from client input, so a checkout can't be spoofed into claiming someone
    else's credit by typing their phone number."""
    return await db.fetch_one(
        """SELECT cc.* FROM consultation_credits cc, users u
            WHERE u.id = $1::uuid
              AND cc.status='available' AND cc.expires_at > now()
              AND (cc.user_id = $1::uuid
                   OR (cc.user_id IS NULL AND (cc.phone = u.phone OR cc.email = u.email)))
            ORDER BY cc.created_at ASC LIMIT 1""", user_id)


@api.get("/me/consultation-credit")
async def my_consultation_credit(user_id: str = Depends(require_user)):
    credit = await _find_eligible_credit(user_id)
    if not credit:
        return {"available": False}
    return {"available": True, "amount": db.to_paise(credit["amount"]),
            "currency": (credit.get("currency") or "INR").strip(),
            "expires_at": credit["expires_at"]}


# ── Dev seed (idempotent) ─────────────────────────────────────────────────────
@api.post("/dev/seed")
async def dev_seed():
    """Seed admin user + demo catalog (idempotent). DEV ONLY — 404s in production
    so an attacker can't (re)create a known-credential admin account on the live DB.

    Lives in backend/seed_pg.py: the Postgres seed touches ~15 tables (categories,
    products + variants + per-category detail rows, media, units, temples/priests,
    signing key, certs + lab/energization/QR, users + roles/permissions/prefs,
    astrologers), which is far too much to inline in a route handler.
    """
    _require_dev_env()
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
    category: Optional[str] = None        # top-level category key (the type)
    subcategory_id: Optional[str] = None  # sub under it; null files under the top-level
    description: Optional[str] = None
    price: Optional[int] = None
    price_usd: Optional[int] = None  # cents — shown/charged to visitors outside India
    mrp: Optional[int] = None
    images: Optional[List[str]] = None
    attrs: Optional[dict] = None
    devanagari_name: Optional[str] = None
    is_active: Optional[bool] = None
    stock_qty: Optional[int] = None  # for non-serialised items
    care_instructions: Optional[List[str]] = None
    variant_options: Optional[VariantOptionsIn] = None
    shipping_charges: Optional[Dict[str, float]] = None  # region label -> USD amount


class CategoryIn(BaseModel):
    # Top-level: `key` is one of the fixed category_key enum values (the type).
    # Subcategory: send `parent_id` instead; it inherits the parent's type, so `key`
    # isn't needed (and is ignored).
    key: Optional[str] = None
    label: str
    hindi: Optional[str] = ""
    parent_id: Optional[str] = None
    order: int = 100
    banner: Optional[dict] = None  # collection-banner content; see _normalize_category_banner


class CategoryUpdateIn(BaseModel):
    label: Optional[str] = None
    hindi: Optional[str] = None
    parent_id: Optional[str] = None
    order: Optional[int] = None
    banner: Optional[dict] = None


class AstrologerIn(BaseModel):
    name: str
    devanagari: Optional[str] = ""
    expertise: List[str] = []
    price: int
    price_usd: Optional[int] = None  # cents — shown/charged to visitors outside India
    years: int = 0
    picture: str = ""
    email: Optional[EmailStr] = None       # login email; welcome mail is minted for this
    phone: Optional[str] = None             # for the WhatsApp onboarding message
    commission_pct: float = 10.0            # 0-100, per-astrologer share of affiliate sales
    bio: Optional[str] = ""


class AstrologerUpdateIn(BaseModel):
    name: Optional[str] = None
    devanagari: Optional[str] = None
    expertise: Optional[List[str]] = None
    price: Optional[int] = None
    price_usd: Optional[int] = None
    years: Optional[int] = None
    picture: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
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
    subject: Optional[str] = None  # derived from category/order when blank
    message: str
    category: Optional[str] = None  # order | payment | refund | return | product | other
    order_id: Optional[str] = None  # the order this is about, if any


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
    # Best-effort invite via WhatsApp (OpenWA) or logged in mock mode
    login_url = os.environ.get("PUBLIC_APP_URL", "").rstrip("/") + "/login"
    invite_sent = False
    invite_channel = "mock"
    if phone:
        try:
            invite_text = (
                f"You've been added as staff on Tredev Gems.\n"
                f"Name: {body.name}\nEmail: {body.email.lower()}\n"
                f"Temporary password: {temp_pw}\n"
                f"Login: {login_url or 'https://gemora.in/login'}")
            result = await wa_send_utility(phone, invite_text)
            invite_sent = True
            invite_channel = "mock" if result.get("mock") else "openwa"
        except Exception as e:
            log.warning(f"staff invite WA failed: {e}")
    await audit_log(actor, "staff.create", doc["user_id"], {"email": body.email.lower(), "permissions": perms, "invite_sent": invite_sent})
    doc.pop("password_hash", None)
    return {**doc, "temp_password": temp_pw, "invite_sent": invite_sent, "invite_channel": invite_channel}


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


# The audit trail powers the admin "Activity Log" page: who (owner/staff) did what, to
# what, and when. Owner-only — it exposes every admin's actions, so staff must not read it.
_AUDIT_SELECT = """
      FROM admin_events e
      LEFT JOIN users u ON u.id = e.actor_id
      LEFT JOIN LATERAL (
            SELECT ro.name
              FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
             WHERE ur.user_id = u.id
             ORDER BY CASE ro.name WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END
             LIMIT 1
      ) r ON true
"""


@api.get("/admin/audit-log")
async def admin_audit_log(
    _: str = Depends(require_owner),
    limit: int = 100,
    offset: int = 0,
    q: Optional[str] = None,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    date_from: Optional[str] = None,   # ISO date/datetime, inclusive
    date_to: Optional[str] = None,     # ISO date/datetime, inclusive (whole day if date-only)
):
    """Paginated, filterable admin activity trail. Returns {items, total}."""
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    # Validate before these reach SQL: a malformed uuid/date would otherwise surface
    # as a raw Postgres cast error (500). Filters come from the UI, but the endpoint
    # must not fall over on a hand-typed query string.
    if actor_id:
        try:
            uuid.UUID(actor_id)
        except ValueError:
            raise HTTPException(400, "Invalid actor_id")
    for _label, _val in (("date_from", date_from), ("date_to", date_to)):
        if _val:
            try:
                datetime.fromisoformat(_val.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(400, f"Invalid {_label} — expected ISO date or datetime")

    where: list[str] = []
    args: list = []

    def _arg(v):
        args.append(v)
        return f"${len(args)}"

    if action:
        where.append(f"e.action = {_arg(action)}")
    if actor_id:
        where.append(f"e.actor_id = {_arg(actor_id)}::uuid")
    # NOTE: the params are cast ::text first. A bare `$1::timestamptz` makes asyncpg
    # infer the argument as timestamptz and reject the plain string the client sends.
    if date_from:
        where.append(f"e.created_at >= {_arg(date_from)}::text::timestamptz")
    if date_to:
        # A bare date ("2026-07-20") means "through the end of that day".
        a = f"{_arg(date_to)}::text"
        where.append(
            f"e.created_at < (CASE WHEN length({a}) <= 10"
            f" THEN ({a}::date + 1)::timestamptz ELSE {a}::timestamptz END)")
    if q:
        a = _arg(f"%{q}%")
        where.append(
            f"(e.action ILIKE {a} OR e.target ILIKE {a} OR e.meta::text ILIKE {a}"
            f" OR u.full_name ILIKE {a} OR u.email::text ILIKE {a})")

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = await db.fetch_val(f"SELECT count(*){_AUDIT_SELECT}{clause}", *args)
    rows = await db.fetch_all(
        f"""SELECT e.id::text                       AS event_id,
                   e.actor_id::text                 AS actor_id,
                   COALESCE(u.full_name, '')        AS actor_name,
                   COALESCE(u.email::text, '')      AS actor_email,
                   COALESCE(r.name, '')             AS actor_role_row,
                   e.action                         AS action,
                   COALESCE(e.target, '')           AS target,
                   e.meta                           AS meta,
                   e.created_at                     AS at
            {_AUDIT_SELECT}{clause}
            ORDER BY e.created_at DESC
            LIMIT {_arg(limit)} OFFSET {_arg(offset)}""", *args)

    items = []
    for row in rows:
        d = dict(row)
        # roles.admin is the app's "owner" — keep the same vocabulary the UI uses.
        d["actor_role"] = _ROLE_FROM_DB.get(d.pop("actor_role_row", ""), "")
        if not d["actor_name"]:
            # Deleted user (actor_id FK is ON DELETE SET NULL) — don't render a blank row.
            d["actor_name"] = "Deleted user" if d["actor_id"] else "System"
        items.append(d)
    return {"items": items, "total": total or 0}


@api.get("/admin/audit-log/filters")
async def admin_audit_log_filters(_: str = Depends(require_owner)):
    """Distinct actions and actors, for the Activity Log filter dropdowns."""
    actions = await db.fetch_all(
        "SELECT DISTINCT action FROM admin_events ORDER BY action")
    actors = await db.fetch_all(
        """SELECT DISTINCT e.actor_id::text          AS actor_id,
                  COALESCE(u.full_name, '')          AS name,
                  COALESCE(u.email::text, '')        AS email
             FROM admin_events e
             LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.actor_id IS NOT NULL
            ORDER BY name""")
    return {
        "actions": [a["action"] for a in actions],
        "actors": [dict(a) for a in actors],
    }


@api.post("/admin/inventory/purge")
async def admin_purge_inventory(actor: str = Depends(require_owner)):
    """Wipe ALL unsold inventory (owner-confirmed reset): every in-stock unit across
    every product is removed, and non-serialized stock counts are zeroed. Sold units are
    left untouched — they belong to completed orders and their certificates. Products
    themselves stay; only their sellable stock is cleared."""
    async with db.transaction() as conn:
        unsold = await conn.fetch(
            "SELECT id::text AS id FROM product_units WHERE sold_order_item_id IS NULL")
        removed = await _delete_units(conn, [r["id"] for r in unsold])
        # Non-serialized products carry stock on the variant, not as units.
        await conn.execute(
            "UPDATE product_variants SET stock_qty=0, updated_at=now() "
            "WHERE stock_qty IS NOT NULL AND stock_qty <> 0")
    await audit_log(actor, "inventory.purge_all", "", {"units_removed": removed})
    return {"ok": True, "units_removed": removed}


@api.get("/admin/inventory/low-stock")
async def admin_low_stock(_: str = Depends(require_perm("inventory")), threshold: int = 0):
    """List serialised products where available units ≤ threshold — the dashboard uses
    threshold=0, i.e. actually out of stock, not merely running low."""
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
                    WHERE status IN ('open','in_progress')) AS open_queries,
                  (SELECT count(*) FROM orders WHERE created_at >= $1 AND status = 'cancelled') AS cancelled,
                  (SELECT count(*) FROM orders WHERE created_at >= $1 AND status = 'refunded') AS refunded,
                  (SELECT count(*) FROM consultations WHERE created_at >= $1) AS new_consultations,
                  (SELECT count(*) FROM wishlist WHERE created_at >= $1) AS new_leads""", since)

    # Unified activity feed: new orders, cancellations/refunds (from the order_events
    # audit trail), new consultation requests, and new leads (wishlist adds) — one
    # query instead of four separate round trips.
    activity = await db.fetch_all(
        """SELECT 'order' AS type, o.id::text AS ref_id, o.created_at AS at,
                  o.status::text AS status, o.grand_total AS amount_n,
                  u.full_name AS name, NULL::text AS extra
             FROM orders o LEFT JOIN users u ON u.id = o.user_id
            WHERE o.created_at >= $1
            UNION ALL
           SELECT CASE oe.to_status::text WHEN 'cancelled' THEN 'cancellation' ELSE 'refund' END,
                  oe.order_id::text, oe.created_at, oe.to_status::text, o.grand_total,
                  u.full_name, oe.reason
             FROM order_events oe
             JOIN orders o ON o.id = oe.order_id
             LEFT JOIN users u ON u.id = o.user_id
            WHERE oe.created_at >= $1 AND oe.to_status::text IN ('cancelled', 'refunded')
            UNION ALL
           SELECT 'consultation', c.id::text, c.created_at, c.status::text, c.amount,
                  c.contact_name, c.concern
             FROM consultations c
            WHERE c.created_at >= $1
            UNION ALL
           SELECT 'lead', w.product_id::text, w.created_at, 'wishlist', NULL,
                  u.full_name, p.title
             FROM wishlist w
             JOIN users u ON u.id = w.user_id
             JOIN products p ON p.id = w.product_id
            WHERE w.created_at >= $1
            ORDER BY at DESC LIMIT 40""", since)

    return {
        "revenue_paise": revenue,
        "orders_total": head["orders_total"],
        "orders_paid": paid_n,
        "aov_paise": int(revenue / paid_n) if paid_n else 0,
        "customers_total": stats["customers_total"],
        "new_customers": stats["new_customers"],
        "open_queries": stats["open_queries"],
        "cancelled": stats["cancelled"],
        "refunded": stats["refunded"],
        "new_consultations": stats["new_consultations"],
        "new_leads": stats["new_leads"],
        "by_day": [{"day": d["day"], "revenue": db.to_paise(d["revenue_n"]),
                    "orders": d["orders"]} for d in by_day],
        "by_category": [{"category": db.CATEGORY_FROM_DB.get(c["category"], c["category"]),
                         "revenue_paise": db.to_paise(c["revenue_n"])} for c in by_cat],
        "activity": [{"type": a["type"], "ref_id": a["ref_id"], "at": a["at"],
                      "status": a["status"], "amount_paise": db.to_paise(a["amount_n"]),
                      "name": a["name"], "extra": a["extra"]} for a in activity],
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
    "price_usd": ("price_usd", db.to_amount),
    "mrp": ("compare_at_price", db.to_amount),
    "is_serialized": ("is_serialized", lambda v: v),
    "attrs": ("attributes", lambda v: v),
    "shipping_charges": ("shipping_charges", lambda v: v),
    "care_instructions": ("care_instructions",
                          lambda v: [s.strip() for s in v if s and s.strip()]),
    "variant_options": ("variant_options", _normalize_variant_options),
}


@api.patch("/admin/products/{product_id}")
async def admin_update_product(product_id: str, body: ProductUpdateIn, actor: str = Depends(require_perm("products"))):
    sent = body.model_dump(exclude_unset=True)  # keeps explicit nulls (e.g. clearing the sub)
    updates = {k: v for k, v in sent.items() if v is not None}
    if not sent:
        raise HTTPException(400, "Nothing to update")
    sets, args = [], []
    # Placement (category + optional subcategory) is computed together, since the sub
    # decides the exact category_id and the top-level decides the type/category_key.
    if "category" in sent or "subcategory_id" in sent:
        if sent.get("category"):
            ck = db.CATEGORY_TO_DB.get(sent["category"])
            if not ck:
                raise HTTPException(400, f"Unknown category: {sent['category']}")
        else:  # subcategory changed without touching the top-level — keep current type
            ck = await db.fetch_val(
                "SELECT category_key::text FROM products WHERE id=$1::uuid", product_id)
        cat_id = await _resolve_category_id(ck, sent.get("subcategory_id"))
        args.append(ck); sets.append(f"category_key = ${len(args)}::category_key")
        args.append(cat_id); sets.append(f"category_id = ${len(args)}::uuid")
    for k, v in updates.items():
        if k in ("category", "subcategory_id"):
            continue  # placement handled above
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
    # Log which fields changed, not the whole product — keeps the trail readable.
    await audit_log(actor, "product.update", product_id,
                    {"fields": sorted(sent.keys()), "name": row.get("name")})
    return _shape_product(row)


async def _delete_units(conn, unit_ids: list[str]) -> int:
    """Hard-delete product_units and everything hanging off them, in FK order.

    Only call with units that were never sold — a sold unit is referenced by an
    order_item (NO ACTION) and belongs to order history. In the current flow an unsold
    in-stock unit has no certificate/QR (those are issued at dispatch), so most of these
    deletes are no-ops; they're here so the delete is correct even for legacy rows."""
    if not unit_ids:
        return 0
    ids = unit_ids
    # qr_codes -> authenticity_certificates -> lab/energization: child before parent.
    await conn.execute("DELETE FROM qr_codes WHERE product_unit_id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM authenticity_certificates WHERE product_unit_id = ANY($1::uuid[])", ids)
    for tbl in ("lab_certifications", "energization_certificates", "pooja_recordings",
                "returns", "reservations", "temple_associations", "cart_items"):
        await conn.execute(f"DELETE FROM {tbl} WHERE product_unit_id = ANY($1::uuid[])", ids)
    n = await conn.fetchval(
        "WITH d AS (DELETE FROM product_units WHERE id = ANY($1::uuid[]) RETURNING 1) "
        "SELECT count(*) FROM d", ids)
    return n or 0


async def _purge_product(conn, product_id: str) -> None:
    """Remove a product and its remaining rows entirely. Only valid once its units are
    gone and it has never been in an order (order_items is NO ACTION → the product row
    can't be deleted while any order references it). jewellery_designs / verified_items
    / wishlist cascade on the products delete; everything else is explicit."""
    await conn.execute("DELETE FROM temple_associations WHERE product_id=$1::uuid", product_id)
    await conn.execute("DELETE FROM digital_assets WHERE product_id=$1::uuid", product_id)
    await conn.execute(
        """DELETE FROM cart_items WHERE variant_id IN
             (SELECT id FROM product_variants WHERE product_id=$1::uuid)""", product_id)
    await conn.execute("DELETE FROM product_variants WHERE product_id=$1::uuid", product_id)
    for tbl in ("book_details", "gemstone_details", "idol_details", "prashad_details",
                "rudraksha_details", "yantra_details", "product_media",
                "product_questions", "reviews"):
        await conn.execute(f"DELETE FROM {tbl} WHERE product_id=$1::uuid", product_id)
    await conn.execute("DELETE FROM products WHERE id=$1::uuid", product_id)


@api.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, actor: str = Depends(require_perm("products"))):
    """Remove a product and its inventory. A product that's been ordered can't be
    deleted outright (order history references it), so it's archived and its *unsold*
    stock is cleared — no active product ever leaves sellable inventory behind. A
    product that was never ordered is deleted entirely, freeing its slug."""
    name = await db.fetch_val(
        "SELECT title FROM products WHERE id = $1::uuid", product_id)
    async with db.transaction() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM products WHERE id=$1::uuid AND deleted_at IS NULL", product_id)
        if not exists:
            raise HTTPException(404, "Product not found")
        ordered = await conn.fetchval(
            "SELECT 1 FROM order_items WHERE product_id=$1::uuid LIMIT 1", product_id)
        if ordered:
            unsold = await conn.fetch(
                """SELECT id::text AS id FROM product_units
                    WHERE product_id=$1::uuid AND sold_order_item_id IS NULL""", product_id)
            removed = await _delete_units(conn, [r["id"] for r in unsold])
            await conn.execute(
                "UPDATE products SET status='archived', updated_at=now() WHERE id=$1::uuid",
                product_id)
            # Non-serialized stock lives on the variant — zero it so nothing is sellable.
            await conn.execute(
                "UPDATE product_variants SET stock_qty=0, is_active=false, updated_at=now() "
                "WHERE product_id=$1::uuid", product_id)
            mode = "archived"
        else:
            # Never ordered — remove it and all its inventory outright.
            all_units = await conn.fetch(
                "SELECT id::text AS id FROM product_units WHERE product_id=$1::uuid", product_id)
            removed = await _delete_units(conn, [r["id"] for r in all_units])
            await _purge_product(conn, product_id)
            mode = "deleted"
    await audit_log(actor, "product.delete", product_id,
                    {"name": name, "mode": mode, "units_removed": removed})
    return {"ok": True, "mode": mode, "units_removed": removed}


# --- Categories CRUD (perm: categories) ---------------------------------------
@api.get("/admin/categories")
async def admin_list_categories(_: str = Depends(require_perm("categories"))):
    return await _list_categories()


class DesignIn(BaseModel):
    product_id: str                 # designs belong to one gemstone
    code: str                       # R14, P01 …
    applies_to: str                 # "ring" | "pendant"
    metal: str                      # one row per metal; carries that metal's full price
    price: int = 0                  # paise, added to the gemstone's price
    price_usd: Optional[int] = None  # cents — region_pricing's USD fallback for this design
    image_url: Optional[str] = None
    note: Optional[str] = None      # e.g. "21k Advance only"
    is_active: bool = True
    sort_order: int = 0


def _validate_design(body: DesignIn) -> None:
    if body.applies_to not in ("ring", "pendant"):
        raise HTTPException(400, "applies_to must be 'ring' or 'pendant'")
    if body.metal not in _METALS:
        raise HTTPException(400, f"Unknown metal: {body.metal}")
    if body.price < 0:
        raise HTTPException(400, "Price can't be negative")
    if body.price_usd is not None and body.price_usd < 0:
        raise HTTPException(400, "USD price can't be negative")


@api.get("/admin/designs")
async def admin_list_designs(_: str = Depends(require_perm("products")),
                             product_id: Optional[str] = None):
    sql = """SELECT d.id::text AS design_id, d.product_id::text AS product_id,
                    p.title AS product_name, d.code, d.applies_to, d.metal,
                    d.price AS price_n, d.price_usd AS price_usd_n,
                    d.image_url, d.note, d.is_active, d.sort_order
               FROM jewellery_designs d JOIN products p ON p.id = d.product_id"""
    args = []
    if product_id:
        args.append(product_id)
        sql += " WHERE d.product_id = $1::uuid"
    rows = await db.fetch_all(sql + " ORDER BY p.title, d.applies_to, d.sort_order, d.code", *args)
    return [{**{k: v for k, v in r.items() if k not in ("price_n", "price_usd_n")},
             "price": db.to_paise(r["price_n"]), "price_usd": db.to_paise(r["price_usd_n"])}
            for r in rows]


@api.post("/admin/designs")
async def admin_create_design(body: DesignIn, actor: str = Depends(require_perm("products"))):
    _validate_design(body)
    did = uuid.uuid4()
    try:
        await db.execute(
            """INSERT INTO jewellery_designs (id, product_id, code, applies_to, metal,
                    price, price_usd, image_url, note, is_active, sort_order)
               VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
            did, body.product_id, body.code.strip(), body.applies_to, body.metal,
            db.to_amount(body.price), db.to_amount(body.price_usd), body.image_url, body.note,
            body.is_active, body.sort_order)
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(
            400, f"{body.code} already exists for this product as a {body.applies_to} in {body.metal}")
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(404, "Product not found")
    await audit_log(actor, "design.create", str(did), {"code": body.code, "metal": body.metal})
    return {"design_id": str(did)}


@api.patch("/admin/designs/{design_id}")
async def admin_update_design(design_id: str, body: DesignIn,
                              actor: str = Depends(require_perm("products"))):
    _validate_design(body)
    got = await db.fetch_val(
        """UPDATE jewellery_designs SET product_id=$2::uuid, code=$3, applies_to=$4,
               metal=$5, price=$6, price_usd=$7, image_url=$8, note=$9, is_active=$10,
               sort_order=$11, updated_at=now()
            WHERE id=$1::uuid RETURNING id::text""",
        design_id, body.product_id, body.code.strip(), body.applies_to, body.metal,
        db.to_amount(body.price), db.to_amount(body.price_usd), body.image_url, body.note,
        body.is_active, body.sort_order)
    if not got:
        raise HTTPException(404, "Design not found")
    await audit_log(actor, "design.update", design_id, {"code": body.code})
    return {"ok": True}


@api.delete("/admin/designs/{design_id}")
async def admin_delete_design(design_id: str, actor: str = Depends(require_perm("products"))):
    # Hard delete is safe: orders snapshot the chosen design code in selected_options,
    # so past orders keep reading correctly even once a design is retired.
    got = await db.fetch_val(
        "DELETE FROM jewellery_designs WHERE id=$1::uuid RETURNING code", design_id)
    if not got:
        raise HTTPException(404, "Design not found")
    await audit_log(actor, "design.delete", design_id, {"code": got})
    return {"ok": True}


@api.get("/admin/metals")
async def admin_metals(_: str = Depends(require_perm("products"))):
    return {"metals": _METALS}


@api.get("/admin/category-options/{category}")
async def admin_category_option_template(category: str, _: str = Depends(require_perm("products"))):
    """The default option groups for a category, all surcharges at 0. The product form
    calls this when the admin picks a category so the right selectors appear ready to
    be priced."""
    ck = db.CATEGORY_TO_DB.get(category)
    if not ck:
        raise HTTPException(400, f"Unknown category: {category}")
    return _category_option_template(ck)


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


@api.post("/admin/categories")
async def admin_create_category(body: CategoryIn, actor: str = Depends(require_perm("categories"))):
    slug = _slugify(body.label)
    if not slug:
        raise HTTPException(400, "Label is required")
    if await db.fetch_val("SELECT id FROM categories WHERE slug = $1::citext", slug):
        raise HTTPException(400, f"A category with slug '{slug}' already exists")

    if body.parent_id:
        # Subcategory: inherit the parent's type (category_key). No enum key needed.
        parent = await db.fetch_one(
            "SELECT id, category_key::text AS ck FROM categories WHERE id = $1::uuid",
            body.parent_id)
        if not parent:
            raise HTTPException(404, "Parent category not found")
        ck, parent_id = parent["ck"], parent["id"]
    else:
        # Top-level: `key` must be one of the fixed category_key enum values.
        ck = db.CATEGORY_TO_DB.get(body.key)
        if not ck:
            raise HTTPException(
                400, f"Unknown category key '{body.key}'. Allowed: {sorted(db.CATEGORY_TO_DB)}")
        if await db.fetch_val(
                "SELECT id FROM categories WHERE category_key = $1::category_key "
                "AND parent_id IS NULL", ck):
            raise HTTPException(400, "A top-level category with this key already exists")
        parent_id = None

    cid = uuid.uuid4()
    await db.execute(
        """INSERT INTO categories (id, category_key, name, name_devanagari, slug,
                parent_id, sort_order, banner, is_active)
           VALUES ($1,$2::category_key,$3,$4,$5::citext,$6::uuid,$7,$8,true)""",
        cid, ck, body.label, body.hindi, slug, parent_id, body.order,
        _normalize_category_banner(body.banner))
    await audit_log(actor, "category.create", str(cid),
                    {"label": body.label, "slug": slug, "parent_id": body.parent_id})
    respcache.invalidate("categories")
    return next((c for c in await _list_categories() if c["category_id"] == str(cid)), None)


@api.patch("/admin/categories/{category_id}")
async def admin_update_category(category_id: str, body: CategoryUpdateIn, actor: str = Depends(require_perm("categories"))):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    sets, args = [], []
    for k, col in (("label", "name"), ("hindi", "name_devanagari"), ("order", "sort_order")):
        if k in updates:
            args.append(updates[k])
            sets.append(f"{col} = ${len(args)}")
    if "banner" in updates:
        args.append(_normalize_category_banner(updates["banner"]))
        sets.append(f"banner = ${len(args)}::jsonb")
    if "parent_id" in updates:
        # Re-parenting also re-inherits the parent's type, so a moved subcategory keeps
        # behaving like its (new) parent.
        args.append(updates["parent_id"])
        sets.append(f"parent_id = ${len(args)}::uuid")
        sets.append(f"category_key = (SELECT category_key FROM categories "
                    f"WHERE id = ${len(args)}::uuid)")
    args.append(category_id)
    got = await db.fetch_val(
        f"UPDATE categories SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(args)}::uuid RETURNING id::text", *args)
    if not got:
        raise HTTPException(404, "Category not found")
    await audit_log(actor, "category.update", category_id, updates)
    respcache.invalidate("categories")
    return next((c for c in await _list_categories() if c["category_id"] == category_id), None)


@api.delete("/admin/categories/{category_id}")
async def admin_delete_category(category_id: str, actor: str = Depends(require_perm("categories"))):
    # Deactivate rather than delete: products.category_id references categories.
    name = await db.fetch_val(
        "SELECT name FROM categories WHERE id = $1::uuid", category_id)
    await db.execute(
        "UPDATE categories SET is_active=false, updated_at=now() WHERE id=$1::uuid",
        category_id)
    await audit_log(actor, "category.deactivate", category_id, {"name": name})
    respcache.invalidate("categories")
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
    astro_phone = normalize_phone(payload["phone"]) if payload.get("phone") else None
    await db.execute(
        """INSERT INTO astrologers (id, full_name, devanagari, expertise, price, price_usd,
                years, avatar_url, email, phone, commission_pct, bio, is_active, affiliate_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::citext,$10,$11,$12,true,$13::citext)""",
        astro_id, payload["name"], payload.get("devanagari") or "",
        payload.get("expertise") or [], db.to_amount(payload["price"]), db.to_amount(payload.get("price_usd")),
        payload.get("years") or 0, payload.get("picture") or None,
        payload.get("email"), astro_phone,
        # `or 10.0` would turn a deliberate 0% commission into 10% — 0 is falsy.
        10.0 if payload.get("commission_pct") is None else payload["commission_pct"],
        payload.get("bio") or "", affiliate_code)
    welcome_url = None
    if payload.get("email"):
        token = _mint_astro_password_token(str(astro_id), purpose="set")
        welcome_url = _welcome_url(token)
        # WhatsApp the set-password link straight to the astrologer, if we have a number.
        if astro_phone:
            _wa_fire_event("astrologer.created", phone=astro_phone, name=payload["name"],
                     variables={"welcome_url": welcome_url})
    doc = _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", str(astro_id)))
    await audit_log(actor, "astrologer.create", target=str(astro_id), meta={"email": payload.get("email")})
    respcache.invalidate("astrologers")
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
    "price_usd": ("price_usd", db.to_amount),
    "years": ("years", lambda v: v),
    "picture": ("avatar_url", lambda v: v),
    "email": ("email", lambda v: v),
    "phone": ("phone", lambda v: normalize_phone(v) if v else None),
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
    respcache.invalidate("astrologers")
    return _shape_astro(await db.fetch_one(_ASTRO_SELECT + " WHERE a.id = $1::uuid", astrologer_id))


@api.delete("/admin/astrologers/{astrologer_id}")
async def admin_delete_astrologer(astrologer_id: str, actor: str = Depends(require_perm("astrologers"))):
    await db.execute(
        "UPDATE astrologers SET is_active=false, updated_at=now() WHERE id=$1::uuid",
        astrologer_id)
    await audit_log(actor, "astrologer.deactivate", target=astrologer_id)
    respcache.invalidate("astrologers")
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


class CommissionStatusIn(BaseModel):
    status: str  # "pending" | "paid"


@api.patch("/admin/affiliate-commissions/{commission_id}")
async def admin_update_commission_status(commission_id: str, body: CommissionStatusIn,
                                          actor: str = Depends(require_perm("astrologers"))):
    """Toggle a commission between pending/paid. Every change is written to the
    audit trail (admin_events) — who flipped it, and from what to what."""
    if body.status not in ("pending", "paid"):
        raise HTTPException(400, "status must be 'pending' or 'paid'")
    row = await db.fetch_one(
        "SELECT id::text, status::text AS status, astrologer_id::text FROM affiliate_commissions WHERE id = $1::uuid",
        commission_id)
    if not row:
        raise HTTPException(404, "Commission not found")
    await db.execute(
        """UPDATE affiliate_commissions SET status = $2::commission_status,
                paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE NULL END
           WHERE id = $1::uuid""",
        commission_id, body.status)
    await audit_log(actor, "affiliate_commission.status_change", target=commission_id,
                     meta={"astrologer_id": row["astrologer_id"], "from": row["status"], "to": body.status})
    return {"ok": True, "commission_id": commission_id, "status": body.status}


# --- Astrologer-side (self-serve) auth & workspace ---------------------------
@api.post("/astrologer/auth/login")
async def astro_login(body: AstroLoginIn, _rl: None = Depends(rate_limit(10, 60))):
    a = _shape_astro(await db.fetch_one(
        _ASTRO_SELECT + " WHERE a.email = $1::citext", body.email), include_hash=True)
    if not a or a.get("is_active") is False or not a.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")
    if not verify_password(body.password, a["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    if needs_rehash(a["password_hash"]):
        await db.execute("UPDATE astrologers SET password_hash = $2 WHERE id = $1::uuid",
                          a["astrologer_id"], hash_password(body.password))
    token = _make_astro_jwt(a["astrologer_id"])
    return {"token": token, "astrologer": _astro_public(a)}


@api.post("/astrologer/auth/set-password")
async def astro_set_password(body: AstroSetPasswordIn, _rl: None = Depends(rate_limit(10, 60))):
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
async def astro_request_reset(body: AstroRequestResetIn, _rl: None = Depends(rate_limit(5, 60))):
    """Astrologer-triggered reset. Always returns the same response to avoid email
    enumeration, and NEVER returns the reset token/link to the caller — the link is
    delivered out-of-band (email/log) so it can't be used to seize another
    astrologer's account by simply POSTing their email."""
    aid = await db.fetch_val(
        "SELECT id::text FROM astrologers WHERE email = $1::citext AND is_active",
        body.email)
    if aid:
        token = _mint_astro_password_token(aid, purpose="reset")
        reset_url = _welcome_url(token)
        # Server-side only. In dev this is visible in the logs; in production this is
        # where the email adapter should send the link. It must never go to the client.
        log.info(f"astro password reset link for {body.email}: {reset_url}")
    return {"ok": True, "message": "If that email is registered, a reset link has been sent."}


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
    if updates.get("status") == "completed":
        await _activate_consultation_credit(booking_id)
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
        response.set_cookie("gemora_anon", anon, max_age=60 * 60 * 24 * 365, httponly=False, **_cookie_kwargs())
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
async def admin_update_consultation(booking_id: str, body: dict, request: Request,
                                    actor: str = Depends(require_perm("consultations"))):
    updates = {k: v for k, v in body.items()
              if k in {"status", "meeting_link", "notes", "astrologer_id", "confirmed_time"}}
    if not updates:
        raise HTTPException(400, "Nothing to update")

    before = await _load_consultation(booking_id)
    if not before:
        raise HTTPException(404, "Booking not found")

    # First-time assignment (no astrologer yet): staff supply the meet link by hand
    # (set up manually elsewhere) — the WhatsApp notify to both parties fires after
    # the row is saved, below.
    astro = None
    assigning = bool(updates.get("astrologer_id")) and not before.get("astrologer_id")
    if assigning:
        astro = _shape_astro(await db.fetch_one(
            _ASTRO_SELECT + " WHERE a.id = $1::uuid", updates["astrologer_id"]))
        if not astro:
            raise HTTPException(404, "Astrologer not found")
        astro["phone"] = await db.fetch_val(
            "SELECT phone FROM astrologers WHERE id = $1::uuid", updates["astrologer_id"])
        updates["astrologer_name_snapshot"] = astro["name"]
        updates.setdefault("status", "confirmed")

        # Pay-first bookings (preferred_date set) only captured a date + a rough
        # morning/afternoon/evening preference — assigning an astrologer requires
        # staff to pin the exact 30-min slot so both parties get a real time on
        # WhatsApp/dashboards. Older bookings already carry an exact slot_at picked
        # by the buyer, so this step doesn't apply to them.
        if before.get("preferred_date"):
            confirmed_time = updates.get("confirmed_time")
            if not confirmed_time:
                raise HTTPException(400, "Enter the confirmed time (HH:MM) before assigning an astrologer")
            try:
                hh, mm = (int(x) for x in confirmed_time.split(":"))
                slot_local = datetime.combine(date.fromisoformat(before["preferred_date"]),
                                              dtime(hour=hh, minute=mm), tzinfo=IST)
            except (ValueError, TypeError):
                raise HTTPException(400, "confirmed_time must be HH:MM")
            updates["slot_at"] = slot_local.astimezone(timezone.utc)

        if not updates.get("meeting_link"):
            raise HTTPException(400, "Enter the meeting link before assigning an astrologer")

    sets, args = [], []
    for k in ("status", "meeting_link", "notes", "astrologer_id", "astrologer_name_snapshot",
             "slot_at"):
        if k in updates:
            args.append(updates[k])
            cast = "::consultation_status" if k == "status" else "::uuid" if k == "astrologer_id" else ""
            sets.append(f"{k} = ${len(args)}{cast}")
    sets.append("updated_at = now()")
    args.append(booking_id)
    got = await db.fetch_val(
        f"UPDATE consultations SET {', '.join(sets)} WHERE id = ${len(args)}::uuid "
        f"RETURNING id::text", *args)
    if not got:
        raise HTTPException(404, "Booking not found")
    await audit_log(actor, "consultation.update", booking_id,
                    {k: v for k, v in updates.items()
                     if k in ("status", "meeting_link", "notes", "astrologer_id", "confirmed_time")})
    if updates.get("status") == "completed":
        await _activate_consultation_credit(booking_id)

    consult = await _load_consultation(booking_id)
    if assigning:
        when = datetime.fromisoformat(consult["slot_iso"]).astimezone(IST).strftime("%a, %d %b · %I:%M %p IST")
        if consult.get("phone"):
            _wa_fire_event("consultation.assigned", phone=consult["phone"], name=consult["name"],
                          user_id=consult.get("user_id"),
                          variables={"astrologer_name": astro["name"], "date": when,
                                     "duration": f"{CONSULTATION_DURATION_MINUTES} minutes",
                                     "meeting_link": consult["meeting_link"]})
        if astro.get("phone"):
            _wa_fire_event("consultation.astrologer_assigned", phone=astro["phone"], name=astro["name"],
                          variables={"customer_name": consult["name"], "concern": consult.get("concern") or "",
                                     "date": when, "duration": f"{CONSULTATION_DURATION_MINUTES} minutes",
                                     "meeting_link": consult["meeting_link"]})
    return consult


# --- Order status (perm: orders) ---------------------------------------------
@api.patch("/admin/orders/{order_id}/status")
async def admin_update_order_status(order_id: str, body: OrderStatusIn, actor: str = Depends(require_perm("orders"))):
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
    await audit_log(actor, "order.status_change", order_id,
                    {"from": prev["status"], "to": body.status})

    # WhatsApp update on the transitions the buyer cares about. Shipped is handled by
    # the dispatch flow (which carries tracking), so it is not duplicated here.
    _WA_STATUS_EVENT = {"delivered": "order.delivered", "cancelled": "order.cancelled"}
    event = _WA_STATUS_EVENT.get(body.status)
    if event and body.status != prev["status"]:
        buyer = await _load_user(user_id=prev["user_id"]) if prev.get("user_id") else None
        to_phone = (buyer or {}).get("phone") or prev.get("shipping_phone")
        if to_phone:
            _wa_fire_event(event, phone=to_phone,
                           name=(buyer or {}).get("name") or prev.get("shipping_name") or "friend",
                           user_id=prev.get("user_id"),
                           variables={"order_id": order_id})
    return await _load_order(order_id)


# --- User queries / support inbox (perm: queries) ----------------------------
_QUERY_CATEGORIES = {
    "order": "Order issue", "payment": "Payment issue", "refund": "Refund request",
    "return": "Return request", "product": "Product issue", "other": "Other",
}

_QUERY_SELECT = """
    SELECT q.id::text      AS query_id,
           q.name          AS name,
           q.email::text   AS email,
           q.phone         AS phone,
           q.subject       AS subject,
           q.message       AS message,
           q.category      AS category,
           q.order_id::text AS order_id,
           o.order_no      AS order_no,
           q.user_id::text AS user_id,
           q.status::text  AS status,
           q.created_at    AS created_at,
           COALESCE(n.notes, '[]'::jsonb) AS notes
      FROM queries q
      LEFT JOIN orders o ON o.id = q.order_id
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
    category = body.category if body.category in _QUERY_CATEGORIES else None
    # An order can only be attached if it belongs to the signed-in user — no peeking at
    # someone else's order via its id.
    order_id, order_no = None, None
    if body.order_id and user_id:
        row = await db.fetch_one(
            "SELECT order_no FROM orders WHERE id=$1::uuid AND user_id=$2::uuid",
            body.order_id, user_id)
        if row:
            order_id, order_no = body.order_id, row["order_no"]
    # Give the support inbox a meaningful subject even if the buyer only picked a type.
    subject = (body.subject or "").strip()
    if not subject:
        subject = _QUERY_CATEGORIES.get(category, "Support request")
        if order_no:
            subject += f" · {order_no}"
    qid = uuid.uuid4()
    await db.execute(
        """INSERT INTO queries (id, name, email, phone, subject, message, category,
                order_id, user_id, status)
           VALUES ($1,$2,$3::citext,$4,$5,$6,$7,$8::uuid,$9::uuid,'open')""",
        qid, body.name, body.email, body.phone, subject, body.message, category,
        order_id, user_id)
    return await db.fetch_one(_QUERY_SELECT + " WHERE q.id = $1::uuid", str(qid))


@api.get("/me/queries")
async def my_queries(user_id: str = Depends(require_user)):
    """A buyer's own support queries, newest first — so they can track status."""
    return await db.fetch_all(
        _QUERY_SELECT + " WHERE q.user_id = $1::uuid ORDER BY q.created_at DESC LIMIT 100",
        user_id)


@api.post("/me/queries/{query_id}/notes")
async def add_my_query_note(query_id: str, body: QueryReplyIn, user_id: str = Depends(require_user)):
    """Let a buyer add a follow-up note to their OWN query and see the full thread.

    Author is the buyer's own user_id, so the UI can tell their replies from staff
    ones (staff notes carry a different author_id). A reply on a resolved query
    bumps it back to in_progress so the support inbox surfaces it again. A closed
    query is terminal — staff closed it, so the buyer must raise a fresh query.
    """
    owned = await db.fetch_one(
        "SELECT id, status FROM queries WHERE id = $1::uuid AND user_id = $2::uuid", query_id, user_id)
    if not owned:
        raise HTTPException(404, "Query not found")
    if owned["status"] == "closed":
        raise HTTPException(409, "This query is closed. Please raise a new query.")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(400, "Note is empty")
    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO query_notes (id, query_id, author_id, body)
               VALUES ($1,$2::uuid,$3::uuid,$4)""",
            uuid.uuid4(), query_id, user_id, note)
        await conn.execute(
            """UPDATE queries
                  SET updated_at = now(),
                      status = CASE WHEN status = 'resolved'
                                    THEN 'in_progress'::query_status ELSE status END
                WHERE id = $1::uuid""", query_id)
    return await db.fetch_one(_QUERY_SELECT + " WHERE q.id = $1::uuid", query_id)


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
    await audit_log(actor, "query.update", query_id,
                    {"status": body.status, "note_added": bool(body.note)})
    return await db.fetch_one(_QUERY_SELECT + " WHERE q.id = $1::uuid", query_id)


# ── Admin: promotional broadcast (WhatsApp, via OpenWA) ───────────────────────
@api.post("/admin/promo/broadcast")
async def admin_promo_broadcast(body: PromoBroadcastIn, user_id: str = Depends(require_admin)):
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
            await wa_send_utility(u["phone"], body.message)
            sent += 1
        except Exception as e:
            failed += 1
            log.warning(f"promo send failed for {u.get('user_id')}: {e}")
    # wa_broadcasts.template is NOT NULL; body_params has no more meaning under
    # OpenWA's plain-text sends, so it's recorded empty.
    await db.execute(
        """INSERT INTO wa_broadcasts (id, template, body_params, sent_count, failed_count,
                                      created_by)
           VALUES ($1,$2,$3,$4,$5,$6::uuid)""",
        uuid.uuid4(), body.message, [], sent, failed, user_id)
    await audit_log(user_id, "whatsapp.broadcast", body.message,
                    {"sent": sent, "failed": failed, "eligible_users": len(users)})
    return {"ok": True, "sent": sent, "failed": failed, "eligible_users": len(users),
            "provider": "openwa" if wa_openwa.configured() else "mock"}


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
    except CircuitOpenError:
        raise HTTPException(503, "Storage is temporarily unavailable. Please try again shortly.")
    except Exception as e:
        log.error(f"Storage put failed for {path}: {e}")
        raise HTTPException(502, "Storage upload failed. Please try again.")


async def _storage_get(path: str) -> tuple[bytes, str]:
    if not storage_sb.configured():
        raise HTTPException(503, "Supabase storage not configured")
    try:
        return await storage_sb.get(path)
    except FileNotFoundError:
        raise HTTPException(404, "File not found in storage")
    except CircuitOpenError:
        raise HTTPException(503, "Storage is temporarily unavailable. Please try again shortly.")
    except Exception as e:
        log.error(f"Storage get failed for {path}: {e}")
        raise HTTPException(502, "Storage read failed. Please try again.")


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
    await audit_log(user_id, "media.upload", str(media_id),
                    {"filename": filename, "content_type": ct,
                     "size": result.get("size") or len(data)})
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
async def admin_media_delete(media_id: str, actor: str = Depends(require_admin)):
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
    await audit_log(actor, "media.delete", media_id)
    return {"ok": True}


@api.get("/media/file/{path:path}")
async def media_serve(path: str):
    """Image tags fetch here. Redirects the browser straight to Supabase's storage
    CDN with a signed URL, so the (potentially large) bytes never pass through this
    backend — which is what made every image slow. We only issue a tiny redirect.

    Object keys are content-unique (uuid), so a URL's bytes never change; the
    redirect itself is cacheable for a day, and the signed target is valid a week.
    Falls back to proxying the bytes if signing is unavailable."""
    try:
        signed = await storage_sb.sign(path, 604800)  # 7 days
        return RedirectResponse(signed, status_code=307, headers={
            "Cache-Control": "public, max-age=86400",  # cache the redirect for a day
        })
    except Exception as e:  # noqa: BLE001 — any signing failure falls back to proxying
        log.warning("media sign failed, proxying %s: %s", path, e)
        data, ct = await _storage_get(path)
        return FastAPIResponse(content=data, media_type=ct, headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        })


# ── Site assets (slot → media) ───────────────────────────────────────────────
async def _site_assets_body() -> dict:
    rows = await db.fetch_all(
        """SELECT slot::text AS slot, url FROM site_assets
            WHERE media_id IS NOT NULL AND url IS NOT NULL LIMIT 500""")
    return {r["slot"]: r["url"] for r in rows}


@api.get("/site-assets")
async def site_assets_public():
    """Public — returns {slot_key: url} map of currently assigned images."""
    return await respcache.get_or_set("site_assets", ttl=300, tag="site_assets",
                                      compute=_site_assets_body)


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
    await audit_log(user_id, "site_asset.set" if media_id else "site_asset.clear",
                    slot, {"media_id": media_id})
    respcache.invalidate("site_assets")
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


async def _events_active_body() -> list:
    # The active window is evaluated in SQL rather than filtered in Python.
    return await db.fetch_all(
        _EVENT_SELECT + """ WHERE e.is_active
                              AND (e.starts_at IS NULL OR e.starts_at <= now())
                              AND (e.ends_at   IS NULL OR e.ends_at   >= now())
                            ORDER BY e.priority DESC LIMIT 50""")


@api.get("/events/active")
async def events_active():
    # Short TTL (not just a tag): an event's active window can start or end with no
    # admin write at all, so this has to re-check on a schedule regardless.
    return await respcache.get_or_set("events_active", ttl=60, tag="events",
                                      compute=_events_active_body)


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
    await audit_log(user_id, "event.create", str(eid),
                    {"title": body.title, "active": body.active})
    respcache.invalidate("events")
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
    await audit_log(user_id, "event.update", event_id,
                    {"title": body.title, "active": body.active})
    respcache.invalidate("events")
    return await db.fetch_one(_EVENT_SELECT + " WHERE e.id = $1::uuid", event_id)


@api.delete("/admin/events/{event_id}")
async def admin_events_delete(event_id: str, actor: str = Depends(require_admin)):
    title = await db.fetch_val("SELECT title FROM events WHERE id = $1::uuid", event_id)
    got = await db.fetch_val(
        "DELETE FROM events WHERE id = $1::uuid RETURNING id::text", event_id)
    if not got:
        raise HTTPException(404, "Event not found")
    await audit_log(actor, "event.delete", event_id, {"title": title})
    respcache.invalidate("events")
    return {"ok": True}


# ── OpenWA gateway: two-way WhatsApp ─────────────────────────────────────────
# MIRRORING POLICY (deliberate, privacy-driven)
# The connected number is a real WhatsApp account whose chat list also contains the
# operator's personal and family conversations. Storing "every message" verbatim would
# copy those into Supabase, where any staff member holding the `whatsapp` permission
# could read them. So a chat is mirrored ONLY when:
#     * it is not a group, AND
#     * its number matches a Tredev user (users.phone)
# Everything else is delivered, acted on, and dropped — never written to the DB.
# _wa_should_mirror() is the single place to change this rule.

async def _wa_should_mirror(chat_id: str) -> Optional[str]:
    """Return the Tredev user_id this chat belongs to, or None if it must not be stored."""
    if wa_openwa.is_group(chat_id):
        return None
    phone = wa_openwa.phone_from_chat_id(chat_id)
    if not phone:
        return None
    return await db.fetch_val(
        "SELECT id::text FROM users WHERE phone = $1 AND deleted_at IS NULL", phone)


async def _wa_upsert_chat(session_id: str, chat_id: str, user_id: str,
                          display_name: Optional[str] = None,
                          preview: Optional[str] = None,
                          ts: Optional[datetime] = None) -> str:
    """Create or refresh the conversation row, returning its uuid.

    Deliberately does NOT touch unread_count. OpenWA retries webhook deliveries, and
    this upsert runs on every retry — bumping the badge here double-counts a message
    that the (idempotent) insert then discards. The caller increments unread only
    when a row was actually inserted.
    """
    return await db.fetch_val(
        """INSERT INTO wa_chats (session_id, chat_id, phone, display_name, is_group,
                                 user_id, last_message_at, last_message_preview)
           VALUES ($1,$2,$3,$4,false,$5::uuid,$6,$7)
           ON CONFLICT (session_id, chat_id) DO UPDATE
              SET display_name         = COALESCE(EXCLUDED.display_name, wa_chats.display_name),
                  last_message_at      = GREATEST(COALESCE(EXCLUDED.last_message_at, wa_chats.last_message_at),
                                                  COALESCE(wa_chats.last_message_at, EXCLUDED.last_message_at)),
                  last_message_preview = COALESCE(EXCLUDED.last_message_preview, wa_chats.last_message_preview),
                  user_id              = COALESCE(wa_chats.user_id, EXCLUDED.user_id),
                  updated_at           = now()
        RETURNING id::text""",
        session_id, chat_id, wa_openwa.phone_from_chat_id(chat_id), display_name,
        user_id, ts or now(), (preview or "")[:200])


async def _wa_store_message(*, session_id: str, chat_row_id: str, wa_message_id: str,
                            direction: str, body_text: str = "", msg_type: str = "text",
                            from_phone: Optional[str] = None, to_phone: Optional[str] = None,
                            status: str = "delivered", source: str = "support",
                            sent_by_user_id: Optional[str] = None,
                            campaign_id: Optional[str] = None,
                            media_url: Optional[str] = None,
                            raw: Optional[dict] = None,
                            error: Optional[str] = None,
                            ts: Optional[datetime] = None) -> Optional[str]:
    """Insert one message. ON CONFLICT DO NOTHING on (session_id, wa_message_id) makes
    this idempotent — OpenWA retries webhook deliveries, so the same message can arrive
    several times and must not duplicate."""
    return await db.fetch_val(
        """INSERT INTO wa_messages (chat_id, session_id, wa_message_id, direction,
                                    from_phone, to_phone, msg_type, body, media_url,
                                    status, sent_by_user_id, source, campaign_id, raw,
                                    error, wa_timestamp)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13::uuid,$14,$15,$16)
           ON CONFLICT (session_id, wa_message_id) DO NOTHING
        RETURNING id::text""",
        chat_row_id, session_id, wa_message_id, direction, from_phone, to_phone,
        msg_type, body_text, media_url, status, sent_by_user_id, source, campaign_id,
        raw or {}, error, ts or now())


def _wa_event_ts(payload: dict) -> datetime:
    """WhatsApp timestamps arrive as unix seconds (sometimes ms). Fall back to now()."""
    t = payload.get("timestamp") or payload.get("t")
    try:
        t = float(t)
        if t > 1e11:      # milliseconds
            t = t / 1000.0
        return datetime.fromtimestamp(t, tz=timezone.utc)
    except (TypeError, ValueError):
        return now()


@api.post("/wa/openwa/webhook")
async def openwa_webhook(request: Request):
    """Inbound events from the OpenWA gateway.

    Verified with HMAC-SHA256 over the raw body (X-OpenWA-Signature: sha256=<hex>) —
    the same scheme as the Meta webhook above. Always returns 200 on a verified
    payload: a non-2xx makes OpenWA retry, and a message we deliberately did not
    mirror is not a delivery failure.
    """
    raw = await request.body()
    if not wa_openwa.verify_signature(raw, request.headers.get("x-openwa-signature")):
        log.warning("OpenWA webhook rejected: bad signature")
        raise HTTPException(401, "Invalid signature")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "Malformed payload")

    event = body.get("event") or request.headers.get("x-openwa-event") or ""
    payload = body.get("payload") or {}
    session_id = body.get("sessionId") or wa_openwa.SESSION_ID

    if event not in ("message.received", "message.sent"):
        # ack/failed/session events are useful for status but carry no new content.
        return {"ok": True, "ignored": event}

    chat_id = payload.get("chatId") or payload.get("from") or payload.get("to") or ""
    if not chat_id:
        return {"ok": True, "ignored": "no chatId"}

    user_id = await _wa_should_mirror(chat_id)
    if not user_id:
        # Not a customer conversation (or a group) — deliberately not stored.
        return {"ok": True, "stored": False}

    inbound = event == "message.received"
    phone = wa_openwa.phone_from_chat_id(chat_id)
    text = payload.get("body") or payload.get("text") or ""
    chat_row_id = await _wa_upsert_chat(
        session_id, chat_id, user_id,
        display_name=payload.get("pushName") or payload.get("notifyName"),
        preview=text, ts=_wa_event_ts(payload))

    inserted = await _wa_store_message(
        session_id=session_id, chat_row_id=chat_row_id,
        wa_message_id=payload.get("id") or payload.get("messageId") or uid("wa_"),
        direction="in" if inbound else "out",
        body_text=text, msg_type=payload.get("type") or "text",
        from_phone=phone if inbound else None,
        to_phone=None if inbound else phone,
        status="delivered" if inbound else "sent",
        source="support", media_url=payload.get("mediaUrl"),
        raw=payload, ts=_wa_event_ts(payload))

    # Only a genuinely new inbound message raises the badge. `inserted` is None when
    # ON CONFLICT DO NOTHING swallowed a retry, which is exactly when we must not count.
    if inserted and inbound:
        await db.execute(
            "UPDATE wa_chats SET unread_count = unread_count + 1, updated_at = now() "
            "WHERE id = $1::uuid", chat_row_id)
    return {"ok": True, "stored": bool(inserted)}


# ── WhatsApp notifications: templates + event triggers ───────────────────────
# Automated WhatsApp updates (order placed/shipped/delivered, consultation booked,
# astrologer onboarding, offers). Each is a row in wa_templates with a {{variable}}
# body; a template's `enabled` flag is the automation on/off switch. Sends are
# best-effort and fire AFTER the originating transaction commits, so a WhatsApp
# outage can never fail a checkout or a booking.

# Money shown to customers: paise -> "₹1,234".
def _rupees(paise: Optional[int]) -> str:
    try:
        return f"₹{(int(paise) / 100):,.0f}"
    except (TypeError, ValueError):
        return "₹0"


async def _wa_mirror_outbound(phone: str, user_id: Optional[str], text: str,
                              source: str, message_id: Optional[str],
                              sent_by: Optional[str] = None,
                              campaign_id: Optional[str] = None,
                              status: str = "sent", error: Optional[str] = None) -> None:
    """Persist a message we sent, so every outbound update is in the DB and the log.
    Unlike inbound (which is privacy-gated), everything we initiate is stored."""
    chat_id = wa_openwa.to_chat_id(phone)
    chat_row_id = await _wa_upsert_chat(
        wa_openwa.SESSION_ID, chat_id, user_id, preview=text, ts=now())
    await _wa_store_message(
        session_id=wa_openwa.SESSION_ID, chat_row_id=chat_row_id,
        wa_message_id=message_id or uid("wa_"), direction="out", body_text=text,
        to_phone=wa_openwa.phone_from_chat_id(chat_id), status=status, source=source,
        sent_by_user_id=sent_by, campaign_id=campaign_id, error=error)


async def _wa_optin_ok(user_id: Optional[str]) -> bool:
    if not user_id:
        return True  # no user row to consult; default is opted-in
    v = await db.fetch_val(
        """SELECT COALESCE((whatsapp ->> 'optin')::boolean, true)
             FROM notification_preferences WHERE user_id = $1::uuid""", user_id)
    return True if v is None else bool(v)


async def _wa_notify(template_key: str, *, phone: Optional[str], name: str = "",
                     user_id: Optional[str] = None, variables: Optional[dict] = None,
                     source: str = "notification") -> dict:
    """Render `template_key` and send it. Returns a small result dict; never raises —
    callers fire this and move on. Marketing templates additionally require WhatsApp
    opt-in; transactional/consultation/astrologer messages are expected by the
    recipient (they placed an order / booked / were onboarded) and only need a phone."""
    if not wa_openwa.configured():
        return {"sent": False, "reason": "gateway_not_configured"}
    if not phone:
        return {"sent": False, "reason": "no_phone"}
    tpl = await db.fetch_one(
        """SELECT key, category, body, enabled, include_calendar
             FROM wa_templates WHERE key = $1""", template_key)
    if not tpl:
        return {"sent": False, "reason": "no_template"}
    if not tpl["enabled"]:
        return {"sent": False, "reason": "disabled"}   # automation switched off
    if tpl["category"] == "marketing" and not await _wa_optin_ok(user_id):
        return {"sent": False, "reason": "opted_out"}

    try:
        norm = normalize_phone(phone)
    except HTTPException:
        return {"sent": False, "reason": "bad_phone"}
    v = dict(variables or {})
    v.setdefault("name", name or "friend")
    body = wa_openwa.render_template(tpl["body"], v)
    if not body:
        return {"sent": False, "reason": "empty_body"}

    try:
        res = await wa_openwa.send_text(wa_openwa.to_chat_id(norm), body)
    except wa_openwa.OpenWAError as e:
        log.warning(f"WA notify '{template_key}' send failed: {e}")
        try:
            await _wa_mirror_outbound(norm, user_id, body, source, None,
                                      status="failed", error=str(e)[:200])
        except Exception:
            pass
        return {"sent": False, "reason": "send_failed"}
    try:
        await _wa_mirror_outbound(norm, user_id, body, source, res.get("messageId"))
    except Exception as e:
        log.warning(f"WA notify '{template_key}' mirror failed: {e}")
    return {"sent": True, "message_id": res.get("messageId")}


def _wa_fire_event(event: str, **kwargs) -> None:
    """Fire-and-forget EVERY enabled template bound to `event` (fire-and-forget, so
    the triggering request isn't blocked on WhatsApp latency; exceptions are logged,
    never propagated). Unlike firing a single fixed key, this means a template a
    staff member creates and binds to an existing event (via
    POST /admin/whatsapp/templates) starts firing immediately — no code change or
    deploy needed here. Multiple templates can be bound to the same event; all
    enabled ones send."""
    async def _run():
        try:
            rows = await db.fetch_all(
                "SELECT key FROM wa_templates WHERE trigger_event = $1 AND enabled", event)
        except Exception as e:
            log.warning(f"WA fire-event '{event}' lookup crashed: {e}")
            return
        for row in rows:
            try:
                await _wa_notify(row["key"], **kwargs)
            except Exception as e:
                log.warning(f"WA notify '{row['key']}' (event {event}) crashed: {e}")
    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        pass  # no loop (shouldn't happen inside a request) — skip rather than crash


# The real event hooks wired into the app. A template's `trigger_event` must be one
# of these keys, or "manual" (never fires automatically — usable only via Campaigns
# or the Templates "Test" button). This is both the validation set for creating a
# template AND the catalogue the admin "Automations" screen renders, so the two can
# never drift apart.
WA_TRIGGER_EVENTS = {
    "order.placed": {"label": "Order paid",
                     "when": "A customer completes payment", "to": "The buyer"},
    "order.shipped": {"label": "Order dispatched",
                      "when": "Admin dispatches the order (tracking added)", "to": "The buyer"},
    "order.delivered": {"label": "Order delivered",
                        "when": "Order status set to Delivered", "to": "The buyer"},
    "order.cancelled": {"label": "Order cancelled",
                        "when": "Order status set to Cancelled", "to": "The buyer"},
    "consultation.booked": {"label": "Consultation booked",
                            "when": "A customer completes payment for a consultation",
                            "to": "The customer (payment confirmation)"},
    "consultation.assigned": {"label": "Consultation assigned",
                              "when": "Admin assigns an astrologer to a paid consultation",
                              "to": "The customer (with astrologer name + meet link)"},
    "consultation.astrologer_assigned": {"label": "New consultation for astrologer",
                                         "when": "Admin assigns an astrologer to a paid consultation",
                                         "to": "The astrologer (with customer + meet link)"},
    "astrologer.created": {"label": "Astrologer onboarded",
                           "when": "Admin creates an astrologer with a phone number",
                           "to": "The astrologer"},
}
WA_TEMPLATE_CATEGORIES = {"transactional", "consultation", "astrologer", "marketing"}


def _wa_validate_trigger_event(v: str) -> None:
    if v != "manual" and v not in WA_TRIGGER_EVENTS:
        raise HTTPException(
            400, f"Unknown trigger_event. Allowed: manual, {sorted(WA_TRIGGER_EVENTS)}")


class WaTemplateCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = "transactional"
    trigger_event: str = "manual"
    body: str = Field(min_length=1, max_length=4096)
    include_calendar: bool = False


class WaTemplateUpdateIn(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    trigger_event: Optional[str] = None
    body: Optional[str] = Field(default=None, max_length=4096)
    enabled: Optional[bool] = None
    include_calendar: Optional[bool] = None


class WaTemplateTestIn(BaseModel):
    phone: str


@api.get("/admin/whatsapp/meta")
async def wa_meta(_: str = Depends(require_perm("whatsapp"))):
    """Feeds the "new automation / template" form: which events exist to bind to,
    and which categories are valid."""
    return {
        "trigger_events": [{"key": k, **v} for k, v in WA_TRIGGER_EVENTS.items()],
        "categories": sorted(WA_TEMPLATE_CATEGORIES),
    }


@api.get("/admin/whatsapp/templates")
async def wa_templates_list(_: str = Depends(require_perm("whatsapp"))):
    return await db.fetch_all(
        """SELECT key, name, category, trigger_event, body, variables, enabled,
                  include_calendar, updated_at
             FROM wa_templates ORDER BY
             CASE category WHEN 'transactional' THEN 0 WHEN 'consultation' THEN 1
                           WHEN 'astrologer' THEN 2 ELSE 3 END, name""")


@api.post("/admin/whatsapp/templates")
async def wa_template_create(body: WaTemplateCreateIn,
                             actor: str = Depends(require_perm("whatsapp"))):
    """Create a new template. Bind it to a real trigger_event to make it a live
    automation (it fires alongside any other enabled template on that event); leave
    it as "manual" for a reusable message that's only sent via Campaigns or a
    deliberate Test send."""
    _wa_validate_trigger_event(body.trigger_event)
    if body.category not in WA_TEMPLATE_CATEGORIES:
        raise HTTPException(400, f"Unknown category. Allowed: {sorted(WA_TEMPLATE_CATEGORIES)}")
    variables = wa_openwa.extract_variables(body.body)
    base_key = re.sub(r"[^a-z0-9]+", "_", body.name.strip().lower()).strip("_") or "template"
    key = base_key
    if await db.fetch_val("SELECT 1 FROM wa_templates WHERE key = $1", key):
        key = f"{base_key}_{uuid.uuid4().hex[:6]}"
    await db.execute(
        """INSERT INTO wa_templates (key, name, category, trigger_event, body,
                                     variables, enabled, include_calendar, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8::uuid)""",
        key, body.name, body.category, body.trigger_event, body.body, variables,
        body.include_calendar, actor)
    await audit_log(actor, "whatsapp.template.create", key,
                    {"name": body.name, "trigger_event": body.trigger_event})
    return await db.fetch_one("SELECT * FROM wa_templates WHERE key = $1", key)


@api.put("/admin/whatsapp/templates/{key}")
async def wa_template_update(key: str, body: WaTemplateUpdateIn,
                             actor: str = Depends(require_perm("whatsapp"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Nothing to update")
    if "trigger_event" in fields:
        _wa_validate_trigger_event(fields["trigger_event"])
    if "category" in fields and fields["category"] not in WA_TEMPLATE_CATEGORIES:
        raise HTTPException(400, f"Unknown category. Allowed: {sorted(WA_TEMPLATE_CATEGORIES)}")
    # Body changed -> re-derive variables so the editor/test-send never drift from
    # what the text actually references.
    if "body" in fields:
        fields["variables"] = wa_openwa.extract_variables(fields["body"])
    sets, args = [], []
    for col in ("name", "category", "trigger_event", "body", "variables",
               "enabled", "include_calendar"):
        if col in fields:
            args.append(fields[col])
            sets.append(f"{col} = ${len(args)}")
    args.append(actor)
    sets.append(f"updated_by = ${len(args)}::uuid")
    args.append(key)
    got = await db.fetch_val(
        f"UPDATE wa_templates SET {', '.join(sets)}, updated_at = now() "
        f"WHERE key = ${len(args)} RETURNING key", *args)
    if not got:
        raise HTTPException(404, "Template not found")
    action = "whatsapp.template.toggle" if "enabled" in fields else "whatsapp.template.update"
    await audit_log(actor, action, key, {k: v for k, v in fields.items() if k != "body"})
    return await db.fetch_one("SELECT * FROM wa_templates WHERE key = $1", key)


@api.delete("/admin/whatsapp/templates/{key}")
async def wa_template_delete(key: str, actor: str = Depends(require_perm("whatsapp"))):
    got = await db.fetch_val("DELETE FROM wa_templates WHERE key = $1 RETURNING key", key)
    if not got:
        raise HTTPException(404, "Template not found")
    await audit_log(actor, "whatsapp.template.delete", key)
    return {"ok": True}


@api.post("/admin/whatsapp/templates/{key}/test")
async def wa_template_test(key: str, body: WaTemplateTestIn,
                           actor: str = Depends(require_perm("whatsapp"))):
    """Send the template (with placeholder sample values) to one number, so staff can
    see exactly what a customer receives before enabling the automation."""
    tpl = await db.fetch_one("SELECT variables FROM wa_templates WHERE key = $1", key)
    if not tpl:
        raise HTTPException(404, "Template not found")
    sample = {v: f"[{v}]" for v in (tpl["variables"] or [])}
    sample["name"] = "Test User"
    res = await _wa_notify(key, phone=body.phone, variables=sample, source="system")
    await audit_log(actor, "whatsapp.template.test", key, {"phone": body.phone})
    if not res.get("sent"):
        raise HTTPException(502, f"Test send did not go through: {res.get('reason')}")
    return res


@api.get("/admin/whatsapp/automations")
async def wa_automations(_: str = Depends(require_perm("whatsapp"))):
    """Every real event hook and every template currently bound to it — 0, 1, or
    many. All ENABLED templates on an event fire when it happens. A template staff
    create and bind to an event shows up here immediately."""
    rows = await db.fetch_all(
        "SELECT key, name, enabled, trigger_event FROM wa_templates "
        "WHERE trigger_event != 'manual' ORDER BY name")
    by_event: Dict[str, list] = {}
    for r in rows:
        by_event.setdefault(r["trigger_event"], []).append(
            {"key": r["key"], "name": r["name"], "enabled": r["enabled"]})
    return [{"event": event, **meta, "templates": by_event.get(event, [])}
            for event, meta in WA_TRIGGER_EVENTS.items()]


# ── Admin: WhatsApp inbox, campaigns, session ────────────────────────────────
class WaSendIn(BaseModel):
    chat_id: Optional[str] = None   # either an explicit chat id…
    phone: Optional[str] = None     # …or a phone number we convert
    text: str = Field(min_length=1, max_length=4096)


class WaCampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4096)
    # Explicit recipients, or None to target every opted-in user with a verified phone.
    user_ids: Optional[List[str]] = None


@api.get("/admin/whatsapp/status")
async def wa_admin_status(_: str = Depends(require_perm("whatsapp"))):
    """Gateway + session health for the admin panel header."""
    if not wa_openwa.configured():
        return {"configured": False, "status": "not_configured"}
    try:
        s = await wa_openwa.session_status()
    except wa_openwa.OpenWAError as e:
        log.warning(f"OpenWA status failed: {e}")
        return {"configured": True, "status": "unreachable"}
    return {"configured": True, "status": s.get("status"), "phone": s.get("phone"),
            "connected_at": s.get("connectedAt"), "last_error": s.get("lastError")}


@api.get("/admin/whatsapp/chats")
async def wa_admin_chats(_: str = Depends(require_perm("whatsapp")),
                         limit: int = 100, q: Optional[str] = None):
    """Support inbox. Reads OUR mirror, not the gateway — so it only ever shows
    customer conversations (see the mirroring policy above), and stays fast."""
    limit = max(1, min(limit, 200))
    where, args = ["c.is_group = false"], []

    def _arg(v):
        args.append(v)
        return f"${len(args)}"

    if q:
        a = _arg(f"%{q}%")
        where.append(f"(c.display_name ILIKE {a} OR c.phone ILIKE {a} "
                     f"OR u.full_name ILIKE {a} OR c.last_message_preview ILIKE {a})")
    return await db.fetch_all(
        f"""SELECT c.id::text AS chat_row_id, c.chat_id, c.phone, c.display_name,
                   c.unread_count, c.last_message_at, c.last_message_preview,
                   c.user_id::text AS user_id, COALESCE(u.full_name, '') AS customer_name
              FROM wa_chats c
              LEFT JOIN users u ON u.id = c.user_id
             WHERE {' AND '.join(where)}
             ORDER BY c.last_message_at DESC NULLS LAST
             LIMIT {_arg(limit)}""", *args)


@api.get("/admin/whatsapp/chats/{chat_row_id}/messages")
async def wa_admin_messages(chat_row_id: str, _: str = Depends(require_perm("whatsapp")),
                            limit: int = 100):
    limit = max(1, min(limit, 500))
    try:
        uuid.UUID(chat_row_id)
    except ValueError:
        raise HTTPException(400, "Invalid chat id")
    return await db.fetch_all(
        """SELECT m.id::text AS message_id, m.direction, m.body, m.msg_type, m.media_url,
                  m.status, m.source, m.wa_timestamp, m.error,
                  COALESCE(s.full_name, '') AS sent_by_name
             FROM wa_messages m
             LEFT JOIN users s ON s.id = m.sent_by_user_id
            WHERE m.chat_id = $1::uuid
            ORDER BY m.wa_timestamp ASC
            LIMIT $2""", chat_row_id, limit)


@api.post("/admin/whatsapp/send")
async def wa_admin_send(body: WaSendIn, actor: str = Depends(require_perm("whatsapp"))):
    """Staff reply. Sends via the gateway, then mirrors our own outbound copy so the
    thread reads correctly even before the message.sent webhook lands."""
    if not wa_openwa.configured():
        raise HTTPException(503, "WhatsApp gateway is not configured")
    chat_id = body.chat_id or (wa_openwa.to_chat_id(normalize_phone(body.phone)) if body.phone else None)
    if not chat_id:
        raise HTTPException(400, "chat_id or phone is required")
    try:
        res = await wa_openwa.send_text(chat_id, body.text)
    except wa_openwa.OpenWAError as e:
        log.warning(f"OpenWA send failed: {e}")
        raise HTTPException(502, "Could not send the message. Please try again.")

    user_id = await _wa_should_mirror(chat_id)
    if user_id:
        chat_row_id = await _wa_upsert_chat(
            wa_openwa.SESSION_ID, chat_id, user_id, preview=body.text, ts=now())
        await _wa_store_message(
            session_id=wa_openwa.SESSION_ID, chat_row_id=chat_row_id,
            wa_message_id=res.get("messageId") or uid("wa_"),
            direction="out", body_text=body.text,
            to_phone=wa_openwa.phone_from_chat_id(chat_id),
            status="sent", source="support", sent_by_user_id=actor, raw=res)
    await audit_log(actor, "whatsapp.send", chat_id, {"chars": len(body.text)})
    return {"ok": True, "message_id": res.get("messageId"), "stored": bool(user_id)}


@api.post("/admin/whatsapp/chats/{chat_row_id}/read")
async def wa_admin_mark_read(chat_row_id: str, _: str = Depends(require_perm("whatsapp"))):
    chat_id = await db.fetch_val(
        "UPDATE wa_chats SET unread_count = 0, updated_at = now() "
        "WHERE id = $1::uuid RETURNING chat_id", chat_row_id)
    if not chat_id:
        raise HTTPException(404, "Chat not found")
    try:
        await wa_openwa.mark_read(chat_id)
    except wa_openwa.OpenWAError:
        pass  # local state is what the inbox renders; gateway ack is best-effort
    return {"ok": True}


@api.post("/admin/whatsapp/campaigns")
async def wa_admin_campaign(body: WaCampaignIn, actor: str = Depends(require_perm("whatsapp"))):
    """Queue a bulk send. OpenWA paces delivery itself — blasting messages back to back
    is a fast route to a ban, so we hand it the whole list and let it throttle."""
    if not wa_openwa.configured():
        raise HTTPException(503, "WhatsApp gateway is not configured")
    sql = """SELECT u.id::text AS user_id, u.phone
               FROM users u
               LEFT JOIN notification_preferences np ON np.user_id = u.id
              WHERE u.deleted_at IS NULL AND u.phone IS NOT NULL
                AND u.phone_verified_at IS NOT NULL
                AND COALESCE((np.whatsapp ->> 'optin')::boolean, true)"""
    args: list = []
    if body.user_ids:
        args.append(body.user_ids)
        sql += f" AND u.id = ANY(${len(args)}::uuid[])"
    recipients = await db.fetch_all(sql + " LIMIT 2000", *args)
    if not recipients:
        raise HTTPException(400, "No opted-in recipients with a verified phone")

    chat_ids = [wa_openwa.to_chat_id(r["phone"]) for r in recipients]
    try:
        res = await wa_openwa.send_bulk(chat_ids, body.body)
    except wa_openwa.OpenWAError as e:
        log.warning(f"OpenWA bulk send failed: {e}")
        raise HTTPException(502, "Could not queue the campaign. Please try again.")

    cid = await db.fetch_val(
        """INSERT INTO wa_campaigns (name, session_id, batch_id, body, recipient_count,
                                     status, created_by)
           VALUES ($1,$2,$3,$4,$5,'running',$6::uuid) RETURNING id::text""",
        body.name, wa_openwa.SESSION_ID, res.get("batchId"), body.body,
        len(chat_ids), actor)
    await audit_log(actor, "whatsapp.campaign.start", cid,
                    {"name": body.name, "recipients": len(chat_ids)})
    return {"ok": True, "campaign_id": cid, "batch_id": res.get("batchId"),
            "recipients": len(chat_ids)}


@api.get("/admin/whatsapp/campaigns")
async def wa_admin_campaign_list(_: str = Depends(require_perm("whatsapp")), limit: int = 50):
    return await db.fetch_all(
        """SELECT c.id::text AS campaign_id, c.name, c.batch_id, c.body, c.status,
                  c.recipient_count, c.sent_count, c.failed_count, c.created_at,
                  c.completed_at, COALESCE(u.full_name, '') AS created_by_name
             FROM wa_campaigns c
             LEFT JOIN users u ON u.id = c.created_by
            ORDER BY c.created_at DESC LIMIT $1""", max(1, min(limit, 200)))


@api.post("/admin/whatsapp/campaigns/{campaign_id}/refresh")
async def wa_admin_campaign_refresh(campaign_id: str,
                                    _: str = Depends(require_perm("whatsapp"))):
    """Poll the gateway for batch progress and fold it into our row."""
    row = await db.fetch_one(
        "SELECT batch_id, status FROM wa_campaigns WHERE id = $1::uuid", campaign_id)
    if not row:
        raise HTTPException(404, "Campaign not found")
    if not row["batch_id"]:
        return {"ok": True, "status": row["status"]}
    try:
        b = await wa_openwa.batch_status(row["batch_id"])
    except wa_openwa.OpenWAError:
        raise HTTPException(502, "Could not read campaign progress")
    progress = b.get("progress") or {}
    sent, failed = progress.get("sent") or 0, progress.get("failed") or 0
    status = (b.get("status") or row["status"]).lower()
    done = status in ("completed", "cancelled", "failed")
    await db.execute(
        """UPDATE wa_campaigns SET sent_count=$2, failed_count=$3, status=$4,
               completed_at = CASE WHEN $5 THEN now() ELSE completed_at END
            WHERE id=$1::uuid""", campaign_id, sent, failed, status, done)
    return {"ok": True, "status": status, "sent": sent, "failed": failed}


# ── Router wiring ─────────────────────────────────────────────────────────────
app.include_router(api)

app.add_middleware(GZipMiddleware, minimum_size=500)

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
