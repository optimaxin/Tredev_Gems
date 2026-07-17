"""Postgres access layer (asyncpg).

Replaces the previous motor/MongoDB client. Two things here are load-bearing:

1. `_row()` converts datetime/date back to the ISO-8601 strings the API used to
   return when timestamps were stored as strings in Mongo. Every read goes through
   it, so the response contract stays unchanged for the frontend.
2. The jsonb codec. Without it asyncpg hands back jsonb columns as raw `str`,
   which would silently turn dict fields (products.attrs, admin_events.meta,
   certificates.signed_payload) into strings.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from typing import Any, Optional

import asyncpg

log = logging.getLogger("gemora")

_pool: Optional[asyncpg.Pool] = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    # asyncpg returns jsonb as str unless a codec is registered.
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename,
            encoder=json.dumps,
            decoder=json.loads,
            schema="pg_catalog",
        )


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool
    dsn = os.environ["DATABASE_URL"]
    _pool = await asyncpg.create_pool(
        dsn,
        min_size=1,
        max_size=int(os.environ.get("DB_POOL_MAX", "10")),
        init=_init_conn,
        # Supabase's pooler (port 6543) runs pgbouncer in transaction mode, which
        # is incompatible with asyncpg's prepared-statement cache.
        statement_cache_size=0,
        command_timeout=30,
    )
    log.info("Postgres pool ready")
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call connect() during startup")
    return _pool


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _value(v: Any) -> Any:
    if isinstance(v, datetime):
        return _iso(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def _row(rec: Optional[asyncpg.Record]) -> Optional[dict]:
    """asyncpg.Record -> plain dict, with timestamps rendered as ISO strings."""
    if rec is None:
        return None
    return {k: _value(v) for k, v in rec.items()}


def _rows(recs: list[asyncpg.Record]) -> list[dict]:
    return [_row(r) for r in recs]


async def fetch_one(sql: str, *args: Any) -> Optional[dict]:
    async with pool().acquire() as conn:
        return _row(await conn.fetchrow(sql, *args))


async def fetch_all(sql: str, *args: Any) -> list[dict]:
    async with pool().acquire() as conn:
        return _rows(await conn.fetch(sql, *args))


async def fetch_val(sql: str, *args: Any) -> Any:
    async with pool().acquire() as conn:
        return _value(await conn.fetchval(sql, *args))


async def execute(sql: str, *args: Any) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(sql, *args)


async def execute_many(sql: str, args_seq) -> None:
    async with pool().acquire() as conn:
        await conn.executemany(sql, args_seq)


def transaction():
    """`async with db.transaction() as conn:` — real atomicity for checkout/dispatch.

    Mongo couldn't do this; multi-step flows were best-effort. Use `conn.fetch*`
    directly inside, then pass rows through `_row()`/`_rows()` yourself.
    """
    return _Tx()


class _Tx:
    def __init__(self):
        self._conn = None
        self._tx = None

    async def __aenter__(self) -> asyncpg.Connection:
        self._conn = await pool().acquire()
        self._tx = self._conn.transaction()
        await self._tx.start()
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                await self._tx.commit()
            else:
                await self._tx.rollback()
        finally:
            await pool().release(self._conn)
        return False


# ── API contract translation ─────────────────────────────────────────────────
# The Supabase schema is richer than the Mongo model the frontend was built
# against. Rather than change the frontend, translate at this boundary.
#
#   money    numeric rupees (DB)  <-> int paise (API, frontend/src/lib/api.js:16)
#   ids      uuid (DB)            <-> same field names, opaque values (API)
#   statuses schema enums (DB)    <-> the strings the frontend already branches on

from decimal import ROUND_HALF_UP, Decimal  # noqa: E402


def json_dumps(v) -> str:
    """Serialise a jsonb parameter. The codec handles decoding on read, but values
    passed as query args must be JSON text."""
    return json.dumps(v, ensure_ascii=False)


def to_paise(v) -> Optional[int]:
    """numeric rupees -> int paise. DB 5000.00 -> API 500000."""
    if v is None:
        return None
    return int((Decimal(v) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def to_amount(paise) -> Optional[Decimal]:
    """int paise -> numeric rupees. API 500000 -> DB 5000.00."""
    if paise is None:
        return None
    return Decimal(int(paise)) / 100


# Mongo value -> schema enum. Reverse maps are derived below.
UNIT_STATUS_TO_DB = {"available": "in_stock", "sold": "sold"}
RESERVATION_STATUS_TO_DB = {"reserved": "active", "sold": "consumed"}
ORDER_STATUS_TO_DB = {
    "pending_payment": "pending",
    "paid": "paid",
    "shipped": "shipped",
    "delivered": "delivered",
    "cancelled": "cancelled",
    "refunded": "refunded",
    "payment_failed": "payment_failed",
}
# Mongo used free-text category keys; the schema has a category_key enum.
CATEGORY_TO_DB = {
    "gemstone": "gemstone",
    "rudraksha": "rudraksha",
    "bracelet": "gem_bracelet",
    "gemstone_jewellery": "gemstone_jewellery",
    "mala": "mala",
    "yantra": "yantra",
    "idol": "idol",
    "prashad": "temple_prashad",
    "pooja_kit": "pooja_kit",
    "book": "spiritual_book",
    "digital": "digital",
}

# attrs.graha was free text ("Jupiter"); planet_graha is a lowercase-English enum.
GRAHA_TO_DB = {"Sun": "sun", "Moon": "moon", "Mars": "mars", "Mercury": "mercury",
               "Jupiter": "jupiter", "Venus": "venus", "Saturn": "saturn",
               "Rahu": "rahu", "Ketu": "ketu"}
GRAHA_FROM_DB = {v: k for k, v in GRAHA_TO_DB.items()}

UNIT_STATUS_FROM_DB = {v: k for k, v in UNIT_STATUS_TO_DB.items()}
RESERVATION_STATUS_FROM_DB = {v: k for k, v in RESERVATION_STATUS_TO_DB.items()}
ORDER_STATUS_FROM_DB = {v: k for k, v in ORDER_STATUS_TO_DB.items()}
CATEGORY_FROM_DB = {v: k for k, v in CATEGORY_TO_DB.items()}

# The schema has order/unit states the Mongo API never emitted. Fold them onto the
# nearest value the frontend understands rather than leaking unknown strings.
ORDER_STATUS_FROM_DB.update({
    "processing": "paid",
    "packed": "paid",
    "out_for_delivery": "shipped",
    "completed": "delivered",
    "returned": "refunded",
})
UNIT_STATUS_FROM_DB.update({"reserved": "available", "returned": "available",
                            "quarantined": "sold"})
RESERVATION_STATUS_FROM_DB.update({"expired": "reserved", "released": "reserved"})
