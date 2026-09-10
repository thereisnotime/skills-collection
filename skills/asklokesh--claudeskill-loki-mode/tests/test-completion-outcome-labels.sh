#!/usr/bin/env bash
# Every terminal outcome must have a human label, and force-approval must not
# be dressed up as approval.
#
# WHY THIS EXISTS. build_completion_summary's label case handled only
# complete|max_iterations|stopped|failed|intervention. Five real outcomes fell
# through to `*) outcome_label="$outcome"`, so the headline a user reads at the
# end of a run was the raw enum: "council_force_approved", "max_duration",
# "inconclusive_spec_contradiction". That is the single moment a user decides
# whether to trust the build, and it was showing them an internal identifier.
#
# The worst case was council_force_approved: a FORCE-approved run and a
# genuinely council-approved run both rendered as "Completed". On a product
# whose entire claim is a receipt you can check yourself, collapsing that
# distinction is the most expensive possible place to be imprecise.
#
# This test derives the outcome list from the CALL SITES, not from a hardcoded
# copy, so a newly-introduced outcome fails here instead of silently shipping as
# a raw enum.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- every literal outcome at a call site has a label arm"

# Literal (non-variable) outcomes passed to either summary function. Filtered to
# plausible enum shapes so prose inside comments cannot masquerade as an outcome.
outcomes=$(grep -ohE '(emit|build)_completion_summary [a-z_]+' "$RUN_SH" \
           | awk '{print $2}' | sort -u)

# Words that appear in comment prose after the function name, not real outcomes.
NOISE=" because diff folds just so "

missing=""
checked=0
for o in $outcomes; do
    case "$NOISE" in *" $o "*) continue ;; esac
    checked=$((checked + 1))
    if ! grep -qE "^ *${o}\)" "$RUN_SH"; then
        missing="$missing $o"
    fi
done

if [ "$checked" -lt 5 ]; then
    bad "only $checked outcomes discovered -- the extraction broke, which would make this test vacuous"
else
    ok "discovered $checked outcomes from call sites"
fi

if [ -z "$missing" ]; then
    ok "every discovered outcome has a case arm"
else
    bad "outcomes with no label arm (would render as a raw enum):$missing"
fi

echo
echo "T2 -- force-approval is not labelled as plain completion"

# The label must exist AND must not be the same string as a clean completion.
if grep -qE '^ *council_force_approved\)' "$RUN_SH"; then
    ok "council_force_approved has its own arm"
    # Read the LABEL VALUE, not the surrounding lines. An earlier version of
    # this check grepped a 2-line window for "force" and matched the explanatory
    # COMMENT above the arm, so it stayed green when the label itself was
    # changed back to plain "Completed" -- the exact regression it exists to catch.
    _cfa_label=$(grep -A2 '^ *council_force_approved)' "$RUN_SH" \
                 | grep -oE 'outcome_label="[^"]*"' | head -1 \
                 | sed 's/^outcome_label="//; s/"$//')
    if [ -z "$_cfa_label" ]; then
        bad "could not read council_force_approved's label value -- an empty read is not a pass"
    elif printf '%s' "$_cfa_label" | grep -qi 'force'; then
        ok "its label says force-approved rather than plain 'Completed' ($_cfa_label)"
    else
        bad "council_force_approved renders as '$_cfa_label' -- indistinguishable from a real approval"
    fi
else
    bad "council_force_approved has no arm; a forced run reads as a clean completion"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
