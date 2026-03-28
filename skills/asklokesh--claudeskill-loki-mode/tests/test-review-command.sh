#!/usr/bin/env bash
# tests/test-review-command.sh - Tests for loki review command
# Part of Loki Mode v6.20.0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOKI="$REPO_DIR/autonomy/loki"
PASS=0
FAIL=0
TOTAL=0

# Temp directory for test fixtures
TEST_DIR=$(mktemp -d /tmp/loki-test-review-XXXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT

run_test() {
    local name="$1"
    TOTAL=$((TOTAL + 1))
    echo -n "  TEST $TOTAL: $name ... "
}

pass() {
    PASS=$((PASS + 1))
    echo "PASS"
}

fail() {
    FAIL=$((FAIL + 1))
    echo "FAIL: $1"
}

echo "=== loki review command tests ==="
echo ""

# --- Test 1: Review with no changes returns clean ---
run_test "review with no changes returns clean"
(
    cd "$TEST_DIR"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    echo "clean file" > clean.txt
    git add clean.txt
    git commit -q -m "init"
    # No uncommitted changes, should exit 0
    output=$("$LOKI" review 2>&1) || true
    if echo "$output" | grep -q "No changes to review"; then
        exit 0
    else
        echo "OUTPUT: $output" >&2
        exit 1
    fi
) && pass || fail "expected clean output for no changes"

# --- Test 2: Review detects hardcoded secrets ---
run_test "review detects hardcoded secrets"
(
    cd "$TEST_DIR"
    # Create a file with a hardcoded secret
    mkdir -p src
    cat > src/config.py << 'PYEOF'
# Bad practice
API_KEY = "sk-1234567890abcdefghijklmnopqrstuv"
DATABASE_URL = "postgres://localhost/db"
PYEOF
    output=$("$LOKI" review src/ 2>&1) || true
    if echo "$output" | grep -qi "secret\|hardcoded"; then
        exit 0
    else
        echo "OUTPUT: $output" >&2
        exit 1
    fi
) && pass || fail "expected secret detection"

# --- Test 3: Review detects common anti-patterns ---
run_test "review detects common anti-patterns"
(
    cd "$TEST_DIR"
    mkdir -p src
    cat > src/bad.py << 'PYEOF'
import pickle
import yaml

def load_data(raw):
    data = pickle.loads(raw)
    config = yaml.load(open("config.yml"))
    try:
        process(data)
    except:
        pass
    return data
PYEOF
    output=$("$LOKI" review src/bad.py 2>&1) || true
    found=0
    echo "$output" | grep -qi "deserialization\|pickle\|yaml" && found=$((found + 1))
    echo "$output" | grep -qi "bare except\|except" && found=$((found + 1))
    if [ "$found" -ge 1 ]; then
        exit 0
    else
        echo "OUTPUT: $output" >&2
        exit 1
    fi
) && pass || fail "expected anti-pattern detection"

# --- Test 4: --format json produces valid JSON ---
run_test "--format json produces valid JSON"
(
    cd "$TEST_DIR"
    output=$("$LOKI" review --format json src/config.py 2>&1) || true
    # Validate JSON with python
    echo "$output" | python3 -c "import json, sys; d=json.load(sys.stdin); assert 'findings' in d; assert 'summary' in d" 2>/dev/null
    if [ $? -eq 0 ]; then
        exit 0
    else
        echo "OUTPUT: $output" >&2
        exit 1
    fi
) && pass || fail "expected valid JSON output"

# --- Test 5: --severity filter works ---
run_test "--severity filter works"
(
    cd "$TEST_DIR"
    # Get all findings count
    all_json=$("$LOKI" review --format json src/ 2>&1) || true
    all_total=$(echo "$all_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['summary']['total'])" 2>/dev/null)
    # Get high+ findings only
    high_json=$("$LOKI" review --format json --severity high src/ 2>&1) || true
    high_total=$(echo "$high_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['summary']['total'])" 2>/dev/null)
    # High-filtered should have fewer or equal findings
    if [ "$high_total" -le "$all_total" ] 2>/dev/null; then
        exit 0
    else
        echo "all=$all_total high=$high_total" >&2
        exit 1
    fi
) && pass || fail "expected severity filtering to reduce findings"

# --- Test 6: Exit codes are correct ---
run_test "exit codes are correct"
(
    cd "$TEST_DIR"
    # Clean review should exit 0
    echo "clean" > "$TEST_DIR/clean_only.txt"
    "$LOKI" review "$TEST_DIR/clean_only.txt" >/dev/null 2>&1
    clean_code=$?
    # File with critical finding (hardcoded secret) should exit 2
    cat > "$TEST_DIR/secret_file.py" << 'PYEOF'
API_KEY = "sk-1234567890abcdefghijklmnopqrstuv"
SECRET_KEY = "mysupersecretkey12345678"
PYEOF
    "$LOKI" review "$TEST_DIR/secret_file.py" >/dev/null 2>&1
    secret_code=$?
    if [ "$clean_code" -eq 0 ] && [ "$secret_code" -eq 2 ]; then
        exit 0
    else
        echo "clean_code=$clean_code secret_code=$secret_code" >&2
        exit 1
    fi
) && pass || fail "expected exit code 0 for clean, 2 for critical"

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
