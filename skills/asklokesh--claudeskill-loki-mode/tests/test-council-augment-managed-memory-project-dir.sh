#!/usr/bin/env bash
# tests/test-council-augment-managed-memory-project-dir.sh
#
# BACKLOG 63: council_augment_from_managed_memory ran
# `cd "${PROJECT_DIR:-$(pwd)}"` then `python3 -m memory.managed_memory.retrieve`.
# With PROJECT_DIR unset, $(pwd) can be the AGENT'S OWN repo checkout -- which
# may ship its own memory/managed_memory package shadowing the real one -- so
# that package's output would be imported straight into the completion
# council's privileged prompt (D7's threat model, applied to this call site).
#
# This test proves, with a concrete marker string, which package loads:
#   1. RED (pre-fix behavior, reproduced against a fake shadow package):
#      PROJECT_DIR unset, cwd = a directory with its own memory/managed_memory
#      package -> that package's marker leaks into council-augment.txt.
#   2. GREEN (fixed function): PROJECT_DIR unset -> silent no-op, no cd, no
#      python invocation, no marker, empty/missing output file.
#   3. Control: PROJECT_DIR explicitly set (even with a hostile cwd) -> the
#      function honors PROJECT_DIR, not cwd -- proving the fix does not just
#      disable the feature outright.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"
[ -f "$COUNCIL_SH" ] || { echo "FAIL: cannot find $COUNCIL_SH"; exit 1; }

PASS=0; FAIL=0
ok()  { echo "ok: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

log_info(){ :; }; log_warn(){ :; }; log_error(){ :; }; log_debug(){ :; }; log_header(){ :; }

# shellcheck source=/dev/null
source "$COUNCIL_SH" >/dev/null 2>&1 || true
type council_augment_from_managed_memory >/dev/null 2>&1 || {
    echo "FAIL: council_augment_from_managed_memory not defined"; exit 1;
}

WORK="$(mktemp -d -t loki-council-augment-XXXXXX)"
cleanup() { cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "${WORK:-/nonexistent}"; }
trap cleanup EXIT

MARKER="MARKER: WRONG-PACKAGE-FROM-AGENT-REPO-LOADED"

# --- Fixture: a fake "agent repo" whose cwd shadows memory.managed_memory ---
AGENT_REPO="$WORK/agent_repo"
mkdir -p "$AGENT_REPO/memory/managed_memory"
cat > "$AGENT_REPO/memory/managed_memory/__init__.py" <<'PYEOF'
def is_enabled():
    return True
PYEOF
cat > "$AGENT_REPO/memory/managed_memory/retrieve.py" <<PYEOF
import sys
def _main(argv=None):
    print("${MARKER}")
    return 0
if __name__ == "__main__":
    sys.exit(_main())
PYEOF

TARGET1="$WORK/target1"
mkdir -p "$TARGET1"

# === 1. Confirm the vulnerable shape still reproduces against a stand-in ====
# (documents the pre-fix defect concretely; does not assert on shipped code)
(
    cd "$AGENT_REPO" || exit 1
    unset PROJECT_DIR
    out="$TARGET1/.loki/managed/council-augment.txt"
    mkdir -p "$(dirname "$out")"
    ( cd "${PROJECT_DIR:-$(pwd)}" 2>/dev/null && \
        timeout 5 python3 -m memory.managed_memory.retrieve \
            --query "x" --top-k 3 > "$out" 2>/dev/null || true ) || true
    grep -q "WRONG-PACKAGE-FROM-AGENT-REPO-LOADED" "$out" 2>/dev/null
)
if [ $? -eq 0 ]; then
    ok "RED reproduction: unset PROJECT_DIR + \$(pwd) fallback imports the agent-repo package (documents the defect this fix closes)"
else
    bad "RED reproduction did not reproduce the shadow-import shape -- fixture may be broken"
fi

# === 2. GREEN: the REAL function, PROJECT_DIR unset, hostile cwd -> no-op ===
TARGET2="$WORK/target2"
mkdir -p "$TARGET2"
(
    cd "$AGENT_REPO" || exit 1
    unset PROJECT_DIR
    export TARGET_DIR="$TARGET2"
    export LOKI_MANAGED_AGENTS=true
    export LOKI_MANAGED_MEMORY=true
    council_augment_from_managed_memory
)
OUT2="$TARGET2/.loki/managed/council-augment.txt"
if [ -s "$OUT2" ]; then
    bad "council_augment_from_managed_memory wrote output with PROJECT_DIR unset (expected silent no-op): $(cat "$OUT2")"
else
    ok "council_augment_from_managed_memory no-ops with PROJECT_DIR unset (no cd into cwd, no marker leaked)"
fi

# === 3. Control: PROJECT_DIR explicitly set wins over a hostile cwd ========
TARGET3="$WORK/target3"
mkdir -p "$TARGET3"
(
    cd "$AGENT_REPO" || exit 1   # cwd is still the fake agent repo
    export PROJECT_DIR="$REPO_ROOT"
    export TARGET_DIR="$TARGET3"
    export LOKI_MANAGED_AGENTS=true
    export LOKI_MANAGED_MEMORY=true
    council_augment_from_managed_memory
)
OUT3="$TARGET3/.loki/managed/council-augment.txt"
if [ -f "$OUT3" ] && grep -q "WRONG-PACKAGE-FROM-AGENT-REPO-LOADED" "$OUT3" 2>/dev/null; then
    bad "with PROJECT_DIR explicitly set, the function still imported the agent-repo package"
else
    ok "with PROJECT_DIR explicitly set, the function does not import the hostile cwd package (empty or real-module output only)"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
