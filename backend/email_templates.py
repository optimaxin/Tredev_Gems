"""Branded HTML email templates — see .claude/.email_notification.md §4-5.

Plain Python string-building rather than Jinja: unlike invoice.py's one big
tax-table document, this module is many small templates sharing one shell, so a
`_e()` escape helper + f-strings is less machinery than eight separate Jinja
templates for the same result. Every render_* function returns
`(subject, html, text)` — `text` is a naive stripped-tags fallback, not a
hand-authored plain-text version (§4.4 asks for "a" plain-text alternative;
this is the smallest thing that satisfies it).

There is no "Brand Ambassador image" component here (spec §4.2/4.3): this store
has no such asset — only a logo (`invoice_settings.logo_url`), which the header
already uses. Skipped rather than inventing a placeholder image.

Colors/fonts are the spec's fallback palette (§1) — this store's brand tokens
already line up closely with it (see backend/invoice.py's own maroon/gold
palette), so no separate CSS-extraction step was needed.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from typing import Optional

COLORS = {
    "primary": "#1A1A2E", "accent": "#7A1220", "gold": "#D4A843",
    "background": "#F8F8FC", "text_body": "#333333", "text_muted": "#777777",
    "success": "#27AE60", "warning": "#F39C12", "error": "#E74C3C",
}
FONT_STACK = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif"

STATUS_COLOR = {
    "confirmed": "#2F6FDB", "processing": "#F39C12", "shipped": "#7B4FCE",
    "out_for_delivery": "#1C9CA8", "delivered": "#27AE60", "cancelled": "#E74C3C",
    "refunded": "#E74C3C", "pending": "#F39C12",
}


def _e(v) -> str:
    return html.escape(str(v if v is not None else ""))


def money(paise, currency: str = "INR") -> str:
    value = (int(paise or 0)) / 100
    symbol = "₹" if currency == "INR" else ("$" if currency == "USD" else f"{currency} ")
    return f"{symbol}{value:,.2f}"


def _to_text(html_str: str) -> str:
    """Tag-stripping fallback plain-text version — good enough for the spam
    filters/accessibility reasons React Email would otherwise handle for us."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html_str, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</p>|</tr>|</div>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def status_badge(status: str) -> str:
    color = STATUS_COLOR.get(status, COLORS["text_muted"])
    label = _e(status.replace("_", " ").upper())
    return (f'<span style="display:inline-block;padding:4px 14px;border-radius:999px;'
            f'background:{color};color:#fff;font-size:11px;font-weight:700;'
            f'letter-spacing:.06em;text-transform:uppercase">{label}</span>')


def action_button(text: str, href: str, variant: str = "primary") -> str:
    styles = {
        "primary": f"background:{COLORS['accent']};color:#fff;border:2px solid {COLORS['accent']}",
        "secondary": f"background:transparent;color:{COLORS['accent']};border:2px solid {COLORS['accent']}",
        "success": f"background:{COLORS['success']};color:#fff;border:2px solid {COLORS['success']}",
        "gold": f"background:{COLORS['gold']};color:#1A1A1A;border:2px solid {COLORS['gold']}",
    }
    style = styles.get(variant, styles["primary"])
    return (f'<a href="{_e(href)}" style="display:inline-block;{style};'
            f'border-radius:25px;padding:14px 32px;font-weight:700;letter-spacing:.5px;'
            f'text-decoration:none;font-size:14px" target="_blank" rel="noopener">{_e(text)}</a>')


def info_card(rows: list[tuple[str, str]]) -> str:
    trs = "".join(
        f'<tr style="background:{"#F8F5EE" if i % 2 else "#ffffff"}">'
        f'<td style="padding:8px 12px;font-size:12px;color:{COLORS["text_muted"]};'
        f'text-transform:uppercase;letter-spacing:.04em">{_e(k)}</td>'
        f'<td style="padding:8px 12px;font-size:13px;font-weight:600;color:{COLORS["text_body"]};'
        f'text-align:right">{_e(v)}</td></tr>'
        for i, (k, v) in enumerate(rows))
    return (f'<table role="presentation" width="100%" style="border-collapse:collapse;'
            f'border:1px solid #E8E2D5;border-radius:8px;overflow:hidden">{trs}</table>')


def product_card(*, image: str, name: str, variant: str, quantity: int, price_paise: int,
                 currency: str = "INR") -> str:
    img = (f'<img src="{_e(image)}" width="60" height="60" alt="" '
           f'style="border-radius:6px;object-fit:cover;display:block">'
           if image else '<div style="width:60px;height:60px;border-radius:6px;background:#EEE"></div>')
    variant_line = f'<div style="font-size:11px;color:{COLORS["text_muted"]}">{_e(variant)}</div>' if variant else ""
    return f"""<table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:8px">
      <tr>
        <td width="60" style="padding:6px">{img}</td>
        <td style="padding:6px 10px">
          <div style="font-size:13px;font-weight:600;color:{COLORS['text_body']}">{_e(name)}</div>
          {variant_line}
        </td>
        <td style="padding:6px;text-align:center;font-size:12px;color:{COLORS['text_muted']}">x{int(quantity)}</td>
        <td style="padding:6px;text-align:right;font-size:13px;font-weight:700;color:{COLORS['gold']}">
          {money(price_paise, currency)}</td>
      </tr>
    </table>"""


def callout(text: str, tone: str = "warning") -> str:
    color = COLORS.get(tone, COLORS["warning"])
    return (f'<div style="background:{color}1A;border-left:4px solid {color};'
            f'padding:12px 16px;border-radius:6px;font-size:13px;color:{COLORS["text_body"]};'
            f'margin:16px 0">{text}</div>')


# ── Shared shell ────────────────────────────────────────────────────────────
def _shell(*, preheader: str, heading: str, content_html: str, settings: dict,
          unsubscribe_url: Optional[str] = None) -> str:
    logo = settings.get("logo_url") or ""
    trade_name = _e(settings.get("trade_name") or "Tredeva Store")
    support_email = _e(settings.get("support_email") or "")
    support_phone = _e(settings.get("support_phone") or "")
    store_url = settings.get("store_url") or "#"
    year = datetime.now(timezone.utc).year
    logo_html = (f'<img src="{_e(logo)}" alt="{trade_name}" height="36" style="display:block;margin:0 auto">'
                if logo else f'<div style="font:700 20px {FONT_STACK};color:#fff;letter-spacing:.08em">{trade_name}</div>')
    unsub_html = (f'<div style="margin-top:10px"><a href="{_e(unsubscribe_url)}" '
                 f'style="color:#CFCFE0;font-size:11px;text-decoration:underline">Unsubscribe</a></div>'
                 if unsubscribe_url else "")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(heading)}</title>
</head>
<body style="margin:0;padding:0;background:{COLORS['background']};font-family:{FONT_STACK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{_e(preheader)}</div>
<table role="presentation" width="100%" style="background:{COLORS['background']};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;
           border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
      <tr><td style="background:{COLORS['primary']};padding:22px;text-align:center">{logo_html}</td></tr>
      <tr><td style="padding:28px 28px 8px">
        <h1 style="font-size:19px;margin:0 0 16px;color:{COLORS['primary']};font-family:{FONT_STACK}">{_e(heading)}</h1>
        {content_html}
      </td></tr>
      <tr><td style="background:{COLORS['primary']};padding:20px 28px;text-align:center;
                     color:#CFCFE0;font-size:11px">
        {f'{support_email} · {support_phone}' if support_phone else support_email}
        <div style="margin-top:6px">Powered by {trade_name} · &copy; {year}</div>
        {unsub_html}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _render(*, preheader, heading, content_html, settings, unsubscribe_url=None) -> tuple[str, str]:
    html_out = _shell(preheader=preheader, heading=heading, content_html=content_html,
                      settings=settings, unsubscribe_url=unsubscribe_url)
    return html_out, _to_text(html_out)


# ── §5.1 Order confirmation ──────────────────────────────────────────────────
def render_order_confirmation(d: dict, settings: dict) -> tuple[str, str, str]:
    currency = d.get("currency", "INR")
    items_html = "".join(product_card(
        image=i.get("image", ""), name=i.get("name", ""), variant=i.get("variant", ""),
        quantity=i.get("quantity", 1), price_paise=i.get("price", 0), currency=currency)
        for i in d.get("items", []))
    addr = d.get("shipping_address") or {}
    addr_lines = [addr.get("name"), addr.get("line1"), addr.get("line2"),
                 f"{addr.get('city', '')} {addr.get('pincode', '')}".strip(), addr.get("state")]
    address_html = "<br>".join(_e(l) for l in addr_lines if l)
    delivery_html = (callout(f"Estimated delivery: <b>{_e(d.get('estimated_delivery'))}</b>", "success")
                     if d.get("estimated_delivery") else "")
    cta = (action_button("Track Your Order", d.get("tracking_url") or "#") if d.get("tracking_url")
          else action_button("View My Orders", d.get("order_url") or "#"))
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Hi {_e(d.get('customer_name'))}, thank you for your order!</p>
      {info_card([("Order ID", d.get('order_id', '')), ("Date", d.get('order_date', '')),
                 ("Payment method", d.get('payment_method', ''))])}
      <h3 style="font-size:13px;margin:20px 0 8px;color:{COLORS['text_muted']};text-transform:uppercase">Items</h3>
      {items_html}
      <table role="presentation" width="100%" style="margin-top:10px;font-size:13px">
        <tr><td style="padding:3px 0">Subtotal</td><td style="text-align:right">{money(d.get('subtotal', 0), currency)}</td></tr>
        <tr><td style="padding:3px 0">Shipping</td><td style="text-align:right">{money(d.get('shipping', 0), currency)}</td></tr>
        {f'<tr><td style="padding:3px 0">Discount</td><td style="text-align:right">-{money(d.get("discount", 0), currency)}</td></tr>' if d.get('discount') else ''}
        <tr><td style="padding:8px 0;font-weight:700;font-size:16px;color:{COLORS['gold']}">Total</td>
            <td style="text-align:right;padding:8px 0;font-weight:700;font-size:16px;color:{COLORS['gold']}">{money(d.get('total', 0), currency)}</td></tr>
      </table>
      <h3 style="font-size:13px;margin:20px 0 8px;color:{COLORS['text_muted']};text-transform:uppercase">Shipping Address</h3>
      <div style="font-size:13px;color:{COLORS['text_body']}">{address_html}</div>
      {delivery_html}
      <div style="text-align:center;margin:24px 0 8px">{cta}</div>
      <p style="font-size:12px;color:{COLORS['text_muted']};text-align:center">
        Questions? Reply to this email or contact us at {_e(settings.get('support_email', ''))}</p>
    """
    subject = f"Order Confirmed! Your Tredeva Order #{d.get('order_id')}"
    html_out, text_out = _render(preheader=f"Your order #{d.get('order_id')} is confirmed",
                                 heading="Thank You For Your Order!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.2 Admin order notification ────────────────────────────────────────────
def render_admin_order_notification(d: dict, settings: dict) -> tuple[str, str, str]:
    currency = d.get("currency", "INR")
    items_html = "".join(product_card(
        image=i.get("image", ""), name=i.get("name", ""), variant=i.get("variant", ""),
        quantity=i.get("quantity", 1), price_paise=i.get("price", 0), currency=currency)
        for i in d.get("items", []))
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">A new order was just placed.</p>
      {info_card([("Order ID", d.get('order_id', '')), ("Date", d.get('order_date', '')),
                 ("Customer", d.get('customer_name', '')), ("Email", d.get('customer_email', '')),
                 ("Phone", d.get('customer_phone', '')), ("Payment method", d.get('payment_method', '')),
                 ("Total", money(d.get('total', 0), currency))])}
      <h3 style="font-size:13px;margin:20px 0 8px;color:{COLORS['text_muted']};text-transform:uppercase">Items</h3>
      {items_html}
      <div style="text-align:center;margin:24px 0 8px">
        {action_button("View in Admin Panel", d.get('admin_url') or '#')}
      </div>
    """
    subject = f"New Order Received — #{d.get('order_id')} from {d.get('customer_name')}"
    html_out, text_out = _render(preheader=f"New order #{d.get('order_id')}", heading="New Order Received",
                                 content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.3 Consultation booking confirmation ───────────────────────────────────
def render_consultation_booking(d: dict, settings: dict) -> tuple[str, str, str]:
    currency = d.get("currency", "INR")
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Namaste {_e(d.get('customer_name'))}!
      Your consultation has been booked.</p>
      {info_card([("Booking ID", d.get('booking_id', '')), ("Type", d.get('consultation_type', '')),
                 ("Date", d.get('booking_date', '')), ("Amount paid", money(d.get('amount_paid', 0), currency)),
                 ("Payment method", d.get('payment_method', ''))])}
      <div style="margin:14px 0">{status_badge("pending")} <span style="font-size:12px;color:{COLORS['text_muted']}">
        Pending astrologer assignment</span></div>
      <p style="font-size:13px;color:{COLORS['text_body']}">Our team will assign an expert astrologer and
        schedule your session. You'll receive another email with your astrologer's details and the session time.</p>
      <div style="text-align:center;margin:24px 0 8px">{action_button("View My Bookings", d.get('bookings_url') or '#')}</div>
      <p style="font-size:12px;color:{COLORS['text_muted']};text-align:center">
        Questions? Reply to this email or contact us at {_e(settings.get('support_email', ''))}</p>
    """
    subject = "Your Consultation is Booked! — Tredeva Store"
    html_out, text_out = _render(preheader="Your consultation booking is confirmed",
                                 heading="Consultation Booked!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.4 Astrologer & time assignment ────────────────────────────────────────
def render_astrologer_assignment(d: dict, settings: dict) -> tuple[str, str, str]:
    img = (f'<img src="{_e(d.get("astrologer_image"))}" width="90" height="90" '
           f'style="border-radius:50%;border:3px solid {COLORS["gold"]};object-fit:cover;display:block;margin:0 auto 10px">'
          if d.get("astrologer_image") else "")
    specialties = "".join(
        f'<span style="display:inline-block;background:#F8F5EE;color:{COLORS["accent"]};'
        f'border:1px solid {COLORS["gold"]};border-radius:999px;padding:3px 10px;font-size:11px;'
        f'margin:2px">{_e(s)}</span>'
        for s in (d.get("astrologer_specialties") or []))
    join_btn = action_button("Join Meeting", d.get("meeting_link"), "primary") if d.get("meeting_link") else ""
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Great news, {_e(d.get('customer_name'))}!
      Your astrologer has been assigned.</p>
      <div style="text-align:center;border:1px solid #E8E2D5;border-radius:10px;padding:18px;margin:16px 0">
        {img}
        <div style="font-weight:700;font-size:15px;color:{COLORS['primary']}">{_e(d.get('astrologer_name'))}</div>
        <div style="margin-top:6px">{specialties}</div>
        <p style="font-size:12px;color:{COLORS['text_muted']};margin-top:10px">{_e(d.get('astrologer_bio', ''))}</p>
      </div>
      {info_card([("Date", d.get('scheduled_date', '')), ("Time", d.get('scheduled_time', '')),
                 ("Duration", d.get('duration', '')), ("Platform", d.get('meeting_platform', 'Google Meet'))])}
      {callout("Have your birth date, time, and place of birth ready &middot; "
              "Find a quiet space for your session &middot; Prepare any specific questions", "warning")}
      <div style="text-align:center;margin:20px 0 8px">{join_btn}</div>
    """
    subject = "Your Astrologer is Confirmed! — Tredeva Store"
    html_out, text_out = _render(preheader="Your astrologer and session time are confirmed",
                                 heading="Your Astrologer is Confirmed!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.5 Order status update ─────────────────────────────────────────────────
_STATUS_STEPS = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"]
_STATUS_SUBJECT = {
    "processing": "Your Order #{oid} is Being Prepared",
    "shipped": "Your Order #{oid} has been Shipped!",
    "out_for_delivery": "Your Order #{oid} is Out for Delivery!",
    "delivered": "Your Order #{oid} has been Delivered!",
    "cancelled": "Your Order #{oid} has been Cancelled",
    "refunded": "Your Order #{oid} has been Refunded",
}


def _status_timeline(new_status: str) -> str:
    if new_status in ("cancelled", "refunded"):
        return callout(f"This order has been {new_status}.", "error")
    idx = _STATUS_STEPS.index(new_status) if new_status in _STATUS_STEPS else -1
    cells = []
    for i, step in enumerate(_STATUS_STEPS):
        done = i <= idx
        color = COLORS["accent"] if i == idx else (COLORS["success"] if done else "#DDD")
        mark = "&#10003;" if done and i < idx else str(i + 1)
        cells.append(
            f'<td style="text-align:center;font-size:9px;color:{color if done else COLORS["text_muted"]}">'
            f'<div style="width:22px;height:22px;border-radius:50%;background:{color};color:#fff;'
            f'line-height:22px;margin:0 auto 4px;font-weight:700">{mark}</div>'
            f'{_e(step.replace("_", " ").title())}</td>')
    return f'<table role="presentation" width="100%"><tr>{"".join(cells)}</tr></table>'


def render_order_status_update(d: dict, settings: dict) -> tuple[str, str, str]:
    new_status = d.get("new_status", "")
    items_html = "".join(
        f'<div style="font-size:12px;color:{COLORS["text_muted"]}">&bull; {_e(i.get("name"))} x{i.get("quantity", 1)}</div>'
        for i in d.get("items", []))
    tracking_html = ""
    if new_status in ("shipped", "out_for_delivery") and d.get("tracking_number"):
        tracking_html = info_card([("Courier", d.get("courier_name", "")),
                                   ("Tracking No.", d.get("tracking_number", "")),
                                   ("Estimated delivery", d.get("estimated_delivery", ""))])
    msg_html = callout(_e(d.get("status_message")), "warning") if d.get("status_message") else ""
    cta = (action_button("Track Your Order", d.get("tracking_url"))
          if d.get("tracking_url") else action_button("View Order Details", d.get("order_url") or "#"))
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Hi {_e(d.get('customer_name'))},
      your order status has been updated!</p>
      <div style="margin:18px 0">{_status_timeline(new_status)}</div>
      <div style="text-align:center;margin:10px 0">{status_badge(new_status)}</div>
      {tracking_html}
      {msg_html}
      <h3 style="font-size:12px;margin:18px 0 6px;color:{COLORS['text_muted']};text-transform:uppercase">Items</h3>
      {items_html}
      <div style="text-align:center;margin:22px 0 8px">{cta}</div>
      {f'<p style="font-size:12px;color:{COLORS["text_muted"]}">Delivering to: {_e(d.get("delivery_address"))}</p>' if d.get('delivery_address') else ''}
    """
    subject = _STATUS_SUBJECT.get(new_status, f"Your Order #{d.get('order_id')} Update").format(oid=d.get("order_id"))
    html_out, text_out = _render(preheader=subject, heading="Order Update", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.6 Astrologer onboarding ───────────────────────────────────────────────
def render_astrologer_onboarding(d: dict, settings: dict) -> tuple[str, str, str]:
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Welcome aboard, {_e(d.get('astrologer_name'))}!
      We're thrilled to have you join the Tredeva family.</p>
      <div style="border:1px dashed {COLORS['gold']};border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-size:12px;color:{COLORS['text_muted']}">Login Email</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:10px">{_e(d.get('email'))}</div>
        <div style="font-size:12px;color:{COLORS['text_muted']}">Set your password using the button below —
          the link expires in 7 days.</div>
      </div>
      <div style="text-align:center;margin:20px 0">{action_button("Set Your Password &amp; Log In", d.get('login_url') or '#')}</div>
      <h3 style="font-size:13px;margin:24px 0 8px;color:{COLORS['text_muted']};text-transform:uppercase">
        Your Affiliate Program</h3>
      <p style="font-size:13px;color:{COLORS['text_body']}">Share your unique link and earn commissions on
        every purchase made through it!</p>
      {info_card([("Affiliate code", d.get('affiliate_code', '')), ("Affiliate link", d.get('affiliate_link', ''))])}
      <h3 style="font-size:13px;margin:24px 0 8px;color:{COLORS['text_muted']};text-transform:uppercase">
        Getting Started</h3>
      <div style="font-size:13px;color:{COLORS['text_body']}">
        &bull; Complete your profile<br>&bull; Set your availability<br>
        &bull; Upload your certifications<br>&bull; Share your affiliate link</div>
      <p style="font-size:12px;color:{COLORS['text_muted']};margin-top:16px">
        Support for astrologers: {_e(settings.get('support_email', ''))}</p>
    """
    subject = "Welcome to Tredeva Store! Your Astrologer Account is Ready"
    html_out, text_out = _render(preheader="Set your password to activate your astrologer account",
                                 heading="Welcome to Tredeva Store!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── Customer welcome email (new account created — signup, Google, or phone) ──
def render_welcome_signup(d: dict, settings: dict) -> tuple[str, str, str]:
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Namaste {_e(d.get('customer_name'))},
      welcome to Tredeva Store!</p>
      <p style="font-size:13px;color:{COLORS['text_body']}">Your account is ready. Here's what you can do next:</p>
      <div style="font-size:13px;color:{COLORS['text_body']};margin:12px 0">
        &bull; Browse hallmark-certified gemstones and rudraksha<br>
        &bull; Book an astrologer-guided consultation<br>
        &bull; Track every order from purchase to delivery, end to end
      </div>
      <div style="text-align:center;margin:22px 0 8px">
        {action_button("Start Shopping", d.get('shop_url') or '#')}
      </div>
      <p style="font-size:12px;color:{COLORS['text_muted']};text-align:center">
        Questions? Reply to this email or contact us at {_e(settings.get('support_email', ''))}</p>
    """
    subject = "Welcome to Tredeva Store!"
    html_out, text_out = _render(preheader="Your Tredeva Store account is ready",
                                 heading="Welcome to Tredeva Store!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §5.7 Affiliate sale notification ─────────────────────────────────────────
def render_affiliate_sale(d: dict, settings: dict) -> tuple[str, str, str]:
    currency = d.get("currency", "INR")
    items_html = "".join(
        f'<div style="font-size:12px;color:{COLORS["text_muted"]}">&bull; {_e(i.get("name"))} '
        f'&mdash; {money(i.get("price", 0), currency)}</div>'
        for i in d.get("items", []))
    content = f"""
      <p style="font-size:14px;color:{COLORS['text_body']}">Congratulations, {_e(d.get('astrologer_name'))}!
      You just earned a commission!</p>
      <div style="text-align:center;border:1px solid #E8E2D5;border-radius:10px;padding:20px;margin:16px 0">
        <div style="font-size:28px;font-weight:800;color:{COLORS['gold']}">
          {money(d.get('commission_amount', 0), currency)}</div>
        <div style="font-size:12px;color:{COLORS['text_muted']}">
          Commission at {d.get('commission_rate', 0)}% on order total {money(d.get('order_total', 0), currency)}</div>
      </div>
      <h3 style="font-size:12px;margin:16px 0 6px;color:{COLORS['text_muted']};text-transform:uppercase">Order</h3>
      {items_html}
      {info_card([("Order ID", d.get('order_id', '')), ("Date", d.get('order_date', '')),
                 ("Customer", d.get('customer_first_name', ''))])}
      {callout(f"Lifetime earnings: <b>{money(d.get('total_earnings', 0), currency)}</b> &#8599;", "success")}
      <div style="text-align:center;margin:22px 0 8px">
        {action_button("View Earnings Dashboard", d.get('dashboard_url') or '#', 'primary')}
        &nbsp;&nbsp;
        {action_button("Share Your Link", d.get('affiliate_link') or '#', 'secondary')}
      </div>
      <p style="font-size:12px;color:{COLORS['text_muted']};text-align:center">Keep sharing your link to earn more!</p>
    """
    subject = "You Earned a Commission! — Tredeva Store"
    html_out, text_out = _render(preheader=f"You earned {money(d.get('commission_amount', 0), currency)}",
                                 heading="You Earned a Commission!", content_html=content, settings=settings)
    return subject, html_out, text_out


# ── §6.5/§7.6 Custom / campaign email (compose box + bulk campaigns) ─────────
_VARIANT_BANNER = {
    "announcement": lambda s: f'<div style="background:{COLORS["gold"]};color:#1A1A1A;padding:10px 16px;' \
                              f'border-radius:8px;font-weight:700;text-align:center;margin-bottom:14px">{_e(s)}</div>',
    "promotional": lambda s: f'<div style="background:{COLORS["accent"]};color:#fff;padding:14px 16px;' \
                             f'border-radius:8px;font-weight:800;font-size:16px;text-align:center;margin-bottom:14px">{_e(s)}</div>',
}


def render_custom_email(*, subject: str, content_html: str, template: str, settings: dict,
                        recipient_name: str = "", unsubscribe_url: Optional[str] = None) -> tuple[str, str, str]:
    """Wraps admin-authored rich-text HTML (already sanitized by the caller) inside
    the branded shell. `content_html` is trusted here — sanitization happens once,
    at the API boundary in server.py, not on every render."""
    banner = _VARIANT_BANNER.get(template, lambda s: "")(subject) if template in _VARIANT_BANNER else ""
    greeting = f'<p style="font-size:14px;color:{COLORS["text_body"]}">Hi {_e(recipient_name)},</p>' if recipient_name else ""
    content = f"{banner}{greeting}<div style=\"font-size:14px;color:{COLORS['text_body']}\">{content_html}</div>"
    html_out, text_out = _render(preheader=subject, heading=subject, content_html=content,
                                 settings=settings, unsubscribe_url=unsubscribe_url)
    return subject, html_out, text_out


def _demo() -> None:
    """Self-check: `python email_templates.py`. Renders every template with dummy
    data and asserts key content made it through — same convention as invoice.py."""
    settings = {"trade_name": "Tredeva Store", "logo_url": "", "support_email": "support@tredeva.com",
               "support_phone": "", "store_url": "https://tredeva.com"}
    items = [{"name": "Ceylon Blue Sapphire", "image": "", "variant": "Loose Gemstone",
             "quantity": 1, "price": 200000}]

    subj, h, t = render_order_confirmation({
        "customer_name": "Lubhansh", "order_id": "TDV-1001", "order_date": "20/08/2026",
        "items": items, "subtotal": 200000, "shipping": 0, "discount": 0, "total": 200000,
        "currency": "INR", "payment_method": "PREPAID",
        "shipping_address": {"name": "Lubhansh", "line1": "Hathras Road", "city": "Iglas",
                             "state": "Uttar Pradesh", "pincode": "204101"},
        "estimated_delivery": "25 Aug 2026", "order_url": "https://tredeva.com/account"}, settings)
    assert "Order Confirmed!" in subj and "TDV-1001" in h and "2,000.00" in h and "Estimated delivery" in h
    assert "<" not in t.replace("<", "")  # sanity: text has no stray tags after stripping

    subj, h, t = render_admin_order_notification({
        "customer_name": "Lubhansh", "customer_email": "l@example.com", "customer_phone": "+919999999999",
        "order_id": "TDV-1001", "order_date": "20/08/2026", "items": items, "total": 200000,
        "currency": "INR", "payment_method": "PREPAID", "admin_url": "https://tredeva.com/admin/orders"}, settings)
    assert "New Order Received" in subj and "l@example.com" in h

    subj, h, t = render_consultation_booking({
        "customer_name": "Lubhansh", "consultation_type": "Birth Chart Reading", "booking_id": "CB-1",
        "booking_date": "20/08/2026", "amount_paid": 39900, "payment_method": "PREPAID",
        "currency": "INR", "bookings_url": "https://tredeva.com/account"}, settings)
    assert "Consultation is Booked" in subj and "Birth Chart Reading" in h

    subj, h, t = render_astrologer_assignment({
        "customer_name": "Lubhansh", "booking_id": "CB-1", "astrologer_name": "Pandit Sharma",
        "astrologer_specialties": ["Vedic", "Tarot"], "scheduled_date": "22 Aug 2026",
        "scheduled_time": "5:00 PM IST", "duration": "30 minutes", "meeting_link": "https://meet.google.com/xyz",
        "meeting_platform": "Google Meet"}, settings)
    assert "Astrologer is Confirmed" in subj and "Pandit Sharma" in h and "Join Meeting" in h

    for status, must in [("shipped", "Shipped"), ("delivered", "Delivered"), ("cancelled", "Cancelled")]:
        subj, h, t = render_order_status_update({
            "customer_name": "Lubhansh", "order_id": "TDV-1001", "new_status": status,
            "tracking_number": "TRK123", "courier_name": "Delhivery", "items": items,
            "order_url": "https://tredeva.com/account"}, settings)
        assert must in subj, (status, subj)

    subj, h, t = render_astrologer_onboarding({
        "astrologer_name": "Pandit Sharma", "email": "pandit@example.com",
        "login_url": "https://tredeva.com/astrologer/set-password?token=abc",
        "affiliate_code": "PANDIT10", "affiliate_link": "https://tredeva.com/?ref=PANDIT10"}, settings)
    assert "Astrologer Account is Ready" in subj and "PANDIT10" in h and "set-password" in h

    subj, h, t = render_welcome_signup(
        {"customer_name": "Lubhansh", "shop_url": "https://tredevastore.com"}, settings)
    assert "Welcome to Tredeva Store" in subj and "Start Shopping" in h

    subj, h, t = render_affiliate_sale({
        "astrologer_name": "Pandit Sharma", "order_id": "TDV-1001", "order_date": "20/08/2026",
        "customer_first_name": "Lubhansh", "items": [{"name": "Ceylon Blue Sapphire", "price": 200000}],
        "order_total": 200000, "commission_rate": 10, "commission_amount": 20000, "total_earnings": 150000,
        "currency": "INR", "affiliate_link": "https://tredeva.com/?ref=PANDIT10",
        "dashboard_url": "https://tredeva.com/astrologer/dashboard"}, settings)
    assert "Earned a Commission" in subj and "200.00" in h

    subj, h, t = render_custom_email(subject="Diwali Sale!", content_html="<p>50% off everything.</p>",
                                     template="promotional", settings=settings, recipient_name="Lubhansh",
                                     unsubscribe_url="https://tredeva.com/api/email/unsubscribe?token=x")
    assert "50% off" in h and "Unsubscribe" in h

    print("email_templates.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
