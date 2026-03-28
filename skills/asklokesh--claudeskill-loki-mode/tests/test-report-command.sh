#!/usr/bin/env bash
# Test: loki report command
# Tests the session report generator (v6.27.0)
#
# Note: Not using -e to allow collecting all test results

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKI="$SCRIPT_DIR/../autonomy/loki"
VERSION_FILE="$SCRIPT_DIR/../VERSION"

PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1 -- $2"; ((FAIL++)); }

# Run a CLI command, check exit code and optionally grep for expected output
test_cmd() {
    local desc="$1"
    local expected_exit="$2"
    local pattern="$3"
    shift 3

    ((TOTAL++))

    local output
    local actual_exit=0
    output=$("$LOKI" "$@" 2>&1) || actual_exit=$?

    if [ "$actual_exit" -ne "$expected_exit" ]; then
        log_fail "$desc" "expected exit $expected_exit, got $actual_exit"
        return 0
    fi

    if [ -n "$pattern" ]; then
        if ! echo "$output" | grep -qi "$pattern"; then
            log_fail "$desc" "output missing pattern: $pattern"
            echo "  Actual output (first 5 lines):"
            echo "$output" | head -5 | sed 's/^/    /'
            return 0
        fi
    fi

    log_pass "$desc"
    return 0
}

echo "========================================"
echo "Loki Report Command Tests"
echo "========================================"
echo "CLI: $LOKI"
echo "VERSION: $(cat "$VERSION_FILE")"
echo ""

# Verify the loki script exists and is executable
if [ ! -x "$LOKI" ]; then
    echo -e "${RED}Error: $LOKI not found or not executable${NC}"
    exit 1
fi

# Create a temp dir for isolated testing
TMPDIR_BASE=$(mktemp -d /tmp/loki-test-report-XXXXXX)
ORIG_DIR="$(pwd)"
trap 'cd "$ORIG_DIR"; rm -rf "$TMPDIR_BASE"' EXIT

# -------------------------------------------
# Test 1: Command exists and help shows
# -------------------------------------------
test_cmd "loki report --help exits 0 and shows usage" \
    0 "Usage" report --help

# -------------------------------------------
# Test 2: Help text shows format options
# -------------------------------------------
test_cmd "loki report --help mentions formats" \
    0 "format" report --help

# -------------------------------------------
# Test 3: Report runs without crashing on empty .loki/ dir
# -------------------------------------------
EMPTY_DIR="$TMPDIR_BASE/empty-project"
mkdir -p "$EMPTY_DIR/.loki"
((TOTAL++))
cd "$EMPTY_DIR" || exit 1
output=$("$LOKI" report 2>&1) || true
if [ -n "$output" ]; then
    log_pass "report generates output on empty .loki/ dir"
else
    log_fail "report generates output on empty .loki/ dir" "no output produced"
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Set up mock project for remaining tests
# -------------------------------------------
MOCK_DIR="$TMPDIR_BASE/mock-project"
mkdir -p "$MOCK_DIR/.loki/state"
mkdir -p "$MOCK_DIR/.loki/quality"
mkdir -p "$MOCK_DIR/.loki/queue"
mkdir -p "$MOCK_DIR/.loki/council"
mkdir -p "$MOCK_DIR/.loki/logs"

# Create minimal mock data
echo '{"status":"exited","retryCount":3,"lastRun":"2026-03-07T15:00:00Z","prdPath":"","maxRetries":50}' > "$MOCK_DIR/.loki/autonomy-state.json"
echo '{"version":"6.27.0","currentPhase":"COMPLETE","startedAt":"2026-03-07T14:00:00Z"}' > "$MOCK_DIR/.loki/state/orchestrator.json"
echo '{"tasks_completed":5,"tasks_failed":1,"lines_of_code_added":200,"lines_of_test_added":50}' > "$MOCK_DIR/.loki/state/metrics.json"
echo '{"static_analysis":0,"test_coverage":1,"code_review":0}' > "$MOCK_DIR/.loki/quality/gate-failure-count.json"
echo '{"runner":"jest","pass":true,"timestamp":"2026-03-07T15:00:00Z","min_coverage":80}' > "$MOCK_DIR/.loki/quality/test-results.json"
echo '[]' > "$MOCK_DIR/.loki/state/agents.json"
echo '{}' > "$MOCK_DIR/.loki/config.json"
echo '[]' > "$MOCK_DIR/.loki/queue/completed.json"
echo '[]' > "$MOCK_DIR/.loki/queue/failed.json"
echo '[]' > "$MOCK_DIR/.loki/queue/pending.json"
echo '{}' > "$MOCK_DIR/.loki/council/state.json"

# Init a git repo so git diff does not fail
cd "$MOCK_DIR" || exit 1
git init -q 2>/dev/null
git config user.email "test@test.com" 2>/dev/null
git config user.name "Test" 2>/dev/null
echo "test" > file.txt
git add . 2>/dev/null
git commit -q -m "init" 2>/dev/null
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 4: Markdown format flag works
# -------------------------------------------
((TOTAL++))
cd "$MOCK_DIR" || exit 1
output=$("$LOKI" report --format markdown 2>&1) || true
if echo "$output" | grep -q "^# Loki Mode Session Report"; then
    log_pass "markdown format produces markdown heading"
else
    log_fail "markdown format produces markdown heading" "missing '# Loki Mode Session Report'"
    echo "  First 3 lines:"
    echo "$output" | head -3 | sed 's/^/    /'
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 5: HTML format flag works
# -------------------------------------------
((TOTAL++))
cd "$MOCK_DIR" || exit 1
output=$("$LOKI" report --format html 2>&1) || true
if echo "$output" | grep -q "<!DOCTYPE html>"; then
    log_pass "html format produces valid HTML"
else
    log_fail "html format produces valid HTML" "missing DOCTYPE"
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 6: Output to file flag works
# -------------------------------------------
((TOTAL++))
cd "$MOCK_DIR" || exit 1
outfile="$TMPDIR_BASE/test-output.txt"
"$LOKI" report --output "$outfile" 2>&1 || true
if [ -f "$outfile" ] && [ -s "$outfile" ]; then
    log_pass "output flag saves report to file"
else
    log_fail "output flag saves report to file" "file not created or empty"
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 7: --no-gates flag excludes quality gates section
# -------------------------------------------
((TOTAL++))
cd "$MOCK_DIR" || exit 1
output=$("$LOKI" report --no-gates 2>&1) || true
if echo "$output" | grep -qi "Quality Gates"; then
    log_fail "--no-gates excludes quality gates section" "Quality Gates section still present"
else
    log_pass "--no-gates excludes quality gates section"
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 8: Report has expected sections in text format
# -------------------------------------------
((TOTAL++))
cd "$MOCK_DIR" || exit 1
output=$("$LOKI" report 2>&1) || true
missing=""
for section in "Session Overview" "Executive Summary" "RARV Cycles" "What Changed" "Tests" "Key Decisions"; do
    if ! echo "$output" | grep -qi "$section"; then
        missing="$missing $section"
    fi
done
if [ -z "$missing" ]; then
    log_pass "text report contains all expected sections"
else
    log_fail "text report contains all expected sections" "missing:$missing"
fi
cd "$ORIG_DIR" || exit 1

# -------------------------------------------
# Test 9: Invalid format rejected
# -------------------------------------------
test_cmd "invalid format rejected with error" \
    1 "Unknown format" report --format csv

# -------------------------------------------
# Test 10: Unknown option rejected
# -------------------------------------------
test_cmd "unknown option rejected with error" \
    1 "Unknown option" report --foobar

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed, $TOTAL total"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
