#!/usr/bin/env bash
# `report cost` must not contradict its own budget state file.
#
# THE DEFECT. The budget block read only the CAP from .loki/metrics/budget.json
# and then overwrote spend with the current run's figure, which is None when no
# iteration has a measured cost. It fell back to 0.0 and printed
# "Used: $0.00 (0.0%) ... Status: OK" over a file reading
# "budget_used": 0.7992, "exceeded": true -- while `loki status` showed 160%.
#
# The --json surface is the sharp end: it asserted "exceeded": false, and that
# is what automation gates on. A product whose thesis is "no false greens"
# printed a green over its own red data.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-report-cost-budget"

# The exact live condition: an exceeded budget and NO efficiency records, so
# the current-run cost is unmeasured.
mkdir -p "$WORK/metrics"
cat > "$WORK/metrics/budget.json" <<'EOF'
{"limit":0.5,"budget_limit":0.5,"budget_used":0.7992,"exceeded":true}
EOF

jq_budget() {
    LOKI_DIR="$WORK" bash "$REPO_ROOT/autonomy/loki" report cost --json 2>/dev/null \
        | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('PARSE_FAIL'); raise SystemExit(0)
b = d.get('budget') or {}
print('%s|%s|%s' % (b.get('used'), b.get('status'), b.get('exceeded')))
"
}

B="$(jq_budget)"
USED="${B%%|*}"; REST="${B#*|}"; STATUS="${REST%%|*}"; EXC="${REST#*|}"

# 1. The recorded spend, not a fabricated zero.
if [ "$USED" = "0.7992" ]; then
    pass "json used reports the recorded spend (0.7992), not 0.0"
else
    fail "json used = $USED, expected 0.7992 (the file's budget_used)"
fi

# 2/3. Status and the machine-readable boolean must both say exceeded. The
#      boolean is what a CI gate reads, so it gets its own assertion.
if [ "$STATUS" = "exceeded" ]; then
    pass "json status is exceeded"
else
    fail "json status = $STATUS, expected exceeded"
fi
if [ "$EXC" = "True" ] || [ "$EXC" = "true" ]; then
    pass "json exceeded is true (the flag automation gates on)"
else
    fail "json exceeded = $EXC, expected true"
fi

# 4. CROSS-SURFACE AGREEMENT. Neither surface alone proves one source of truth.
SOUT="$(LOKI_DIR="$WORK" bash "$REPO_ROOT/autonomy/loki" status 2>/dev/null || true)"
if printf '%s' "$SOUT" | grep -q '160%'; then
    pass "loki status agrees with report cost (both ~160%)"
else
    fail "loki status disagrees: $(printf '%s' "$SOUT" | grep -i budget | head -1)"
fi

# 5. The unmeasured-current-run contract must survive. `loki cost --help`
#    promises "Unmeasured is never reported as \$0.00" -- the fix must not
#    trade one false green for another.
HOUT="$(LOKI_DIR="$WORK" bash "$REPO_ROOT/autonomy/loki" report cost 2>&1 || true)"
if printf '%s' "$HOUT" | grep -q 'Cost not recorded for this run'; then
    pass "unmeasured current-run cost is still reported as not recorded"
else
    fail "lost the 'Cost not recorded' contract"
fi

# 6. Exit code must stay 0: tests/cli/test-alias-forwarding.sh asserts parity.
rc=0
LOKI_DIR="$WORK" bash "$REPO_ROOT/autonomy/loki" report cost >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
    pass "report cost still exits 0 when the budget is exceeded"
else
    fail "report cost exit code changed to $rc (breaks alias parity)"
fi

# 7. A budget file with NO recorded spend must not invent one.
mkdir -p "$WORK/nb/metrics"
echo '{"limit":1.0,"budget_limit":1.0}' > "$WORK/nb/metrics/budget.json"
NB="$(LOKI_DIR="$WORK/nb" bash "$REPO_ROOT/autonomy/loki" report cost --json 2>/dev/null \
    | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('PARSE_FAIL'); raise SystemExit(0)
b=d.get('budget') or {}
print('%s|%s' % (b.get('used'), b.get('exceeded')))
")"
if [ "${NB%%|*}" = "0.0" ] || [ "${NB%%|*}" = "0" ]; then
    pass "absent budget_used falls back without claiming an overrun"
else
    fail "absent budget_used produced used=${NB%%|*}"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
