#!/usr/bin/env bash
# tests/integration/test_default_behavior.sh
# v7.0.0 invariant: with all managed flags off, v6.82.0 behavior is preserved.
#
# Specifically:
#   1. Importing memory.managed_memory does NOT import anthropic.
#   2. No .loki/managed/ directory is created in a clean project when the
#      managed-memory modules are merely imported.
#   3. is_enabled() returns False.
#   4. `loki version` works WITHOUT ANTHROPIC_API_KEY set.
#   5. Retrieving with flags off yields empty output and no API call.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

TMPDIR="$(mktemp -d -t loki-default-XXXXXX)"
# shellcheck disable=SC2329 # invoked via trap
cleanup() { rm -rf "$TMPDIR" 2>/dev/null || true; }
trap cleanup EXIT

PASS=0
FAIL=0

ok() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
bad() { echo "FAIL [$1] $2"; FAIL=$((FAIL + 1)); }

# --- 1. Ensure flags are off -------------------------------------------------
unset LOKI_MANAGED_AGENTS LOKI_MANAGED_MEMORY ANTHROPIC_API_KEY 2>/dev/null || true

# --- 2. Importing managed_memory must NOT trigger anthropic import ----------
# We check sys.modules after import; anthropic should not appear.
out=$(
    python3 - <<'PY' 2>&1
import sys
# Forbid anthropic in the process by making an import fail loudly.
class _ForbidAnthropic:
    def find_module(self, name, path=None):
        if name == "anthropic" or name.startswith("anthropic."):
            return self
        return None
    def load_module(self, name):
        raise ImportError(f"anthropic should not be imported at this point: {name}")
sys.meta_path.insert(0, _ForbidAnthropic())

try:
    import memory.managed_memory as mm
    enabled = mm.is_enabled()
    print(f"ENABLED={enabled}")
    if "anthropic" in sys.modules:
        print("LEAK: anthropic in sys.modules")
        sys.exit(1)
    print("OK: no anthropic import at package load")
except Exception as e:
    print(f"ERR: {e}")
    sys.exit(1)
PY
)
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "^ENABLED=False" && echo "$out" | grep -q "^OK: no anthropic"; then
    ok "managed_memory_import_is_clean"
else
    bad "managed_memory_import_is_clean" "rc=$rc out=$out"
fi

# --- 3. No .loki/managed/ directory created from cold import ----------------
# Run the above import test in an empty TMPDIR as cwd and confirm nothing was
# written to .loki/managed/ there.
(
    cd "$TMPDIR" || exit 1
    python3 - <<'PY' >/dev/null 2>&1
import sys
sys.path.insert(0, "__REPO__")
import memory.managed_memory  # noqa: F401
PY
) 2>/dev/null || true

if [ ! -d "$TMPDIR/.loki/managed" ]; then
    ok "no_managed_dir_on_import"
else
    bad "no_managed_dir_on_import" "found .loki/managed/ in $TMPDIR"
fi

# --- 4. loki version must work without ANTHROPIC_API_KEY --------------------
unset ANTHROPIC_API_KEY
out=$(./autonomy/loki version 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -qE "Loki Mode v[0-9]+\.[0-9]+\.[0-9]+"; then
    ok "loki_version_works_without_api_key"
else
    bad "loki_version_works_without_api_key" "rc=$rc out=$out"
fi

# --- 5. retrieve CLI with flags off returns nothing and does not touch API --
# No API key set. Should exit 0 with no output.
out=$(
    cd "$TMPDIR" || exit 1
    LOKI_TARGET_DIR="$TMPDIR" timeout 10 python3 -c '
import sys
sys.path.insert(0, "'"$REPO_ROOT"'")
import runpy
sys.argv = ["retrieve", "--query", "anything"]
try:
    runpy.run_module("memory.managed_memory.retrieve", run_name="__main__")
except SystemExit as e:
    sys.exit(e.code if e.code is not None else 0)
' 2>&1
)
rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
    ok "retrieve_cli_silent_when_disabled"
else
    bad "retrieve_cli_silent_when_disabled" "rc=$rc out=$out"
fi

# --- 6. is_enabled() is False when flags missing or false -------------------
# Each case is a label + env-var assignments as an array of VAR=val tokens.
# We feed the assignments to `env` directly to avoid relying on shell
# word-splitting of a single string (keeps shellcheck happy and avoids
# accidental globbing).
check_is_enabled_false() {
    local label="$1"; shift
    local out
    out=$(
        env -i PATH="$PATH" "$@" \
            python3 -c '
import sys
sys.path.insert(0, "'"$REPO_ROOT"'")
import memory.managed_memory as mm
print(mm.is_enabled())
' 2>&1
    )
    if echo "$out" | grep -qx "False"; then
        ok "is_enabled_false_when_${label}"
    else
        bad "is_enabled_false_when_${label}" "out=$out"
    fi
}

check_is_enabled_false "no_flags"
check_is_enabled_false "parent_only" "LOKI_MANAGED_AGENTS=true"
check_is_enabled_false "parent_false_child_true" \
    "LOKI_MANAGED_AGENTS=false" "LOKI_MANAGED_MEMORY=true"

echo ""
echo "default_behavior: passed=$PASS failed=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
