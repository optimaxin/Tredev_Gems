"""Safety gate for the backend integration suite.

WHY THIS EXISTS
---------------
These are *destructive* integration tests. They run against a live API and call
endpoints that permanently remove data — most notably:

    POST /admin/orders/purge      -> deletes EVERY order (test_09)
    DELETE /admin/orders/{id}     -> deletes a specific order (test_10)
    POST /admin/inventory/purge   -> wipes unsold inventory
    POST /admin/users/{id}        -> deletes users

On 2026-07-20 this suite was run against a server booted from `backend/.env`,
whose DATABASE_URL points at the **live Supabase project**. Six real orders were
destroyed. The trap: the API was on 127.0.0.1, so it *looked* local — but the
port is local while the database is production. Checking the base URL for
"localhost" is therefore NOT a sufficient guard, and deliberately is not what we
do here.

The only reliable gate is an explicit human opt-in, so running the suite can
never be an accident:

    TREDEV_ALLOW_DESTRUCTIVE_TESTS=1 \
    REACT_APP_BACKEND_URL=http://127.0.0.1:8001 \
    pytest

Before setting it, confirm the server you are pointing at is using a throwaway
database — not the Supabase project that serves production.
"""
import os

import pytest

OPT_IN = "TREDEV_ALLOW_DESTRUCTIVE_TESTS"


def pytest_configure(config):
    if os.environ.get(OPT_IN, "").strip() not in ("1", "true", "yes"):
        target = os.environ.get("REACT_APP_BACKEND_URL", "<unset — defaults to a remote preview host>")
        raise pytest.UsageError(
            "\n"
            "\n  ┌──────────────────────────────────────────────────────────────────┐"
            "\n  │  BLOCKED: this suite DELETES DATA (it purges ALL orders).        │"
            "\n  └──────────────────────────────────────────────────────────────────┘"
            "\n"
            f"\n  It would run against: {target}"
            "\n"
            "\n  A local API port does NOT mean a local database — backend/.env points"
            "\n  DATABASE_URL at the live Supabase project. Running this suite there"
            "\n  wipes real orders (it already did once, on 2026-07-20)."
            "\n"
            "\n  Confirm the target server uses a throwaway database, then re-run with:"
            f"\n      {OPT_IN}=1 pytest"
            "\n"
        )
