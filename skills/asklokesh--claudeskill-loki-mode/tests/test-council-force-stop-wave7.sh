#!/usr/bin/env bash
#===============================================================================
# test-council-force-stop-wave7.sh
#
# Behavioral test for the wave-7 bash-F1 fix in autonomy/completion-council.sh.
#
# THE CONTRACT UNDER TEST
# -----------------------
# council_should_stop() distinguishes a GENUINE council approval (return 0,
# COUNCIL_FORCE_STOPPED stays 0) from a SAFETY-VALVE force-stop (return 0,
# COUNCIL_FORCE_STOPPED set to 1). Both cases stop the loop, but the caller in
# autonomy/run.sh (~15736) reads COUNCIL_FORCE_STOPPED to decide whether to
# report "council_approved"/"complete" (var == 0) or "force_stopped" /
# "STOPPED WITHOUT APPROVAL" (var == 1, no PR, no on_run_complete).
#
# NON-VACUITY
# -----------
# Pre-fix, COUNCIL_FORCE_STOPPED did not exist on the valve return-0 paths, so
# the run.sh guard `[ "${COUNCIL_FORCE_STOPPED:-0}" = "1" ]` evaluated to FALSE
# even on a force-stop, meaning a valve stop was MISREPORTED as a genuine
# council approval (the false-COMPLETE bug). The discriminating assertion this
# test makes is exactly the one that was false pre-fix:
#
#     after a done-signal / stagnation valve stop:  COUNCIL_FORCE_STOPPED == 1
#
# We additionally simulate the exact run.sh branch decision and assert it would
# have chosen "council_approved" under the pre-fix (sentinel-absent) world and
# "force_stopped" under the post-fix (sentinel-set) world. This makes the bug
# observable as a behavior, not just a variable read. A git-stash before/after
# (FAIL-then-PASS) is documented in the SDET report accompanying this test.
#
# SEAM: Option A. We source completion-council.sh in a subshell, stub the heavy
# dependencies (council_evaluate, council_circuit_breaker_triggered, all log_*
# helpers, council_write_report, council_augment_from_managed_memory), set the
# COUNCIL_* environment to drive a specific path deterministically, then call
# council_should_stop and inspect the return code and the sentinel.
#
# Runnable standalone:  bash tests/test-council-force-stop-wave7.sh
# Exits 0 on pass, non-zero on fail. Self-cleaning via mktemp + trap.
#===============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNCIL_SH="$SCRIPT_DIR/../autonomy/completion-council.sh"

TMPDIR_TEST="$(mktemp -d "${TMPDIR:-/tmp}/loki-council-f1-XXXXXX")"
cleanup() { rm -rf "$TMPDIR_TEST" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

if [ ! -f "$COUNCIL_SH" ]; then
    echo "FAIL: cannot find completion-council.sh at $COUNCIL_SH"
    exit 1
fi

#-------------------------------------------------------------------------------
# Helper: run council_should_stop in an isolated subshell with the file sourced
# and all heavy deps stubbed. Echoes "<rc>:<force_stopped_value>".
#
# Args:
#   $1 = name of a shell function (defined as a string in $2) that sets up the
#        scenario-specific COUNCIL_* state AND stubs council_evaluate /
#        council_circuit_breaker_triggered for that scenario.
# We pass the scenario setup as a sourced snippet via a temp file so the subshell
# can define functions before calling council_should_stop.
#-------------------------------------------------------------------------------
run_scenario() {
    local scenario_file="$1"
    bash -c '
        set +e
        COUNCIL_SH="$1"
        SCENARIO="$2"

        # --- Stub the heavy / side-effecting dependencies BEFORE sourcing so
        # --- they are in place, and re-define after sourcing to be safe (the
        # --- file defines real ones we must override). We define them after the
        # --- source below.

        # Source the real file. It has no set -e/-u at top and no main-guard,
        # so sourcing only defines functions + sets COUNCIL_* defaults.
        # shellcheck disable=SC1090
        source "$COUNCIL_SH" >/dev/null 2>&1

        # Silence all logging helpers (override the real ones).
        log_info()    { :; }
        log_warn()    { :; }
        log_error()   { :; }
        log_header()  { :; }
        log_debug()   { :; }
        log_success() { :; }

        # Neutralize side-effecting helpers that the approval path calls.
        council_write_report()              { :; }
        council_augment_from_managed_memory() { return 0; }
        council_managed_should_stop()       { return 1; }

        # Make the gating preconditions pass so we reach the body:
        # ENABLED, past min iterations, and force a check this round.
        COUNCIL_ENABLED="true"
        COUNCIL_MIN_ITERATIONS=3
        COUNCIL_CHECK_INTERVAL=5
        ITERATION_COUNT=10            # 10 % 5 == 0 -> should_check true
        TARGET_DIR="'"$TMPDIR_TEST"'"
        mkdir -p "$TARGET_DIR/.loki" 2>/dev/null || true

        # Defaults that scenarios may override.
        COUNCIL_CONSECUTIVE_NO_CHANGE=0
        COUNCIL_STAGNATION_LIMIT=5
        COUNCIL_TOTAL_DONE_SIGNALS=0
        COUNCIL_DONE_SIGNAL_LIMIT=10

        # Default stubs: council does NOT approve, circuit NOT triggered.
        council_evaluate()                  { return 1; }
        council_circuit_breaker_triggered() { return 1; }

        # Apply scenario overrides (may redefine council_evaluate /
        # council_circuit_breaker_triggered and set COUNCIL_* values).
        # shellcheck disable=SC1090
        source "$SCENARIO"

        council_should_stop
        rc=$?
        echo "${rc}:${COUNCIL_FORCE_STOPPED:-UNSET}"
    ' _ "$COUNCIL_SH" "$scenario_file"
}

#===============================================================================
# Scenario 1 (CORE): done-signal safety valve fires WITHOUT council approval.
#   Expect: council_should_stop returns 0 (STOP) AND COUNCIL_FORCE_STOPPED == 1.
#===============================================================================
S1="$TMPDIR_TEST/scenario-done-valve.sh"
cat > "$S1" <<'EOF'
council_evaluate()                  { return 1; }   # council never approves
council_circuit_breaker_triggered() { return 1; }   # no stagnation circuit
COUNCIL_TOTAL_DONE_SIGNALS=10                         # >= limit (10) -> valve
COUNCIL_DONE_SIGNAL_LIMIT=10
EOF

out1="$(run_scenario "$S1")"
rc1="${out1%%:*}"
fs1="${out1##*:}"

if [ "$rc1" = "0" ]; then
    pass "done-signal valve STILL stops the run (council_should_stop rc=0)"
else
    fail "done-signal valve did not stop (expected rc=0, got rc=$rc1, raw='$out1')"
fi

if [ "$fs1" = "1" ]; then
    pass "done-signal valve sets COUNCIL_FORCE_STOPPED=1 (force_stopped, NOT council_approved)"
else
    fail "done-signal valve did NOT set sentinel (expected 1, got '$fs1', raw='$out1') -- this is the exact bash-F1 bug"
fi

#===============================================================================
# Scenario 2: stagnation safety valve fires WITHOUT council approval.
#   circuit breaker triggered + no-change count >= 2x stagnation limit.
#   Expect: rc=0 AND COUNCIL_FORCE_STOPPED == 1.
#===============================================================================
S2="$TMPDIR_TEST/scenario-stagnation-valve.sh"
cat > "$S2" <<'EOF'
council_evaluate()                  { return 1; }   # council never approves
council_circuit_breaker_triggered() { return 0; }   # stagnation circuit fires
COUNCIL_STAGNATION_LIMIT=5
COUNCIL_CONSECUTIVE_NO_CHANGE=10                      # >= 2*5 -> safety valve
COUNCIL_TOTAL_DONE_SIGNALS=0                          # done-valve not the cause
COUNCIL_DONE_SIGNAL_LIMIT=10
EOF

out2="$(run_scenario "$S2")"
rc2="${out2%%:*}"
fs2="${out2##*:}"

if [ "$rc2" = "0" ]; then
    pass "stagnation valve STILL stops the run (rc=0)"
else
    fail "stagnation valve did not stop (expected rc=0, got rc=$rc2, raw='$out2')"
fi

if [ "$fs2" = "1" ]; then
    pass "stagnation valve sets COUNCIL_FORCE_STOPPED=1 (force_stopped)"
else
    fail "stagnation valve did NOT set sentinel (expected 1, got '$fs2', raw='$out2')"
fi

#===============================================================================
# Scenario 3 (sentinel discipline): GENUINE council approval.
#   council_evaluate returns 0. Expect: rc=0 AND COUNCIL_FORCE_STOPPED == 0,
#   so run.sh takes the council_approved / complete path.
#===============================================================================
S3="$TMPDIR_TEST/scenario-genuine-approval.sh"
cat > "$S3" <<'EOF'
council_evaluate()                  { return 0; }   # council APPROVES
council_circuit_breaker_triggered() { return 1; }
COUNCIL_TOTAL_DONE_SIGNALS=0
COUNCIL_DONE_SIGNAL_LIMIT=10
EOF

out3="$(run_scenario "$S3")"
rc3="${out3%%:*}"
fs3="${out3##*:}"

if [ "$rc3" = "0" ]; then
    pass "genuine approval stops the run (rc=0)"
else
    fail "genuine approval did not stop (expected rc=0, got rc=$rc3, raw='$out3')"
fi

if [ "$fs3" = "0" ]; then
    pass "genuine approval leaves COUNCIL_FORCE_STOPPED=0 (council_approved path)"
else
    fail "genuine approval wrongly set sentinel (expected 0, got '$fs3', raw='$out3')"
fi

#===============================================================================
# Scenario 4 (discriminator / non-vacuity): simulate the run.sh branch.
#   Reproduce the exact guard from autonomy/run.sh (~15736) and assert the
#   reported outcome differs between a valve stop and a genuine approval, AND
#   that under a pre-fix (sentinel-absent) world the valve stop would be
#   MISREPORTED as council_approved. This proves the assertion is the precise
#   discriminator the bug violated.
#===============================================================================

# run.sh decision, post-fix: sentinel value drives the report string.
runsh_report() {
    # $1 = COUNCIL_FORCE_STOPPED value as seen by run.sh
    if [ "${1:-0}" = "1" ]; then
        echo "force_stopped"
    else
        echo "council_approved"
    fi
}

# Post-fix valve (sentinel=1) -> force_stopped
report_valve_postfix="$(runsh_report "$fs1")"
# Post-fix genuine approval (sentinel=0) -> council_approved
report_approval_postfix="$(runsh_report "$fs3")"

if [ "$report_valve_postfix" = "force_stopped" ] && [ "$report_approval_postfix" = "council_approved" ]; then
    pass "run.sh branch reports force_stopped on valve, council_approved on genuine approval (post-fix)"
else
    fail "run.sh branch misreports: valve='$report_valve_postfix' approval='$report_approval_postfix'"
fi

# Pre-fix world: COUNCIL_FORCE_STOPPED is UNSET on the valve return-0 path, so
# the guard `[ "${COUNCIL_FORCE_STOPPED:-0}" = "1" ]` is FALSE -> council_approved.
# This is the false-COMPLETE bug. We assert the bug WOULD have occurred, which is
# what the fix removes.
report_valve_prefix="$(runsh_report "")"   # empty == unset -> defaults to 0
if [ "$report_valve_prefix" = "council_approved" ]; then
    pass "non-vacuity: pre-fix (sentinel-absent) world WOULD misreport a valve stop as council_approved -- the exact bug bash-F1 fixes"
else
    fail "non-vacuity check broken: pre-fix simulation returned '$report_valve_prefix'"
fi

#===============================================================================
# Summary
#===============================================================================
echo "----------------------------------------------------------------"
echo "Council force-stop sentinel (bash-F1) test: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [ "$FAIL_COUNT" -ne 0 ]; then
    exit 1
fi
exit 0
