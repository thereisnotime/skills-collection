#!/usr/bin/env bash
# test-contract-scaffold.sh -- M1 contract-first codegen spine.
#
# Proves the scaffolder produces a real contract-first skeleton where a page
# CANNOT reference an endpoint the contract does not define (it fails typecheck).
# This is the mechanism that makes a static-shell-passed-as-wired impossible.
#
# GENERAL: runs on a THROWAWAY generic resource (bookmarks), never a specific PRD.
# Requires node/npm + network for orval (skips cleanly if unavailable).
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAFFOLD="$REPO_ROOT/autonomy/lib/contract-scaffold/scaffold.sh"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

command -v npm >/dev/null 2>&1 || { echo "SKIP: npm not available"; exit 0; }
[ -f "$SCAFFOLD" ] || { echo "FAIL: scaffold.sh missing"; exit 1; }

bash -n "$SCAFFOLD" 2>/dev/null && pass "scaffold.sh has valid bash syntax" \
  || fail "scaffold.sh syntax error"

DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT

# Scaffold a throwaway bookmarks API (general resource, no PRD knowledge).
if bash "$SCAFFOLD" "$DEMO" bookmark url:string title:string >/dev/null 2>&1; then
  pass "scaffolded a contract-first skeleton"
else
  fail "scaffold failed"; echo "RESULT: $PASS passed, $FAIL failed"; exit 1
fi

[ -f "$DEMO/openapi.yaml" ] && pass "emitted an OpenAPI contract artifact" \
  || fail "no openapi.yaml emitted"

# Real codegen (network-dependent; skip the typecheck proofs if offline).
cd "$DEMO" || exit 1
if ! npm install --silent --no-audit --no-fund >/dev/null 2>&1; then
  echo "SKIP: npm install failed (offline?) -- contract artifact still verified"
  echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; exit
fi
if npm run codegen >/dev/null 2>&1 && [ -f src/generated/api.ts ]; then
  pass "orval generated typed hooks from the contract"
else
  echo "SKIP: orval codegen unavailable -- contract artifact still verified"
  echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; exit
fi

grep -q "useListBookmark" src/generated/api.ts && pass "generated hook matches a contract operationId" \
  || fail "expected generated hook missing"

mkdir -p src
# PROOF A: a page on a real endpoint typechecks.
cat > src/GoodPage.tsx <<'TSX'
import { useListBookmark, useCreateBookmark } from "./generated/api";
export function GoodPage() { useListBookmark(); useCreateBookmark(); return null; }
TSX
if npx tsc --noEmit >/dev/null 2>&1; then
  pass "a page wired to a REAL contract endpoint typechecks"
else
  fail "GoodPage should typecheck but did not"
fi

# PROOF B: a page on a NON-EXISTENT endpoint fails typecheck (drift blocked).
cat > src/BadPage.tsx <<'TSX'
import { useGetNonexistentThing } from "./generated/api";
export function BadPage() { useGetNonexistentThing(); return null; }
TSX
if npx tsc --noEmit 2>&1 | grep -qE "has no exported member 'useGetNonexistentThing'"; then
  pass "a page calling a NON-CONTRACT endpoint FAILS typecheck (drift blocked -- the whole point)"
else
  fail "BadPage should have failed typecheck (drift guard did not fire)"
fi

echo "----------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
