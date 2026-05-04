#!/usr/bin/env bash
# Test: loki sentrux init-rules
# Verifies the init-rules subcommand scaffolds a default .sentrux/rules.toml,
# refuses to overwrite without --force, and replaces with --force.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOKI_BIN="$REPO_ROOT/autonomy/loki"

PASS=0
FAIL=0
FAILED_TESTS=()

pass() {
    PASS=$((PASS + 1))
    echo "PASS: $1"
}

fail() {
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$1")
    echo "FAIL: $1"
}

# Isolate test artifacts under /tmp so cleanup hooks pick them up.
TMP_BASE=$(mktemp -d "/tmp/loki-test-sentrux-init-XXXXXX")
trap 'rm -rf "$TMP_BASE"' EXIT

# --- Test 1: fresh dir scaffolds the file successfully ---
T1_DIR="$TMP_BASE/fresh"
mkdir -p "$T1_DIR"
if bash "$LOKI_BIN" sentrux init-rules "$T1_DIR" >/dev/null 2>&1; then
    if [ -f "$T1_DIR/.sentrux/rules.toml" ]; then
        pass "T1 fresh dir: file created at expected path"
    else
        fail "T1 fresh dir: file NOT created at $T1_DIR/.sentrux/rules.toml"
    fi
else
    fail "T1 fresh dir: command exited non-zero"
fi

# --- Test 2: re-run without --force refuses overwrite ---
T2_DIR="$TMP_BASE/existing"
mkdir -p "$T2_DIR/.sentrux"
echo "# user-edited content" > "$T2_DIR/.sentrux/rules.toml"
ORIGINAL_CONTENT=$(cat "$T2_DIR/.sentrux/rules.toml")
bash "$LOKI_BIN" sentrux init-rules "$T2_DIR" >/dev/null 2>&1
T2_EXIT=$?
if [ "$T2_EXIT" -eq 1 ]; then
    pass "T2 existing file: exit code 1 (refused overwrite)"
else
    fail "T2 existing file: expected exit 1, got $T2_EXIT"
fi
NEW_CONTENT=$(cat "$T2_DIR/.sentrux/rules.toml")
if [ "$ORIGINAL_CONTENT" = "$NEW_CONTENT" ]; then
    pass "T2 existing file: content unchanged"
else
    fail "T2 existing file: content was modified despite refusal"
fi

# --- Test 3: re-run with --force overwrites ---
bash "$LOKI_BIN" sentrux init-rules "$T2_DIR" --force >/dev/null 2>&1
T3_EXIT=$?
if [ "$T3_EXIT" -eq 0 ]; then
    pass "T3 --force: exit code 0"
else
    fail "T3 --force: expected exit 0, got $T3_EXIT"
fi
FORCED_CONTENT=$(cat "$T2_DIR/.sentrux/rules.toml")
if [ "$ORIGINAL_CONTENT" != "$FORCED_CONTENT" ]; then
    pass "T3 --force: content was overwritten"
else
    fail "T3 --force: content was NOT overwritten"
fi

# --- Test 4: scaffolded file contains expected constraints ---
T4_DIR="$TMP_BASE/check-content"
mkdir -p "$T4_DIR"
bash "$LOKI_BIN" sentrux init-rules "$T4_DIR" >/dev/null 2>&1
if grep -Eq '^max_cycles[[:space:]]*=[[:space:]]*0' "$T4_DIR/.sentrux/rules.toml"; then
    pass "T4 content: 'max_cycles = 0' present"
else
    fail "T4 content: 'max_cycles = 0' missing"
fi
if grep -Eq '^no_god_files[[:space:]]*=[[:space:]]*true' "$T4_DIR/.sentrux/rules.toml"; then
    pass "T4 content: 'no_god_files = true' present"
else
    fail "T4 content: 'no_god_files = true' missing"
fi

# --- Test 5: --force flag accepted before path argument ---
T5_DIR="$TMP_BASE/flag-order"
mkdir -p "$T5_DIR/.sentrux"
echo "# old" > "$T5_DIR/.sentrux/rules.toml"
bash "$LOKI_BIN" sentrux init-rules --force "$T5_DIR" >/dev/null 2>&1
T5_EXIT=$?
if [ "$T5_EXIT" -eq 0 ] && grep -q "max_cycles" "$T5_DIR/.sentrux/rules.toml"; then
    pass "T5 flag order: --force before path works"
else
    fail "T5 flag order: --force before path failed (exit=$T5_EXIT)"
fi

# --- Test 6: shellcheck -S error clean on autonomy/loki ---
if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S error "$LOKI_BIN" >/dev/null 2>&1; then
        pass "T6 shellcheck -S error clean"
    else
        fail "T6 shellcheck -S error reported issues"
    fi
else
    echo "SKIP: T6 shellcheck not installed"
fi

echo ""
echo "==================================="
echo "Results: $PASS passed, $FAIL failed"
echo "==================================="
if [ "$FAIL" -gt 0 ]; then
    echo "Failed tests:"
    for t in "${FAILED_TESTS[@]}"; do
        echo "  - $t"
    done
    exit 1
fi
exit 0
