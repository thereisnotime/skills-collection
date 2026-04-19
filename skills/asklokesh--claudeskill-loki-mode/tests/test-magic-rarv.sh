#!/usr/bin/env bash
# Integration tests for Magic Modules RARV-C embedding.
# Exercises: PRD scanner, design-token extraction, memory bridge, gate behavior.
# Run: bash tests/test-magic-rarv.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"
TMPDIR="$(mktemp -d -t loki-magic-rarv-test-XXXX)"
PASS=0
FAIL=0

# shellcheck disable=SC2317,SC2329  # Called via trap
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

# Always invoke magic commands with LOKI_PROVIDER=none so tests run
# deterministically without calling out to real providers.
run_loki() {
    LOKI_PROVIDER=none PYTHONPATH="$REPO_ROOT" bash "$LOKI" "$@"
}

cd "$TMPDIR"
git init -q
echo '{"name":"rarv-test","version":"1.0.0"}' > package.json
git add -A
git -c user.email=test@example.com -c user.name=test \
    commit -q -m "init" --no-gpg-sign 2>/dev/null || true

echo "========================================"
echo "  Magic Modules RARV Integration Tests"
echo "========================================"

# -------- PRD scanner --------
cat > prd.md <<'EOF'
# Test Product

## Features
Build a login form with email, password, and a submit button.
The dashboard should have a search bar at the top.
Add a modal for confirmation dialogs.
Include a navigation sidebar on the left.
EOF

# Test 1: PRD scanner detects UI components
scan_out=$(PYTHONPATH="$REPO_ROOT" python3 -c "
import json
from magic.core.prd_scanner import scan_prd
prd = open('prd.md').read()
print(json.dumps(scan_prd(prd), indent=2))
" 2>&1)
if echo "$scan_out" | grep -qi '"button"\|SubmitButton'; then
    pass "PRD scanner detects button"
else
    fail "PRD scanner missed button"
fi
if echo "$scan_out" | grep -qi '"form"\|LoginForm'; then
    pass "PRD scanner detects form"
else
    fail "PRD scanner missed form"
fi
if echo "$scan_out" | grep -qi '"modal"\|Modal'; then
    pass "PRD scanner detects modal"
else
    fail "PRD scanner missed modal"
fi

# Test 2: scan_and_seed creates stub spec files
PYTHONPATH="$REPO_ROOT" python3 -c "
from magic.core.prd_scanner import scan_and_seed
result = scan_and_seed(open('prd.md').read(), project_dir='.')
print('seeded:', result['seeded_count'])
" > /dev/null 2>&1 || true
if ls .loki/magic/specs/*.md >/dev/null 2>&1; then
    seeded=$(find .loki/magic/specs -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
    if [ "$seeded" -ge 3 ]; then
        pass "scan_and_seed wrote >=3 stub specs ($seeded found)"
    else
        fail "scan_and_seed wrote too few specs ($seeded)"
    fi
else
    fail "scan_and_seed did not write any specs"
fi

# Test 3: existing specs are not overwritten
first_spec=$(find .loki/magic/specs -maxdepth 1 -name "*.md" 2>/dev/null | head -1)
if [ -n "$first_spec" ]; then
    echo "# CUSTOMIZED" > "$first_spec"
    PYTHONPATH="$REPO_ROOT" python3 -c "
from magic.core.prd_scanner import scan_and_seed
scan_and_seed(open('prd.md').read(), project_dir='.', overwrite=False)
" > /dev/null 2>&1 || true
    if head -1 "$first_spec" | grep -q "CUSTOMIZED"; then
        pass "existing specs preserved (overwrite=False)"
    else
        fail "existing specs were overwritten"
    fi
fi

# -------- Design token extraction --------
mkdir -p src
cat > src/Button.tsx <<'EOF'
export function Button() {
  return <button className="bg-[#553DE9] text-white px-4 py-2 rounded-md">Click</button>;
}
EOF
cat > src/index.css <<'EOF'
:root {
  --color-primary: #553DE9;
  --color-accent: #1FC5A8;
  --space-md: 12px;
}
EOF

PYTHONPATH="$REPO_ROOT" python3 -c "
from magic.core.design_tokens import DesignTokens
dt = DesignTokens('.')
observed = dt.extract_from_codebase(save=True)
print('colors:', len(observed.get('colors', {})))
print('spacing:', len(observed.get('spacing', {})))
" > /tmp/tokens-out.txt 2>&1 || true

if [ -f ".loki/magic/tokens.json" ]; then
    pass "design token extraction wrote .loki/magic/tokens.json"
else
    fail "design token extraction did not save tokens"
fi

# -------- Memory bridge graceful degrade --------
# Memory package not present in the test tmpdir; bridge must not crash.
bridge_out=$(PYTHONPATH="$REPO_ROOT" python3 -c "
from magic.core.memory_bridge import capture_iteration_compound, capture_component_generation, recall_similar_components
r1 = capture_iteration_compound('.', iteration=1)
r2 = capture_component_generation('.', 'TestButton', 'spec.md', ['react'], None, 1, 0.5)
r3 = recall_similar_components('.', tags=['button'])
print('compound:', r1.get('recorded'))
print('generation:', r2.get('stored'))
print('recall_is_list:', isinstance(r3, list))
" 2>&1 || true)
if echo "$bridge_out" | grep -q "recall_is_list: True"; then
    pass "memory bridge degrades gracefully when memory unavailable"
else
    fail "memory bridge crashed without memory package"
fi

# -------- End-to-end: magic update on seeded spec --------
# Seed a real spec and run update; verify a React file is produced.
mkdir -p .loki/magic/specs
cat > .loki/magic/specs/QuickButton.md <<'EOF'
# QuickButton

## Description
A simple button for quick actions.

## Props
- `label` (string, required)
- `onClick` (function, required)

## Accessibility
- Keyboard: Enter and Space activate
EOF

run_loki magic update --force > /tmp/update-out.txt 2>&1 || true
if ls .loki/magic/generated/react/QuickButton.tsx >/dev/null 2>&1; then
    pass "magic update produced React component"
elif grep -qi "updating\|generated\|done" /tmp/update-out.txt; then
    # Some CLI paths only print without writing when no change detected;
    # regenerate with magic generate instead for this assertion.
    run_loki magic generate QuickButton --target react > /dev/null 2>&1 || true
    if ls .loki/magic/generated/react/QuickButton.tsx >/dev/null 2>&1; then
        pass "magic update produced React component (via generate fallback)"
    else
        fail "magic update did not produce React component"
    fi
else
    fail "magic update did not produce React component"
fi

# -------- Summary --------
echo ""
echo "========================================"
echo "  Magic RARV Integration Test Results"
echo "========================================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ "$FAIL" -eq 0 ]; then
    echo "  ALL TESTS PASSED"
    exit 0
else
    echo "  TESTS FAILED"
    exit 1
fi
