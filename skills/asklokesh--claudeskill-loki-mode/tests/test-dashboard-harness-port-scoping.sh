#!/usr/bin/env bash
# Regression test: scripts/run-dashboard-fresh-repo-harness.sh and
# scripts/run-dashboard-evidence-panels-harness.sh must never kill a process
# they did not themselves start.
#
# THE BUG. Both scripts' cleanup traps ran `lsof -ti:"$PORT" | xargs kill -9`
# instead of killing their own recorded $SERVER_PID, and both re-ran the same
# unscoped port sweep again before booting. A port-derived PID that is killed
# without checking it is the PID this run itself started is the same class as
# D14 (`pkill -f "index.mjs"`): on a machine running concurrent worktrees or
# CI shards -- this repo's own documented topology -- another shard's harness
# run (or a developer's real dev server) on the same default port would be
# killed instead. Fixed to (1) kill only $SERVER_PID in cleanup, and (2)
# refuse to boot with an error if the port is already busy, rather than
# killing whoever holds it. See docs/v10/DECISIONS.md D14/D15/D16.
#
# T1 (static, LOAD-BEARING): neither script's cleanup trap nor pre-boot check
# contains an unscoped `lsof -ti:"$PORT" | xargs kill`.
# T2 (behavioral): a decoy process listening on the harness's default port,
# started by this test (not the harness), survives the harness's cleanup
# path being exercised. The decoy records its own PID directly ($!) --
# never derived from a port/pattern lookup -- and the harness is invoked in a
# way that reaches its EXIT trap without ever having started its own server
# (LOKI_DASH_PY pointed at a nonexistent interpreter forces an early,
# deterministic failure before uvicorn is launched, so SERVER_PID stays
# empty and any survival of the port holder is attributable ONLY to the
# cleanup trap, not to a timing race).
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for rel in scripts/run-dashboard-fresh-repo-harness.sh scripts/run-dashboard-evidence-panels-harness.sh; do
    f="$REPO_ROOT/$rel"
    [ -f "$f" ] || { bad "$rel missing"; continue; }
    # Strip comments so the fix's own explanatory prose (which names the old
    # pattern) cannot trip this assertion on fixed code.
    CODE=$(grep -v '^[[:space:]]*#' "$f")
    if echo "$CODE" | grep -qE 'lsof[^|]*\|[^|]*xargs[^|]*kill'; then
        bad "$rel still pipes lsof into xargs kill (unscoped port kill)"
    else
        ok "$rel has no unscoped lsof|xargs kill"
    fi
    if echo "$CODE" | grep -qE 'lsof.*-sTCP:LISTEN'; then
        ok "$rel checks port ownership (-sTCP:LISTEN) before acting"
    else
        bad "$rel does not check port ownership before acting"
    fi
done

# --- T2: behavioral -- a foreign port-holder decoy survives the harness's --
# cleanup path, for both harness scripts.
PY_MISSING="/nonexistent/loki-test-py-$$-${RANDOM}"
for pair in \
    "scripts/run-dashboard-fresh-repo-harness.sh:LOKI_DASH_HARNESS_PORT" \
    "scripts/run-dashboard-evidence-panels-harness.sh:LOKI_DASH_PANELS_PORT"
do
    rel="${pair%%:*}"
    portvar="${pair##*:}"
    f="$REPO_ROOT/$rel"
    [ -f "$f" ] || continue

    WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-harness-scope-XXXXXX")
    trap 'rm -rf "$WORK"' RETURN 2>/dev/null || true

    # Pick a free-ish high port for this run so parallel test invocations do
    # not collide with each other.
    PORT=$((40000 + (RANDOM % 10000)))

    # Decoy: a real listener on $PORT that this TEST starts and records by $!.
    PY=$(command -v python3.12 || command -v python3)
    if [ -z "$PY" ]; then
        echo "SKIPPED: no python3 (cannot run decoy listener for $rel)"
        rm -rf "$WORK"
        continue
    fi
    "$PY" -c "
import http.server, socketserver, sys
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', $PORT), http.server.BaseHTTPRequestHandler) as httpd:
    httpd.serve_forever()
" >/dev/null 2>&1 &
    DECOY_PID=$!
    sleep 0.5
    if ! kill -0 "$DECOY_PID" 2>/dev/null; then
        bad "decoy listener on port $PORT did not start (test setup broken, not the script under test) [$rel]"
        rm -rf "$WORK"
        continue
    fi

    # Run the harness with its interpreter pointed at a nonexistent binary so
    # it fails deterministically before ever launching its own server
    # (SERVER_PID stays empty), then reaches its EXIT trap. Any survival of
    # the decoy is attributable only to the trap, never to a race with a
    # real uvicorn boot.
    env "$portvar=$PORT" LOKI_DASH_PY="$PY_MISSING" timeout 15 bash "$f" >/dev/null 2>&1 || true

    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "foreign port-$PORT holder survived $rel's cleanup path"
    else
        bad "foreign port-$PORT holder was KILLED by $rel's cleanup path -- the bug is still present"
    fi
    kill -9 "$DECOY_PID" 2>/dev/null || true
    rm -rf "$WORK"
done

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
