#!/usr/bin/env bash
# tests/test-dynamic-concurrency.sh -- Dynamic resource-aware session concurrency
# (Release 3, slice 3). Exercises the REAL effective_session_cap() from
# autonomy/run.sh.
#
# Strategy: source run.sh (its main() and self-copy block are both guarded by
# [[ "${BASH_SOURCE[0]}" == "${0}" ]], so sourcing runs neither), stub the log_*
# helpers afterwards, then call effective_session_cap() directly. The function
# reads the RELATIVE path .loki/state/resources.json, so each case cd's into a
# throwaway workdir and writes a fake resources.json there. Env knobs are
# toggled per-case via export/unset because the function reads env at call time.
#
# IMPORTANT: do NOT set LOKI_RUNNING_FROM_TEMP=1. run.sh installs an EXIT trap
# `rm -f "${BASH_SOURCE[0]}"` when that var is 1; at this test's EXIT,
# BASH_SOURCE[0] resolves to THIS test file and the trap would delete it.
#
# Skips gracefully (exit 0) when python3 is unavailable (the function uses it to
# parse resources.json; absent it the cap stays at the ceiling, which is its own
# best-effort guarantee but would not exercise the scaling paths).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed. (Not a fail.)"; exit 0
fi
if [ ! -f "$RUN_SH" ]; then
    echo "SKIP: autonomy/run.sh not found. (Not a fail.)"; exit 0
fi

WORK="$(mktemp -d /tmp/loki-test-dynconc-XXXXXX)"
trap 'cd / 2>/dev/null; rm -rf "$WORK"' EXIT

# Source the runner. The self-copy block and its EXIT trap are gated on
# BASH_SOURCE==$0 / LOKI_RUNNING_FROM_TEMP and stay inert when sourced.
# shellcheck disable=SC1090
. "$RUN_SH"

# Quiet the log_* helpers run.sh defined during the source.
log_info()   { :; }
log_warn()   { :; }
log_error()  { :; }
log_step()   { :; }
log_header() { :; }

# Pin the base caps so the assertions are deterministic regardless of any
# ambient LOKI_* env from the caller.
MAX_PARALLEL_SESSIONS=3

# Build a fresh workdir with a fake .loki/state/resources.json and cd into it.
# Args: cpu_usage mem_usage overall_status
make_resources() {
    local cpu="$1" mem="$2" status="$3"
    local dir="$WORK/case-$RANDOM$RANDOM"
    mkdir -p "$dir/.loki/state"
    cat > "$dir/.loki/state/resources.json" <<EOF
{
  "cpu": { "usage_percent": $cpu },
  "memory": { "usage_percent": $mem },
  "overall_status": "$status"
}
EOF
    cd "$dir" || return 1
}

# Workdir with NO resources.json.
make_empty_workdir() {
    local dir="$WORK/empty-$RANDOM$RANDOM"
    mkdir -p "$dir/.loki/state"
    cd "$dir" || return 1
}

# Workdir with a garbage (non-JSON) resources.json.
make_garbage_resources() {
    local dir="$WORK/garbage-$RANDOM$RANDOM"
    mkdir -p "$dir/.loki/state"
    printf 'not json at all {{{' > "$dir/.loki/state/resources.json"
    cd "$dir" || return 1
}

# -------------------------------------------------------------------
# Test 1: Default-off. LOKI_DYNAMIC_CONCURRENCY unset -> MAX_PARALLEL_SESSIONS,
# even under critical resource pressure. This is the byte-identical-to-today path.
# -------------------------------------------------------------------
test_default_off() {
    unset LOKI_DYNAMIC_CONCURRENCY 2>/dev/null || true
    DYNAMIC_CONCURRENCY=0
    make_resources 99 99 critical || { bad "Test 1 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "3" ]; then
        ok "Test 1: default-off returns MAX_PARALLEL_SESSIONS (3) despite 99% usage"
    else
        bad "Test 1: default-off" "expected 3, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 2: Enabled, low usage -> full cap (ceiling defaults to MAX_PARALLEL_SESSIONS).
# -------------------------------------------------------------------
test_enabled_low_usage() {
    DYNAMIC_CONCURRENCY=1
    unset MAX_PARALLEL_SESSIONS_CEILING 2>/dev/null || true
    MAX_PARALLEL_SESSIONS_CEILING=3
    make_resources 10 10 ok || { bad "Test 2 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "3" ]; then
        ok "Test 2: enabled + low usage returns full cap (3)"
    else
        bad "Test 2: enabled low usage" "expected 3, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 3: Enabled, critical CPU (>95) -> caps at 1.
# -------------------------------------------------------------------
test_critical_cpu_caps_at_one() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=5
    make_resources 97 10 ok || { bad "Test 3 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "1" ]; then
        ok "Test 3: critical CPU (97%) caps at 1"
    else
        bad "Test 3: critical CPU" "expected 1, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 4: Enabled, mid CPU (>85, <95) -> scaled down but >= 1 (halved floor).
# Ceiling 5 -> 5/2 = 2.
# -------------------------------------------------------------------
test_mid_cpu_scales_down() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=5
    make_resources 88 10 ok || { bad "Test 4 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "2" ]; then
        ok "Test 4: mid CPU (88%) halves ceiling 5 -> 2"
    else
        bad "Test 4: mid CPU" "expected 2, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 5: Enabled, overall_status != ok with low usage -> scaled down (halved).
# -------------------------------------------------------------------
test_status_not_ok_scales_down() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=4
    make_resources 10 10 warning || { bad "Test 5 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "2" ]; then
        ok "Test 5: overall_status=warning halves ceiling 4 -> 2"
    else
        bad "Test 5: status not ok" "expected 2, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 6: Float usage_percent (e.g. 96.7) must not crash and must cap at 1.
# -------------------------------------------------------------------
test_float_usage() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=5
    make_resources 96.7 10.2 ok || { bad "Test 6 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "1" ]; then
        ok "Test 6: float usage 96.7 caps at 1 (no integer-expression crash)"
    else
        bad "Test 6: float usage" "expected 1, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 7: Mid MEMORY (>85) with low CPU -> scaled down (memory drives it).
# -------------------------------------------------------------------
test_mid_mem_scales_down() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=5
    make_resources 10 90 ok || { bad "Test 7 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "2" ]; then
        ok "Test 7: mid MEM (90%) halves ceiling 5 -> 2"
    else
        bad "Test 7: mid MEM" "expected 2, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 8: Missing resources.json (enabled) -> ceiling unchanged, no crash.
# -------------------------------------------------------------------
test_missing_resources() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=4
    make_empty_workdir || { bad "Test 8 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "4" ]; then
        ok "Test 8: missing resources.json returns ceiling (4) unchanged"
    else
        bad "Test 8: missing resources.json" "expected 4, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 9: Garbage resources.json (enabled) -> ceiling unchanged, no crash.
# -------------------------------------------------------------------
test_garbage_resources() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=4
    make_garbage_resources || { bad "Test 9 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "4" ]; then
        ok "Test 9: garbage resources.json returns ceiling (4) unchanged"
    else
        bad "Test 9: garbage resources.json" "expected 4, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 10: Never exceeds ceiling. Low usage with ceiling 2 stays 2 (not bumped).
# -------------------------------------------------------------------
test_never_exceeds_ceiling() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=2
    make_resources 5 5 ok || { bad "Test 10 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "2" ]; then
        ok "Test 10: result never exceeds ceiling (2)"
    else
        bad "Test 10: never exceeds ceiling" "expected 2, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 11: Never drops below 1. Ceiling 1 + critical pressure -> still 1.
# -------------------------------------------------------------------
test_never_below_one() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=1
    make_resources 99 99 critical || { bad "Test 11 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    if [ "$got" = "1" ]; then
        ok "Test 11: ceiling 1 + critical pressure stays at 1 (never below 1)"
    else
        bad "Test 11: never below one" "expected 1, got '$got'"
    fi
}

# -------------------------------------------------------------------
# Test 12: Custom thresholds via env. CPU 70 with CPU threshold 60 -> halved.
# -------------------------------------------------------------------
test_custom_threshold() {
    DYNAMIC_CONCURRENCY=1
    MAX_PARALLEL_SESSIONS_CEILING=4
    CONCURRENCY_CPU_THRESHOLD=60
    make_resources 70 10 ok || { bad "Test 12 setup" "cd failed"; return; }
    local got
    got=$(effective_session_cap)
    CONCURRENCY_CPU_THRESHOLD=85  # restore default for later cases
    if [ "$got" = "2" ]; then
        ok "Test 12: custom CPU threshold 60 with 70% usage halves 4 -> 2"
    else
        bad "Test 12: custom threshold" "expected 2, got '$got'"
    fi
}

echo "== Dynamic resource-aware session concurrency (effective_session_cap) =="
test_default_off
test_enabled_low_usage
test_critical_cpu_caps_at_one
test_mid_cpu_scales_down
test_status_not_ok_scales_down
test_float_usage
test_mid_mem_scales_down
test_missing_resources
test_garbage_resources
test_never_exceeds_ceiling
test_never_below_one
test_custom_threshold

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
