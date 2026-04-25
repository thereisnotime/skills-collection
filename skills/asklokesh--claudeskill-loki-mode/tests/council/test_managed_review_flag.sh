#!/usr/bin/env bash
# T5 Phase 3: LOKI_EXPERIMENTAL_MANAGED_REVIEW fail-fast flag test.
#
# Verifies the run.sh flag block rejects misconfigured flag combinations:
#   - REVIEW=true without parent LOKI_MANAGED_AGENTS => exit 2
#   - REVIEW=true with parent but without umbrella    => exit 2
#   - REVIEW=true with both parent+umbrella           => proceeds (--help OK)
#   - REVIEW=false (default)                          => proceeds (v6.83.1 behavior)
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

if [ ! -x "$RUN_SH" ] && [ ! -r "$RUN_SH" ]; then
    echo "FAIL: cannot find $RUN_SH" >&2
    exit 1
fi

fail_count=0
pass_count=0

_assert_exit() {
    local expected="$1"
    local got="$2"
    local label="$3"
    if [ "$expected" = "$got" ]; then
        echo "PASS: $label (exit=$got)"
        pass_count=$((pass_count + 1))
    else
        echo "FAIL: $label (expected exit=$expected, got exit=$got)"
        fail_count=$((fail_count + 1))
    fi
}

# Case 1: REVIEW=true, no parent/umbrella => exit 2
env -i PATH="$PATH" HOME="$HOME" \
    LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
    bash "$RUN_SH" --help >/dev/null 2>&1
_assert_exit 2 $? "REVIEW=true without LOKI_MANAGED_AGENTS fails exit 2"

# Case 2: REVIEW=true + parent but no umbrella => exit 2
env -i PATH="$PATH" HOME="$HOME" \
    LOKI_MANAGED_AGENTS=true \
    LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
    bash "$RUN_SH" --help >/dev/null 2>&1
_assert_exit 2 $? "REVIEW=true with parent but no umbrella fails exit 2"

# Case 3: REVIEW=true + parent + umbrella => --help returns 0
env -i PATH="$PATH" HOME="$HOME" \
    LOKI_MANAGED_AGENTS=true \
    LOKI_EXPERIMENTAL_MANAGED_AGENTS=true \
    LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
    bash "$RUN_SH" --help >/dev/null 2>&1
_assert_exit 0 $? "REVIEW=true with parent+umbrella proceeds to --help"

# Case 4: REVIEW unset (default false) => --help returns 0
env -i PATH="$PATH" HOME="$HOME" \
    bash "$RUN_SH" --help >/dev/null 2>&1
_assert_exit 0 $? "REVIEW unset (default) proceeds to --help (v6.83.1 parity)"

echo ""
echo "Results: $pass_count passed, $fail_count failed"
if [ $fail_count -gt 0 ]; then
    exit 1
fi
exit 0
