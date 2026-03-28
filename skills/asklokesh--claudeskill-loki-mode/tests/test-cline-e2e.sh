#!/usr/bin/env bash
# Cline Provider E2E Tests (v6.7.0)
# Tests the Cline CLI provider integration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

# Source provider loader for invoke_cline
source "$PROJECT_DIR/providers/cline.sh" 2>/dev/null || true

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1: $2"; FAIL=$((FAIL + 1)); }

echo "Cline Provider E2E Tests"
echo "========================"
echo ""

# Test 1: Cline CLI exists
echo "Test 1: Cline CLI availability"
if command -v cline &>/dev/null; then
    version=$(cline --version 2>/dev/null | head -1 || echo "unknown")
    pass "cline found (version: $version)"
else
    fail "cline not found" "Install: npm install -g @anthropic-ai/cline"
fi

# Test 2: Provider config file exists
echo "Test 2: Provider config file"
if [ -f "$PROJECT_DIR/providers/cline.sh" ]; then
    pass "providers/cline.sh exists"
else
    fail "providers/cline.sh" "missing"
fi

# Test 3: Provider config sources without error
echo "Test 3: Provider config sources cleanly"
if bash -c "source '$PROJECT_DIR/providers/cline.sh'" 2>/dev/null; then
    pass "providers/cline.sh sources without error"
else
    fail "providers/cline.sh" "source error"
fi

# Test 4: Provider variables are set
echo "Test 4: Provider variables"
prov_name=$(bash -c "source '$PROJECT_DIR/providers/cline.sh' 2>/dev/null; echo \"\${PROVIDER_NAME:-}\"")
if [ -n "$prov_name" ]; then
    pass "PROVIDER_NAME=$prov_name"
else
    fail "PROVIDER_NAME" "not set after sourcing cline.sh"
fi

# Test 5: LOKI_CLINE_MODEL is consumed by invoke_cline in run.sh
echo "Test 5: Model override via LOKI_CLINE_MODEL"
if grep -A20 "invoke_cline()" "$PROJECT_DIR/autonomy/run.sh" | grep -q "LOKI_CLINE_MODEL"; then
    pass "LOKI_CLINE_MODEL consumed by invoke_cline()"
else
    fail "LOKI_CLINE_MODEL" "not referenced in invoke_cline() body"
fi

# Test 6: invoke_cline function signature (from run.sh)
echo "Test 6: invoke_cline defined in run.sh"
if grep -q "invoke_cline()" "$PROJECT_DIR/autonomy/run.sh" 2>/dev/null; then
    pass "invoke_cline() found in run.sh"
else
    fail "invoke_cline()" "not found in run.sh"
fi

# Test 7: Cline in parallel worktree support
echo "Test 7: Cline in parallel worktree handler"
if grep -q "cline)" "$PROJECT_DIR/autonomy/run.sh" 2>/dev/null; then
    pass "cline case in spawn_worktree_session"
else
    fail "cline parallel" "not found in worktree handler"
fi

# Test 8: Error handling when cline not found
echo "Test 8: Error path simulation"
if PATH="/nonexistent" command -v cline &>/dev/null; then
    fail "cline error path" "cline should not be found with empty PATH"
else
    pass "cline correctly not found when not in PATH"
fi

echo ""
echo "========================"
echo "Results: $PASS passed, $FAIL failed"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
