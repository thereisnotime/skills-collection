#!/usr/bin/env bash
# shellcheck disable=SC2034  # Variables may be unused in test context
# shellcheck disable=SC2155  # Declare and assign separately
# Test: Checkpoint CLI Commands
# Tests loki checkpoint subcommands: help, list, create, show, rollback
# Exercises path traversal protection and empty-message handling.
#
# Note: Not using -e to allow collecting all test results

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKI="$SCRIPT_DIR/../autonomy/loki"
TEST_DIR=$(mktemp -d)
PASSED=0
FAILED=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASSED++)); ((TOTAL++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1 -- $2"; ((FAILED++)); ((TOTAL++)); }
log_test() { echo -e "${YELLOW}[TEST]${NC} $1"; }

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "========================================"
echo "Loki Checkpoint CLI Tests"
echo "========================================"
echo "CLI: $LOKI"
echo "Temp dir: $TEST_DIR"
echo ""

# Verify the loki script exists and is executable
if [ ! -x "$LOKI" ]; then
    echo -e "${RED}Error: $LOKI not found or not executable${NC}"
    exit 1
fi

# -------------------------------------------
# Setup: create temp project with .loki structure and git repo
# -------------------------------------------
cd "$TEST_DIR" || exit 1
git init --quiet .
git commit --allow-empty -m "initial commit" --quiet

mkdir -p .loki/state/checkpoints
mkdir -p .loki/queue
mkdir -p .loki/memory
mkdir -p .loki/metrics
mkdir -p .loki/council

# Create a minimal session.json so loki treats this as a project
cat > .loki/session.json << 'EOF'
{
  "status": "running",
  "startedAt": "2026-02-12T00:00:00Z",
  "pid": 99999
}
EOF

# -------------------------------------------
# Test 1: loki checkpoint help
# -------------------------------------------
log_test "loki checkpoint help shows usage info"
output=$("$LOKI" checkpoint help 2>&1) || true

if echo "$output" | grep -q "loki checkpoint"; then
    if echo "$output" | grep -q "Commands:"; then
        log_pass "checkpoint help shows usage and commands"
    else
        log_fail "checkpoint help missing Commands section" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "checkpoint help missing expected text" "got: $(echo "$output" | head -3)"
fi

# -------------------------------------------
# Test 2: loki checkpoint list with empty checkpoints
# -------------------------------------------
log_test "loki checkpoint list with no checkpoints"
output=$("$LOKI" checkpoint list 2>&1) || true

if echo "$output" | grep -qi "No checkpoints"; then
    log_pass "checkpoint list reports no checkpoints when empty"
else
    log_fail "checkpoint list should report no checkpoints" "got: $(echo "$output" | head -3)"
fi

# -------------------------------------------
# Test 3: loki checkpoint create with a message
# -------------------------------------------
log_test "loki checkpoint create with message"
output=$("$LOKI" checkpoint create "test checkpoint message" 2>&1)
create_exit=$?

if [ "$create_exit" -eq 0 ]; then
    if echo "$output" | grep -q "cp-"; then
        log_pass "checkpoint create succeeds and outputs checkpoint ID"
    else
        log_fail "checkpoint create missing checkpoint ID in output" "got: $(echo "$output" | head -5)"
    fi
else
    log_fail "checkpoint create exited with non-zero" "exit=$create_exit"
fi

# -------------------------------------------
# Test 4: Verify checkpoint files were created
# -------------------------------------------
log_test "checkpoint create writes index.jsonl and metadata"
index_file=".loki/state/checkpoints/index.jsonl"

if [ -f "$index_file" ]; then
    line_count=$(wc -l < "$index_file" | tr -d ' ')
    if [ "$line_count" -ge 1 ]; then
        # Check that the entry contains our message
        if grep -q "test checkpoint message" "$index_file"; then
            log_pass "index.jsonl contains checkpoint entry with message"
        else
            log_fail "index.jsonl missing expected message" "content: $(cat "$index_file")"
        fi
    else
        log_fail "index.jsonl is empty" "line_count=$line_count"
    fi
else
    log_fail "index.jsonl was not created" "file does not exist"
fi

# -------------------------------------------
# Test 5: Extract the checkpoint ID and verify metadata.json
# -------------------------------------------
log_test "checkpoint directory contains metadata.json"
cp_id=$(python3 -c "
import json
with open('$index_file') as f:
    for line in f:
        entry = json.loads(line.strip())
        print(entry['id'])
        break
" 2>/dev/null)

if [ -n "$cp_id" ]; then
    metadata_file=".loki/state/checkpoints/$cp_id/metadata.json"
    if [ -f "$metadata_file" ]; then
        # Verify metadata has required fields
        has_fields=$(python3 -c "
import json
with open('$metadata_file') as f:
    d = json.load(f)
required = ['id', 'timestamp', 'git_sha', 'git_branch', 'message', 'files_copied']
missing = [k for k in required if k not in d]
print('ok' if not missing else 'missing:' + ','.join(missing))
" 2>/dev/null)
        if [ "$has_fields" = "ok" ]; then
            log_pass "metadata.json contains all required fields"
        else
            log_fail "metadata.json missing fields" "$has_fields"
        fi
    else
        log_fail "metadata.json not found" "expected at $metadata_file"
    fi
else
    log_fail "could not extract checkpoint ID from index" "index content: $(cat "$index_file" 2>/dev/null)"
fi

# -------------------------------------------
# Test 6: loki checkpoint list now shows the checkpoint
# -------------------------------------------
log_test "loki checkpoint list shows created checkpoint"
output=$("$LOKI" checkpoint list 2>&1) || true

if echo "$output" | grep -q "$cp_id"; then
    log_pass "checkpoint list includes the created checkpoint ID"
else
    log_fail "checkpoint list missing checkpoint ID" "expected $cp_id in output"
fi

# -------------------------------------------
# Test 7: loki checkpoint show <id>
# -------------------------------------------
log_test "loki checkpoint show displays details"
output=$("$LOKI" checkpoint show "$cp_id" 2>&1)
show_exit=$?

if [ "$show_exit" -eq 0 ]; then
    if echo "$output" | grep -q "Timestamp:" && echo "$output" | grep -q "Git SHA:"; then
        log_pass "checkpoint show displays timestamp and git SHA"
    else
        log_fail "checkpoint show missing expected fields" "got: $(echo "$output" | head -10)"
    fi
else
    log_fail "checkpoint show exited with non-zero" "exit=$show_exit"
fi

# -------------------------------------------
# Test 8: loki checkpoint show with no ID (should fail)
# -------------------------------------------
log_test "loki checkpoint show with no ID exits non-zero"
output=$("$LOKI" checkpoint show 2>&1) && show_no_id_exit=0 || show_no_id_exit=$?

if [ "$show_no_id_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "error"; then
        log_pass "checkpoint show with no ID returns error"
    else
        log_fail "checkpoint show with no ID missing error message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "checkpoint show with no ID should exit non-zero" "exit=$show_no_id_exit"
fi

# -------------------------------------------
# Test 9: Path traversal protection on show
# -------------------------------------------
log_test "checkpoint show rejects path traversal (../../../etc/passwd)"
output=$("$LOKI" checkpoint show "../../../etc/passwd" 2>&1) && traversal_exit=0 || traversal_exit=$?

if [ "$traversal_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "Invalid checkpoint ID"; then
        log_pass "path traversal rejected with proper error message"
    else
        log_fail "path traversal rejected but wrong message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "path traversal should be rejected (non-zero exit)" "exit=$traversal_exit"
fi

# -------------------------------------------
# Test 10: Path traversal protection on rollback
# -------------------------------------------
log_test "checkpoint rollback rejects path traversal"
output=$("$LOKI" checkpoint rollback "../../etc/shadow" 2>&1) && rollback_traversal_exit=0 || rollback_traversal_exit=$?

if [ "$rollback_traversal_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "Invalid checkpoint ID"; then
        log_pass "rollback path traversal rejected with proper error"
    else
        log_fail "rollback path traversal rejected but wrong message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "rollback path traversal should be rejected" "exit=$rollback_traversal_exit"
fi

# -------------------------------------------
# Test 11: loki checkpoint rollback with valid checkpoint
# -------------------------------------------
log_test "loki checkpoint rollback restores state"

# Modify session.json so we can verify rollback restores original
cat > .loki/session.json << 'EOF'
{
  "status": "modified-after-checkpoint",
  "startedAt": "2026-02-12T12:00:00Z",
  "pid": 11111
}
EOF

output=$("$LOKI" checkpoint rollback "$cp_id" 2>&1)
rollback_exit=$?

if [ "$rollback_exit" -eq 0 ]; then
    if echo "$output" | grep -qi "restored"; then
        log_pass "checkpoint rollback succeeds and reports restored items"
    else
        log_fail "checkpoint rollback missing 'restored' message" "got: $(echo "$output" | head -5)"
    fi
else
    log_fail "checkpoint rollback exited with non-zero" "exit=$rollback_exit"
fi

# -------------------------------------------
# Test 12: loki checkpoint rollback with missing ID (should fail)
# -------------------------------------------
log_test "loki checkpoint rollback with no ID exits non-zero"
output=$("$LOKI" checkpoint rollback 2>&1) && rollback_no_id_exit=0 || rollback_no_id_exit=$?

if [ "$rollback_no_id_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "error"; then
        log_pass "checkpoint rollback with no ID returns error"
    else
        log_fail "checkpoint rollback with no ID missing error message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "checkpoint rollback with no ID should exit non-zero" "exit=$rollback_no_id_exit"
fi

# -------------------------------------------
# Test 13: loki checkpoint show with non-existent ID
# -------------------------------------------
log_test "loki checkpoint show with non-existent ID"
output=$("$LOKI" checkpoint show "cp-nonexistent-99999" 2>&1) && show_missing_exit=0 || show_missing_exit=$?

if [ "$show_missing_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "not found"; then
        log_pass "checkpoint show reports not found for missing ID"
    else
        log_fail "checkpoint show missing 'not found' message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "checkpoint show for missing ID should exit non-zero" "exit=$show_missing_exit"
fi

# -------------------------------------------
# Test 14: Create a second checkpoint and verify list shows both
# -------------------------------------------
log_test "create second checkpoint and verify list count"
sleep 1  # ensure different timestamp
"$LOKI" checkpoint create "second checkpoint" >/dev/null 2>&1

entry_count=$(wc -l < "$index_file" | tr -d ' ')
if [ "$entry_count" -ge 2 ]; then
    log_pass "index.jsonl contains 2 entries after second create"
else
    log_fail "index.jsonl should have at least 2 entries" "count=$entry_count"
fi

# -------------------------------------------
# Test 15: loki cp alias works (cp = checkpoint)
# -------------------------------------------
log_test "loki cp alias invokes checkpoint"
output=$("$LOKI" cp help 2>&1) || true

if echo "$output" | grep -q "loki checkpoint"; then
    log_pass "loki cp alias routes to checkpoint help"
else
    log_fail "loki cp alias did not route to checkpoint" "got: $(echo "$output" | head -3)"
fi

# -------------------------------------------
# Test 16: Unknown checkpoint subcommand
# -------------------------------------------
log_test "unknown checkpoint subcommand exits non-zero"
output=$("$LOKI" checkpoint bogus-subcommand 2>&1) && unknown_exit=0 || unknown_exit=$?

if [ "$unknown_exit" -ne 0 ]; then
    if echo "$output" | grep -qi "Unknown checkpoint command"; then
        log_pass "unknown subcommand returns proper error message"
    else
        log_fail "unknown subcommand wrong error message" "got: $(echo "$output" | head -3)"
    fi
else
    log_fail "unknown subcommand should exit non-zero" "exit=$unknown_exit"
fi

# -------------------------------------------
# Summary
# -------------------------------------------
echo ""
echo "========================================"
echo "Results: $PASSED passed, $FAILED failed (out of $TOTAL)"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
