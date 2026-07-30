"""Pure-logic check for region_pricing's currency-fallback resolver.

No live DB, no API calls — feeds server._resolve_prices a fake asyncpg-style
connection. Not gated by conftest.py's destructive-suite lock, but still lives
here so it's discoverable alongside the rest of the backend tests. Run directly
with `python3 test_resolve_prices.py` (bypasses the conftest gate entirely) or
via pytest with TREDEV_ALLOW_DESTRUCTIVE_TESTS=1 pytest test_resolve_prices.py
(scoped to just this file, so nothing destructive actually runs).
"""
import asyncio
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402


class _FakeConn:
    """Mimics the slice of asyncpg's connection interface _resolve_prices uses."""
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, sql, ids, currencies):
        return [r for r in self._rows if r["id"] in ids and r["currency_code"].strip() in currencies]


def _row(id_, code, amount):
    return {"id": id_, "currency_code": code, "amount": Decimal(amount)}


def test_exact_currency_match_wins():
    conn = _FakeConn([_row("p1", "EUR", "10.00"), _row("p1", "USD", "8.00")])
    result = asyncio.run(server._resolve_prices("product_prices", "product_id", ["p1"], "EUR", conn))
    assert result == {"p1": {"price": 1000, "currency": "EUR"}}


def test_falls_back_to_usd_when_no_exact_match():
    conn = _FakeConn([_row("p1", "USD", "12.50")])
    result = asyncio.run(server._resolve_prices("product_prices", "product_id", ["p1"], "GBP", conn))
    assert result == {"p1": {"price": 1250, "currency": "USD"}}


def test_no_override_at_all_is_omitted():
    conn = _FakeConn([_row("p2", "USD", "5.00")])  # p1 has nothing
    result = asyncio.run(server._resolve_prices("product_prices", "product_id", ["p1"], "USD", conn))
    assert result == {}


def test_inr_skips_the_query_entirely():
    conn = _FakeConn([_row("p1", "USD", "5.00")])
    result = asyncio.run(server._resolve_prices("product_prices", "product_id", ["p1"], "INR", conn))
    assert result == {}


if __name__ == "__main__":
    test_exact_currency_match_wins()
    test_falls_back_to_usd_when_no_exact_match()
    test_no_override_at_all_is_omitted()
    test_inr_skips_the_query_entirely()
    print("OK — all region_pricing fallback checks passed")
