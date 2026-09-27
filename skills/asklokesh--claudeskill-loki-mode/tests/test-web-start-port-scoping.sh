#!/usr/bin/env bash
# Regression test: `loki web start` (cmd_web_start) must never kill whoever
# holds its target port without verifying identity first.
#
# THE BUG. When the target port was already in use, cmd_web_start looked up
# the blocking PID via `lsof -ti:$port -sTCP:LISTEN` and killed it (TERM then
# KILL) with ZERO identity check -- any process listening on that port, ours
# or not, was signaled. Same D14/D15/D16 class as cmd_web_stop's sibling bugs
# in the same file.
#
# Fixed: the blocking PID must pass _loki_pid_looks_like_purplelab (anchored
# interpreter + exact server_py path + uid match) before being killed; if it
# does not, cmd_web_start refuses to start and tells the user to pick another
# port or stop the process manually, instead of killing it for them.
#
# T1 (static, LOAD-BEARING): the port-blocking-pid branch in cmd_web_start
# calls _loki_pid_looks_like_purplelab before any kill, and has a refuse path
# for a non-match.
# T2 (behavioral): a foreign, unrelated process holding the target port (not
# this installation's Purple Lab server) survives `loki web start --port N`,
# and the command reports an error rather than silently killing it. The
# decoy's own PID is recorded directly by $! -- never derived from a pattern
# match against real process argv.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"
PY_BIN="$(command -v python3.12 || command -v python3)"

[ -f "$LOKI" ] || { echo "FAIL: $LOKI missing"; exit 1; }

# --- T1: static checks -------------------------------------------------
WEBSTART_BODY=$(awk '/^cmd_web_start\(\)/{f=1} f{print} f&&/^}/{exit}' "$LOKI")
if [ -z "$WEBSTART_BODY" ]; then
    bad "could not isolate cmd_web_start() body"
else
    ok "isolated cmd_web_start() body"
fi

# The port-block section (between "port is already in use" and "Start the
# server") must verify identity before killing.
PORT_BLOCK=$(printf '%s\n' "$WEBSTART_BODY" | awk '/Check if port is already in use/{f=1} f{print} f&&/Start the server/{exit}')
if echo "$PORT_BLOCK" | grep -q '_loki_pid_looks_like_purplelab "\$blocking_pid"'; then
    ok "cmd_web_start verifies blocking_pid identity via _loki_pid_looks_like_purplelab"
else
    bad "cmd_web_start still kills the port-blocking pid with no identity check"
fi
if echo "$PORT_BLOCK" | grep -qE 'else'; then
    ok "cmd_web_start has a refuse-to-start path when the port holder is not ours"
else
    bad "cmd_web_start has no refuse path for a non-matching port holder"
fi

# --- T2: behavioral -------------------------------------------------------
# NOTE ON REACHABILITY: `loki web start` (the CLI path) no longer calls
# cmd_web_start at all -- since the v7.44.0 Purple-Lab deprecation,
# cmd_web()'s "start" case routes to cmd_web_redirect_to_dashboard instead
# (verified: cmd_web_start has zero callers in autonomy/loki today).
# cmd_web_start is DEAD CODE from the CLI's perspective, which is why this
# fix and test are LOW severity (not HIGH like cmd_web_stop's sibling bugs,
# which ARE reachable via 'loki web stop'): a real user cannot trigger the
# unscoped kill through any documented command today. It is still fixed and
# tested here as defense in depth, in case the function is ever wired back up
# or called by another future entry point. Because it is unreachable via the
# CLI, this test extracts and calls the function DIRECTLY (source, then
# invoke) rather than through `bash autonomy/loki web start`.
if [ -z "$PY_BIN" ]; then
    echo "SKIPPED: no python3 (T1 static checks above still count)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

PORT=$((42000 + (RANDOM % 3000)))
WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-webstart-XXXXXX")
trap 'rm -rf "$WORK"' EXIT

"$PY_BIN" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $PORT))
s.listen(5)
time.sleep(20)
" &
DECOY_PID=$!
sleep 0.4

if [ -z "$DECOY_PID" ] || ! kill -0 "$DECOY_PID" 2>/dev/null; then
    bad "decoy port holder did not start (test setup broken, not the function under test)"
elif ! lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$DECOY_PID"; then
    bad "positive control failed: lsof cannot enumerate the decoy port holder on this platform"
else
    ok "positive control: lsof enumerates the decoy port holder before web start"
    # Extract ONLY the port-block section plus the helper it depends on, and
    # a minimal harness that mimics cmd_web_start's local variables up to
    # that point, then execute it standalone (bypassing the CLI dispatcher,
    # which no longer reaches this code, and bypassing venv setup / server
    # launch, which are irrelevant to the identity check under test).
    HELPER_BODY=$(awk '/^_loki_pid_looks_like_purplelab\(\) \{/,/^\}/' "$LOKI")
    HARNESS="$WORK/webstart_portblock.sh"
    {
        echo 'RED="";  GREEN=""; YELLOW=""; NC=""'
        echo "SKILL_DIR='$REPO_ROOT'"
        echo "port='$PORT'"
        printf '%s\n' "$HELPER_BODY"
        printf '%s\n' "$PORT_BLOCK"
        echo 'echo "PORTBLOCK_RC=$?"'
    } > "$HARNESS"
    OUT=$(bash "$HARNESS" 2>&1)
    sleep 0.3
    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "foreign port holder survives the extracted port-block logic (identity-checked)"
    else
        bad "foreign port holder was KILLED by the extracted port-block logic -- the bug is still present"
    fi
    if printf '%s' "$OUT" | grep -q "not this installation's Purple Lab server"; then
        ok "port-block logic reports the refuse-to-kill message for a non-matching holder"
    else
        bad "port-block logic did not report a refusal (out=$OUT)"
    fi
fi

kill -9 "$DECOY_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
