#!/usr/bin/env bash
#
# Test Cross-Project Learning Feature End-to-End
# Tests: CLI, API, and Dashboard integration
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOKI_CLI="${PROJECT_ROOT}/autonomy/loki"
API_URL="http://localhost:57374"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    echo -e "${GREEN}PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

skip() {
    echo -e "${YELLOW}SKIP${NC}: $1"
}

echo "================================="
echo "Cross-Project Learning Tests"
echo "================================="
echo ""

# Helper to strip ANSI codes
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

# Test 1: CLI memory list command
echo "Test 1: CLI memory list"
if "$LOKI_CLI" memory list 2>/dev/null | strip_ansi | grep -q "Cross-Project Learnings"; then
    pass "CLI memory list command works"
else
    fail "CLI memory list command failed"
fi

# Test 2: CLI memory stats command
echo "Test 2: CLI memory stats"
if "$LOKI_CLI" memory stats 2>/dev/null | strip_ansi | grep -q "By Category"; then
    pass "CLI memory stats command works"
else
    fail "CLI memory stats command failed"
fi

# Test 3: CLI memory show command
echo "Test 3: CLI memory show mistakes"
if "$LOKI_CLI" memory show mistakes --limit 1 2>/dev/null | strip_ansi | grep -q "Mistakes\|No mistakes"; then
    pass "CLI memory show command works"
else
    fail "CLI memory show command failed"
fi

# Test 4: CLI memory search command
echo "Test 4: CLI memory search"
if "$LOKI_CLI" memory search "test" 2>/dev/null | strip_ansi | grep -q "Search Results\|No results"; then
    pass "CLI memory search command works"
else
    fail "CLI memory search command failed"
fi

# Test 5: CLI memory export command
echo "Test 5: CLI memory export"
EXPORT_FILE="/tmp/loki-learnings-test-$$.json"
if "$LOKI_CLI" memory export "$EXPORT_FILE" 2>/dev/null && [ -f "$EXPORT_FILE" ]; then
    if grep -q "patterns\|mistakes\|successes" "$EXPORT_FILE"; then
        pass "CLI memory export command works"
        rm -f "$EXPORT_FILE"
    else
        fail "CLI memory export output invalid"
    fi
else
    fail "CLI memory export command failed"
fi

# Test 6: API health check
echo "Test 6: API health endpoint"
if curl -s "$API_URL/health" 2>/dev/null | grep -q '"status":"ok"'; then
    pass "API health endpoint works"
else
    skip "API server not running"
fi

# Test 7: API memory summary
echo "Test 7: API /memory endpoint"
MEMORY_RESPONSE=$(curl -s "$API_URL/memory" 2>/dev/null || echo "")
if echo "$MEMORY_RESPONSE" | grep -q '"patterns"\|"mistakes"\|"successes"'; then
    pass "API /memory endpoint works"
else
    skip "API /memory endpoint not available"
fi

# Test 8: API memory stats
echo "Test 8: API /memory/stats endpoint"
STATS_RESPONSE=$(curl -s "$API_URL/memory/stats" 2>/dev/null || echo "")
if echo "$STATS_RESPONSE" | grep -q '"byCategory"\|"byProject"'; then
    pass "API /memory/stats endpoint works"
else
    skip "API /memory/stats endpoint not available"
fi

# Test 9: API memory search
echo "Test 9: API /memory/search endpoint"
SEARCH_RESPONSE=$(curl -s "$API_URL/memory/search?q=test" 2>/dev/null || echo "")
if echo "$SEARCH_RESPONSE" | grep -q '"query":"test"'; then
    pass "API /memory/search endpoint works"
else
    skip "API /memory/search endpoint not available"
fi

# Test 10: API memory type endpoint
echo "Test 10: API /memory/mistakes endpoint"
TYPE_RESPONSE=$(curl -s "$API_URL/memory/mistakes?limit=1" 2>/dev/null || echo "")
if echo "$TYPE_RESPONSE" | grep -q '"type":"mistakes"'; then
    pass "API /memory/mistakes endpoint works"
else
    skip "API /memory/mistakes endpoint not available"
fi

# Test 11: Learnings directory structure
echo "Test 11: Learnings directory structure"
LEARNINGS_DIR="${HOME}/.loki/learnings"
if [ -d "$LEARNINGS_DIR" ]; then
    pass "Learnings directory exists at $LEARNINGS_DIR"
else
    fail "Learnings directory not found"
fi

# Test 12: JSONL file format
echo "Test 12: JSONL file format"
if [ -f "$LEARNINGS_DIR/mistakes.jsonl" ]; then
    if head -1 "$LEARNINGS_DIR/mistakes.jsonl" | python3 -m json.tool >/dev/null 2>&1; then
        pass "JSONL format is valid"
    else
        fail "JSONL format invalid"
    fi
else
    skip "No mistakes.jsonl file to test"
fi

# Tests 13-14: the cross-project learnings SURFACE.
#
# These two used to grep autonomy/.loki/dashboard/index.html for the markers
# 'learnings-patterns', 'learnings-mistakes', 'learnings-successes',
# 'fetchLearnings' and an API_URL literal. That file was deleted in a451fb02
# and is not tracked in git; those four markers now appear NOWHERE in the repo
# except in this test. So both assertions failed against a UI that no longer
# exists, and `grep` on a missing file reports the failure without ever saying
# the file was gone.
#
# The feature itself did not disappear -- it moved to the dashboard API. These
# assert the surface that exists rather than resurrecting markers for a removed
# page, and they name the file they read so a future move fails loudly.
echo "Test 13: cross-project learnings API endpoint"
SERVER_PY="${PROJECT_ROOT}/dashboard/server.py"
if [ ! -f "$SERVER_PY" ]; then
    fail "dashboard/server.py not found at $SERVER_PY"
elif grep -q '"/api/registry/learnings"' "$SERVER_PY" \
     && grep -q 'get_cross_project_learnings' "$SERVER_PY"; then
    pass "dashboard exposes /api/registry/learnings backed by get_cross_project_learnings"
else
    fail "dashboard/server.py no longer exposes the cross-project learnings endpoint"
fi

# Test 14: the endpoint must be read-scoped, not public. A learnings store is
# cross-PROJECT, so an unauthenticated read leaks one project's history to
# another; that is the property worth pinning, not a hardcoded port literal.
#
# Matched as ONE exact decorator line, not as "path near scope". A windowed
# match (grep -A1) can pick up a NEIGHBOURING endpoint's guard and report this
# endpoint as protected while it is bare -- the same slack the repo's packaging
# rule warns about: assert the required thing individually, never a proximity
# or a count.
echo "Test 14: learnings endpoint requires the read scope"
if grep -q '@app.get("/api/registry/learnings", dependencies=\[Depends(auth.require_scope("read"))\])' "$SERVER_PY"; then
    pass "learnings endpoint is guarded by require_scope(\"read\")"
else
    fail "learnings endpoint is not scope-guarded"
fi

echo ""
echo "================================="
echo "Test Results"
echo "================================="
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi
