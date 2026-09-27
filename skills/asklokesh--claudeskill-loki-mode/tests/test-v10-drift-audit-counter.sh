#!/usr/bin/env bash
# Tests scripts/v10-drift-audit-counter.sh: the turn counter that signals
# "DRIFT AUDIT DUE" every 6th call, used by the v10 anti-drift control
# system's UserPromptSubmit hook (docs/v10/CONTROL.md, founder directive).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/v10-drift-audit-counter.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

COUNTER="$WORK/counter"

# ---- Case 1: turns 1-5 must never signal ------------------------------------
all_silent=1
for i in 1 2 3 4 5; do
    out="$(V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT")"
    if [ -n "$out" ]; then
        all_silent=0
        bad "turn $i unexpectedly signaled: [$out]"
    fi
done
[ "$all_silent" -eq 1 ] && ok "turns 1-5 are silent"

# ---- Case 2: turn 6 must signal DRIFT AUDIT DUE -----------------------------
out="$(V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT")"
case "$out" in
    *"DRIFT AUDIT DUE"*) ok "turn 6 signals DRIFT AUDIT DUE" ;;
    *) bad "turn 6 did not signal: [$out]" ;;
esac

# ---- Case 3: turn 7 must go silent again ------------------------------------
out="$(V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT")"
[ -z "$out" ] && ok "turn 7 is silent again" || bad "turn 7 unexpectedly signaled: [$out]"

# ---- Case 4: turn 12 (second multiple of 6) must signal ---------------------
for i in 8 9 10 11; do
    V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT" >/dev/null
done
out="$(V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT")"
case "$out" in
    *"DRIFT AUDIT DUE"*) ok "turn 12 (second multiple of 6) signals" ;;
    *) bad "turn 12 did not signal: [$out]" ;;
esac

# ---- Case 5: a custom V10_DRIFT_AUDIT_EVERY is honored ----------------------
COUNTER2="$WORK/counter2"
for i in 1 2; do
    V10_DRIFT_AUDIT_EVERY=3 V10_DRIFT_COUNTER_FILE="$COUNTER2" bash "$SCRIPT" >/dev/null
done
out="$(V10_DRIFT_AUDIT_EVERY=3 V10_DRIFT_COUNTER_FILE="$COUNTER2" bash "$SCRIPT")"
case "$out" in
    *"DRIFT AUDIT DUE"*) ok "custom every-3 fires on turn 3" ;;
    *) bad "custom every-3 did not fire on turn 3: [$out]" ;;
esac

# ---- Case 6: a corrupted counter file resets to 0 rather than crashing ------
COUNTER3="$WORK/counter3"
printf 'not-a-number\n' > "$COUNTER3"
out="$(V10_DRIFT_COUNTER_FILE="$COUNTER3" bash "$SCRIPT")"
rc=$?
[ "$rc" -eq 0 ] && ok "corrupted counter file does not crash the script" || bad "corrupted counter file caused exit $rc"
new_val="$(cat "$COUNTER3" 2>/dev/null)"
[ "$new_val" = "1" ] && ok "corrupted counter file resets to 1 on next call" || bad "corrupted counter file did not reset correctly: [$new_val]"

# ---- Case 7: exit code is always 0 (never blocks the hook) -----------------
V10_DRIFT_COUNTER_FILE="$COUNTER" bash "$SCRIPT" >/dev/null
rc=$?
[ "$rc" -eq 0 ] && ok "script always exits 0 (never blocks UserPromptSubmit)" || bad "script exited $rc, would block the hook"

echo
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
