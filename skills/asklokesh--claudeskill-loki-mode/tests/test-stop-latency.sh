#!/usr/bin/env bash
# `loki stop` must be bounded at about 1 second REGARDLESS of what the run was
# doing when it was issued.
#
# WHY THIS EXISTS. docs/stop-latency.md publishes "about 1 second to SIGKILL"
# and labels it MEASURED. A number labelled MEASURED with no test behind it is
# the exact defect class v9.28.0 was released to fix: asserting what was never
# checked. This suite is what makes that label true.
#
# The property under test is TIMEOUT-INDEPENDENCE, not merely "the process is
# gone". A victim that HANDLES SIGTERM and keeps running is what separates a
# real bound from an accidental one: if the escalation to SIGKILL were dropped,
# a cooperative kill would still pass while the published bound became false.
# So the victim installs a SIGTERM trap and would otherwise sleep for hours.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(mktemp -d)"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-stop-latency"

VICTIM_PGID=""
# EVERY victim ever started, not just the current one. The suite starts two, and
# a single VICTIM_PGID holds only the most recent: an abort between them leaked
# the first, which then sat for the full 7200s its sleep asked for. Observed --
# an orphan from an interrupted run was still alive well after that run ended.
ALL_VICTIM_PGIDS=""
cleanup() {
    local g
    for g in $ALL_VICTIM_PGIDS; do
        kill -KILL -- -"$g" 2>/dev/null || true
    done
    rm -rf "$WORK"
}
trap cleanup EXIT

# The victim: its own session leader (so it owns a distinct process group),
# ignores SIGTERM, and would sleep far past any plausible test timeout.
cat > "$WORK/victim.sh" <<'VICTIM'
trap '' TERM
touch "$1/victim.ready"
sleep 7200
VICTIM

# A real run writes BOTH loki.pid and loki.pgid; cmd_stop gates its whole
# reaping block on is_session_running(), which reads the PID file. A fixture
# with only a pgid file makes loki stop a no-op and would have this suite
# "measure" a bound it never exercised.
start_victim() {
    local dir="$1"
    mkdir -p "$dir"
    # setsid where available; otherwise a bash -m job gets its own group.
    if command -v setsid >/dev/null 2>&1; then
        setsid bash "$WORK/victim.sh" "$dir" >/dev/null 2>&1 &
    else
        set -m
        bash "$WORK/victim.sh" "$dir" >/dev/null 2>&1 &
        set +m
    fi
    local vpid=$!
    local waited=0
    while [ ! -f "$dir/victim.ready" ] && [ "$waited" -lt 50 ]; do
        sleep 0.1
        waited=$((waited + 1))
    done
    [ -f "$dir/victim.ready" ] || { echo "victim never started"; return 1; }
    printf '%s\n' "$vpid" > "$dir/loki.pid"
    ps -o pgid= -p "$vpid" 2>/dev/null | tr -d ' '
}

# `loki stop` reaps by TWO independent routes: _kill_pid on the recorded pid
# (which has its own kill -9 escalation) and _stop_group_by_pgid_files on the
# process group. Either alone kills the victim, so an end-to-end `loki stop`
# CANNOT attribute the bound to the group path -- verified by mutation: deleting
# the group SIGKILL left the end-to-end test green. Case 1 therefore drives
# _stop_group_by_pgid_files DIRECTLY, and case 2 times the whole command.

# 1. The GROUP path alone kills a SIGTERM-ignoring victim. This is the claim
#    docs/stop-latency.md actually makes ("signals the run\'s whole process
#    group ... SIGTERM, a 1 second grace, then SIGKILL").
LD="$WORK/bounded"
mkdir -p "$LD"
VICTIM_PGID="$(start_victim "$LD")" || VICTIM_PGID=""
ALL_VICTIM_PGIDS="$ALL_VICTIM_PGIDS $VICTIM_PGID"
if [ -z "$VICTIM_PGID" ] || [ "$VICTIM_PGID" = "$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')" ]; then
    # Refusing to run rather than asserting against our own group, which
    # _stop_group_by_pgid_files deliberately skips. A skip is reported, never
    # silently counted as a pass.
    echo "  SKIP: could not start a victim in its own process group"
else
    printf '%s\n' "$VICTIM_PGID" > "$LD/loki.pgid"

    # Drive the group reaper ALONE: extract the function and remove the pid
    # file, so _kill_pid cannot be the thing that does the killing.
    rm -f "$LD/loki.pid"
    t0=$(date +%s)
    bash -c '
        set -uo pipefail
        LOKI_DIR="$1"
        eval "$(awk "/^_stop_group_by_pgid_files\\(\\)/,/^}/" "$2")"
        _stop_group_by_pgid_files "$LOKI_DIR/loki.pgid"
    ' _ "$LD" "$REPO_ROOT/autonomy/loki" >/dev/null 2>&1 || true
    t1=$(date +%s)
    group_elapsed=$((t1 - t0))

    # Reap window sits OUTSIDE the timing measurement so it cannot inflate it.
    sleep 0.5
    if kill -0 -- -"$VICTIM_PGID" 2>/dev/null; then
        fail "the group path did NOT kill a SIGTERM-ignoring victim (SIGKILL escalation broken)"
    else
        pass "the group path alone kills a SIGTERM-ignoring victim"
        VICTIM_PGID=""
    fi

    if [ "$group_elapsed" -le 5 ]; then
        pass "the group path returned in ${group_elapsed}s, on the published seconds scale"
    else
        fail "the group path took ${group_elapsed}s; docs publishes ~1s to SIGKILL"
    fi
fi

# 2. The WHOLE command is bounded on the seconds scale against a victim that
#    asked to sleep 7200s. This is the number a user experiences; it does not
#    attribute which of the two reaping routes did the work.
LD2="$WORK/endtoend"
mkdir -p "$LD2"
VICTIM_PGID="$(start_victim "$LD2")" || VICTIM_PGID=""
ALL_VICTIM_PGIDS="$ALL_VICTIM_PGIDS $VICTIM_PGID"
if [ -z "$VICTIM_PGID" ] || [ "$VICTIM_PGID" = "$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')" ]; then
    echo "  SKIP: could not start a second victim in its own process group"
else
    printf '%s\n' "$VICTIM_PGID" > "$LD2/loki.pgid"
    t0=$(date +%s)
    LOKI_DIR="$LD2" bash "$REPO_ROOT/autonomy/loki" stop >/dev/null 2>&1 || true
    t1=$(date +%s)
    elapsed=$((t1 - t0))

    sleep 0.5
    if kill -0 -- -"$VICTIM_PGID" 2>/dev/null; then
        fail "loki stop left a SIGTERM-ignoring victim running"
    else
        pass "loki stop end to end kills a SIGTERM-ignoring victim"
        VICTIM_PGID=""
    fi

    # 5s, not 1s: the published number is the SIGTERM/SIGKILL grace, and this
    # measures a whole `loki stop` invocation including bash startup on a shared
    # CI runner. The assertion that matters is SECONDS, not the 7200 the victim
    # asked to sleep for -- a regression removing the bound hangs here.
    if [ "$elapsed" -le 5 ]; then
        pass "loki stop returned in ${elapsed}s, within the published seconds-scale bound"
    else
        fail "loki stop took ${elapsed}s; docs/stop-latency.md publishes ~1s to SIGKILL"
    fi
fi

# 3. The bound does NOT depend on the victim being cooperative -- assert the
#    escalation exists in source, so a refactor that drops SIGKILL fails here
#    even on a host where the process test had to skip.
if grep -q 'kill -KILL -- -"\$_spgid"' autonomy/loki; then
    pass "group SIGKILL escalation is present in _stop_group_by_pgid_files"
else
    fail "no group SIGKILL escalation found; the ~1s bound cannot hold"
fi

# 4. The doc must not re-acquire a MEASURED label for a number this suite does
#    not actually cover. The STOP-file worst case is DERIVED from a timeout
#    default and is explicitly not sat through.
if grep -q 'seconds plus iteration teardown. DERIVED' docs/stop-latency.md; then
    pass "the STOP-file worst case is published as DERIVED, not MEASURED"
else
    fail "docs/stop-latency.md no longer labels the STOP-file bound DERIVED"
fi

# 5. And the number this suite DOES cover must still be the one published.
if grep -q 'about 1 second to SIGKILL. MEASURED' docs/stop-latency.md; then
    pass "the loki stop bound is published as MEASURED, matching this suite"
else
    fail "docs/stop-latency.md changed the loki stop claim; update this suite with it"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
