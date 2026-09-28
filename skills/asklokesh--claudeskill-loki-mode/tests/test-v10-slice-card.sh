#!/usr/bin/env bash
# tests/test-v10-slice-card.sh -- S-77: the slice-card template in
# docs/v10/SWARM.md must exist, stay at or under 60 lines, and carry every
# required field (goal, file set, Wall checks, commands, budget, tier,
# model). Also checks the binding dispatch-from-the-card rule is stated.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so a mutation copy can be pointed at without touching the
# real file (loki-verify: mutate a copy, never the file under test).
SWARM_MD="${SWARM_MD:-$REPO_ROOT/docs/v10/SWARM.md}"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

if [ ! -f "$SWARM_MD" ]; then
    bad "SWARM.md not found at $SWARM_MD"
    printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
    exit 1
fi

START_MARK='<!-- SLICE-CARD-TEMPLATE:START -->'
END_MARK='<!-- SLICE-CARD-TEMPLATE:END -->'

if grep -qF "$START_MARK" "$SWARM_MD" && grep -qF "$END_MARK" "$SWARM_MD"; then
    ok "slice-card template markers present"
else
    bad "slice-card template markers missing from $SWARM_MD"
fi

TEMPLATE="$(awk -v s="$START_MARK" -v e="$END_MARK" '
    $0 == s { f=1; next }
    $0 == e { f=0 }
    f { print }
' "$SWARM_MD")"

if [ -z "$TEMPLATE" ]; then
    bad "slice-card template body is empty"
else
    ok "slice-card template body is non-empty"
fi

LINE_COUNT="$(printf '%s\n' "$TEMPLATE" | grep -c .)"
if [ "$LINE_COUNT" -le 60 ]; then
    ok "slice-card template is $LINE_COUNT lines (budget: 60 or fewer)"
else
    bad "slice-card template is $LINE_COUNT lines, over the 60-line budget"
fi

for field in "Goal:" "Files:" "Wall checks:" "Commands:" "Budget:" "Tier:" "Model:"; do
    if printf '%s\n' "$TEMPLATE" | grep -qF "$field"; then
        ok "template has a '$field' field"
    else
        bad "template is missing a '$field' field"
    fi
done

if grep -qi "dispatches every builder and reviewer from a slice" "$SWARM_MD" \
    && grep -qF "docs/v10/CONTROL.md" "$SWARM_MD" \
    && grep -qF "docs/v10/BOARD.md" "$SWARM_MD" \
    && grep -qi "pulse block" "$SWARM_MD"; then
    ok "binding dispatch-from-the-card rule and live-view scope are stated"
else
    bad "binding dispatch-from-the-card rule or live-view scope wording missing"
fi

echo
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
