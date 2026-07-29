#!/usr/bin/env bash
# Mock Detector - Quality Gate #8
# Scans test files for problematic mock patterns that mask real failures
#
# Usage: ./tests/detect-mock-problems.sh [--strict]
#   --strict: Exit with error code on any finding (for CI)
#
# Detects:
# 1. Tests that define inline functions and test them instead of importing real code
# 2. Tautological assertions (assert on literal values)
# 3. Conditional assertions that silently pass (if guards around expects)
# 4. Empty test bodies
# 5. Tests with no imports from source code
# 6. Internal mock ratio: mocks of own code vs external service mocks

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Directory to scan. Defaults to the repo containing this script (so
# run-all-tests.sh keeps scanning loki-mode unchanged). A run.sh gate wrapper
# MUST set LOKI_SCAN_DIR to the target project; cwd is NOT used by find here,
# so `cd TARGET_DIR` alone does not redirect the scan.
PROJECT_DIR="${LOKI_SCAN_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STRICT="${1:-}"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

CRITICAL=0
HIGH=0
MEDIUM=0
LOW=0

echo "=========================================="
echo "Mock Detector - Quality Gate #8"
echo "=========================================="
echo ""

report() {
    local severity="$1"
    local file="$2"
    local line="$3"
    local message="$4"

    case "$severity" in
        CRITICAL) echo -e "${RED}[CRITICAL]${NC} $file:$line - $message"; ((CRITICAL++)) ;;
        HIGH)     echo -e "${RED}[HIGH]${NC}     $file:$line - $message"; ((HIGH++)) ;;
        MEDIUM)   echo -e "${YELLOW}[MEDIUM]${NC}   $file:$line - $message"; ((MEDIUM++)) ;;
        LOW)      echo -e "${CYAN}[LOW]${NC}      $file:$line - $message"; ((LOW++)) ;;
    esac
}

local_import_is_source() {
    local test_file="$1"
    local spec="$2"
    local normalized leaf test_dir import_base candidate

    spec="${spec%%\?*}"
    spec="${spec%%#*}"
    normalized=$(printf '%s' "$spec" | tr '[:upper:]' '[:lower:]')
    leaf="${normalized##*/}"

    case "/$normalized/" in
        */__mocks__/*|*/mocks/*|*/mock/*|*/__tests__/*|*/tests/*|*/test/*|*/__fixtures__/*|*/fixtures/*|*/test-utils/*|*/test_utils/*|*/test-helpers/*|*/test_helpers/*)
            return 1
            ;;
    esac
    case "$leaf" in
        mock|mocks|mock.*|mocks.*|mock-*|mock_*|*.mock|*.mock.*|*.test|*.test.*|*.spec|*.spec.*|fixture|fixtures|fixture.*|fixtures.*|test-helper*|test_helper*|test-util*|test_util*|setup-tests*|setup_tests*|setuptests*)
            return 1
            ;;
    esac

    test_dir="${test_file%/*}"
    [ "$test_dir" != "$test_file" ] || test_dir="."
    import_base="$test_dir/$spec"

    case "$leaf" in
        *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.mts|*.cts|*.vue|*.svelte)
            [ -f "$import_base" ] && return 0
            ;;
        *.*) ;;
        *) [ -f "$import_base" ] && return 0 ;;
    esac

    for candidate in \
        "$import_base.js" "$import_base.jsx" "$import_base.ts" "$import_base.tsx" \
        "$import_base.mjs" "$import_base.cjs" "$import_base.mts" "$import_base.cts" \
        "$import_base.vue" "$import_base.svelte" \
        "$import_base/index.js" "$import_base/index.jsx" \
        "$import_base/index.ts" "$import_base/index.tsx" \
        "$import_base/index.mjs" "$import_base/index.cjs" \
        "$import_base/index.mts" "$import_base/index.cts" \
        "$import_base/index.vue" "$import_base/index.svelte"; do
        [ -f "$candidate" ] && return 0
    done
    return 1
}

test_has_source_import() {
    local test_file="$1"
    local line spec import_open=false
    local esm_from_re="^[[:space:]]*import[[:space:]]+.*[[:space:]]from[[:space:]]*['\"](\.{1,2}/[^'\"]+)['\"]"
    local esm_side_re="^[[:space:]]*import[[:space:]]*['\"](\.{1,2}/[^'\"]+)['\"]"
    local esm_continue_re="^[[:space:]]*.*[[:space:]]from[[:space:]]*['\"](\.{1,2}/[^'\"]+)['\"]"
    local cjs_re="require[[:space:]]*\([[:space:]]*['\"](\.{1,2}/[^'\"]+)['\"]"
    # `require.resolve('./x')` names the real module just as `require('./x')`
    # does -- it is how a subprocess/E2E test points at the source it runs.
    # Separate pattern (not an alternation) so the path stays BASH_REMATCH[1].
    local cjs_resolve_re="require\.resolve[[:space:]]*\([[:space:]]*['\"](\.{1,2}/[^'\"]+)['\"]"
    # A test that hands a literal source path to a child process exercises the
    # real code end-to-end without ever naming it in an import. Gated on the
    # file importing child_process, because this flag unlocks a deliberately
    # broad path-literal pattern -- keep the enabling condition as narrow as
    # possible. You cannot spawn in Node without importing child_process, so
    # matching spawnSync/execFile/fork( as well would add no true positives
    # while letting a mock-only test that merely MENTIONS them unlock it.
    # Two shapes, both gated on has_subprocess below:
    #   1. an explicitly-relative path      -- './greet.js', '../src/cli.js'
    #   2. a BARE source filename           -- path.join(__dirname, 'greet.js')
    # Shape 2 is idiomatic Node for locating a sibling script to spawn, and it
    # was the exact form a real benchmark build produced. Requiring a leading
    # './' missed it and re-raised the false positive. The bare form demands a
    # source-code EXTENSION so ordinary string literals ('utf8', 'Hello, Ada!',
    # 'node') can never satisfy it, and local_import_is_source() still has to
    # resolve the name to a real file on disk before it counts.
    local subproc_re="['\"](\.{1,2}/[^'\"]+)['\"]"
    local subproc_bare_re="['\"]([A-Za-z0-9_.-]+\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py|rb|go|sh))['\"]"
    local has_subprocess=false
    if grep -q "child_process" "$test_file" 2>/dev/null; then
        has_subprocess=true
    fi
    # Stricter companion flag: the file must actually CALL a spawn function, not
    # merely import the module. Guards the deliberately broad bare-filename
    # pattern below (see its comment for the mock-only case this rejects).
    local has_spawn_call=false
    if grep -qE "(spawnSync|spawn|execFile|execFileSync|execSync|exec|fork)[[:space:]]*\\(" "$test_file" 2>/dev/null; then
        has_spawn_call=true
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            *'jest.mock('*|*'vi.mock('*) continue ;;
        esac
        if [[ "$line" =~ ^[[:space:]]*(//|/\*|\*) ]]; then
            continue
        fi

        spec=""
        if [ "$import_open" = true ]; then
            if [[ "$line" =~ $esm_continue_re ]]; then
                spec="${BASH_REMATCH[1]}"
                import_open=false
            elif [[ "$line" == *';'* ]]; then
                import_open=false
            fi
        elif [[ "$line" =~ ^[[:space:]]*import[[:space:]]+type[[:space:]] ]]; then
            continue
        elif [[ "$line" =~ $esm_from_re ]]; then
            spec="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ $esm_side_re ]]; then
            spec="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^[[:space:]]*import[[:space:]] ]]; then
            # Only latch an UNFINISHED multi-line import. A single-line import of
            # a NON-relative module (`import { execFileSync } from
            # 'node:child_process';`) reaches this branch because no ./-relative
            # pattern matched -- latching on it left import_open stuck true for
            # the REST OF THE FILE, so every later line was swallowed by the
            # import_open branch and the subprocess patterns never ran. Effect:
            # an ESM subprocess test was flagged CRITICAL while the
            # byte-identical CJS version passed. Latch only when the statement is
            # genuinely incomplete (no from-clause and no terminator on the line).
            if [[ ! "$line" =~ from[[:space:]]*[\'\"][^\'\"]+[\'\"] ]] && [[ "$line" != *';'* ]]; then
                import_open=true
            fi
        elif [[ "$line" =~ $cjs_resolve_re ]]; then
            spec="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ $cjs_re ]]; then
            spec="${BASH_REMATCH[1]}"
        elif [ "$has_subprocess" = true ] && [[ "$line" =~ $subproc_re ]]; then
            spec="${BASH_REMATCH[1]}"
        elif [ "$has_spawn_call" = true ] && [[ "$line" =~ $subproc_bare_re ]]; then
            # Bare filename ('greet.js'), normalized so local_import_is_source()
            # resolves it against the test's own directory.
            #
            # Gated on has_spawn_call, NOT has_subprocess. An adversarial review
            # produced a mock-only test that imports child_process, assigns
            # `const TARGET_NAME = 'greet.js'`, then asserts on an INLINE stub and
            # never spawns anything -- importing alone let that pass, blinding a
            # fail-closed gate. Requiring an actual spawn INVOCATION somewhere in
            # the file keeps the legitimate shapes (path.join(__dirname,'x.js')
            # assigned on one line and spawned on the next) while rejecting a file
            # that merely imports the module.
            spec="./${BASH_REMATCH[1]}"
        fi

        if [ -n "$spec" ] && local_import_is_source "$test_file" "$spec"; then
            return 0
        fi
    done < "$test_file"
    return 1
}

# Pattern 1: TypeScript/JavaScript tests that never import from source
# (excludes E2E/spec files which interact via browser, not imports)
echo -e "${CYAN}Scanning for tests that never import real code...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    # Resolve local imports so same-directory source counts, while imports of
    # test helpers, fixtures, mocks, or missing modules do not.
    has_source_import=false
    test_has_source_import "$test_file" && has_source_import=true

    if [ "$has_source_import" = false ]; then
        # Count actual test cases
        test_count=$(grep -cE '(it\(|test\(|describe\()' "$test_file" 2>/dev/null || echo "0")
        if [ "$test_count" -gt 0 ]; then
            report "CRITICAL" "$rel_path" "1" "Test file has $test_count test(s) but never imports source code -- tests only test inline mocks"
        fi
    fi
done < <(find "$PROJECT_DIR" \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" \) 2>/dev/null | grep -v node_modules | grep -v dist | grep -v e2e)

# Pattern 2: Tautological assertions on literals
echo -e "${CYAN}Scanning for tautological assertions...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    # assert.ok('string'.includes('string')) -- always true
    while IFS=: read -r lineno line; do
        report "HIGH" "$rel_path" "$lineno" "Tautological assertion on literal string"
    done < <(grep -nE "assert\.(ok|strictEqual|equal)\(['\"].*['\"]\.includes\(['\"]" "$test_file" 2>/dev/null)

    # expect(true).toBe(true), expect(false).toBe(false), expect(1).toBe(1)
    while IFS=: read -r lineno line; do
        report "HIGH" "$rel_path" "$lineno" "Tautological assertion: expect(literal).toBe(same literal)"
    done < <(grep -nE "expect\(true\)\.toBe\(true\)|expect\(false\)\.toBe\(false\)|expect\([0-9]+\)\.toBe\([0-9]+\)" "$test_file" 2>/dev/null)

    # assert.ok(true), assert.ok(1)
    while IFS=: read -r lineno line; do
        report "HIGH" "$rel_path" "$lineno" "Tautological assertion: assert.ok(true) always passes"
    done < <(grep -nE "assert\.ok\((true|1)\)" "$test_file" 2>/dev/null)

done < <(find "$PROJECT_DIR" -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" -o -name "test_*.py" 2>/dev/null | grep -v node_modules | grep -v dist)

# Pattern 3: Conditional assertions (if guards that silently skip)
echo -e "${CYAN}Scanning for conditional assertions...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    while IFS=: read -r lineno line; do
        report "MEDIUM" "$rel_path" "$lineno" "Conditional assertion: expect/assert inside if-guard may silently pass"
    done < <(grep -nE "if\s*\(.*\)\s*\{?\s*$" "$test_file" 2>/dev/null | while IFS=: read -r ln _; do
        # Check if next few lines have assert/expect
        next_lines=$(sed -n "$((ln+1)),$((ln+3))p" "$test_file" 2>/dev/null)
        if echo "$next_lines" | grep -qE "(assert\.|expect\()"; then
            echo "$ln:conditional"
        fi
    done)

done < <(find "$PROJECT_DIR" -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" 2>/dev/null | grep -v node_modules | grep -v dist)

# Pattern 4: Empty test bodies
echo -e "${CYAN}Scanning for empty test bodies...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    # it('name', () => {}) or test('name', () => {})
    while IFS=: read -r lineno line; do
        report "MEDIUM" "$rel_path" "$lineno" "Empty test body -- test does nothing"
    done < <(grep -nE "(it|test)\(['\"].*['\"],\s*(\(\)|function\s*\(\))\s*\{?\s*\}?\s*\);" "$test_file" 2>/dev/null)

done < <(find "$PROJECT_DIR" -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" 2>/dev/null | grep -v node_modules | grep -v dist)

# Pattern 5: Skipped tests
echo -e "${CYAN}Scanning for skipped tests...${NC}"
while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    while IFS=: read -r lineno line; do
        report "LOW" "$rel_path" "$lineno" "Skipped test: $line"
    done < <(grep -nE "(xit|xtest|xdescribe|\.skip)\(" "$test_file" 2>/dev/null | head -5)

done < <(find "$PROJECT_DIR" -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" -o -name "test_*.py" 2>/dev/null | grep -v node_modules | grep -v dist)

# Pattern 6: Internal vs External mock classification
# Internal mocks (mocking your own code) are problematic -- you're hiding bugs
# External mocks (mocking HTTP, DB, filesystem, APIs) are expected
echo -e "${CYAN}Scanning for internal mock ratio...${NC}"

# Mock patterns for external services (acceptable)
EXTERNAL_MOCK_PATTERN='(fetch|axios|http|request|database|db\.|redis|pg\.|mysql|mongo|s3|aws|gcp|azure|stripe|twilio|sendgrid|smtp|mailer|fs\.|readFile|writeFile|unlink|mkdir|createServer|listen|connect|socket)'
# Mock patterns for internal code (problematic if excessive)
INTERNAL_MOCK_PATTERN='(jest\.fn|sinon\.stub|sinon\.spy|vi\.fn|mock\(\)|spyOn|jest\.spyOn|stub\()'

while IFS= read -r test_file; do
    rel_path="${test_file#$PROJECT_DIR/}"

    total_mocks=$(grep -cE "$INTERNAL_MOCK_PATTERN" "$test_file" 2>/dev/null || true)
    total_mocks="${total_mocks:-0}"
    total_mocks=$(echo "$total_mocks" | tr -d '[:space:]')
    external_mocks=$(grep -cE "$EXTERNAL_MOCK_PATTERN" "$test_file" 2>/dev/null || true)
    external_mocks="${external_mocks:-0}"
    external_mocks=$(echo "$external_mocks" | tr -d '[:space:]')

    # Internal mock count = total mocks minus those near external patterns
    # Simple heuristic: if file has many mocks but few external references, it's over-mocking
    if [ "$total_mocks" -gt 5 ] && [ "$external_mocks" -eq 0 ]; then
        report "HIGH" "$rel_path" "1" "High internal mock ratio: $total_mocks mocks with 0 external service references -- likely mocking own code"
    elif [ "$total_mocks" -gt 10 ] && [ "$external_mocks" -lt 3 ]; then
        report "MEDIUM" "$rel_path" "1" "Elevated internal mock ratio: $total_mocks mocks, only $external_mocks external refs -- review mock targets"
    fi
done < <(find "$PROJECT_DIR" \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" \) 2>/dev/null | grep -v node_modules | grep -v dist)

# Summary
echo ""
echo "=========================================="
TOTAL=$((CRITICAL + HIGH + MEDIUM + LOW))
echo "Results: $TOTAL finding(s)"
echo "  CRITICAL: $CRITICAL"
echo "  HIGH:     $HIGH"
echo "  MEDIUM:   $MEDIUM"
echo "  LOW:      $LOW"
echo "=========================================="

if [ "$STRICT" = "--strict" ]; then
    if [ $CRITICAL -gt 0 ] || [ $HIGH -gt 0 ]; then
        echo ""
        echo -e "${RED}GATE FAILED: $CRITICAL critical + $HIGH high findings${NC}"
        exit 1
    fi
fi

if [ $TOTAL -eq 0 ]; then
    echo -e "${GREEN}All tests pass mock quality gate.${NC}"
fi

exit 0
