#!/usr/bin/env bash
# Regression test: tests/integration/test_dashboard_api_smoke.sh's cleanup
# trap must kill only the PID it recorded itself, never re-derive one from
# the port.
#
# THE BUG. The script writes its own dashboard server's PID to
# $TMPDIR/dash.pid via $! right after backgrounding it, but its EXIT trap
# never read that file -- it re-derived a PID via unfiltered
# `lsof -ti:"$PORT"` (port 57374, the real default dashboard port; no
# -sTCP:LISTEN, no ownership check) and `kill -9`'d every match. The
# startup-time skip-if-busy check does not protect against a client
# connecting to the dashboard mid-test, or an unrelated process binding the
# port after this script's own server dies, either of which would also be
# killed. Same D14/D15/D16 class as this session's other fixes.
#
# Fixed to kill only the PID recorded in $TMPDIR/dash.pid.
#
# T1 (static, LOAD-BEARING): the cleanup() function no longer derives a kill
# target from lsof -ti:"$PORT"; it reads $TMPDIR/dash.pid.
# T2 (behavioral): the extracted cleanup() logic, run against a fixture
# directory holding a recorded PID, kills ONLY that PID and leaves a foreign
# process on the same port-shaped fixture alone (the port itself is not
# touched by the extracted logic at all, by construction of the fix -- this
# proves the fix, since the pre-fix cleanup killed by port instead).
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$REPO_ROOT/tests/integration/test_dashboard_api_smoke.sh"
PY="$(command -v python3.12 || command -v python3)"

[ -f "$TARGET" ] || { echo "FAIL: $TARGET missing"; exit 1; }

# --- T1: static checks -------------------------------------------------
CLEANUP_BODY=$(awk '/^cleanup\(\) \{/,/^\}/' "$TARGET")
[ -n "$CLEANUP_BODY" ] || { echo "FAIL: could not extract cleanup() from $TARGET"; exit 1; }
CLEANUP_CODE=$(echo "$CLEANUP_BODY" | grep -v '^[[:space:]]*#')

if echo "$CLEANUP_CODE" | grep -qE 'lsof -ti:"\$PORT"'; then
    bad "cleanup() still re-derives a kill target from lsof -ti:\"\$PORT\""
else
    ok "cleanup() no longer re-derives a kill target from the port"
fi
if echo "$CLEANUP_CODE" | grep -q 'dash\.pid'; then
    ok "cleanup() reads the recorded dash.pid file"
else
    bad "cleanup() does not read the recorded dash.pid file"
fi

# --- T2: behavioral ------------------------------------------------------
if [ -z "$PY" ]; then
    echo "SKIPPED: no python3 (T1 static checks above still count)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-dashsmoketest-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
# Isolated random port, NOT the real 57374: both decoys below actually bind a
# port so the pre-fix lsof -ti:"$PORT" lookup this test also exercises (for
# RED evidence against the unmodified script) has something real to find --
# an unbound sleep() would make that lookup vacuously empty on either version.
TEST_PORT=$((53000 + (RANDOM % 3000)))

# Own process: this test's stand-in for the real dashboard server, recorded
# via $! exactly as the target script does -- same filename ($TMPDIR/dash.pid)
# the real script's cleanup() reads. Binds TEST_PORT.
OWN_PIDFILE="$WORK/dash.pid"
"$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $TEST_PORT))
s.listen(5)
time.sleep(20)
" &
OWN_PID=$!
echo "$OWN_PID" > "$OWN_PIDFILE"

if [ -z "$OWN_PID" ] || ! kill -0 "$OWN_PID" 2>/dev/null; then
    bad "own decoy did not start (test setup broken, not the function under test)"
else
    i=0
    while [ $i -lt 40 ]; do lsof -ti tcp:"$TEST_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$OWN_PID" && break; sleep 0.1; i=$((i+1)); done
fi

# Foreign process: NOT recorded anywhere, simulating a client connection or an
# unrelated process that bound the same port after the real server died
# (SO_REUSEADDR lets a second bind succeed once the first releases the socket,
# but here it simulates a distinct holder found by a port-derived lookup --
# started only after the own decoy is confirmed listening, then the own decoy
# is stopped and the port re-bound by the foreign one, exactly the "unrelated
# process bound the port after this script's own server died" scenario the
# fix description names).
kill -9 "$OWN_PID" 2>/dev/null || true
sleep 0.3
FOREIGN_PIDFILE="$WORK/foreign.pid"
"$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $TEST_PORT))
s.listen(5)
time.sleep(20)
" &
FOREIGN_PID=$!
echo "$FOREIGN_PID" > "$FOREIGN_PIDFILE"
i=0
while [ $i -lt 40 ]; do lsof -ti tcp:"$TEST_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$FOREIGN_PID" && break; sleep 0.1; i=$((i+1)); done

# Re-launch the "own" decoy fresh (a plain sleep this time; it no longer needs
# the port -- the PID-file path being tested does not look at the port at
# all) so the fixed cleanup() has a real dash.pid target to kill.
"$PY" -c "
import time
time.sleep(20)
" &
OWN_PID=$!
echo "$OWN_PID" > "$OWN_PIDFILE"

if [ -z "$FOREIGN_PID" ] || ! kill -0 "$FOREIGN_PID" 2>/dev/null \
   || [ -z "$OWN_PID" ] || ! kill -0 "$OWN_PID" 2>/dev/null; then
    bad "own/foreign decoys did not start (test setup broken, not the function under test)"
elif ! lsof -ti tcp:"$TEST_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$FOREIGN_PID"; then
    bad "positive control failed: lsof cannot enumerate the foreign decoy holding TEST_PORT"
else
    ok "positive control: lsof enumerates the foreign decoy on TEST_PORT, and the own decoy is alive with its PID recorded"

    # Extract and run ONLY the fixed cleanup() logic, pointed at a fixture
    # TMPDIR holding the recorded PID and PORT=TEST_PORT (never the real
    # 57374) -- exactly the shape the real script constructs, without
    # booting a real dashboard server or touching the real dashboard port.
    HARNESS="$WORK/cleanup_harness.sh"
    {
        echo "TMPDIR=\"$WORK\""
        echo "PORT=$TEST_PORT"
        printf '%s\n' "$CLEANUP_BODY"
        echo 'cleanup'
    } > "$HARNESS"
    bash "$HARNESS" >/dev/null 2>&1

    sleep 0.3
    if kill -0 "$OWN_PID" 2>/dev/null; then
        bad "recorded own PID was NOT killed by cleanup() -- the fix broke the intended kill path"
    else
        ok "cleanup() kills the PID it recorded itself (dash.pid)"
    fi
    if kill -0 "$FOREIGN_PID" 2>/dev/null; then
        ok "foreign process holding the same port survives cleanup() (no port-derived kill)"
    else
        bad "foreign process holding the same port was KILLED by cleanup() -- the bug is still present"
    fi
fi

kill -9 "$OWN_PID" 2>/dev/null || true
kill -9 "$FOREIGN_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
