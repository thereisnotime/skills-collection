#!/usr/bin/env bash
# `loki cost` must not put 0.0 in place of unknown spend (BACKLOG 106, S-179).
#
# THE DEFECT. cmd_cost fell back to `budget_used = 0.0` when nothing was
# measured, against its own "never substitute 0.0 for unknown" comment. And
# budget.json always carries budget_used, because run.sh check_budget_limit
# writes "budget_used": 0 for a run it never measured, so a recorded zero is no
# measurement either. A cap of 10 over an unmeasured run printed
# "Used: $0.00 (0.0%) Status: OK" and --json said used 0.0, percent 0.0.
#
# THE RULE (same as dashboard/server.py budget readers): a positive recorded
# budget_used counts; otherwise spend comes from collect_efficiency, which is
# None unless a record passes record_is_measured. Unknown stays null.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"
export LOKI_NO_BROWSER=1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-cost-unmeasured.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "test-loki-cost-unmeasured"

# $1=loki dir; prints used|percent_used|status|exceeded
budget_fields() {
    (cd "$WORK" && env -u LOKI_BUDGET_LIMIT LOKI_DIR="$1" "${@:2}" bash "$LOKI" cost --json 2>/dev/null) \
        | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('PARSE_FAIL'); raise SystemExit(0)
b = d.get('budget') or {}
f = lambda v: 'null' if v is None else str(v)
print('|'.join(f(b.get(k)) for k in ('used', 'percent_used', 'status', 'exceeded')))
"
}

# --- 1. cap 10, no measured record: an all-zero efficiency record plus the
#        budget.json run.sh writes for an unmeasured run.
U="$WORK/unmeasured"
mkdir -p "$U/metrics/efficiency"
echo '{"iteration":1,"model":"sonnet","cost_usd":0,"input_tokens":0,"output_tokens":0}' \
    > "$U/metrics/efficiency/iteration-1.json"
echo '{"limit":10,"budget_limit":10,"budget_used":0,"exceeded":false}' > "$U/metrics/budget.json"
R="$(budget_fields "$U")"
if [ "$R" = "null|null|unknown|False" ]; then
    pass "cap 10, unmeasured: used null, percent null (got $R)"
else
    fail "cap 10, unmeasured: expected null|null|unknown|False, got $R"
fi

TXT="$(cd "$WORK" && env -u LOKI_BUDGET_LIMIT LOKI_DIR="$U" bash "$LOKI" cost 2>&1)"
if printf '%s\n' "$TXT" | grep -q 'Used: *not recorded' \
    && ! printf '%s\n' "$TXT" | grep -q 'Used: *\$0\.00'; then
    pass "text view reads 'not recorded', not \$0.00"
else
    fail "text view: $(printf '%s\n' "$TXT" | grep 'Used:')"
fi

# --- 1b. cap from LOKI_BUDGET_LIMIT, no files at all.
E="$WORK/empty"; mkdir -p "$E"
R="$(budget_fields "$E" LOKI_BUDGET_LIMIT=10)"
if [ "$R" = "null|null|unknown|False" ]; then
    pass "env cap 10, no records: used null, percent null (got $R)"
else
    fail "env cap 10, no records: expected null|null|unknown|False, got $R"
fi

# --- 2. measured 2.50 against a cap of 10.
M="$WORK/measured"
mkdir -p "$M/metrics/efficiency"
echo '{"iteration":1,"model":"sonnet","cost_usd":2.5,"input_tokens":1000,"output_tokens":500}' \
    > "$M/metrics/efficiency/iteration-1.json"
echo '{"limit":10,"budget_limit":10,"budget_used":2.5,"exceeded":false}' > "$M/metrics/budget.json"
R="$(budget_fields "$M")"
if [ "$R" = "2.5|25.0|ok|False" ]; then
    pass "measured 2.50: used 2.5, percent 25.0"
else
    fail "measured 2.50: expected 2.5|25.0|ok|False, got $R"
fi

# --- 2b. measured 2.50 while budget.json still holds the unmeasured zero:
#         the measured figure wins over the placeholder.
echo '{"limit":10,"budget_limit":10,"budget_used":0,"exceeded":false}' > "$M/metrics/budget.json"
R="$(budget_fields "$M")"
if [ "$R" = "2.5|25.0|ok|False" ]; then
    pass "measured 2.50 over a recorded 0: used 2.5, percent 25.0"
else
    fail "measured 2.50 over a recorded 0: expected 2.5|25.0|ok|False, got $R"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
