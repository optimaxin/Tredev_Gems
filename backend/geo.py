"""Amazon Location Service (Places API v2) client — pincode and place lookup.

This module is pure transport: it talks HTTPS to Amazon Location and shapes the
response. Routing, caching and auth live in server.py.

WHY THIS IS SERVER-SIDE
-----------------------
Amazon Location issues `v1.public.*` API keys that are *designed* to be embedded
in a browser, and calling them directly from the client would be one fewer hop.
We deliberately don't: the key would then be readable in the JS bundle and in the
Network tab, and anyone who lifted it could bill our AWS account until the key was
rotated. Proxying keeps the credential on the server, where it can also be cached
and rate-limited. The cost is a round-trip through our backend per lookup, which
is why callers should cache aggressively (pincodes effectively never change).

CONFIG (backend/.env)
---------------------
    AWS_LOCATION_API_KEY   v1.public.…    (never commit; restrict it in the console)
    AWS_LOCATION_REGION    us-east-1
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from circuit import CircuitOpenError, get_circuit

log = logging.getLogger("gemora.geo")

API_KEY = os.environ.get("AWS_LOCATION_API_KEY", "").strip()
REGION = os.environ.get("AWS_LOCATION_REGION", "us-east-1").strip() or "us-east-1"

_BASE = f"https://places.geo.{REGION}.amazonaws.com/v2"
_TIMEOUT = 6.0

# A third-party dependency on a checkout/typeahead hot path: a slow or down Places
# API must degrade to "no autofill" rather than stall the form, so it gets the same
# fail-fast treatment as the payment/WhatsApp gateways.
_circuit = get_circuit("aws_location", failure_threshold=4, reset_timeout=30.0,
                       call_timeout=_TIMEOUT, max_concurrency=10)


def configured() -> bool:
    """False when no key is set — callers then skip autofill instead of erroring,
    so a missing key degrades the form to plain manual entry."""
    return bool(API_KEY)


async def _post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(f"{_BASE}/{path}", params={"key": API_KEY}, json=body)
        resp.raise_for_status()
        return resp.json()


async def _call(path: str, body: dict) -> Optional[dict]:
    """Returns None on any failure. Location lookup is an enhancement, never a
    blocker — the caller always has the user's typed value to fall back on."""
    if not configured():
        return None
    try:
        return await _circuit.call(_post, path, body)
    except CircuitOpenError:
        log.warning("aws_location: circuit open, skipping %s", path)
    except httpx.HTTPStatusError as e:
        # Log the status only. httpx puts the full request URL in str(e), and the
        # key travels in that URL — stringifying the exception would write the
        # credential into the application log.
        log.warning("aws_location %s failed: HTTP %s", path, e.response.status_code)
    except Exception as e:  # noqa: BLE001 — never propagate to a checkout request
        log.warning("aws_location %s failed: %s", path, type(e).__name__)
    return None


def _shape(item: dict[str, Any]) -> dict:
    """One Places result -> our flat shape. Position is [lon, lat] in the AWS
    payload; we expose named fields so no caller has to remember that order."""
    addr = item.get("Address") or {}
    pos = item.get("Position") or []
    region = addr.get("Region") or {}
    country = addr.get("Country") or {}
    return {
        "label": addr.get("Label") or item.get("Title") or "",
        "city": addr.get("Locality") or addr.get("District") or "",
        "state": region.get("Name") or region.get("Code") or "",
        "country": country.get("Name") or "",
        "country_code": country.get("Code2") or country.get("Code3") or "",
        "postal_code": (addr.get("PostalCode") or "").split("-")[0].strip(),
        "lon": pos[0] if len(pos) == 2 else None,
        "lat": pos[1] if len(pos) == 2 else None,
    }


async def lookup_postal_code(postal_code: str, country: str = "IND") -> Optional[dict]:
    """Pincode -> city/state/country. Uses QueryComponents rather than free text so
    a bare 6-digit number can't be matched as a house number or a road name."""
    code = (postal_code or "").strip()
    if not code:
        return None
    data = await _call("geocode", {
        "QueryComponents": {"PostalCode": code, "Country": country},
        "MaxResults": 1,
    })
    items = (data or {}).get("ResultItems") or []
    return _shape(items[0]) if items else None


async def suggest_places(query: str, max_results: int = 5,
                         country: Optional[str] = None) -> list[dict]:
    """Free-text place search for 'place of birth' style fields. Returns results
    carrying coordinates, which is the whole point — a birth chart needs a real
    lat/lon, and a typed city name alone is ambiguous."""
    q = (query or "").strip()
    if len(q) < 3:            # below this every query matches half the planet
        return []
    # /v2/geocode (not /v2/autocomplete) because geocode already returns Position on
    # every result — autocomplete returns PlaceIds that would need a second lookup
    # per suggestion just to get coordinates.
    body: dict[str, Any] = {
        "QueryText": q,
        "MaxResults": max(1, min(max_results, 10)),
    }
    if country:
        body["Filter"] = {"IncludeCountries": [country]}
    data = await _call("geocode", body)
    return [_shape(i) for i in ((data or {}).get("ResultItems") or [])]
