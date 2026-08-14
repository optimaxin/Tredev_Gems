"""One-off backfill: recompress media_assets rows uploaded before image_tools.py
existed. Uploads made after that change are already compressed at write time
(server.py's admin_media_upload / upload_review_photo) — this script is only for
the objects that predate it, which is why product images were still 2-2.5MB PNGs
and slow to load despite the upload-time fix.

Rewrites bytes IN PLACE at the same object_key (upsert), so no caller — products,
site_assets, reviews — needs to change: they all reference the key, not the bytes.
The stored content-type is updated to match what's actually now in the bucket.

Usage:
    python backfill_compress_media.py            # do it
    python backfill_compress_media.py --dry-run   # report savings only
"""
from __future__ import annotations

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv()

import db
import storage_sb
from image_tools import compress_image

_SKIP_CONTENT_TYPES = ("image/gif", "image/svg+xml")


async def _run(dry_run: bool) -> None:
    await db.connect()
    rows = await db.fetch_all(
        """SELECT id::text AS id, bucket, object_key, mime_type, file_size_bytes
             FROM media_assets
            WHERE deleted_at IS NULL
              AND mime_type LIKE 'image/%'
              AND mime_type NOT IN ('image/gif', 'image/svg+xml')
              -- object_key is sometimes a full external URL (seeded stock photos,
              -- not our own upload) — nothing to recompress there.
              AND object_key NOT LIKE 'http%'
            ORDER BY file_size_bytes DESC NULLS LAST""")

    if not rows:
        print("Nothing to do — no image rows match.")
        return

    total_before = total_after = 0
    changed = skipped = failed = 0

    for r in rows:
        try:
            data, ct = await storage_sb.get(r["object_key"], bucket=r["bucket"])
        except Exception as e:  # noqa: BLE001 — one bad object must not abort the run
            print(f"  ! {r['object_key']}: could not download ({e})")
            failed += 1
            continue

        ext = r["object_key"].rsplit(".", 1)[-1].lower() if "." in r["object_key"] else "bin"
        compressed, new_ct, _new_ext = compress_image(data, ct, ext)
        before, after = len(data), len(compressed)
        total_before += before
        total_after += after

        if after >= before:
            print(f"  = {r['object_key']}: already optimal ({before/1024:.0f} KB)")
            skipped += 1
            continue

        pct = 100 * (1 - after / before)
        print(f"  ✓ {r['object_key']}: {before/1024:.0f} KB -> {after/1024:.0f} KB "
              f"(-{pct:.0f}%){' [dry-run]' if dry_run else ''}")
        changed += 1
        if dry_run:
            continue

        # Same object_key, upsert — every product/order/site-asset reference to
        # this key keeps working unchanged; only the bytes and content-type change.
        await storage_sb.put(r["object_key"], compressed, new_ct, bucket=r["bucket"])
        await db.execute(
            "UPDATE media_assets SET mime_type = $2, file_size_bytes = $3 WHERE id = $1::uuid",
            r["id"], new_ct, after)

    print(f"\n{changed} compressed, {skipped} already optimal, {failed} failed "
          f"({len(rows)} total).")
    if total_before:
        print(f"Total: {total_before/1024/1024:.1f} MB -> {total_after/1024/1024:.1f} MB "
              f"(-{100*(1-total_after/total_before):.0f}%)")
    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(_run(dry_run="--dry-run" in sys.argv))
