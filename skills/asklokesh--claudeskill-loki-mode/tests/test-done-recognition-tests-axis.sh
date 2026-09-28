#!/usr/bin/env bash
# tests/test-done-recognition-tests-axis.sh -- the tests_axis classifier inside
# autonomy/lib/done-recognition.sh (reuse_done_recognition_gate's fresh-test
# read). Scoped to four shapes the classifier must get right:
#
#   (1) zero-test record {"passed":0,"failed":0,"total":0} -- nothing actually
#       ran (total is 0). Must classify "unknown", never "green".
#   (2) {"pass":true,"failed_count":2} -- a self-reported pass contradicted by
#       a nonzero failure count under a key the old code never inspected. Must
#       classify "red", never "green".
#   (3) real green {"pass":true,"exit_code":0,"failed_count":0} -- a genuine
#       clean pass with the same failed_count key at zero. Must stay "green".
#   (4) {"pass":true,"total":0} -- self-reported pass on a zero-test record.
#       The total==0 check must apply before the pass:true branch returns
#       early, or this shape falls through as a false "green" (S-125 review
#       finding #1: reproduced live through reuse_done_recognition_gate,
#       produced a completion-evidence.md that falsely claimed tests were
#       re-run and passed). Must classify "unknown", never "green".
#
# The classifier is a python function private to a bash function (no seam to
# call directly), so this drives it the same way tests/test-reuse-done-
# recognition.sh does: through the public reuse_done_recognition_gate entry
# point, with a stubbed model response that says "done" on the project's one
# PRD feature, and reads the axis back off the observable artifacts:
#   - the gate's return code (0 = fast-stop done, 1 = build)
#   - completion-evidence.md's "Fresh-test axis: <axis>" line (written only on
#     a done verdict, so cases (1) and (3) both reach it; case (2)'s red axis
#     forces "incomplete" and never reaches it, so its axis is read off the
#     return code instead).
#
# No emojis. No em/en dashes. bash 3.2 safe.

set -uo pipefail

SCRIPT_DIR_T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_T/.." && pwd)"
GATE_LIB="$REPO_ROOT/autonomy/lib/done-recognition.sh"

export GENERATED_PRD_ACTION=""

PASS=0
FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
ok()   { echo "ok: $1"; PASS=$((PASS+1)); }

log_info()   { :; }
log_warn()   { :; }
log_error()  { :; }
log_step()   { :; }
log_header() { :; }

# shellcheck source=/dev/null
source "$GATE_LIB"

_loki_done_recog_provider_ok() { return 0; }

# One-feature project so "all_met" + full coverage is trivial to satisfy,
# isolating the assertion to the tests_axis classification alone.
new_project() {
    local d; d="$(mktemp -d -t loki-donerecog-axis.XXXXXX)"
    cd "$d" || return 1
    mkdir -p .loki/state .loki/quality .loki/signals .loki/checklist
    cat > .loki/generated-prd.md <<'PRD'
# Demo App

## Feature: User login
Users can log in with email and password.
PRD
    : > .loki/signals/COMPLETION_REQUESTED
    PROJECT_DIR="$d"
    TARGET_DIR="$d"
    export TARGET_DIR
}
cleanup_project() { cd /; rm -rf "$PROJECT_DIR" 2>/dev/null || true; }

_loki_done_recog_invoke() {
    cat <<'JSON'
{"verdict":"done","summary":"login works",
 "requirements":[
  {"id":"f1","title":"User login","status":"met","evidence":"auth.py:10"}]}
JSON
}

#==============================================================================
# (1) zero-test record: total=0 means nothing ran -> unknown, not green.
#==============================================================================
new_project
printf '{"passed":0,"failed":0,"total":0}\n' > "$TARGET_DIR/.loki/quality/test-results.json"
GENERATED_PRD_ACTION="reuse"
reuse_done_recognition_gate ".loki/generated-prd.md" >/dev/null 2>&1
rc=$?
EV="$TARGET_DIR/.loki/completion-evidence.md"
if [ -f "$EV" ] && grep -q "Fresh-test axis: unknown" "$EV"; then
    ok "(1) zero-test record {passed:0,failed:0,total:0} classifies unknown"
else
    fail "(1) zero-test record did not classify unknown (rc=$rc, evidence=$([ -f "$EV" ] && grep 'Fresh-test axis' "$EV" || echo 'missing'))"
fi
if [ -f "$EV" ] && ! grep -qiE 're-ran the tests|against re-run tests' "$EV"; then
    ok "(1) receipt does not overclaim a test run for a zero-test record"
else
    fail "(1) receipt overclaims a passing test run for a zero-test (unknown-axis) record"
fi
cleanup_project

#==============================================================================
# (2) pass:true contradicted by a nonzero failed_count -> red, never green.
#     Red axis forces the gate to "incomplete" (build), never a fast-stop.
#==============================================================================
new_project
printf '{"pass":true,"failed_count":2}\n' > "$TARGET_DIR/.loki/quality/test-results.json"
GENERATED_PRD_ACTION="reuse"
if reuse_done_recognition_gate ".loki/generated-prd.md" >/dev/null 2>&1; then
    fail "(2) pass:true with failed_count:2 WRONGLY fast-stopped as done (should be red -> build)"
else
    ok "(2) pass:true with failed_count:2 classifies red (gate falls through to build)"
fi
[ ! -f "$TARGET_DIR/.loki/COMPLETED" ] && ok "(2) no COMPLETED marker when failed_count contradicts pass" || fail "(2) COMPLETED wrongly written"
cleanup_project

#==============================================================================
# (3) real green: pass:true, exit_code:0, failed_count:0 -- must stay green.
#==============================================================================
new_project
printf '{"pass":true,"exit_code":0,"failed_count":0}\n' > "$TARGET_DIR/.loki/quality/test-results.json"
GENERATED_PRD_ACTION="reuse"
if reuse_done_recognition_gate ".loki/generated-prd.md" >/dev/null 2>&1; then
    ok "(3) real green record (pass:true, exit_code:0, failed_count:0) fast-stops as done"
else
    fail "(3) real green record was wrongly downgraded (should fast-stop as done)"
fi
EV="$TARGET_DIR/.loki/completion-evidence.md"
if [ -f "$EV" ] && grep -q "Fresh-test axis: green" "$EV"; then
    ok "(3) real green record classifies green"
else
    fail "(3) real green record did not classify green (evidence=$([ -f "$EV" ] && grep 'Fresh-test axis' "$EV" || echo 'missing'))"
fi
cleanup_project

#==============================================================================
# (4) pass:true with total:0 -- self-reported pass on a zero-test record.
#     Must classify unknown (nothing ran), never green. Review finding #1.
#==============================================================================
new_project
printf '{"pass":true,"total":0}\n' > "$TARGET_DIR/.loki/quality/test-results.json"
GENERATED_PRD_ACTION="reuse"
reuse_done_recognition_gate ".loki/generated-prd.md" >/dev/null 2>&1
rc=$?
EV="$TARGET_DIR/.loki/completion-evidence.md"
if [ -f "$EV" ] && grep -q "Fresh-test axis: unknown" "$EV"; then
    ok "(4) pass:true with total:0 classifies unknown"
else
    fail "(4) pass:true with total:0 did not classify unknown (rc=$rc, evidence=$([ -f "$EV" ] && grep 'Fresh-test axis' "$EV" || echo 'missing'))"
fi
if [ -f "$EV" ] && ! grep -qiE 're-ran the tests|against re-run tests' "$EV"; then
    ok "(4) receipt does not overclaim a test run for pass:true+total:0"
else
    fail "(4) receipt overclaims a passing test run for pass:true+total:0 (unknown-axis) record"
fi
cleanup_project

echo ""
echo "===================================="
echo "done-recognition tests_axis tests: PASS=$PASS FAIL=$FAIL"
echo "===================================="
[ "$FAIL" -eq 0 ]
