"""Pure GST tax engine for invoice generation — see .claude/invoice.md §5.

No DB, no HTTP, no clock. Takes plain dicts, returns plain dicts, so the whole
thing is testable without a database (run `python gst.py` for the self-check).

Money is INTEGER PAISE everywhere. Rates are BASIS POINTS (5% -> 500, 0.25% -> 25).
Intermediate division uses Decimal with ROUND_HALF_UP; float never touches money.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

# ── State / UT codes ─────────────────────────────────────────────────────────
# tax_type is what the second head is CALLED for a delivery in that state: Union
# Territories without a legislature levy UTGST, everyone else SGST. Delhi (07),
# Puducherry (34) and J&K (01) have legislatures and levy SGST despite UT status.
STATES: dict[str, tuple[str, str]] = {
    "01": ("Jammu and Kashmir", "SGST"), "02": ("Himachal Pradesh", "SGST"),
    "03": ("Punjab", "SGST"), "04": ("Chandigarh", "UTGST"),
    "05": ("Uttarakhand", "SGST"), "06": ("Haryana", "SGST"),
    "07": ("Delhi", "SGST"), "08": ("Rajasthan", "SGST"),
    "09": ("Uttar Pradesh", "SGST"), "10": ("Bihar", "SGST"),
    "11": ("Sikkim", "SGST"), "12": ("Arunachal Pradesh", "SGST"),
    "13": ("Nagaland", "SGST"), "14": ("Manipur", "SGST"),
    "15": ("Mizoram", "SGST"), "16": ("Tripura", "SGST"),
    "17": ("Meghalaya", "SGST"), "18": ("Assam", "SGST"),
    "19": ("West Bengal", "SGST"), "20": ("Jharkhand", "SGST"),
    "21": ("Odisha", "SGST"), "22": ("Chhattisgarh", "SGST"),
    "23": ("Madhya Pradesh", "SGST"), "24": ("Gujarat", "SGST"),
    "25": ("Daman and Diu", "UTGST"),
    "26": ("Dadra and Nagar Haveli and Daman and Diu", "UTGST"),
    "27": ("Maharashtra", "SGST"), "29": ("Karnataka", "SGST"),
    "30": ("Goa", "SGST"), "31": ("Lakshadweep", "UTGST"),
    "32": ("Kerala", "SGST"), "33": ("Tamil Nadu", "SGST"),
    "34": ("Puducherry", "SGST"), "35": ("Andaman and Nicobar Islands", "UTGST"),
    "36": ("Telangana", "SGST"), "37": ("Andhra Pradesh", "SGST"),
    "38": ("Ladakh", "UTGST"), "97": ("Other Territory", "UTGST"),
}

# Orders store shipping_state as free text (filled by the PIN lookup or typed by
# hand), so resolving a code needs to tolerate spelling/spacing variants.
_STATE_ALIASES = {
    "andaman and nicobar": "35", "andaman & nicobar islands": "35",
    "dadra and nagar haveli": "26", "daman and diu": "26",
    "jammu & kashmir": "01", "j&k": "01",
    "nct of delhi": "07", "new delhi": "07", "delhi ncr": "07",
    "orissa": "21", "pondicherry": "34", "puduchery": "34",
    "uttaranchal": "05", "chattisgarh": "22",
    # ISO 3166-2:IN two-letter codes — the PIN lookup (backend/geo.py) falls back to
    # AWS Location's bare region Code (e.g. "UP") when it has no full state name.
    "an": "35", "ap": "37", "ar": "12", "as": "18", "br": "10", "ch": "04",
    "ct": "22", "dh": "26", "dl": "07", "ga": "30", "gj": "24", "hr": "06",
    "hp": "02", "jk": "01", "jh": "20", "ka": "29", "kl": "32", "la": "38",
    "ld": "31", "mp": "23", "mh": "27", "mn": "14", "ml": "17", "mz": "15",
    "nl": "13", "or": "21", "py": "34", "pb": "03", "rj": "08", "sk": "11",
    "tn": "33", "tg": "36", "tr": "16", "up": "09", "uk": "05", "wb": "19",
}
_BY_NAME = {name.lower(): code for code, (name, _) in STATES.items()}


def state_code_for(name: str | None) -> str | None:
    """Resolve a free-text state name to its GST state code. Returns None when it
    can't be resolved — callers must treat that as a hard block, never a guess,
    since a wrong code silently flips CGST/SGST to IGST on the whole invoice."""
    if not name:
        return None
    key = " ".join(str(name).strip().lower().replace(".", "").split())
    if key in STATES:                      # already a code
        return key
    return _BY_NAME.get(key) or _STATE_ALIASES.get(key)


def state_name_for(code: str | None) -> str:
    return STATES.get(code or "", ("", ""))[0]


def second_head_label(code: str | None) -> str:
    """'SGST' or 'UTGST' — whichever the place of supply actually levies."""
    return STATES.get(code or "", ("", "SGST"))[1]


# ── money helpers ────────────────────────────────────────────────────────────
def _q(value: Decimal) -> int:
    """Decimal rupees-or-paise -> integer paise, half-up (Indian commercial norm)."""
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _apportion(total: int, weights: list[int]) -> list[int]:
    """Split `total` across `weights` pro rata, giving the rounding remainder to the
    largest weight so the parts always re-sum to exactly `total` (§5.5/§5.6)."""
    if total == 0 or not weights:
        return [0] * len(weights)
    denom = sum(weights)
    if denom <= 0:                          # nothing to weight by — split evenly
        base, rem = divmod(total, len(weights))
        return [base + (1 if i < rem else 0) for i in range(len(weights))]
    parts = [_q(Decimal(total) * Decimal(w) / Decimal(denom)) for w in weights]
    drift = total - sum(parts)
    if drift:
        parts[weights.index(max(weights))] += drift
    return parts


# ── the engine ───────────────────────────────────────────────────────────────
SUPPLY_INTRA, SUPPLY_INTER, SUPPLY_EXPORT = "intra_state", "inter_state", "export"


def compute_invoice(
    lines: list[dict],
    *,
    supplier_state_code: str,
    place_of_supply_code: str | None,
    order_discount_paise: int = 0,
    shipping_paise: int = 0,
    is_export: bool = False,
    prices_include_tax: bool = True,
) -> dict:
    """Compute a full invoice's tax breakdown.

    Each input line needs: qty, unit_price_paise, gst_rate_bp, and whatever
    descriptive fields the caller wants echoed back (they pass through untouched).

    Exports are ZERO-RATED under the IGST Act — no Indian GST is charged, but a
    formal invoice is still issued. We force every rate to 0 rather than skipping
    the tax columns, so the document still reconciles line-by-line.
    """
    supply_type = (SUPPLY_EXPORT if is_export
                   else SUPPLY_INTRA if place_of_supply_code == supplier_state_code
                   else SUPPLY_INTER)

    # Gross (pre-discount) per line drives every apportionment below.
    gross = [int(li["unit_price_paise"]) * int(li["qty"]) for li in lines]
    discounts = _apportion(int(order_discount_paise), gross)

    # Clamp: a discount can never drive a line negative (§5.6). Anything clipped is
    # pushed onto the other lines so the order total still reconciles.
    net = []
    overflow = 0
    for g, d in zip(gross, discounts):
        if d > g:
            overflow += d - g
            d = g
        net.append(g - d)
    if overflow:
        for i, n in enumerate(net):
            if overflow <= 0:
                break
            take = min(n, overflow)
            net[i] -= take
            discounts[i] += take
            overflow -= take

    rates = [0 if supply_type == SUPPLY_EXPORT else int(li.get("gst_rate_bp") or 0)
             for li in lines]

    # Shipping rides on the principal supply (composite supply), apportioned pro
    # rata by each line's provisional taxable value — computed BEFORE shipping is
    # added, which is what makes the weighting non-circular.
    provisional = [_taxable_of(n, r, prices_include_tax) for n, r in zip(net, rates)]
    ship_shares = _apportion(int(shipping_paise), provisional)

    out_lines = []
    tot_taxable = tot_cgst = tot_sgst = tot_igst = tot_disc = tot_gross = 0
    for li, g, d, n, r, ship in zip(lines, gross, discounts, net, rates, ship_shares):
        line_value = n + ship                      # what this line contributes to the bill
        taxable = _taxable_of(line_value, r, prices_include_tax)
        # Subtraction (not a second multiply) so taxable + tax == line_value to the
        # paise, which is the reconciliation §5.2 demands of the inclusive path.
        tax = (line_value - taxable) if prices_include_tax else _q(
            Decimal(taxable) * Decimal(r) / Decimal(10000))
        total_line = taxable + tax

        cgst = sgst = igst = 0
        if supply_type == SUPPLY_INTRA:
            cgst = _q(Decimal(tax) / 2)            # halves always re-sum exactly
            sgst = tax - cgst
        elif supply_type == SUPPLY_INTER:
            igst = tax

        qty = int(li["qty"])
        out_lines.append({
            **{k: v for k, v in li.items() if k not in ("qty", "unit_price_paise", "gst_rate_bp")},
            "qty": qty,
            "gst_rate_bp": r,
            # Unit price excluding tax, for the invoice's "Unit Price (Excl. Tax)"
            # column. Derived from the line's own taxable value so the column
            # multiplies out consistently rather than drifting by a paise.
            "unit_price_excl_paise": _q(Decimal(taxable) / qty) if qty else 0,
            "gross_excl_paise": _taxable_of(g, r, prices_include_tax),
            "discount_paise": d,
            "shipping_share_paise": ship,
            "taxable_paise": taxable,
            "cgst_paise": cgst, "sgst_paise": sgst, "igst_paise": igst,
            "line_total_paise": total_line,
        })
        tot_gross += g
        tot_disc += d
        tot_taxable += taxable
        tot_cgst += cgst
        tot_sgst += sgst
        tot_igst += igst

    pre_round = tot_taxable + tot_cgst + tot_sgst + tot_igst
    # Deliberately NO rounding to the whole rupee on the inclusive path: the grand
    # total there already equals the exact amount charged to the card, and nudging
    # it to a round rupee would make the invoice disagree with the money collected
    # (§5.4 calls that an audit finding). Only the exclusive path, where tax is
    # added on top and genuinely lands on odd paise, gets a round-off line.
    round_off = 0 if prices_include_tax else (
        _q(Decimal(pre_round) / 100) * 100 - pre_round)
    grand = pre_round + round_off

    return {
        "supply_type": supply_type,
        "place_of_supply_code": place_of_supply_code,
        "place_of_supply_name": state_name_for(place_of_supply_code),
        "second_head_label": second_head_label(place_of_supply_code),
        "lines": out_lines,
        "total_gross_paise": tot_gross,
        "total_discount_paise": tot_disc,
        "total_taxable_paise": tot_taxable,
        "total_cgst_paise": tot_cgst,
        "total_sgst_paise": tot_sgst,
        "total_igst_paise": tot_igst,
        "shipping_paise": int(shipping_paise),
        "round_off_paise": round_off,
        "grand_total_paise": grand,
    }


def _taxable_of(inclusive_or_excl: int, rate_bp: int, inclusive: bool) -> int:
    """Back out the taxable value. Inclusive: value / (1 + rate). Exclusive: the
    value already IS the taxable amount."""
    if not inclusive:
        return inclusive_or_excl
    if rate_bp <= 0:
        return inclusive_or_excl
    return _q(Decimal(inclusive_or_excl) * Decimal(10000) / Decimal(10000 + rate_bp))


# ── amount in words (Indian numbering — lakh/crore, never million) ───────────
_ONES = ("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
         "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
         "Seventeen", "Eighteen", "Nineteen")
_TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
         "Ninety")


def _under_thousand(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()
    return (_ONES[n // 100] + " Hundred"
            + (" " + _under_thousand(n % 100) if n % 100 else ""))


def _indian_words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for divisor, label in ((10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand")):
        if n >= divisor:
            chunk, n = divmod(n, divisor)
            # Crore is the top bucket and is itself unbounded (100 crore = "One
            # Hundred Crore"), so it recurses; the others are always < 1000.
            head = _indian_words(chunk) if divisor == 10_000_000 else _under_thousand(chunk)
            parts.append(f"{head} {label}")
    if n:
        parts.append(_under_thousand(n))
    return " ".join(parts)


def amount_in_words(paise: int, currency: str = "INR") -> str:
    """'INR One Thousand Eight Hundred Ninety Nine Rupees And Fifty Paise Only'."""
    sign = "Minus " if paise < 0 else ""
    rupees, p = divmod(abs(int(paise)), 100)
    unit, sub = ("Rupees", "Paise") if currency == "INR" else ("Dollars", "Cents")
    words = f"{sign}{currency} {_indian_words(rupees)} {unit}"
    if p:
        words += f" And {_indian_words(p)} {sub}"
    return words + " Only"


# ── GSTIN validation ─────────────────────────────────────────────────────────
import re  # noqa: E402  (kept next to the only thing that uses it)

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$")
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def valid_gstin(gstin: str | None) -> bool:
    """Format + the official mod-36 check digit. The checksum is what rejects a
    plausible-looking typo (one transposed character) that the regex alone waves
    through — worth having when a wrong GSTIN on a B2B invoice denies the buyer
    their input tax credit."""
    if not gstin or not GSTIN_RE.match(gstin.strip().upper()):
        return False
    code = gstin.strip().upper()
    total = 0
    for i, ch in enumerate(code[:14]):
        factor = 2 if i % 2 else 1
        product = _GSTIN_CHARS.index(ch) * factor
        total += product // 36 + product % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36] == code[14]


def _demo() -> None:
    """Self-check: `python gst.py`. Cases mirror .claude/invoice.md §12.1."""
    UP, MH, CH = "09", "27", "04"

    # 1. Intra-state, tax-inclusive, 3% -> taxable 1000.00, CGST 15, SGST 15.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 103000, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=UP)
    assert r["supply_type"] == SUPPLY_INTRA
    assert r["total_taxable_paise"] == 100000, r
    assert r["total_cgst_paise"] == 1500 and r["total_sgst_paise"] == 1500, r
    assert r["total_igst_paise"] == 0
    assert r["grand_total_paise"] == 103000

    # 2. Inter-state, same figures -> all tax sits in IGST, nothing in CGST/SGST.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 103000, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=MH)
    assert r["supply_type"] == SUPPLY_INTER
    assert r["total_igst_paise"] == 3000 and r["total_cgst_paise"] == 0, r

    # 2b. Exclusive pricing (tax added on top, not extracted from the price) — the
    # model some legacy orders used before the store switched to inclusive prices.
    # Real case: order TDV-20260720-72, ₹18,500 subtotal + ₹555 (3%) GST = ₹19,055.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 1850000, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=UP,
                        prices_include_tax=False)
    assert r["total_taxable_paise"] == 1850000, r          # unchanged — nothing to extract
    assert r["total_cgst_paise"] == 27750 and r["total_sgst_paise"] == 27750, r
    assert r["grand_total_paise"] == 1905500, r             # 18500 + 555, tax ADDED on top

    # 3. Low-rate stone at 0.25%.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 1002500, "gst_rate_bp": 25}],
                        supplier_state_code=UP, place_of_supply_code=UP)
    assert r["total_taxable_paise"] == 1000000, r
    assert r["total_cgst_paise"] == 1250 and r["total_sgst_paise"] == 1250, r

    # 4. Odd-paise split: the two halves must re-sum to the tax exactly, never 1p off.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 104495, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=UP)
    line = r["lines"][0]
    assert line["cgst_paise"] + line["sgst_paise"] == line["line_total_paise"] - line["taxable_paise"]
    assert abs(line["cgst_paise"] - line["sgst_paise"]) <= 1

    # 5. Export is zero-rated: a formal invoice, but no Indian GST on it.
    r = compute_invoice([{"qty": 2, "unit_price_paise": 500000, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=None, is_export=True)
    assert r["supply_type"] == SUPPLY_EXPORT
    assert r["total_cgst_paise"] == r["total_sgst_paise"] == r["total_igst_paise"] == 0
    assert r["total_taxable_paise"] == 1000000 == r["grand_total_paise"], r

    # 6. Mixed rates + an order-level coupon: shares must re-sum to the coupon exactly.
    r = compute_invoice(
        [{"qty": 1, "unit_price_paise": 100000, "gst_rate_bp": 300},
         {"qty": 2, "unit_price_paise": 30000, "gst_rate_bp": 500},
         {"qty": 1, "unit_price_paise": 50000, "gst_rate_bp": 0}],
        supplier_state_code=UP, place_of_supply_code=UP, order_discount_paise=50000)
    assert sum(li["discount_paise"] for li in r["lines"]) == 50000, r
    assert r["grand_total_paise"] == 100000 + 60000 + 50000 - 50000
    # Every line must reconcile: taxable + its tax == the line total, to the paise.
    for li in r["lines"]:
        assert li["taxable_paise"] + li["cgst_paise"] + li["sgst_paise"] + li["igst_paise"] \
            == li["line_total_paise"], li

    # 7. Shipping apportionment: split across lines, no drift, total still exact.
    r = compute_invoice(
        [{"qty": 1, "unit_price_paise": 100000, "gst_rate_bp": 300},
         {"qty": 1, "unit_price_paise": 50000, "gst_rate_bp": 500}],
        supplier_state_code=UP, place_of_supply_code=UP, shipping_paise=9900)
    assert sum(li["shipping_share_paise"] for li in r["lines"]) == 9900, r
    assert r["grand_total_paise"] == 100000 + 50000 + 9900

    # 8. Nil-rated line pays no tax but still appears with a real taxable value.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 70000, "gst_rate_bp": 0}],
                        supplier_state_code=UP, place_of_supply_code=UP)
    assert r["total_taxable_paise"] == 70000 and r["total_cgst_paise"] == 0

    # 9. Discount larger than the line clamps at zero instead of going negative.
    r = compute_invoice([{"qty": 1, "unit_price_paise": 10000, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=UP,
                        order_discount_paise=10000)
    assert r["lines"][0]["taxable_paise"] == 0 and r["grand_total_paise"] == 0, r

    # 10. Qty > 1 on a price with paise: the line must not drift off qty x unit.
    r = compute_invoice([{"qty": 3, "unit_price_paise": 33333, "gst_rate_bp": 300}],
                        supplier_state_code=UP, place_of_supply_code=UP)
    assert r["grand_total_paise"] == 99999, r

    # 11. A UT without a legislature levies UTGST, not SGST.
    assert second_head_label(CH) == "UTGST"
    assert second_head_label("34") == "SGST"   # Puducherry HAS a legislature
    assert second_head_label("07") == "SGST"   # so does Delhi

    # 12. Free-text state names from the PIN lookup resolve to codes.
    assert state_code_for("Uttar Pradesh") == "09"
    assert state_code_for("  delhi ") == "07"
    assert state_code_for("Orissa") == "21"
    assert state_code_for("UP") == "09"  # AWS Location's bare region code fallback
    assert state_code_for("mh") == "27"
    assert state_code_for("Atlantis") is None  # unresolvable must block, not guess

    # 13. Amount in words uses lakh/crore, not the Western short scale.
    assert amount_in_words(36000) == "INR Three Hundred Sixty Rupees Only"
    assert amount_in_words(189950) == (
        "INR One Thousand Eight Hundred Ninety Nine Rupees And Fifty Paise Only")
    assert amount_in_words(12500000) == "INR One Lakh Twenty Five Thousand Rupees Only"
    assert amount_in_words(1050000000) == "INR One Crore Five Lakh Rupees Only"
    assert amount_in_words(0) == "INR Zero Rupees Only"
    assert amount_in_words(5) == "INR Zero Rupees And Five Paise Only"

    # 14. GSTIN checksum rejects a transposed-character typo the regex allows.
    assert valid_gstin("09AAECO5418P1ZV"), "the company's own GSTIN must validate"
    assert not valid_gstin("09AAECO5418P1ZX"), "wrong check digit must be rejected"
    assert not valid_gstin("09AAECO5418P1Z")
    assert not valid_gstin(None)

    print("gst.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
