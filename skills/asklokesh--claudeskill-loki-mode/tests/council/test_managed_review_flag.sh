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

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/loki-managed-review-flag.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

# Marker for the isolation check at the bottom: anything at REPO_ROOT's
# provider file OLDER than this predates this test run and is not ours to
# blame (another suite in the same shared checkout may legitimately write it).
# The 1s sleep guards the `-nt` comparison below against same-second mtime
# granularity (measured: without it, bash 3.2's `-nt` can read a marker and a
# same-second contaminating write as simultaneous and pass vacuously).
PROBE_START="$SCRATCH/.probe-start"
touch "$PROBE_START"
sleep 1

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

# Every case cd's into SCRATCH before invoking run.sh: run.sh startup runs
# provider auto-detection, which does `mkdir -p .loki/state && echo ... >
# .loki/state/provider` relative to CWD -- even on a --help exit. If CWD is
# still $REPO_ROOT that writes into the shared checkout and contaminates every
# later test in the same shell (same bug class as test-iteration-grace.sh and
# test-exit-code-contract.sh). Measured: `bash autonomy/run.sh --help` alone
# writes .loki/state/provider in the CWD it is run from.

# Case 1: REVIEW=true, no parent/umbrella => exit 2
(
    cd "$SCRATCH" || exit 1
    env -i PATH="$PATH" HOME="$HOME" \
        LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
        bash "$RUN_SH" --help >/dev/null 2>&1
)
_assert_exit 2 $? "REVIEW=true without LOKI_MANAGED_AGENTS fails exit 2"

# Case 2: REVIEW=true + parent but no umbrella => exit 2
(
    cd "$SCRATCH" || exit 1
    env -i PATH="$PATH" HOME="$HOME" \
        LOKI_MANAGED_AGENTS=true \
        LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
        bash "$RUN_SH" --help >/dev/null 2>&1
)
_assert_exit 2 $? "REVIEW=true with parent but no umbrella fails exit 2"

# Case 3: REVIEW=true + parent + umbrella => --help returns 0
(
    cd "$SCRATCH" || exit 1
    env -i PATH="$PATH" HOME="$HOME" \
        LOKI_MANAGED_AGENTS=true \
        LOKI_EXPERIMENTAL_MANAGED_AGENTS=true \
        LOKI_EXPERIMENTAL_MANAGED_REVIEW=true \
        bash "$RUN_SH" --help >/dev/null 2>&1
)
_assert_exit 0 $? "REVIEW=true with parent+umbrella proceeds to --help"

# Case 4: REVIEW unset (default false) => --help returns 0
(
    cd "$SCRATCH" || exit 1
    env -i PATH="$PATH" HOME="$HOME" \
        bash "$RUN_SH" --help >/dev/null 2>&1
)
_assert_exit 0 $? "REVIEW unset (default) proceeds to --help (v6.83.1 parity)"

# --- isolation: running run.sh must never touch the shared checkout --------
# Positive control: SCRATCH must show its own provider file did get written.
# Without this, disabling the mkdir entirely (or the probe silently no-op-ing)
# would also read as "isolated" -- the check would pass for the wrong reason.
if [ -f "$SCRATCH/.loki/state/provider" ]; then
    echo "PASS: control: running run.sh --help still exercises provider auto-detection (writes to its own scratch dir)"
    pass_count=$((pass_count + 1))
else
    echo "FAIL: control: running run.sh --help still exercises provider auto-detection (writes to its own scratch dir)"
    fail_count=$((fail_count + 1))
fi

if [ "$REPO_ROOT/.loki/state/provider" -nt "$PROBE_START" ]; then
    echo "FAIL: running run.sh --help left .loki/state/provider newer in the repo checkout"
    fail_count=$((fail_count + 1))
else
    echo "PASS: running run.sh --help left no .loki/state/provider in the repo checkout"
    pass_count=$((pass_count + 1))
fi

echo ""
echo "Results: $pass_count passed, $fail_count failed"
if [ $fail_count -gt 0 ]; then
    exit 1
fi
exit 0
