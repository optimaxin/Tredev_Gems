"""OpenWA gateway client — WhatsApp send/receive for Tredev Gems.

This module is pure transport: it talks HTTP to the OpenWA gateway and nothing
else. Persistence (mirroring messages into wa_chats/wa_messages) and the
who-may-see-what rules live in server.py, where the DB and auth context are.

WHY OpenWA AND NOT META CLOUD API
---------------------------------
Meta's Cloud API can only send pre-approved templates outside a 24h window, which
makes real two-way support chat impractical. OpenWA drives a normal WhatsApp
account, so staff can hold ordinary conversations.

The trade-off is real and deliberate: OpenWA uses a reverse-engineered client
(Baileys here), which WhatsApp does not sanction. The connected number carries a
non-zero ban risk. Never point this at a number whose loss would break auth —
Tredev's phone verification runs on Firebase, not WhatsApp, precisely so a ban
cannot lock customers out.

CONFIG (backend/.env)
---------------------
    OPENWA_BASE_URL        http://127.0.0.1:2785     (private; never public)
    OPENWA_API_KEY         owa_k1_...                (sent as X-API-Key)
    OPENWA_SESSION_ID      uuid of the paired session
    OPENWA_WEBHOOK_SECRET  shared secret for inbound HMAC verification
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("gemora.wa")

BASE_URL = os.environ.get("OPENWA_BASE_URL", "http://127.0.0.1:2785").rstrip("/")
API_KEY = os.environ.get("OPENWA_API_KEY", "").strip()
SESSION_ID = os.environ.get("OPENWA_SESSION_ID", "").strip()
WEBHOOK_SECRET = os.environ.get("OPENWA_WEBHOOK_SECRET", "").strip()

_TIMEOUT = 30.0


def configured() -> bool:
    """True when the gateway is wired up. Callers fall back to a mock/log when False,
    so a missing gateway degrades to a no-op instead of breaking checkout or dispatch."""
    return bool(API_KEY and SESSION_ID)


class OpenWAError(RuntimeError):
    """Gateway call failed. Carries the upstream status so callers can distinguish
    'not paired yet' (409/400) from 'gateway down' (connection error)."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


async def _req(method: str, path: str, *, json: Any = None, params: Any = None) -> Any:
    if not API_KEY:
        raise OpenWAError("OpenWA is not configured (OPENWA_API_KEY unset)")
    url = f"{BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.request(method, url, json=json, params=params,
                                headers={"X-API-Key": API_KEY})
    except httpx.RequestError as e:
        # Connection-level failure: the gateway is down or unreachable.
        raise OpenWAError(f"OpenWA unreachable: {e.__class__.__name__}") from e
    if r.status_code >= 400:
        # Keep the upstream detail in the server log; callers surface something generic.
        detail = r.text[:300]
        log.warning("OpenWA %s %s -> %s %s", method, path, r.status_code, detail)
        raise OpenWAError(f"OpenWA {method} {path} failed ({r.status_code})", r.status_code)
    if not r.content:
        return None
    try:
        return r.json()
    except ValueError:
        return None


# ── Addressing ───────────────────────────────────────────────────────────────
def to_chat_id(phone: str) -> str:
    """E.164 (or bare digits) -> the '<digits>@c.us' chat id OpenWA expects.
    Group ids already contain '@' and pass through untouched."""
    p = (phone or "").strip()
    if "@" in p:
        return p
    return f"{p.lstrip('+').replace(' ', '')}@c.us"


def phone_from_chat_id(chat_id: str) -> Optional[str]:
    """'919927791002@c.us' -> '+919927791002'. Returns None for groups (@g.us),
    which have no single phone number."""
    if not chat_id or "@g.us" in chat_id:
        return None
    digits = chat_id.split("@", 1)[0].split(":", 1)[0]
    return f"+{digits}" if digits.isdigit() else None


def is_group(chat_id: str) -> bool:
    return bool(chat_id) and chat_id.endswith("@g.us")


# ── Session ──────────────────────────────────────────────────────────────────
async def session_status() -> dict:
    return await _req("GET", f"/api/sessions/{SESSION_ID}") or {}


async def session_start() -> dict:
    return await _req("POST", f"/api/sessions/{SESSION_ID}/start") or {}


async def session_stop() -> dict:
    return await _req("POST", f"/api/sessions/{SESSION_ID}/stop") or {}


async def pairing_code(phone_number: str) -> dict:
    """Request an 8-char code to link a number. Digits only, no '+'.
    The code expires in about a minute — request it only when someone is
    already on WhatsApp's 'link with phone number' screen."""
    digits = (phone_number or "").lstrip("+").replace(" ", "")
    return await _req("POST", f"/api/sessions/{SESSION_ID}/pairing-code",
                      json={"phoneNumber": digits}) or {}


async def session_qr() -> dict:
    return await _req("GET", f"/api/sessions/{SESSION_ID}/qr") or {}


# ── Sending ──────────────────────────────────────────────────────────────────
async def send_text(chat_id: str, text: str) -> dict:
    return await _req("POST", f"/api/sessions/{SESSION_ID}/messages/send-text",
                      json={"chatId": chat_id, "text": text}) or {}


async def send_image(chat_id: str, url: str, caption: str = "") -> dict:
    body: Dict[str, Any] = {"chatId": chat_id, "url": url}
    if caption:
        body["caption"] = caption
    return await _req("POST", f"/api/sessions/{SESSION_ID}/messages/send-image",
                      json=body) or {}


async def send_document(chat_id: str, url: str, filename: str = "") -> dict:
    body: Dict[str, Any] = {"chatId": chat_id, "url": url}
    if filename:
        body["filename"] = filename
    return await _req("POST", f"/api/sessions/{SESSION_ID}/messages/send-document",
                      json=body) or {}


async def send_bulk(chat_ids: List[str], text: str) -> dict:
    """Queue a campaign. Returns a batchId to poll — OpenWA paces the sends itself,
    which matters: blasting messages back-to-back is what gets numbers banned."""
    return await _req("POST", f"/api/sessions/{SESSION_ID}/messages/send-bulk",
                      json={"chatIds": chat_ids, "text": text}) or {}


async def batch_status(batch_id: str) -> dict:
    return await _req("GET", f"/api/sessions/{SESSION_ID}/messages/batch/{batch_id}") or {}


async def batch_cancel(batch_id: str) -> dict:
    return await _req("POST",
                      f"/api/sessions/{SESSION_ID}/messages/batch/{batch_id}/cancel") or {}


# ── Reading ──────────────────────────────────────────────────────────────────
async def list_chats() -> list:
    r = await _req("GET", f"/api/sessions/{SESSION_ID}/chats")
    return r if isinstance(r, list) else (r or {}).get("data", [])


async def chat_history(chat_id: str, limit: int = 50) -> list:
    r = await _req("GET", f"/api/sessions/{SESSION_ID}/messages/{chat_id}/history",
                   params={"limit": limit})
    return r if isinstance(r, list) else (r or {}).get("data", [])


async def mark_read(chat_id: str) -> dict:
    return await _req("POST", f"/api/sessions/{SESSION_ID}/chats/read",
                      json={"chatId": chat_id}) or {}


async def send_typing(chat_id: str, state: str = "composing") -> dict:
    return await _req("POST", f"/api/sessions/{SESSION_ID}/chats/typing",
                      json={"chatId": chat_id, "state": state}) or {}


# ── Webhook registration + verification ──────────────────────────────────────
async def register_webhook(url: str, events: Optional[List[str]] = None) -> dict:
    """Point the gateway at our inbound receiver.

    NOTE: OpenWA refuses by default to deliver webhooks to loopback/private/
    link-local addresses (an SSRF guard). Both local dev and Render private
    networking are private addresses, so the guard must be relaxed on the gateway
    or this will register fine and then silently never deliver.
    """
    body: Dict[str, Any] = {
        "url": url,
        "events": events or ["message.received", "message.sent", "message.ack",
                             "message.failed", "session.status"],
        "retryCount": 3,
    }
    if WEBHOOK_SECRET:
        body["secret"] = WEBHOOK_SECRET
    return await _req("POST", f"/api/sessions/{SESSION_ID}/webhooks", json=body) or {}


async def list_webhooks() -> list:
    r = await _req("GET", f"/api/sessions/{SESSION_ID}/webhooks")
    return r if isinstance(r, list) else (r or {}).get("data", [])


# ── Template rendering ───────────────────────────────────────────────────────
_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def render_template(body: str, variables: Dict[str, Any]) -> str:
    """Substitute {{name}} placeholders. An unknown/missing placeholder renders as
    empty rather than leaving a literal '{{x}}' in a customer's message. Values are
    inserted as plain text — WhatsApp has no markup injection to worry about."""
    def _sub(m):
        v = variables.get(m.group(1))
        return "" if v is None else str(v)
    out = _VAR_RE.sub(_sub, body or "")
    # Collapse blank lines left by an empty optional line (e.g. a missing calendar link).
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def google_calendar_link(title: str, start: datetime, *, duration_minutes: int = 30,
                         details: str = "", location: str = "") -> str:
    """A 'add to calendar' URL that opens Google Calendar with the event pre-filled.
    Works from any WhatsApp client — WhatsApp itself has no native calendar button,
    so a tappable link is the portable way to give an 'add to calendar' action."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = start + timedelta(minutes=duration_minutes)
    fmt = "%Y%m%dT%H%M%SZ"
    q = {
        "action": "TEMPLATE",
        "text": title,
        "dates": f"{start.astimezone(timezone.utc).strftime(fmt)}/{end.astimezone(timezone.utc).strftime(fmt)}",
    }
    if details:
        q["details"] = details
    if location:
        q["location"] = location
    return "https://calendar.google.com/calendar/render?" + urllib.parse.urlencode(q)


def verify_signature(raw_body: bytes, header_value: Optional[str]) -> bool:
    """Verify X-OpenWA-Signature: 'sha256=<hex>' — HMAC-SHA256 of the raw body.

    Same scheme as the Meta webhook already handled in server.py. Returns False
    when a secret is configured but the signature is absent or wrong; returns True
    when no secret is configured (local dev), so unsigned local testing still works.
    """
    if not WEBHOOK_SECRET:
        return True
    if not header_value:
        return False
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    # compare_digest: constant-time, so a wrong signature can't be brute-forced by timing.
    return hmac.compare_digest(expected, header_value.strip())
