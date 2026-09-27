#!/usr/bin/env bash
# Regression test: scripts/cleanup-test-processes.sh must never kill a process
# without --aggressive, and even then must scope by this user's own uid.
#
# THE BUG. The known-name sweep (mutation-probe/loki-run-/loadgen) and the
# port-57374 sweep killed unconditionally in default mode, with no uid check.
# On a shared machine another user's process could coincidentally match one of
# those substrings, and the port sweep would kill whoever else held port
# 57374, including the operator's own real dashboard. Fixed to (1) report by
# default and only kill with --aggressive, matching the design this script
# already used for its "unrecognised CPU hogs" sweep, and (2) scope every
# pgrep/pkill/port-PID kill decision to `-u "$(id -u)"`. See
# docs/v10/DECISIONS.md D14/D15/D16.
#
# T1 (static, LOAD-BEARING): the known-name sweep and the port sweep no longer
# kill unconditionally in default mode, and every pgrep/pkill call is scoped
# with -u.
# T2 (behavioral): a decoy process matching one of the known-name substrings,
# started by this test and recorded by its own $!, survives a default-mode run
# of the script.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SH="$REPO_ROOT/scripts/cleanup-test-processes.sh"

[ -f "$CLEANUP_SH" ] || { echo "FAIL: $CLEANUP_SH missing"; exit 1; }

# --- T1: static checks -------------------------------------------------
# The default-mode branch of _kill() must not run pkill unconditionally --
# only inside an `[ "$MODE" = "aggressive" ]`-guarded branch.
KILL_FN=$(awk '/^_kill\(\) \{/,/^\}/' "$CLEANUP_SH")
if echo "$KILL_FN" | grep -qE '^\s*pkill' && ! echo "$KILL_FN" | grep -q 'aggressive'; then
    bad "_kill() runs pkill without gating on --aggressive"
else
    ok "_kill() gates its pkill on --aggressive"
fi
if echo "$KILL_FN" | grep -qE 'pgrep[^|]*-u\b' && echo "$KILL_FN" | grep -qE 'pkill[^|]*-u\b'; then
    ok "_kill() scopes both pgrep and pkill to -u (this user's own processes)"
else
    bad "_kill() does not scope pgrep/pkill to -u"
fi

# The port-57374 sweep must not kill unconditionally either.
PORT_BLOCK=$(awk '/^for port in/{f=1} f{print} f&&/^done/{exit}' "$CLEANUP_SH")
if echo "$PORT_BLOCK" | grep -qE '^\s*kill' && ! echo "$PORT_BLOCK" | grep -q 'aggressive'; then
    bad "port sweep kills without gating on --aggressive"
else
    ok "port sweep gates its kill on --aggressive"
fi
if echo "$PORT_BLOCK" | grep -q 'ps -o uid='; then
    ok "port sweep verifies uid before killing a port holder"
else
    bad "port sweep does not verify uid before killing a port holder"
fi
if echo "$PORT_BLOCK" | grep -qE 'lsof -ti:"\$port" -sTCP:LISTEN'; then
    ok "port sweep filters lsof to -sTCP:LISTEN (round 3 hardening)"
else
    bad "port sweep lsof call does not filter to -sTCP:LISTEN"
fi

# --- T2: behavioral -- a decoy matching a known-name substring survives -----
# a default-mode (non-aggressive) run.
TOKEN="cleanuptest-$$-${RANDOM}-$(date +%s 2>/dev/null || echo 0)"
PERL="$(command -v perl || true)"
if [ -z "$PERL" ]; then
    echo "SKIPPED: no perl (T1 static checks above still count)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-cleanuptest-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
DECOY_PIDFILE="$WORK/decoy.pid"
perl -e '
    open(my $f, ">", $ARGV[0]) or die $!;
    print $f $$;
    close $f;
    $0 = $ARGV[1];
    sleep 30;
' "$DECOY_PIDFILE" "loki-run-$TOKEN.sh" >/dev/null 2>&1 &
i=0
while [ $i -lt 30 ]; do [ -s "$DECOY_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
DECOY_PID=$(cat "$DECOY_PIDFILE" 2>/dev/null || true)

if [ -z "$DECOY_PID" ] || ! kill -0 "$DECOY_PID" 2>/dev/null; then
    bad "decoy did not start (test setup broken, not the script under test)"
elif ! pgrep -f "loki-run-$TOKEN" 2>/dev/null | grep -qx "$DECOY_PID"; then
    bad "positive control failed: pgrep cannot even enumerate the decoy on this platform -- a later 'survived' result would be vacuous"
else
    # Never execute the whole script: it also removes /tmp/loki-* and
    # $TMPDIR/loki-* wildcard globs (unrelated to the kill logic under test),
    # which would delete other sessions' run-owned temp directories and
    # violates this project's own cleanup discipline. Extract ONLY _kill()
    # plus its three known-name calls via awk and run that fragment in
    # isolation with MODE=normal, exactly the code path under test.
    ISOLATED_FN="$WORK/isolated_kill.sh"
    {
        echo 'MODE="normal"'
        echo 'MY_UID="$(id -u)"'
        awk '/^_kill\(\) \{/,/^\}/' "$CLEANUP_SH"
        echo '_kill "mutation-probe" "mutation-probe"'
        echo '_kill "loki-run-" "loki-run-*"'
        echo '_kill "loadgen" "loadgen"'
    } > "$ISOLATED_FN"
    bash "$ISOLATED_FN" >/dev/null 2>&1
    sleep 0.3
    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "a loki-run-* decoy survived the isolated _kill() logic in default mode (no --aggressive)"
    else
        bad "a loki-run-* decoy was KILLED by the isolated _kill() logic -- the bug is still present"
    fi
fi

kill -9 "$DECOY_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
