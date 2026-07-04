#!/usr/bin/env bash
# test-scaffold-hook.sh -- the opt-in seam that wires M1-M3 into the build lane.
#
# Proves the four invariants that make this a SAFE additive wiring:
#   1. flag OFF  -> no-op (default build path byte-identical / unaffected)
#   2. flag ON + greenfield + REST PRD -> lays down the contract-first skeleton
#   3. flag ON + brownfield (existing code) -> SKIPS (never overwrites)
#   4. flag ON + greenfield but no derivable resource -> skips (conservative)
#
# General: throwaway resources, no PRD-specific knowledge.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SCRIPT_DIR="$REPO_ROOT/autonomy"
HOOK="$SCRIPT_DIR/lib/scaffold-hook.sh"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

[ -f "$HOOK" ] || { echo "FAIL: scaffold-hook.sh missing"; exit 1; }
bash -n "$HOOK" && pass "scaffold-hook.sh has valid syntax" || fail "syntax error"
# The wiring in run.sh must be additive + opt-in and must NOT touch build_prompt.
bash -n "$SCRIPT_DIR/run.sh" && pass "run.sh still has valid syntax after wiring" || fail "run.sh syntax error"

# shellcheck disable=SC1090
source "$HOOK"
log_info() { :; }  # silence hook logging in the test

# 1. Flag OFF -> no-op.
D="$(mktemp -d)"; echo "GET /api/tasks" > "$D/PRD.md"
LOKI_SCAFFOLD_CONTRACT_FIRST=0 run_contract_scaffold_hook "$D" "$D/PRD.md" >/dev/null 2>&1
n=$(find "$D" -type f -not -name PRD.md | wc -l | tr -d ' ')
[ "$n" = "0" ] && pass "flag OFF -> no files scaffolded (default path unaffected)" \
  || fail "flag OFF created $n files (should be 0)"
rm -rf "$D"

# 2. Flag ON + greenfield + REST PRD -> scaffolds.
D="$(mktemp -d)"; echo "Task API. GET /api/tasks, POST /api/tasks, DELETE /api/tasks/:id." > "$D/PRD.md"
LOKI_SCAFFOLD_CONTRACT_FIRST=1 run_contract_scaffold_hook "$D" "$D/PRD.md" >/dev/null 2>&1
if [ -f "$D/openapi.yaml" ] && [ -f "$D/server/index.mjs" ] && [ -f "$D/src/theme.css" ]; then
  pass "flag ON + greenfield -> contract + backend + design skeleton laid down"
else
  fail "flag ON + greenfield did not scaffold (openapi=$( [ -f "$D/openapi.yaml" ] && echo y || echo n ))"
fi
rm -rf "$D"

# 3. Flag ON + brownfield -> skips (never overwrites existing code).
D="$(mktemp -d)"; mkdir -p "$D/src"; echo "existing" > "$D/src/app.js"; echo "GET /api/tasks" > "$D/PRD.md"
before=$(find "$D" -type f | wc -l | tr -d ' ')
LOKI_SCAFFOLD_CONTRACT_FIRST=1 run_contract_scaffold_hook "$D" "$D/PRD.md" >/dev/null 2>&1
after=$(find "$D" -type f | wc -l | tr -d ' ')
[ "$before" = "$after" ] && pass "flag ON + brownfield -> skipped (existing code untouched)" \
  || fail "brownfield changed ($before -> $after)"
rm -rf "$D"

# 4. Flag ON + greenfield but no REST resource -> conservative skip.
D="$(mktemp -d)"; echo "A static marketing page with a hero." > "$D/PRD.md"
LOKI_SCAFFOLD_CONTRACT_FIRST=1 run_contract_scaffold_hook "$D" "$D/PRD.md" >/dev/null 2>&1
n=$(find "$D" -type f -not -name PRD.md | wc -l | tr -d ' ')
[ "$n" = "0" ] && pass "flag ON + no derivable resource -> skipped (conservative)" \
  || fail "scaffolded $n files with no derivable resource"
rm -rf "$D"

echo "----------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
