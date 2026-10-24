"""Guard against duplicate route registrations.

Two decorators on the same handler (``@router.get("")`` + ``@router.get("/")``)
silently register the same endpoint twice.  Keep exactly the path the admin
client calls.
"""
from __future__ import annotations

import pytest

from app.api.v1.routes import (
    audit_logs,
    auth,
    groups,
    media,
    pages,
    public,
    stats,
    users,
)

MODULES = [
    users,
    groups,
    pages,
    stats,
    audit_logs,
    media,
    auth,
    public,
]


def _route_keys(module):
    keys = []
    for route in module.router.routes:
        methods = getattr(route, "methods", None) or set()
        keys.append((route.path, tuple(sorted(methods))))
    return keys


def _get_paths(module):
    return [
        route.path
        for route in module.router.routes
        if "GET" in (getattr(route, "methods", None) or set())
    ]


@pytest.mark.parametrize("module", MODULES, ids=[m.__name__ for m in MODULES])
def test_router_routes_are_unique(module):
    keys = _route_keys(module)
    assert len(keys) == len(set(keys)), f"duplicate routes in {module.__name__}: {keys}"


def test_kept_get_paths_match_client_contract():
    # Admin client calls /admin/media/ (trailing slash) ...
    media_gets = _get_paths(media)
    assert media_gets == ["/"]
    assert media_gets[0].endswith("/")

    # ... but /admin/stats and /admin/audit-logs without a trailing slash.
    assert _get_paths(stats) == [""]
    assert _get_paths(audit_logs) == [""]
