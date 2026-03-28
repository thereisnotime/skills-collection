#!/usr/bin/env bash
# shellcheck disable=SC2034  # Variables may be unused in test context
# shellcheck disable=SC2155  # Declare and assign separately
# shellcheck disable=SC2329  # Unreachable code in test functions
# Test: JSON PRD Support
# Tests JSON PRD auto-detection and complexity analysis

set -uo pipefail

TEST_DIR=$(mktemp -d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SCRIPT="$SCRIPT_DIR/../autonomy/run.sh"
PASSED=0
FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAILED++)); }
log_test() { echo -e "${YELLOW}[TEST]${NC} $1"; }

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

cd "$TEST_DIR" || exit 1

echo "=========================================="
echo "JSON PRD Support Tests"
echo "=========================================="
echo ""

# Test 1: Verify JSON patterns exist in auto-detection
log_test "JSON patterns exist in PRD auto-detection"
if grep -q 'PRD.json\|prd.json' "$RUN_SCRIPT" && grep -q 'requirements.json' "$RUN_SCRIPT"; then
    log_pass "JSON patterns found in auto-detection"
else
    log_fail "JSON patterns not found in auto-detection"
fi

# Test 2: Verify JSON complexity analysis code exists
log_test "JSON complexity analysis code exists"
if grep -q 'prd_path.*\.json' "$RUN_SCRIPT" && grep -q 'jq' "$RUN_SCRIPT"; then
    log_pass "JSON complexity analysis code found"
else
    log_fail "JSON complexity analysis code not found"
fi

# Test 3: Verify generated-prd.json fallback exists
log_test "generated-prd.json fallback exists"
if grep -q 'generated-prd.json' "$RUN_SCRIPT"; then
    log_pass "generated-prd.json fallback found"
else
    log_fail "generated-prd.json fallback not found"
fi

# Test 4: JSON PRD complexity - simple (few features)
log_test "JSON PRD complexity detection - simple"
cat > "$TEST_DIR/simple-prd.json" << 'EOF'
{
  "title": "Simple App",
  "features": [
    {"name": "Login", "description": "User login"}
  ]
}
EOF

if command -v jq &>/dev/null; then
    feature_count=$(jq '
        [.features, .requirements, .tasks, .user_stories, .epics] |
        map(select(. != null) | if type == "array" then length else 0 end) |
        add // 0
    ' "$TEST_DIR/simple-prd.json" 2>/dev/null || echo "0")

    if [ "$feature_count" -eq 1 ]; then
        log_pass "Simple PRD feature count correct: $feature_count"
    else
        log_fail "Simple PRD feature count wrong: expected 1, got $feature_count"
    fi
else
    log_pass "jq not available, skipping (fallback grep used)"
fi

# Test 5: JSON PRD complexity - complex (many features)
log_test "JSON PRD complexity detection - complex"
cat > "$TEST_DIR/complex-prd.json" << 'EOF'
{
  "title": "Complex Enterprise App",
  "features": [
    {"name": "Auth", "description": "OAuth2 + SAML"},
    {"name": "Dashboard", "description": "Analytics"},
    {"name": "Reports", "description": "PDF export"},
    {"name": "API", "description": "REST + GraphQL"},
    {"name": "Webhooks", "description": "Event system"},
    {"name": "Billing", "description": "Stripe integration"},
    {"name": "Teams", "description": "Multi-tenant"},
    {"name": "Audit", "description": "Compliance logging"}
  ],
  "requirements": [
    {"name": "Performance", "description": "Sub-100ms"},
    {"name": "Security", "description": "SOC2"},
    {"name": "Scale", "description": "10k concurrent"},
    {"name": "Uptime", "description": "99.99%"},
    {"name": "Mobile", "description": "iOS + Android"},
    {"name": "i18n", "description": "10 languages"},
    {"name": "A11y", "description": "WCAG 2.1"},
    {"name": "Analytics", "description": "Real-time"}
  ]
}
EOF

if command -v jq &>/dev/null; then
    feature_count=$(jq '
        [.features, .requirements, .tasks, .user_stories, .epics] |
        map(select(. != null) | if type == "array" then length else 0 end) |
        add // 0
    ' "$TEST_DIR/complex-prd.json" 2>/dev/null || echo "0")

    if [ "$feature_count" -gt 15 ]; then
        log_pass "Complex PRD feature count triggers complex tier: $feature_count"
    else
        log_fail "Complex PRD feature count should be > 15, got $feature_count"
    fi
else
    log_pass "jq not available, skipping (fallback grep used)"
fi

# Test 6: Fallback grep pattern for JSON without jq
log_test "Fallback grep pattern works"
fallback_count=$(grep -c '"title"\|"name"\|"feature"\|"requirement"' "$TEST_DIR/complex-prd.json" 2>/dev/null || echo "0")
if [ "$fallback_count" -gt 0 ]; then
    log_pass "Fallback grep found $fallback_count feature indicators"
else
    log_fail "Fallback grep found no features"
fi

# Test 7: JSON PRD file patterns in search order
log_test "JSON PRD patterns in correct search order"
# Verify .md comes before .json (prefer markdown)
if grep -A5 'Search common PRD file patterns' "$RUN_SCRIPT" | grep -q '"PRD.md".*"PRD.json"'; then
    log_pass "Markdown PRDs searched before JSON (correct priority)"
else
    log_fail "Search order may be wrong - check pattern order"
fi

# Test 8: docs/ JSON patterns exist
log_test "docs/ JSON patterns exist"
if grep -q 'docs/PRD.json\|docs/prd.json' "$RUN_SCRIPT"; then
    log_pass "docs/ JSON patterns found"
else
    log_fail "docs/ JSON patterns not found"
fi

echo ""
echo "=========================================="
echo "Results: $PASSED passed, $FAILED failed"
echo "=========================================="

exit $FAILED
