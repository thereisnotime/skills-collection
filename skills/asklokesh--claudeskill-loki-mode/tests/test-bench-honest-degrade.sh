#!/usr/bin/env bash
# L4 finding: loki bench must degrade HONESTLY on a packaged install (where the
# benchmarks/ harness is intentionally excluded by .npmignore), not emit a bare
# "not found" that reads like a broken install. Mirrors the cmd_report dogfood
# honest-degradation contract.
set -uo pipefail
LOKI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/autonomy/loki"
passed=0; failed=0
ok(){ echo "  [PASS] $1"; passed=$((passed+1)); }
bad(){ echo "  [FAIL] $1"; failed=$((failed+1)); }

# Simulate a packaged install: a SKILL_DIR with NO benchmarks/ harness.
TMP=$(mktemp -d)
out=$(SKILL_DIR="$TMP" bash "$LOKI" bench list 2>&1); rc=$?

# 1. Must NOT return a failure code (honest degradation, not a crash).
[ "$rc" -eq 0 ] && ok "rc=0 (honest degrade, not a broken-install error)" || bad "rc=$rc (expected 0)"
# 2. Must NOT say the bare "harness not found" that reads like a bug.
if printf '%s' "$out" | grep -qi 'not found'; then bad "still emits a bare 'not found'"; else ok "no bare 'not found'"; fi
# 3. Must explain it is a dev/research feature + how to run it from source.
printf '%s' "$out" | grep -qi 'not available in this install' && ok "explains unavailable in this install" || bad "missing honest explanation"
printf '%s' "$out" | grep -q 'run-benchmarks.sh' && ok "points to the source-checkout command" || bad "missing run instructions"

rm -rf "$TMP"
echo ""
echo "Results: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
