#!/usr/bin/env bash
# CLI Performance Benchmark Suite
# Measures and enforces performance targets for ccpi CLI operations
# Exit codes: 0 = All targets met, 1 = Target violations detected

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$REPO_ROOT/packages/cli"
PASS=0
FAIL=0
RESULTS=()

# ANSI colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

benchmark() {
    local name="$1"
    local max_ms="$2"
    local cmd="$3"

    local start_ns
    start_ns=$(date +%s%N 2>/dev/null || python3 -c "import time; print(int(time.time()*1e9))")

    eval "$cmd" > /dev/null 2>&1 || true

    local end_ns
    end_ns=$(date +%s%N 2>/dev/null || python3 -c "import time; print(int(time.time()*1e9))")

    local elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

    if [ "$elapsed_ms" -le "$max_ms" ]; then
        printf "${GREEN}  PASS${NC} %-40s %6dms / %6dms\n" "$name" "$elapsed_ms" "$max_ms"
        PASS=$((PASS + 1))
    else
        printf "${RED}  FAIL${NC} %-40s %6dms / %6dms\n" "$name" "$elapsed_ms" "$max_ms"
        FAIL=$((FAIL + 1))
    fi
    RESULTS+=("$name: ${elapsed_ms}ms (target: ${max_ms}ms)")
}

echo -e "${BOLD}CLI Performance Benchmark Suite${NC}"
echo "========================================"
echo ""

# Ensure CLI is built
if [ ! -f "$CLI_DIR/dist/index.js" ]; then
    echo "Building CLI..."
    cd "$CLI_DIR" && pnpm build > /dev/null 2>&1
    cd "$REPO_ROOT"
fi

CLI="node $CLI_DIR/dist/index.js"

# === BENCHMARKS ===

echo -e "${BOLD}Startup & Help${NC}"
benchmark "ccpi --help" 2000 "$CLI --help"
benchmark "ccpi --version" 1000 "$CLI --version"

echo ""
echo -e "${BOLD}Validation${NC}"
benchmark "ccpi validate (single skill)" 5000 "$CLI validate plugins/ai-ml/ai-ethics-validator/skills/validating-ai-ethics-and-fairness/SKILL.md"
benchmark "Python validator (single skill)" 3000 "python3 scripts/validate-skills-schema.py plugins/ai-ml/ai-ethics-validator/skills/validating-ai-ethics-and-fairness/SKILL.md"

echo ""
echo -e "${BOLD}Marketplace Build${NC}"
benchmark "sync-marketplace" 5000 "pnpm run sync-marketplace"

echo ""
echo -e "${BOLD}Website Build (if dist exists)${NC}"
if [ -d "$REPO_ROOT/marketplace/dist" ]; then
    benchmark "check-performance.mjs" 10000 "node scripts/check-performance.mjs"
else
    echo -e "${YELLOW}  SKIP${NC} Website not built (run: cd marketplace && npm run build)"
fi

# === SUMMARY ===
echo ""
echo "========================================"
echo -e "${BOLD}RESULTS${NC}"
echo "========================================"
echo -e "  ${GREEN}Pass: $PASS${NC}"
echo -e "  ${RED}Fail: $FAIL${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}${BOLD}BENCHMARK FAILED${NC} — $FAIL target(s) exceeded"
    exit 1
else
    echo -e "${GREEN}${BOLD}ALL BENCHMARKS PASSED${NC}"
    exit 0
fi
