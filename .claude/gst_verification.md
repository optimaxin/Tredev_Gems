# Technical Spec: GSTIN Verification at Checkout via Cashfree Secure ID

**Prepared for:** Optimaxin engineering (implementation via Claude Code)
**Author context:** Written from a product request; API details below were pulled from Cashfree's public docs on 2026-08-16 and should be re-confirmed against the live [Cashfree Secure ID / KYB docs](https://www.cashfree.com/docs/secure-id/know-your-business/verify-gstin) and Postman collection before coding, since vendor docs change and some detail here was extracted via automated summarization rather than a verbatim read.

---

## 1. Goal

Add an optional GSTIN field to checkout. If a customer enters a GSTIN, they must click **Verify** to validate it via Cashfree Secure ID's Know-Your-Business (KYB) GSTIN verification API. On success, the **Business Name** field is auto-filled from Cashfree's response. The customer can never type into the Business Name field themselves — it is only ever populated by a successful Cashfree verification, both visually (frontend) and structurally (backend never accepts a client-supplied business name).

## 2. UX Flow

1. Checkout shows a collapsed toggle: **"Have a GST number? (optional)"**.
2. Expanding it reveals two fields:
   - **GST Number (GSTIN)** — free text, editable.
   - **Registered Business Name** — always rendered `disabled`/`readonly`, empty by default, with placeholder text like "Auto-filled after GSTIN verification."
3. A **Verify** button sits next to (or under) the GSTIN field. It is disabled until the GSTIN matches the standard 15-character format (client-side regex, see §6.1) and becomes enabled once the format is valid.
4. On click, the button enters a loading state ("Verifying…"). The GSTIN input becomes read-only while a request is in flight, to avoid race conditions from edited-then-submitted values.
5. **On success:** Business Name field fills with the verified name, a green check + "Verified" label appears next to the GSTIN field, and the GSTIN input locks (read-only) with an "Edit"/"Change GSTIN" link that, if clicked, clears both the verified state and the Business Name field and re-enables editing.
6. **On failure** (bad GSTIN, not found, Cashfree error/timeout): show an inline error message under the GSTIN field (e.g. "We couldn't verify this GSTIN. You can retry, or continue checkout without it."). The Business Name field stays empty/disabled. The GSTIN field remains editable and the Verify button re-enables.
7. **Checkout is never blocked** on GSTIN verification (per product decision). If the customer proceeds without a successful verification, the order is placed as normal and no GSTIN/business name is attached to the order or invoice — the entered-but-unverified GSTIN is discarded, not silently trusted. If they never expand the toggle, nothing changes from today.

## 3. Architecture

```
Browser  ──POST /api/gstin/verify──▶  Our Backend  ──POST /verification/gstin──▶  Cashfree Secure ID
   ▲                                        │                                            │
   │                                        ▼                                            │
   │                                 gstin_verifications                                 │
   │                                 cache table (DB)                                    │
   │◀───────── {verified, businessName, gstin} ─────────┘◀──────── response ─────────────┘
```

**Cashfree must never be called directly from the browser.** The Client Secret cannot be exposed client-side, and letting the browser call Cashfree directly would let anyone verify arbitrary GSTINs against your paid quota and would make it trivial to fabricate a fake "verified" response in devtools. All calls to Cashfree go through our own backend, which holds the credentials server-side (env vars / secrets manager, never committed to source).

This also gives us the critical security property described in §5: **the backend, not the browser, is the source of truth for "this GSTIN was verified and its business name is X."**

## 4. Cashfree API (server-to-server call)

> ⚠️ Confirm these exact values against Cashfree's current reference/Postman collection before implementing — endpoint paths and header names occasionally change between doc revisions.

- **Base URLs:**
  - Sandbox: `https://sandbox.cashfree.com/verification`
  - Production: `https://api.cashfree.com/verification`
- **Endpoint:** `POST /gstin` (full path as currently documented: `/api/v2/verification/gstin` off the verification host — reconcile the exact combined path against the docs/Postman collection when wiring this up)
- **Headers:**
  ```
  X-Client-Id: <CASHFREE_CLIENT_ID>
  X-Client-Secret: <CASHFREE_CLIENT_SECRET>
  Content-Type: application/json
  ```
  (Also check whether the current API version requires an `x-api-version` header — recent Cashfree APIs commonly do.)
- **Request body:**
  ```json
  {
    "gstin": "09AAECO5418P1ZV"
  }
  ```
- **Success response (shape to design against):**
  ```json
  {
    "status": "SUCCESS",
    "message": "GSTIN verified successfully",
    "data": {
      "gstin": "09AAECO5418P1ZV",
      "legal_name": "ABC Private Limited",
      "trade_name": "ABC Trading",
      "registration_date": "2018-07-01",
      "taxpayer_type": "Regular",
      "business_type": "Private Limited Company",
      "registration_status": "Active",
      "registered_address": {
        "address": "123 Business Street",
        "city": "Delhi",
        "state": "Delhi",
        "pincode": "110001"
      },
      "constitution_of_business": "Private Limited Company"
    }
  }
  ```
- **Error response shape:**
  ```json
  {
    "status": "FAILED",
    "message": "Invalid GSTIN format",
    "error_code": "INVALID_GSTIN"
  }
  ```
- **Business name to use downstream:** prefer `trade_name`; fall back to `legal_name` if `trade_name` is blank. Store both.
- **Rate limit:** documented as ~100 requests/minute per API key — the caching layer in §7 exists partly to keep well under this.
- Credentials already exist for this account (sandbox + production); just document required env vars, e.g. `CASHFREE_VERIFICATION_CLIENT_ID`, `CASHFREE_VERIFICATION_CLIENT_SECRET`, `CASHFREE_VERIFICATION_ENV` (`sandbox`|`production`).

## 5. Internal API: `POST /api/gstin/verify`

This is the endpoint the frontend actually calls. It wraps the Cashfree call, enforces caching, and is the only thing the browser talks to.

**Request:**
```json
{ "gstin": "09AAECO5418P1ZV" }
```

**Response (verified):**
```json
{
  "verified": true,
  "gstin": "09AAECO5418P1ZV",
  "businessName": "ABC Trading",
  "verificationId": "gv_8f2c1a...",
  "verifiedAt": "2026-08-16T10:15:00Z"
}
```

**Response (failed):**
```json
{
  "verified": false,
  "reason": "INVALID_GSTIN",
  "message": "We couldn't verify this GSTIN."
}
```

**Server-side logic:**
1. Validate GSTIN format server-side too (never trust the client-side regex alone) — reject malformed input with `400` before touching Cashfree or the cache.
2. Look up `gstin` in the `gstin_verifications` cache table (§7). If a non-expired row exists, return it directly — skip the Cashfree call entirely.
3. Otherwise call Cashfree per §4. On success, upsert the cache row and return `verified: true` with the business name and a `verificationId` (the cache row's ID).
4. On Cashfree failure/timeout, return `verified: false` with a reason. Do not cache negative results (a currently-invalid GSTIN could become valid later, or the failure could be transient) — optionally cache hard `INVALID_GSTIN` format rejections briefly to avoid hammering Cashfree on the same bad input, but this is a minor optimization, not a requirement.
5. Log every call (gstin, outcome, latency, error_code if any) for observability and reconciliation against Cashfree's own usage dashboard.

## 6. Frontend Requirements

### 6.1 GSTIN format pre-validation (before enabling Verify / before calling our backend)

Standard GSTIN pattern (15 characters): 2-digit state code + 10-character PAN + 1-digit entity number + `Z` (literal) + 1 checksum character.

```regex
^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$
```

Use this only to enable/disable the Verify button and give instant feedback on obviously malformed input — it is **not** a substitute for the real verification call, and the backend must re-validate it independently (§5, step 1).

### 6.2 Component states

| State | GSTIN field | Business Name field | Verify button |
|---|---|---|---|
| Toggle collapsed | hidden | hidden | hidden |
| Empty / typing | editable | disabled, empty | disabled until format valid |
| Format valid, not yet verified | editable | disabled, empty | enabled, label "Verify" |
| Verifying (request in flight) | read-only | disabled, empty | disabled, label "Verifying…" + spinner |
| Verified | read-only + "Change" link | disabled, filled with verified name | hidden or replaced with "✓ Verified" |
| Verification failed | editable, error styling | disabled, empty | enabled, label "Retry" |

### 6.3 Hard rule

The Business Name `<input>` must be `disabled` (or `readOnly`, but `disabled` is preferred so its value can't be tampered with via devtools re-enabling and still get submitted as a name the user typed — see note below) at all times in the DOM. Its value is only ever set programmatically from the `/api/gstin/verify` response. There is no code path in the frontend that writes user keystrokes into this field.

> Note: a technically savvy user can always re-enable a `disabled` input via devtools and type an arbitrary value, then submit the form. This is why §5 and §7 make the **backend** re-derive the business name from its own verified cache rather than ever trusting a client-submitted business name — the frontend restriction is a UX affordance, not the security boundary.

## 7. Data Model & Caching

### 7.1 `gstin_verifications` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid/pk | |
| `gstin` | varchar(15), unique index | |
| `legal_name` | text | from Cashfree `data.legal_name` |
| `trade_name` | text, nullable | from Cashfree `data.trade_name` |
| `registration_status` | varchar | e.g. "Active" |
| `raw_response` | jsonb | full Cashfree payload, for audit/support |
| `verified_at` | timestamptz | |
| `expires_at` | timestamptz | `verified_at` + TTL |
| `source` | varchar | `"cashfree"` (future-proofs for a second provider) |

**TTL:** default 60 days (business registration details rarely change; adjust as needed — 30–90 days is reasonable). A verification past `expires_at` is treated as a cache miss and re-verified live on next use.

### 7.2 Linking a verified GSTIN to an order

Do **not** let checkout submission carry a client-provided `businessName` field at all. When an order is finalized:

1. If the checkout payload includes a `gstin`, look it up in `gstin_verifications`.
2. If found and not expired → attach `gstin`, `legal_name`, `trade_name` to the order/invoice record, referencing `verification_id`.
3. If not found or expired (customer typed a GSTIN but never successfully verified it, or verified it long enough ago that it lapsed) → per the product decision, **drop the GSTIN silently** and place the order without GST details on the invoice. Optionally surface a non-blocking notice ("GST details weren't added since verification wasn't completed") — UX call, not a hard requirement.

This guarantees the invoice can only ever show a business name that Cashfree actually returned for that exact GSTIN — never anything a user typed.

## 8. Error Handling

| Scenario | Behavior |
|---|---|
| Malformed GSTIN (client) | Verify button stays disabled; inline hint shows expected format. |
| Malformed GSTIN (reaches backend anyway) | `400`, `reason: "INVALID_FORMAT"`. |
| Cashfree returns `INVALID_GSTIN` / not found | `verified: false`, show "We couldn't verify this GSTIN — double-check the number or continue without it." |
| Cashfree timeout / 5xx | `verified: false`, show a generic retry message; log for monitoring; do not cache. |
| Cashfree rate limit hit | Backend should back off and surface a "Try again in a moment" message; this is another reason caching (§7) matters. |
| Duplicate rapid clicks on Verify | Debounce/disable button while a request is in flight (§6.2 "Verifying" state) to avoid double-billing the same GSTIN check. |

## 9. Security Checklist

- Cashfree `X-Client-Id` / `X-Client-Secret` live only in backend env vars / secrets manager — never in frontend bundles, never logged in plaintext.
- Separate sandbox vs. production credentials per environment; production keys require OTP-gated generation on Cashfree's dashboard per their docs — make sure whoever rotates keys knows this.
- All Cashfree calls happen server-side only.
- Business name is never accepted as client input anywhere in the checkout payload — it is always re-derived server-side from the verification cache (§7.2). This is the main integrity guarantee of the whole feature.
- Rate-limit our own `/api/gstin/verify` endpoint per session/IP to prevent it being used to enumerate/brute-force GSTINs against Cashfree's paid API.
- Log verification attempts (success/failure/error codes) for support and reconciliation with Cashfree billing, but avoid logging full raw responses anywhere with broad access, since they contain business PII (registered address, etc.).

## 10. Testing Plan

- Unit test the GSTIN regex (valid/invalid formats, edge cases like lowercase input, extra whitespace).
- Integration test `/api/gstin/verify` against Cashfree's **sandbox** environment with known good/bad test GSTINs (request test GSTINs from Cashfree support/docs if not already available).
- Test cache hit path: verify same GSTIN twice within TTL, confirm second call doesn't hit Cashfree (mock/spy on the outbound call).
- Test cache expiry path: force `expires_at` into the past, confirm re-verification occurs.
- Test checkout submission with: (a) no GSTIN entered, (b) GSTIN entered + verified, (c) GSTIN entered but never verified, (d) GSTIN entered, verified, then changed to a different unverified GSTIN before submit — confirm the order only ever attaches a verified, matching GSTIN/business name.
- Manually confirm via devtools that re-enabling the Business Name input and typing a value has zero effect on the final order record (validates §5/§7.2's server-side enforcement).
- Load/latency test: confirm Verify button UX (spinner, disabled states) feels responsive given Cashfree's documented sub-second typical response time, and degrades gracefully on slow responses.

## 11. Open Items to Confirm Before/During Implementation

1. Exact current Cashfree endpoint path and any additional required headers (e.g. `x-api-version`) — reconcile against the live docs/Postman collection referenced above; the summary in §4 may not be verbatim.
2. Whether sandbox and production truly share the same request/response schema (typically yes for Cashfree, but confirm).
3. Preferred cache TTL (default proposed: 60 days).
4. Whether a non-blocking notice should be shown when a GSTIN is dropped for lack of verification (§7.2, step 3) or whether it should fail silently.
5. Frontend framework/stack specifics (this spec is framework-agnostic; adapt component states in §6 to whatever the checkout is built in).

---

**References**
- [Cashfree Secure ID — Introduction](https://www.cashfree.com/docs/secure-id/introduction)
- [Cashfree Secure ID — Know Your Business Overview](https://www.cashfree.com/docs/secure-id/know-your-business/overview)
- [Cashfree Secure ID — Verify GSTIN](https://www.cashfree.com/docs/secure-id/know-your-business/verify-gstin)
- [Cashfree — Documentation Index](https://www.cashfree.com/docs/llms.txt)