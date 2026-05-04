#!/usr/bin/env bash
#===============================================================================
# Integration test: autonomy/lib/sentrux-gate.sh against the REAL sentrux binary.
#
# Skips with PASS if sentrux is not on PATH -- we ship the helper as opt-in,
# so users without the binary should not see CI failures.
#
# When sentrux IS available, this test:
#   1. Builds a tiny TypeScript fixture project,
#   2. Calls sentrux_baseline_save to write .sentrux/baseline.json,
#   3. Reads the baseline quality back via sentrux_baseline_quality,
#   4. Calls sentrux_gate_diff on the same project (expects OK verdict),
#   5. Adds a structural-degradation pattern (b.ts becomes a hub with 8 imports),
#   6. Calls sentrux_gate_diff again and asserts the verdict is DEGRADED with
#      after < before.
#
# This test exists because unit tests stub the binary; real sentrux output
# format is the contract that ships, so we verify it directly.
#===============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$REPO_ROOT/autonomy/lib/sentrux-gate.sh"

PASS=0
FAIL=0
TMPROOT=""

ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup() {
    if [ -n "$TMPROOT" ] && [ -d "$TMPROOT" ]; then
        rm -rf "$TMPROOT"
    fi
}
trap cleanup EXIT

#-------------------------------------------------------------------------------
# Skip cleanly if sentrux is not installed -- this matches how the helper
# behaves at runtime (no-op when binary missing).
#-------------------------------------------------------------------------------
if ! command -v sentrux >/dev/null 2>&1; then
    ok "SKIP: sentrux not on PATH (helper is opt-in; this is the documented mode)"
    echo
    echo "=========================================="
    echo "Total: 1  Passed: 1  Failed: 0  (skipped real binary)"
    echo "=========================================="
    exit 0
fi

# shellcheck disable=SC1090
. "$HELPER"

#-------------------------------------------------------------------------------
# Step 1: build a TS fixture and save a baseline.
#-------------------------------------------------------------------------------
TMPROOT=$(mktemp -d -t loki-sentrux-real.XXXXXX)
PROJ="$TMPROOT/proj"
mkdir -p "$PROJ/src"
echo 'export const a = 1;' > "$PROJ/src/a.ts"
echo 'import { a } from "./a"; console.log(a);' > "$PROJ/src/b.ts"

if sentrux_baseline_save "$PROJ"; then
    ok "real sentrux: baseline_save succeeded on a 2-file fixture"
else
    bad "real sentrux: baseline_save failed unexpectedly"
fi

if [ -f "$PROJ/.sentrux/baseline.json" ]; then
    ok "real sentrux: baseline.json written at expected location"
else
    bad "real sentrux: baseline.json missing after save"
fi

q_before=$(sentrux_baseline_quality "$PROJ")
if [ -n "$q_before" ] && [ "$q_before" -ge 0 ] 2>/dev/null && [ "$q_before" -le 10000 ] 2>/dev/null; then
    ok "real sentrux: baseline_quality returned plausible int [$q_before] in [0,10000]"
else
    bad "real sentrux: baseline_quality returned implausible value [$q_before]"
fi

#-------------------------------------------------------------------------------
# Step 2: gate against the same fixture (no edits) -- expect OK.
#-------------------------------------------------------------------------------
diff_unchanged=$(sentrux_gate_diff "$PROJ")
verdict=$(printf '%s' "$diff_unchanged" | awk -F'|' '{print $3}')
if [ "$verdict" = "OK" ]; then
    ok "real sentrux: unchanged fixture parses to OK verdict (got [$diff_unchanged])"
else
    bad "real sentrux: expected OK on unchanged fixture, got [$diff_unchanged]"
fi

#-------------------------------------------------------------------------------
# Step 3: introduce structural degradation -- b.ts becomes an import hub.
#-------------------------------------------------------------------------------
for i in 1 2 3 4 5 6 7 8; do
    echo "import { a } from \"./a\"; export const y${i} = a + ${i};" > "$PROJ/src/file${i}.ts"
    echo "import { y${i} } from \"./file${i}\";" >> "$PROJ/src/b.ts"
done

diff_degraded=$(sentrux_gate_diff "$PROJ")
verdict=$(printf '%s' "$diff_degraded" | awk -F'|' '{print $3}')
before=$(printf '%s' "$diff_degraded" | awk -F'|' '{print $1}')
after=$(printf '%s' "$diff_degraded" | awk -F'|' '{print $2}')

if [ "$verdict" = "DEGRADED" ]; then
    ok "real sentrux: hub-pattern fixture parses to DEGRADED verdict"
else
    bad "real sentrux: expected DEGRADED after hub pattern, got verdict=[$verdict] full=[$diff_degraded]"
fi

if [ -n "$before" ] && [ -n "$after" ] && [ "$after" -lt "$before" ] 2>/dev/null; then
    ok "real sentrux: after ($after) < before ($before) on degradation"
else
    bad "real sentrux: expected after < before; got before=[$before] after=[$after]"
fi

echo
echo "=========================================="
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
echo "=========================================="
[ "$FAIL" -eq 0 ]
