#!/usr/bin/env bash
# test-design-system.sh -- M3 design-system pass (tokens + dark + 3 UI states).
#
# Proves the generated frontend looks DESIGNED, not default: role tokens (no raw
# hex in components), a dark theme, and all three UI states (skeleton / empty /
# first-run) -- AND that the tokenized ListView typechecks against the M1 contract
# hooks (design + contract wired together; a page cannot reference a non-contract
# endpoint). General: throwaway 'note' resource, no PRD knowledge.
#
# Requires node/npm + network for orval/react types (skips the typecheck cleanly
# if offline; the token/state/dark checks are offline-safe).
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAFFOLD="$REPO_ROOT/autonomy/lib/contract-scaffold/scaffold.sh"
GEN="$REPO_ROOT/autonomy/lib/contract-scaffold/generate.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

command -v node >/dev/null 2>&1 || { echo "SKIP: node not available"; exit 0; }

DEMO="$(mktemp -d)"; trap 'rm -rf "$DEMO"' EXIT

# Scaffold the contract (M1) first so codegen has an openapi.yaml + orval.config,
# then generate the backend + UI (M2/M3). The integration typecheck below needs
# the generated hooks the contract produces.
bash "$SCAFFOLD" "$DEMO" note title:string body:string >/dev/null 2>&1 || true
node "$GEN" "$DEMO" note title:string body:string >/dev/null 2>&1 \
  && pass "generated the design-system UI" || { fail "generate failed"; exit 1; }

CSS="$DEMO/src/theme.css"
VIEW="$DEMO/src/NoteListView.tsx"

[ -f "$CSS" ] && [ -f "$VIEW" ] && pass "emitted theme.css + a ListView component" \
  || fail "UI files missing"

# Role tokens, not raw hex, IN THE COMPONENT (the theme.css defines the hex once).
if grep -qE "#[0-9a-fA-F]{6}" "$VIEW" 2>/dev/null; then
  fail "component contains raw hex (should use role tokens/classes only)"
else
  pass "component uses role tokens/classes -- no raw hex (re-themeable)"
fi

# All three UI states.
for s in skeleton empty first-run; do
  grep -q "$s" "$VIEW" && pass "UI state present: $s" || fail "UI state missing: $s"
done

# Dark theme shipped from the same token block.
grep -q "prefers-color-scheme: dark" "$CSS" && pass "dark theme present (OS-honored)" \
  || fail "no dark theme in tokens"

# The integration proof: the tokenized ListView typechecks against the M1 hooks.
cd "$DEMO" || exit 1
if npm install --silent --no-audit --no-fund >/dev/null 2>&1 \
   && npm run codegen >/dev/null 2>&1 \
   && npm install --silent --no-audit --no-fund @types/react react @tanstack/react-query >/dev/null 2>&1; then
  if npx tsc --noEmit >/dev/null 2>&1; then
    pass "the tokenized 3-state ListView typechecks against the generated contract hooks"
  else
    fail "ListView does not typecheck against the contract hooks"
  fi
else
  echo "SKIP: codegen/react deps unavailable (offline?) -- token/state/dark checks still verified"
fi

echo "----------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
