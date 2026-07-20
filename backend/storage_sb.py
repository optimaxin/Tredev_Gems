"""Supabase Storage adapter.

Replaces the Emergent object store (integrations.emergentagent.com), which was the
last runtime dependency on that platform for media.

The schema already anticipated this: `storage_provider` is an enum containing
'supabase', and media_assets models storage as bucket + object_key — exactly
Supabase Storage's addressing. Buckets (certificates/recordings/invoices/labels/
data-exports) were already provisioned by whoever designed the schema; 'media' was
added to match.

Reads are proxied through the backend (/api/media/file/{path}) rather than served
from a public bucket, so the bucket stays private and access stays revocable.
"""
from __future__ import annotations

import logging
import os
from typing import Optional, Tuple

import httpx

log = logging.getLogger("gemora")

BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "media")


def _base_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL not set")
    return f"{url}/storage/v1"


def _service_key() -> str:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY not set")
    return key


def _headers(extra: Optional[dict] = None) -> dict:
    k = _service_key()
    # Storage wants both: apikey identifies the project, Authorization carries the role.
    h = {"apikey": k, "Authorization": f"Bearer {k}"}
    if extra:
        h.update(extra)
    return h


def configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


async def put(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes. `path` is the object key within the bucket."""
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            f"{_base_url()}/object/{BUCKET}/{path}",
            content=data,
            headers=_headers({
                "Content-Type": content_type,
                # Overwrite rather than 409 on a repeat upload of the same key.
                "x-upsert": "true",
            }),
        )
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase storage put failed [{r.status_code}]: {r.text[:200]}")
    return {"path": path, "size": len(data)}


async def get(path: str) -> Tuple[bytes, str]:
    """Download bytes + content-type. Raises FileNotFoundError when absent."""
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(f"{_base_url()}/object/{BUCKET}/{path}", headers=_headers())
    if r.status_code == 404:
        raise FileNotFoundError(path)
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase storage get failed [{r.status_code}]: {r.text[:200]}")
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def delete(path: str) -> None:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request("DELETE", f"{_base_url()}/object/{BUCKET}/{path}",
                            headers=_headers())
    if r.status_code >= 400 and r.status_code != 404:
        log.warning(f"Supabase storage delete failed [{r.status_code}]: {r.text[:200]}")


async def sign(path: str, expires_in: int = 604800) -> str:
    """A time-limited, direct-to-Supabase URL for a private object.

    Lets the browser fetch bytes straight from Supabase's storage/CDN instead of
    having this backend download and re-stream them (the slow path). The bucket
    stays private — the URL carries a signed token that expires after `expires_in`
    seconds (default 7 days).
    """
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{_base_url()}/object/sign/{BUCKET}/{path}",
            json={"expiresIn": expires_in},
            headers=_headers({"Content-Type": "application/json"}),
        )
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase storage sign failed [{r.status_code}]: {r.text[:200]}")
    body = r.json()
    signed = body.get("signedURL") or body.get("signedUrl") or body.get("url")
    if not signed:
        raise RuntimeError("Supabase sign returned no signedURL")
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    # signedURL is relative, e.g. "/object/sign/media/<path>?token=..."
    if signed.startswith("http"):
        return signed
    return f"{base}/storage/v1{signed if signed.startswith('/') else '/' + signed}"
