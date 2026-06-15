#!/usr/bin/env bash
#
# test-log-debug-stderr.sh
#
# Regression test for the log_debug stdout-pollution bug.
#
# Background: log_debug (autonomy/run.sh) is called inside detect_rate_limit,
# whose return value is captured via command substitution:
#   local rate_limit_wait=$(detect_rate_limit "$iter_output")
# If log_debug writes to STDOUT, then with LOKI_DEBUG=true the captured value
# becomes "[DEBUG] ...\n<number>" instead of just "<number>", and the
# subsequent integer comparison `[ $rate_limit_wait -gt 0 ]` errors out and
# silently skips the rate-limit reset wait. Routing log_debug to STDERR keeps
# any command-substitution capture clean.
#
# This test replicates the exact one-line function (with the >&2 fix) rather
# than sourcing run.sh, which has top-level side effects (PID registry init,
# color vars, etc.). It asserts the debug line never lands in a captured value.

set -uo pipefail

# Color vars referenced by the function body (kept empty for the test).
CYAN=""
NC=""

# Exact replica of the fixed log_debug definition from autonomy/run.sh.
log_debug() { [[ "${LOKI_DEBUG:-}" == "true" ]] && echo -e "${CYAN}[DEBUG]${NC} $*" >&2 || true; }

fail() { echo "FAIL: $1"; exit 1; }

# Case 1: LOKI_DEBUG=true. The debug line must go to stderr, so the captured
# value of `log_debug "hi"; echo 42` must be exactly "42".
LOKI_DEBUG=true
x=$(log_debug "hi"; echo 42)
if [ "$x" != "42" ]; then
    fail "LOKI_DEBUG=true polluted capture: expected '42', got $(printf '%q' "$x")"
fi

# Case 2: confirm the integer comparison the real code performs now succeeds
# (it would error with "integer expression expected" if x were polluted).
if ! [ "$x" -gt 0 ] 2>/dev/null; then
    fail "captured value '$x' is not a clean integer (>0 comparison failed)"
fi

# Case 3: the debug text actually reaches stderr (so debugging still works).
err=$(LOKI_DEBUG=true log_debug "hello-stderr" 2>&1 1>/dev/null)
case "$err" in
    *"hello-stderr"*) : ;;
    *) fail "debug text did not reach stderr: got $(printf '%q' "$err")" ;;
esac

# Case 4: LOKI_DEBUG unset -> no output at all, capture stays clean.
unset LOKI_DEBUG
y=$(log_debug "hi"; echo 7)
if [ "$y" != "7" ]; then
    fail "LOKI_DEBUG unset polluted capture: expected '7', got $(printf '%q' "$y")"
fi

echo "PASS: log_debug routes to stderr; command-substitution captures stay clean"
exit 0
