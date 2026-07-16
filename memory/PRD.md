# GEMORA — Product Requirements Document
_Last updated: 12 Feb 2026_

## Original Problem Statement
GEMORA — A trusted, first-party store for authentic spiritual products (gemstones, rudraksha, bracelets, yantras, idols, pooja kits, temple prashad, spiritual books, digital). Not a marketplace — GEMORA sources, certifies and sells its own inventory.

**Core idea:** Anyone can *claim* a stone is real; GEMORA lets you **prove it**. Every high-value item is a serialised physical unit carrying its own cryptographically signed authenticity certificate (Ed25519), lab report, temple energisation record, pooja recording and a scannable QR whose public verification page shows *that exact stone's* provenance.

## Trust Lifecycle (implemented end-to-end)
`INTAKE → CERTIFY → SIGN → SELL (reserve) → PAY → SHIP (activate QR) → VERIFY → OWN (My Verified Items) → RETURN (revoke)`

## Architecture
- **Backend:** FastAPI + Motor + MongoDB. All routes under `/api`. Single `server.py`.
- **Frontend:** React (CRA) + Tailwind + Shadcn UI + Framer Motion + Phosphor Icons.
- **Crypto:** Ed25519 (cryptography lib). Persisted private key in `backend/.env` as `ED25519_PRIVATE_KEY_HEX`. Public key exposed at `GET /api/`.
- **Payments:** Razorpay (webhook signature verify) + `/api/checkout/mock-pay/:order_id` fallback when keys not configured.
- **Auth:** JWT email/password + Emergent-managed Google OAuth session exchange.
- **Concurrency guarantee:** Unique partial index on `reservations.unit_id where status in {reserved,sold}` — database physically rejects double-selling.

## Personas
- **Seeker (retail buyer)** — wants to buy a real stone; needs proof; scans the QR before opening the parcel.
- **GEMORA Admin** — intakes units, issues certificates, dispatches parcels, activates QRs.
- **Independent verifier** (jeweller/appraiser) — verifies a certificate against the public key without any GEMORA account.

## Core requirements (static)
1. Every serialised unit has a signed certificate + activated-on-dispatch QR.
2. Public `/verify/:qr_token` renders AUTHENTIC / SUSPICIOUS / REVOKED.
3. Cart reservation is atomic and unique per unit.
4. Payment confirmation is signature-verified before flipping units to `sold`.
5. Dispatch scan is what activates the QR and adds it to the buyer's permanent vault.
6. Returns revoke the certificate; the old QR then reads REVOKED forever.

## Implemented (Feb 2026, first cut)
### Backend (`/app/backend/server.py`)
- ✅ Auth: `/api/auth/signup`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/session` (Emergent OAuth exchange).
- ✅ Catalog: `/api/products`, `/api/products/:slug` (returns available units + cert flag), `/api/categories`. Vernacular synonym expansion (pukhraj→Yellow Sapphire etc).
- ✅ Cart & reservation with unique partial index enforcement.
- ✅ Checkout: creates Razorpay order (or mock), signature-verify endpoint, atomic mark-paid.
- ✅ Admin: create products, add units, issue Ed25519-signed certificate, dispatch (activates QR + populates buyer vault), revoke cert.
- ✅ Public verify: SHA-256 hash + Ed25519 signature re-check on read.
- ✅ Verified-items vault, wishlist, reviews.
- ✅ Consultation astrologers + booking.
- ✅ Idempotent seed `/api/dev/seed` (8 products, 2 units each serialised, signed & activated certs).

### Frontend
- ✅ Storefront chrome: announcement bar (rotating, dismissible), sticky header with data-driven **mega-menu** (Rudraksha / Gemstones / Bracelets & Mala / Yantras & Pooja / Shop-by-Purpose / Consult), search overlay with vernacular synonyms, slide-over cart drawer, mobile drawer, footer with trust links.
- ✅ Homepage stack: hero carousel (3 slides) · TrustStrip · Category tiles · "Find Your Product" 3-field finder · Consultation promo band · Bestsellers · Gemstones-by-Planet · New Arrivals · Shop-by-Purpose · Verify proof strip · Craftsmanship band · Testimonials · Blog preview · FAQ accordion (with schema.org FAQPage JSON-LD) · Truth quote.
- ✅ Shop page with category / graha / purpose / mukhi filters, vernacular search.
- ✅ Product Detail with Trust Panel + per-unit selection.
- ✅ **Verify page (crown jewel)** — scanning animation, AUTHENTIC/SUSPICIOUS/REVOKED status card, Bento grid of Item / Lab / Temple / Ed25519 signature, embedded QR PNG, public key strip.
- ✅ Cart + Checkout (Razorpay-ready with mock-pay fallback).
- ✅ Auth pages (JWT + Google), Auth callback.
- ✅ Account (Verified Items vault, Orders, Wishlist tabs).
- ✅ Admin panel (products, units, certs issuance, dispatch, revoke).
- ✅ Shop-by-Planet, Shop-by-Purpose, Consultation booking, Carat↔Ratti tool.

### Design system
- Ivory / cream / sand surfaces (no pure white, no dark bg).
- Saffron → Gold → Maroon brand gradient reserved for CTAs, badges and 1px accents.
- Yatra One + Cormorant Garamond for display; Manrope + Hind for body; Tiro Devanagari Sanskrit; JetBrains Mono for signature/hex fields.
- Sharp 0–2px radii, 1px gold linework, restrained sacred-geometry watermarks.

## Test credentials
- Admin: `admin@gemora.in / admin@1234`
- Buyer: `priya@example.com / priya@1234`
See `/app/memory/test_credentials.md`.

## Prioritized backlog (P0/P1/P2)
### P0 — needed before hard launch
- Razorpay live keys (currently mock-pay); WhatsApp/Email notifications on order events.
- Real lab-report PDF upload + pooja recording upload (currently URLs); Object storage integration.
- Delivery signature on receipt; return / refund flow UI (backend revoke exists).

### P1 — polish & growth
- CMS-editable homepage_sections + announcement/hero from DB (currently hard-coded content).
- Product image gallery (multiple + zoom); reviews with image uploads.
- Bestseller / new-arrivals collections table (currently derived).
- Full blog CMS (currently 3 static previews).
- Consultation slot management & Zoom link generation.

### P2 — v2 / deferred
- Kundli engine (Swiss Ephemeris, Lahiri ayanamsa) for personalised recommendations.
- Multi-currency + international address book.
- Loyalty programme + referral vault.

## Known gaps / caveats
- **MOCKED:** Razorpay payment (uses `/api/checkout/mock-pay` when key not set) — clearly labelled in checkout UI.
- **MOCKED:** Blog posts and testimonials on homepage are static (SAMPLE data) — the surfaces are wired for a CMS.
- Product images use public Unsplash/Pexels URLs; replace with GEMORA-owned photography.

## Update — 2026-02-13
- Removed legacy mock/dev OTP fallback from `/app/frontend/src/components/gemora/PhoneVerify.jsx`. Firebase is now the only phone-verification path; if `REACT_APP_FIREBASE_*` is missing, the UI shows a hard error rather than silently falling back to `123456`.
- Removed backend legacy endpoints `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`, `POST /api/auth/login-otp` and their Pydantic models. Only `POST /api/auth/firebase-verify` remains for phone verification.
- Added human-readable Firebase error-code mapping in the UI so misconfiguration/quota/rate-limit issues are visible to the user.
- Root cause of "no OTP received": on this preview domain Firebase escalates from invisible reCAPTCHA to a visible reCAPTCHA v2 challenge (image puzzle). SMS is only dispatched after the user solves it.

## Update — 2026-02-13 (part 2) · Content-management features
- **reCAPTCHA fix**: `src/lib/firebase.js` now always destroys the previous `RecaptchaVerifier` before creating a new one. This eliminates the intermittent `auth/captcha-check-failed` on retries and puzzle escalations.
- **Media library**: uploads land in Emergent object storage under `gemora/media/*`. Backend endpoints: `POST/GET /api/admin/media`, `DELETE /api/admin/media/{id}`, public `GET /api/media/file/{path:path}`. Admin UI at `/admin/media`.
- **Site images (editable slots)**: registry of ~20 named slots (hero slides, category tiles, purpose tiles, band backgrounds, blog previews, logos). `PUT /api/admin/site-assets/{slot}` assigns a media item, `GET /api/site-assets` (public) returns the current map, `useSiteAsset('slot', fallback)` reads it. Home.jsx now sources hero/category/purpose/blog images through this hook.
- **Events / campaigns**: `POST/GET/PATCH/DELETE /api/admin/events` for CRUD; `GET /api/events/active` public. `EventStrip` (rotating dismissible top bar) and `EventsSection` (dedicated homepage section) auto-render active events. Fields: title, subtitle, description, cover image, CTA text/link, coupon code, priority, active, starts/ends at, show_in_strip, show_in_section.
- Access: all three admin pages are accessible to both Owner and Staff roles.

## Update — 2026-02-13 (part 3) · Astrologer workspace + affiliate commissions
- New astrologer authentication realm (separate JWT with aud='astrologer'), signup only via welcome-link minted when admin creates the account.
- Admin form (/admin/astrologers) captures: name, email, session price (₹), commission %, expertise, years, picture, bio. Auto-generates unique affiliate_code and welcome URL.
- Welcome URL flow: admin sends the link (Copy / WhatsApp / Email) → astrologer sets password at /astrologer/set-password?token=... → auto-logged in → /astrologer/dashboard.
- Astrologer workspace (/astrologer/*): Dashboard KPIs, Consultations (with Jitsi Join button, notes, status), Availability (weekly slots + blackout dates), Affiliate (link + copy + WhatsApp share + purchase list + KPIs).
- Jitsi rooms auto-generated per consultation booking (https://meet.jit.si/gemora-<booking_id>).
- Affiliate attribution: URL ?ref=<code> stored 30 days in localStorage by AffiliateTracker; Checkout sends affiliate_ref → order gets affiliate_astrologer_id → _mark_paid inserts affiliate_commissions row (commission = subtotal × commission_pct / 100). Admin sees per-astrologer stats in /admin/astrologers.
- Public /api/r/{code} sets a persistent gemora_anon cookie for correct visit dedup.
- Backend tests: /app/backend/tests/test_astrologer_flow.py — 22/22 pass.
- Frontend fix history: initial nested-Routes bug (v7 relative paths under splat) resolved by using absolute paths in Astrologer.jsx NAV + <Navigate to>. Clipboard operations use a safe textarea+execCommand fallback (/app/frontend/src/lib/clipboard.js).
