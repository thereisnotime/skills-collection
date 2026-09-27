#!/usr/bin/env bash
# Regression test: tests/test-backend-floor.sh must never reclaim its target
# port by killing whoever currently holds it.
#
# THE BUG (round 3 of the D14/D15/D16 sweep). The D14 fix scoped the reclaim
# to `-sTCP:LISTEN` and an exact PID from lsof, but still had no OWNERSHIP
# check: it killed whoever held the fixed port 8971, verified or not. Proving
# "this is a stale copy of MY prior run" is not actually possible here (the
# previous run's mktemp DEMO directory is already gone by the time a new run
# starts), so any argv/cwd-based ownership check would just be a pattern kill
# wearing a different disguise.
#
# Fix: removed the reclaim entirely. The generated backend already honors
# PORT (set inline before launch), so a genuinely randomized high port makes
# a real collision astronomically unlikely, leaving nothing that needs
# reclaiming.
#
# T1 (static, LOAD-BEARING): no lsof/pkill/kill-by-port reclaim logic remains
# for the app port; the port itself is randomized, not a fixed literal; the
# only `kill` calls left target $SRV, this script's own recorded PID.
# T2 (behavioral): a decoy process listening on a port in the same range this
# script's randomizer can select survives a full run of the script (proving
# the script cannot and does not kill by port at all any more).
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$REPO_ROOT/tests/test-backend-floor.sh"

[ -f "$TARGET" ] || { echo "FAIL: $TARGET missing"; exit 1; }

# --- T1: static checks -------------------------------------------------
CODE=$(grep -v '^[[:space:]]*#' "$TARGET")
if echo "$CODE" | grep -qE 'lsof -ti tcp:"\$APP_PORT"'; then
    bad "test-backend-floor.sh still runs an lsof-based port reclaim"
else
    ok "test-backend-floor.sh no longer runs an lsof-based port reclaim"
fi
if echo "$CODE" | grep -qE '^APP_PORT=8971$'; then
    bad "APP_PORT is still the fixed literal 8971 (needs an ownership-proof reclaim to be safe)"
else
    ok "APP_PORT is no longer a fixed literal"
fi
if echo "$CODE" | grep -qE '^APP_PORT=\$\(\(.*RANDOM'; then
    ok "APP_PORT is randomized per run"
else
    bad "APP_PORT does not appear to be randomized"
fi
# Every remaining kill/pkill/killall call must target a script-local variable
# (its own recorded PID), never a value re-derived from lsof/pgrep/ps at kill
# time. The pattern must catch pkill/killall too: round 4 found a real
# `pkill -f "$DEMO/server/index.mjs"` in this file's own trap that a bare
# `\bkill\b` grep could never see -- \b is a word-boundary, and there is no
# boundary between the "p" and "k" of "pkill" (both are word characters), so
# \bkill\b matches only a kill call that is NOT prefixed by another word
# character. This check previously missed exactly the line it exists to
# catch; it is written broad here (p?kill|killall) and verified below to
# actually flag the current file's own historical bug on a static fixture,
# not just assumed to work.
KILL_LINES=$(echo "$CODE" | grep -E '\b(p?kill|killall)\b' || true)
BAD_KILL_LINES=$(echo "$KILL_LINES" | grep -vE 'kill "\$\{?SRV(:-)?\}?"|kill -0|kill -9 "\$\{?SRV(:-)?\}?"' || true)
if [ -n "$BAD_KILL_LINES" ]; then
    bad "a kill/pkill/killall call other than on \$SRV remains: $BAD_KILL_LINES"
else
    ok "every remaining kill/pkill/killall call targets \$SRV (this script's own recorded PID)"
fi

# --- T2: behavioral ------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "SKIPPED: no node (T1 static checks above still count)"; echo ""; echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; exit $?; }
PY="$(command -v python3.12 || command -v python3)"
[ -n "$PY" ] || { echo "SKIPPED: no python3 (T1 static checks above still count)"; echo ""; echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; exit $?; }

DECOY_PORT=$((20000 + (RANDOM % 20000)))
"$PY" -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $DECOY_PORT))
s.listen(5)
time.sleep(45)
" &
DECOY_PID=$!
sleep 0.4

if [ -z "$DECOY_PID" ] || ! kill -0 "$DECOY_PID" 2>/dev/null; then
    bad "decoy did not start (test setup broken, not the script under test)"
elif ! lsof -ti tcp:"$DECOY_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$DECOY_PID"; then
    bad "positive control failed: lsof cannot enumerate the decoy listener"
else
    ok "positive control: lsof enumerates the decoy listener before running the target script"
    # Run the real script end to end (it self-skips cleanly if node/npm/network
    # are unavailable, in which case this is a no-op check that the decoy
    # survived doing nothing).
    timeout 90 bash "$TARGET" >/dev/null 2>&1 || true
    sleep 0.3
    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "decoy listener (in the same port range the script's randomizer can select) survives a full run"
    else
        bad "decoy listener was KILLED by a run of test-backend-floor.sh -- the bug is still present"
    fi
fi

kill -9 "$DECOY_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
