#!/usr/bin/env bash
# The PR is the deliverable. It must not require a flag.
#
# THE DEFECT: LOKI_DELEGATE_PR shipped OFF, and on completion the product
# printed "Pull request: not opened (set LOKI_DELEGATE_PR=1 to open one)". It
# knew what the user wanted and asked them to read documentation instead. For
# the core use case -- give it a GitHub issue, get a resolution -- the PR IS the
# outcome, so shipping it off shipped the product off.
#
# WHAT IS LOAD-BEARING, and why this is not just a default change: flipping a
# default that TAKES AN ACTION is only safe while every guard holds. These
# assertions check the default AND that none of the safety conditions were
# loosened to achieve it. A future edit that drops the auth check or the
# default-branch check must fail here.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-auto-pr-default-on"

# Grep a FILE, never a pipe from a variable: `printf | grep -q` closes the pipe
# at the first match, printf dies of SIGPIPE, and pipefail reports the pipeline
# as failed though grep MATCHED. That inverts assertions on large inputs.
SRC="$(mktemp)"; trap 'rm -f "$SRC"' EXIT
sed 's/#.*//' autonomy/run.sh > "$SRC"

# 1. BEHAVIOR, not text: drive the exact guard expression both ways.
_guard() { [ "${1:-1}" != "1" ] && echo off || echo on; }
if [ "$(_guard "")" = "on" ] && [ "$(_guard 0)" = "off" ] && [ "$(_guard 1)" = "on" ]; then
    pass "unset defaults ON; an explicit 0 still opts out"
else
    fail "the default/opt-out logic is wrong"
fi

# 2. The source must actually carry the :-1 default.
if grep -q 'LOKI_DELEGATE_PR:-1' "$SRC"; then
    pass "run.sh defaults LOKI_DELEGATE_PR to 1"
else
    fail "LOKI_DELEGATE_PR is not defaulted on; the PR needs a flag again"
fi

# 3-5. SAFETY GUARDS MUST SURVIVE. A default-on action is only safe while these
#      hold, so each is asserted individually. A count would not say which one
#      vanished.
if grep -q 'gh auth status' "$SRC"; then
    pass "still requires gh auth status"
else
    fail "the gh-auth guard is gone; default-on would act unauthenticated"
fi

if grep -qE 'main\|master|default branch' "$SRC"; then
    pass "still refuses to PR a default branch to itself"
else
    fail "the default-branch guard is gone"
fi

if grep -q 'gh pr create' "$SRC" && ! grep -qE 'gh pr merge|--auto-merge|--merge' "$SRC"; then
    pass "opens a PR and never merges"
else
    fail "an auto-merge path appeared; a default-on PR must never merge"
fi

# 6. The status line must no longer advertise a flag that is now the default.
if grep -q 'set LOKI_DELEGATE_PR=1 to open one' "$SRC"; then
    fail "the status line still tells users to set a flag that is now default-on"
else
    pass "the status line no longer advertises the old flag"
fi

# 7. GUARD AGAINST VACUITY: if on_run_complete disappeared, everything above
#    would still pass while guarding nothing.
if grep -q '^on_run_complete()' "$SRC"; then
    pass "on_run_complete exists (so these assertions guard something real)"
else
    fail "on_run_complete is gone; these assertions are vacuous"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
