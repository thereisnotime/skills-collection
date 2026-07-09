#!/usr/bin/env bash
# tests/test-council-scope-honesty.sh
#
# Rec #5 (scope honesty): when "done" cannot be verified against derived
# acceptance criteria, the completion-council evidence must SAY SO rather than
# leave the checklist section silent (silence reads as a pass to a reviewer).
#
# council_gather_evidence() writes the evidence a council member reviews. When
# no checklist verification-results.json exists it takes a fallback branch that
# must distinguish:
#   A. a spec/PRD IS present but yielded no checklist  -> SCOPE-HONESTY warning
#      ("done" is UNVERIFIED-BY-CHECKLIST; weight the other evidence).
#   B. no spec/PRD was provided at all                 -> "not applicable"
#      (checklist absence is expected for a one-line brief, not a gap).
#
# Extract-the-function harness (mirrors tests/test-council-da-veto.sh): pull just
# council_gather_evidence out of source, stub its optional collaborators, and run
# the fallback branch in a scratch dir. No git repo / no python deps required for
# the branch under test.

set -uo pipefail

SCRIPT_DIR_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_TEST/.." && pwd)"
SRC="$REPO_ROOT/autonomy/completion-council.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if [ ! -f "$SRC" ]; then
    echo "SKIP: $SRC not found. (Not a fail.)"; exit 0
fi

GATHER_FN="$(awk '/^council_gather_evidence\(\) \{/{f=1} f{print} f&&/^}$/{exit}' "$SRC" 2>/dev/null || true)"
if [ -z "$GATHER_FN" ]; then
    echo "SKIP: could not extract council_gather_evidence from source. (Not a fail.)"; exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-council-scope-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Run council_gather_evidence in an isolated subshell against a scratch cwd with
# NO checklist results file (forcing the fallback branch under test). Echoes the
# evidence file path. $1 = prd_path passed to the function; $2 = "spec-in-loki"
# to plant a .loki/prd.md (tests the elif branch).
run_gather() {
    local prd_arg="$1" plant="${2:-}"
    local dir="$WORK/run-$RANDOM"
    mkdir -p "$dir"
    (
        # The extracted source function references orchestrator vars this test
        # does not set (convergence counters, TARGET_DIR, ...). Disable nounset
        # inside this subshell so those expand empty (as they would benignly at
        # runtime) instead of aborting before the branch under test.
        set +u
        cd "$dir" || exit 3
        # The source function iterates `.loki/logs/test-*.log` unquoted. Under
        # bash an unmatched glob stays literal (harmless), but to keep the test
        # shell-agnostic we materialize the dir + a real log so the glob always
        # matches a file and never trips a nomatch-fatal shell.
        mkdir -p .loki/logs && : > .loki/logs/test-run.log
        shopt -s nullglob 2>/dev/null || setopt nullglob 2>/dev/null || true
        ITERATION_COUNT=1
        # Do NOT stub checklist_as_evidence -- its ABSENCE is exactly what drives
        # the fallback branch under test (the source guards it with `type ...
        # &>/dev/null`). Stub only the logging collaborators; every other optional
        # helper is left undefined so the inline fallbacks run. `set -u` is not
        # enabled here (the source function references vars we don't set).
        log_header() { :; }; log_info() { :; }; log_warn() { :; }
        log_error() { :; }; log_debug() { :; }

        if [ "$plant" = "spec-in-loki" ]; then
            mkdir -p .loki && printf '# spec\n' > .loki/prd.md
        fi
        # A real prd file when the caller asks for one.
        if [ "$prd_arg" = "PLANT_PRD" ]; then
            printf '# My PRD\n' > prd.md
            prd_arg="prd.md"
        fi

        eval "$GATHER_FN"
        council_gather_evidence "ev.md" "$prd_arg" >/dev/null 2>&1
        cat ev.md 2>/dev/null
    )
}

# Case A: spec present (real prd file), no checklist -> SCOPE-HONESTY warning.
outA="$(run_gather "PLANT_PRD" "")"
if printf '%s' "$outA" | grep -q "SCOPE-HONESTY" \
   && printf '%s' "$outA" | grep -qi "UNVERIFIED-BY-CHECKLIST"; then
    ok "spec present + no checklist -> SCOPE-HONESTY (done is unverified-by-checklist)"
else
    bad "spec-present branch" "expected SCOPE-HONESTY/UNVERIFIED-BY-CHECKLIST, got: $(printf '%s' "$outA" | grep -A1 'PRD Checklist')"
fi

# Case A2: spec present via .loki/prd.md (elif branch), empty prd arg.
outA2="$(run_gather "" "spec-in-loki")"
if printf '%s' "$outA2" | grep -q "SCOPE-HONESTY"; then
    ok "spec via .loki/prd.md + no checklist -> SCOPE-HONESTY"
else
    bad "spec-in-loki branch" "expected SCOPE-HONESTY, got: $(printf '%s' "$outA2" | grep -A1 'PRD Checklist')"
fi

# Case B: no spec at all -> 'not applicable', NOT a scope-honesty warning.
outB="$(run_gather "" "")"
if printf '%s' "$outB" | grep -qi "not applicable" \
   && ! printf '%s' "$outB" | grep -q "SCOPE-HONESTY"; then
    ok "no spec provided -> checklist not applicable (no false scope warning)"
else
    bad "no-spec branch" "expected 'not applicable' and no SCOPE-HONESTY, got: $(printf '%s' "$outB" | grep -A1 'PRD Checklist')"
fi

echo ""
echo "=== results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
