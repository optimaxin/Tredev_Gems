"""Email transport for Tredev Gems — see .claude/.email_notification.md.

Named email_sender.py, not email.py: backend/ sits directly on sys.path (see
how db.py/invoice.py/gst.py are imported bare), so a top-level email.py here
would shadow Python's own stdlib `email` package — breaking the very
`email.mime`/`email.utils` imports this file needs.

Pure transport + logging, mirroring wa_openwa.py's shape: this module knows how
to send one email and log it. Template rendering lives in email_templates.py;
the fire-and-forget dispatch used by server.py's trigger points lives here
(_email_fire_event) since it needs both the SMTP client and the DB.

CONFIG (backend/.env)
----------------------
    SMTP_HOST                  smtp.example.com
    SMTP_PORT                  465                 (SSL — see .claude/.email_notification.md)
    SMTP_USER / SMTP_PASSWORD  mailbox credentials
    SMTP_FROM_EMAIL            noreply@tredeva.com
    SMTP_FROM_NAME             defaults to "Tredeva Store"
    ADMIN_NOTIFICATION_EMAILS  comma-separated, for the admin order copy
    BULK_EMAIL_RATE_LIMIT      emails/second for campaign sends (default 5)
"""
from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Optional

import jwt as pyjwt

import db

log = logging.getLogger("gemora.email")

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465") or "465")
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", SMTP_USER).strip()
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "Tredeva Store").strip()
ADMIN_NOTIFICATION_EMAILS = [e.strip() for e in
                             os.environ.get("ADMIN_NOTIFICATION_EMAILS", "").split(",") if e.strip()]
BULK_EMAIL_RATE_LIMIT = max(1, int(os.environ.get("BULK_EMAIL_RATE_LIMIT", "5") or "5"))


def configured() -> bool:
    """True once real SMTP creds are set. Callers degrade to a logged no-op when
    False, same philosophy as wa_openwa.configured() — a missing mail server must
    never break checkout or an admin action."""
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _send_sync(to: list[str], subject: str, html: str, text: str,
               reply_to: Optional[str], list_unsubscribe: Optional[str]) -> str:
    """Blocking smtplib call — always run via asyncio.to_thread, never awaited
    directly (a real SMTP round-trip is seconds, long enough to stall the event
    loop for every other request on a single-instance deploy)."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((SMTP_FROM_NAME, SMTP_FROM_EMAIL))
    msg["To"] = ", ".join(to)
    if reply_to:
        msg["Reply-To"] = reply_to
    if list_unsubscribe:
        msg["List-Unsubscribe"] = f"<{list_unsubscribe}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, to, msg.as_string())
    return uuid.uuid4().hex  # smtplib gives no message-id back; this is our own log key


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
                                 error="SMTP not configured", sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": False, "error": "SMTP not configured", "log_id": row_id}
    try:
        message_id = await asyncio.to_thread(
            _send_sync, to, subject, html, text, reply_to, list_unsubscribe)
        row_id = await log_email(type_=type_, to=to, subject=subject, status="sent",
                                 message_id=message_id, sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": True, "message_id": message_id, "log_id": row_id}
    except Exception as e:
        error = str(e)
        log.warning(f"email send failed ({subject!r} -> {to}): {error}")
        row_id = await log_email(type_=type_, to=to, subject=subject, status="failed",
                                 error=error[:500], sent_by=sent_by,
                                 campaign_id=campaign_id, related_id=related_id,
                                 body_html=html, log_id=log_id)
        return {"success": False, "error": error, "log_id": row_id}


async def send_with_admin_copy(customer_email: Optional[str], customer_render: tuple,
                               admin_render: tuple, *, type_: str, related_id: str) -> None:
    """Order confirmation to the buyer + a copy to every ADMIN_NOTIFICATION_EMAILS
    address, mirroring the spec's sendWithAdminCopy — fired in parallel, one
    failing never blocks the other."""
    tasks = []
    if customer_email:
        subject, html, text = customer_render
        tasks.append(send_email([customer_email], subject, html, text,
                                type_=type_, related_id=related_id))
    if ADMIN_NOTIFICATION_EMAILS:
        subject, html, text = admin_render
        tasks.append(send_email(ADMIN_NOTIFICATION_EMAILS, subject, html, text,
                                type_=f"{type_}.admin_copy", related_id=related_id))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


# ── Fire-and-forget event dispatch — mirrors server.py's _wa_fire_event shape ──
def _email_fire_event(event: str, coro_factory) -> None:
    """Schedule `coro_factory()` (a zero-arg callable returning a coroutine) on the
    running loop without awaiting it, so the caller's request/transaction is never
    held up by SMTP latency. Exceptions are logged, never propagated."""
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
    assert not configured(), "no SMTP env set in test — configured() must be False"
    print("email_sender.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
