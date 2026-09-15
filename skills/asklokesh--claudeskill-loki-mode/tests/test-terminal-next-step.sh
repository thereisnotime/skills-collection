#!/usr/bin/env bash
# A terminal that names a bound must also name the lever.
#
# "Max iterations" tells a user what happened and nothing about what to do. The
# wrong guess is expensive in a specific way: raising an iteration cap on a run
# that was THRASHING buys more thrashing at full price. Raising it on a run that
# was CONVERGING is exactly right. Same message, opposite correct actions.
#
# The rework split already distinguishes those two cases in the same summary, so
# the next-step line points at it rather than listing every environment variable
# and leaving the user to pick.
#
# THE PROPERTY THAT MUST NOT REGRESS: a SUCCESSFUL run gets no next-step block.
# Advice printed after a clean finish is noise, and noise in a summary is how
# users learn to stop reading summaries.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

passed=0
failed=0
ok() { echo "  PASS: $1"; passed=$((passed + 1)); }
ko() { echo "  FAIL: $1"; failed=$((failed + 1)); shift; [[ $# -gt 0 ]] && echo "        $*"; }

echo "TEST: terminal outcomes name the next step"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/loki-nextstep-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

summary_for() {
    local _oc="$1" dir="$SCRATCH/$1"
    rm -rf "$dir"; mkdir -p "$dir/.loki/metrics/efficiency"
    (
        cd "$dir" || exit 1
        git init -q .
        git config user.email t@t.test
        git config user.name t
        git config commit.gpgsign false
        echo x > f.txt
        git add f.txt >/dev/null 2>&1
        git commit -qm base --no-verify >/dev/null 2>&1
    )
    # Three failed iterations: a thrashing run, the case the advice must split.
    local i
    for i in 1 2 3; do
        printf '{"iteration":%d,"model":"sonnet","duration_ms":300000,"cost_usd":1.2,"status":"failed"}\n' \
            "$i" > "$dir/.loki/metrics/efficiency/iteration-$i.json"
    done
    bash -c "source '$RUN_SH' 2>/dev/null
             cd '$dir'; TARGET_DIR=.; export TARGET_DIR
             SCRIPT_DIR='$REPO_ROOT/autonomy'
             ITERATION_COUNT=3; MAX_ITERATIONS=3
             NOTIFICATIONS_ENABLED=false build_completion_summary $_oc" >/dev/null 2>&1
    cat "$dir/.loki/COMPLETION.txt" 2>/dev/null
}

# --- 1. the iteration cap names the cap AND the thrashing caveat -------------
out="$(summary_for max_iterations)"
[[ "$out" == *"LOKI_MAX_ITERATIONS"* ]] \
    && ok "max_iterations names the iteration knob" \
    || ko "max_iterations names the iteration knob"

# The caveat is the load-bearing half. Without it the advice is "raise the cap",
# which is the wrong action for a thrashing run and costs real money.
[[ "$out" == *"hrashing"* ]] \
    && ok "max_iterations warns that raising the cap can buy more thrashing" \
    || ko "max_iterations warns that raising the cap can buy more thrashing" \
          "advice without this half tells a thrashing run to spend more"

# It must not read as a verdict on the work.
[[ "$out" == *"not a verdict"* ]] \
    && ok "max_iterations is framed as a ceiling, not a judgement of the work" \
    || ko "max_iterations is framed as a ceiling, not a judgement"

# --- 2. budget points at the cache, the usual cause of a surprise bill -------
out="$(summary_for budget_exceeded)"
[[ "$out" == *"LOKI_BUDGET_LIMIT"* ]] \
    && ok "budget_exceeded names the budget knob" \
    || ko "budget_exceeded names the budget knob"
[[ "$out" == *"economics"* ]] \
    && ok "budget_exceeded points at the cache hit ratio" \
    || ko "budget_exceeded points at the cache hit ratio"

# --- 3. a force-stop must say the work is NOT verified ----------------------
out="$(summary_for force_stopped)"
[[ "$out" == *"not verified"* ]] \
    && ok "force_stopped states the work is not verified complete" \
    || ko "force_stopped states the work is not verified complete" \
          "a council stop that reads as success is the worst summary bug"

# --- 4. THE PROPERTY. A clean run gets no advice. ---------------------------
out="$(summary_for complete)"
if [[ "$out" == *"Next:"* ]]; then
    ko "a successful run prints NO next-step block" \
       "advice after a clean finish is noise, and noise trains users to skip summaries"
else
    ok "a successful run prints NO next-step block"
fi

# --- 5. the rework split is still there to make the advice actionable -------
# The max_iterations advice explicitly refers to "rework above". If that line
# ever stops rendering, the advice points at nothing.
out="$(summary_for max_iterations)"
[[ "$out" == *"Rework:"* ]] \
    && ok "the rework split the advice refers to is present" \
    || ko "the rework split the advice refers to is present" \
          "the advice says 'low rework above' with no rework line rendered"

# --- 6. every gate-stuck terminal actually CALLS the summary -----------------
# Gate-stuck was the only terminal in run_autonomous that wrote no
# COMPLETION.txt and sent no notification: it went save_state -> return 20 and
# told the user nothing, on the one path that stopped because a gate would not
# clear. A --bg run therefore pinged nobody and left nothing in the file those
# users are told to read.
#
# This asserts on the CALL, by executing the branch, because a source grep for
# the function name survives the mutation that matters: replacing the literal
# with an unset variable still greps 1 while the summary receives "".
#
# The branch is located by pattern rather than line number. Every line number
# the original audit cited for this code had already drifted by the time the
# fix landed.
for _g in static_analysis mock_integrity mutation_integrity; do
    _s="$(grep -n "if _loki_gate_stuck \"$_g\"" "$RUN_SH" | head -1 | cut -d: -f1)"
    if [[ -z "$_s" ]]; then
        ko "gate-stuck branch for $_g is locatable" \
           "the anchor moved; this guard cannot see the code it protects"
        continue
    fi
    _e="$(awk -v s="$_s" 'NR>s && NR<=s+25 && /^ *fi$/ {print NR; exit}' "$RUN_SH")"
    _got="$(awk -v s="$_s" -v e="$_e" 'NR>=s && NR<=e' "$RUN_SH" > "$SCRATCH/branch-$_g.sh"
            cd "$SCRATCH" && bash -c '
                set +e
                _loki_gate_stuck() { return 0; }
                log_error() { :; }
                log_warn() { :; }
                emit_event_json() { :; }
                save_state() { :; }
                emit_completion_summary() { printf "%s" "${1:-}"; }
                sa_count=3; mk_count=3; mt_count=3; TARGET_DIR=.
                source "./branch-'"$_g"'.sh"
            ' 2>/dev/null)"
    if [[ "$_got" == "gate_stuck_$_g" ]]; then
        ok "gate_stuck_$_g calls emit_completion_summary with its own outcome"
    else
        ko "gate_stuck_$_g calls emit_completion_summary with its own outcome" \
           "recorded [$_got]; a terminal that writes no COMPLETION.txt tells a --bg user nothing"
    fi
done

echo ""
echo "  Passed:     $passed"
echo "  Failed:     $failed"
[[ $failed -eq 0 ]] || exit 1
