#!/usr/bin/env bash
# tests/test-rarv-parallel-build-prompt.sh -- verifies two build_prompt()
# directives introduced in v7.114.0:
#
#   rank 16 (parallel tool calls): the PARALLEL_TOOL_CALLS directive appears in
#     EVERY non-degraded-legacy build_prompt mode variant (static-first full,
#     static-first degraded, legacy-full), carried on the LSP_GROUNDING string.
#
#   rank 8 (mode-aware rarv_instruction): the never-finished tail ("There is
#     NEVER a 'finished' state" / "always find the next improvement") appears
#     ONLY in perpetual/no-promise runs. A finite PRD/checkpoint run (with a
#     COMPLETION_PROMISE set, non-perpetual) instead gets the concise
#     "claim done via loki_complete_task and STOP" directive. The unverifiable
#     "2-3x quality improvement" clause is removed from ALL modes.
#
# Both strings are parity-locked byte-identical to LSP_GROUNDING_INSTRUCTION and
# rarvInstruction() in loki-ts/src/runner/build_prompt.ts (Bun-route equivalents
# covered by loki-ts/tests/runner/build_prompt_units.test.ts).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PARALLEL_NEEDLE='PARALLEL_TOOL_CALLS: When issuing independent read-only operations'
NEVER_NEEDLE="There is NEVER a 'finished' state"
ALWAYS_NEEDLE='always find the next improvement'
STOP_NEEDLE='claim done via loki_complete_task and STOP'
GATES_NEEDLE='the completion gates (tests, checklist, evidence) are the authority'
CLAUSE_2X='2-3x quality improvement'

PASS=0
FAIL=0
TMPROOT=""

ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup() {
    [ -n "$TMPROOT" ] && [ -d "$TMPROOT" ] && rm -rf "$TMPROOT"
}
trap cleanup EXIT

TMPROOT=$(mktemp -d -t loki-rarv-bp-XXXX)

# render <retry> <prd> <iteration> <legacy> <degraded> <autonomy_mode> <perpetual> <promise>
render() {
    local retry="$1" prd="$2" iteration="$3"
    local legacy="$4" degraded="$5" amode="$6" perpetual="$7" promise="$8"
    (
        cd "$TMPROOT" || exit 1
        export LOKI_PHASE_UNIT_TESTS="false" LOKI_PHASE_API_TESTS="false" \
               LOKI_PHASE_E2E_TESTS="false" LOKI_PHASE_SECURITY="false" \
               LOKI_PHASE_INTEGRATION="false" LOKI_PHASE_CODE_REVIEW="false" \
               LOKI_PHASE_WEB_RESEARCH="false" LOKI_PHASE_PERFORMANCE="false" \
               LOKI_PHASE_ACCESSIBILITY="false" LOKI_PHASE_REGRESSION="false" \
               LOKI_PHASE_UAT="false"
        # shellcheck disable=SC1090
        source "$RUN_SH" >/dev/null 2>&1
        export MAX_PARALLEL_AGENTS=10 MAX_ITERATIONS=1000 TARGET_DIR="." \
               LOKI_HUMAN_INPUT="" DETECTED_COMPLEXITY="standard"
        export AUTONOMY_MODE="$amode" PERPETUAL_MODE="$perpetual" COMPLETION_PROMISE="$promise"
        export LOKI_LEGACY_PROMPT_ORDERING="$legacy"
        export PROVIDER_DEGRADED="$degraded"
        build_prompt "$retry" "$prd" "$iteration" 2>/dev/null
    )
}

assert_has() {
    local label="$1" out="$2" needle="$3"
    case "$out" in
        *"$needle"*) ok "$label" ;;
        *) bad "$label (MISSING: $needle)" ;;
    esac
}
assert_absent() {
    local label="$1" out="$2" needle="$3"
    case "$out" in
        *"$needle"*) bad "$label (PRESENT but should be absent: $needle)" ;;
        *) ok "$label" ;;
    esac
}

printf '%s\n' '# Sample PRD' > "$TMPROOT/prd.md"

# ======================================================================
# rank 16: PARALLEL_TOOL_CALLS directive present in every mode variant
# ======================================================================
# static-first full, no-PRD (perpetual defaults)
assert_has "rank16 static full no-PRD" \
    "$(render 0 "" 1 "false" "false" "perpetual" "false" "")" "$PARALLEL_NEEDLE"
# static-first full, with-PRD (finite: promise set)
assert_has "rank16 static full with-PRD" \
    "$(render 0 "$TMPROOT/prd.md" 1 "false" "false" "checkpoint" "false" "Ship it")" "$PARALLEL_NEEDLE"
# static-first degraded
assert_has "rank16 static degraded no-PRD" \
    "$(render 0 "" 1 "false" "true" "perpetual" "false" "")" "$PARALLEL_NEEDLE"
assert_has "rank16 static degraded with-PRD" \
    "$(render 0 "$TMPROOT/prd.md" 1 "false" "true" "checkpoint" "false" "Ship it")" "$PARALLEL_NEEDLE"
# legacy-full
assert_has "rank16 legacy full no-PRD" \
    "$(render 0 "" 1 "true" "false" "perpetual" "false" "")" "$PARALLEL_NEEDLE"
assert_has "rank16 legacy full with-PRD" \
    "$(render 0 "$TMPROOT/prd.md" 1 "true" "false" "checkpoint" "false" "Ship it")" "$PARALLEL_NEEDLE"
assert_has "rank16 legacy full resume no-PRD" \
    "$(render 1 "" 2 "true" "false" "perpetual" "false" "")" "$PARALLEL_NEEDLE"

# ======================================================================
# rank 8: mode-aware rarv_instruction
# ======================================================================
# perpetual run: never-finished tail present, stop-directive absent
PERP="$(render 0 "$TMPROOT/prd.md" 1 "false" "false" "perpetual" "true" "")"
assert_has    "rank8 perpetual has NEVER-finished"  "$PERP" "$NEVER_NEEDLE"
assert_has    "rank8 perpetual has always-improve"  "$PERP" "$ALWAYS_NEEDLE"
assert_absent "rank8 perpetual lacks stop-directive" "$PERP" "$STOP_NEEDLE"
assert_absent "rank8 perpetual lacks 2-3x clause"   "$PERP" "$CLAUSE_2X"

# no-promise run (AUTONOMY_MODE unset, no promise) -> treated as perpetual for rarv
NOPROM="$(render 0 "" 1 "false" "false" "" "false" "")"
assert_has    "rank8 no-promise has NEVER-finished" "$NOPROM" "$NEVER_NEEDLE"
assert_absent "rank8 no-promise lacks 2-3x clause"  "$NOPROM" "$CLAUSE_2X"

# finite PRD/checkpoint run (promise set, non-perpetual): never-finished GONE,
# stop-directive present. This reproduces the real auto-derived checkpoint env
# (run.sh:15935-15945 sets COMPLETION_PROMISE and switches to checkpoint).
FIN="$(render 0 "$TMPROOT/prd.md" 1 "false" "false" "checkpoint" "false" "All PRD requirements implemented and tests passing")"
assert_absent "rank8 finite lacks NEVER-finished"   "$FIN" "$NEVER_NEEDLE"
assert_absent "rank8 finite lacks always-improve"   "$FIN" "$ALWAYS_NEEDLE"
assert_has    "rank8 finite has stop-directive"     "$FIN" "$STOP_NEEDLE"
assert_has    "rank8 finite has gates-authority"    "$FIN" "$GATES_NEEDLE"
assert_absent "rank8 finite lacks 2-3x clause"      "$FIN" "$CLAUSE_2X"

echo
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
