#!/usr/bin/env bash
# Test Mutation Detector - Quality Gate #9
# Verifies that test assertions exercise real code paths
#
# Usage: ./tests/detect-test-mutations.sh [--strict] [--block-high] [--commit HASH]
#   --strict: Exit 1 on ANY finding (HIGH/MEDIUM/LOW) -- for CI; over-blocks
#   --block-high: Exit 2 when one or more HIGH-severity findings are present,
#                 0 otherwise. Does NOT block on MEDIUM/LOW. This is the clean
#                 exit-code contract for the run.sh mutation gate wrapper, so it
#                 does not have to grep stdout. --strict takes precedence if both
#                 are passed.
#   --commit HASH: Check specific commit for assertion value mutations
#
# Output contract: every HIGH-severity finding prints a line beginning with the
# literal token "[HIGH]" on stdout (ANSI-colored), so a wrapper may also grep
# '\[HIGH\]' as an alternative to --block-high.
#
# Detects:
# 1. Shell tests where functions are redefined to return canned output
# 2. Test files where all assertions check constant values
# 3. Test files with assertion-to-test ratio below threshold
# 4. Test harnesses that intercept console.error or suppress React act warnings
# 5. Optional UI or storage lookups whose required assertions can silently skip
# 6. Assertion value mutations: commits that change assertion expected values
#    alongside implementation changes (sign of fitting tests to code)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Directory to scan. Defaults to the repo containing this script (so
# run-all-tests.sh keeps scanning loki-mode unchanged). A run.sh gate wrapper
# MUST set LOKI_SCAN_DIR to the target project; cwd is NOT used by find/git here,
# so `cd TARGET_DIR` alone does not redirect the scan. The Check-5 git history is
# also read from this directory.
PROJECT_DIR="${LOKI_SCAN_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STRICT=""
BLOCK_HIGH=""
COMMIT_HASH=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --strict) STRICT="--strict"; shift ;;
        --block-high) BLOCK_HIGH="--block-high"; shift ;;
        --commit) COMMIT_HASH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

FINDINGS=0
HIGH_FINDINGS=0

echo "=========================================="
echo "Test Mutation Detector - Quality Gate #9"
echo "=========================================="
echo ""

report() {
    local severity="$1"
    local file="$2"
    local message="$3"

    case "$severity" in
        HIGH)   echo -e "${RED}[HIGH]${NC}   $file - $message"; ((HIGH_FINDINGS++)) ;;
        MEDIUM) echo -e "${YELLOW}[MEDIUM]${NC} $file - $message" ;;
        LOW)    echo -e "${CYAN}[LOW]${NC}    $file - $message" ;;
    esac
    ((FINDINGS++))
}

find_js_harness_files() {
    find "$PROJECT_DIR" -type f \( \
        -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" \
        -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" \
        -o -name "setupTests.ts" -o -name "setupTests.tsx" -o -name "setupTests.js" -o -name "setupTests.jsx" \
        -o -name "test-setup.ts" -o -name "test-setup.tsx" -o -name "test-setup.js" -o -name "test-setup.jsx" \
        -o -name "vitest.setup.ts" -o -name "vitest.setup.tsx" -o -name "vitest.setup.js" -o -name "vitest.setup.jsx" \
        -o -name "jest.setup.ts" -o -name "jest.setup.tsx" -o -name "jest.setup.js" -o -name "jest.setup.jsx" \
        -o -name "vitest.config.ts" -o -name "vitest.config.js" -o -name "vitest.config.mjs" -o -name "vitest.config.cjs" \
        -o -name "jest.config.ts" -o -name "jest.config.js" -o -name "jest.config.mjs" -o -name "jest.config.cjs" \
        -o -path "*/tests/setup.ts" -o -path "*/tests/setup.tsx" -o -path "*/tests/setup.js" -o -path "*/tests/setup.jsx" \
        -o -path "*/test/setup.ts" -o -path "*/test/setup.tsx" -o -path "*/test/setup.js" -o -path "*/test/setup.jsx" \
    \) 2>/dev/null | grep -Ev '/(node_modules|dist|build|coverage|\.git|\.claude|\.loki)/'
}

# Check 1: Shell tests with function redefinitions that mask real behavior
echo -e "${CYAN}Scanning shell tests for function masking...${NC}"
for test_file in "$PROJECT_DIR"/tests/test-*.sh; do
    [ -f "$test_file" ] || continue
    rel_path="${test_file#$PROJECT_DIR/}"

    # Look for patterns like: function_name() { echo "fixed"; }
    # that redefine functions from the source code
    mask_count=$(grep -cE '^\s*(log_info|log_warn|log_error|log_step|emit_event|emit_learning_signal)\(\)' "$test_file" 2>/dev/null || true)
    mask_count="${mask_count:-0}"
    mask_count=$(echo "$mask_count" | tr -d '[:space:]')
    if [ "$mask_count" -gt 3 ]; then
        report "LOW" "$rel_path" "Redefines $mask_count source functions (acceptable for log suppression)"
    fi
done

# Check 2: JS/TS test files with very low assertion density
echo -e "${CYAN}Scanning for low assertion density...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    test_count=$(grep -cE '(it\(|test\()' "$test_file" 2>/dev/null || true)
    assert_count=$(grep -cE '(assert\.|expect\(|should\.)' "$test_file" 2>/dev/null || true)

    if [ "$test_count" -gt 5 ] && [ "$assert_count" -lt "$test_count" ]; then
        report "MEDIUM" "$rel_path" "Low assertion density: $assert_count assertions in $test_count tests (some tests have no assertions)"
    fi
done < <(find "$PROJECT_DIR" \( -name "*.test.ts" -o -name "*.test.js" -o -name "*.spec.js" \) 2>/dev/null | grep -v node_modules | grep -v dist)

# Check 3: Python tests with no assertions
echo -e "${CYAN}Scanning Python tests for missing assertions...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    test_count=$(grep -cE '^\s*def test_' "$test_file" 2>/dev/null || true)
    assert_count=$(grep -cE '(assert |self\.assert|pytest\.raises|assertEqual|assertTrue|assertFalse|assertRaises|assertIn)' "$test_file" 2>/dev/null || true)

    if [ "$test_count" -gt 3 ] && [ "$assert_count" -lt "$test_count" ]; then
        report "MEDIUM" "$rel_path" "Low assertion density: $assert_count assertions in $test_count tests"
    fi
done < <(find "$PROJECT_DIR" -name "test_*.py" 2>/dev/null | grep -vE '/(node_modules|__pycache__|\.claude|\.loki)/')

# Check 4: Shell tests with no pass/fail tracking
echo -e "${CYAN}Scanning shell tests for assertion tracking...${NC}"
for test_file in "$PROJECT_DIR"/tests/test-*.sh; do
    [ -f "$test_file" ] || continue
    rel_path="${test_file#$PROJECT_DIR/}"

    has_pass=$(grep -c 'log_pass\|PASSED\|((PASSED' "$test_file" 2>/dev/null || true)
    has_fail=$(grep -c 'log_fail\|FAILED\|((FAILED' "$test_file" 2>/dev/null || true)

    if [ "$has_pass" -eq 0 ] && [ "$has_fail" -eq 0 ]; then
        report "MEDIUM" "$rel_path" "No pass/fail assertion tracking found"
    fi
done

# HARNESS_INTEGRITY_START
# Check 5: console and React warning suppression in test harnesses
echo -e "${CYAN}Scanning test harnesses for hidden console or React act failures...${NC}"
console_error_re="console[[:space:]]*(\.[[:space:]]*error|\[[[:space:]]*['\"]error['\"][[:space:]]*\])[[:space:]]*=|(spyOn|stub|method|replaceProperty)[[:space:]]*\([[:space:]]*([A-Za-z_\$][A-Za-z0-9_\$]*\.)?console[[:space:]]*,[[:space:]]*['\"]error['\"]|mocked[[:space:]]*\([[:space:]]*console[.]error|defineProperty[[:space:]]*\([[:space:]]*console[[:space:]]*,[[:space:]]*['\"]error['\"]"
console_warn_re="console[[:space:]]*(\.[[:space:]]*warn|\[[[:space:]]*['\"]warn['\"][[:space:]]*\])[[:space:]]*=|(spyOn|stub|method|replaceProperty)[[:space:]]*\([[:space:]]*([A-Za-z_\$][A-Za-z0-9_\$]*\.)?console[[:space:]]*,[[:space:]]*['\"]warn['\"]"
while IFS= read -r test_file; do
    [ -f "$test_file" ] || continue
    rel_path="${test_file#$PROJECT_DIR/}"
    hit=$(grep -nE "$console_error_re" "$test_file" 2>/dev/null | head -1 || true)
    if [ -n "$hit" ]; then
        report "HIGH" "$rel_path:${hit%%:*}" "Intercepts or mocks console.error, which can hide React errors and act warnings"
        continue
    fi

    config_hit=$(grep -nE '(^|[,{[:space:]])silent[[:space:]]*:[[:space:]]*true|onConsoleLog[[:space:]]*[:(]' "$test_file" 2>/dev/null | head -1 || true)
    if [ -n "$config_hit" ] && echo "$rel_path" | grep -qE '(vitest|jest)\.config\.'; then
        report "HIGH" "$rel_path:${config_hit%%:*}" "Test config suppresses or filters console output"
        continue
    fi

    act_hit=$(grep -niE 'not wrapped in (an )?act|React act warning|IS_REACT_ACT_ENVIRONMENT[[:space:]]*=[[:space:]]*false' "$test_file" 2>/dev/null | head -1 || true)
    warn_hit=$(grep -nE "$console_warn_re|onConsoleLog[[:space:]]*[:(]" "$test_file" 2>/dev/null | head -1 || true)
    if [ -n "$act_hit" ] && [ -n "$warn_hit" ]; then
        report "HIGH" "$rel_path:${warn_hit%%:*}" "Filters React act warnings from console output"
    fi
done < <(find_js_harness_files)

# Check 6: optional lookup guarded assertions that can execute zero assertions
echo -e "${CYAN}Scanning for vacuous conditional UI assertions...${NC}"
while IFS= read -r test_file; do
    [ -f "$test_file" ] || continue
    rel_path="${test_file#$PROJECT_DIR/}"
    while IFS=: read -r assign_line source_line; do
        [ -n "$assign_line" ] || continue
        guarded_var=$(echo "$source_line" | sed -E 's/.*(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*).*/\2/')
        guard_line=$(awk -v s="$assign_line" -v e="$((assign_line + 40))" -v v="$guarded_var" '
            NR <= s || NR > e { next }
            {
                compact=$0
                gsub(/[[:space:]]/, "", compact)
                if (index(compact, "if(" v ")") || index(compact, "if(" v "!==null)") ||
                    index(compact, "if(" v "!=null)") || index(compact, v "&&expect(")) {
                    print NR
                    exit
                }
            }
        ' "$test_file")
        [ -n "$guard_line" ] || continue

        presence_check=$(awk -v s="$assign_line" -v e="$guard_line" -v v="$guarded_var" '
            NR > s && NR < e && index($0, v) &&
            $0 ~ /(not[.]toBeNull|toBeTruthy|toBeDefined|assert[.](ok|notEqual))/ { print NR; exit }
        ' "$test_file")
        [ -z "$presence_check" ] || continue

        assertion_line=$(awk -v s="$guard_line" -v e="$((guard_line + 10))" '
            NR >= s && NR <= e && $0 ~ /(expect|assert)[[:space:]]*\(/ { print NR; exit }
        ' "$test_file")
        if [ -n "$assertion_line" ]; then
            report "HIGH" "$rel_path:$guard_line" "Required assertion is conditional on optional lookup '$guarded_var' and can silently skip"
        fi
    done < <(grep -nE '(const|let|var)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[^=]*=.*((local|session)Storage[.]getItem|query(By[A-Za-z]+)?[[:space:]]*\(|querySelector[[:space:]]*\(|getElementById[[:space:]]*\(|boundingBox[[:space:]]*\()' "$test_file" 2>/dev/null)
done < <(find_js_harness_files)
# HARNESS_INTEGRITY_END

# Check 7: Assertion value mutations in git commits
# Detects when a commit changes BOTH implementation code AND assertion expected values
# This is a sign of "fitting the test to the code" -- changing what the test expects
# to match what the code produces, rather than fixing the code
echo -e "${CYAN}Scanning for assertion value mutations in commits...${NC}"

# Use provided commit or check the last 5 commits
if [ -n "$COMMIT_HASH" ]; then
    COMMITS_TO_CHECK="$COMMIT_HASH"
else
    COMMITS_TO_CHECK=$(cd "$PROJECT_DIR" && git log --oneline -5 --format='%H' 2>/dev/null || true)
fi

if [ -n "$COMMITS_TO_CHECK" ]; then
    for commit in $COMMITS_TO_CHECK; do
        # Get files changed in this commit
        changed_files=$(cd "$PROJECT_DIR" && git diff-tree --no-commit-id --name-only -r "$commit" 2>/dev/null || true)
        [ -z "$changed_files" ] && continue

        # Classify files: test files vs implementation files
        has_impl=false
        has_test=false
        test_files_changed=""
        impl_files_changed=""

        while IFS= read -r file; do
            if echo "$file" | grep -qE '\.(test|spec)\.(ts|js|tsx|jsx)$|^tests?/|test_.*\.py$|(^|/)(vitest|jest|playwright|cypress)\.config\.(ts|js|mjs|cjs)$|(^|/)(vitest|jest)\.setup\.(ts|js|tsx|jsx)$'; then
                has_test=true
                test_files_changed="$test_files_changed $file"
            elif echo "$file" | grep -qE '\.(ts|js|tsx|jsx|py|sh)$'; then
                # Implementation source file. The broken `grep -q ... | grep -vq`
                # pipe that previously gated this branch always evaluated false
                # (grep -q emits no stdout, so the piped grep saw empty input and
                # exited 1), which left has_impl permanently false and made the
                # entire HIGH commit-mutation path dead. The .md/.json/.yml
                # extensions cannot match the .ts/.js/... pattern above, so the
                # exclusion grep was redundant and has been removed.
                has_impl=true
                impl_files_changed="$impl_files_changed $file"
            fi
        done <<< "$changed_files"

        # Only flag if BOTH test and implementation files changed in same commit.
        # New test files are not mutations. They have no prior assertions to
        # weaken, and blocking them punishes greenfield projects for adding real
        # coverage alongside their first implementation.
        if [ "$has_impl" = true ] && [ "$has_test" = true ]; then
            modified_test_files=""
            for test_file in $test_files_changed; do
                if (cd "$PROJECT_DIR" \
                    && git cat-file -e "${commit}^:${test_file}" 2>/dev/null \
                    && git cat-file -e "${commit}:${test_file}" 2>/dev/null); then
                    modified_test_files="$modified_test_files $test_file"
                fi
            done
            [ -z "$modified_test_files" ] && continue

            # A real expectation mutation has both a removed assertion and an
            # added replacement assertion. Counting additions alone confused
            # expanded coverage with test fitting. Require at least three paired
            # replacements to preserve the existing high-confidence threshold.
            test_diff=$(cd "$PROJECT_DIR" && git diff "$commit^" "$commit" -- $modified_test_files 2>/dev/null || true)
            removed_assertions=$(echo "$test_diff" | grep -E '^-[^-].*(\.toBe\(|\.toEqual\(|\.toStrictEqual\(|strictEqual\(|deepEqual\(|assertEqual\(|assert.*==)' 2>/dev/null | wc -l | tr -d '[:space:]')
            added_assertions=$(echo "$test_diff" | grep -E '^\+[^+].*(\.toBe\(|\.toEqual\(|\.toStrictEqual\(|strictEqual\(|deepEqual\(|assertEqual\(|assert.*==)' 2>/dev/null | wc -l | tr -d '[:space:]')
            removed_assertions="${removed_assertions:-0}"
            added_assertions="${added_assertions:-0}"
            changed_assertions="$removed_assertions"
            if [ "$added_assertions" -lt "$changed_assertions" ]; then
                changed_assertions="$added_assertions"
            fi

            if [ "$changed_assertions" -gt 2 ]; then
                short_hash=$(echo "$commit" | cut -c1-8)
                report "HIGH" "commit:$short_hash" "Replaced $changed_assertions assertion values alongside implementation code -- possible test fitting"
            fi
        fi
    done
fi

# Summary
echo ""
echo "=========================================="
echo "Results: $FINDINGS finding(s)"
echo "=========================================="

echo "  HIGH:    $HIGH_FINDINGS"

# --strict takes precedence: block on ANY finding (legacy CI behavior, unchanged).
if [ "$STRICT" = "--strict" ] && [ $FINDINGS -gt 0 ]; then
    echo -e "${RED}GATE FAILED: $FINDINGS finding(s)${NC}"
    exit 1
fi

# --block-high: exit 2 only when HIGH-severity findings are present. MEDIUM/LOW
# do not block (they are routed to the findings injector by the run.sh wrapper).
if [ "$BLOCK_HIGH" = "--block-high" ] && [ $HIGH_FINDINGS -gt 0 ]; then
    echo -e "${RED}GATE FAILED: $HIGH_FINDINGS HIGH-severity finding(s)${NC}"
    exit 2
fi

if [ $FINDINGS -eq 0 ]; then
    echo -e "${GREEN}All tests pass mutation detection gate.${NC}"
fi

exit 0
