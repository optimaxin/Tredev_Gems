"""GST tax invoice generation — see .claude/invoice.md.

Split of responsibility:
  gst.py      pure tax maths, no I/O (§5)
  invoice.py  numbering, persistence, HTML rendering (§4, §7, §8)
  server.py   endpoints + the 'delivered' trigger

Invoices are rendered as print-styled HTML rather than a server-side PDF: the
backend runs on a 512MB Render instance where a headless Chromium or WeasyPrint
install is a reliability risk, and the browser's own print-to-PDF produces the
same A4 document. The template is written to @media print rules so "Save as PDF"
gives a clean page.
# ponytail: HTML + browser print instead of a stored PDF. Move to WeasyPrint if
# invoices ever need to be emailed as attachments (§9.3 step 9).
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from jinja2 import Environment, select_autoescape

import db
import gst

log = logging.getLogger("gemora")

TEMPLATE_VERSION = "v1"

# Supplier master data (§2). Overridable per-deployment from the admin panel —
# server.py merges the stored site_content['invoice_settings'] block over this.
# Every value here is a DEFAULT, never the source of truth for an issued invoice:
# each invoice freezes its own copy at issue time (§7.4).
DEFAULT_SETTINGS: dict = {
    "legal_name": "Optimaxin Software Solutions Private Limited",
    "trade_name": "Tredev Gems",
    "gstin": "09AAECO5418P1ZV",
    "pan": "AAECO5418P",
    "cin": "",
    "address_lines": ["Iglas Road, Hathras", "Hathras - 204101",
                      "Uttar Pradesh (09), India"],
    "state_code": "09",
    "support_email": "support@optimaxin.com",
    "support_phone": "",
    "store_url": "https://tredevastore.com",
    "company_url": "https://optimaxin.com",
    "signatory_name": "Lubhansh Sharma",
    "signatory_designation": "Authorised Signatory",
    "logo_url": "",
    "signature_url": "",
    "invoice_prefix": "TRE",
    "footer_line": ("Tredev Gems is a brand of Optimaxin Software Solutions "
                    "Private Limited · optimaxin.com"),
    "declarations": [
        "This is a computer generated invoice.",
        "Tax is payable on reverse charge basis: No",
        "The information provided in this invoice is true and correct to the best "
        "of the seller's knowledge.",
        "ITC Available: Yes",
        "For T&C please refer to the Terms page on our store.",
        "Certificates, where applicable, are supplied with the product.",
    ],
    # Export invoices are zero-rated under the IGST Act. Whether that is under a
    # LUT (no IGST paid) or with IGST paid-and-refunded is a registration fact the
    # owner must supply — printed verbatim on export invoices.
    "export_declaration": ("Supply meant for export — zero-rated under the IGST "
                           "Act. Not liable to Indian GST."),
}


class InvoiceBlocked(Exception):
    """Validation failed, so NO number was allocated (§4.3 gapless rule). The
    message is shown to the admin so they can fix the underlying data."""


def fy_code(when: datetime) -> str:
    """Indian financial year runs Apr-Mar: 15 Aug 2026 -> '2627' (FY 2026-27)."""
    year = when.year if when.month >= 4 else when.year - 1
    return f"{str(year)[2:]}{str(year + 1)[2:]}"


def _format_number(prefix: str, fy: str, seq: int) -> str:
    """'TRE/2627/000123' — 15 chars, inside the statutory 16-char cap (§4.1)."""
    number = f"{prefix}/{fy}/{seq:06d}"
    if len(number) > 16:
        raise InvoiceBlocked(
            f"Invoice number '{number}' exceeds the 16-character legal limit — "
            f"shorten the invoice prefix (currently '{prefix}').")
    return number


async def _next_sequence(conn, document_type: str, fy: str) -> int:
    """Atomic allocation inside the caller's transaction. An UPDATE..RETURNING on
    a single counter row serialises concurrent callers at the row lock — never
    MAX(seq)+1, which races and produces duplicates under load (§4.3)."""
    await conn.execute(
        """INSERT INTO tax_invoice_sequences (document_type, fy_code, last_sequence)
           VALUES ($1,$2,0) ON CONFLICT DO NOTHING""", document_type, fy)
    return await conn.fetchval(
        """UPDATE tax_invoice_sequences SET last_sequence = last_sequence + 1
            WHERE document_type = $1 AND fy_code = $2
        RETURNING last_sequence""", document_type, fy)


def _idempotency_key(document_type: str, order_id: str, revision: int = 0) -> str:
    return hashlib.sha256(
        f"{document_type}|{order_id}|{revision}".encode()).hexdigest()


# ── generation ───────────────────────────────────────────────────────────────
async def _prepare_invoice(order_id: str, settings: dict) -> dict:
    """All the reads, validation and tax computation, shared by preview_for_order
    and generate_for_order. Raises InvoiceBlocked only for problems no amount of
    review can fix (missing HSN, an address that won't resolve to a GST state, a
    malformed GSTIN) — the §5.4 reconciliation check is deliberately NOT one of
    these: it's returned as data (`mismatch_paise`) so a human can look at it and
    decide, rather than a wall generate_for_order always hits."""
    order = await db.fetch_one(
        """SELECT o.id::text AS order_id, o.order_no, o.currency, o.subtotal,
                  o.discount_total, o.tax_total, o.shipping_total, o.grand_total,
                  o.buyer_gstin, o.buyer_legal_name, o.user_id::text AS user_id,
                  a.recipient_name, a.phone, a.line1, a.line2, a.city, a.state,
                  a.pincode, a.country, a.email_snapshot::text AS email,
                  u.full_name AS user_name,
                  pay.gateway_payment_id AS payment_ref
             FROM orders o
             LEFT JOIN addresses a ON a.id = o.shipping_address_id
             LEFT JOIN users u ON u.id = o.user_id
             LEFT JOIN LATERAL (
                   SELECT gateway_payment_id FROM payments
                    WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) pay ON true
            WHERE o.id = $1::uuid""", order_id)
    if not order:
        raise InvoiceBlocked("Order not found")

    items = await db.fetch_all(
        """SELECT oi.id::text AS line_id, oi.product_id::text AS product_id,
                  oi.qty, oi.unit_price, oi.title_snapshot, oi.selected_options,
                  p.hsn_code, p.gst_rate_bp, p.uqc, p.attributes, p.title,
                  p.title_devanagari,
                  (SELECT array_agg(pu.serial_no ORDER BY pu.serial_no)
                     FROM product_units pu WHERE pu.sold_order_item_id = oi.id) AS serials
             FROM order_items oi JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1::uuid ORDER BY oi.created_at""", order_id)
    if not items:
        raise InvoiceBlocked("Order has no line items")

    currency = (order["currency"] or "INR").strip().upper()
    is_export = currency != "INR"

    # §9.3 step 2 — validate BEFORE any number is allocated.
    missing = [i["title"] for i in items
               if not i["hsn_code"] or i["gst_rate_bp"] is None or not i["uqc"]]
    if missing:
        raise InvoiceBlocked(
            "These products have no HSN code / GST rate / UQC set: "
            + ", ".join(sorted(set(missing)))
            + ". Set them under Admin → Products before invoicing.")

    place_code = None
    if not is_export:
        place_code = gst.state_code_for(order["state"])
        if not place_code:
            raise InvoiceBlocked(
                f"Could not resolve the delivery state '{order['state']}' to a GST "
                f"state code. Fix the order's shipping address before invoicing.")

    buyer_gstin = (order["buyer_gstin"] or "").strip().upper() or None
    if buyer_gstin and not gst.valid_gstin(buyer_gstin):
        raise InvoiceBlocked(f"Buyer GSTIN '{buyer_gstin}' is not valid.")

    # Current checkout stores listed prices as GST-inclusive and always writes
    # tax_total = 0 (server.py's checkout()). Some older orders instead added tax
    # on top of the price (a real, nonzero tax_total) — for those the invoice has
    # to mirror what was actually charged, so the model is read off each order's
    # own record rather than assumed globally.
    tax_total_paise = db.to_paise(order["tax_total"]) or 0
    prices_include_tax = tax_total_paise == 0

    supplier_state = (settings.get("state_code") or "09").strip()
    computed = gst.compute_invoice(
        [{"line_id": i["line_id"], "product_id": i["product_id"],
          "description": i["title_snapshot"] or i["title"],
          "devanagari": i["title_devanagari"] or "",
          "attributes": _line_attributes(i),
          "hsn_code": i["hsn_code"], "uqc": i["uqc"],
          "qty": i["qty"],
          "unit_price_paise": db.to_paise(i["unit_price"]) or 0,
          "gst_rate_bp": i["gst_rate_bp"]}
         for i in items],
        supplier_state_code=supplier_state,
        place_of_supply_code=place_code,
        order_discount_paise=db.to_paise(order["discount_total"]) or 0,
        shipping_paise=db.to_paise(order["shipping_total"]) or 0,
        is_export=is_export,
        prices_include_tax=prices_include_tax,
    )

    charged = db.to_paise(order["grand_total"]) or 0
    return {
        "order": order, "computed": computed, "currency": currency,
        "is_export": is_export, "place_code": place_code, "buyer_gstin": buyer_gstin,
        "charged_paise": charged,
        "mismatch_paise": computed["grand_total_paise"] - charged,
    }


async def preview_for_order(order_id: str, settings: dict) -> dict:
    """Read-only: what the invoice WOULD look like, without allocating a number or
    writing anything. Lets an admin review a would-be mismatch before deciding
    whether to force-issue it."""
    pre = await _prepare_invoice(order_id, settings)
    computed = pre["computed"]
    return {
        "order_no": pre["order"]["order_no"], "currency": pre["currency"],
        "lines": computed["lines"], "supply_type": computed["supply_type"],
        "place_of_supply_name": computed["place_of_supply_name"],
        "total_taxable_paise": computed["total_taxable_paise"],
        "total_cgst_paise": computed["total_cgst_paise"],
        "total_sgst_paise": computed["total_sgst_paise"],
        "total_igst_paise": computed["total_igst_paise"],
        "round_off_paise": computed["round_off_paise"],
        "computed_grand_total_paise": computed["grand_total_paise"],
        "charged_paise": pre["charged_paise"],
        "mismatch_paise": pre["mismatch_paise"],
        "will_block": pre["mismatch_paise"] != 0,
    }


async def generate_for_order(order_id: str, settings: dict, *, force: bool = False) -> dict:
    """Issue the tax invoice for a delivered order. Idempotent: if one already
    exists it is returned untouched, so a re-marked-delivered order or a retried
    call never mints a second document.

    `force=True` bypasses ONLY the §5.4 reconciliation check, and only after
    absorbing the residual into round-off so the printed total still equals the
    money actually collected — the one invariant that stays non-negotiable even
    when forced. It never bypasses the missing-data blocks in _prepare_invoice;
    those need the underlying order/product data fixed, not an override."""
    existing = await db.fetch_one(
        "SELECT * FROM tax_invoices WHERE order_id = $1::uuid AND status = 'issued'"
        " ORDER BY created_at LIMIT 1", order_id)
    if existing:
        return dict(existing)

    pre = await _prepare_invoice(order_id, settings)
    order = pre["order"]
    computed = pre["computed"]

    if pre["mismatch_paise"] != 0:
        if not force:
            raise InvoiceBlocked(
                f"Invoice total ({computed['grand_total_paise'] / 100:.2f}) does not "
                f"match the amount charged ({pre['charged_paise'] / 100:.2f}). Not "
                f"issuing — review the breakdown, then re-issue with 'force' once "
                f"you've confirmed the total.")
        computed["round_off_paise"] -= pre["mismatch_paise"]
        computed["grand_total_paise"] = pre["charged_paise"]
        log.warning("invoice for order %s force-issued with a %.2f mismatch absorbed "
                    "into round-off", order_id, pre["mismatch_paise"] / 100)

    currency = pre["currency"]
    place_code, buyer_gstin = pre["place_code"], pre["buyer_gstin"]

    now = datetime.now(timezone.utc)
    fy = fy_code(now)
    prefix = (settings.get("invoice_prefix") or "TRE").strip().upper()
    billing = {
        "name": order["buyer_legal_name"] or order["recipient_name"] or order["user_name"] or "",
        "line1": order["line1"] or "", "line2": order["line2"] or "",
        "city": order["city"] or "", "state": order["state"] or "",
        "pincode": order["pincode"] or "", "country": (order["country"] or "IN").strip(),
        "phone": order["phone"] or "", "email": order["email"] or "",
    }
    invoice_id = uuid.uuid4()

    async with db.transaction() as tx:
        seq = await _next_sequence(tx, "tax_invoice", fy)
        number = _format_number(prefix, fy, seq)
        await tx.execute(
            """INSERT INTO tax_invoices (
                   id, document_type, invoice_number, fy_code, sequence, issued_at,
                   order_id, idempotency_key, supplier_json, buyer_name, buyer_gstin,
                   buyer_billing_json, buyer_shipping_json, place_of_supply_code,
                   place_of_supply_name, supply_type, b2b_or_b2c, total_gross_paise,
                   total_discount_paise, total_taxable_paise, total_cgst_paise,
                   total_sgst_paise, total_igst_paise, shipping_paise,
                   round_off_paise, grand_total_paise, currency, amount_in_words,
                   payment_method, payment_reference, status, template_version)
               VALUES ($1,'tax_invoice',$2,$3,$4,$5,$6::uuid,$7,$8::jsonb,$9,$10,
                       $11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                       $22,$23,$24,$25,$26,$27,$28,$29,'issued',$30)""",
            invoice_id, number, fy, seq, now, order_id,
            _idempotency_key("tax_invoice", order_id),
            json.dumps(settings), billing["name"], buyer_gstin,
            json.dumps(billing), json.dumps(billing),
            place_code, computed["place_of_supply_name"], computed["supply_type"],
            "b2b" if buyer_gstin else "b2c",
            computed["total_gross_paise"], computed["total_discount_paise"],
            computed["total_taxable_paise"], computed["total_cgst_paise"],
            computed["total_sgst_paise"], computed["total_igst_paise"],
            computed["shipping_paise"], computed["round_off_paise"],
            computed["grand_total_paise"], currency,
            gst.amount_in_words(computed["grand_total_paise"], currency),
            "PREPAID", order["payment_ref"], TEMPLATE_VERSION)

        for n, li in enumerate(computed["lines"], start=1):
            await tx.execute(
                """INSERT INTO tax_invoice_line_items (
                       id, invoice_id, line_no, product_id, description,
                       attributes_json, hsn_code, quantity, uqc,
                       unit_price_excl_paise, gross_excl_paise, discount_paise,
                       taxable_paise, gst_rate_bp, cgst_paise, sgst_paise,
                       igst_paise, line_total_paise)
                   VALUES ($1,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7,$8,$9,$10,$11,
                           $12,$13,$14,$15,$16,$17,$18)""",
                uuid.uuid4(), invoice_id, n, li["product_id"], li["description"],
                json.dumps(li["attributes"]), li["hsn_code"], li["qty"], li["uqc"],
                li["unit_price_excl_paise"], li["gross_excl_paise"],
                li["discount_paise"], li["taxable_paise"], li["gst_rate_bp"],
                li["cgst_paise"], li["sgst_paise"], li["igst_paise"],
                li["line_total_paise"])

    log.info("invoice %s issued for order %s", number, order_id)
    return dict(await db.fetch_one(
        "SELECT * FROM tax_invoices WHERE id = $1::uuid", str(invoice_id)))


def _line_attributes(item: dict) -> dict:
    """Factual product attributes for the description block (§8.4).

    Deliberately whitelisted: a tax invoice is a legal record, so astrological /
    efficacy copy from the product's free-form attributes must never reach it.
    """
    attrs = item.get("attributes") or {}
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except (ValueError, TypeError):
            attrs = {}
    keep = ("weight_ratti", "weight_carat", "weight_grams", "mukhi", "bead_count",
            "bead_size_mm", "origin", "metal", "metal_purity",
            "certificate_authority", "certificate_no", "treatment", "energised",
            "energised_on")
    out = {k: attrs[k] for k in keep if attrs.get(k) not in (None, "", [])}
    opts = item.get("selected_options")
    if isinstance(opts, str):
        try:
            opts = json.loads(opts)
        except (ValueError, TypeError):
            opts = None
    if isinstance(opts, list):
        picks = [f"{o.get('label') or o.get('key')}: {o.get('value')}"
                 for o in opts if isinstance(o, dict) and o.get("value")]
        if picks:
            out["options"] = " | ".join(picks)
    if item.get("serials"):
        out["serial_no"] = ", ".join(item["serials"])
    return out


# ── rendering (§8) ───────────────────────────────────────────────────────────
def money(paise, currency: str = "INR") -> str:
    """Paise -> '1,889.00'. Indian digit grouping for INR; plain for anything else."""
    value = (int(paise or 0)) / 100
    whole, frac = f"{abs(value):.2f}".split(".")
    if currency == "INR" and len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    elif len(whole) > 3:
        whole = f"{int(whole):,}"
    return ("-" if value < 0 else "") + f"{whole}.{frac}"


_env = Environment(autoescape=select_autoescape(["html"]))
_env.filters["money"] = money

_TEMPLATE = _env.from_string(r"""
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{{ heading }} {{ inv.invoice_number }}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 12mm; }
  :root { --ink:#1A1A1A; --muted:#6B6B6B; --rule:#000; --light:#CCC; --brand:#7A1220; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:#F3F1EC; color:var(--ink);
         font:12px/1.45 'Inter','Noto Sans','Helvetica Neue',Arial,sans-serif;
         font-variant-numeric: tabular-nums; }
  .sheet { max-width:210mm; margin:0 auto; background:#fff; padding:14mm;
           border:1px solid var(--light); }
  .devanagari { font-family:'Noto Sans Devanagari','Nirmala UI',sans-serif; }
  h1 { font-size:15px; letter-spacing:.22em; text-align:center; margin:0;
       text-transform:uppercase; }
  .copy-label { text-align:center; font-size:9px; color:var(--muted); margin:2px 0 10px; }
  table { width:100%; border-collapse:collapse; }
  .grid, .grid td { border:1px solid var(--rule); }
  .grid td { padding:7px 8px; vertical-align:top; font-size:10px; }
  .lbl { color:var(--muted); font-size:8.5px; text-transform:uppercase;
         letter-spacing:.07em; display:block; }
  .val { font-weight:600; font-size:10.5px; }
  .items { margin-top:10px; font-size:9px; }
  .items th, .items td { border:1px solid var(--rule); padding:5px 6px; }
  .items thead th { background:#F5F2EC; font-size:8px; text-transform:uppercase;
                    letter-spacing:.05em; text-align:center; }
  .items tbody td { vertical-align:top; }
  .r { text-align:right; } .c { text-align:center; }
  .desc-title { font-weight:700; font-size:9.5px; }
  .desc-attr { color:var(--muted); font-size:7.5px; line-height:1.35; }
  .totals { margin-top:10px; width:58%; margin-left:auto; font-size:10px; }
  .totals td { padding:3px 8px; }
  .totals .grand td { border-top:1.5px solid var(--rule); font-weight:700;
                      font-size:12px; padding-top:6px; color:var(--brand); }
  .words { margin-top:8px; border:1px solid var(--rule); padding:7px 8px; font-size:10px; }
  .foot { display:flex; gap:14px; margin-top:10px; border:1px solid var(--rule); }
  .foot > div { padding:8px 10px; font-size:8.5px; }
  .decl { flex:1; border-right:1px solid var(--rule); }
  .decl ol { margin:4px 0 0; padding-left:16px; } .decl li { margin-bottom:2px; }
  .sign { width:33%; text-align:center; }
  .sign img { max-width:150px; max-height:56px; margin:6px auto; display:block; }
  .brandline { text-align:center; font-size:8px; color:var(--muted);
               margin-top:8px; padding-top:6px; border-top:1px solid var(--light); }
  .logo { max-height:42px; margin-bottom:6px; }
  .bar { display:flex; gap:8px; justify-content:flex-end; margin:0 auto 12px;
         max-width:210mm; }
  .bar button, .bar a { font:600 12px/1 'Inter',sans-serif; padding:9px 16px;
        border:1px solid var(--brand); background:var(--brand); color:#fff;
        border-radius:2px; cursor:pointer; text-decoration:none; }
  .bar a { background:#fff; color:var(--brand); }
  @media print { body { background:#fff; padding:0; }
                 .sheet { border:0; padding:0; max-width:none; }
                 .bar { display:none; }
                 thead { display:table-header-group; }
                 .totals, .foot, .words { break-inside:avoid; } }
</style></head><body>
<div class="bar">
  <a href="javascript:history.back()">Back</a>
  <button onclick="window.print()">Download / Print PDF</button>
</div>
<div class="sheet">
  <h1>{{ heading }}</h1>
  <div class="copy-label">Original for Recipient</div>

  <table class="grid"><tr>
    <td style="width:30%">
      <span class="lbl">Invoice No</span><span class="val">{{ inv.invoice_number }}</span>
      <div style="height:6px"></div>
      <span class="lbl">Invoice Date</span><span class="val">{{ issued_on }}</span>
      <div style="height:6px"></div>
      <span class="lbl">Order No</span><span class="val">{{ order_no }}</span>
      <div style="height:6px"></div>
      <span class="lbl">Payment</span><span class="val">{{ inv.payment_method }}</span>
    </td>
    <td style="width:42%">
      {% if s.logo_url %}<img class="logo" src="{{ s.logo_url }}" alt="">{% endif %}
      <div class="val" style="font-size:11.5px">{{ s.legal_name }}</div>
      {% if s.trade_name %}<div style="font-size:9.5px;color:var(--muted)">({{ s.trade_name }})</div>{% endif %}
      <div style="margin-top:5px;font-size:9px;line-height:1.5">
        {% for l in s.address_lines %}{{ l }}<br>{% endfor %}
        {% if s.gstin %}<b>GSTIN:</b> {{ s.gstin }}<br>{% endif %}
        {% if s.pan %}<b>PAN:</b> {{ s.pan }}<br>{% endif %}
        {% if s.cin %}<b>CIN:</b> {{ s.cin }}<br>{% endif %}
        {% if s.support_email %}{{ s.support_email }}<br>{% endif %}
        {% if s.support_phone %}{{ s.support_phone }}<br>{% endif %}
        {% if s.store_url %}{{ s.store_url }}{% endif %}
      </div>
    </td>
    <td style="width:28%">
      <span class="lbl">Place of Supply</span>
      <span class="val">{% if inv.place_of_supply_name %}{{ inv.place_of_supply_name }} ({{ inv.place_of_supply_code }}){% else %}Outside India (Export){% endif %}</span>
      <div style="height:6px"></div>
      <span class="lbl">Supply Type</span>
      <span class="val">{{ supply_label }}</span>
      <div style="height:6px"></div>
      <span class="lbl">Reverse Charge</span><span class="val">No</span>
      {% if inv.payment_reference %}<div style="height:6px"></div>
      <span class="lbl">Payment Ref</span>
      <span class="val" style="font-size:8.5px">{{ inv.payment_reference }}</span>{% endif %}
    </td>
  </tr></table>

  <table class="grid" style="margin-top:-1px"><tr>
    <td style="width:50%">
      <span class="lbl">Bill To</span>
      <div class="val">{{ b.name }}</div>
      {% if inv.buyer_gstin %}<div style="margin-top:2px"><b>GSTIN:</b> {{ inv.buyer_gstin }}</div>{% endif %}
      <div style="margin-top:3px;line-height:1.5">
        {{ b.line1 }}{% if b.line2 %}, {{ b.line2 }}{% endif %}<br>
        {{ b.city }}{% if b.pincode %} - {{ b.pincode }}{% endif %}<br>
        {{ b.state }}{% if inv.place_of_supply_code %} ({{ inv.place_of_supply_code }}){% endif %}, {{ b.country }}
        {% if b.phone %}<br>Phone: {{ b.phone }}{% endif %}
      </div>
    </td>
    <td style="width:50%">
      <span class="lbl">Ship To</span>
      <div class="val">{{ b.name }}</div>
      <div style="margin-top:3px;line-height:1.5">
        {{ b.line1 }}{% if b.line2 %}, {{ b.line2 }}{% endif %}<br>
        {{ b.city }}{% if b.pincode %} - {{ b.pincode }}{% endif %}<br>
        {{ b.state }}, {{ b.country }}
        {% if b.email %}<br>{{ b.email }}{% endif %}
      </div>
    </td>
  </tr></table>

  <table class="items"><thead><tr>
    <th style="width:4%">#</th>
    <th style="width:29%">Description of Goods</th>
    <th style="width:8%">HSN</th>
    <th style="width:10%">Unit Price<br>(Excl. Tax)</th>
    <th style="width:5%">Qty</th>
    <th style="width:5%">UQC</th>
    <th style="width:9%">Discount</th>
    <th style="width:10%">Taxable<br>Value</th>
    {% if inv.supply_type == 'intra_state' %}
      <th style="width:9%">CGST</th><th style="width:9%">{{ second_head }}</th>
    {% elif inv.supply_type == 'inter_state' %}
      <th style="width:18%">IGST</th>
    {% else %}
      <th style="width:18%">Tax</th>
    {% endif %}
    <th style="width:11%">Total</th>
  </tr></thead><tbody>
  {% for li in lines %}<tr>
    <td class="c">{{ loop.index }}</td>
    <td>
      <div class="desc-title">{{ li.description }}</div>
      {% if li.devanagari %}<div class="desc-title devanagari">{{ li.devanagari }}</div>{% endif %}
      {% for k, v in li.attr_lines %}<div class="desc-attr">{{ k }}: {{ v }}</div>{% endfor %}
    </td>
    <td class="c">{{ li.hsn_code }}</td>
    <td class="r">{{ li.unit_price_excl_paise | money(cur) }}</td>
    <td class="c">{{ li.quantity }}</td>
    <td class="c">{{ li.uqc }}</td>
    <td class="r">{% if li.discount_paise %}{{ li.discount_paise | money(cur) }}{% else %}—{% endif %}</td>
    <td class="r">{{ li.taxable_paise | money(cur) }}</td>
    {% if inv.supply_type == 'intra_state' %}
      <td class="r">{{ li.cgst_paise | money(cur) }}<br><span class="desc-attr">@{{ li.half_rate }}%</span></td>
      <td class="r">{{ li.sgst_paise | money(cur) }}<br><span class="desc-attr">@{{ li.half_rate }}%</span></td>
    {% elif inv.supply_type == 'inter_state' %}
      <td class="r">{{ li.igst_paise | money(cur) }}<br><span class="desc-attr">@{{ li.full_rate }}%</span></td>
    {% else %}
      <td class="c">NIL<br><span class="desc-attr">Zero-rated</span></td>
    {% endif %}
    <td class="r">{{ li.line_total_paise | money(cur) }}</td>
  </tr>{% endfor %}
  </tbody></table>

  <table class="totals">
    <tr><td>Total Taxable Value</td><td class="r">{{ inv.total_taxable_paise | money(cur) }}</td></tr>
    {% if inv.supply_type == 'intra_state' %}
      <tr><td>CGST</td><td class="r">{{ inv.total_cgst_paise | money(cur) }}</td></tr>
      <tr><td>{{ second_head }}</td><td class="r">{{ inv.total_sgst_paise | money(cur) }}</td></tr>
    {% elif inv.supply_type == 'inter_state' %}
      <tr><td>IGST</td><td class="r">{{ inv.total_igst_paise | money(cur) }}</td></tr>
    {% else %}
      <tr><td>GST (zero-rated export)</td><td class="r">NIL</td></tr>
    {% endif %}
    {% if inv.shipping_paise %}<tr><td>Shipping (included above)</td><td class="r">{{ inv.shipping_paise | money(cur) }}</td></tr>{% endif %}
    {% if inv.total_discount_paise %}<tr><td>Total Discount</td><td class="r">- {{ inv.total_discount_paise | money(cur) }}</td></tr>{% endif %}
    {% if inv.round_off_paise %}<tr><td>Round Off</td><td class="r">{{ inv.round_off_paise | money(cur) }}</td></tr>{% endif %}
    <tr class="grand"><td>Grand Total ({{ cur }}, incl. of taxes)</td>
        <td class="r">{{ inv.grand_total_paise | money(cur) }}</td></tr>
  </table>

  <div class="words"><b>Amount in words:</b> {{ inv.amount_in_words }}</div>

  <div class="foot">
    <div class="decl">
      <b>Declarations</b>
      <ol>
        {% for d in s.declarations %}<li>{{ d }}</li>{% endfor %}
        {% if inv.supply_type == 'export' and s.export_declaration %}
          <li>{{ s.export_declaration }}</li>{% endif %}
      </ol>
    </div>
    <div class="sign">
      <div style="font-weight:600">{{ s.legal_name }}</div>
      {% if s.signature_url %}<img src="{{ s.signature_url }}" alt="">
      {% else %}<div style="height:44px"></div>{% endif %}
      <div>{{ s.signatory_name }}</div>
      <div style="color:var(--muted)">{{ s.signatory_designation }}</div>
    </div>
  </div>
  <div class="brandline">{{ s.footer_line }}</div>
</div></body></html>
""")


def render_html(inv: dict, lines: list[dict], order_no: str | None) -> str:
    settings = inv.get("supplier_json") or {}
    if isinstance(settings, str):
        settings = json.loads(settings)
    billing = inv.get("buyer_billing_json") or {}
    if isinstance(billing, str):
        billing = json.loads(billing)

    _ATTR_LABELS = {
        "weight_ratti": "Weight (Ratti)", "weight_carat": "Weight (Carat)",
        "weight_grams": "Weight (g)", "mukhi": "Mukhi", "bead_count": "Beads",
        "bead_size_mm": "Bead Size (mm)", "origin": "Origin", "metal": "Metal",
        "metal_purity": "Purity", "certificate_authority": "Lab",
        "certificate_no": "Certificate No", "treatment": "Treatment",
        "energised": "Energised", "energised_on": "Energised On",
        "options": "Options", "serial_no": "Serial No",
    }
    shaped = []
    for li in lines:
        li = dict(li)
        attrs = li.get("attributes_json") or {}
        if isinstance(attrs, str):
            attrs = json.loads(attrs)
        # Cap at 6 lines (§8.4) — the order page carries the full detail.
        li["attr_lines"] = [(_ATTR_LABELS.get(k, k.replace("_", " ").title()), v)
                            for k, v in list(attrs.items())[:6]]
        li["full_rate"] = f"{li['gst_rate_bp'] / 100:g}"
        li["half_rate"] = f"{li['gst_rate_bp'] / 200:g}"
        li["devanagari"] = ""
        shaped.append(li)

    issued = inv["issued_at"]
    if isinstance(issued, str):
        issued = datetime.fromisoformat(issued.replace("Z", "+00:00"))

    return _TEMPLATE.render(
        inv=inv, s={**DEFAULT_SETTINGS, **settings}, b=billing, lines=shaped,
        cur=(inv.get("currency") or "INR").strip(),
        order_no=order_no or "—",
        issued_on=issued.strftime("%d/%m/%Y"),
        # Exports are not Indian tax invoices; labelling one "Tax Invoice" would
        # misdescribe a zero-rated supply.
        heading="Tax Invoice" if inv["supply_type"] != "export" else "Export Invoice",
        supply_label={"intra_state": "Intra-State", "inter_state": "Inter-State",
                      "export": "Export (Zero-rated)"}.get(inv["supply_type"], "—"),
        second_head=gst.second_head_label(inv.get("place_of_supply_code")),
    )


def _demo() -> None:
    """Self-check: `python invoice.py`. Rendering + numbering only — no DB."""
    assert fy_code(datetime(2026, 8, 13, tzinfo=timezone.utc)) == "2627"
    assert fy_code(datetime(2026, 3, 31, tzinfo=timezone.utc)) == "2526", "Mar = prev FY"
    assert fy_code(datetime(2026, 4, 1, tzinfo=timezone.utc)) == "2627", "Apr = new FY"
    assert _format_number("TRE", "2627", 123) == "TRE/2627/000123"
    assert len(_format_number("TRE", "2627", 999999)) <= 16
    try:
        _format_number("TREDEVGEMS", "2627", 1)
        raise AssertionError("an over-long prefix must be rejected, not truncated")
    except InvoiceBlocked:
        pass

    assert money(188900) == "1,889.00"
    assert money(12500000) == "1,25,000.00", money(12500000)   # Indian grouping
    assert money(10000000000) == "10,00,00,000.00"   # 10 crore
    assert money(0) == "0.00"
    assert money(50) == "0.50"
    assert money(188900, "USD") == "1,889.00"                   # Western grouping

    inv = {
        "invoice_number": "TRE/2627/000123", "issued_at": datetime(2026, 8, 13),
        "supply_type": "intra_state", "place_of_supply_code": "09",
        "place_of_supply_name": "Uttar Pradesh", "buyer_gstin": "09AAECO5418P1ZV",
        "currency": "INR", "payment_method": "PREPAID", "payment_reference": "pay_x",
        "total_taxable_paise": 100000, "total_cgst_paise": 1500,
        "total_sgst_paise": 1500, "total_igst_paise": 0, "shipping_paise": 0,
        "total_discount_paise": 0, "round_off_paise": 0, "grand_total_paise": 103000,
        "amount_in_words": gst.amount_in_words(103000),
        "supplier_json": DEFAULT_SETTINGS,
        "buyer_billing_json": {"name": "Test Buyer", "line1": "1 Road", "line2": "",
                               "city": "Hathras", "state": "Uttar Pradesh",
                               "pincode": "204101", "country": "IN",
                               "phone": "", "email": "b@example.com"},
    }
    lines = [{"description": "5 Mukhi Rudraksha Mala", "hsn_code": "7117",
              "quantity": 1, "uqc": "PCS", "unit_price_excl_paise": 100000,
              "gross_excl_paise": 100000, "discount_paise": 0,
              "taxable_paise": 100000, "gst_rate_bp": 300, "cgst_paise": 1500,
              "sgst_paise": 1500, "igst_paise": 0, "line_total_paise": 103000,
              "attributes_json": {"mukhi": "5", "origin": "Nepal"}}]
    html = render_html(inv, lines, "TRE-1001")
    for must in ("Tax Invoice", "TRE/2627/000123", "GSTIN", "09AAECO5418P1ZV",
                 "Place of Supply", "Uttar Pradesh", "HSN", "7117", "CGST",
                 "Reverse Charge", "computer generated", "Authorised Signatory",
                 "1,030.00", "Amount in words"):
        assert must in html, f"rendered invoice is missing {must!r}"
    assert "IRN" not in html, "must never print an IRN without a real IRP response"

    # Export invoice: no Indian GST, and it must not call itself a Tax Invoice.
    exp = {**inv, "supply_type": "export", "place_of_supply_code": None,
           "place_of_supply_name": "", "currency": "USD", "buyer_gstin": None,
           "total_cgst_paise": 0, "total_sgst_paise": 0}
    ehtml = render_html(exp, lines, "TRE-1002")
    assert "Export Invoice" in ehtml and "Zero-rated" in ehtml
    assert "Tax Invoice" not in ehtml

    print("invoice.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
