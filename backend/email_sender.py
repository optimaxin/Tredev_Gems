"""Email transport for Tredev Gems — see .claude/.email_notification.md.

Named email_sender.py, not email.py: backend/ sits directly on sys.path (see
how db.py/invoice.py/gst.py are imported bare), so a top-level email.py here
would shadow Python's own stdlib `email` package — breaking the very
`email.mime`/`email.utils` imports this file needs.

Pure transport + logging, mirroring wa_openwa.py's shape: this module knows how
to send one email and log it. Template rendering lives in email_templates.py;
the fire-and-forget dispatch used by server.py's trigger points lives here
(_email_fire_event) since it needs both the sender and the DB.

TRANSPORT: ZeptoMail (Zoho), not raw SMTP — MilesWeb's mail server
(mail.optimaxin.com) silently drops connections from Render's IP range
(confirmed via the admin diagnose endpoint: TCP connect itself times out, not
an auth/DNS failure) — a common blanket anti-spam block against datacenter/
cloud IP ranges on shared cPanel hosting. ZeptoMail is a plain HTTPS API call
(same shape as wa_openwa.py's calls to the WhatsApp gateway, or geo.py's calls
to AWS Location) rather than a raw socket to a mail server, so that class of
block doesn't apply. It still sends AS no-reply@optimaxin.com (a domain you
verify with Zoho, unrelated to where the mailbox itself lives) — recipients
see the same From address either way. httpx was already in requirements.txt
and is this codebase's established async HTTP client, so no new dependency.

CONFIG (backend/.env)
----------------------
    ZEPTOMAIL_TOKEN       the full "Send Mail Token" string from ZeptoMail's Mail
                          Agent -> API Keys page — already includes the
                          "Zoho-enczapikey " prefix, paste it verbatim
    ZEPTOMAIL_API_URL     defaults to https://api.zeptomail.in/v1.1/email —
                          override to the .com data center if your account isn't
                          on the India cluster (ZeptoMail shows the right one on
                          the same API Keys page)
    EMAIL_FROM_ADDRESS    no-reply@optimaxin.com — must be a verified sending
                          domain in ZeptoMail (Mail Agent -> Domains -> add
                          optimaxin.com, then add its SPF/DKIM records to DNS)
    EMAIL_FROM_NAME       defaults to "Tredev Store"
    ADMIN_NOTIFICATION_EMAILS   comma-separated, for the admin order copy
    BULK_EMAIL_RATE_LIMIT       emails/second for campaign sends (default 5)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import jwt as pyjwt

import db

log = logging.getLogger("gemora.email")

ZEPTOMAIL_TOKEN = os.environ.get("ZEPTOMAIL_TOKEN", "").strip()
ZEPTOMAIL_API_URL = os.environ.get("ZEPTOMAIL_API_URL", "https://api.zeptomail.in/v1.1/email").strip()
EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "").strip()
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Tredev Store").strip()
# Hard ceiling on the whole request (connect+send+response) — see the wait_for in
# send_email(). Unlike the old raw-socket SMTP path, this wraps a real coroutine
# (httpx.AsyncClient), so wait_for genuinely cancels it on timeout rather than
# just abandoning a stuck OS thread — no leaked-worker caveat here.
SEND_TIMEOUT = 35
ADMIN_NOTIFICATION_EMAILS = [e.strip() for e in
                             os.environ.get("ADMIN_NOTIFICATION_EMAILS", "").split(",") if e.strip()]
BULK_EMAIL_RATE_LIMIT = max(1, int(os.environ.get("BULK_EMAIL_RATE_LIMIT", "5") or "5"))


def configured() -> bool:
    """True once a real ZeptoMail token + from-address are set. Callers degrade
    to a logged no-op when False, same philosophy as wa_openwa.configured() — a
    misconfigured sender must never break checkout or an admin action."""
    return bool(ZEPTOMAIL_TOKEN and EMAIL_FROM_ADDRESS)


_EMAIL_NAME_RE = re.compile(r"^(.*?)<(.+)>$")


def _split_name_addr(value: str) -> dict:
    """'Jane Doe <jane@x.com>' -> {"address": "jane@x.com", "name": "Jane Doe"};
    a bare address passes through as-is. Recipients built server-side are always
    bare addresses; this only matters if a caller ever passes a display name."""
    m = _EMAIL_NAME_RE.match(value.strip())
    if m:
        return {"address": m.group(2).strip(), "name": m.group(1).strip()}
    return {"address": value.strip()}


async def _send_async(to: list[str], subject: str, html: str, text: str,
                      reply_to: Optional[str], list_unsubscribe: Optional[str]) -> str:
    """ZeptoMail's HTTPS send API — see https://www.zoho.com/zeptomail/help/api/email-sending.html"""
    payload = {
        "from": {"address": EMAIL_FROM_ADDRESS, "name": EMAIL_FROM_NAME},
        "to": [{"email_address": _split_name_addr(addr)} for addr in to],
        "subject": subject,
        "htmlbody": html,
        "textbody": text,
    }
    if reply_to:
        payload["reply_to"] = [_split_name_addr(reply_to)]
    if list_unsubscribe:
        # ZeptoMail has no first-class unsubscribe field on this endpoint; the
        # raw header is still the same thing every mail client understands.
        payload["mime_headers"] = {"List-Unsubscribe": f"<{list_unsubscribe}>"}

    headers = {"Authorization": ZEPTOMAIL_TOKEN, "Content-Type": "application/json",
              "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=20, write=10, pool=10)) as client:
        r = await client.post(ZEPTOMAIL_API_URL, json=payload, headers=headers)
    if r.status_code >= 400:
        # ZeptoMail's error body is {"error": {"code", "message", "sub_code", ...}}
        # or a flat {"message": ...} — surface whichever is present, truncated so
        # a verbose upstream error never blows out the email_log.error column.
        try:
            detail = r.json()
            message = (detail.get("error") or {}).get("message") or detail.get("message") or r.text
        except ValueError:
            message = r.text
        raise RuntimeError(f"ZeptoMail {r.status_code}: {message}"[:500])
    data = r.json()
    return data.get("request_id", "")


async def log_email(*, type_: str, to: list[str], subject: str, status: str,
                    error: Optional[str] = None, message_id: Optional[str] = None,
                    sent_by: Optional[str] = None, campaign_id: Optional[str] = None,
                    related_id: Optional[str] = None, body_html: Optional[str] = None,
                    log_id: Optional[str] = None) -> str:
    """Inserts a new log row, unless `log_id` is given — then it updates that row
    in place instead (used by the admin "Retry" action, so retrying a failed send
    corrects its own row rather than piling up a new one every click). Returns the
    row's id either way."""
    row_id = log_id or str(uuid.uuid4())
    try:
        if log_id:
            await db.execute(
                """UPDATE email_log SET status=$2, error=$3, message_id=$4, sent_at=
                       CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id=$1::uuid""",
                log_id, status, error, message_id)
        else:
            await db.execute(
                """INSERT INTO email_log (id, type, to_emails, subject, status, error,
                        message_id, sent_by, campaign_id, related_id, body_html, sent_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9::uuid,$10,$11,
                           CASE WHEN $5 = 'sent' THEN now() END)""",
                row_id, type_, to, subject, status, error, message_id,
                sent_by, campaign_id, related_id, body_html)
    except Exception as e:
        log.warning(f"email log_email failed: {e}")
    return row_id


async def send_email(to: list[str], subject: str, html: str, text: str, *,
                     type_: str = "custom", reply_to: Optional[str] = None,
                     list_unsubscribe: Optional[str] = None,
                     sent_by: Optional[str] = None, campaign_id: Optional[str] = None,
                     related_id: Optional[str] = None, log_id: Optional[str] = None) -> dict:
    """Send one email. NEVER raises — a mail outage must not break the order/booking/
    admin action that triggered it. Always logs the attempt either way.

    `log_id`, when passed (only by the admin "Retry" endpoint), updates that
    existing email_log row instead of inserting a new one."""
    if not to:
        return {"success": False, "error": "no recipients"}
    if not configured():
        log.warning(f"email not configured — skipping '{subject}' to {to}")
        row_id = await log_email(type_=type_, to=to, subject=subject, status="failed",
                                 error="ZeptoMail not configured", sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": False, "error": "ZeptoMail not configured", "log_id": row_id}
    try:
        # wait_for is a backstop against anything taking longer than expected
        # (network hiccup, ZeptoMail-side slowness) — it guarantees this request
        # returns within SEND_TIMEOUT regardless, so a transport issue can never
        # hang the whole request (and everyone awaiting it) forever.
        message_id = await asyncio.wait_for(
            _send_async(to, subject, html, text, reply_to, list_unsubscribe),
            timeout=SEND_TIMEOUT)
        row_id = await log_email(type_=type_, to=to, subject=subject, status="sent",
                                 message_id=message_id, sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": True, "message_id": message_id, "log_id": row_id}
    except asyncio.TimeoutError:
        error = f"Timed out after {SEND_TIMEOUT}s calling ZeptoMail"
        log.warning(f"email send timed out ({subject!r} -> {to})")
        row_id = await log_email(type_=type_, to=to, subject=subject, status="failed",
                                 error=error, sent_by=sent_by, campaign_id=campaign_id,
                                 related_id=related_id, body_html=html, log_id=log_id)
        return {"success": False, "error": error, "log_id": row_id}
    except Exception as e:
        error = str(e)
        log.warning(f"email send failed ({subject!r} -> {to}): {error}")
        row_id = await log_email(type_=type_, to=to, subject=subject, status="failed",
                                 error=error[:500], sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": False, "error": error, "log_id": row_id}


async def send_with_admin_copy(customer_email: Optional[str], customer_render: Optional[tuple],
                               admin_render: Optional[tuple], *, type_: str, related_id: str) -> None:
    """Order confirmation to the buyer + a copy to every ADMIN_NOTIFICATION_EMAILS
    address, mirroring the spec's sendWithAdminCopy — fired in parallel, one
    failing never blocks the other. Either render may be None (its template was
    disabled by an admin in Admin -> Emails -> Templates) — skipped, not an error."""
    tasks = []
    if customer_email and customer_render:
        subject, html, text = customer_render
        tasks.append(send_email([customer_email], subject, html, text,
                                type_=type_, related_id=related_id))
    if ADMIN_NOTIFICATION_EMAILS and admin_render:
        subject, html, text = admin_render
        tasks.append(send_email(ADMIN_NOTIFICATION_EMAILS, subject, html, text,
                                type_=f"{type_}.admin_copy", related_id=related_id))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


# ── Fire-and-forget event dispatch — mirrors server.py's _wa_fire_event shape ──
def _email_fire_event(event: str, coro_factory) -> None:
    """Schedule `coro_factory()` (a zero-arg callable returning a coroutine) on the
    running loop without awaiting it, so the caller's request/transaction is never
    held up by ZeptoMail latency. Exceptions are logged, never propagated."""
    async def _run():
        try:
            await coro_factory()
        except Exception as e:
            log.warning(f"email fire-event '{event}' crashed: {e}")
    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        pass  # no running loop — skip rather than crash


# ── Unsubscribe tokens — same shape as server.py's _mint_astro_password_token ──
# JWT_SECRET/JWT_ALGO are re-read from the environment here rather than imported
# from server.py, to keep this module import-cycle-free (server.py imports this
# module, not the other way around).
#
# Keyed by the raw email address, not a user_id: suppression (see server.py's
# /api/email/unsubscribe, backed by the pre-existing `suppressions` table) is
# per-address, and a campaign's manual/CSV recipients often aren't registered
# users at all — a user_id-keyed token would have nothing to look up for them.
_JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
_JWT_ALGO = "HS256"


def unsubscribe_token(email: str) -> str:
    payload = {"sub": email.strip().lower(), "aud": "email_unsub",
              "exp": datetime.now(timezone.utc) + timedelta(days=730)}
    return pyjwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGO)


def verify_unsubscribe_token(token: str) -> Optional[str]:
    try:
        data = pyjwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO], audience="email_unsub")
    except Exception:
        return None
    return data.get("sub")


def _demo() -> None:
    """Self-check: `python email_sender.py`. No network/DB — just the pure helpers."""
    tok = unsubscribe_token("Test@Example.com")
    assert verify_unsubscribe_token(tok) == "test@example.com"
    assert verify_unsubscribe_token("garbage") is None
    assert not configured(), "no ZeptoMail env set in test — configured() must be False"
    assert _split_name_addr("jane@x.com") == {"address": "jane@x.com"}
    assert _split_name_addr("Jane Doe <jane@x.com>") == {"address": "jane@x.com", "name": "Jane Doe"}
    print("email_sender.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
