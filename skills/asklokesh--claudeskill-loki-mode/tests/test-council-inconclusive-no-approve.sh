#!/usr/bin/env bash
# S-116 (P2.council-inconclusive-cannot-exit-zero): council_evaluate must not
# approve on the council vote alone when the evidence gate saw no conclusive
# test evidence. council_evaluate sets a function-local
# _LOKI_EVIDENCE_REQUIRE_TESTS=1 around council_evidence_gate; every other caller
# (completion-promise route, gate loops) keeps pass-through.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"
RUN="$(mktemp -d "${TMPDIR:-/tmp}/council-inc.XXXXXX")" || exit 1
trap 'rm -rf -- "$RUN"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1 ($2)"; }

g() { local d="$1"; shift; git -C "$d" -c user.email=t@loki.local -c user.name=t -c commit.gpgsign=false "$@"; }
new_repo() {
    mkdir -p "$1" && git init -q "$1" 2>/dev/null && printf 'seed\n' > "$1/seed.txt" \
        && g "$1" add seed.txt && g "$1" commit -qm seed
}
# <dir> <test-results-json|""> -> echoes base sha; commits a real diff
repo() {
    new_repo "$1" >/dev/null 2>&1 || return 1
    printf '.loki/\n' > "$1/.gitignore"; g "$1" add .gitignore; g "$1" commit -qm ignore
    local base; base="$(g "$1" rev-parse HEAD)"
    printf 'feature\n' > "$1/feature.txt"; g "$1" add feature.txt; g "$1" commit -qm feature
    if [ -n "$2" ]; then mkdir -p "$1/.loki/quality"; printf '%s\n' "$2" > "$1/.loki/quality/test-results.json"; fi
    echo "$base"
}
# <repo> <base-sha> <function> [args] -> echoes rc; the vote is stubbed to a 2-of-3 COMPLETE
call() {
    local d="$1" b="$2"; shift 2
    (
        cd "$d" || exit 99
        log_info() { :; }; log_warn() { :; }; log_error() { :; }; log_success() { :; }
        log_debug() { :; }; log_header() { :; }; log_step() { :; }
        source "$COUNCIL_SH" >/dev/null 2>&1 || exit 98
        export COUNCIL_STATE_DIR="$d/.loki/council" TARGET_DIR="$d" ITERATION_COUNT=7
        export _LOKI_RUN_START_SHA="$b" LOKI_TEST_PROVENANCE=0 __LOKI_CLAUDE_HELP_CACHE=__no_claude__
        COUNCIL_ENABLED=true; COUNCIL_SIZE=3
        mkdir -p "$COUNCIL_STATE_DIR/votes"
        council_aggregate_votes() {
            printf '%s\n' '{"verdict":"COMPLETE","complete_votes":2,"total_members":3}' \
                > "$COUNCIL_STATE_DIR/votes/round-${ITERATION_COUNT}.json"
            echo "COMPLETE"
        }
        "$@" >/dev/null 2>&1
    )
    echo "$?"
}
jf() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$1" 2>/dev/null; }

GREEN='{"runner":"jest","pass":true,"summary":"green"}'

# 1. No test results + real diff + 2-of-3 vote: council_evaluate does not approve.
d="$RUN/inc"; b="$(repo "$d" "")" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" council_evaluate)"
[ "$rc" = "1" ] && ok "no test results + vote -> council_evaluate rc 1" || bad "no test results + vote" "rc=$rc want 1"
v="$(jf "$d/.loki/council/evidence-gate-details.json" "str(d['tests']['inconclusive']).lower()")"
[ "$v" = "true" ] && ok "details record tests.inconclusive=true" || bad "details tests.inconclusive" "got [$v]"
v="$(jf "$d/.loki/council/evidence-gate-details.json" "d.get('verdict')")"
[ "$v" = "block" ] && ok "details record verdict=block (audit matches decision)" || bad "details verdict" "got [$v]"

# 2. Positive control: genuine green evidence + vote still approves.
d="$RUN/green"; b="$(repo "$d" "$GREEN")" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" council_evaluate)"
[ "$rc" = "0" ] && ok "green tests + vote -> council_evaluate rc 0" || bad "green control" "rc=$rc want 0"

# 3. Zero tests executed is inconclusive too, not a loophole one field over.
d="$RUN/zero"; b="$(repo "$d" '{"runner":"jest","pass":"inconclusive","status":"no_tests_run"}')" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" council_evaluate)"
[ "$rc" = "1" ] && ok "zero tests executed + vote -> rc 1" || bad "zero tests + vote" "rc=$rc want 1"

# 4. Other callers unchanged: the no-arg gate still passes inconclusive through.
d="$RUN/noarg"; b="$(repo "$d" "")" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" council_evidence_gate)"
[ "$rc" = "0" ] && ok "no-arg council_evidence_gate on no results -> rc 0 (pass-through kept)" || bad "no-arg gate" "rc=$rc want 0"

# 5. Opt-out still works: NO_TESTS_AFFIRMATIVE=1 lets the council approve.
d="$RUN/optout"; b="$(repo "$d" "")" || { echo "fixture failed"; exit 1; }
rc="$(export LOKI_EVIDENCE_NO_TESTS_AFFIRMATIVE=1; call "$d" "$b" council_evaluate)"
[ "$rc" = "0" ] && ok "LOKI_EVIDENCE_NO_TESTS_AFFIRMATIVE=1 -> rc 0" || bad "opt-out" "rc=$rc want 0"

# 6. The strict mode is local to council_evaluate: a gate call after it in the
#    same shell still passes inconclusive through (no leak into the gate loops).
eval_then_gate() { council_evaluate; council_evidence_gate; }
d="$RUN/leak"; b="$(repo "$d" "")" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" eval_then_gate)"
[ "$rc" = "0" ] && ok "strict mode does not leak past council_evaluate" || bad "strict mode leak" "rc=$rc want 0"

# 7. Tautological provenance (green tests that also pass on the base) is not
#    "no test evidence": the council route still approves it.
taut_eval() { _loki_test_provenance() { echo tautological; }; council_evaluate; }
d="$RUN/taut"; b="$(repo "$d" "$GREEN")" || { echo "fixture failed"; exit 1; }
rc="$(call "$d" "$b" taut_eval)"
v="$(jf "$d/.loki/council/evidence-gate-details.json" "d['tests'].get('inconclusive_reason')")"
[ "$v" = "test_provenance_unconfirmed" ] && ok "control: stub reached (reason=test_provenance_unconfirmed)" || bad "tautological stub control" "reason=[$v]"
[ "$rc" = "0" ] && ok "tautological green tests + vote -> rc 0" || bad "tautological provenance" "rc=$rc want 0"

echo "council-inconclusive-no-approve: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
