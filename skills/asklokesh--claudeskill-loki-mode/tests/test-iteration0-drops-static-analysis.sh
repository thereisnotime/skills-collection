#!/usr/bin/env bash
# Iteration-0 evidence drop must also remove static-analysis.pass. Without
# it, a previous session's static-analysis.pass survives into a new session
# that restarts at iteration 0, and the exogenous static_analysis gate reads
# it as a pass of THIS session's work. Extracts and runs the real block out
# of autonomy/run.sh (load_state), not a copy of the logic, so a wrong
# variable or path in run.sh itself would fail this test.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SH="$ROOT/autonomy/run.sh"
TMP="$(mktemp -d -t loki-iter0-static.XXXXXX)"
PASS=0
FAIL=0
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT
ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

REAL="$TMP/real-block.sh"
python3 - "$RUN_SH" > "$REAL" <<'PYEOF'
import sys
s = open(sys.argv[1]).read()
start_marker = "    # A session that starts at iteration 0 has run nothing yet"
tail_marker = 'rm -f "$_q/.test-results.iter"'
try:
    start = s.index(start_marker)
    tail = s.index(tail_marker, start)
    line_end = s.index("\n", tail)
    fi_end = s.index("\n", line_end + 1)
except ValueError:
    sys.exit(1)
print("run_block() {")
print(s[start:fi_end])
print("}")
print("run_block")
PYEOF

if [ ! -s "$REAL" ]; then
    bad "could not extract the iteration-0 evidence-drop block from run.sh (moved or renamed?)"
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
    exit 1
fi

# Also require the writer's static-analysis.pass path to still be exactly
# .loki/quality/static-analysis.pass, so this test cannot drift from the
# real gate writer silently.
if grep -q '.loki/quality/static-analysis.pass' "$RUN_SH"; then
    ok "static-analysis.pass still lives at the writer's known path"
else
    bad "static-analysis.pass path changed in run.sh -- update the extraction marker"
fi

setup_quality_dir() {
    local dir="$1"
    mkdir -p "$dir/.loki/quality"
    printf '1\n' > "$dir/.loki/quality/.test-results.iter"
    printf 'x\n' > "$dir/.loki/quality/unit-tests.pass"
    printf '{}\n' > "$dir/.loki/quality/test-results.json"
    printf 'x\n' > "$dir/.loki/quality/static-analysis.pass"
}

# ---- ITERATION 0: all four stale evidence files must be dropped -----------
ITER0="$TMP/iter0"
setup_quality_dir "$ITER0"
TARGET_DIR="$ITER0" ITERATION_COUNT=0 bash "$REAL"
if [ ! -f "$ITER0/.loki/quality/static-analysis.pass" ]; then
    ok "iteration 0 drops a stale static-analysis.pass"
else
    bad "iteration 0 left a previous session's static-analysis.pass in place"
fi
if [ ! -f "$ITER0/.loki/quality/unit-tests.pass" ] \
   && [ ! -f "$ITER0/.loki/quality/test-results.json" ] \
   && [ ! -f "$ITER0/.loki/quality/.test-results.iter" ]; then
    ok "iteration 0 still drops the original three evidence files"
else
    bad "iteration 0 regressed one of the original evidence drops"
fi

# ---- MID-SESSION (iteration > 0): static-analysis.pass must be KEPT -------
ITERN="$TMP/itern"
setup_quality_dir "$ITERN"
TARGET_DIR="$ITERN" ITERATION_COUNT=3 bash "$REAL"
if [ -f "$ITERN/.loki/quality/static-analysis.pass" ]; then
    ok "a mid-session static-analysis.pass (iteration above 0) is kept"
else
    bad "static-analysis.pass was dropped on a non-zero iteration -- too aggressive"
fi

# ---- CORRUPTED STATE FILE (sibling iteration-0 trigger, S-124 rework) -----
# load_state() has a second reset-to-iteration-0 path for a corrupted/invalid
# state file that returns before the block above ever runs. It must drop
# static-analysis.pass too, or a stale copy survives this trigger.
CORRUPT_BLOCK="$TMP/corrupt-block.sh"
python3 - "$RUN_SH" > "$CORRUPT_BLOCK" <<'PYEOF'
import sys
s = open(sys.argv[1]).read()
start_marker = '            if [ "$state_valid" != "valid" ]; then'
end_marker = "            fi\n"
try:
    start = s.index(start_marker)
    end = s.index(end_marker, start) + len(end_marker)
except ValueError:
    sys.exit(1)
print("run_corrupt_block() {")
print(s[start:end])
print("}")
print("run_corrupt_block")
PYEOF

if [ ! -s "$CORRUPT_BLOCK" ]; then
    bad "could not extract the corrupted-state-file block from run.sh (moved or renamed?)"
else
    ICORRUPT="$TMP/icorrupt"
    setup_quality_dir "$ICORRUPT"
    STATE_FILE="$ICORRUPT/.loki/autonomy-state.json"
    printf '{not valid json' > "$STATE_FILE"
    TARGET_DIR="$ICORRUPT" state_valid="invalid" state_file="$STATE_FILE" \
        bash -c 'log_warn() { :; }; source "$1"' _ "$CORRUPT_BLOCK" >/dev/null 2>&1
    if [ ! -f "$ICORRUPT/.loki/quality/static-analysis.pass" ]; then
        ok "corrupted-state-file restart drops a stale static-analysis.pass"
    else
        bad "corrupted-state-file restart left a previous session's static-analysis.pass in place"
    fi
    if [ ! -f "$ICORRUPT/.loki/quality/unit-tests.pass" ] \
       && [ ! -f "$ICORRUPT/.loki/quality/test-results.json" ] \
       && [ ! -f "$ICORRUPT/.loki/quality/.test-results.iter" ]; then
        ok "corrupted-state-file restart still drops the original three evidence files"
    else
        bad "corrupted-state-file restart regressed one of the original evidence drops"
    fi
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
