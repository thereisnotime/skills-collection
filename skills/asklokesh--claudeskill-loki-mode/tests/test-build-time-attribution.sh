#!/usr/bin/env bash
# The build's wall clock must be attributable, not guessed.
#
# WHY THIS EXISTS. benchmarks/results/gate-profile.json profiled a real 16-minute
# build and found stage_total_s=723 against wall_clock_s=960: 237 seconds, 25% of
# every build, attributed to nothing. Its own note guessed the contents as
# "process startup, git, rsync of the engine copy, teardown".
#
# Measurement later falsified the guess. There is NO rsync in the engine at all
# (the only one in the repo is in benchmarks/speed-benchmark.sh, costs 1.09s, and
# runs BEFORE that harness starts its timer); interpreter startup measured ~0.6s
# per iteration; the git operations on the hot path measured tens of milliseconds.
# The 237s was never where the guess said it was.
#
# The cause was structural: all nine emit_stage_complete call sites lay INSIDE the
# iteration body, so no event could ever describe pre-loop setup or post-loop
# teardown. Two brackets close that hole. This test pins them, because an
# un-instrumented window does not fail any gate -- it just quietly returns to
# being a guess, which is exactly how it survived this long.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- both unmeasured windows are bracketed"

for stage in boot teardown; do
    if grep -q "emit_stage_complete \"$stage\"" "$RUN_SH"; then
        ok "the '$stage' window emits a stage_complete event"
    else
        bad "no emit_stage_complete for '$stage' -- that window is unattributed again"
    fi
done

# A close with no open emits a duration measured from an empty string.
for var in _boot_t0 _teardown_t0; do
    opens=$(grep -c "^\s*${var}=\$(date" "$RUN_SH" || true)
    if [ "${opens:-0}" -ge 1 ]; then
        ok "$var is opened with a timestamp"
    else
        bad "$var is never assigned; its stage would report a bogus duration"
    fi
done

echo
echo "T2 -- instrumentation stays additive"

# The whole safety argument for this seam is that it cannot change a verdict.
# If a bracket ever gains an `exit`, `return` or `set -e`-sensitive construct,
# it stops being free and starts being a way to fail a build during teardown.
boot_line=$(grep -n 'emit_stage_complete "boot"' "$RUN_SH" | head -1 | cut -d: -f1)
if [ -n "$boot_line" ]; then
    seg=$(sed -n "${boot_line}p" "$RUN_SH")
    case "$seg" in
        *"||"*|*"&&"*|*exit*|*return*)
            bad "the boot emit is conditional or can exit: $seg" ;;
        *)
            ok "the boot emit is a bare additive call" ;;
    esac
fi

# teardown is guarded on the var being set, which is correct: the variable is
# assigned on one branch only, and an unguarded call on the other path would
# compute a duration from an empty string.
if grep -q 'if \[ -n "${_teardown_t0:-}" \]' "$RUN_SH"; then
    ok "the teardown emit is guarded against an unset start time"
else
    bad "teardown emit is not guarded; a path that never opened it reports garbage"
fi

echo
echo "T3 -- the dashboard wait is not a flat sleep on the critical path"

# This was `sleep 2` before the first iteration of every build, spent on a
# process that typically serves far sooner. The floor is retained as a fallback,
# so assert on the POLL existing rather than on the sleep being absent.
# Assert the poll LOOP actually exists and is wired to the fallback, not merely
# that some identifier appears. An earlier version of this check grepped for the
# variable name alone and stayed green when the variable was renamed out of the
# control flow -- a guard that cannot see its own regression.
poll_ok=1
grep -q 'for _ in $(seq 1 40); do' "$RUN_SH" || poll_ok=0
grep -q 'api/status' "$RUN_SH" || poll_ok=0
grep -qE '\[ "\$_dash_ready" = "1" \] \|\| sleep 2' "$RUN_SH" || poll_ok=0
if [ "$poll_ok" = "1" ]; then
    ok "dashboard readiness is polled, with the flat sleep only as a fallback"
else
    bad "no readiness poll wired to the fallback; the flat sleep is back on the critical path"
fi

# The liveness property the old sleep provided must survive: a process that dies
# during startup still has to be caught.
if grep -q 'kill -0 "$DASHBOARD_PID"' "$RUN_SH"; then
    ok "process liveness is still checked"
else
    bad "liveness check lost -- a dashboard that dies at startup would look healthy"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
