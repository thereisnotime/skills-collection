#!/usr/bin/env bash
# `loki verify` must not report a review it did not perform.
#
# WHY THIS EXISTS. The verify MVP shipped deterministic-only and hardcoded
# llm_review.status = "skipped" with the reason "deterministic-only MVP (30-day
# cut)". That was honest, but it meant the evidence receipt -- the artifact this
# whole product is positioned on -- publicly reported half its quality story as
# unshipped. Meanwhile `--no-llm` was parsed and immediately discarded: a flag
# accepted "for forward-compat" that did nothing.
#
# The stage now runs by default. The property that matters is NOT that a review
# happened -- it legitimately may not, with no API key -- but that the document
# never claims one when it did not. Three distinct states, never collapsed:
#
#   reviewed    - a judge ran and returned a parseable verdict
#   skipped     - deliberately not run (--no-llm, or no diff to review)
#   unavailable - it should have run and could not (no key, timeout, bad payload)
#
# Collapsing "unavailable" into "skipped" would let a broken API key read as a
# clean pass, which is the exact failure this project exists to prevent.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY="$REPO_ROOT/autonomy/verify.sh"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- the stage exists and --no-llm is real"

if grep -q '_verify_llm_review()' "$VERIFY"; then
    ok "the LLM review stage exists"
else
    bad "no _verify_llm_review; the receipt still reports a permanently skipped stage"
fi

# The old parser matched --no-llm and threw it away. Assert it now sets state.
if grep -A3 '^            --no-llm)' "$VERIFY" | grep -q 'VERIFY_NO_LLM=1'; then
    ok "--no-llm sets state instead of being discarded"
else
    bad "--no-llm is still a no-op"
fi

if ! grep -q 'deterministic-only MVP (30-day cut)' "$VERIFY"; then
    ok "the hardcoded permanent-skip reason is gone"
else
    bad "llm_review still hardcodes the MVP skip reason"
fi

echo
echo "T2 -- failure is never reported as success"

# Every early-return in the stage must emit a status. A path that returns without
# printing would leave the caller's cut(1) empty and default to unavailable --
# acceptable -- but an explicit "reviewed" on a failure path would not be.
if grep -A4 'if \[ "\$rc" -ne 0 \] || \[ -z "\$out" \]' "$VERIFY" | grep -q 'unavailable'; then
    ok "a judge that returns nothing records unavailable, not a pass"
else
    bad "the empty-result path does not record unavailable"
fi

if grep -A3 'ERR\*)' "$VERIFY" | grep -q 'unavailable'; then
    ok "a payload that does not parse records unavailable, not a pass"
else
    bad "a malformed judge payload could be read as a pass"
fi

# reviewed must be reachable ONLY from the successful parse branch.
# Count EMISSIONS only. A naive grep for the literal also matches the report
# renderer's `if _llm_status == "reviewed"` comparisons, which read the status
# rather than produce it -- counting those made this check fail on correct code.
_reviewed_sites=$(grep -cE "printf .*\"reviewed\"" "$VERIFY" || true)
if [ "${_reviewed_sites:-0}" -eq 1 ]; then
    ok "'reviewed' is emitted from exactly one place (the successful parse)"
else
    bad "'reviewed' is emitted from ${_reviewed_sites} places; a failure path may claim a review"
fi

echo
echo "T3 -- the review is advisory in this release"

# Default-ON is only safe because the verdict is untouched. If this ever stops
# being true it must be a deliberate, flagged change -- not a silent one.
if grep -q '"affects_verdict": False' "$VERIFY"; then
    ok "the document states the review does not affect the verdict"
else
    bad "affects_verdict is missing; a CI job gating on exit 0 could break silently"
fi

echo
echo "T4 -- the raw judge payload is kept for inspection"

# A summary the reader cannot check is just a claim. The raw payload sits beside
# evidence.json so a third party can audit the review itself.
if grep -q 'llm-review.json' "$VERIFY"; then
    ok "the raw judge payload is written beside the evidence document"
else
    bad "only a summary is kept; the review cannot be independently checked"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
