"""plugNmeet REST API client — room creation, join tokens, recording fetch.

Auth: every REST call is a POST to {SERVER}/auth/<path> with the raw JSON body
signed HMAC-SHA256 with the API secret, sent as the HASH-SIGNATURE header
alongside API-KEY. Webhook deliveries use plugNmeet's LiveKit-style scheme
instead: a JWT (HS256, signed with the same secret) in the Authorization
header, carrying a base64 sha256 digest of the raw body as its `sha256` claim.

https://www.plugnmeet.org/docs/api/intro
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
from typing import Optional

import httpx
import jwt as pyjwt

log = logging.getLogger("gemora")


def _server() -> str:
    return os.environ.get("PLUGNMEET_SERVER_URL", "").rstrip("/")


def _api_key() -> str:
    return os.environ.get("PLUGNMEET_API_KEY", "")


def _api_secret() -> str:
    return os.environ.get("PLUGNMEET_API_SECRET", "")


def configured() -> bool:
    return bool(_server() and _api_key() and _api_secret())


async def _post(path: str, body: dict) -> dict:
    if not configured():
        raise RuntimeError("plugNmeet not configured (PLUGNMEET_SERVER_URL/API_KEY/API_SECRET)")
    payload = json.dumps(body, separators=(",", ":")).encode()
    sig = hmac.new(_api_secret().encode(), payload, hashlib.sha256).hexdigest()
    headers = {"API-KEY": _api_key(), "HASH-SIGNATURE": sig, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{_server()}/auth{path}", content=payload, headers=headers)
    r.raise_for_status()
    data = r.json()
    if not data.get("status"):
        raise RuntimeError(f"plugNmeet {path} failed: {data.get('msg')}")
    return data


async def create_room(room_id: str, title: str, webhook_url: str) -> dict:
    """Idempotent — plugNmeet returns the existing room if room_id is already active."""
    return await _post("/room/create", {
        "room_id": room_id,
        "metadata": {
            "room_title": title,
            "webhook_url": webhook_url,
            "room_features": {
                "allow_webcams": True,
                "mute_on_start": False,
                "allow_screen_share": True,
                # Auto cloud recording — every session records with no host action.
                "recording_features": {
                    "is_allow": True,
                    "is_allow_cloud": True,
                    "is_allow_local": False,
                    "enable_auto_cloud_recording": True,
                },
            },
        },
    })


def join_url(token: str) -> str:
    return f"{_server()}/?access_token={token}"


async def get_join_token(room_id: str, name: str, user_id: str, is_admin: bool) -> str:
    data = await _post("/room/getJoinToken", {
        "room_id": room_id,
        "user_info": {"name": name, "user_id": user_id, "is_admin": is_admin},
    })
    return data["token"]


async def fetch_recordings(room_id: str) -> list[dict]:
    data = await _post("/recording/fetch", {"room_ids": [room_id], "limit": 20, "order_by": "DESC"})
    return data.get("result", {}).get("recordings_list", [])


async def get_download_token(record_id: str) -> str:
    data = await _post("/recording/getDownloadToken", {"record_id": record_id})
    return data["token"]


def download_url(token: str) -> str:
    return f"{_server()}/download/recording/{token}"


def verify_webhook(body: bytes, authorization: Optional[str]) -> dict:
    """Raises ValueError if the signature/hash doesn't check out."""
    if not authorization:
        raise ValueError("missing Authorization header")
    token = authorization[7:] if authorization.lower().startswith("bearer ") else authorization
    try:
        claims = pyjwt.decode(token, _api_secret(), algorithms=["HS256"])
    except Exception as e:
        raise ValueError(f"invalid webhook token: {e}")
    want = base64.b64encode(hashlib.sha256(body).digest()).decode()
    if not hmac.compare_digest(claims.get("sha256", ""), want):
        raise ValueError("webhook body hash mismatch")
    return json.loads(body)
