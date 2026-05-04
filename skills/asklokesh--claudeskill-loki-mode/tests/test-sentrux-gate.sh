#!/usr/bin/env bash
#===============================================================================
# Unit tests for autonomy/lib/sentrux-gate.sh (v7.5.14).
#
# These tests exercise the parser/JSON-reader contract WITHOUT requiring the
# sentrux binary to be installed. We synthesize a fake `sentrux` on PATH that
# emits canned outputs matching the real v0.5.7 surface, plus deliberate edge
# cases (empty stdout, malformed JSON, missing baseline file). The goal is to
# verify the helper degrades gracefully on every failure mode the integration
# might hit in the wild.
#
# A separate integration test (tests/integration/test_sentrux_real.sh) covers
# the real binary against a real fixture.
#===============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$REPO_ROOT/autonomy/lib/sentrux-gate.sh"

PASS=0
FAIL=0
TMPROOT=""

ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup() {
    if [ -n "$TMPROOT" ] && [ -d "$TMPROOT" ]; then
        rm -rf "$TMPROOT"
    fi
}
trap cleanup EXIT

#-------------------------------------------------------------------------------
# Static checks first.
#-------------------------------------------------------------------------------
if bash -n "$HELPER" 2>/dev/null; then
    ok "sentrux-gate.sh parses with bash -n"
else
    bad "sentrux-gate.sh failed bash -n parse"
fi

if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S error "$HELPER" >/dev/null 2>&1; then
        ok "sentrux-gate.sh shellcheck -S error clean"
    else
        bad "sentrux-gate.sh shellcheck -S error reported issues"
    fi
else
    ok "SKIP: shellcheck not on PATH; static check skipped"
fi

#-------------------------------------------------------------------------------
# Build a tmpdir + fake sentrux binary on PATH that emits canned v0.5.7 output.
#-------------------------------------------------------------------------------
TMPROOT=$(mktemp -d -t loki-sentrux-test.XXXXXX)
FAKE_BIN_DIR="$TMPROOT/bin"
mkdir -p "$FAKE_BIN_DIR"

# Fake binary supports: --version, gate --save <path>, gate <path>.
# Behavior is controlled by the SENTRUX_FAKE_MODE env var so each test
# can swap the response without touching disk.
cat > "$FAKE_BIN_DIR/sentrux" <<'FAKE'
#!/usr/bin/env bash
case "${1:-}" in
    --version)
        echo "sentrux 0.5.7"
        exit 0
        ;;
    gate)
        if [ "${2:-}" = "--save" ]; then
            target="${3:-.}"
            mkdir -p "$target/.sentrux"
            cat > "$target/.sentrux/baseline.json" <<JSON
{
  "timestamp": 1777856479.15692,
  "quality_signal": 0.7841,
  "coupling_score": 1.0,
  "cycle_count": 0,
  "god_file_count": 0,
  "hotspot_count": 0,
  "complex_fn_count": 0,
  "max_depth": 1,
  "total_import_edges": 1,
  "cross_module_edges": 1
}
JSON
            echo "Baseline saved to $target/.sentrux/baseline.json"
            echo "Quality: 7841"
            exit 0
        fi
        case "${SENTRUX_FAKE_MODE:-ok}" in
            ok)
                cat <<EOF
sentrux gate -- structural regression check

Quality:      7841 -> 7841
Coupling:     1.00 -> 1.00
Cycles:       0 -> 0
God files:    0 -> 0

No degradation detected
EOF
                exit 0
                ;;
            degraded)
                cat <<EOF
sentrux gate -- structural regression check

Quality:      7841 -> 6853
Coupling:     1.00 -> 0.47
Cycles:       0 -> 0
God files:    0 -> 0

DEGRADED
  Quality signal dropped: 0.78 -> 0.69 (-0.10)
EOF
                exit 1
                ;;
            empty)
                exit 1
                ;;
            garbage)
                echo "totally unrelated text without a Quality line"
                exit 0
                ;;
        esac
        ;;
esac
exit 1
FAKE
chmod +x "$FAKE_BIN_DIR/sentrux"

export PATH="$FAKE_BIN_DIR:$PATH"

# shellcheck disable=SC1090
. "$HELPER"

#-------------------------------------------------------------------------------
# Test: sentrux_available reports the fake binary.
#-------------------------------------------------------------------------------
if sentrux_available; then
    ok "sentrux_available returns 0 when binary on PATH"
else
    bad "sentrux_available returned 1 even though fake binary is on PATH"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_version extracts the X.Y.Z token.
#-------------------------------------------------------------------------------
ver=$(sentrux_version)
if [ "$ver" = "0.5.7" ]; then
    ok "sentrux_version parses '0.5.7' from --version output"
else
    bad "sentrux_version returned [$ver] instead of [0.5.7]"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_baseline_save writes the baseline.json file.
#-------------------------------------------------------------------------------
PROJ="$TMPROOT/proj"
mkdir -p "$PROJ/src"
echo "x" > "$PROJ/src/a.ts"

if sentrux_baseline_save "$PROJ"; then
    ok "sentrux_baseline_save returns 0 on success"
else
    bad "sentrux_baseline_save returned non-zero on a writable path"
fi

if [ -f "$PROJ/.sentrux/baseline.json" ]; then
    ok "baseline.json is created at the expected location"
else
    bad "baseline.json was not created"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_baseline_quality reads the JSON and returns int 0..10000.
#-------------------------------------------------------------------------------
q=$(sentrux_baseline_quality "$PROJ")
if [ "$q" = "7841" ]; then
    ok "sentrux_baseline_quality returns 7841 for quality_signal=0.7841"
else
    bad "sentrux_baseline_quality returned [$q] instead of [7841]"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_baseline_quality returns empty + non-zero on missing file.
#-------------------------------------------------------------------------------
PROJ_EMPTY="$TMPROOT/empty"
mkdir -p "$PROJ_EMPTY"
q=$(sentrux_baseline_quality "$PROJ_EMPTY")
exit_code=$?
if [ -z "$q" ] && [ "$exit_code" -ne 0 ]; then
    ok "sentrux_baseline_quality returns empty + non-zero on missing baseline"
else
    bad "sentrux_baseline_quality should return empty + non-zero on missing baseline (got [$q] exit=$exit_code)"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_baseline_quality handles malformed JSON gracefully.
#-------------------------------------------------------------------------------
PROJ_BAD="$TMPROOT/badjson"
mkdir -p "$PROJ_BAD/.sentrux"
echo "not even close to json" > "$PROJ_BAD/.sentrux/baseline.json"
q=$(sentrux_baseline_quality "$PROJ_BAD")
exit_code=$?
if [ -z "$q" ] && [ "$exit_code" -ne 0 ]; then
    ok "sentrux_baseline_quality degrades cleanly on malformed JSON"
else
    bad "sentrux_baseline_quality should fail on malformed JSON (got [$q] exit=$exit_code)"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_baseline_quality handles missing quality_signal field.
#-------------------------------------------------------------------------------
PROJ_NOQ="$TMPROOT/noquality"
mkdir -p "$PROJ_NOQ/.sentrux"
echo '{"timestamp": 123, "coupling_score": 1.0}' > "$PROJ_NOQ/.sentrux/baseline.json"
q=$(sentrux_baseline_quality "$PROJ_NOQ")
exit_code=$?
if [ -z "$q" ] && [ "$exit_code" -ne 0 ]; then
    ok "sentrux_baseline_quality returns empty when quality_signal absent"
else
    bad "sentrux_baseline_quality should fail when quality_signal absent (got [$q] exit=$exit_code)"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_gate_diff parses an OK verdict.
#-------------------------------------------------------------------------------
export SENTRUX_FAKE_MODE=ok
diff_ok=$(sentrux_gate_diff "$PROJ")
if [ "$diff_ok" = "7841|7841|OK" ]; then
    ok "sentrux_gate_diff parses OK verdict (7841|7841|OK)"
else
    bad "sentrux_gate_diff OK case returned [$diff_ok]"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_gate_diff parses DEGRADED even when sentrux exits non-zero.
#-------------------------------------------------------------------------------
export SENTRUX_FAKE_MODE=degraded
diff_deg=$(sentrux_gate_diff "$PROJ")
if [ "$diff_deg" = "7841|6853|DEGRADED" ]; then
    ok "sentrux_gate_diff parses DEGRADED verdict despite non-zero exit code"
else
    bad "sentrux_gate_diff DEGRADED case returned [$diff_deg]"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_gate_diff returns ||UNKNOWN on empty sentrux output.
#-------------------------------------------------------------------------------
export SENTRUX_FAKE_MODE=empty
diff_empty=$(sentrux_gate_diff "$PROJ")
if [ "$diff_empty" = "||UNKNOWN" ]; then
    ok "sentrux_gate_diff returns ||UNKNOWN on empty sentrux output"
else
    bad "sentrux_gate_diff empty case returned [$diff_empty]"
fi

#-------------------------------------------------------------------------------
# Test: sentrux_gate_diff returns ||UNKNOWN when output lacks Quality line.
#-------------------------------------------------------------------------------
export SENTRUX_FAKE_MODE=garbage
diff_garbage=$(sentrux_gate_diff "$PROJ")
if [ "$diff_garbage" = "||UNKNOWN" ]; then
    ok "sentrux_gate_diff returns ||UNKNOWN on output missing Quality line"
else
    bad "sentrux_gate_diff garbage case returned [$diff_garbage]"
fi

#-------------------------------------------------------------------------------
# Test: helpers degrade cleanly when sentrux is NOT on PATH.
#-------------------------------------------------------------------------------
(
    PATH="/usr/bin:/bin"
    if sentrux_available; then
        printf 'FAIL: sentrux_available returned 0 with sentrux off PATH\n'
        exit 2
    fi
    if sentrux_baseline_save "$PROJ"; then
        printf 'FAIL: sentrux_baseline_save returned 0 with sentrux off PATH\n'
        exit 2
    fi
    if sentrux_gate_diff "$PROJ" >/dev/null 2>&1; then
        printf 'FAIL: sentrux_gate_diff returned 0 with sentrux off PATH\n'
        exit 2
    fi
    exit 0
)
sub_exit=$?
if [ "$sub_exit" -eq 0 ]; then
    ok "All helpers return non-zero when sentrux is unavailable"
else
    bad "Helpers did not all degrade gracefully when sentrux off PATH"
fi

echo
echo "=========================================="
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
echo "=========================================="
[ "$FAIL" -eq 0 ]
