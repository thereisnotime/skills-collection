#!/usr/bin/env bash
# Regression test: tests/test-runtime-gate.sh's port-reclaim sweeps must never
# kill a process it did not itself start.
#
# THE BUG. Nine sweeps against hardcoded ports 3000, 5173 (the most common
# React/Next and Vite dev-server ports) and one dynamic daemon port ran
# `lsof -ti tcp:$PORT` with NO -sTCP:LISTEN filter and NO ownership check,
# then `kill -9` on every returned PID. Running this suite could SIGKILL a
# developer's own npm/vite dev server, or any client process (e.g. a browser
# tab) with an open connection whose remote port happened to match. Same
# D14/D15/D16 class as this session's other fixes.
#
# Fixed with a shared _reap_own_port() helper: enumerate -sTCP:LISTEN holders
# only, and kill a holder ONLY if its cwd resolves under this suite's own
# TMP_ROOT (every fixture repo this suite boots an app in lives there). A
# foreign holder is left alone and the helper returns nonzero so callers skip
# the case instead of proceeding.
#
# T1 (static, LOAD-BEARING): no bare `lsof -ti tcp:... | kill` remains outside
# the helper itself.
# T2 (behavioral): a decoy LISTENER with a foreign cwd (not under this test's
# own TMP_ROOT) survives; a decoy CLIENT holding only an outbound connection
# whose remote port matches survives (would have been killed by the old
# unfiltered lsof -ti); a genuine own-tree listener (cwd resolved under a
# fake TMP_ROOT this test constructs) is still reclaimed, proving the fix
# does not just delete all kill logic.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$REPO_ROOT/tests/test-runtime-gate.sh"
PY="$(command -v python3.12 || command -v python3)"

[ -f "$TARGET" ] || { echo "FAIL: $TARGET missing"; exit 1; }

# --- T1: static check -------------------------------------------------------
CODE=$(grep -v '^[[:space:]]*#' "$TARGET")
# Every remaining `lsof -ti tcp:` line must be either inside _reap_own_port
# (uses -sTCP:LISTEN) or a read-only leak-check (also now -sTCP:LISTEN, no
# kill on the same line/pipeline).
BARE_KILL_LINES=$(echo "$CODE" | grep -E 'lsof -ti tcp:.*\|.*kill' || true)
if [ -n "$BARE_KILL_LINES" ]; then
    bad "a bare lsof-piped-to-kill line remains outside _reap_own_port: $BARE_KILL_LINES"
else
    ok "no bare lsof-piped-to-kill line remains in test-runtime-gate.sh"
fi
UNFILTERED_LSOF=$(echo "$CODE" | grep -E 'lsof -ti tcp:"?\$?[A-Za-z_0-9]*"?[[:space:]]+2>/dev/null' | grep -v -- '-sTCP:LISTEN' || true)
if [ -n "$UNFILTERED_LSOF" ]; then
    bad "an lsof -ti tcp: call without -sTCP:LISTEN remains: $UNFILTERED_LSOF"
else
    ok "every lsof -ti tcp: call filters to -sTCP:LISTEN"
fi
if echo "$CODE" | grep -q '_pid_cwd_is_ours'; then
    ok "_reap_own_port verifies candidate identity via cwd before killing"
else
    bad "_reap_own_port does not appear to verify identity before killing"
fi

# --- T2: behavioral ----------------------------------------------------------
if [ -z "$PY" ]; then
    echo "SKIPPED: no python3 (T1 static checks above still count)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-rtgateport-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
FN_FILE="$WORK/helpers.sh"
{
    echo "TMP_ROOT=\"$WORK/fake-tmp-root\""
    mkdir -p "$WORK/fake-tmp-root"
    echo "TMP_ROOT_REAL=\"\$(cd \"\$TMP_ROOT\" && pwd -P)\""
    awk '/^_pid_cwd_is_ours\(\) \{/,/^\}/' "$TARGET"
    awk '/^_reap_own_port\(\) \{/,/^\}/' "$TARGET"
} > "$FN_FILE"
# shellcheck disable=SC1090
source "$FN_FILE"

# Poll up to 10s for a listener to actually be bound on $1 (LISTEN state).
# The pidfile-write loops above only prove the process was fork/exec'd, not
# that its bind()+listen() has completed -- checking lsof right after that
# races the child. Returns 1 (clear timeout) if nothing ever listens.
_wait_for_listen() {
    local port="$1" i=0
    while [ $i -lt 100 ]; do
        lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
        sleep 0.1
        i=$((i+1))
    done
    return 1
}

PORT=$((49000 + (RANDOM % 3000)))

# --- Decoy A: a LISTENER with a FOREIGN cwd (NOT under TMP_ROOT) -----------
FOREIGN_CWD=$(mktemp -d "${TMPDIR:-/tmp}/loki-rtgateport-foreign-XXXXXX")
FOREIGN_PIDFILE="$WORK/foreign.pid"
(
    cd "$FOREIGN_CWD" || exit 1
    "$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $PORT))
s.listen(5)
time.sleep(20)
" &
    echo $! > "$FOREIGN_PIDFILE"
    wait
) >/dev/null 2>&1 &
LAUNCHER_BG=$!
i=0
while [ $i -lt 40 ]; do [ -s "$FOREIGN_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
FOREIGN_PID=$(cat "$FOREIGN_PIDFILE" 2>/dev/null || true)

if [ -z "$FOREIGN_PID" ] || ! kill -0 "$FOREIGN_PID" 2>/dev/null; then
    bad "foreign-cwd decoy listener did not start (test setup broken, not the function under test)"
elif ! _wait_for_listen "$PORT"; then
    bad "positive control failed: foreign-cwd decoy listener on port $PORT never reached LISTEN within 10s"
elif ! lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$FOREIGN_PID"; then
    bad "positive control failed: lsof cannot enumerate the foreign-cwd decoy listener"
else
    ok "positive control: lsof enumerates the foreign-cwd decoy listener before reap"
    if _reap_own_port "$PORT"; then
        bad "_reap_own_port returned success despite a foreign holder remaining (should report failure)"
    else
        ok "_reap_own_port correctly reports failure when a foreign holder remains"
    fi
    if kill -0 "$FOREIGN_PID" 2>/dev/null; then
        ok "foreign-cwd decoy listener survives _reap_own_port"
    else
        bad "foreign-cwd decoy listener was KILLED by _reap_own_port -- the bug is still present"
    fi
fi
kill -9 "$FOREIGN_PID" 2>/dev/null || true
kill -9 "$LAUNCHER_BG" 2>/dev/null || true
rm -rf "$FOREIGN_CWD"

# --- Decoy B: a CLIENT holding only an OUTBOUND connection whose remote port
# matches (never listens on $PORT itself) -- would have been killed by the
# old unfiltered `lsof -ti tcp:$PORT` (no -sTCP:LISTEN).
CLIENT_PORT=$((52000 + (RANDOM % 3000)))
SERVER_PIDFILE="$WORK/clientsrv.pid"
"$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $CLIENT_PORT))
s.listen(5)
conn, _ = s.accept()
time.sleep(20)
" &
SERVER_PID=$!
echo "$SERVER_PID" > "$SERVER_PIDFILE"
i=0
while [ $i -lt 40 ]; do lsof -ti tcp:"$CLIENT_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$SERVER_PID" && break; sleep 0.1; i=$((i+1)); done

CLIENT_PIDFILE="$WORK/client.pid"
(
    cd "$FOREIGN_CWD" 2>/dev/null || cd "$WORK" || exit 1
    "$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', $CLIENT_PORT))
time.sleep(20)
" &
    echo $! > "$CLIENT_PIDFILE"
    wait
) >/dev/null 2>&1 &
CLIENT_LAUNCHER_BG=$!
i=0
while [ $i -lt 40 ]; do [ -s "$CLIENT_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
CLIENT_PID=$(cat "$CLIENT_PIDFILE" 2>/dev/null || true)

if [ -z "$CLIENT_PID" ] || ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    bad "client decoy did not start (test setup broken, not the function under test)"
elif ! lsof -ti tcp:"$CLIENT_PORT" 2>/dev/null | grep -qx "$CLIENT_PID"; then
    bad "positive control failed: the old unfiltered lsof cannot even enumerate the client decoy (would have been vacuous evidence for the old bug)"
else
    ok "positive control: unfiltered lsof -ti tcp:$CLIENT_PORT enumerates the client decoy (proves the old code path would have matched it)"
    if lsof -ti tcp:"$CLIENT_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$CLIENT_PID"; then
        bad "setup error: -sTCP:LISTEN unexpectedly matched the client decoy too"
    else
        ok "-sTCP:LISTEN correctly excludes the client decoy (it never listens, only connects out)"
    fi
    _reap_own_port "$CLIENT_PORT" >/dev/null 2>&1 || true
    if kill -0 "$CLIENT_PID" 2>/dev/null; then
        ok "client decoy (outbound connection only) survives _reap_own_port"
    else
        bad "client decoy was KILLED by _reap_own_port -- the bug is still present"
    fi
fi
kill -9 "$CLIENT_PID" 2>/dev/null || true
kill -9 "$CLIENT_LAUNCHER_BG" 2>/dev/null || true
kill -9 "$SERVER_PID" 2>/dev/null || true

# --- Decoy C: a genuine OWN-TREE listener (cwd resolved under the fake
# TMP_ROOT this test constructed) IS still reclaimed -- proving the fix does
# not just delete all kill logic.
OWN_PORT=$((55000 + (RANDOM % 3000)))
OWN_PIDFILE="$WORK/own.pid"
(
    cd "$TMP_ROOT" || exit 1
    "$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $OWN_PORT))
s.listen(5)
time.sleep(20)
" &
    echo $! > "$OWN_PIDFILE"
    wait
) >/dev/null 2>&1 &
OWN_LAUNCHER_BG=$!
i=0
while [ $i -lt 40 ]; do [ -s "$OWN_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
OWN_PID=$(cat "$OWN_PIDFILE" 2>/dev/null || true)

if [ -z "$OWN_PID" ] || ! kill -0 "$OWN_PID" 2>/dev/null; then
    bad "own-tree decoy listener did not start (test setup broken, not the function under test)"
elif ! _wait_for_listen "$OWN_PORT"; then
    bad "positive control failed: own-tree decoy listener on port $OWN_PORT never reached LISTEN within 10s"
elif ! lsof -ti tcp:"$OWN_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$OWN_PID"; then
    bad "positive control failed: lsof cannot enumerate the own-tree decoy listener"
else
    ok "positive control: lsof enumerates the own-tree decoy listener before reap"
    if _reap_own_port "$OWN_PORT"; then
        ok "_reap_own_port reports success for an own-tree holder"
    else
        bad "_reap_own_port reports failure for a genuine own-tree holder"
    fi
    if kill -0 "$OWN_PID" 2>/dev/null; then
        bad "own-tree listener was NOT reclaimed -- the fix deleted the kill logic instead of scoping it"
    else
        ok "own-tree listener (cwd under TMP_ROOT) is reclaimed"
    fi
fi
kill -9 "$OWN_PID" 2>/dev/null || true
kill -9 "$OWN_LAUNCHER_BG" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
