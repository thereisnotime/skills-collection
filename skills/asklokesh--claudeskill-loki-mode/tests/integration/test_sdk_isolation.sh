#!/usr/bin/env bash
# tests/integration/test_sdk_isolation.sh
# v7.0.0 invariant: `import anthropic` / `from anthropic` is ONLY permitted
# in memory/managed_memory/ and providers/managed.py.
#
# This is a stricter superset of tests/managed_memory/test_sdk_isolation.sh.
# The integration test codifies the v7 policy: as Phase 2/3/4/5 land, if any
# new file in autonomy/, dashboard/, mcp/, providers/, memory/ (outside the
# allowlist) imports the SDK, the blast-radius invariant is broken.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0
FAIL=0

ok() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
bad() { echo "FAIL [$1] $2"; FAIL=$((FAIL + 1)); }

# Allowlisted files (absolute paths relative to repo root):
ALLOW_REGEX='^(memory/managed_memory/|providers/managed\.py$)'

# Scan python files under the listed directories for anthropic imports.
DIRS=(autonomy dashboard mcp providers memory)
offenders=()

for d in "${DIRS[@]}"; do
    if [ ! -d "$d" ]; then
        continue
    fi
    # Matches at start of a line (with optional leading whitespace):
    #   import anthropic
    #   import anthropic.foo
    #   from anthropic import ...
    while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        # hit looks like: autonomy/run.sh:123: ...
        file="${hit%%:*}"
        # Strip the leading directory for the allowlist check.
        if echo "$file" | grep -qE "$ALLOW_REGEX"; then
            continue
        fi
        offenders+=("$hit")
    done < <(grep -RnE '^[[:space:]]*(import anthropic|from anthropic[[:space:]])' \
        --include='*.py' --include='*.pyi' "$d" 2>/dev/null || true)
done

if [ "${#offenders[@]}" -eq 0 ]; then
    ok "anthropic_isolated_to_allowlist"
else
    bad "anthropic_isolated_to_allowlist" "offenders=${#offenders[@]}"
    for h in "${offenders[@]}"; do echo "    $h"; done
fi

# Positive control: the allowlisted file MUST import anthropic; else the
# test is not actually validating anything.
if grep -qE '^[[:space:]]*import anthropic' memory/managed_memory/client.py; then
    ok "allowlist_positive_control_client_py"
else
    bad "allowlist_positive_control_client_py" "memory/managed_memory/client.py does not import anthropic"
fi

# providers/managed.py is a v7 file and may not exist yet in v6.83.1. If it
# exists, it must import anthropic OR pass-through to the managed_memory
# client (we only require the file to exist OR be absent; presence with no
# anthropic reference is still fine because it may delegate to managed_memory).
if [ -f providers/managed.py ]; then
    ok "providers_managed_py_present"
else
    echo "SKIP [providers_managed_py_present] file not yet present in v6.83.1 baseline"
fi

# Shell scripts must not shell out to `python -c "import anthropic"` either.
shell_hits=$(grep -RnE 'python[0-9]*[[:space:]]+-c[[:space:]]+["'\''][^"'\'']*import[[:space:]]+anthropic' \
    --include='*.sh' autonomy/ providers/ 2>/dev/null || true)
if [ -z "$shell_hits" ]; then
    ok "no_inline_anthropic_import_in_shell"
else
    bad "no_inline_anthropic_import_in_shell" "hits=$shell_hits"
fi

echo ""
echo "sdk_isolation: passed=$PASS failed=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
