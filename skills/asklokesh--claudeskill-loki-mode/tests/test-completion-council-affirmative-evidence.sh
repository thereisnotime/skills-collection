#!/usr/bin/env bash
# Test: council_evaluate_member requires AFFIRMATIVE positive evidence before a
# member votes COMPLETE (v7.41.5 trust-gate inversion).
#
# Background: council_evaluate_member previously defaulted vote=COMPLETE and only
# flipped to CONTINUE on a DETECTED failure. On a greenfield run with an empty
# .loki/ (no test results, no queue, few TODO files) requirements_verifier and
# devils_advocate defaulted to COMPLETE while only test_auditor went CONTINUE ->
# 2-of-3 cleared the size-3 threshold and the heuristic council approved a
# project with ZERO positive evidence. The fix inverts the default to CONTINUE
# and only votes COMPLETE on a real positive signal:
#   - shared base: .loki/quality/test-results.json present AND not red
#   - test_auditor additionally needs a REAL passing suite (runner != none)
#
# This test sources the REAL council_evaluate_member from completion-council.sh
# so it cannot drift from production behavior. It proves both directions:
#   1. empty .loki/ (no evidence)            -> every member votes CONTINUE
#   2. real passing test suite, clean tree   -> every member votes COMPLETE
#   3. no-runner project (runner:none)       -> req_verifier + devils_advocate
#                                               COMPLETE, test_auditor CONTINUE
#                                               (2-of-3, legit no-test completion
#                                               preserved)
#   4. red structured test results           -> every member votes CONTINUE

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"

if [ ! -f "$COUNCIL_SH" ]; then
    echo "FAIL: cannot find $COUNCIL_SH"
    exit 1
fi

# Stub the logging helpers the council script may reference, so sourcing is
# side-effect free and quiet.
log_info()  { :; }
log_warn()  { :; }
log_error() { :; }
log_debug() { :; }

# shellcheck source=/dev/null
source "$COUNCIL_SH" >/dev/null 2>&1 || true

if ! type council_evaluate_member >/dev/null 2>&1; then
    echo "FAIL: council_evaluate_member not defined after sourcing $COUNCIL_SH"
    exit 1
fi

# Deterministic env: no stagnation branch, well past min iterations. These are
# consumed by the sourced council_evaluate_member, not by this script directly,
# so shellcheck cannot see the use.
# shellcheck disable=SC2034
ITERATION_COUNT=5
# shellcheck disable=SC2034
COUNCIL_CONSECUTIVE_NO_CHANGE=0
# shellcheck disable=SC2034
COUNCIL_MIN_ITERATIONS=3

PASS=0
FAIL=0

# member_vote <role>  -> echoes the first token (COMPLETE | CONTINUE)
member_vote() {
    council_evaluate_member "$1" "test" | cut -d' ' -f1
}

assert_vote() {
    local label="$1" role="$2" expected="$3"
    local got
    got=$(member_vote "$role")
    if [ "$got" = "$expected" ]; then
        PASS=$((PASS + 1))
        printf 'PASS  %-55s -> %s\n' "$label" "$got"
    else
        FAIL=$((FAIL + 1))
        printf 'FAIL  %-55s -> got %s expected %s\n' "$label" "$got" "$expected"
    fi
}

# Build an isolated throwaway project dir. We cd into it so the TODO/FIXME grep
# (which scans CWD) sees a clean tree, and point TARGET_DIR at it so the council
# reads this project's .loki/.
make_project() {
    local dir
    dir=$(mktemp -d "${TMPDIR:-/tmp}/loki-council-test.XXXXXX")
    mkdir -p "$dir/.loki/quality" "$dir/.loki/logs" "$dir/.loki/queue"
    echo "$dir"
}

write_test_results() {
    # write_test_results <dir> <json>
    printf '%s\n' "$2" > "$1/.loki/quality/test-results.json"
}

cleanup_dirs=()
register_cleanup() { cleanup_dirs+=("$1"); }
# Safe cd wrapper: aborts the run if a directory change fails.
cdx() { cd "$1" || { echo "FAIL: cannot cd to $1"; exit 1; }; }
# shellcheck disable=SC2154  # d is the loop var, bound by the for-in inside the trap
trap 'for d in "${cleanup_dirs[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done' EXIT

ORIG_DIR="$PWD"

# ---------------------------------------------------------------------------
# Case 1: greenfield empty .loki/ -- NO evidence at all. The bug scenario.
# Every member must now vote CONTINUE (previously 2-of-3 COMPLETE).
# ---------------------------------------------------------------------------
echo "=== Case 1: empty .loki/, no evidence -> all CONTINUE (bug fixed) ==="
P1=$(make_project); register_cleanup "$P1"
TARGET_DIR="$P1"
cdx "$P1"
assert_vote "empty: requirements_verifier" requirements_verifier CONTINUE
assert_vote "empty: test_auditor"          test_auditor          CONTINUE
assert_vote "empty: devils_advocate"       devils_advocate       CONTINUE
cdx "$ORIG_DIR"

# ---------------------------------------------------------------------------
# Case 2: real passing test suite + clean tree -- legit FINISHED project.
# All three members must vote COMPLETE (legit completion preserved).
# ---------------------------------------------------------------------------
echo
echo "=== Case 2: real passing suite, clean tree -> all COMPLETE (legit) ==="
P2=$(make_project); register_cleanup "$P2"
write_test_results "$P2" '{"timestamp":"2026-06-14T00:00:00Z","runner":"jest","pass":true,"min_coverage":80,"summary":"42 passed"}'
TARGET_DIR="$P2"
cdx "$P2"
assert_vote "passing: requirements_verifier" requirements_verifier COMPLETE
assert_vote "passing: test_auditor"          test_auditor          COMPLETE
assert_vote "passing: devils_advocate"       devils_advocate       COMPLETE
cdx "$ORIG_DIR"

# ---------------------------------------------------------------------------
# Case 3: no test runner (runner:none, pass:true) -- a legit project with no
# test suite. The completion route writes this exact JSON. test_auditor needs a
# REAL suite so it stays CONTINUE; the other two get positive base evidence and
# vote COMPLETE -> 2-of-3 still clears the threshold. Legit no-test completion
# is preserved.
# ---------------------------------------------------------------------------
echo
echo "=== Case 3: no-runner project -> 2-of-3 COMPLETE (no-test completion) ==="
P3=$(make_project); register_cleanup "$P3"
write_test_results "$P3" '{"timestamp":"2026-06-14T00:00:00Z","runner":"none","pass":true,"summary":"No test runner detected"}'
TARGET_DIR="$P3"
cdx "$P3"
assert_vote "no-runner: requirements_verifier" requirements_verifier COMPLETE
assert_vote "no-runner: test_auditor"          test_auditor          CONTINUE
assert_vote "no-runner: devils_advocate"       devils_advocate       COMPLETE
cdx "$ORIG_DIR"

# ---------------------------------------------------------------------------
# Case 4: red structured test results -- a real suite ran and failed. Every
# member must vote CONTINUE regardless of role.
# ---------------------------------------------------------------------------
echo
echo "=== Case 4: red structured results -> all CONTINUE ==="
P4=$(make_project); register_cleanup "$P4"
write_test_results "$P4" '{"timestamp":"2026-06-14T00:00:00Z","runner":"pytest","pass":false,"summary":"3 failed"}'
TARGET_DIR="$P4"
cdx "$P4"
assert_vote "red: requirements_verifier" requirements_verifier CONTINUE
assert_vote "red: test_auditor"          test_auditor          CONTINUE
assert_vote "red: devils_advocate"       devils_advocate       CONTINUE
cdx "$ORIG_DIR"

# ---------------------------------------------------------------------------
# Case 5: passing suite but pending tasks in the queue -- requirements_verifier
# must block (CONTINUE) on real pending work even with green tests.
# ---------------------------------------------------------------------------
echo
echo "=== Case 5: passing suite + pending queue -> req_verifier CONTINUE ==="
P5=$(make_project); register_cleanup "$P5"
write_test_results "$P5" '{"timestamp":"2026-06-14T00:00:00Z","runner":"jest","pass":true,"summary":"42 passed"}'
printf '%s\n' '[{"id":"t1"},{"id":"t2"}]' > "$P5/.loki/queue/pending.json"
# shellcheck disable=SC2034  # consumed by the sourced council_evaluate_member
TARGET_DIR="$P5"
cdx "$P5"
assert_vote "pending: requirements_verifier" requirements_verifier CONTINUE
assert_vote "pending: test_auditor"          test_auditor          COMPLETE
cdx "$ORIG_DIR"

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
