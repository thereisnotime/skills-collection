"""Auth-scope coverage test for ALL dashboard data GET endpoints.

Regression guard for the v7.x finding that 68 of 110 GET routes carried no
require_scope dependency: with LOKI_ENTERPRISE_AUTH=true an unauthenticated
client could read cost, council transcripts, escalations, app-runner logs,
findings, learnings, and more, because only some GETs were guarded.

This test asserts that EVERY /api/* data GET carries at least one route
dependency. A small, explicit allowlist names the routes that are intentionally
public (health probe, the SPA shell, the capability/agent cards, and the auth
discovery endpoints). Any new unguarded /api/* GET fails this test.

HERMETICITY
-----------
The route table is inspected at definition time (no network, env-independent),
but the check runs in a SUBPROCESS so this file imports dashboard.* zero times
in the parent interpreter, matching tests/dashboard/test_memory_read_scope_auth.py.
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest


# Routes that are intentionally public (no auth dependency required). Keep this
# list tight: anything not here that is a data-bearing /api/* GET must be
# guarded.
PUBLIC_ALLOWLIST = {
    "/health",
    "/favicon.svg",
    "/",
    "/cost",
    "/trust",
    "/.well-known/agent.json",
    "/api/auth/info",
    "/api/enterprise/status",
    "/api/providers/models",  # static provider/model catalog, not project data
    "/{full_path:path}",      # SPA catch-all
    "/metrics",               # Prometheus scrape target; MUST be public (the
                              # ServiceMonitor scrapes it without a token)
}

# Routes that MUST stay PUBLIC even under enterprise auth (a 401 here is a
# regression, not hardening): k8s probes, A2A discovery, auth bootstrap, and the
# Prometheus endpoint. The data-GET guard above must never reach these.
MUST_BE_PUBLIC = {
    "/health",                  # k8s liveness/readiness probe -> 401 = CrashLoop
    "/.well-known/agent.json",  # A2A agent card, spec-mandated public discovery
    "/api/auth/info",           # bootstrap: client needs this to learn how to auth
    "/api/enterprise/status",   # auth-mode discovery
    "/metrics",                 # Prometheus scrape (ServiceMonitor, no token)
    "/favicon.svg",             # static asset
}


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _run_in_subprocess(body: str):
    env = dict(os.environ)
    env.pop("LOKI_ENTERPRISE_AUTH", None)
    env.pop("LOKI_OIDC_ISSUER", None)
    env.pop("LOKI_OIDC_CLIENT_ID", None)
    preamble = (
        "import sys\n"
        f"sys.path.insert(0, {_REPO_ROOT!r})\n"
        f"PUBLIC_ALLOWLIST = {PUBLIC_ALLOWLIST!r}\n"
    )
    return subprocess.run(
        [sys.executable, "-c", preamble + body],
        env=env,
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
    )


_IMPORT_PREAMBLE = """
import dashboard.server as server
from fastapi import APIRouter
"""

# FastAPI >= 0.141 stores an included router as ONE lazy wrapper in
# app.routes (path=None), so a plain app.routes walk sees zero /api/v2 and
# /api/operator routes even though they are mounted and serving (BACKLOG
# 27/29; tests/dashboard/test_router_mounts_diagnostic.py). That made this
# audit's v2 coverage silently vacuous instead of failing loudly (BACKLOG
# 94a).
#
# A first fix (S-126 v1) collected the two known routers by a hardcoded
# name tuple ("dashboard.api_v2", "dashboard.api_operator"). Review found
# that reopens the identical failure class: any router added later that is
# not in the tuple is invisible to this audit, with a fully green suite and
# a live, reproducible unauthenticated data leak. Sweep every APIRouter
# instance bound at module scope on dashboard.server instead, exactly the
# way the P7 route matcher does (tests/moat/p7-no-fabricated-data.sh,
# `vars(server).items() if isinstance(v, APIRouter)`), so a future router
# nobody remembered to name is still audited. De-dup by (path, methods)
# since <= 0.128 already lists the same route objects both ways.
_DISCOVER_ROUTES = """
seen = {}
for r in server.app.routes:
    path = getattr(r, "path", None)
    if path is not None:
        seen[(path, frozenset(getattr(r, "methods", None) or ()))] = r
for _name, _router in sorted(vars(server).items()):
    if not isinstance(_router, APIRouter):
        continue
    for r in getattr(_router, "routes", []):
        path = getattr(r, "path", None)
        if path is not None:
            seen.setdefault((path, frozenset(getattr(r, "methods", None) or ())), r)
"""

_AUDIT_ASSERTIONS = r"""
unguarded = []
audited_v2 = 0
for r in seen.values():
    methods = getattr(r, "methods", None) or set()
    path = getattr(r, "path", None)
    if path is None or "GET" not in methods:
        continue
    if not path.startswith("/api/"):
        # Non-/api paths are shells/probes; only /api carries data.
        continue
    if path.startswith("/api/v2/"):
        audited_v2 += 1
    if path in PUBLIC_ALLOWLIST:
        continue
    deps = getattr(r, "dependencies", [])
    if len(deps) < 1:
        unguarded.append(path)

assert audited_v2 > 0, (
    "zero /api/v2 GET routes were audited; on FastAPI >= 0.141 this means "
    "the app.routes walk fell back to the vacuous case (BACKLOG 94a)"
)

# Second independent source: cross-check discovered routes against the
# OpenAPI schema, which FastAPI builds from its own internal route registry
# rather than the app.routes list this audit walks. A per-count threshold
# (audited_v2 > 0 above) catches total vacuity but not partial loss -- e.g.
# the operator router silently dropping to 0 while v2 stays nonzero. Compare
# every /api/* path with a GET operation individually instead.
import re as _re

# OpenAPI strips Starlette path-converter syntax (route.path keeps
# "{name:path}"/"{name:int}"; the OpenAPI schema only ever has "{name}"),
# so paths must be normalized the same way before comparing or every
# converter-typed path (e.g. /api/collab/file/{file_path:path}) false-flags
# as "missing".
_strip_converter = lambda p: _re.sub(r"\{(\w+):[^}]+\}", r"{\1}", p)

try:
    _openapi_paths = server.app.openapi().get("paths", {})
except Exception:
    _openapi_paths = {}
_openapi_get_paths = {
    p for p, ops in _openapi_paths.items() if p.startswith("/api/") and "get" in ops
}
_seen_paths = {_strip_converter(p) for (p, _methods) in seen.keys()}
_missing_from_audit = sorted(_openapi_get_paths - _seen_paths)
assert not _missing_from_audit, (
    "these /api/* GET paths are in the OpenAPI schema but were not audited "
    "(route discovery missed them): " + repr(_missing_from_audit)
)

assert not unguarded, (
    "These /api/* data GET routes have no auth dependency: " + repr(sorted(unguarded))
)
print("OK")
"""

_BODY_NO_UNGUARDED_DATA_GET = _IMPORT_PREAMBLE + _DISCOVER_ROUTES + _AUDIT_ASSERTIONS

# Regression fixture for the S-126 review finding: reproduce a router bound
# at server module scope AFTER this file was written (a completely realistic
# "someone ships a new router" scenario), exposing an unauthenticated GET. A
# hardcoded router-name tuple never sees this route; the dynamic
# vars(server) sweep in _DISCOVER_ROUTES must.
#
# Deliberately NOT app.include_router()'d: on FastAPI < 0.141, include_router
# copies the router's routes directly into app.routes, so the OLD hardcoded
# tuple code would find it there anyway and the fixture would pass on every
# FastAPI version regardless of whether router discovery is dynamic. Binding
# it at module scope without mounting it reproduces the ">= 0.141 lazy
# wrapper" blind spot (the route exists only on the router object, not on
# app.routes) on every FastAPI version, so this fixture is a real red/green
# signal everywhere, not just on the one pinned version.
_INJECT_LATE_ROUTER = """
_leak_router = APIRouter()


@_leak_router.get("/api/v3/leak-test-9f2c")
def _leak():
    return {"secret": "unauthenticated data leak"}


server.api_v3_leak_test_router = _leak_router
"""

_LEAK_PATH = "/api/v3/leak-test-9f2c"

# Runs the REAL audit body (discovery + assertions), not a copy of the
# discovery logic, against a server with the injected leak router. The audit
# must (a) discover it via the vars(server) sweep and (b) flag it as
# unguarded by name, reproducing the reviewer's end-to-end scenario: a live,
# unauthenticated data GET that the suite silently reports as covered.
_BODY_LATE_ROUTER_IS_DISCOVERED_AND_FLAGGED = (
    _IMPORT_PREAMBLE + _INJECT_LATE_ROUTER + _DISCOVER_ROUTES + _AUDIT_ASSERTIONS
)


# Spot-check that the specific high-value leaks named in the finding are guarded.
_LEAK_PROBES = [
    "/api/cost",
    "/api/budget",
    "/api/council/state",
    "/api/council/transcripts",
    "/api/escalations",
    "/api/app-runner/logs",
    "/api/findings/{iteration}",
    "/api/learnings",
    "/api/proofs",
    "/api/checklist",
    "/api/quality-report",
]

_BODY_NAMED_LEAKS_GUARDED = """
import dashboard.server as server

routes = {}
for r in server.app.routes:
    methods = getattr(r, "methods", None) or set()
    if "GET" in methods and hasattr(r, "path"):
        routes[r.path] = r

probes = %r
for path in probes:
    assert path in routes, f"{path} GET route missing"
    deps = getattr(routes[path], "dependencies", [])
    assert len(deps) >= 1, f"{path} must carry an auth dependency"
print("OK")
""" % (_LEAK_PROBES,)


# Static: routes that MUST stay public must carry NO auth dependency. This is the
# guard that was missing -- the prior test only allowlisted them, so over-gating
# (a 401 on /health -> k8s CrashLoop under enterprise auth) slipped through.
_BODY_PUBLIC_NOT_GATED = """
import dashboard.server as server

routes = {}
for r in server.app.routes:
    methods = getattr(r, "methods", None) or set()
    if "GET" in methods and hasattr(r, "path"):
        routes[r.path] = r

must_public = %r
over_gated = []
for path in must_public:
    r = routes.get(path)
    if r is None:
        continue  # route may be conditionally registered; skip if absent
    if len(getattr(r, "dependencies", [])) > 0:
        over_gated.append(path)

assert not over_gated, (
    "These MUST-BE-PUBLIC routes carry an auth dependency (regression: a 401 here "
    "breaks k8s probes / A2A discovery / Prometheus scrape under enterprise auth): "
    + repr(sorted(over_gated))
)
print("OK")
""" % (sorted(MUST_BE_PUBLIC),)

# Behavioral: with enterprise auth ON, a public route returns non-401 while a
# data route returns 401 (proves the scope guards work in BOTH directions).
_BODY_PUBLIC_BEHAVIORAL = """
try:
    from fastapi.testclient import TestClient
    import httpx  # noqa: F401
except Exception:
    print("SKIP: fastapi TestClient / httpx not available")
    raise SystemExit(0)

import os
os.environ["LOKI_ENTERPRISE_AUTH"] = "true"
import dashboard.server as server

client = TestClient(server.app, raise_server_exceptions=False)
# Public routes must NOT 401 even with no token.
for path in ["/health", "/api/auth/info", "/api/enterprise/status", "/metrics"]:
    rc = client.get(path).status_code
    assert rc != 401, f"PUBLIC route {path} returned 401 under enterprise auth (regression): {rc}"
# A data route MUST 401 without a token (the auth fix actually works).
data_rc = client.get("/api/cost").status_code
assert data_rc == 401, f"/api/cost should 401 without a token under enterprise auth, got {data_rc}"
print("OK")
"""


class AllDataGetsScopedTest(unittest.TestCase):
    def _assert_child_passed(self, proc):
        if proc.returncode != 0:
            self.fail(
                "subprocess assertion failed (exit "
                f"{proc.returncode}):\nSTDOUT:\n{proc.stdout}\n"
                f"STDERR:\n{proc.stderr}"
            )
        if "SKIP:" in proc.stdout:
            self.skipTest(proc.stdout.strip())

    def test_no_unguarded_api_data_get(self):
        proc = _run_in_subprocess(_BODY_NO_UNGUARDED_DATA_GET)
        self._assert_child_passed(proc)

    def test_late_bound_router_is_discovered_and_flagged(self):
        # This one must FAIL (nonzero exit) naming the leak path: a router
        # bound after this file was written, exposing an unauthenticated
        # GET, must be visible to the audit and reported, not silently
        # missed. A green/zero-exit result here means router discovery
        # missed it (S-126 review finding #1).
        proc = _run_in_subprocess(_BODY_LATE_ROUTER_IS_DISCOVERED_AND_FLAGGED)
        self.assertNotEqual(
            proc.returncode, 0,
            "the audit did not flag the late-bound unguarded router at all "
            f"(router discovery is not dynamic); stdout={proc.stdout!r}",
        )
        self.assertIn(
            _LEAK_PATH, proc.stderr,
            f"audit failed but did not name the leak path: {proc.stderr!r}",
        )

    def test_named_leak_endpoints_are_guarded(self):
        proc = _run_in_subprocess(_BODY_NAMED_LEAKS_GUARDED)
        self._assert_child_passed(proc)

    def test_public_routes_not_gated(self):
        proc = _run_in_subprocess(_BODY_PUBLIC_NOT_GATED)
        self._assert_child_passed(proc)

    def test_public_routes_non_401_under_enterprise_auth(self):
        proc = _run_in_subprocess(_BODY_PUBLIC_BEHAVIORAL)
        self._assert_child_passed(proc)


if __name__ == "__main__":
    unittest.main()
