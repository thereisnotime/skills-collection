#!/usr/bin/env bash
# Run the audit subsystem's Node test suites under the shell runner.
#
# WHY THIS WRAPPER EXISTS: tests/test-manifest-truncation.js and
# tests/audit/crosslink.test.js both existed and passed, and NEITHER was
# registered in tests/run-all-tests.sh, scripts/local-ci.sh, or any workflow --
# so CI had never executed either one. The audit chain is the trust core of the
# receipt wedge, and its tests were the least-run code in the repo.
#
# Node is REQUIRED here rather than skipped. These suites cover the audit trail;
# silently skipping them on a host without node would report a green run that
# measured nothing, which is the exact false-green this subsystem exists to
# prevent. A missing runtime is reported as a failure to measure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-audit-js-suites"

if ! command -v node >/dev/null 2>&1; then
    fail "node unavailable: the audit JS suites did not run (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# Each suite asserted individually, never summed: a count cannot say WHICH
# suite vanished, and picks up slack it was never meant to have.
for suite in \
    "tests/test-witness-reconciliation.js" \
    "tests/test-manifest-truncation.js" \
    "tests/audit/crosslink.test.js"
do
    if [ ! -f "$suite" ]; then
        fail "$suite is missing (registration without a file is a bookkeeping fault)"
        continue
    fi
    out="$(node "$suite" 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ]; then
        pass "$suite"
    else
        fail "$suite (rc=$rc): $(printf '%s' "$out" | grep -iE 'fail|error' | head -2 | tr '\n' ' ')"
    fi
done

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
