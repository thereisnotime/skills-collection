#!/usr/bin/env bash
#===============================================================================
# Test: prd-checklist.sh non-numeric / invalid CHECKLIST_INTERVAL hardening (W4)
#
# Regression test for H5 (FIX-W4-C): prd-checklist.sh is SOURCED into
# autonomy/run.sh which runs `set -uo pipefail`. The interval guard
# (`[ "$x" -le 0 ] 2>/dev/null`) only caught numeric <=0; a non-numeric value
# (e.g. "abc") was retained and later reached the modulo at
# checklist_should_verify (`current_iteration % CHECKLIST_INTERVAL`), where
# arithmetic expansion treated it as an unbound variable name and aborted the
# host loop (EXIT 127). An empty value caused divide-by-zero (EXIT 1).
#
# This test:
#   1. Confirms invalid LOKI_CHECKLIST_INTERVAL normalizes to the default 5.
#   2. Confirms checklist_should_verify does NOT crash under `set -uo pipefail`
#      even when it reaches the modulo (non-vacuous: a real checklist file
#      exists and ITERATION_COUNT is set so the modulo is actually evaluated).
#   3. Confirms a VALID interval is preserved.
#
# Standalone, self-contained, [PASS]/[FAIL] per assertion, nonzero on failure.
#===============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/../autonomy/prd-checklist.sh"

if [ ! -f "$TARGET" ]; then
    echo "[FAIL] target not found: $TARGET"
    exit 1
fi

PASS=0
FAIL=0

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

# Create a real checklist file so checklist_should_verify gets past its
# `[ ! -f "$CHECKLIST_FILE" ]` guard and actually reaches the modulo. Without
# this, the function would short-circuit and the crash path would never run
# (vacuous test).
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/loki-prdck-w4.XXXXXX")"
CHECKLIST_JSON="$WORKDIR/checklist.json"
echo '{"items":[]}' > "$CHECKLIST_JSON"

cleanup() { rm -rf "$WORKDIR" 2>/dev/null || true; }
trap cleanup EXIT

#-------------------------------------------------------------------------------
# probe_interval_value <env_value_for_LOKI_CHECKLIST_INTERVAL>
#
# Sources the real file in a child shell under `set -uo pipefail` with the
# given LOKI_CHECKLIST_INTERVAL, prints the resulting CHECKLIST_INTERVAL on
# stdout. Returns the child exit code (0 = no crash sourcing).
#-------------------------------------------------------------------------------
probe_interval_value() {
    local val="$1"
    LOKI_CHECKLIST_INTERVAL="$val" bash -c '
        set -uo pipefail
        source "'"$TARGET"'"
        printf "%s" "$CHECKLIST_INTERVAL"
    '
}

#-------------------------------------------------------------------------------
# probe_should_verify <env_value_for_LOKI_CHECKLIST_INTERVAL> <iteration_count>
#
# Sources the real file under `set -uo pipefail`, sets up a real checklist
# file, and calls checklist_should_verify with the given ITERATION_COUNT inside
# an `if ...; then` idiom (exactly how run.sh invokes it). Prints "OK" iff the
# function returned without a fatal arithmetic/unbound crash. The child exit
# code is the real signal: 127 (unbound) or 1-from-divzero aborts would NOT
# print "OK" and would yield a nonzero exit.
#-------------------------------------------------------------------------------
probe_should_verify() {
    local val="$1"
    local iter="$2"
    LOKI_CHECKLIST_INTERVAL="$val" \
    LOKI_CHECKLIST_ENABLED="true" \
    ITERATION_COUNT="$iter" \
    CHECKLIST_FILE_OVERRIDE="$CHECKLIST_JSON" \
    bash -c '
        set -uo pipefail
        source "'"$TARGET"'"
        # Point the function at our real checklist file. CHECKLIST_FILE is the
        # internal var checklist_should_verify gates on.
        CHECKLIST_FILE="$CHECKLIST_FILE_OVERRIDE"
        # Invoke exactly like run.sh does: inside an if-condition. A set -u
        # arithmetic error here is unconditionally fatal regardless of context,
        # so reaching the echo proves no crash.
        if checklist_should_verify; then
            :
        fi
        echo "OK"
    '
}

#===============================================================================
# Assertions: invalid values normalize to 5
#===============================================================================
for bad in "abc" "" "2.5" "0" "-3"; do
    label="LOKI_CHECKLIST_INTERVAL=\"$bad\""

    got="$(probe_interval_value "$bad")"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        fail "$label: sourcing crashed under set -uo pipefail (rc=$rc)"
    elif [ "$got" = "5" ]; then
        pass "$label normalizes CHECKLIST_INTERVAL -> 5"
    else
        fail "$label: expected CHECKLIST_INTERVAL=5, got '$got'"
    fi

    # Non-vacuous crash-path check: must reach + survive the modulo. Use
    # ITERATION_COUNT=5 so (5 % 5)=0 exercises the arithmetic with a real file.
    out="$(probe_should_verify "$bad" "5" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "OK"; then
        pass "$label: checklist_should_verify did not crash under set -uo pipefail"
    else
        fail "$label: checklist_should_verify crashed (rc=$rc) out='$out'"
    fi
done

#===============================================================================
# Assertion: a VALID interval is preserved (not clobbered to 5)
#===============================================================================
got="$(probe_interval_value "7")"
rc=$?
if [ "$rc" -eq 0 ] && [ "$got" = "7" ]; then
    pass "LOKI_CHECKLIST_INTERVAL=\"7\" preserved as 7"
else
    fail "LOKI_CHECKLIST_INTERVAL=\"7\": expected 7, got '$got' (rc=$rc)"
fi

# And the default (unset) stays 5.
got="$(bash -c 'set -uo pipefail; unset LOKI_CHECKLIST_INTERVAL 2>/dev/null || true; source "'"$TARGET"'"; printf "%s" "$CHECKLIST_INTERVAL"')"
rc=$?
if [ "$rc" -eq 0 ] && [ "$got" = "5" ]; then
    pass "unset LOKI_CHECKLIST_INTERVAL defaults to 5"
else
    fail "unset LOKI_CHECKLIST_INTERVAL: expected 5, got '$got' (rc=$rc)"
fi

# Valid interval still functions through checklist_should_verify without crash.
out="$(probe_should_verify "5" "5" 2>&1)"
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "OK"; then
    pass "valid interval=5, iter=5: checklist_should_verify runs cleanly"
else
    fail "valid interval=5, iter=5: crashed (rc=$rc) out='$out'"
fi

#===============================================================================
echo "-------------------------------------------------------------------------"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
exit 0
