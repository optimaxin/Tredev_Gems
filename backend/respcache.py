"""In-process cache for read-heavy, near-static JSON response bodies.

Candidates: public GET endpoints whose output is the same for every visitor
(no auth, no per-user data) and changes only when an admin edits something —
categories, site content/taxonomy, site assets, active events, the
consultation fee, the astrologer list. Product/cart/order endpoints are
deliberately NOT candidates: stock counts change on every order, and serving a
stale "in stock" would oversell a serialized, one-of-a-kind piece.

This runs one process per dyno (no Redis in this stack), so a plain in-memory
dict is the right amount of infrastructure — not a distributed cache.

Two invalidation paths:
  - TTL: an entry expires and recomputes on the next request after `ttl`
    seconds ("regenerate on a schedule" — e.g. events/active's start/end
    window drifts out of date without any admin write to react to).
  - Tag: admin write endpoints call invalidate(tag) immediately, so an edit
    is visible on the very next request instead of waiting out the TTL
    ("regenerate on content change").

Cache keys are whatever the caller passes to get_or_set — for the endpoints
using this today that's a static string, since none of them vary by query
param. Nothing here assumes a single global entry per endpoint though: a
route that needs to vary by e.g. `?lang=` just builds a key like
f"categories:{lang}" and gets a separate cache slot per value for free,
instead of one shared entry silently serving the wrong locale.
"""
from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

_store: dict[str, tuple[float, Any]] = {}  # key -> (expires_at_monotonic, value)
_tags: dict[str, set[str]] = {}  # tag -> keys sharing it, for invalidate()


async def get_or_set(key: str, ttl: float, tag: str, compute: Callable[[], Awaitable[Any]]) -> Any:
    hit = _store.get(key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    value = await compute()
    _store[key] = (time.monotonic() + ttl, value)
    _tags.setdefault(tag, set()).add(key)
    return value


def invalidate(tag: str) -> None:
    for key in _tags.pop(tag, ()):
        _store.pop(key, None)


def stats() -> dict:
    """Entry count + tags — wired to nothing in prod, just useful for the self-check."""
    return {"entries": len(_store), "tags": {t: len(ks) for t, ks in _tags.items()}}


async def _demo() -> None:
    """Self-check: run directly with `python respcache.py`. No network, no DB."""
    import asyncio

    calls = {"n": 0}

    async def compute():
        calls["n"] += 1
        return {"n": calls["n"]}

    # 1. First call computes; second call within the TTL hits the cache (no recompute).
    _store.clear()
    _tags.clear()
    r1 = await get_or_set("k", ttl=10, tag="t", compute=compute)
    r2 = await get_or_set("k", ttl=10, tag="t", compute=compute)
    assert r1 == r2 == {"n": 1}
    assert calls["n"] == 1, "second call should have hit the cache, not recomputed"

    # 2. invalidate(tag) forces the next call to recompute.
    invalidate("t")
    r3 = await get_or_set("k", ttl=10, tag="t", compute=compute)
    assert r3 == {"n": 2}
    assert calls["n"] == 2

    # 3. TTL expiry forces a recompute even without invalidate().
    await get_or_set("k2", ttl=0.05, tag="t2", compute=compute)
    assert calls["n"] == 3
    await asyncio.sleep(0.1)
    await get_or_set("k2", ttl=0.05, tag="t2", compute=compute)
    assert calls["n"] == 4, "expired entry should have recomputed"

    # 4. Different keys/tags don't interfere with each other.
    await get_or_set("unrelated", ttl=10, tag="other", compute=compute)
    assert calls["n"] == 5
    invalidate("t2")  # must not touch "unrelated" (tag "other") or "k" (tag "t")
    assert await get_or_set("unrelated", ttl=10, tag="other", compute=compute) == {"n": 5}
    assert await get_or_set("k", ttl=10, tag="t", compute=compute) == {"n": 2}

    print("respcache.py self-check: ALL PASSED —", stats())


if __name__ == "__main__":
    import asyncio
    asyncio.run(_demo())
