#!/usr/bin/env bash
# An audit entry must never assert an actor that was never established.
#
# THE DEFECT: web-app/server.py's _audit() hardcoded user="system" on every
# entry, and neither of its two call sites passed anything else. An audit trail
# that cannot say WHO did something is not an audit trail, and "system" is worse
# than blank: it asserts an actor nobody verified.
#
# This is the default posture, not an edge case. web-app/auth.py:1-4 states that
# with no DATABASE_URL, authentication is completely disabled and all endpoints
# are open, and /api/audit-log (server.py:7850) has no auth dependency. So the
# actor is genuinely UNKNOWABLE by default, and the honest record says so.
#
# Three states, never collapsed:
#   identified      - an authenticated principal
#   unauthenticated - auth not configured; actor genuinely unknowable
#   unreadable      - lookup failed; recorded so it is not mistaken for the above
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-audit-actor-attribution"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: actor attribution was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# Drive the REAL functions extracted from server.py rather than a copy: a second
# implementation is how the two drift apart silently.
OUT="$(python3 - "$WORK" <<'PY' 2>&1
import sys, os, io, re, json, uuid, types
from datetime import datetime
from pathlib import Path

W = sys.argv[1]
try:
    src = io.open('web-app/server.py', encoding='utf-8').read()
except OSError as e:
    print("UNREADABLE %s" % e)
    raise SystemExit

def grab(name):
    i = src.index('def %s(' % name)
    rest = src[i:]
    m = re.search(r'\n(?=@app|def |class )', rest[1:])
    return rest[:m.start() + 1] if m else rest

ns = {'json': json, 'os': os, 'uuid': uuid, 'datetime': datetime, 'Path': Path}
ns['_loki_dir'] = lambda: Path(W)
ns['_ensure_loki_dir'] = lambda: os.makedirs(W, exist_ok=True)
try:
    for fn in ('_load_audit_log', '_append_audit_log', '_audit_actor', '_audit'):
        exec(grab(fn), ns)
except Exception as e:
    print("EXTRACT_FAILED %s: %s" % (type(e).__name__, e))
    raise SystemExit

# A: no request (the DEFAULT posture: auth disabled, actor unknowable)
ns['_audit']('team.created', target='acme')
# B: an authenticated principal
req = types.SimpleNamespace(state=types.SimpleNamespace(user={'sub': 'alice@corp'}))
ns['_audit']('member.added', target='bob@corp', request=req)
# C: attribution itself raises
class Boom:
    @property
    def state(self):
        raise RuntimeError('boom')
ns['_audit']('team.created', target='x', request=Boom())

for e in reversed(ns['_load_audit_log']()):
    print("%s|%s|%s" % (e['action'], e['user'], e.get('actor_state')))
PY
)"

case "$OUT" in
    UNREADABLE*|EXTRACT_FAILED*)
        fail "could not drive the real _audit functions ($OUT) -- unmeasured, not clean"
        echo "  $PASS passed, $FAIL failed"
        exit 1
        ;;
esac
pass "extracted and drove the real _audit functions from server.py"

# 1. The default posture must be honest, not "system".
if printf '%s' "$OUT" | grep -q 'team.created|unknown|unauthenticated'; then
    pass "no auth configured: recorded as unauthenticated, not as a fabricated actor"
else
    fail "default posture not recorded honestly: $(printf '%s' "$OUT" | tr '\n' ' ')"
fi

# 2. An authenticated principal must actually be attributed. Without this the
#    fix would be "always say unknown", which is honest but useless.
if printf '%s' "$OUT" | grep -q 'member.added|alice@corp|identified'; then
    pass "authenticated principal is attributed by id"
else
    fail "authenticated principal was not attributed: $(printf '%s' "$OUT" | tr '\n' ' ')"
fi

# 3. A failed lookup is its own state, never silently folded into the others.
if printf '%s' "$OUT" | grep -q '|unreadable'; then
    pass "a failed actor lookup records unreadable, distinct from unauthenticated"
else
    fail "failed lookup was not distinguished: $(printf '%s' "$OUT" | tr '\n' ' ')"
fi

# 4. The fabricated default must be gone from the source.
if grep -q 'def _audit(action: str, user: str = "system"' web-app/server.py; then
    fail 'server.py still defaults the audit actor to "system"'
else
    pass "the hardcoded system actor default is gone"
fi

# 5. This log must not be mistaken for the tamper-evident one. It rewrites a
#    500-entry array in place on every append, so it is a recent-activity view.
if grep -q 'NOT tamper-evident' web-app/server.py; then
    pass "the log states plainly that it is not tamper-evident"
else
    fail "server.py does not say this log is not tamper-evident; it may be cited as audit evidence"
fi

# 6. The team `role` field must be marked as non-enforcing. Measured: it is
#    written and echoed and never read for any authorization decision, and the
#    routes carrying it have no auth dependency. A field that LOOKS like a
#    permission and enforces nothing is worse than no field.
if grep -q 'NOT AN AUTHORIZATION CONTROL' web-app/server.py; then
    pass "the team role field is marked as non-enforcing"
else
    fail "web-app/server.py presents role as a control without saying it enforces nothing"
fi

# 7. The buyer-facing authorization claim must name its precondition.
#    require_scope IS real enforcement, but returns allow when auth is disabled
#    (dashboard/auth.py:787-788), which is the default.
if [ ! -f wiki/Enterprise.md ]; then
    fail "wiki/Enterprise.md is missing; cannot verify the authorization claim"
elif grep -q 'require_scope' wiki/Enterprise.md; then
    pass "the authorization claim names require_scope and its precondition"
else
    fail "wiki/Enterprise.md claims role-based scopes without naming when they apply"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
