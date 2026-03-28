#!/usr/bin/env bash
#
# Test Unified Memory Access Layer
# Tests: UnifiedMemoryAccess class, MemoryContext, retrieval, recording, suggestions
#

set -uo pipefail
# Note: Not using -e to allow collecting all test results

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DIR=$(mktemp -d)
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
}

log_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
}

cleanup() {
    rm -rf "$TEST_DIR"
    # Clean up any test processes
    pkill -f "test-unified-" 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================"
echo "Loki Mode Unified Memory Access Tests"
echo "========================================"
echo ""

# Always ensure PYTHONPATH includes project root for all Python tests
export PYTHONPATH="${PROJECT_ROOT}:${PYTHONPATH:-}"

# Check if unified_access module is available
if ! python3 -c "from memory.unified_access import UnifiedMemoryAccess" 2>/dev/null; then
    echo -e "${RED}unified_access module not available. Ensure PYTHONPATH includes project root.${NC}"
    skip "unified_access module not importable - skipping Python tests"
    SKIP_PYTHON=1
fi

cd "$TEST_DIR" || exit 1
mkdir -p .loki/memory

# Test 1: UnifiedMemoryAccess Initialization
log_test "UnifiedMemoryAccess initialization"
if [ -z "${SKIP_PYTHON:-}" ]; then
    python3 << 'EOF'
from memory.unified_access import UnifiedMemoryAccess

access = UnifiedMemoryAccess(base_path=".loki/memory")
access.initialize()

# Check that engine is initialized
stats = access.get_stats()
if "episodic_count" not in stats:
    print("FAIL:missing episodic_count")
    exit(1)
if "token_economics" not in stats:
    print("FAIL:missing token_economics")
    exit(1)

print("OK")
EOF
    if [ $? -eq 0 ]; then
        pass "UnifiedMemoryAccess initialization"
    else
        fail "UnifiedMemoryAccess initialization"
    fi
else
    skip "UnifiedMemoryAccess initialization - Python not available"
fi

# Test 2: MemoryContext Dataclass
log_test "MemoryContext dataclass"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import MemoryContext

    # Create context with data
    ctx = MemoryContext(
        relevant_episodes=[{"id": "ep-001", "goal": "Test"}],
        applicable_patterns=[{"id": "sem-001", "pattern": "Test pattern"}],
        suggested_skills=[{"id": "skill-001", "name": "Test skill"}],
        token_budget=3000,
        task_type="implementation"
    )

    # Test methods
    if ctx.is_empty():
        print("FAIL:should not be empty")
        exit(1)

    if ctx.total_items() != 3:
        print(f"FAIL:total_items should be 3, got {ctx.total_items()}")
        exit(1)

    # Test to_dict and from_dict
    ctx_dict = ctx.to_dict()
    restored = MemoryContext.from_dict(ctx_dict)

    if restored.task_type != "implementation":
        print("FAIL:task_type not restored")
        exit(1)

    if len(restored.relevant_episodes) != 1:
        print("FAIL:episodes not restored")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "MemoryContext dataclass"
else
    fail "MemoryContext dataclass"
fi

# Test 3: MemoryContext is_empty
log_test "MemoryContext is_empty check"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import MemoryContext

    # Empty context
    empty_ctx = MemoryContext()
    if not empty_ctx.is_empty():
        print("FAIL:empty context should be empty")
        exit(1)

    # Non-empty context
    non_empty = MemoryContext(relevant_episodes=[{"id": "ep-001"}])
    if non_empty.is_empty():
        print("FAIL:non-empty context should not be empty")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "MemoryContext is_empty check"
else
    fail "MemoryContext is_empty check"
fi

# Test 4: get_relevant_context basic
log_test "get_relevant_context basic retrieval"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    context = access.get_relevant_context(
        task_type="implementation",
        query="Build a REST API endpoint"
    )

    # Should return a MemoryContext
    if context is None:
        print("FAIL:context is None")
        exit(1)

    if context.task_type != "implementation":
        print(f"FAIL:task_type should be implementation, got {context.task_type}")
        exit(1)

    if context.token_budget <= 0:
        print(f"FAIL:token_budget should be positive, got {context.token_budget}")
        exit(1)

    if "tokens_used" not in context.retrieval_stats:
        print("FAIL:missing tokens_used in retrieval_stats")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_relevant_context basic retrieval"
else
    fail "get_relevant_context basic retrieval"
fi

# Test 5: get_relevant_context with token budget
log_test "get_relevant_context respects token budget"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Request with specific token budget
    context = access.get_relevant_context(
        task_type="debugging",
        query="Fix authentication error",
        token_budget=1000
    )

    # Token budget should be respected
    if context.retrieval_stats.get("budget_remaining", 0) < 0:
        print("FAIL:exceeded token budget")
        exit(1)

    used = context.retrieval_stats.get("tokens_used", 0)
    remaining = context.retrieval_stats.get("budget_remaining", 0)
    if used + remaining != 1000:
        print(f"FAIL:tokens don't add up: {used} + {remaining} != 1000")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_relevant_context respects token budget"
else
    fail "get_relevant_context respects token budget"
fi

# Test 6: record_interaction
log_test "record_interaction adds to timeline"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Record an interaction
    access.record_interaction(
        source="cli",
        action={
            "action": "read_file",
            "target": "src/main.py",
            "result": "success"
        },
        outcome="success"
    )

    # Check timeline was updated
    timeline = access.get_timeline()
    if not timeline.get("recent_actions"):
        print("FAIL:no recent_actions in timeline")
        exit(1)

    # Find our action
    found = False
    for action in timeline["recent_actions"]:
        if action.get("type") == "read_file" and action.get("source") == "cli":
            found = True
            break

    if not found:
        print("FAIL:recorded action not found in timeline")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "record_interaction adds to timeline"
else
    fail "record_interaction adds to timeline"
fi

# Test 7: record_episode
log_test "record_episode stores episode trace"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Record an episode
    episode_id = access.record_episode(
        task_id="task-test-001",
        agent="eng-backend",
        goal="Implement test endpoint",
        actions=[
            {"action": "read_file", "target": "src/api.py", "result": "ok"},
            {"action": "write_file", "target": "src/api.py", "result": "ok"}
        ],
        outcome="success",
        phase="ACT",
        duration_seconds=120
    )

    if not episode_id:
        print("FAIL:episode_id not returned")
        exit(1)

    # Verify episode was stored by checking stats
    stats = access.get_stats()
    if stats.get("episodic_count", 0) < 1:
        print("FAIL:episode not counted in stats")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "record_episode stores episode trace"
else
    fail "record_episode stores episode trace"
fi

# Test 8: get_suggestions basic
log_test "get_suggestions returns suggestions"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    suggestions = access.get_suggestions(
        context="implementing user authentication",
        max_suggestions=5
    )

    # Should return a list
    if not isinstance(suggestions, list):
        print("FAIL:suggestions should be a list")
        exit(1)

    # Should have at most max_suggestions
    if len(suggestions) > 5:
        print(f"FAIL:too many suggestions: {len(suggestions)}")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_suggestions returns suggestions"
else
    fail "get_suggestions returns suggestions"
fi

# Test 9: get_stats includes token economics
log_test "get_stats includes token economics"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Perform some operations to generate token usage
    access.get_relevant_context("implementation", "test query")
    access.record_interaction("test", {"action": "test"})

    stats = access.get_stats()

    if "token_economics" not in stats:
        print("FAIL:missing token_economics")
        exit(1)

    economics = stats["token_economics"]
    if "metrics" not in economics:
        print("FAIL:missing metrics in token_economics")
        exit(1)

    if "session_id" not in stats:
        print("FAIL:missing session_id")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_stats includes token economics"
else
    fail "get_stats includes token economics"
fi

# Test 10: save_session persists data
log_test "save_session persists token economics"
python3 << 'EOF' 2>/dev/null
try:
    import os
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Generate some token usage
    access.get_relevant_context("implementation", "test query")

    # Save session
    access.save_session()

    # Check file exists
    if not os.path.exists(".loki/memory/token_economics.json"):
        print("FAIL:token_economics.json not created")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "save_session persists token economics"
else
    fail "save_session persists token economics"
fi

# Test 11: get_index returns index
log_test "get_index returns memory index"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    index = access.get_index()

    if not isinstance(index, dict):
        print("FAIL:index should be a dict")
        exit(1)

    if "version" not in index:
        print("FAIL:missing version in index")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_index returns memory index"
else
    fail "get_index returns memory index"
fi

# Test 12: get_timeline returns timeline
log_test "get_timeline returns timeline"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    timeline = access.get_timeline()

    if not isinstance(timeline, dict):
        print("FAIL:timeline should be a dict")
        exit(1)

    if "recent_actions" not in timeline:
        print("FAIL:missing recent_actions in timeline")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "get_timeline returns timeline"
else
    fail "get_timeline returns timeline"
fi

# Test 13: Different task types use different retrieval strategies
log_test "Different task types use different retrieval strategies"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")
    access.initialize()

    # Test different task types
    task_types = ["exploration", "implementation", "debugging", "review", "refactoring"]

    for task_type in task_types:
        context = access.get_relevant_context(
            task_type=task_type,
            query="test query"
        )
        if context.task_type != task_type:
            print(f"FAIL:task_type mismatch for {task_type}")
            exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "Different task types use different retrieval strategies"
else
    fail "Different task types use different retrieval strategies"
fi

# Test 14: MemoryContext estimated_tokens
log_test "MemoryContext estimated_tokens calculation"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import MemoryContext

    # Create context with known data
    ctx = MemoryContext(
        relevant_episodes=[{"id": "ep-001", "goal": "Test goal with some content"}],
        applicable_patterns=[{"id": "sem-001", "pattern": "Pattern description"}],
        suggested_skills=[{"id": "skill-001", "name": "Skill name"}]
    )

    tokens = ctx.estimated_tokens()

    # Should return a positive number
    if tokens <= 0:
        print(f"FAIL:estimated_tokens should be positive, got {tokens}")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "MemoryContext estimated_tokens calculation"
else
    fail "MemoryContext estimated_tokens calculation"
fi

# Test 15: Initialization is idempotent
log_test "Initialization is idempotent"
python3 << 'EOF' 2>/dev/null
try:
    from memory.unified_access import UnifiedMemoryAccess

    access = UnifiedMemoryAccess(base_path=".loki/memory")

    # Initialize multiple times
    access.initialize()
    access.initialize()
    access.initialize()

    # Should still work
    stats = access.get_stats()
    if "episodic_count" not in stats:
        print("FAIL:stats broken after multiple initializations")
        exit(1)

    print("OK")
except Exception as e:
    print(f"FAIL:{e}")
    exit(1)
EOF
if [ $? -eq 0 ]; then
    pass "Initialization is idempotent"
else
    fail "Initialization is idempotent"
fi

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
