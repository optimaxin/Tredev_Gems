"""Idempotent dev seed against the Supabase schema.

Port of the Mongo `/dev/seed` (server.py:1465). Same demo data, but written to the
normalised schema — which means it also exercises nearly every mapping decision:
numeric↔paise, category_key enum, media_assets/product_media, the per-category
detail tables, and the certificate split (lab + energization + qr + signing_keys).

If this runs clean, the mapping layer is sound.

Note: 49 of the original tables have `id uuid NOT NULL` with NO default — this
schema generates uuids in the app layer. Every insert supplies its own id.
"""
from __future__ import annotations

import secrets
import uuid
from decimal import Decimal
from typing import Optional

import db

ADMIN_EMAIL = "admin@gemora.in"
BUYER_EMAIL = "priya@example.com"

ALL_PERMISSIONS = ["products", "inventory", "certificates", "orders",
                   "categories", "astrologers", "consultations", "queries"]


def nid() -> uuid.UUID:
    return uuid.uuid4()


# ── demo catalogue (mirrors server.py:1540-1622, prices still in paise) ───────
DEMO_PRODUCTS = [
    dict(slug="yellow-sapphire-pukhraj-ceylon-45ct", name="Ceylon Yellow Sapphire",
         devanagari="पीला पुखराज", category="gemstone", price=8850000, mrp=12000000,
         description="Natural, untreated Ceylon Pukhraj — the gemstone of Jupiter (Guru). "
                     "Bestows wisdom, prosperity and marital harmony.",
         image="https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg",
         attrs={"graha": "Jupiter", "rashi": "Sagittarius", "purpose": "wealth",
                "origin": "Ceylon", "carat_range": "4-5"}),
    dict(slug="blue-sapphire-neelam-4ct", name="Kashmir Blue Sapphire",
         devanagari="नीलम", category="gemstone", price=22500000, mrp=30000000,
         description="Rare Kashmir Neelam — the fastest-acting stone of Shani (Saturn). "
                     "Only for those it accepts.",
         image="https://images.unsplash.com/photo-1615655067298-b345f22e0abe?w=1200",
         attrs={"graha": "Saturn", "rashi": "Capricorn", "purpose": "career",
                "origin": "Kashmir", "carat_range": "3-4"}),
    dict(slug="ruby-manik-burmese-5ct", name="Burmese Ruby",
         devanagari="माणिक", category="gemstone", price=12500000, mrp=15000000,
         description="Pigeon-blood Burmese Manik — the stone of the Sun (Surya). "
                     "Confidence, leadership, vitality.",
         image="https://images.unsplash.com/photo-1544376664-80b17f09d399?w=1200",
         attrs={"graha": "Sun", "rashi": "Leo", "purpose": "career",
                "origin": "Burma", "carat_range": "4-5"}),
    dict(slug="5-mukhi-rudraksha-nepal-original", name="5 Mukhi Rudraksha (Nepal)",
         devanagari="पंच मुखी रुद्राक्ष", category="rudraksha", price=250000, mrp=350000,
         description="Authentic 5-Mukhi Nepal Rudraksha. Ruled by Guru. For peace of mind "
                     "and blood pressure.",
         image="https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=1200",
         attrs={"graha": "Jupiter", "mukhi": 5, "origin": "Nepal", "purpose": "health"}),
    dict(slug="sri-yantra-brass-energised", name="Sri Yantra (Brass, Energised)",
         devanagari="श्री यंत्र", category="yantra", price=550000, mrp=700000,
         description="Traditionally cast Sri Yantra energised at Kanchi Kamakoti Peetham. "
                     "Wealth and abundance.",
         image="https://images.unsplash.com/photo-1609619385076-36a873425636?w=1200",
         attrs={"purpose": "wealth"}),
    dict(slug="tirupati-laddu-prashad", name="Tirupati Laddu Prashadam",
         devanagari="तिरुपति लड्डू", category="prashad", price=45000, mrp=60000,
         description="Sri Venkateswara temple's laddu prashad — sourced directly with "
                     "certification of origin.",
         image="https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=1200",
         attrs={"purpose": "protection"}, is_serialized=False),
    dict(slug="rudraksha-bracelet-8mukhi", name="8 Mukhi Rudraksha Bracelet",
         devanagari="अष्टमुखी रुद्राक्ष कड़ा", category="bracelet", price=350000, mrp=500000,
         description="Hand-strung 8-mukhi bracelet — ruled by Ketu, worn to overcome obstacles.",
         image="https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1200",
         attrs={"mukhi": 8, "graha": "Ketu", "purpose": "protection"}),
    dict(slug="brass-ganesha-idol", name="Brass Ganesha Idol",
         devanagari="गणेश मूर्ति", category="idol", price=480000, mrp=650000,
         description="Solid brass, hand-finished Ganesh idol. Perfect for home mandir.",
         image="https://images.unsplash.com/photo-1665579156897-b28f83a3fcbd?w=1200",
         attrs={"purpose": "protection"}),
]

DEMO_ASTROLOGERS = [
    dict(name="Pandit Ravi Shastri", devanagari="पं. रवि शास्त्री",
         expertise=["Vedic", "Numerology"], price=150000, years=22,
         picture="https://images.pexels.com/photos/8828413/pexels-photo-8828413.jpeg"),
    dict(name="Acharya Meera Devi", devanagari="आचार्या मीरा देवी",
         expertise=["Gemstone", "Rudraksha"], price=200000, years=18,
         picture="https://images.pexels.com/photos/6207517/pexels-photo-6207517.jpeg"),
    dict(name="Guru Arjun Trivedi", devanagari="गुरु अर्जुन त्रिवेदी",
         expertise=["Nadi", "KP Astrology"], price=250000, years=30,
         picture="https://images.pexels.com/photos/6076994/pexels-photo-6076994.jpeg"),
]

GRAHA_TO_ENUM = db.GRAHA_TO_DB  # shared with server.py

# gem_type enum — derived from the product slug, since Mongo never modelled it.
SLUG_TO_GEM_TYPE = {
    "yellow-sapphire-pukhraj-ceylon-45ct": "yellow_sapphire",
    "blue-sapphire-neelam-4ct": "blue_sapphire",
    "ruby-manik-burmese-5ct": "ruby",
}
RUDRAKSHA_ORIGIN_TO_ENUM = {"Nepal": "nepal", "Indonesia": "indonesia_java",
                            "Haridwar": "haridwar"}


async def _role_id(conn, name: str) -> uuid.UUID:
    return await conn.fetchval("SELECT id FROM roles WHERE name = $1", name)


async def _ensure_user(conn, *, email: str, full_name: str, password: str,
                       phone: str, role: str, hash_password) -> uuid.UUID:
    uid_ = await conn.fetchval("SELECT id FROM users WHERE email = $1", email)
    if uid_ is None:
        uid_ = nid()
        await conn.execute(
            """INSERT INTO users (id, email, full_name, phone, phone_verified_at,
                                  password_hash, status)
               VALUES ($1,$2,$3,$4, now(), $5, 'active')""",
            uid_, email, full_name, phone, hash_password(password))
    else:
        # keep the canonical demo accounts usable even if they predate this seed
        await conn.execute(
            """UPDATE users SET full_name=$2, phone=COALESCE(phone,$3),
                   phone_verified_at=COALESCE(phone_verified_at, now()),
                   password_hash=COALESCE(password_hash,$4), status='active'
               WHERE id=$1""",
            uid_, full_name, phone, hash_password(password))

    # role (owner -> 'admin' row; staff/customer map 1:1)
    role_row = "admin" if role == "owner" else role
    rid = await _role_id(conn, role_row)
    if rid:
        await conn.execute(
            """INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)
               ON CONFLICT DO NOTHING""", uid_, rid)

    # wa_optin lives in notification_preferences.whatsapp (its designed home)
    await conn.execute(
        """INSERT INTO notification_preferences (user_id, whatsapp)
           VALUES ($1, '{"optin": true}'::jsonb)
           ON CONFLICT (user_id) DO NOTHING""", uid_)

    if role == "owner":
        for p in ALL_PERMISSIONS:
            await conn.execute(
                """INSERT INTO user_permissions (user_id, permission) VALUES ($1,$2)
                   ON CONFLICT DO NOTHING""", uid_, p)
    return uid_


async def _ensure_media(conn, url: str, uploaded_by: Optional[uuid.UUID]) -> uuid.UUID:
    """External demo images: modelled as media_assets rows with the URL as object_key."""
    mid = await conn.fetchval(
        "SELECT id FROM media_assets WHERE object_key = $1 AND bucket = 'external'", url)
    if mid:
        return mid
    mid = nid()
    await conn.execute(
        """INSERT INTO media_assets (id, owner_type, storage_provider, bucket, object_key,
                                     mime_type, is_public, uploaded_by)
           VALUES ($1,'product','external','external',$2,'image/jpeg', true, $3)""",
        mid, url, uploaded_by)
    return mid


async def run(*, hash_password, ed25519_public_hex: str, content_hash, sign_payload,
              iso, now) -> dict:
    """Seed everything. Returns a summary dict matching the old endpoint's shape."""
    async with db.transaction() as conn:
        # ── users ──
        admin_id = await _ensure_user(
            conn, email=ADMIN_EMAIL, full_name="Tredev Admin", password="admin@1234",
            phone="+919999900001", role="owner", hash_password=hash_password)
        await _ensure_user(
            conn, email=BUYER_EMAIL, full_name="Priya Sharma", password="priya@1234",
            phone="+919999900002", role="customer", hash_password=hash_password)

        # ── signing key (public half only; private stays in env) ──
        kid = "tredev-ed25519-1"
        signing_key_id = await conn.fetchval("SELECT id FROM signing_keys WHERE kid=$1", kid)
        if signing_key_id is None:
            signing_key_id = nid()
            # lowercase 'ed25519' — required by ck_signing_keys_algorithm
            await conn.execute(
                """INSERT INTO signing_keys (id, kid, algorithm, public_key, is_active)
                   VALUES ($1,$2,'ed25519',$3,true)""",
                signing_key_id, kid, ed25519_public_hex)

        # ── temple + priest (Mongo denormalised these onto the certificate) ──
        temple_id = await conn.fetchval("SELECT id FROM temples WHERE slug='kashi-vishwanath'")
        if temple_id is None:
            temple_id = nid()
            await conn.execute(
                """INSERT INTO temples (id, name, slug, deity, location_city, location_state,
                                        country, trust_verified)
                   VALUES ($1,'Kashi Vishwanath Temple','kashi-vishwanath','Shiva',
                           'Varanasi','Uttar Pradesh','IN', true)""", temple_id)
        priest_id = await conn.fetchval(
            "SELECT id FROM priests WHERE full_name=$1", "Pandit Ashok Mishra")
        if priest_id is None:
            priest_id = nid()
            await conn.execute(
                """INSERT INTO priests (id, full_name, temple_id, is_verified)
                   VALUES ($1,'Pandit Ashok Mishra',$2,true)""", priest_id, temple_id)

        # ── astrologers ──
        if await conn.fetchval("SELECT count(*) FROM astrologers") == 0:
            for a in DEMO_ASTROLOGERS:
                await conn.execute(
                    """INSERT INTO astrologers (full_name, devanagari, expertise, price,
                                                years, avatar_url, bio, is_active)
                       VALUES ($1,$2,$3,$4,$5,$6,'',true)""",
                    a["name"], a["devanagari"], a["expertise"],
                    db.to_amount(a["price"]), a["years"], a["picture"])

        # ── catalogue ──
        products = []
        for p in DEMO_PRODUCTS:
            ck = db.CATEGORY_TO_DB[p["category"]]
            cat_id = await conn.fetchval(
                "SELECT id FROM categories WHERE category_key = $1::category_key", ck)
            if cat_id is None:
                raise RuntimeError(f"category {ck} missing — seed categories first")

            pid = await conn.fetchval("SELECT id FROM products WHERE slug = $1", p["slug"])
            if pid is None:
                pid = nid()
                is_ser = p.get("is_serialized", True)
                await conn.execute(
                    """INSERT INTO products (id, category_id, category_key, title,
                            title_devanagari, slug, description, base_price,
                            compare_at_price, currency, is_serialized, is_energized,
                            attributes, status, published_at)
                       VALUES ($1,$2,$3::category_key,$4,$5,$6,$7,$8,$9,'INR',$10,$11,
                               $12,'active', now())""",
                    pid, cat_id, ck, p["name"], p["devanagari"], p["slug"],
                    p["description"], db.to_amount(p["price"]),
                    db.to_amount(p.get("mrp")), is_ser,
                    ck in ("yantra", "idol"), p["attrs"])

                # cart_items.variant_id / order_items.variant_id are NOT NULL, so every
                # product needs at least one variant. Mongo had no variant concept; one
                # default variant per product preserves that 1:1 shape.
                #   serialized -> product_units are the inventory (track_inventory=false)
                #   otherwise  -> variant-level stock_qty (Mongo's products.stock_qty)
                await conn.execute(
                    """INSERT INTO product_variants (id, product_id, sku, variant_name,
                            price, compare_at_price, stock_qty, track_inventory, is_active)
                       VALUES ($1,$2,$3,'Standard',$4,$5,$6,$7,true)""",
                    nid(), pid,
                    p["slug"][:24].upper().replace("-", "_") + "-STD",
                    db.to_amount(p["price"]), db.to_amount(p.get("mrp")),
                    None if is_ser else 100, not is_ser)

                # images -> media_assets + product_media
                mid = await _ensure_media(conn, p["image"], admin_id)
                await conn.execute(
                    """INSERT INTO product_media (id, product_id, media_id, position, is_primary)
                       VALUES ($1,$2,$3,0,true) ON CONFLICT DO NOTHING""", nid(), pid, mid)

                # typed detail rows replace the untyped attrs blob
                if ck == "gemstone":
                    # Mongo stored a "4-5" carat *range* string; take the low end as the
                    # concrete weight. 1 ratti = 0.9114 ct (the ICA-aligned figure the
                    # frontend's converter uses — see CaratRatti.jsx).
                    lo = (p["attrs"].get("carat_range") or "0-0").split("-")[0]
                    carat = Decimal(lo)
                    await conn.execute(
                        """INSERT INTO gemstone_details (product_id, gem_type, planet_graha,
                                weight_carat, weight_ratti, origin, is_natural)
                           VALUES ($1,$2::gem_type,$3::planet_graha,$4,$5,$6,true)
                           ON CONFLICT (product_id) DO NOTHING""",
                        pid, SLUG_TO_GEM_TYPE.get(p["slug"], "other"),
                        GRAHA_TO_ENUM.get(p["attrs"].get("graha")),
                        carat, (carat / Decimal("0.9114")).quantize(Decimal("0.01")),
                        p["attrs"].get("origin"))
                elif ck == "rudraksha":
                    await conn.execute(
                        """INSERT INTO rudraksha_details (product_id, mukhi, origin, ruling_planet)
                           VALUES ($1,$2,$3::rudraksha_origin,$4::planet_graha)
                           ON CONFLICT (product_id) DO NOTHING""",
                        pid, str(p["attrs"].get("mukhi") or ""),
                        RUDRAKSHA_ORIGIN_TO_ENUM.get(p["attrs"].get("origin"), "other"),
                        GRAHA_TO_ENUM.get(p["attrs"].get("graha")))
            products.append((pid, p))

        # ── units + certificates ──
        for pid, p in products:
            if not p.get("is_serialized", True):
                continue
            have = await conn.fetchval(
                "SELECT count(*) FROM product_units WHERE product_id = $1", pid)
            for i in range(max(0, 2 - have)):
                unit_id = nid()
                serial = f"GEM-{p['slug'][:6].upper()}-{secrets.token_hex(3).upper()}"
                # clock_timestamp(), not now(): now() is the *transaction* timestamp, so
                # every unit inserted in this seed would share a created_at and any
                # ORDER BY created_at would be non-deterministic (Mongo's per-insert
                # Python now() gave distinct values and stable ordering).
                await conn.execute(
                    """INSERT INTO product_units (id, product_id, serial_no, status,
                            verification_state, unit_price, created_at)
                       VALUES ($1,$2,$3,'in_stock','unverified',$4, clock_timestamp())""",
                    unit_id, pid, serial, db.to_amount(p["price"]))

                if i != 0:
                    continue

                # lab + energization records the flat Mongo cert used to inline
                lab_id = nid()
                await conn.execute(
                    """INSERT INTO lab_certifications (id, product_unit_id, lab_name,
                            certificate_number, report_date)
                       VALUES ($1,$2,'GJEPC Lab Mumbai',$3, current_date)""",
                    lab_id, unit_id, f"GJ-{secrets.token_hex(4).upper()}")
                en_id = nid()
                await conn.execute(
                    """INSERT INTO energization_certificates (id, product_unit_id, temple_id,
                            priest_id, performed_on, mantras)
                       VALUES ($1,$2,$3,$4,'2026-01-15'::timestamptz,$5)""",
                    en_id, unit_id, temple_id, priest_id,
                    ["ॐ नमः शिवाय"])

                # The signed payload keeps the *old* flat shape so /api/verify keeps
                # returning exactly what the frontend expects.
                cert_id = nid()
                payload = {
                    "cert_id": str(cert_id), "unit_id": str(unit_id), "serial": serial,
                    "product_id": str(pid), "product_name": p["name"],
                    "lab_name": "GJEPC Lab Mumbai",
                    "lab_report_no": f"GJ-{secrets.token_hex(4).upper()}",
                    "lab_report_url": None,
                    "temple_name": "Kashi Vishwanath Temple",
                    "temple_devanagari": "काशी विश्वनाथ मंदिर",
                    "energization_date": "2026-01-15",
                    "priest_name": "Pandit Ashok Mishra",
                    "pooja_recording_url": None, "mantra": "ॐ नमः शिवाय",
                    "issued_at": iso(now()), "issuer": "Tredev",
                    "public_key_hex": ed25519_public_hex,
                }
                await conn.execute(
                    """INSERT INTO authenticity_certificates (id, product_unit_id,
                            certificate_no, issuing_authority, issued_by_user_id, issued_at,
                            lab_certification_id, energization_certificate_id, temple_id,
                            signing_key_id, signed_payload, content_hash, signature)
                       VALUES ($1,$2,$3,'Tredev',$4, now(),$5,$6,$7,$8,$9,$10,$11)""",
                    cert_id, unit_id, f"TDV-{secrets.token_hex(4).upper()}", admin_id,
                    lab_id, en_id, temple_id, signing_key_id,
                    payload, content_hash(payload), sign_payload(payload))

                # QR is activated here so the demo verify page has real AUTHENTIC data
                await conn.execute(
                    """INSERT INTO qr_codes (id, product_unit_id, authenticity_certificate_id,
                            token, status, activated_at)
                       VALUES ($1,$2,$3,$4,'active', now())""",
                    nid(), unit_id, cert_id, f"qr_{uuid.uuid4().hex[:16]}")
                await conn.execute(
                    "UPDATE product_units SET verification_state='fully_verified' WHERE id=$1",
                    unit_id)

        n_products = await conn.fetchval("SELECT count(*) FROM products")
        n_units = await conn.fetchval("SELECT count(*) FROM product_units")
        n_certs = await conn.fetchval("SELECT count(*) FROM authenticity_certificates")

    return {"ok": True, "products": n_products, "units": n_units,
            "certificates": n_certs, "public_key_hex": ed25519_public_hex}
