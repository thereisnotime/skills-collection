#!/usr/bin/env bash
# Regression test: BACKLOG 22 -- the resource monitor's `sleep
# $RESOURCE_CHECK_INTERVAL` (300s default) survived a normal or interrupted
# `loki start` exit as an orphan.
#
# THE BUG. start_resource_monitor() (autonomy/run.sh) backgrounds a subshell:
#   ( while true; do sleep "$RESOURCE_CHECK_INTERVAL"; check_system_resources; done ) &
# stop_resource_monitor() / kill_registered_pid() correctly send TERM to
# $RESOURCE_MONITOR_PID (the SUBSHELL's own pid) and never kill by name or
# pattern. But a caught trap does not carry into a subshell's FOREGROUND
# child: the bare `sleep 300` has no trap of its own, so TERM to the subshell
# kills only the subshell, and the running `sleep` is orphaned (reparented to
# init) and lives up to RESOURCE_CHECK_INTERVAL seconds after `loki start`
# has already exited.
#
# THE FIX. The sleep is backgrounded and its own PID is recorded inside the
# subshell; a TERM trap on the subshell kills exactly that recorded PID, then
# exits. `wait` on a specific PID returns immediately once a trap fires (no
# 300s stall), and only a PID this run itself recorded is ever signaled --
# never a name or pattern match (see docs/v10/DECISIONS.md D14/D15).
#
# This test never uses pkill -f or `ps | grep` to find or kill anything. It
# discovers the sleep's PID the same way the fix does: pgrep -P of the exact
# monitor PID this test itself spawned, and kills nothing but recorded PIDs.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

[ -f "$RUN_SH" ] || { echo "FAIL: $RUN_SH missing"; exit 1; }

WORK="$(mktemp -d)"
cleanup_work() { rm -rf "$WORK"; }
trap cleanup_work EXIT

# --- Extract start_resource_monitor() and stop_resource_monitor() verbatim,
# and source them in isolation (same technique as
# tests/test-kill-provider-child-scoping.sh) rather than sourcing all of
# run.sh, which has heavy top-level side effects.
START_BODY="$(awk '/^start_resource_monitor\(\) \{/,/^\}/' "$RUN_SH")"
STOP_BODY="$(awk '/^stop_resource_monitor\(\) \{/,/^\}/' "$RUN_SH")"
[ -n "$START_BODY" ] || { echo "FAIL: could not extract start_resource_monitor() from run.sh"; exit 1; }
[ -n "$STOP_BODY" ] || { echo "FAIL: could not extract stop_resource_monitor() from run.sh"; exit 1; }

# T1: static check -- the sleep inside the monitor loop must be backgrounded
# with its own recorded PID, never a bare foreground `sleep`, so a TERM to
# the subshell can reach it directly instead of orphaning it.
if echo "$START_BODY" | grep -qE 'sleep "\$RESOURCE_CHECK_INTERVAL"[[:space:]]*&'; then
    ok "start_resource_monitor backgrounds its sleep so a subshell TERM can reach it"
else
    bad "start_resource_monitor still runs sleep in the foreground (orphans on TERM)"
fi
if echo "$START_BODY" | grep -q "trap .*TERM"; then
    ok "start_resource_monitor's subshell installs its own TERM trap"
else
    bad "start_resource_monitor's subshell has no TERM trap of its own"
fi

FN_FILE="$WORK/monitor_fns.sh"
{
    printf '%s\n' "$START_BODY"
    printf '%s\n' "$STOP_BODY"
} > "$FN_FILE"

# Minimal stand-ins for what start_resource_monitor() calls, so it runs in
# isolation without pulling in the rest of run.sh.
RESOURCE_CHECK_INTERVAL=300
loki_background_services_enabled() { return 0; }
check_system_resources() { :; }
log_step() { :; }
log_info() { :; }
register_pid() { :; }
unregister_pid() { :; }
CYAN=""; NC=""
RESOURCE_MONITOR_PID=""
RESOURCE_CPU_THRESHOLD=80
RESOURCE_MEM_THRESHOLD=80

# shellcheck disable=SC1090
source "$FN_FILE"

# --- T2: live behavior -----------------------------------------------------
start_resource_monitor
MON_PID="$RESOURCE_MONITOR_PID"

if [ -z "$MON_PID" ] || ! kill -0 "$MON_PID" 2>/dev/null; then
    bad "resource monitor did not start (test setup broken, not the fix under test)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    exit 1
fi

# Discover the sleep's PID by asking for children of the exact PID this test
# spawned -- never a name or pattern match against the process table.
SLEEP_PID=""
i=0
while [ $i -lt 30 ]; do
    SLEEP_PID="$(pgrep -P "$MON_PID" 2>/dev/null | head -1)"
    [ -n "$SLEEP_PID" ] && break
    sleep 0.1
    i=$((i + 1))
done

if [ -z "$SLEEP_PID" ] || ! kill -0 "$SLEEP_PID" 2>/dev/null; then
    bad "monitor's sleep child never appeared (test setup broken, not the fix under test)"
    kill -9 "$MON_PID" 2>/dev/null || true
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    exit 1
fi

SLEEP_COMM="$(ps -o comm= -p "$SLEEP_PID" 2>/dev/null | tr -d ' ')"
case "$SLEEP_COMM" in
    *sleep*) ok "found the monitor's own sleep child (pid=$SLEEP_PID, comm=$SLEEP_COMM)" ;;
    *) bad "child of the monitor pid is not a sleep (comm=$SLEEP_COMM) -- setup is wrong" ;;
esac

# RED/GREEN: interrupt the parent the way a real `loki start` exit does --
# stop_resource_monitor() sends TERM to the recorded monitor PID (exactly
# what stop_status_monitor / cleanup() / kill_registered_pid all do on every
# real exit path).
stop_resource_monitor

# Give the trap a moment; this is generous only for scheduler jitter, never
# because the fix needs to wait out the sleep itself (that would defeat the
# point: the whole fix is that shutdown does not wait 300s).
i=0
while [ $i -lt 20 ] && kill -0 "$SLEEP_PID" 2>/dev/null; do
    sleep 0.1
    i=$((i + 1))
done

if kill -0 "$MON_PID" 2>/dev/null; then
    bad "monitor subshell (pid=$MON_PID) survived stop_resource_monitor"
else
    ok "monitor subshell (pid=$MON_PID) was reaped by its recorded PID"
fi

if kill -0 "$SLEEP_PID" 2>/dev/null; then
    bad "orphaned sleep (pid=$SLEEP_PID) survived the parent's exit -- BACKLOG 22 reproduced"
else
    ok "sleep child (pid=$SLEEP_PID) was reaped along with its parent, no orphan left behind"
fi

# Cleanup: only the exact recorded PIDs from this run, never a pattern.
kill -9 "$MON_PID" 2>/dev/null || true
kill -9 "$SLEEP_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
