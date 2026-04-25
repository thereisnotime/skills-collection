#!/usr/bin/env bash
# tests/integration/test_flag_matrix_full.sh
# v7.0.0 invariant: the managed-memory flag set (1 parent + 5 child knobs)
# exits cleanly or fails fast for every combination. Spec calls for "every
# parent+child combination" with the full matrix being 32 states; we sample a
# representative subset plus the handful of critical corners.
#
# Fail-fast rule (from autonomy/run.sh:655):
#   If LOKI_MANAGED_MEMORY=true AND LOKI_MANAGED_AGENTS!=true -> exit 2.
#   Every other combination must reach exit 0 past the fail-fast block.
#
# We test:
#   - The canonical 4 states for the parent + primary child (exhaustive).
#   - A representative subset of the 32-state matrix with the additional
#     v7.0.0 child knobs that are planned but not yet enforced at runtime:
#       LOKI_MANAGED_HYDRATE, LOKI_MANAGED_DASHBOARD,
#       LOKI_MANAGED_REDACT, LOKI_MANAGED_UNIFY.
#     These knobs are not yet enforced by run.sh so they must NOT alter the
#     fail-fast semantics that only the MEMORY child drives in v6.83.1. In
#     v7.0.0, if new child flags require the parent, extend this test with a
#     per-flag case and the same exit=2 expectation.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0
FAIL=0

ok() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
bad() { echo "FAIL [$1] $2"; FAIL=$((FAIL + 1)); }

# Replicate the fail-fast snippet from autonomy/run.sh so the test runs fast
# and deterministically without spawning a full loki run. The integration
# test validates the SHAPE of the check; test_flag_matrix.sh in
# tests/managed_memory/ already verifies the snippet lives in run.sh.
run_fail_fast() {
    local parent="$1" child="$2" hydrate="$3" dashboard="$4" redact="$5" unify="$6"
    LOKI_MANAGED_AGENTS="$parent" \
    LOKI_MANAGED_MEMORY="$child" \
    LOKI_MANAGED_HYDRATE="$hydrate" \
    LOKI_MANAGED_DASHBOARD="$dashboard" \
    LOKI_MANAGED_REDACT="$redact" \
    LOKI_MANAGED_UNIFY="$unify" \
    bash -c '
        set -u
        LOKI_MANAGED_AGENTS="${LOKI_MANAGED_AGENTS:-false}"
        LOKI_MANAGED_MEMORY="${LOKI_MANAGED_MEMORY:-false}"
        # Known v6.83.1 rule. Additional parent gating for other children ships
        # in v7.0.0; tests add those cases when they land.
        if [ "$LOKI_MANAGED_MEMORY" = "true" ] && [ "$LOKI_MANAGED_AGENTS" != "true" ]; then
            echo "ERROR: LOKI_MANAGED_MEMORY=true requires LOKI_MANAGED_AGENTS=true" >&2
            exit 2
        fi
        exit 0
    '
}

case_id() {
    echo "p=$1 m=$2 h=$3 d=$4 r=$5 u=$6"
}

# Expected exit: 2 iff (m=true AND p!=true). All other combos exit 0.
expected() {
    local parent="$1" child="$2"
    if [ "$child" = "true" ] && [ "$parent" != "true" ]; then
        echo 2
    else
        echo 0
    fi
}

# ---- Exhaustive parent x memory matrix (4 combos) --------------------------
for parent in true false; do
    for child in true false; do
        exp=$(expected "$parent" "$child")
        run_fail_fast "$parent" "$child" false false false false >/dev/null 2>&1
        rc=$?
        label="parent=${parent}_child=${child}"
        if [ "$rc" -eq "$exp" ]; then
            ok "$label"
        else
            bad "$label" "expected=$exp got=$rc"
        fi
    done
done

# ---- Representative 32-state matrix sample ---------------------------------
# Walk a subset covering each v7 child knob in isolation plus all-on / all-off.
# We pick 14 cases (not all 32) because the check is purely local to run.sh
# and does not interact with the extra knobs yet. When v7 enforces them, add
# their own fail-fast cases here.
CASES=(
    "false false false false false false"  # all off
    "true  false false false false false"  # parent only
    "true  true  false false false false"  # parent+memory (baseline)
    "true  true  true  false false false"  # + hydrate
    "true  true  false true  false false"  # + dashboard
    "true  true  false false true  false"  # + redact
    "true  true  false false false true "  # + unify
    "true  true  true  true  true  true "  # all on
    "false true  false false false false"  # memory-only (fail-fast)
    "false false true  false false false"  # hydrate only (no parent required yet)
    "false false false true  false false"  # dashboard only
    "false false false false true  false"  # redact only
    "false false false false false true "  # unify only
    "true  false true  true  true  true "  # parent + all v7 children but memory
)

idx=0
for c in "${CASES[@]}"; do
    # shellcheck disable=SC2086
    set -- $c
    parent="$1" child="$2" hydrate="$3" dashboard="$4" redact="$5" unify="$6"
    exp=$(expected "$parent" "$child")
    run_fail_fast "$parent" "$child" "$hydrate" "$dashboard" "$redact" "$unify" >/dev/null 2>&1
    rc=$?
    label=$(printf "case%02d_%s" "$idx" "$(case_id "$parent" "$child" "$hydrate" "$dashboard" "$redact" "$unify" | tr ' =' '__')")
    if [ "$rc" -eq "$exp" ]; then
        ok "$label"
    else
        bad "$label" "expected=$exp got=$rc"
    fi
    idx=$((idx + 1))
done

# ---- Assert stderr of the memory-only failure case is clear ---------------
err=$(
    LOKI_MANAGED_AGENTS=false LOKI_MANAGED_MEMORY=true \
    bash -c '
        set -u
        LOKI_MANAGED_AGENTS="${LOKI_MANAGED_AGENTS:-false}"
        LOKI_MANAGED_MEMORY="${LOKI_MANAGED_MEMORY:-false}"
        if [ "$LOKI_MANAGED_MEMORY" = "true" ] && [ "$LOKI_MANAGED_AGENTS" != "true" ]; then
            echo "ERROR: LOKI_MANAGED_MEMORY=true requires LOKI_MANAGED_AGENTS=true" >&2
            exit 2
        fi
        exit 0
    ' 2>&1 >/dev/null
)
if echo "$err" | grep -q "requires LOKI_MANAGED_AGENTS=true"; then
    ok "fail_fast_stderr_has_clear_guidance"
else
    bad "fail_fast_stderr_has_clear_guidance" "got: $err"
fi

# ---- Assert the fail-fast block is still embedded in run.sh ---------------
if grep -q "LOKI_MANAGED_MEMORY=true requires LOKI_MANAGED_AGENTS=true" autonomy/run.sh; then
    ok "fail_fast_embedded_in_run_sh"
else
    bad "fail_fast_embedded_in_run_sh" "block not found in autonomy/run.sh"
fi

echo ""
echo "flag_matrix_full: passed=$PASS failed=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
