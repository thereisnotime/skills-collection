#!/usr/bin/env bash
# S-141 (S-49 follow-up): three council verdict readers in
# autonomy/completion-council.sh ran a bare `python3 -E`, which still loads the
# user site-packages. A user-site .pth "import" line runs before any sys.path
# scrub and can forge json.load, flipping the verdict:
#   1. council_checklist_gate   (critical failing item -> BLOCK)
#   2. council_heldout_gate     (failing held-out item -> BLOCK)
#   3. council_evaluate dispatch-verdict read (round file CONTINUE)
# Each must go through _loki_snapshot_py_tool and run -I -S, and fail closed
# when no interpreter resolves.
#
# Method: plant a forging .pth under a scratch HOME, in the user site of BOTH
# the PATH python3 (what a bare call uses) and the helper-resolved interpreter
# (what the fixed code uses), then run each reader. A positive control proves
# the .pth really fires for both interpreters under -E, so a green result is
# not vacuous. LOKI_COUNCIL_SH_OVERRIDE points the suite at another copy of
# completion-council.sh (used for the mutation check).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SRC="${LOKI_COUNCIL_SH_OVERRIDE:-$ROOT/autonomy/completion-council.sh}"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not installed (not a fail)"; exit 0; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-s141.XXXXXXXX")" || exit 1
trap 'rm -rf -- "$WORK"' EXIT
export LOKI_NO_BROWSER=1

# Private copy so the sourced file finds a stub lib/voter-agents.sh beside it.
mkdir -p "$WORK/autonomy/lib" "$WORK/home" "$WORK/proj"
cp "$SRC" "$WORK/autonomy/completion-council.sh"
cat >"$WORK/autonomy/lib/voter-agents.sh" <<'EOF'
loki_council_dispatch_agents() { return 0; }
EOF

HOME_S="$WORK/home"
FORGED="{'categories':[{'items':[{'id':'h1','status':'verified'}]}],'held_out':['h1'],'waivers':[],'verdict':'COMPLETE','complete_votes':3,'total_members':3}"
PTH_LINE="import json; json.load = lambda *a, **k: $FORGED"

RESOLVED="$(bash -c ". '$WORK/autonomy/completion-council.sh' >/dev/null 2>&1; _loki_snapshot_py_tool")"
[ -n "$RESOLVED" ] || { echo "FAIL: _loki_snapshot_py_tool resolved nothing on this host"; exit 1; }

for py in "$(command -v python3)" "$RESOLVED"; do
    site="$(HOME="$HOME_S" "$py" -E -c 'import site; print(site.getusersitepackages())' 2>/dev/null)"
    [ -n "$site" ] || continue
    mkdir -p "$site" && printf '%s\n' "$PTH_LINE" >"$site/zzz_loki_s141.pth"
done

# Positive control: the .pth must forge json.load for BOTH interpreters under -E.
printf '{"verdict":"CONTINUE"}\n' >"$WORK/ctl.json"
for py in "$(command -v python3)" "$RESOLVED"; do
    got="$(HOME="$HOME_S" "$py" -E -c "import json; print(json.load(open('$WORK/ctl.json')).get('verdict'))" 2>/dev/null)"
    if [ "$got" = "COMPLETE" ]; then
        ok "control: .pth forges json.load for $py under -E"
    else
        echo "FAIL: control did not reproduce the .pth gap for $py (got '$got'); cases below would be vacuous"
        exit 1
    fi
done

# Fixtures: a failing critical visible item, a failing held-out item, and a
# dispatch round file whose verdict is CONTINUE.
mkdir -p "$WORK/proj/.loki/checklist" "$WORK/proj/.loki/council/votes"
cat >"$WORK/proj/.loki/checklist/verification-results.json" <<'EOF'
{"categories":[{"items":[
 {"id":"c1","title":"critical broken","priority":"critical","status":"failing"},
 {"id":"h1","title":"held out broken","priority":"major","status":"failing"}]}]}
EOF
printf '{"held_out":["h1"]}\n' >"$WORK/proj/.loki/checklist/held-out.json"
printf '{"verdict":"CONTINUE","complete_votes":0,"total_members":3}\n' >"$WORK/proj/.loki/council/votes/round-1.json"

# run_case <expr> [nopy]: source the copy under the scratch HOME, stub the
# collaborators, run <expr>, print its last output line.
run_case() {
    (
        cd "$WORK/proj" || exit 99
        export HOME="$HOME_S"
        # shellcheck disable=SC1091
        . "$WORK/autonomy/completion-council.sh" >/dev/null 2>&1
        log_info() { :; }; log_warn() { :; }; log_error() { :; }
        [ "${2:-}" = nopy ] && _loki_snapshot_py_tool() { return 1; }
        # shellcheck disable=SC2034  # read by the sourced council functions
        COUNCIL_ENABLED=true COUNCIL_SIZE=3 ITERATION_COUNT=1 COUNCIL_STATE_DIR="$WORK/proj/.loki/council"
        council_reverify_checklist() { :; }
        council_evidence_gate() { return 0; }
        council_assumption_ledger_gate() { return 0; }
        # COMPLETE so the no-interpreter dispatch case goes red if it falls
        # through to the heuristic aggregator instead of failing closed.
        council_aggregate_votes() { echo COMPLETE; }
        council_write_transcript() { :; }
        council_devils_advocate_review() { echo CONFIRM; }
        eval "$1"
    ) 2>/dev/null | tail -n1
}

CL='council_checklist_gate; echo "rc=$?"'
HO='council_heldout_gate; echo "rc=$?"'
EV='council_checklist_gate() { return 0; }; council_heldout_gate() { return 0; }; council_evaluate >/dev/null; echo "rc=$?"'

[ "$(run_case "$CL")" = "rc=1" ] && ok "checklist gate: .pth cannot clear a critical failure" \
    || bad "checklist gate: .pth flipped BLOCK to PASS (bare python3 -E reader)"
[ "$(run_case "$HO")" = "rc=1" ] && ok "held-out gate: .pth cannot clear a failing held-out item" \
    || bad "held-out gate: .pth flipped BLOCK to PASS (bare python3 -E reader)"
[ "$(run_case "$EV")" = "rc=1" ] && ok "dispatch verdict: .pth cannot forge COMPLETE from a CONTINUE round" \
    || bad "dispatch verdict: .pth forged COMPLETE (bare python3 -E reader)"

# Harness control: a genuinely COMPLETE round must reach COMPLETE (rc=0), so the
# rc=1 above is the reader's verdict, not a harness that can never complete.
EVC='printf "{\"verdict\":\"COMPLETE\",\"complete_votes\":3,\"total_members\":3}" >.loki/council/votes/round-1.json; '"$EV"
[ "$(run_case "$EVC")" = "rc=0" ] && ok "control: a real COMPLETE round reaches COMPLETE through the same harness" \
    || bad "control: harness could not reach COMPLETE; the dispatch case is vacuous"
printf '{"verdict":"CONTINUE","complete_votes":0,"total_members":3}\n' >"$WORK/proj/.loki/council/votes/round-1.json"

# Fail closed when no interpreter resolves.
[ "$(run_case "$CL" nopy)" = "rc=1" ] && ok "checklist gate: no interpreter -> BLOCK" \
    || bad "checklist gate: no interpreter did not BLOCK"
HOF='rm -f .loki/council/heldout-block.json; council_heldout_gate; r=$?; [ -f .loki/council/heldout-block.json ] && echo "rc=$r recorded" || echo "rc=$r unrecorded"'
[ "$(run_case "$HOF" nopy)" = "rc=1 recorded" ] && ok "held-out gate: no interpreter -> BLOCK, block record still written" \
    || bad "held-out gate: no interpreter did not BLOCK with a block record"
[ "$(run_case "$EV" nopy)" = "rc=1" ] && ok "dispatch verdict: no interpreter -> not COMPLETE" \
    || bad "dispatch verdict: no interpreter reached COMPLETE"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
