#!/usr/bin/env bash
#===============================================================================
# RANK 4: Golden-master Boundary-Equivalence Gate Tests
#
# Regression coverage for the boundary-preservation bug: the modernize->validate
# phase gate (hook_healing_phase_gate) checked only the whole-suite exit code.
# A transform can keep unit tests green while ALTERING an observable boundary
# (CLI stdout/exit, HTTP, file/DB delta). Before this fix such a change PASSED
# the gate; behavioral-baseline/ was mkdir'd but NEVER populated.
#
# After the fix:
#   - hook_capture_behavioral_baseline populates behavioral-baseline/ with one
#     golden-master artifact per detected boundary (features.json
#     characterization_test commands), recording stdout + exit + the reproduction
#     command.
#   - hook_compare_behavioral_baseline re-runs each boundary at validate time and
#     BLOCKS any undocumented boundary change, emitting a per-boundary diff report.
#   - A behavior-preserving refactor (identical output) still PASSES.
#   - A documented-intentional-change record (per-boundary) makes an intended
#     change PASS; a record for a DIFFERENT boundary still BLOCKS.
#   - Honest degrade: no baseline / no boundaries / heal mode off -> no-op
#     fall-through (never a false-green).
#
# Deterministic (NOT LLM). Consistent with the migration-hooks.sh contract.
#===============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PASS=0
FAIL=0
TOTAL=0
pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo "  [FAIL] $1"; [[ -n "${2:-}" ]] && echo "         $2"; }

echo "Golden-master Boundary-Equivalence Gate Tests"
echo "============================================="
echo ""

# shellcheck disable=SC1090
source "$PROJECT_DIR/autonomy/hooks/migration-hooks.sh"
set +e

# Build a fixture codebase with a CLI boundary + an EXIT-ONLY unit test.
# $1 = dir, $2 = calc rule variant (v1|change|refactor)
build_fixture() {
    local fix="$1" variant="${2:-v1}"
    rm -rf "$fix"
    mkdir -p "$fix/.loki/healing/behavioral-baseline" "$fix/tests"
    cat > "$fix/pyproject.toml" <<'TOML'
[project]
name = "fix"
version = "0.0.0"
TOML
    # unit test asserts EXIT CODE ONLY (the wedge; stays green across a boundary
    # change). Written as a stdlib unittest.TestCase so the whole-suite check is
    # portable to ANY python3 (CI has no pytest); pytest would also collect this
    # class, but the gate command below uses `python3 -m unittest` to stay
    # dependency-free. This genuinely RUNS the assertion (not a vacuous 0-test
    # pass): `unittest discover` finds TestCase subclasses, and the subprocess
    # exit-code assert executes.
    cat > "$fix/tests/test_calc.py" <<PY
import subprocess, sys, os, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class TestCalc(unittest.TestCase):
    def test_runs_ok(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "calc.py"), "5"])
        self.assertEqual(r.returncode, 0)
if __name__ == "__main__":
    unittest.main()
PY
    write_calc "$fix" "$variant"
    cat > "$fix/.loki/healing/features.json" <<JSON
[{"id":"F01","category":"cli","boundary_type":"cli","description":"calc CLI","characterization_test":"python3 $fix/calc.py 5","passes":true,"risk":"high"}]
JSON
}

write_calc() {
    local fix="$1" variant="${2:-v1}"
    case "$variant" in
        v1)       local expr="sum(range(1, n + 1))" ;;   # -> RESULT=15
        change)   local expr="sum(range(1, n + 2))" ;;   # -> RESULT=21 (boundary change)
        refactor) local expr="n * (n + 1) // 2" ;;       # -> RESULT=15 (identical output)
    esac
    cat > "$fix/calc.py" <<PY
#!/usr/bin/env python3
import sys
def compute(n):
    return $expr
if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    print("RESULT=%d" % compute(n))
    sys.exit(0)
PY
}

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not available; skipping (environment gap, not a failure)."
    exit 0
fi

# ---------------------------------------------------------------------------
# Test 1: capture populates behavioral-baseline/ (was NEVER populated = 0)
# ---------------------------------------------------------------------------
echo "Test 1: hook_capture_behavioral_baseline populates behavioral-baseline/"
FIX="$(mktemp -d)/cb"; build_fixture "$FIX" v1
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX" hook_capture_behavioral_baseline "$FIX" >/dev/null 2>&1
CNT=$(find "$FIX/.loki/healing/behavioral-baseline" -type f -name 'boundary-*.json' 2>/dev/null | wc -l | tr -d ' ')
[[ "$CNT" -ge 1 ]] && pass "captured $CNT golden-master artifact(s) (>0)" || fail "expected >=1 baseline artifact, got $CNT"

# ---------------------------------------------------------------------------
# Test 2: boundary-changing transform (unit tests green) -> gate BLOCKS
# ---------------------------------------------------------------------------
echo "Test 2: boundary change with green unit tests -> gate BLOCKS"
write_calc "$FIX" change   # baseline (RESULT=15) survives; boundary now RESULT=21
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX" \
    LOKI_TEST_COMMAND="cd '$FIX' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]] && echo "$out" | grep -q "GATE_BLOCKED: boundary equivalence violated"; then
    if echo "$out" | grep -q "cli:F01"; then
        pass "gate BLOCKED and diff report names the changed boundary (cli:F01)"
    else
        fail "gate blocked but diff report did not name the boundary" "$out"
    fi
else
    fail "gate should BLOCK a boundary change; got rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 3: behavior-preserving refactor (identical output) -> gate ALLOWS
# ---------------------------------------------------------------------------
echo "Test 3: behavior-preserving refactor -> gate ALLOWS"
FIX2="$(mktemp -d)/rf"; build_fixture "$FIX2" v1
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX2" hook_capture_behavioral_baseline "$FIX2" >/dev/null 2>&1
write_calc "$FIX2" refactor   # same output, different implementation
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX2" \
    LOKI_TEST_COMMAND="cd '$FIX2' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -eq 0 ]] && echo "$out" | grep -q "equivalent to golden-master"; then
    pass "gate ALLOWED equivalence-preserving refactor"
else
    fail "gate should ALLOW a behavior-preserving refactor; got rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 4: documented-intentional record (per-boundary) -> gate ALLOWS
# ---------------------------------------------------------------------------
echo "Test 4: documented-intentional boundary change -> gate ALLOWS"
FIX3="$(mktemp -d)/di"; build_fixture "$FIX3" v1
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX3" hook_capture_behavioral_baseline "$FIX3" >/dev/null 2>&1
write_calc "$FIX3" change
cat > "$FIX3/.loki/healing/behavioral-baseline/intentional-changes.json" <<'JSON'
{"changes":[{"boundary":"cli:F01","is_intentional":true,"reason":"approved rule change"}]}
JSON
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX3" \
    LOKI_TEST_COMMAND="cd '$FIX3' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -eq 0 ]] && echo "$out" | grep -q "documented-intentional"; then
    pass "gate ALLOWED a documented-intentional boundary change"
else
    fail "gate should ALLOW a documented boundary change; got rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 5: intentional record for the WRONG boundary -> still BLOCKS
# ---------------------------------------------------------------------------
echo "Test 5: intentional record keyed to a different boundary -> still BLOCKS"
cat > "$FIX3/.loki/healing/behavioral-baseline/intentional-changes.json" <<'JSON'
{"changes":[{"boundary":"cli:F99","is_intentional":true,"reason":"unrelated"}]}
JSON
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX3" \
    LOKI_TEST_COMMAND="cd '$FIX3' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -ne 0 ]] && echo "$out" | grep -q "cli:F01"; then
    pass "per-boundary record: wrong-boundary approval does not unblock cli:F01"
else
    fail "gate should still BLOCK cli:F01 when only cli:F99 is documented; got rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 6: honest degrade - no golden-master baseline -> falls through (ALLOWS)
# ---------------------------------------------------------------------------
echo "Test 6: no baseline present -> honest degrade fall-through (ALLOWS)"
FIX4="$(mktemp -d)/nd"; build_fixture "$FIX4" v1   # NO capture -> baseline dir empty
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX4" \
    LOKI_TEST_COMMAND="cd '$FIX4' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -eq 0 ]] && echo "$out" | grep -q "no golden-master baseline present"; then
    pass "no baseline -> honest degrade, gate falls through (no false-green fabricated)"
else
    fail "no-baseline should honestly degrade and allow; got rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 7: no boundaries detected -> capture degrades honestly (no fabrication)
# ---------------------------------------------------------------------------
echo "Test 7: features.json with no boundaries -> capture degrades honestly"
FIX5="$(mktemp -d)/nb"; build_fixture "$FIX5" v1
echo '[]' > "$FIX5/.loki/healing/features.json"
cap=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX5" hook_capture_behavioral_baseline "$FIX5" 2>&1)
CNT=$(find "$FIX5/.loki/healing/behavioral-baseline" -type f -name 'boundary-*.json' 2>/dev/null | wc -l | tr -d ' ')
if echo "$cap" | grep -q "no boundaries detected" && [[ "$CNT" -eq 0 ]]; then
    pass "no-boundaries: honest message + zero fabricated artifacts"
else
    fail "expected honest 'no boundaries detected' and 0 artifacts; got '$cap' count=$CNT"
fi

# ---------------------------------------------------------------------------
# Test 8: heal mode OFF -> compare is a no-op (byte-identical off-path)
# ---------------------------------------------------------------------------
echo "Test 8: LOKI_HEAL_MODE off -> boundary compare is an inert no-op"
FIX6="$(mktemp -d)/off"; build_fixture "$FIX6" v1
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX6" hook_capture_behavioral_baseline "$FIX6" >/dev/null 2>&1
write_calc "$FIX6" change   # boundary changed, but heal mode is OFF below
out=$(LOKI_CODEBASE_PATH="$FIX6" hook_compare_behavioral_baseline "$FIX6" 2>&1)
rc=$?
if [[ "$rc" -eq 0 && -z "$out" ]]; then
    pass "compare is a silent no-op when heal mode is off (no false block, no output)"
else
    fail "compare should no-op when heal mode off; got rc=$rc out='$out'"
fi

# ---------------------------------------------------------------------------
# Test 9: REAL HEAL SOURCE - boundaries.json (the canonical heal manifest the
# archaeology prompt is instructed to write). Capture must populate from it, and
# a boundary change must BLOCK. This is the production wiring, not the fixture's
# hand-written features.json.
# ---------------------------------------------------------------------------
echo "Test 9: boundaries.json (real heal manifest) drives capture + gate"
FIX7="$(mktemp -d)/bj"
mkdir -p "$FIX7/.loki/healing/behavioral-baseline" "$FIX7/tests"
cat > "$FIX7/pyproject.toml" <<'TOML'
[project]
name = "bj"
version = "0.0.0"
TOML
cat > "$FIX7/tests/test_ok.py" <<PY
import subprocess, sys, os, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class TestOk(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(subprocess.run([sys.executable, os.path.join(HERE, "app.py")]).returncode, 0)
if __name__ == "__main__":
    unittest.main()
PY
cat > "$FIX7/app.py" <<'PY'
#!/usr/bin/env python3
print("OUTPUT=alpha"); import sys; sys.exit(0)
PY
# canonical heal boundary manifest (NO features.json present)
cat > "$FIX7/.loki/healing/boundaries.json" <<JSON
[{"id":"main","boundary_type":"cli","command":"python3 $FIX7/app.py"}]
JSON
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX7" hook_capture_behavioral_baseline "$FIX7" >/dev/null 2>&1
CNT=$(find "$FIX7/.loki/healing/behavioral-baseline" -type f -name 'boundary-*.json' 2>/dev/null | wc -l | tr -d ' ')
# change the boundary output (exit stays 0, unit test stays green)
cat > "$FIX7/app.py" <<'PY'
#!/usr/bin/env python3
print("OUTPUT=beta"); import sys; sys.exit(0)
PY
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX7" \
    LOKI_TEST_COMMAND="cd '$FIX7' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$CNT" -ge 1 && "$rc" -ne 0 ]] && echo "$out" | grep -q "cli:main"; then
    pass "boundaries.json populated baseline ($CNT) and gate BLOCKED the change (cli:main)"
else
    fail "boundaries.json path should populate+block; count=$CNT rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 10: REAL HEAL SOURCE - characterization-tests/*.json. heal archaeology's
# tool output. Any object carrying a runnable command is a boundary.
# ---------------------------------------------------------------------------
echo "Test 10: characterization-tests/*.json drives capture + gate"
FIX8="$(mktemp -d)/ct"
mkdir -p "$FIX8/.loki/healing/behavioral-baseline" "$FIX8/.loki/healing/characterization-tests" "$FIX8/tests"
cat > "$FIX8/pyproject.toml" <<'TOML'
[project]
name = "ct"
version = "0.0.0"
TOML
cat > "$FIX8/tests/test_ok.py" <<PY
import subprocess, sys, os, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class TestOk(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(subprocess.run([sys.executable, os.path.join(HERE, "svc.py")]).returncode, 0)
if __name__ == "__main__":
    unittest.main()
PY
cat > "$FIX8/svc.py" <<'PY'
#!/usr/bin/env python3
print("STATUS=green"); import sys; sys.exit(0)
PY
cat > "$FIX8/.loki/healing/characterization-tests/svc.json" <<JSON
{"id":"svc","boundary_type":"cli","command":"python3 $FIX8/svc.py"}
JSON
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX8" hook_capture_behavioral_baseline "$FIX8" >/dev/null 2>&1
CNT=$(find "$FIX8/.loki/healing/behavioral-baseline" -type f -name 'boundary-*.json' 2>/dev/null | wc -l | tr -d ' ')
cat > "$FIX8/svc.py" <<'PY'
#!/usr/bin/env python3
print("STATUS=red"); import sys; sys.exit(0)
PY
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX8" \
    LOKI_TEST_COMMAND="cd '$FIX8' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$CNT" -ge 1 && "$rc" -ne 0 ]] && echo "$out" | grep -q "cli:svc"; then
    pass "characterization-tests/*.json populated baseline ($CNT) and gate BLOCKED (cli:svc)"
else
    fail "characterization-tests path should populate+block; count=$CNT rc=$rc" "$out"
fi

# ---------------------------------------------------------------------------
# Test 11: stderr noise must NOT cause a false block (Py2->Py3 warnings channel).
# Baseline captured with a stderr warning; re-run with a DIFFERENT stderr warning
# but IDENTICAL stdout -> gate must ALLOW (stderr is not compared).
# ---------------------------------------------------------------------------
echo "Test 11: differing stderr with identical stdout -> gate ALLOWS (no false block)"
FIX9="$(mktemp -d)/se"
mkdir -p "$FIX9/.loki/healing/behavioral-baseline" "$FIX9/tests"
cat > "$FIX9/pyproject.toml" <<'TOML'
[project]
name = "se"
version = "0.0.0"
TOML
cat > "$FIX9/tests/test_ok.py" <<PY
import subprocess, sys, os, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class TestOk(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(subprocess.run([sys.executable, os.path.join(HERE, "w.py")]).returncode, 0)
if __name__ == "__main__":
    unittest.main()
PY
cat > "$FIX9/w.py" <<'PY'
#!/usr/bin/env python3
import sys
sys.stderr.write("DeprecationWarning: old-style class at 0xAAAA\n")
print("VALUE=42"); sys.exit(0)
PY
cat > "$FIX9/.loki/healing/boundaries.json" <<JSON
[{"id":"w","boundary_type":"cli","command":"python3 $FIX9/w.py"}]
JSON
LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX9" hook_capture_behavioral_baseline "$FIX9" >/dev/null 2>&1
# same stdout, DIFFERENT stderr address
cat > "$FIX9/w.py" <<'PY'
#!/usr/bin/env python3
import sys
sys.stderr.write("DeprecationWarning: old-style class at 0xBBBB\n")
print("VALUE=42"); sys.exit(0)
PY
out=$(LOKI_HEAL_MODE=true LOKI_CODEBASE_PATH="$FIX9" \
    LOKI_TEST_COMMAND="cd '$FIX9' && python3 -m unittest discover -s tests -q" \
    hook_healing_phase_gate modernize validate 2>&1)
rc=$?
if [[ "$rc" -eq 0 ]] && echo "$out" | grep -q "equivalent to golden-master"; then
    pass "stderr-only difference does not false-block (stdout is the compared channel)"
else
    fail "differing stderr should NOT block when stdout is identical; rc=$rc" "$out"
fi

echo ""
echo "============================================="
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
