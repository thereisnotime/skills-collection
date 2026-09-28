#!/usr/bin/env bash
# Test: S-157 (BACKLOG 98 remainder, 89). A test-results.json that says
# {"pass":true,"failed_count":2} is not green at either council reader:
#   - council_evaluate_member's shared test-results parser (member vote)
#   - _council_convergence_evidence_green (no-claim convergence floor)
# Both must apply the evidence gate rule (council_evidence_gate): a numeric
# failed_count above zero wins, the legacy numeric failed is the fallback, and
# null, missing or a bool is unmeasured (never a failure, never 0).
#
# Sources the REAL completion-council.sh so the test cannot drift.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"

[ -f "$COUNCIL_SH" ] || { echo "FAIL: cannot find $COUNCIL_SH"; exit 1; }

log_info()  { :; }
log_warn()  { :; }
log_error() { :; }
log_debug() { :; }
log_header() { :; }

# shellcheck source=/dev/null
source "$COUNCIL_SH" >/dev/null 2>&1 || true

for fn in council_evaluate_member _council_convergence_evidence_green; do
    type "$fn" >/dev/null 2>&1 || { echo "FAIL: $fn not defined after sourcing"; exit 1; }
done

# Consumed by the sourced council_evaluate_member.
# shellcheck disable=SC2034
ITERATION_COUNT=5
# shellcheck disable=SC2034
COUNCIL_CONSECUTIVE_NO_CHANGE=0
# shellcheck disable=SC2034
COUNCIL_MIN_ITERATIONS=3

PASS=0
FAIL=0
ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-test-failed-count.XXXXXX")"
trap 'cd /; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/.loki/quality" "$WORK/.loki/logs" "$WORK/.loki/queue"
# shellcheck disable=SC2034  # read by the sourced council functions
TARGET_DIR="$WORK"
# The member's TODO/FIXME grep scans the cwd: keep it on the clean fixture.
cd "$WORK" || { echo "FAIL: cannot cd to $WORK"; exit 1; }

write_tr() { printf '%s\n' "$1" > "$WORK/.loki/quality/test-results.json"; }
vote()     { council_evaluate_member "$1" "test" | cut -d' ' -f1; }
conv()     { if _council_convergence_evidence_green; then echo green; else echo not_green; fi; }

check() {
    # check <label> <json> <expected member vote> <expected convergence>
    local label="$1" json="$2" want_vote="$3" want_conv="$4" r got
    write_tr "$json"
    for r in requirements_verifier test_auditor devils_advocate; do
        got="$(vote "$r")"
        if [ "$got" = "$want_vote" ]; then ok "member $r: $label -> $got"
        else bad "member $r: $label -> got $got, want $want_vote"; fi
    done
    got="$(conv)"
    if [ "$got" = "$want_conv" ]; then ok "convergence: $label -> $got"
    else bad "convergence: $label -> got $got, want $want_conv"; fi
}

# Red on the pre-fix code: pass:true with a recorded failure count.
check "pass:true failed_count:2" \
    '{"runner":"jest","pass":true,"failed_count":2,"summary":"40 passed, 2 failed"}' \
    CONTINUE not_green
# Legacy numeric failed is the fallback when failed_count is absent.
check "pass:true failed:1 (legacy fallback)" \
    '{"runner":"jest","pass":true,"failed":1}' \
    CONTINUE not_green
# Positive control: a real zero failure count stays green.
check "pass:true failed_count:0" \
    '{"runner":"jest","pass":true,"failed_count":0,"summary":"42 passed"}' \
    COMPLETE green
# Unmeasured counts (null, bool) are never a failure.
check "pass:true failed_count:null" \
    '{"runner":"jest","pass":true,"failed_count":null}' \
    COMPLETE green
check "pass:true failed_count:true (bool is unmeasured)" \
    '{"runner":"jest","pass":true,"failed_count":true}' \
    COMPLETE green

# runner=none is unchanged: the member reads it as base-positive (test_auditor
# still needs a real suite), and convergence never reads it as green.
write_tr '{"runner":"none","pass":"inconclusive","status":"not_run","failed_count":2}'
got="$(vote requirements_verifier)"
[ "$got" = COMPLETE ] && ok "runner=none unchanged at member -> $got" \
    || bad "runner=none at member -> got $got, want COMPLETE"
got="$(conv)"
[ "$got" = not_green ] && ok "runner=none unchanged at convergence -> $got" \
    || bad "runner=none at convergence -> got $got, want not_green"

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
