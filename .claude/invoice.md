# Tredev Gems — GST Tax Invoice Generation Feature
### Technical & Functional Specification (implementation handoff document)

| | |
|---|---|
| **Document version** | 1.1 |
| **Date** | 13 August 2026 |
| **Brand / storefront** | Tredev Gems — https://tredev-gems.vercel.app |
| **Legal entity (supplier)** | Optimaxin Software Solutions Private Limited — https://optimaxin.com |
| **Product category** | Indian mythology & spiritual products — gemstones (ratna), rudraksha, bracelets, malas, puja items |
| **Audience for this doc** | Claude Code (implementation agent) + reviewing developer |
| **Reference artefact** | Lenskart tax invoice (order #1347641422) — used only as a **layout and completeness benchmark**, not to be copied verbatim |

---

## 0. How to use this document

This is the complete brief for building the invoice feature. Read sections 1–4 before writing any code.

**Rules for the implementing agent:**

1. **Adapt to the existing repository.** This spec is deliberately stack-neutral. Inspect the repo first (framework, ORM, DB, queue, storage, PDF libs already present) and implement in the existing conventions. Do not introduce a second ORM, a second migration system, or a parallel folder structure.
2. **Do not invent tax rates or HSN codes.** Every rate and HSN must come from the database (`products.hsn_code`, `products.gst_rate`), seeded by the business owner. Section 6 gives *candidate* values only, marked for CA verification.
3. **Do not fabricate an IRN or e-invoice QR code.** See §7.6 — this is a legal landmine, not a cosmetic field.
4. **Anything unresolved goes in `OPEN_QUESTIONS.md`** at the repo root rather than being guessed. Section 1.3 lists the known-open items.
5. **Ship the numbers module with tests first.** Tax and rounding bugs are the expensive failure mode here; §5 and §12 define exact expected values.

---

## 1. Goal, scope, and open items

### 1.1 Goal

When a customer's order is confirmed as paid, the system must automatically generate an immutable, GST-compliant, branded PDF tax invoice; store it durably; expose it to the customer for download; email it as an attachment; and make it available to the admin/accounts team in a form that can be reconciled against GSTR-1 filings.

### 1.2 In scope

- Invoice number series generation (financial-year based, gapless, atomic).
- Tax computation engine: CGST/SGST vs IGST, tax-inclusive price handling, discount apportionment, shipping apportionment, rounding.
- A4 PDF renderer with Tredev branding, Devanagari script support, barcodes and QR.
- Storage, retrieval, access control, email delivery.
- Credit notes for full/partial returns and cancellations.
- Admin listing, search, re-download, bulk export.
- GSTR-1 aligned CSV/JSON export (B2B, B2CS, B2CL, HSN summary, documents-issued).

### 1.3 Explicitly out of scope (v1) — but do not break the door shut

- Live e-invoice (IRN/IRP) integration — build behind a feature flag, see §7.6.
- E-way bill generation.
- Export / SEZ invoices with LUT (no-tax invoices) — leave a `supply_type` enum slot.
- Multi-currency. INR only in v1; store currency code anyway.
- TDS/TCS handling.

### 1.4 Open questions for the business owner (put these in `OPEN_QUESTIONS.md`)

1. Confirm exact legal name spelling, registered address, GSTIN, PAN, and CIN as printed on the GST certificate (candidate values in §2 come from a third-party invoice and **must** be verified).
2. Are storefront prices displayed **inclusive** of GST? (Spec assumes **yes** — §5.2.)
3. Is there more than one place of business / dispatch location? (Affects place-of-supply logic and whether multiple GSTINs are needed.)
4. Current annual aggregate turnover — determines whether e-invoicing (IRN) and dynamic QR obligations apply (§7.6).
5. Should shipping/COD charges be taxed as part of a composite supply (spec assumes yes — §5.5)?
6. Signature: upload a scanned authorised-signatory image, or print "Digitally signed" text?
7. Does the business have a registered trademark for "Tredev Gems"? (Affects whether ® / ™ is printed.)

---

## 2. Supplier (seller) master data

Store these in a single-row `company_settings` table or an env-backed config module — **never hardcode in the PDF template.**

```
legal_name            : Optimaxin Software Solutions Private Limited
trade_name / brand    : Tredev Gems
gstin                 : 09AAECO5418P1ZV          # 09 = Uttar Pradesh
pan                   : AAECO5418P               # derived from chars 3-12 of GSTIN
cin                   : <TO BE CONFIRMED>
registered_address    : Iglas Road, Hathras
                        Hathras - 204101
                        Uttar Pradesh (09), India
dispatch_address      : <same as above unless confirmed otherwise>
state_code            : 09
state_name            : Uttar Pradesh
support_email         : support@optimaxin.com          # confirm mailbox exists before go-live
support_phone         : <e.g. +91-XXXXXXXXXX (10 AM - 7 PM)>
store_url             : https://tredev-gems.vercel.app  # printed on the invoice
company_url           : https://optimaxin.com           # printed in the footer line
signatory_name        : Lubhansh Sharma
signatory_designation : Authorised Signatory
signature_image_path  : assets/invoice/signature.png
logo_primary_path     : assets/invoice/tredev-logo.svg
logo_mono_path        : assets/invoice/tredev-logo-mono.svg
```

> ⚠️ **Validation gate:** on application boot, assert `gstin` matches the GSTIN regex and that `state_code` equals the first two characters of the GSTIN. Fail loudly on mismatch — a wrong supplier state silently produces wrong CGST/SGST vs IGST on every invoice.
>
> GSTIN regex: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$`
> Store and print GSTINs in **uppercase** (the reference invoice prints a lowercase recipient GSTIN — that's sloppy; don't copy it).

### 2.1 Brand naming rules

- Correct spelling is **Tredev** (T-R-E-D-E-V). Not "Tridev", not "Trideve". A single spelling variant anywhere in the codebase, the template, or the email subject line is a bug — add `Tridev` to the repo's spell-check deny list or a CI grep so the wrong form can never ship.
- Storefront brand as printed on the invoice: **Tredev Gems**. Confirm whether the registered trade name is "Tredev Gems" or just "Tredev" and align the template to whatever appears on the GST certificate.
- The legal entity name (`Optimaxin Software Solutions Private Limited`) must appear above the signature block, because that is the registered supplier. The brand name sits with the logo at the top. Both belong on the document — buyers recognise the brand, tax authorities recognise the entity.
- Footer line to print: `Tredev Gems is a brand of Optimaxin Software Solutions Private Limited · optimaxin.com`

> **Domain note:** `tredev-gems.vercel.app` is a deployment URL, not a brand domain. Printing it on a statutory document looks provisional and will get queried by B2B buyers' accounts teams. Since both `store_url` and the QR target come from config, moving to a custom domain later is a one-line change — but do it before the first real invoice goes out if you can. Every issued PDF is frozen with whatever URL it was rendered with (§7.4), so old invoices will keep showing the vercel.app address forever.

---

## 3. Legal content requirements (CGST Rule 46)

Every generated invoice **must** contain all of the following. Treat this as a checklist that a unit test enforces against rendered output.

| # | Field | Notes |
|---|---|---|
| 1 | Heading "Tax Invoice" | Plus copy label: `Original for Recipient` / `Duplicate for Transporter` / `Triplicate for Supplier` (Rule 48 — goods) |
| 2 | Supplier legal name, address, GSTIN | From §2 |
| 3 | Invoice serial number | ≤ 16 chars, alphanumeric + `/` and `-` only, consecutive, unique per financial year (§4) |
| 4 | Date of issue | `DD/MM/YYYY` |
| 5 | Recipient name, billing address | |
| 6 | Recipient GSTIN | If registered (B2B). If unregistered and taxable value > ₹50,000, name/address/state of recipient and place of supply are mandatory |
| 7 | Delivery address (if different) | Plus recipient state + state code |
| 8 | **Place of supply** + state code | Drives §5.1. Must be printed |
| 9 | HSN code per line | |
| 10 | Description of goods | Include product attributes (§8.4) |
| 11 | Quantity + UQC | Use official UQC codes: `PCS`, `NOS`, `GMS`, `CTM` (carat), `SET`, `PAC` |
| 12 | Unit price (excl. tax), gross value, discount, taxable value | |
| 13 | Tax rate and tax amount per line | Split CGST + SGST, **or** IGST — never both |
| 14 | Total invoice value | Plus round-off line if applied |
| 15 | Total in words | Indian numbering system, incl. paise (§5.7) |
| 16 | Reverse charge applicability | Print `Tax is payable on reverse charge basis: No` |
| 17 | Signature / digital signature | Image or "Digitally signed" text |
| 18 | "This is a computer generated invoice" | |

Additional non-statutory but expected fields, mirroring the reference invoice: order number, order date, shipment/AWB code, payment method (PREPAID/COD), gift-message and customer-comments blocks, order barcode, terms-and-conditions pointer.

> **Disclaimer:** this section reflects the CGST Rules as understood up to my knowledge cutoff (May 2026). Indian GST rules, rate slabs, and e-invoicing thresholds change frequently. **Have the final invoice template and rate table signed off by a practising Chartered Accountant before go-live.** I am not a tax advisor and this document is not tax advice.

---

## 4. Invoice numbering

### 4.1 Format

```
TRE/<FY>/<SEQ>          e.g.  TRE/26-27/000123        (18 chars — TOO LONG, see below)
```

The 16-character limit is strict. Use:

```
TRE/2627/000123         # 15 chars — RECOMMENDED
 │    │      └── zero-padded 6-digit sequence, resets each FY
 │    └───────── financial year, e.g. 2627 for FY 2026-27 (1 Apr 2026 – 31 Mar 2027)
 └────────────── fixed brand prefix
```

Separate series, same rules:

| Document type | Prefix | Example |
|---|---|---|
| Tax invoice | `TRE` | `TRE/2627/000123` |
| Credit note | `TRC` | `TRC/2627/000045` |
| Debit note | `TRE-D` | `TRE-D/2627/000007` |

### 4.2 Financial year helper

```
fy_code(date):
    year  = date.year
    if date.month < 4: year = year - 1        # Jan/Feb/Mar belong to previous FY
    return f"{str(year)[2:]}{str(year+1)[2:]}"   # 2026 -> "2627"
```

### 4.3 Atomicity requirements

- Sequence lives in a dedicated table, incremented inside the **same DB transaction** that inserts the invoice row.
- Use `SELECT ... FOR UPDATE` (or an atomic `UPDATE ... RETURNING`) on the counter row. **Do not** use `MAX(seq)+1`, application-level locks, or UUID-derived numbers.
- Unique constraint on `(document_type, fy_code, sequence)` and on `invoice_number`.
- **Gapless requirement:** a number must never be allocated and then thrown away. Therefore: allocate the number only *after* all validation passes, and if PDF rendering later fails, keep the invoice row (status `pdf_failed`) and retry rendering — never delete the row and never recycle the number.

```sql
CREATE TABLE invoice_sequences (
  document_type  VARCHAR(16) NOT NULL,
  fy_code        CHAR(4)     NOT NULL,
  last_sequence  BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (document_type, fy_code)
);
```

---

## 5. Tax computation engine

This is the core of the feature. Implement it as a **pure, side-effect-free module** (`lib/gst/`) that takes a plain input object and returns a plain result object, with no DB or HTTP access. Everything else in the feature is plumbing around it.

### 5.1 Place of supply → CGST/SGST vs IGST

```
supplier_state_code = "09"                          # Uttar Pradesh, from company_settings
place_of_supply     = shipping_address.state_code    # for goods: location of delivery

if place_of_supply == supplier_state_code:
    → INTRA-STATE:  CGST = rate/2,  SGST = rate/2,  IGST = 0
else:
    → INTER-STATE:  IGST = rate,    CGST = 0,       SGST = 0
```

Notes:
- Place of supply for **goods** follows the delivery address, *not* the billing address. (The reference invoice bills to a UP GSTIN and delivers within UP, yet charges IGST from a Haryana/Rajasthan warehouse — because *their* supplier state differs. Our supplier state is UP, so a UP delivery is intra-state CGST+SGST.)
- Union Territories use UTGST instead of SGST. Store the label in a lookup: state codes `04, 26, 25, 31, 34, 35, 38` and `07` (Delhi) / `01` (J&K) need care — Delhi and Puducherry have legislatures and levy SGST. Implement as a `states` table with columns `code, name, tax_type ('SGST'|'UTGST')`. Print the resolved label on the PDF.
- Persist `place_of_supply_code` and `place_of_supply_name` on the invoice row. Never recompute at render time.

### 5.2 Tax-inclusive pricing (assumed default)

Storefront prices for this category are almost always shown as a single MRP-style figure. Config flag:

```
PRICES_ARE_TAX_INCLUSIVE = true
```

**Inclusive path** (per line, after discount):

```
line_inclusive      = unit_inclusive_price * qty  -  line_discount_inclusive
taxable_value       = line_inclusive / (1 + rate)
total_tax           = line_inclusive - taxable_value
unit_price_excl_tax = (unit_inclusive_price / (1 + rate))
```

**Exclusive path:**

```
taxable_value = (unit_price_excl * qty) - line_discount_excl
total_tax     = taxable_value * rate
```

Print `UNIT PRICE (Excl. Tax)`, `GROSS PRICE (Excl. Tax)`, `DISCOUNT`, `TAXABLE VALUE`, tax column, `TOTAL INVOICE VALUE` — same columns as the reference invoice, so the inclusive maths must reconcile exactly: `taxable_value + total_tax == total_invoice_value` for every line, to the paise.

### 5.3 Money representation

- Store all monetary amounts as **integer paise** (`BIGINT`). Never `float`/`double` anywhere in the pipeline.
- Do intermediate arithmetic with a decimal library (`decimal.js`, Python `Decimal`, `BigDecimal`) at **6 decimal places**, then round.
- Rounding mode: **half-up** (`ROUND_HALF_UP`), which is the Indian commercial convention.
- Rates stored as basis points (`BIGINT`, e.g. 5% → `500`, 0.25% → `25`, 3% → `300`) to avoid decimal rates entirely.

### 5.4 Rounding sequence (order matters — do not reorder)

1. Compute each line's `taxable_value` and round to 2 dp.
2. Compute each line's `total_tax` from the rounded taxable value; round to 2 dp.
3. Split into CGST/SGST: `cgst = round(total_tax / 2, 2)`, `sgst = total_tax - cgst` (so halves always re-sum exactly).
4. Sum line values to get invoice `total_taxable`, `total_cgst`, `total_sgst`, `total_igst`.
5. `grand_total_pre_round = total_taxable + total_cgst + total_sgst + total_igst`.
6. `round_off = round_to_nearest_rupee(grand_total_pre_round) - grand_total_pre_round`. Print a `Round Off` line only when `round_off != 0`. Clamp: if `abs(round_off) > 0.50`, that's a bug — raise.
7. `grand_total = grand_total_pre_round + round_off`.

**Reconciliation assertion (must be a runtime check, not just a test):** `grand_total` must equal the amount actually captured from the payment gateway for that shipment. If it doesn't, do **not** issue the invoice — enqueue for manual review and alert. A tax invoice whose total differs from the money collected is an audit finding.

### 5.5 Shipping, COD, and gift-wrap charges

Under composite-supply principles these follow the **principal supply's** rate rather than having a rate of their own.

- Single-rate order → apply that rate to the shipping charge.
- Mixed-rate order → apportion the shipping charge across lines **pro rata by line taxable value**, and add each share into that line's taxable value. Distribute the rounding remainder to the largest line so the total reconciles.
- Alternatively (simpler, acceptable) render shipping as its own line at the highest rate present in the order. Pick one, document it in code comments, and be consistent — switching later corrupts historical comparability.
- Config: `SHIPPING_TAX_MODE = 'apportion' | 'highest_rate_line'`. Default `apportion`.

### 5.6 Discounts and coupons

- Only discounts recorded **on the face of the invoice** reduce taxable value. Post-sale discounts do not — they need a credit note.
- Order-level coupons must be apportioned across lines pro rata by line value, remainder to the largest line, and printed in the per-line `DISCOUNT` column (as the reference invoice does).
- Never let a line's taxable value go negative. Clamp at zero and log.

### 5.7 Amount in words

Indian numbering system, with paise, matching the reference invoice's phrasing:

```
360.00   -> "INR Three Hundred Sixty Rupees Only"
1899.50  -> "INR One Thousand Eight Hundred Ninety Nine Rupees And Fifty Paise Only"
125000   -> "INR One Lakh Twenty Five Thousand Rupees Only"
10500000 -> "INR One Crore Five Lakh Rupees Only"
```

Implement with lakh/crore grouping (not thousand/million). Do not pull in a locale library that defaults to the Western short scale. Unit-test the boundaries: 0, 0.05, 9, 10, 19, 20, 99, 100, 999, 1000, 99999, 100000, 9999999, 10000000.

---

## 6. Product tax master (HSN & rates) — **requires CA verification**

Add to the `products` table (or a `product_tax_profiles` table if rates vary by variant):

```sql
ALTER TABLE products
  ADD COLUMN hsn_code        VARCHAR(8)  NOT NULL,
  ADD COLUMN gst_rate_bp     INTEGER     NOT NULL,   -- basis points
  ADD COLUMN uqc             VARCHAR(8)  NOT NULL,   -- PCS / NOS / GMS / CTM / SET
  ADD COLUMN is_tax_exempt   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN tax_notes       TEXT;
```

Candidate classifications for this catalogue — **treat every row as a draft pending sign-off.** Classification for spiritual/religious goods is genuinely contested (loose stone vs set jewellery vs puja samagri all differ), and slab rates have been revised repeatedly.

| Product type | Candidate HSN | Typical slab discussed | Notes |
|---|---|---|---|
| Loose semi-precious stones (unset) | 7103 | very low / nominal | Certification status matters |
| Loose precious stones (unset) | 7102 / 7103 | very low / nominal | |
| Gemstone set in gold/silver | 7113 | jewellery slab | Metal content changes classification |
| Rudraksha beads (raw seed) | 1404 / 1209 | often nil/exempt as puja samagri | Contested; depends on processing |
| Rudraksha mala / bracelet (strung, non-metal) | 7117 or 1404 | imitation-jewellery slab vs exempt | Hinges on whether it is "jewellery" |
| Bracelets — imitation jewellery | 7117 | imitation-jewellery slab | |
| Yantras / idols — brass/copper | 8306 | standard slab | |
| Yantras / idols — marble/stone | 6802 | standard slab | |
| Puja thali, incense, camphor | 3307 / 1301 / others | varies widely | Item-by-item |
| Books / religious texts | 4901 | commonly nil | |
| Packing & handling (service) | 9965xx | service slab | If billed separately |

**Implementation requirement:** the admin UI must expose `hsn_code`, `gst_rate_bp`, and `uqc` as editable fields with a validation rule that blocks publishing a product until all three are set. Seed with a `pending_review` flag rather than a plausible-looking default — a wrong default that renders cleanly is worse than a hard failure.

---

## 7. Data model

Use the repo's existing migration tool. Generic DDL:

### 7.1 `invoices`

```sql
CREATE TABLE invoices (
  id                      BIGSERIAL PRIMARY KEY,
  document_type           VARCHAR(16)  NOT NULL,        -- tax_invoice | credit_note | debit_note
  invoice_number          VARCHAR(16)  NOT NULL UNIQUE,
  fy_code                 CHAR(4)      NOT NULL,
  sequence                BIGINT       NOT NULL,
  issued_at               TIMESTAMPTZ  NOT NULL,
  order_id                BIGINT       NOT NULL REFERENCES orders(id),
  shipment_id             BIGINT       NULL,
  parent_invoice_id       BIGINT       NULL REFERENCES invoices(id),  -- credit notes
  idempotency_key         VARCHAR(128) NOT NULL UNIQUE,               -- see §9.2

  -- frozen supplier snapshot
  supplier_legal_name     VARCHAR(255) NOT NULL,
  supplier_gstin          VARCHAR(15)  NOT NULL,
  supplier_address_json   JSONB        NOT NULL,
  supplier_state_code     CHAR(2)      NOT NULL,

  -- frozen recipient snapshot
  buyer_name              VARCHAR(255) NOT NULL,
  buyer_gstin             VARCHAR(15)  NULL,
  buyer_billing_json      JSONB        NOT NULL,
  buyer_shipping_json     JSONB        NOT NULL,
  place_of_supply_code    CHAR(2)      NOT NULL,
  place_of_supply_name    VARCHAR(64)  NOT NULL,
  supply_type             VARCHAR(24)  NOT NULL,        -- intra_state | inter_state | export | sez
  b2b_or_b2c              VARCHAR(4)   NOT NULL,        -- b2b | b2c
  reverse_charge          BOOLEAN      NOT NULL DEFAULT FALSE,

  -- money, all integer paise
  total_gross_paise       BIGINT NOT NULL,
  total_discount_paise    BIGINT NOT NULL,
  total_taxable_paise     BIGINT NOT NULL,
  total_cgst_paise        BIGINT NOT NULL,
  total_sgst_paise        BIGINT NOT NULL,
  total_igst_paise        BIGINT NOT NULL,
  total_cess_paise        BIGINT NOT NULL DEFAULT 0,
  shipping_paise          BIGINT NOT NULL DEFAULT 0,
  round_off_paise         BIGINT NOT NULL DEFAULT 0,
  grand_total_paise       BIGINT NOT NULL,
  currency                CHAR(3) NOT NULL DEFAULT 'INR',
  amount_in_words         TEXT NOT NULL,

  payment_method          VARCHAR(24) NOT NULL,          -- PREPAID | COD
  payment_reference       VARCHAR(128) NULL,

  -- e-invoice (flagged off in v1)
  irn                     VARCHAR(64) NULL,
  irn_ack_no              VARCHAR(32) NULL,
  irn_ack_date            TIMESTAMPTZ NULL,
  signed_qr_payload       TEXT NULL,

  -- artefact
  pdf_storage_key         TEXT NULL,
  pdf_sha256              CHAR(64) NULL,
  pdf_generated_at        TIMESTAMPTZ NULL,
  status                  VARCHAR(24) NOT NULL,          -- issued | pdf_pending | pdf_failed | cancelled
  template_version        VARCHAR(16) NOT NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_order   ON invoices(order_id);
CREATE INDEX idx_invoices_issued  ON invoices(issued_at);
CREATE INDEX idx_invoices_fy_seq  ON invoices(document_type, fy_code, sequence);
```

### 7.2 `invoice_line_items`

```sql
CREATE TABLE invoice_line_items (
  id                    BIGSERIAL PRIMARY KEY,
  invoice_id            BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  line_no               INTEGER NOT NULL,
  product_id            BIGINT NULL,
  variant_id            BIGINT NULL,
  sku                   VARCHAR(64) NULL,
  description           TEXT NOT NULL,          -- frozen at issue time
  attributes_json       JSONB NULL,             -- see §8.4
  hsn_code              VARCHAR(8) NOT NULL,
  quantity              NUMERIC(12,3) NOT NULL,
  uqc                   VARCHAR(8) NOT NULL,
  unit_price_excl_paise BIGINT NOT NULL,
  gross_excl_paise      BIGINT NOT NULL,
  discount_paise        BIGINT NOT NULL DEFAULT 0,
  taxable_paise         BIGINT NOT NULL,
  gst_rate_bp           INTEGER NOT NULL,
  cgst_paise            BIGINT NOT NULL DEFAULT 0,
  sgst_paise            BIGINT NOT NULL DEFAULT 0,
  igst_paise            BIGINT NOT NULL DEFAULT 0,
  cess_paise            BIGINT NOT NULL DEFAULT 0,
  line_total_paise      BIGINT NOT NULL,
  UNIQUE (invoice_id, line_no)
);
```

### 7.3 Immutability

Issued invoices are **append-only**. Enforce at three levels:

1. Application: no update path for financial columns; the model exposes only `markPdfGenerated()` and `markCancelled()`.
2. Database: a `BEFORE UPDATE` trigger that raises if any monetary column, `invoice_number`, or a snapshot column changes once `status = 'issued'`.
3. Audit: every read of a PDF and every status change appends to `invoice_audit_log (invoice_id, actor_type, actor_id, action, ip, user_agent, created_at)`.

Corrections happen **only** via credit note + fresh invoice. Never edit, never delete, never renumber.

### 7.4 Why snapshot everything

Product names, prices, addresses, and even the company's own details will change. A three-year-old invoice must re-render byte-identically. Therefore: no invoice render path may `JOIN` to `products`, `customers`, or `company_settings`. Everything needed is on `invoices` + `invoice_line_items`. Store `template_version` so a template redesign doesn't retroactively alter old documents — keep old templates in the repo.

### 7.5 PDF storage

- Object storage (S3/R2/GCS) or a non-public disk path. **Never** inside the web root.
- Key pattern: `invoices/<fy_code>/<yyyy-mm>/<invoice_number>.pdf` with `/` replaced by `-` in the filename.
- Store `pdf_sha256`; verify on download and alert on mismatch.
- Serve only through an authenticated application route (§10.2) or a short-lived signed URL (≤ 15 min). Never expose a permanent public URL — invoices contain names, addresses, phone numbers, and GSTINs.
- Lifecycle: retain **8 years minimum** (Indian statutory record retention). Disable any bucket expiry policy on this prefix.

### 7.6 E-invoice (IRN) — build the seam, leave it off

The reference invoice prints an `IRN:` and a signed QR because that supplier's turnover is above the e-invoicing threshold. Our entity almost certainly is not — and the threshold has been revised repeatedly (₹500 Cr → 100 → 50 → 20 → 10 → 5 Cr as of my knowledge cutoff; **verify the current figure**).

**Hard rule for the implementing agent: do not print an `IRN` field, and do not render a QR code that imitates a signed e-invoice QR, unless a real IRP response is present in `invoices.irn`.** A fabricated IRN is a misrepresentation on a statutory document.

Implement:

```
E_INVOICE_ENABLED = false      # flip only after IRP registration
```

When `false`: omit the IRN block and the signed-QR block entirely. A plain QR containing a link to the customer's order page is fine and useful — but label it `Scan to view order`, never `e-Invoice QR`.

When `true`: call the IRP/GSP before rendering; store `irn`, `ack_no`, `ack_date`, `signed_qr_payload`; render the QR from the returned signed payload verbatim. Handle IRP failure by keeping the invoice in `pdf_pending` and retrying — never render a fallback PDF without the IRN once the flag is on.

Separately, the **dynamic QR for B2C** obligation applies only above a much higher turnover threshold. Same rule: flag it, default off.

---

## 8. PDF layout specification

### 8.1 Rendering approach

Recommended: **HTML/CSS → headless Chromium** (Puppeteer / Playwright / `wkhtmltopdf` as a fallback). Rationale: the reference layout is a dense bordered table grid, which CSS handles far better than an imperative canvas API, and the template stays editable by a front-end developer.

If the repo already has a PDF library (`ReportLab`, `PDFKit`, `dompdf`, `@react-pdf/renderer`, `iText`), prefer it over adding Chromium — but verify **Devanagari shaping** support first (§8.3); several of these render Devanagari incorrectly.

Requirements:
- Deterministic output: no `Date.now()` in the template, no remote asset fetches at render time, fonts and images bundled locally.
- Render in a **background job**, not in the HTTP request. Timeout 30 s, 3 retries with exponential backoff, then `status = 'pdf_failed'` + alert.
- Page size A4 (210 × 297 mm), margins 12 mm, print CSS with `-webkit-print-color-adjust: exact`.
- Multi-page: item table header repeats (`thead { display: table-header-group }`), totals block never splits (`break-inside: avoid`), footer shows `Page X of Y`.

### 8.2 Page structure

Mirror the reference invoice's bordered-box structure, rebranded.

```
┌──────────────────────────────────────────────────────────────────────┐
│                            TAX INVOICE                               │  centered, 13pt bold, letter-spaced
│                       Original for Recipient                         │  8pt, grey
├───────────────────┬────────────────────────────┬─────────────────────┤
│ Invoice No:       │      [ TREDEV LOGO ]       │      41422          │  ← large order-ref digits
│  TRE/2627/000123  │                            │   Order Reference   │
│ Invoice Date:     │  Optimaxin Software        │  ┌───────────────┐  │
│  13/08/2026       │  Solutions Private Limited │  │ ||| barcode |||│  │
│ Order No:         │  (Tredev Gems)            │  └───────────────┘  │
│  #TRE1347641422   │                            │  SHIP-XXXXXXXX      │
│ Order Date:       │  Reg. Office: Iglas Road,  │                     │
│  06/08/2026       │  Hathras, Hathras - 204101 │  Payment Method:    │
│ ┌───────────────┐ │  Uttar Pradesh (09), India │     PREPAID         │
│ │||| barcode ||││ │  GSTIN: 09AAECO5418P1ZV    │  Order Type: 1      │
│ └───────────────┘ │  PAN: AAECO5418P           │                     │
│   1347641422      │  CIN: <...>                │                     │
│ Shipment Code:    │  Email: support@...        │                     │
│  SHIP-XXXXXXXX    │  tredev-gems.vercel.app       │                     │
│                   │  +91-XXXXXXXXXX (10AM-7PM) │                     │
├───────────────────┴──────────────┬─────────────┴─────────────────────┤
│ BILL TO ADDRESS                  │ ADDRESS OF DELIVERY   │ Gift From:│
│ GSTIN No: <if B2B>               │ <name>                │ Gift To:  │
│ PAN: <if provided>               │ <line1, line2>        │ Customer  │
│ <name>                           │ <city> - <pin>        │ Comments: │
│ <address lines>                  │ <state>(<code>), India│           │
│ <city> - <pin>                   │ Phone: <masked>       │           │
│ <state>(<code>), India           │                       │           │
│ Place of supply: Uttar Pradesh(09)│                      │           │
├──────────────────────────────────┴───────────────────────┴───────────┤
│ ITEM TABLE  (see §8.3 for columns)                                   │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────┐        Total Taxable Amount :              1,798.61      │
│  │  QR    │        CGST :                                  44.97     │
│  │        │        SGST :                                  44.97     │
│  └────────┘        IGST :                                   0.00     │
│  Scan to view      Round Off :                              0.45     │
│  your order        ─────────────────────────────────────────────     │
│                    Grand Total (incl. of taxes) :         1,889.00    │
├──────────────────────────────────────────────────────────────────────┤
│ Total Price in words : INR One Thousand Eight Hundred Eighty Nine    │
│                        Rupees Only                                   │
├──────────────────────────────────────────────────────────────────────┤
│ Declarations:                          │  Optimaxin Software         │
│ 1. This is a computer generated invoice│  Solutions Private Limited  │
│ 2. Tax is payable on reverse charge    │                             │
│    basis: No                           │     [ signature image ]     │
│ 3. The information provided in this    │                             │
│    invoice is true and correct to the  │  Authorised Signatory       │
│    best of the seller's knowledge.     │                             │
│ 4. ITC Available: Yes                  │                             │
│ 5. For T&C please refer to               │                           │
│    tredev-gems.vercel.app/terms          │                           │
│ 6. Certificates, where applicable, are   │                           │
│    supplied with the product.            │                           │
├──────────────────────────────────────────────────────────────────────┤
│  Tredev Gems is a brand of Optimaxin Software Solutions Private       │
│  Limited · optimaxin.com                                             │
└──────────────────────────────────────────────────────────────────────┘
                                                        Page 1 of 1
```

### 8.3 Item table columns

Exactly these, in this order (matching the reference invoice so accountants recognise it):

| Col | Header | Width | Align |
|---|---|---|---|
| 1 | `Description of Goods` | 28% | left |
| 2 | `HSN` | 8% | center |
| 3 | `Unit Price (Excl. Tax)` | 9% | right |
| 4 | `Qty` | 5% | center |
| 5 | `UQC` | 5% | center |
| 6 | `Gross Price (Excl. Tax)` | 9% | right |
| 7 | `Discount` | 8% | right |
| 8 | `Taxable Value` | 9% | right |
| 9 | `CGST` + `SGST` (intra) **or** `IGST` (inter) | 10% | right |
| 10 | `Total Invoice Value` | 9% | right |
| 11 | `Cur` | 4% | center |

Column 9 renders the rate beneath the amount, as `44.97` / `@2.5%` — exactly the reference invoice's two-line treatment. For intra-state, render CGST and SGST as **two separate sub-columns**; the header must switch dynamically based on `supply_type`. Never show empty IGST and CGST columns side by side.

### 8.4 Line description composition (category-specific)

This is where the invoice earns trust for a spiritual-goods brand. Compose the description from `attributes_json`:

```
Natural Yellow Sapphire (Pukhraj) — Unheated
Weight: 5.25 Ratti (4.72 Carat) | Origin: Ceylon
Lab Certificate No: GLI-2026-88213
SKU: TRE-GEM-PKH-525 | Product ID: 216617
```

```
5 Mukhi Rudraksha Mala — 108 + 1 Beads
Bead Size: 8mm | Origin: Nepal | Thread: Cotton, Red
Energised: Yes (Rudrabhishek, 11 Aug 2026)
SKU: TRE-RDX-5M-108
```

Attribute keys to support: `weight_ratti`, `weight_carat`, `weight_grams`, `mukhi`, `bead_count`, `bead_size_mm`, `origin`, `metal`, `metal_purity`, `certificate_authority`, `certificate_no`, `treatment` (heated/unheated), `energised`, `energised_on`, `energised_ritual`.

Render as: bold product title, then attribute lines at 7pt, then SKU/product-ID line at 6.5pt grey. Cap at 6 attribute lines; overflow to "…" and rely on the order page for the full detail.

> **Content caution:** print factual product attributes only. Do **not** print astrological, medical, or efficacy claims ("cures ailments", "guarantees wealth", "removes doshas") on the invoice. A tax invoice is a legal record; efficacy claims on it create consumer-protection and advertising-standards exposure that marketing copy does not. Keep the ritual/energisation field to a factual statement of what was performed and when.

### 8.5 Typography, colour, branding

```css
--font-body:     'Inter', 'Noto Sans', sans-serif;      /* Latin */
--font-devanagari: 'Noto Sans Devanagari', sans-serif;  /* MANDATORY */
--font-mono:     'Roboto Mono', monospace;              /* numbers, codes */

--ink:           #1A1A1A;   /* body text */
--ink-muted:     #6B6B6B;   /* labels, fine print */
--rule:          #000000;   /* table borders, 0.5pt */
--rule-light:    #CCCCCC;
--brand:         <TREDEV PRIMARY — e.g. deep saffron #C1440E>
--brand-accent:  <e.g. gold #B8860B>
--paper:         #FFFFFF;
```

Type scale: title 13pt bold; section headers 8pt bold uppercase; body 8pt; table body 7.5pt; fine print 6.5pt. All numeric cells use tabular figures (`font-variant-numeric: tabular-nums`) so columns align.

Colour discipline: keep the document essentially black-on-white. Use `--brand` only for the logo, the section-header rules, and the grand-total row. Invoices get printed on mono office printers — verify legibility in greyscale, and use `logo_mono_path` for a `print` media query if the primary logo relies on colour contrast.

**Devanagari requirement:** product names, the brand tagline, and buyer names may contain Devanagari (रुद्राक्ष, त्रिदेव). Bundle `NotoSansDevanagari-Regular.ttf` and `-Bold.ttf` as local `@font-face` files and set the font stack so Devanagari falls back correctly. Add a smoke test that renders a Devanagari product name and asserts no `.notdef` boxes (compare rendered-page pixel hash against a known-good fixture). This is the single most common silent failure in Indian invoice PDFs.

**Logo assets needed from the owner:**
- `tredev-logo.svg` — primary, horizontal lockup, min 180 px wide equivalent
- `tredev-logo-mono.svg` — single-colour version
- `signature.png` — transparent background, ~400 × 150 px
- Optional watermark: logo at 4% opacity, centred, behind the item table. Keep it subtle; it must not reduce OCR legibility of the numbers.

### 8.6 Barcodes and QR

- Order barcode: **Code128**, encoding the order number. Height 12 mm, quiet zone 2 mm, human-readable text beneath.
- Shipment barcode: Code128 of the shipment/AWB code, top-right box.
- QR: order-lookup URL (`https://tredev-gems.vercel.app/orders/<token>`), error correction level M, 22 × 22 mm. Label it `Scan to view your order` — see the naming prohibition in §7.6.
- Generate barcodes/QR as inline SVG or base64 data URIs; no external image requests during render.

---

## 9. Generation lifecycle

### 9.1 Trigger points

| Event | Action |
|---|---|
| Payment captured (prepaid) | Enqueue `GenerateInvoiceJob(order_id, shipment_id)` |
| Order marked shipped (COD) | Enqueue `GenerateInvoiceJob` — COD invoices are issued at dispatch |
| Shipment split across parcels | One invoice **per shipment** (the reference invoice does exactly this — three invoices for one order) |
| Order cancelled pre-invoice | No invoice at all |
| Order cancelled post-invoice | Full credit note |
| Return / refund accepted | Credit note for the returned lines |
| Price correction | Credit note, then fresh invoice |

### 9.2 Idempotency

`idempotency_key = sha256("{document_type}|{order_id}|{shipment_id}|{revision}")`, unique-constrained. On conflict, the job returns the existing invoice and exits successfully. Retried webhooks, double-clicked admin buttons, and at-least-once queues must never produce two invoices for one shipment.

### 9.3 Job sequence

```
1. Load order + shipment + snapshot data.               [read]
2. Validate:                                            [pure]
     - order is paid (or COD-dispatched)
     - every line has hsn_code, gst_rate_bp, uqc
     - shipping address has a resolvable state_code
     - buyer_gstin, if present, passes regex + checksum
   → any failure: status=blocked, alert accounts team, DO NOT allocate a number.
3. Compute taxes (§5) — pure function.                  [pure]
4. Assert grand_total == amount captured (§5.4).        [pure]
5. BEGIN TRANSACTION
     allocate invoice number (§4.3)
     insert invoices row (status = 'pdf_pending')
     insert invoice_line_items rows
   COMMIT
6. [if E_INVOICE_ENABLED] call IRP, persist IRN.        [external]
7. Render PDF, compute sha256, upload to storage.       [external]
8. Update status = 'issued', set pdf_* columns.
9. Enqueue InvoiceEmailJob (separate job — email failure
   must never roll back a validly issued invoice).
```

Steps 6–8 are retryable and idempotent. Step 5 happens exactly once.

### 9.4 Credit notes

Same renderer, `document_type = 'credit_note'`, `TRC/` series, heading **"Credit Note"**, and an added `Original Invoice No / Date` field. Must reference `parent_invoice_id`. Tax reversal mirrors the original invoice's rate and CGST/SGST-vs-IGST split — recompute from the **parent invoice's stored line values**, not from current product data. Amounts are stored positive with `document_type` conveying direction; the PDF labels them `Credit Amount`.

---

## 10. API surface

### 10.1 Customer-facing

```
GET  /api/orders/:orderId/invoices
     → [{ invoiceNumber, issuedAt, grandTotal, documentType, downloadUrl }]
     Auth: session owner of the order only.

GET  /api/invoices/:invoiceNumber/pdf
     → 302 to signed URL, or streams application/pdf
       Content-Disposition: attachment; filename="Tredev-Invoice-TRE-2627-000123.pdf"
     Auth: session owner. Rate limit 20/min/user.
```

### 10.2 Access control (non-negotiable)

- Authorise on **order ownership**, never on possession of the invoice number. Sequential numbers make an unauthorised endpoint a full customer-data leak (names, addresses, purchase history) — this is the highest-severity risk in the whole feature.
- Guest checkout: access via a signed, expiring token emailed to the buyer; no plain-number lookup.
- Log every download to `invoice_audit_log`.

### 10.3 Admin

```
GET  /admin/api/invoices?from&to&state&supplyType&b2b&q&page
POST /admin/api/invoices/:id/regenerate-pdf        # re-render only; number & amounts unchanged
POST /admin/api/orders/:id/credit-note             # body: { lines:[{lineId, qty}], reason }
GET  /admin/api/invoices/export?from&to&format=csv|json
GET  /admin/api/gstr1/export?month=2026-08         # §11
```

Admin routes require role `accounts` or `admin`, and every mutating call is audit-logged with actor identity.

---

## 11. GSTR-1 / accounting export

Monthly export, one file per section, matching the GST offline-utility column order:

| Section | Contents |
|---|---|
| **B2B** | Invoices where `buyer_gstin` is present |
| **B2CL** | Inter-state B2C invoices above the B2C-large threshold (verify current figure — historically ₹2.5 lakh) |
| **B2CS** | All other B2C, aggregated by place of supply + rate |
| **CDNR / CDNUR** | Credit notes, registered / unregistered |
| **HSN** | Per HSN + rate: total quantity, UQC, taxable value, CGST, SGST, IGST, cess |
| **DOCS** | Documents issued: series, from-number, to-number, total count, cancelled count |

The **DOCS** section is why gapless numbering matters — it declares the exact range issued. Derive it from `invoice_sequences` + `invoices`, and add a monthly integrity job that asserts no missing sequence numbers exist in each series. Alert on any gap.

Also provide a plain reconciliation CSV (one row per line item, all money columns in rupees to 2 dp) for the CA — they will ask for it in month one.

---

## 12. Test plan

### 12.1 Unit tests — tax engine (must all pass before anything else is built)

| Case | Input | Expected |
|---|---|---|
| Intra-state, inclusive, 3% | UP delivery, 1 × ₹1,030 incl. | taxable 1000.00, CGST 15.00, SGST 15.00, IGST 0, total 1030.00 |
| Inter-state, inclusive, 3% | MH delivery, 1 × ₹1,030 incl. | taxable 1000.00, IGST 30.00, CGST/SGST 0, total 1030.00 |
| Low-rate stone, 0.25% | UP, 1 × ₹10,025 incl. | taxable 10000.00, CGST 12.50, SGST 12.50 |
| Odd-paise CGST split | tax total 44.95 | CGST 22.48, SGST 22.47, sum exactly 44.95 |
| Mixed rates + order coupon | 3 lines @ 3%/5%/nil, ₹500 coupon | coupon apportioned pro rata, remainder to largest line, line sum == order total |
| Shipping apportionment | 2 lines mixed rate + ₹99 shipping | shipping split pro rata, no rounding drift |
| Round-off | grand total 1,888.55 | round_off +0.45, grand total 1,889.00 |
| Exempt item | nil-rate product | tax 0, prints `NIL`, appears in HSN summary with 0 tax |
| Discount ≥ line value | discount > gross | taxable clamped to 0, warning logged |
| Qty > 1 with paise unit price | 3 × ₹333.33 incl. | no drift; line total == 3 × unit exactly |
| UT delivery | Chandigarh (04) | label renders `UTGST`, not `SGST` |

### 12.2 Numbering tests

- 1,000 concurrent generations → 1,000 distinct sequential numbers, zero gaps, zero duplicates (run against real Postgres, not a mock).
- 31 Mar 23:59 IST vs 1 Apr 00:01 IST → sequence resets and `fy_code` advances.
- PDF render failure → number retained, status `pdf_failed`, retry reuses the same number.
- Duplicate webhook → single invoice, second call returns the first.

### 12.3 Rendering tests

- Golden-file test: fixture invoice → rendered PDF page hash matches committed reference (regenerate deliberately on template change; bump `template_version`).
- Devanagari fixture → no missing-glyph boxes.
- 60-line invoice → correct pagination, repeated table header, unsplit totals block, `Page X of Y`.
- Long product name (200 chars) + 6 attribute lines → no overflow outside cell borders.
- B2B (with GSTIN) and B2C variants both render the correct field set.
- Greyscale print check.
- All 36 state/UT codes resolve to a name and correct tax label.

### 12.4 Acceptance criteria

- [ ] Every paid order produces exactly one invoice per shipment, within 60 s of payment capture.
- [ ] `grand_total` equals the amount captured, on 100% of invoices; any mismatch blocks issuance and alerts.
- [ ] All 18 Rule 46 fields present — asserted by an automated content test against extracted PDF text.
- [ ] Invoice numbers are unique, sequential, gapless, ≤ 16 chars, FY-scoped.
- [ ] No invoice PDF is reachable without order-ownership authorisation (verified by a negative test using another user's session).
- [ ] Issued invoices cannot be mutated (verified by a DB-level test attempting a direct `UPDATE`).
- [ ] Credit note reverses tax on the same head and rate as its parent.
- [ ] GSTR-1 export totals reconcile to the invoice table to the paisa.
- [ ] A CA has reviewed one sample invoice of each type (B2B intra, B2B inter, B2C intra, B2C inter, credit note) and signed off.

---

## 13. Things not to do

1. **Do not** print a fabricated IRN or a fake e-invoice QR code (§7.6).
2. **Do not** hardcode GST rates or HSN codes anywhere in code or templates (§6).
3. **Do not** use floating-point arithmetic for money at any point (§5.3).
4. **Do not** allocate an invoice number before validation passes, and never reuse or delete one (§4.3).
5. **Do not** `JOIN` to live product/customer/company tables when rendering (§7.4).
6. **Do not** authorise PDF access by invoice number (§10.2).
7. **Do not** edit or delete an issued invoice for any reason — credit note only (§7.3).
8. **Do not** derive place of supply from the billing address for goods (§5.1).
9. **Do not** ship without embedded Devanagari fonts (§8.5).
10. **Do not** put the PDF renderer in the request path (§8.1).
11. **Do not** print astrological or medical efficacy claims on a statutory document (§8.4).
12. **Do not** copy Lenskart's trade dress — logo, wording, or their entity/GSTIN details. Use their invoice for *structure* only; every identifier on our invoice must be ours.

---

## 14. Suggested build order

| Phase | Deliverable |
|---|---|
| 1 | `lib/gst/` pure tax engine + amount-in-words + full §12.1 test suite passing |
| 2 | Migrations, models, immutability trigger, `company_settings`, product tax fields + admin UI |
| 3 | Numbering service + §12.2 concurrency tests |
| 4 | HTML template + branding assets + renderer + §12.3 golden files |
| 5 | Job orchestration, idempotency, storage, sha256 verification |
| 6 | Customer + admin APIs, access control, negative auth tests |
| 7 | Email delivery with PDF attachment |
| 8 | Credit notes |
| 9 | GSTR-1 export + gap-integrity monitor |
| 10 | E-invoice seam behind the flag (no live calls) |

Phases 1–3 are the load-bearing ones. Resist building the PDF first — a beautiful invoice with wrong tax maths is worse than no invoice.

---

## Appendix A — Reference invoice field mapping

| Lenskart field | Tredev equivalent | Notes |
|---|---|---|
| Shipment Code `SLKST…` | `shipment_id` / AWB | Own prefix scheme, e.g. `TRES…` |
| `Order : # 1347641422` | `TRE<order_id>` | Own numbering |
| Supplier GSTIN `06AACCV…` | `09AAECO5418P1ZV` | UP, not Haryana |
| Multiple invoices per order | Same behaviour | Per shipment |
| `Product Id:216617` | SKU + internal product ID | Keep for support lookups |
| `Fitting Fee` (service line, 9965xx) | Packing / customisation / energisation fee, if charged | Own HSN, CA-verified |
| `Inclusive of Lens Package: …` | Attribute lines (§8.4) | Weight, mukhi, certificate |
| `ITC Available : Yes` | Keep | |
| `IRN:` + signed QR | **Omit in v1** | §7.6 |
| `Gift From / Gift To / Customer Comments` | Keep | High relevance for gifting category |
| `Order Type: 1` | Order channel/type enum | Document what values mean |

## Appendix B — Assets and inputs required from the business owner

1. GST registration certificate (to verify legal name, GSTIN, address, and the registered trade name).
2. Certificate of Incorporation (for CIN).
3. Logo files: primary SVG, mono SVG, favicon-grade PNG. If the highest-quality source available is the storefront build, extract the asset from the `tredev-gems.vercel.app` bundle rather than screenshotting it — a raster logo scaled up will look poor at 300 dpi print resolution. If only a low-resolution raster exists, redraw it as SVG before shipping.
   Also confirm the brand colours by reading them from the storefront's stylesheet so the invoice matches the site exactly, instead of eyeballing the hex codes.
4. Brand colour hex codes (primary, accent).
5. Scanned authorised-signatory signature, transparent PNG.
6. Support email and phone with stated service hours.
7. Terms-and-conditions and return-policy URLs.
8. Final HSN + GST rate table per product category, CA-approved (§6).
9. Confirmation of whether displayed prices include GST.
10. Number of places of business / dispatch locations.