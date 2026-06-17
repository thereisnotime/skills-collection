#!/usr/bin/env bash
# tests/test-coverage-measurement.sh -- BEHAVIORAL proof for P0-1 Fix A
# (real test-coverage MEASUREMENT) and P3-5 (run manifest), both in
# autonomy/run.sh (v7.47.0).
#
# Strategy mirrors tests/test-coverage-gate-fail-open.sh: source the real
# run.sh (its main() and self-copy block are gated on BASH_SOURCE==$0, so
# sourcing runs neither), stub the log_* helpers, and drive the real functions
# against throwaway TARGET_DIRs. We read facts back out of the written JSON.
#
# Coverage cases (ITEM 1):
#   (1) go project with real coverage BELOW threshold + LOKI_ENFORCE_COVERAGE=1
#       => enforce_test_coverage returns nonzero (BLOCK) AND coverage.json
#          records measured:true, blocked:true, pct < threshold. Requires `go`.
#   (2) go project with coverage ABOVE threshold + LOKI_ENFORCE_COVERAGE=1
#       => returns 0 (PASS) AND coverage.json blocked:false. Requires `go`.
#   (3) no coverage tool / unsupported runner (a passing node --test project,
#       whose runner has no coverage path here) => measured:false, blocked:false,
#       gate NOT blocked (rc 0), reason recorded honestly. Requires `node`.
#   (3b) coverage block must NOT write TESTS_FAILED nor remove unit-tests.pass
#        (coverage-low is distinct from tests-red). Requires `go`.
#
# Manifest case (ITEM 2):
#   (4) build_completion_summary emits .loki/loki-run.json with the expected
#       keys. Needs no external tooling beyond python3 + git.
#
# IMPORTANT: do NOT set LOKI_RUNNING_FROM_TEMP=1 (would arm an EXIT trap that
# deletes BASH_SOURCE[0], i.e. this test file).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed. (Not a fail.)"; exit 0
fi
if [ ! -f "$RUN_SH" ]; then
    echo "SKIP: autonomy/run.sh not found. (Not a fail.)"; exit 0
fi

WORK="$(mktemp -d /tmp/loki-test-covmeas-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# Source the runner. Self-copy block + main() are inert when sourced.
# shellcheck disable=SC1090
. "$RUN_SH"

log_info()    { :; }
log_warn()    { :; }
log_error()   { :; }
log_success() { :; }
log_step()    { :; }
log_header()  { :; }

if ! type enforce_test_coverage >/dev/null 2>&1; then
    echo "SKIP: enforce_test_coverage not defined. (Not a fail.)"; exit 0
fi
if ! type measure_test_coverage >/dev/null 2>&1; then
    echo "SKIP: measure_test_coverage not defined (P0-1 Fix A not landed). (Not a fail.)"; exit 0
fi

read_cov() {
    local proj="$1" field="$2"
    _F="$proj/.loki/quality/coverage.json" _K="$field" python3 -c "
import json, os, sys
try:
    d=json.load(open(os.environ['_F']))
except Exception:
    sys.exit(0)
v=d.get(os.environ['_K'])
sys.stdout.write(json.dumps(v))
" 2>/dev/null || echo ""
}

run_gate() {
    local proj="$1"; shift
    (
        TARGET_DIR="$proj"; export TARGET_DIR
        LOKI_GATE_TIMEOUT=120; export LOKI_GATE_TIMEOUT
        # Pass through any extra env (e.g. LOKI_ENFORCE_COVERAGE) via caller env.
        enforce_test_coverage
    )
}

# ===========================================================================
# go-based cases. go test -cover gives us a real below/above pair locally.
# ===========================================================================
if command -v go >/dev/null 2>&1; then
    # --- Case (1): coverage BELOW threshold + enforce => BLOCK -------------
    # add() is covered by a test; sub() is NOT -> ~50% line coverage. Threshold
    # forced to 80 so this is measurably below.
    PB="$WORK/go-below"
    mkdir -p "$PB"
    cat > "$PB/go.mod" <<'EOF'
module cov.below

go 1.21
EOF
    cat > "$PB/calc.go" <<'EOF'
package calc

func Add(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
func Mul(a, b int) int { return a * b }
func Div(a, b int) int { if b == 0 { return 0 }; return a / b }
EOF
    cat > "$PB/calc_test.go" <<'EOF'
package calc

import "testing"

func TestAdd(t *testing.T) {
    if Add(2, 3) != 5 { t.Fatal("add") }
}
EOF
    if (cd "$PB" && TARGET_DIR="$PB" LOKI_GATE_TIMEOUT=120 LOKI_MIN_COVERAGE=80 LOKI_ENFORCE_COVERAGE=1 enforce_test_coverage); then
        b1_rc=0
    else
        b1_rc=$?
    fi
    b1_measured="$(read_cov "$PB" measured)"
    b1_blocked="$(read_cov "$PB" blocked)"
    b1_pct="$(read_cov "$PB" pct)"
    if [ "$b1_measured" = "true" ] && [ "$b1_blocked" = "true" ] && [ "$b1_rc" -ne 0 ]; then
        ok "(1) go coverage below threshold + ENFORCE=1 BLOCKS (rc=$b1_rc, pct=$b1_pct, blocked=true)"
    else
        bad "(1) below-threshold did not block" "measured=$b1_measured blocked=$b1_blocked pct=$b1_pct rc=$b1_rc"
    fi

    # (3b) coverage block must NOT write TESTS_FAILED nor remove unit-tests.pass.
    if [ ! -f "$PB/.loki/signals/TESTS_FAILED" ]; then
        ok "(3b) coverage block did NOT write TESTS_FAILED signal (distinct from tests-red)"
    else
        bad "(3b) coverage block wrote TESTS_FAILED" "tests passed; coverage-low must not look like tests-red"
    fi
    if [ -f "$PB/.loki/quality/unit-tests.pass" ]; then
        ok "(3b) coverage block kept unit-tests.pass (tests genuinely passed)"
    else
        bad "(3b) coverage block removed unit-tests.pass" "tests passed; marker must remain"
    fi

    # --- Case (2): coverage ABOVE threshold + enforce => PASS -------------
    # Every function is covered -> 100%. Threshold 80. Must pass.
    PA="$WORK/go-above"
    mkdir -p "$PA"
    cat > "$PA/go.mod" <<'EOF'
module cov.above

go 1.21
EOF
    cat > "$PA/calc.go" <<'EOF'
package calc

func Add(a, b int) int { return a + b }
EOF
    cat > "$PA/calc_test.go" <<'EOF'
package calc

import "testing"

func TestAdd(t *testing.T) {
    if Add(2, 3) != 5 { t.Fatal("add") }
}
EOF
    if (cd "$PA" && TARGET_DIR="$PA" LOKI_GATE_TIMEOUT=120 LOKI_MIN_COVERAGE=80 LOKI_ENFORCE_COVERAGE=1 enforce_test_coverage); then
        a2_rc=0
    else
        a2_rc=$?
    fi
    a2_measured="$(read_cov "$PA" measured)"
    a2_blocked="$(read_cov "$PA" blocked)"
    a2_pct="$(read_cov "$PA" pct)"
    if [ "$a2_measured" = "true" ] && [ "$a2_blocked" = "false" ] && [ "$a2_rc" -eq 0 ]; then
        ok "(2) go coverage above threshold + ENFORCE=1 PASSES (rc=0, pct=$a2_pct, blocked=false)"
    else
        bad "(2) above-threshold did not pass" "measured=$a2_measured blocked=$a2_blocked pct=$a2_pct rc=$a2_rc"
    fi
else
    echo "SKIP: go not on PATH; cases (1),(2),(3b) require it. (Not a fail.)"
fi

# ===========================================================================
# Case (3): no coverage tool / unsupported runner => measured:false, NOT blocked.
# A node --test project: its runner ('node-test') has no coverage path in
# measure_test_coverage, so coverage is recorded as not-measured and the gate
# passes through (rc 0) even with ENFORCE=1.
# ===========================================================================
if command -v node >/dev/null 2>&1; then
    PN="$WORK/node-nocov"
    mkdir -p "$PN"
    cat > "$PN/package.json" <<'EOF'
{ "name": "node-nocov", "version": "1.0.0", "scripts": { "test": "node --test" } }
EOF
    cat > "$PN/app.test.js" <<'EOF'
const { test } = require('node:test');
const assert = require('node:assert');
test('adds', () => { assert.strictEqual(1 + 1, 2); });
EOF
    if (cd "$PN" && TARGET_DIR="$PN" LOKI_GATE_TIMEOUT=60 LOKI_MIN_COVERAGE=80 LOKI_ENFORCE_COVERAGE=1 enforce_test_coverage); then
        n3_rc=0
    else
        n3_rc=$?
    fi
    n3_measured="$(read_cov "$PN" measured)"
    n3_blocked="$(read_cov "$PN" blocked)"
    n3_reason="$(read_cov "$PN" reason)"
    if [ "$n3_measured" = "false" ] && [ "$n3_blocked" = "false" ] && [ "$n3_rc" -eq 0 ]; then
        ok "(3) no-coverage-tool runner: measured:false + not blocked + rc 0 (pass-through) reason=$n3_reason"
    else
        bad "(3) no-coverage pass-through broken" "measured=$n3_measured blocked=$n3_blocked rc=$n3_rc reason=$n3_reason"
    fi
    # Non-fabrication: pct must be null when not measured.
    n3_pct="$(read_cov "$PN" pct)"
    if [ "$n3_pct" = "null" ]; then
        ok "(3) not-measured pct is null (no fabricated number)"
    else
        bad "(3) fabricated coverage pct on not-measured" "pct=$n3_pct (expected null)"
    fi
else
    echo "SKIP: node not on PATH; case (3) requires it. (Not a fail.)"
fi

# ===========================================================================
# Case (4): run manifest. build_completion_summary must emit .loki/loki-run.json
# with the expected keys. Driven against a throwaway git repo so the git fields
# populate; works with only python3 + git.
# ===========================================================================
if type build_completion_summary >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
    PM="$WORK/manifest-proj"
    mkdir -p "$PM"
    (
        cd "$PM" || exit 1
        export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
        git init -q
        git config user.email "test@loki.local"
        git config user.name "Loki Test"
        git config commit.gpgsign false
        echo "spec body" > prd.md
        echo "code" > app.txt
        git add -A
        git commit -q --no-gpg-sign --no-verify -m "init" 2>/dev/null
    )
    (
        cd "$PM" || exit 1
        export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
        TARGET_DIR="$PM"; export TARGET_DIR
        PRD_PATH="$PM/prd.md"; export PRD_PATH
        ITERATION_COUNT=3; export ITERATION_COUNT
        CURRENT_TIER="development"; export CURRENT_TIER
        PROVIDER_NAME="claude"; export PROVIDER_NAME
        _LOKI_RUN_START_SHA="$(git rev-parse HEAD)"; export _LOKI_RUN_START_SHA
        build_completion_summary complete >/dev/null 2>&1 || true
    )
    MAN="$PM/.loki/loki-run.json"
    if [ -f "$MAN" ]; then
        ok "(4) .loki/loki-run.json emitted"
    else
        bad "(4) manifest not emitted" "missing $MAN"
    fi
    # Validate expected keys + a few honest values.
    if _M="$MAN" python3 -c "
import json, os, sys
d=json.load(open(os.environ['_M']))
req = ['schema','loki_version','timestamp','outcome','iterations','provider',
       'last_tier','spec','git','tool_versions','evidence']
missing=[k for k in req if k not in d]
if missing:
    sys.stderr.write('missing keys: %s\n' % missing); sys.exit(1)
# spec sub-keys
for k in ('path','sha256'):
    if k not in d['spec']: sys.stderr.write('spec.%s missing\n'%k); sys.exit(1)
# evidence sub-keys
for k in ('test_results','coverage','completion'):
    if k not in d['evidence']: sys.stderr.write('evidence.%s missing\n'%k); sys.exit(1)
# honest values
assert d['outcome']=='complete', d['outcome']
assert d['iterations']==3, d['iterations']
assert d['provider']=='claude', d['provider']
assert d['spec']['path'].endswith('prd.md'), d['spec']['path']
assert d['spec']['sha256'], 'spec hash should be present for a real file'
assert d['git']['head_sha'], 'head_sha should populate in a git repo'
sys.exit(0)
" 2>"$WORK/man.err"; then
        ok "(4) manifest has all expected keys + honest values (outcome/iterations/provider/spec-hash/head_sha)"
    else
        bad "(4) manifest keys/values" "$(cat "$WORK/man.err" 2>/dev/null)"
    fi
else
    echo "SKIP: build_completion_summary or git unavailable; case (4) skipped. (Not a fail.)"
fi

echo "----"
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
