"""Per-dependency circuit breakers.

Every external call this backend makes (Razorpay, Twilio, Firebase Auth, the
OpenWA gateway, Supabase Storage) shares one failure mode: if that dependency
goes slow or down, requests pile up waiting on it — each holding a connection/task
until it times out — and that pileup starves capacity from requests that have
nothing to do with the failing dependency.

A `Circuit` fixes this per dependency:
  - a timeout on every call, so a hang can't hold a slot forever
  - a concurrency cap, so one dependency can't consume unbounded capacity
  - breaker state (closed -> open -> half_open) that trips after repeated
    failures and fails new calls instantly (no timeout wait) until the
    dependency gets a chance to prove it's back
"""
from __future__ import annotations

import asyncio
import logging
import time

log = logging.getLogger("gemora.circuit")


class CircuitOpenError(RuntimeError):
    """The circuit is open: the call was skipped (not attempted), not failed."""


class Circuit:
    def __init__(self, name: str, *, failure_threshold: int = 5,
                 reset_timeout: float = 30.0, call_timeout: float = 10.0,
                 max_concurrency: int = 8):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.call_timeout = call_timeout
        self._sem = asyncio.Semaphore(max_concurrency)
        self._lock = asyncio.Lock()
        self._state = "closed"  # closed | open | half_open
        self._failures = 0
        self._opened_at = 0.0
        self._probe_in_flight = False

    @property
    def state(self) -> str:
        return self._state

    async def _try_enter(self) -> bool:
        async with self._lock:
            if self._state == "open":
                if time.monotonic() - self._opened_at < self.reset_timeout:
                    return False
                # Cooldown elapsed: let exactly one probe through to test recovery.
                self._state = "half_open"
                self._probe_in_flight = False
            if self._state == "half_open":
                if self._probe_in_flight:
                    return False
                self._probe_in_flight = True
            return True

    async def _record_success(self) -> None:
        async with self._lock:
            if self._state != "closed":
                log.info("circuit[%s]: recovered, closing", self.name)
            self._state = "closed"
            self._failures = 0
            self._probe_in_flight = False

    async def _record_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            if self._state == "half_open" or self._failures >= self.failure_threshold:
                if self._state != "open":
                    log.warning("circuit[%s]: tripping open after %d failure(s)",
                                self.name, self._failures)
                self._state = "open"
                self._opened_at = time.monotonic()
            self._probe_in_flight = False

    async def call(self, fn, *args, **kwargs):
        """Run fn(*args, **kwargs) — sync or async — under the timeout/concurrency/
        breaker rules. Raises CircuitOpenError without calling fn at all when open."""
        if not await self._try_enter():
            raise CircuitOpenError(f"{self.name}: circuit open, failing fast")
        async with self._sem:
            try:
                if asyncio.iscoroutinefunction(fn):
                    awaitable = fn(*args, **kwargs)
                else:
                    # Blocking SDK calls (razorpay, twilio) run in a worker thread so
                    # a hang there can't freeze the event loop for every other request.
                    awaitable = asyncio.to_thread(fn, *args, **kwargs)
                result = await asyncio.wait_for(awaitable, timeout=self.call_timeout)
            except BaseException:
                # BaseException (not just Exception) so a cancelled/disconnected
                # caller still clears _probe_in_flight instead of wedging a
                # half-open circuit shut forever.
                await self._record_failure()
                raise
            await self._record_success()
            return result


_registry: dict[str, Circuit] = {}


def get_circuit(name: str, **kwargs) -> Circuit:
    """Circuits are singletons per name, so the concurrency cap and trip state are
    shared across every call site that touches the same dependency."""
    if name not in _registry:
        _registry[name] = Circuit(name, **kwargs)
    return _registry[name]


async def _demo() -> None:
    """Self-check: run directly with `python circuit.py`. No network, no DB —
    verifies the state machine, fast-fail, concurrency cap and isolation between
    independently-named circuits, entirely against fake dependency functions."""

    async def flaky_dep():
        raise RuntimeError("dependency down")

    async def slow_dep():
        await asyncio.sleep(5)
        return "should have timed out"

    async def healthy_dep():
        return "ok"

    # 1. Closed circuit lets calls through normally.
    c = Circuit("demo", failure_threshold=3, reset_timeout=0.3, call_timeout=0.2,
                max_concurrency=2)
    assert await c.call(healthy_dep) == "ok"
    assert c.state == "closed"

    # 2. Repeated failures trip it open.
    for _ in range(3):
        try:
            await c.call(flaky_dep)
        except RuntimeError:
            pass
    assert c.state == "open"

    # 3. While open, calls fail INSTANTLY (no timeout wait) with CircuitOpenError.
    t0 = time.monotonic()
    try:
        await c.call(slow_dep)
        assert False, "expected CircuitOpenError"
    except CircuitOpenError:
        pass
    elapsed = time.monotonic() - t0
    assert elapsed < 0.05, f"fast-fail took {elapsed}s — should be near-instant"

    # 4. A slow call that exceeds call_timeout counts as a failure via the timeout
    # path, not just explicit exceptions.
    c2 = Circuit("demo-timeout", failure_threshold=1, reset_timeout=0.3, call_timeout=0.05,
                 max_concurrency=2)
    try:
        await c2.call(slow_dep)
        assert False, "expected a timeout"
    except asyncio.TimeoutError:
        pass
    assert c2.state == "open"

    # 5. After reset_timeout, exactly one probe is let through (half-open); success closes it.
    await asyncio.sleep(0.35)
    assert await c.call(healthy_dep) == "ok"
    assert c.state == "closed"

    # 6. Concurrency cap: 10 concurrent slow-but-successful calls against a
    # max_concurrency=2 circuit never run more than 2 at once.
    c3 = Circuit("demo-concurrency", failure_threshold=99, reset_timeout=1, call_timeout=2,
                 max_concurrency=2)
    in_flight = 0
    peak = 0

    async def tracked_slow():
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.1)
        in_flight -= 1
        return "ok"

    results = await asyncio.gather(*(c3.call(tracked_slow) for _ in range(10)))
    assert results == ["ok"] * 10
    assert peak <= 2, f"peak concurrency {peak} exceeded cap of 2"

    # 7. Isolation: an independently-named circuit for a *different* dependency is
    # completely unaffected by another one being open — a degraded dependency
    # doesn't drag down calls that don't touch it.
    unrelated = Circuit("demo-unrelated", failure_threshold=3, reset_timeout=0.3,
                        call_timeout=0.2, max_concurrency=2)
    assert unrelated.state == "closed"
    assert await unrelated.call(healthy_dep) == "ok"

    print("circuit.py self-check: ALL PASSED")


if __name__ == "__main__":
    asyncio.run(_demo())
