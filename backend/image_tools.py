"""Image compression for uploads and storage backfills.

Shared by server.py's upload endpoints and backfill_compress_media.py (which
recompresses objects uploaded before this feature existed). Kept free of
FastAPI/DB imports so both call it with zero side effects.
"""
from __future__ import annotations

import io

MAX_DIM = 2000  # px, longest side
JPEG_QUALITY = 80
_PASSTHROUGH = ("image/gif", "image/svg+xml")


def compress_image(data: bytes, content_type: str, ext: str) -> tuple[bytes, str, str]:
    """Downscale oversized images and re-encode as JPEG to cut load time.

    GIF/SVG pass through untouched (animation/vector would break on re-encode).
    Falls back to the original bytes if Pillow can't decode the file, or if
    re-encoding didn't actually shrink it (an already-tiny/optimized image).
    """
    if content_type in _PASSTHROUGH:
        return data, content_type, ext
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return data, content_type, ext

    # JPEG has no alpha channel, so any transparency must be flattened onto a
    # background before saving — handing Pillow an RGBA/LA/transparent-P image
    # and asking for JPEG raises "cannot write mode X as JPEG", which crashed
    # every upload of a transparent PNG under the previous version of this code.
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if max(img.size) > MAX_DIM:
        img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    compressed = out.getvalue()
    if len(compressed) >= len(data):
        return data, content_type, ext
    return compressed, "image/jpeg", "jpg"


def _demo() -> None:
    """Self-check: `python image_tools.py`. Pure Pillow, no network/DB."""
    from PIL import Image

    # 1. Oversized RGB PNG -> downscaled JPEG, smaller, correct dimensions.
    img = Image.new("RGB", (3000, 2000), (200, 50, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    data, ct, ext = compress_image(raw, "image/png", "png")
    assert (ct, ext) == ("image/jpeg", "jpg")
    out = Image.open(io.BytesIO(data))
    assert max(out.size) <= MAX_DIM
    assert out.mode == "RGB"
    assert len(data) < len(raw)

    # 2. Transparent PNG must not crash, and must flatten onto white rather than
    # staying RGBA — this is the bug this module exists to fix.
    rgba = Image.new("RGBA", (500, 500), (10, 20, 30, 0))  # fully transparent
    buf2 = io.BytesIO()
    rgba.save(buf2, format="PNG")
    raw2 = buf2.getvalue()
    data2, ct2, ext2 = compress_image(raw2, "image/png", "png")
    assert ct2 == "image/jpeg", "transparent PNG must compress to JPEG, not crash"
    out2 = Image.open(io.BytesIO(data2)).convert("RGB")
    assert out2.getpixel((0, 0)) == (255, 255, 255), "transparent pixels must flatten onto white"

    # 3. Palette PNG with a transparency entry (a common "P" + tRNS case distinct
    # from RGBA) must not crash — regardless of whether the tiny test image
    # happens to shrink under JPEG (a blank swatch often doesn't, and the
    # never-bigger-than-original fallback correctly keeps the PNG in that case).
    p_img = Image.new("P", (100, 100))
    p_img.info["transparency"] = 0
    buf3 = io.BytesIO()
    p_img.save(buf3, format="PNG")
    raw3 = buf3.getvalue()
    data3, ct3, ext3 = compress_image(raw3, "image/png", "png")
    Image.open(io.BytesIO(data3)).load()  # must decode without error either way

    # 4. GIF passes through untouched (animation would break on re-encode).
    gif = io.BytesIO()
    Image.new("RGB", (10, 10)).save(gif, format="GIF")
    gdata, gct, gext = compress_image(gif.getvalue(), "image/gif", "gif")
    assert (gdata, gct, gext) == (gif.getvalue(), "image/gif", "gif")

    # 5. Already-tiny image: compression is never allowed to make it BIGGER.
    tiny = Image.new("RGB", (20, 20), (1, 2, 3))
    tbuf = io.BytesIO()
    tiny.save(tbuf, format="PNG")
    traw = tbuf.getvalue()
    tdata, tct, text = compress_image(traw, "image/png", "png")
    assert len(tdata) <= len(traw)

    print("image_tools.py self-check: ALL PASSED")


if __name__ == "__main__":
    _demo()
