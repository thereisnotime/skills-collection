#!/usr/bin/env bash
# shellcheck disable=SC2034  # Variables may be unused in test context
# shellcheck disable=SC2155  # Declare and assign separately
# Test: Orphan wrapper reaper (loki-mode #92)
#
# The loki-run wrapper registers its CHILDREN in .loki/pids but never itself,
# so when the launching session dies the wrapper is never reaped. This tests the
# fix: the wrapper self-registers with the LAUNCHER's mortal pid (not its own
# $$, which would make the reaper INERT) and cleanup_orphan_pids reaps a
# registered WRAPPER only when it is orphaned (parent dead) AND idle past budget
# AND has no live engine child -- a LIVENESS predicate, not parentage.
#
# CRITICAL: this test sources the REAL run.sh function block (sed-extracted),
# NOT hand-copies. That way the composed behavioral checks gate run.sh directly
# and RED-first falls out for free on unmodified main.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$PROJECT_DIR/autonomy/run.sh"
TEST_DIR=$(mktemp -d)
PASSED=0
FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASSED=$((PASSED+1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED+1)); }
log_test() { echo -e "${YELLOW}[TEST]${NC} $1"; }

cleanup() {
    for pid_file in "$TEST_DIR/.loki/pids"/*.json; do
        [ -f "$pid_file" ] || continue
        local pid
        pid=$(basename "$pid_file" .json)
        case "$pid" in ''|*[!0-9]*) continue ;; esac
        kill "$pid" 2>/dev/null || true
        kill -9 "$pid" 2>/dev/null || true
    done
    # COMPOSED-3 spawns a node child that reparents to init; reap it explicitly
    # by its unique marker (fixed-string, survives reparent).
    pkill -9 -f 'loki92_composed3_marker' 2>/dev/null || true
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DIR/.loki"
cd "$TEST_DIR" || exit 1

# run.sh expects these:
TARGET_DIR="$TEST_DIR"
export LOKI_DEBUG=""
log_info()  { echo "[INFO] $*"; }
log_warn()  { echo "[WARN] $*"; }
log_error() { echo "[ERROR] $*"; }
log_step()  { echo "[STEP] $*"; }

echo "=========================================="
echo "Orphan Wrapper Reaper Tests (loki-mode #92)"
echo "=========================================="
echo ""

#===============================================================================
# Source the REAL PID-registry function block from run.sh (no hand-copies).
# Block is delimited by the "Process Registry" section header and the end of
# kill_all_registered(). We extract from the PID_REGISTRY_DIR="" line to the
# line before the next section header ("# Event Emission").
#===============================================================================
EXTRACT="$TEST_DIR/_extracted_registry.sh"
# Extract from PID_REGISTRY_DIR="" to the closing brace of kill_all_registered().
awk '
    /^PID_REGISTRY_DIR=""$/ {grab=1}
    grab {print; if ($0 ~ /^kill_all_registered\(\)/) inkar=1}
    grab && inkar && /^}$/ {exit}
' "$RUN_SH" > "$EXTRACT"

if ! grep -q "^cleanup_orphan_pids()" "$EXTRACT"; then
    echo "FATAL: could not extract cleanup_orphan_pids from run.sh"
    exit 1
fi
# shellcheck disable=SC1090
source "$EXTRACT"
init_pid_registry

# Helper: a genuinely-dead pid, guaranteed NOT alive and (optionally) not equal to
# a pid we must keep distinct (e.g. the wrapper under test). Loops to defend against
# PID reuse recycling the number back to a live process before we record it.
dead_pid() {
    local avoid="${1:-}" p tries=0
    while [ "$tries" -lt 50 ]; do
        ( : ) &
        p=$!
        wait "$p" 2>/dev/null || true
        if ! kill -0 "$p" 2>/dev/null && [ "$p" != "$avoid" ]; then
            echo "$p"; return 0
        fi
        tries=$((tries+1))
    done
    echo "$p"
}

now_ms() { echo "$(( $(date +%s) * 1000 ))"; }

#===============================================================================
# RED Test A: pure predicate exists + truth table + $$-trap regression guard
#===============================================================================
log_test "A1: shouldReapOrphan pure predicate truth table"
if ! type shouldReapOrphan >/dev/null 2>&1; then
    log_fail "shouldReapOrphan does not exist (pure predicate not extracted)"
else
    A_OK=1
    # (parent_alive, last_activity_ms, now_ms, idle_budget_ms, has_live_child)
    [ "$(shouldReapOrphan 0 0 1000000 900000 0)" = "1" ] || { A_OK=0; echo "  expected reap for orphaned+idle+no-child"; }
    [ "$(shouldReapOrphan 1 0 1000000 900000 0)" = "0" ] || { A_OK=0; echo "  expected spare for parent alive"; }
    [ "$(shouldReapOrphan 0 999999000 1000000 900000 0)" = "0" ] || { A_OK=0; echo "  expected spare for recent activity"; }
    [ "$(shouldReapOrphan 0 0 1000000 900000 1)" = "0" ] || { A_OK=0; echo "  expected spare for live engine child"; }
    if [ "$A_OK" = "1" ]; then
        log_pass "shouldReapOrphan truth table correct"
    else
        log_fail "shouldReapOrphan truth table wrong"
    fi
fi

log_test "A2: register_self_wrapper records LAUNCHER ppid, not \$\$ (inert-reaper trap)"
if ! type register_self_wrapper >/dev/null 2>&1; then
    log_fail "register_self_wrapper does not exist (self-register helper missing)"
else
    LAUNCHER=$(dead_pid)
    ( export LOKI_LAUNCHER_PID="$LAUNCHER"; register_self_wrapper )
    # register_self_wrapper writes .loki/pids/$$.json for the CALLER pid. Since we
    # ran it in a subshell, the caller pid was the subshell. Instead, invoke it in
    # THIS shell so we can read back $$.json deterministically.
    LOKI_LAUNCHER_PID="$LAUNCHER" register_self_wrapper
    ENTRY="$PID_REGISTRY_DIR/$$.json"
    if [ ! -f "$ENTRY" ]; then
        log_fail "register_self_wrapper did not write $$.json"
    else
        GOT_PPID=$(_parse_json_field "$ENTRY" "ppid")
        GOT_KIND=$(_parse_json_field "$ENTRY" "kind")
        if [ "$GOT_PPID" = "$LAUNCHER" ] && [ "$GOT_PPID" != "$$" ] && [ "$GOT_KIND" = "wrapper" ]; then
            log_pass "self-registered ppid=$GOT_PPID (launcher, != self $$), kind=wrapper"
        else
            log_fail "expected ppid=$LAUNCHER (!=$$) kind=wrapper, got ppid=$GOT_PPID kind=$GOT_KIND"
        fi
        rm -f "$ENTRY"
    fi
fi

#===============================================================================
# RED Test B (load-bearing SPARED case): freshly-active detached wrapper
# must NOT be killed. On main (no liveness gate) it IS killed -> RED.
#===============================================================================
log_test "B: freshly-active orphaned wrapper is SPARED (WRONG-FIX prohibition)"
sleep 300 >/dev/null 2>&1 &
WRAPPER_B=$!
DEADP=$(dead_pid "$WRAPPER_B")
cat > "$PID_REGISTRY_DIR/$WRAPPER_B.json" << EOF
{"pid":$WRAPPER_B,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"kind":"wrapper","extra":""}
EOF
# Fresh activity: events.jsonl mtime = now. Budget is generously larger than the
# 1s stat granularity so the spare decision is on ACTIVITY, not a boundary race.
: > "$TEST_DIR/.loki/events.jsonl"
LOKI_WRAPPER_IDLE_BUDGET_MS=3600000 cleanup_orphan_pids > /dev/null 2>&1
if kill -0 "$WRAPPER_B" 2>/dev/null; then
    log_pass "freshly-active detached wrapper spared"
else
    log_fail "freshly-active detached wrapper was KILLED (parentage-only reap = wrong fix)"
fi
kill -9 "$WRAPPER_B" 2>/dev/null || true
rm -f "$PID_REGISTRY_DIR/$WRAPPER_B.json"

#===============================================================================
# COMPOSED-1: real orphan (dead parent, idle past budget, sleep-only child) REAPED
#===============================================================================
log_test "COMPOSED-1: idle orphaned wrapper (sleep-only) is REAPED"
sleep 300 >/dev/null 2>&1 &
ORPHAN1=$!
DEADP=$(dead_pid "$ORPHAN1")
cat > "$PID_REGISTRY_DIR/$ORPHAN1.json" << EOF
{"pid":$ORPHAN1,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"kind":"wrapper","extra":""}
EOF
# No .loki activity written (or backdated). Force idle by tiny budget + no events file.
rm -f "$TEST_DIR/.loki/events.jsonl"
rm -rf "$TEST_DIR/.loki/signals"
rm -f "$TEST_DIR/.loki/autonomy-state.json"
COUNT1=$(LOKI_WRAPPER_IDLE_BUDGET_MS=1000 cleanup_orphan_pids)
sleep 0.5
if ! kill -0 "$ORPHAN1" 2>/dev/null; then
    if [ ! -f "$PID_REGISTRY_DIR/$ORPHAN1.json" ] && [ "$COUNT1" = "1" ]; then
        log_pass "idle orphan reaped, entry removed, count=1"
    else
        log_fail "orphan killed but entry/count wrong (count=$COUNT1)"
    fi
else
    log_fail "idle orphaned wrapper was NOT reaped (reaper inert)"
    kill -9 "$ORPHAN1" 2>/dev/null || true
fi
rm -f "$PID_REGISTRY_DIR/$ORPHAN1.json"

#===============================================================================
# COMPOSED-2: nohup-active detached run (dead parent, FRESH .loki activity) SPARED
#===============================================================================
log_test "COMPOSED-2: nohup-active detached run (dead parent, fresh activity) SPARED"
sleep 300 >/dev/null 2>&1 &
ACTIVE2=$!
DEADP=$(dead_pid "$ACTIVE2")
cat > "$PID_REGISTRY_DIR/$ACTIVE2.json" << EOF
{"pid":$ACTIVE2,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"kind":"wrapper","extra":""}
EOF
: > "$TEST_DIR/.loki/events.jsonl"   # fresh mtime = now
# Budget >> 1s stat granularity: spare decision must be on ACTIVITY, not boundary.
COUNT2=$(LOKI_WRAPPER_IDLE_BUDGET_MS=3600000 cleanup_orphan_pids)
if kill -0 "$ACTIVE2" 2>/dev/null; then
    if [ -f "$PID_REGISTRY_DIR/$ACTIVE2.json" ] && [ "$COUNT2" = "0" ]; then
        log_pass "active detached run spared, entry kept, count=0"
    else
        log_fail "active run alive but entry/count wrong (count=$COUNT2)"
    fi
else
    log_fail "active detached run was KILLED (overnight build would die)"
fi
kill -9 "$ACTIVE2" 2>/dev/null || true
rm -f "$PID_REGISTRY_DIR/$ACTIVE2.json"

#===============================================================================
# COMPOSED-3: spared by live engine child (idle past budget, but node child alive)
#===============================================================================
log_test "COMPOSED-3: idle orphan WITH live engine (node) child is SPARED"
if command -v node >/dev/null 2>&1; then
    # The wrapper must be the PARENT of a node child (has_live_child does
    # `pgrep -P <wrapper>`). Background a subshell that spawns a node child (a
    # busy-loop with a UNIQUE marker so we can reap it by fixed-string match) and
    # waits on it. The subshell's pid is the wrapper.
    NODE_MARKER="loki92_composed3_marker"
    # Redirect fds on BOTH the inner node and the outer bash -c so neither holds
    # this script's stdout/stderr open (else a `$()`/pipe harness hangs on EOF).
    bash -c 'node -e "const m=process.argv[1]; setInterval(()=>{},1e9)" '"$NODE_MARKER"' >/dev/null 2>&1 & CH=$!; echo $$ > '"$TEST_DIR/.loki/wrap3.pid"'; wait $CH' >/dev/null 2>&1 &
    WRAP3_BG=$!
    sleep 0.6
    WRAP3=$(cat "$TEST_DIR/.loki/wrap3.pid" 2>/dev/null || echo "$WRAP3_BG")
    DEADP=$(dead_pid "$WRAP3")
    cat > "$PID_REGISTRY_DIR/$WRAP3.json" << EOF
{"pid":$WRAP3,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"kind":"wrapper","extra":""}
EOF
    # No fresh activity -> idle. But live node child must spare it.
    rm -f "$TEST_DIR/.loki/events.jsonl"
    COUNT3=$(LOKI_WRAPPER_IDLE_BUDGET_MS=1000 cleanup_orphan_pids)
    if kill -0 "$WRAP3" 2>/dev/null; then
        log_pass "idle orphan with live node child spared (has_live_child gate)"
    else
        log_fail "idle orphan with live engine child was reaped (false positive)"
    fi
    pkill -P "$WRAP3" 2>/dev/null || true
    kill -9 "$WRAP3" 2>/dev/null || true
    rm -f "$PID_REGISTRY_DIR/$WRAP3.json" "$TEST_DIR/.loki/wrap3.pid"
    # Reap the marked node child by fixed-string (survives reparent-to-init).
    pkill -9 -f "$NODE_MARKER" 2>/dev/null || true
else
    log_pass "node unavailable -- COMPOSED-3 skipped (engine-child filter untested here)"
fi

#===============================================================================
# COMPOSED-4: PRESENT-but-STALE .loki activity drives a REAP. This is the only
# case that exercises _loki_last_activity_ms actually READING a real mtime (not the
# empty-candidates=0 shortcut). If stat is broken/inert on this platform, the helper
# falls back to now_ms (spare) and this test goes RED -- catching the activity-axis
# twin of the ppid inert-reaper trap. Portable backdate (BSD -v / GNU -d).
#===============================================================================
log_test "COMPOSED-4: present-but-STALE activity (idle past budget) is REAPED"
sleep 300 >/dev/null 2>&1 &
STALE4=$!
DEADP=$(dead_pid "$STALE4")
cat > "$PID_REGISTRY_DIR/$STALE4.json" << EOF
{"pid":$STALE4,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"kind":"wrapper","extra":""}
EOF
rm -rf "$TEST_DIR/.loki/signals"
rm -f "$TEST_DIR/.loki/autonomy-state.json"
: > "$TEST_DIR/.loki/events.jsonl"
# Backdate events.jsonl 30 min into the past (well past the default 15m budget).
STALE_TS=$(date -v-30M +%Y%m%d%H%M 2>/dev/null || date -d '30 min ago' +%Y%m%d%H%M 2>/dev/null)
if [ -n "$STALE_TS" ]; then
    touch -t "$STALE_TS" "$TEST_DIR/.loki/events.jsonl"
fi
# Default 15m budget (no override): stale mtime must be read as old -> reap.
COUNT4=$(cleanup_orphan_pids)
sleep 0.5
if ! kill -0 "$STALE4" 2>/dev/null; then
    if [ ! -f "$PID_REGISTRY_DIR/$STALE4.json" ] && [ "$COUNT4" = "1" ]; then
        log_pass "stale-activity orphan reaped (activity mtime read correctly), count=1"
    else
        log_fail "reaped but entry/count wrong (count=$COUNT4)"
    fi
else
    log_fail "stale-activity orphan NOT reaped (stat read inert -> now_ms spare?)"
    kill -9 "$STALE4" 2>/dev/null || true
fi
rm -f "$PID_REGISTRY_DIR/$STALE4.json" "$TEST_DIR/.loki/events.jsonl"

#===============================================================================
# Legacy-child regression: kind-less child entries keep EXACT parent-death behavior
#===============================================================================
log_test "LEGACY-6: kind-less orphan child (dead parent) still killed"
sleep 300 >/dev/null 2>&1 &
LCHILD=$!
DEADP=$(dead_pid "$LCHILD")
cat > "$PID_REGISTRY_DIR/$LCHILD.json" << EOF
{"pid":$LCHILD,"label":"legacy-child","started":"2026-01-01T00:00:00Z","ppid":$DEADP,"extra":""}
EOF
cleanup_orphan_pids > /dev/null 2>&1
sleep 0.5
if ! kill -0 "$LCHILD" 2>/dev/null; then
    log_pass "legacy orphan child killed (unchanged behavior)"
else
    log_fail "legacy orphan child NOT killed (child behavior regressed)"
    kill -9 "$LCHILD" 2>/dev/null || true
fi
rm -f "$PID_REGISTRY_DIR/$LCHILD.json"

log_test "LEGACY-9: kind-less child with ALIVE parent (\$\$) spared"
sleep 300 >/dev/null 2>&1 &
LALIVE=$!
register_pid "$LALIVE" "legacy-alive-parent"   # ppid=$$ (alive)
cleanup_orphan_pids > /dev/null 2>&1
if kill -0 "$LALIVE" 2>/dev/null; then
    log_pass "legacy child with alive parent spared (unchanged behavior)"
else
    log_fail "legacy child with alive parent killed (regression)"
fi
kill_registered_pid "$LALIVE"

#===============================================================================
# SELF-SUICIDE guard: kill_all_registered must NOT kill the running wrapper ($$)
#===============================================================================
log_test "SELF-SKIP: kill_all_registered spares self (\$\$) but kills real children"
# Register self as wrapper + a real child.
cat > "$PID_REGISTRY_DIR/$$.json" << EOF
{"pid":$$,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":1,"kind":"wrapper","extra":""}
EOF
sleep 300 >/dev/null 2>&1 &
KCHILD=$!
register_pid "$KCHILD" "shutdown-child"
kill_all_registered
sleep 0.5
SELF_ALIVE=1; kill -0 "$$" 2>/dev/null || SELF_ALIVE=0
CHILD_DEAD=1; kill -0 "$KCHILD" 2>/dev/null && CHILD_DEAD=0
if [ "$SELF_ALIVE" = "1" ] && [ "$CHILD_DEAD" = "1" ]; then
    log_pass "kill_all_registered spared self (\$\$), killed child"
else
    log_fail "self_alive=$SELF_ALIVE child_dead=$CHILD_DEAD (wrapper suicided or child survived)"
    kill -9 "$KCHILD" 2>/dev/null || true
fi
rm -f "$PID_REGISTRY_DIR/$$.json"

#===============================================================================
# CLEANUP self-skip: cleanup_orphan_pids must never reap the running wrapper ($$)
#===============================================================================
log_test "SELF-SKIP: cleanup_orphan_pids never reaps running wrapper (\$\$)"
cat > "$PID_REGISTRY_DIR/$$.json" << EOF
{"pid":$$,"label":"loki-wrapper","started":"2026-01-01T00:00:00Z","ppid":1,"kind":"wrapper","extra":""}
EOF
rm -f "$TEST_DIR/.loki/events.jsonl"
LOKI_WRAPPER_IDLE_BUDGET_MS=1 cleanup_orphan_pids > /dev/null 2>&1
if kill -0 "$$" 2>/dev/null; then
    log_pass "running wrapper (\$\$) never reaped self"
else
    log_fail "wrapper reaped ITSELF (impossible-to-recover)"
fi
rm -f "$PID_REGISTRY_DIR/$$.json"

#===============================================================================
# STATIC guards on run.sh itself (the copied/sourced block gates run.sh, but
# these grep-based checks pin the LAUNCHER-pid propagation the source can't reach)
#===============================================================================
log_test "STATIC: all four backgrounding cases export LOKI_LAUNCHER_PID=\$\$"
BG_HITS=$(grep -c 'LOKI_LAUNCHER_PID=\$\$' "$RUN_SH")
if [ "$BG_HITS" -ge 4 ]; then
    log_pass "LOKI_LAUNCHER_PID=\$\$ present $BG_HITS times (>=4 backgrounding cases)"
else
    log_fail "LOKI_LAUNCHER_PID=\$\$ found only $BG_HITS times (need >=4)"
fi

log_test "STATIC: run.sh calls register_self_wrapper before cleanup_orphan_pids on startup"
if grep -q 'register_self_wrapper' "$RUN_SH"; then
    log_pass "register_self_wrapper wired into run.sh"
else
    log_fail "register_self_wrapper not called in run.sh"
fi

log_test "STATIC: cleanup_orphan_pids branches on kind + calls shouldReapOrphan"
if grep -q 'shouldReapOrphan' "$RUN_SH"; then
    log_pass "shouldReapOrphan wired into cleanup_orphan_pids"
else
    log_fail "shouldReapOrphan not referenced in run.sh"
fi

#===============================================================================
# Summary
#===============================================================================
echo ""
echo "=========================================="
echo "Results: $PASSED passed, $FAILED failed ($(( PASSED + FAILED )) total)"
echo "=========================================="
if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
