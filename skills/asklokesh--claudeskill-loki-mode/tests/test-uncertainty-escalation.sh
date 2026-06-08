#!/usr/bin/env bash
# tests/test-uncertainty-escalation.sh -- regression suite for the uncertainty-
# gated escalation DECISION function (Slice C of v7.19.2). Exercises the REAL
# uncertainty_should_escalate from autonomy/completion-council.sh against the
# contract in docs/UNCERTAINTY-ESCALATION-PLAN.md sections 2 and 4.
#
# Strategy (modeled on tests/test-evidence-gate.sh): source the real
# completion-council.sh, stubbing only the log_* helpers that run.sh normally
# provides, then call uncertainty_should_escalate inside per-case throwaway
# dirs. The decision function makes NO git calls (Slice A reads the diff hash
# from state.json on purpose), so no git repo / GIT_CONFIG isolation is needed.
#
# Contract under test (plan section 2):
#   return 0 => escalate now
#   return 1 => do not escalate
# Knob-first: LOKI_UNCERTAINTY_ESCALATION=0 short-circuits before any read or
# write (byte-identical: uncertainty.json is never created).
#
# Two fixture files live in DIFFERENT directories. With
# COUNCIL_STATE_DIR=$case/.loki/council:
#   - proxies      -> $case/.loki/council/state.json
#                     (keys: consecutive_no_change, last_diff_hash, verdicts[])
#   - uncertainty  -> $case/.loki/state/uncertainty.json  (sibling state/ dir,
#                     resolved via dirname COUNCIL_STATE_DIR -> .loki -> state/)
#
# Proxies (plan section 2):
#   P1 hot: consecutive_no_change >= LOKI_UNCERTAINTY_NOCHANGE_MIN
#           (default COUNCIL_STAGNATION_LIMIT - 1). Forced hot with a large
#           value (99) / cold with 0 so the test is threshold-independent.
#   P2 hot: last_diff_hash recurs at distance >= 2 in the ring. Pre-seeded:
#           ring ["A","B"] + last_diff_hash "A" -> p2 true; ring ["A"] +
#           last_diff_hash "A" -> p2 false (immediate repeat is P1's job).
#   P3 hot: trailing LOKI_UNCERTAINTY_SPLIT_ROUNDS (default 2) verdicts all
#           result=="REJECTED" AND approve>=1.
# Escalate iff >=2 of {P1,P2,P3} hot for LOKI_UNCERTAINTY_ROUNDS (default 2)
# consecutive rounds AND not already escalated this episode (debounce).
#
# IMPORTANT: streak only advances on a NON-same-round call
# (iteration != last_round_iteration). Multi-round cases bump ITERATION_COUNT
# each call; the idempotency case deliberately holds it fixed.
#
# Skips gracefully (exit 0) when python3 is unavailable, or when the
# implementation has not landed yet (uncertainty_should_escalate undefined).
# The absent-impl skip is LOUD on purpose.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"

PASS=0
FAIL=0

ok()  { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# Environment guards (skip, do not fail, when prerequisites are missing).
# ---------------------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed; the decision function parses JSON via python3. (Not a fail.)"
    exit 0
fi
if [ ! -f "$COUNCIL_SH" ]; then
    echo "SKIP: $COUNCIL_SH not found. (Not a fail.)"
    exit 0
fi

# ---------------------------------------------------------------------------
# Source the real council library. The log_* helpers live in run.sh, not in
# completion-council.sh, so we stub them. Nothing else in the decision function
# depends on run.sh state beyond COUNCIL_STATE_DIR + ITERATION_COUNT, set per
# case below.
# ---------------------------------------------------------------------------
log_info()    { :; }
log_warn()    { :; }
log_error()   { :; }
log_success() { :; }
log_debug()   { :; }
log_step()    { :; }
log_header()  { :; }

# shellcheck source=/dev/null
source "$COUNCIL_SH"

# Loud, intentional skip if the implementation has not landed. After Slice A is
# in place this MUST report PASS lines instead of this banner.
if ! type uncertainty_should_escalate >/dev/null 2>&1; then
    echo "SKIP: uncertainty_should_escalate is not yet defined in $COUNCIL_SH."
    echo "      Slice A has not landed. Re-run after the dev adds the function --"
    echo "      this suite MUST then report PASS lines, not this SKIP."
    exit 0
fi

# ---------------------------------------------------------------------------
# Per-case throwaway root. Every case gets a fresh subdir so uncertainty.json
# presence / contents are not contaminated by a prior case.
# ---------------------------------------------------------------------------
TMP_ROOT="$(mktemp -d -t loki-uncertainty.XXXXXX)" || exit 2
trap 'rm -rf "$TMP_ROOT"' EXIT

# Create a fresh case dir and echo its absolute path. Pre-creates the two
# fixture dirs (council/ for state.json, state/ for uncertainty.json).
new_case() {
    local name="$1"
    local dir="$TMP_ROOT/$name"
    mkdir -p "$dir/.loki/council" "$dir/.loki/state"
    printf '%s' "$dir"
}

# Path helpers.
state_json_path() { printf '%s/.loki/council/state.json' "$1"; }
unc_json_path()   { printf '%s/.loki/state/uncertainty.json' "$1"; }

# Write the council state.json proxy fixture.
# Usage: write_proxies <case-dir> <no_change> <last_diff_hash> <verdicts-json-array>
# Pass "" for last_diff_hash to omit a hash; pass "[]" for empty verdicts.
write_proxies() {
    local dir="$1" no_change="$2" hash="$3" verdicts="$4"
    _SP="$(state_json_path "$dir")" _NC="$no_change" _HASH="$hash" _VERD="$verdicts" \
        python3 -c "
import json, os
state = {
    'consecutive_no_change': int(os.environ['_NC']),
    'verdicts': json.loads(os.environ['_VERD']),
}
h = os.environ['_HASH']
if h:
    state['last_diff_hash'] = h
with open(os.environ['_SP'], 'w') as fh:
    json.dump(state, fh)
"
}

# Pre-seed uncertainty.json with an explicit prior state. Usage:
# seed_uncertainty <case-dir> <ring-json-array> <co_occur> <escalated_bool> <last_round_iter>
seed_uncertainty() {
    local dir="$1" ring="$2" co="$3" esc="$4" last_round="$5"
    _UP="$(unc_json_path "$dir")" _RING="$ring" _CO="$co" _ESC="$esc" _LR="$last_round" \
        python3 -c "
import json, os
state = {
    'schema_version': '1.0.0',
    'consecutive_co_occur': int(os.environ['_CO']),
    'escalated_episode': os.environ['_ESC'].lower() == 'true',
    'escalated_at_iteration': 0,
    'diff_hash_ring': json.loads(os.environ['_RING']),
    'last_round_iteration': int(os.environ['_LR']),
    'last_proxies': {'p1': False, 'p2': False, 'p3': False},
}
with open(os.environ['_UP'], 'w') as fh:
    json.dump(state, fh)
"
}

# Call the real decision function in a case dir with a given iteration. Sets
# globals: ESC_RC. Does NOT cd (the function resolves paths from
# COUNCIL_STATE_DIR), so no unguarded-cd.
# Usage: run_escalate <case-dir> <iteration> [extra env already exported by caller]
run_escalate() {
    local dir="$1" iter="$2"
    COUNCIL_STATE_DIR="$dir/.loki/council" ITERATION_COUNT="$iter" \
        uncertainty_should_escalate
    ESC_RC=$?
}

# Read one field from uncertainty.json. For nested last_proxies.<k> use
# "last_proxies.p1". Echoes the value as JSON-ish text (true/false/number),
# empty string if absent.
unc_field() {
    local dir="$1" field="$2"
    local f
    f="$(unc_json_path "$dir")"
    [ -f "$f" ] || { printf ''; return; }
    _F="$f" _FIELD="$field" python3 -c "
import json, os
try:
    with open(os.environ['_F']) as fh:
        d = json.load(fh)
except Exception:
    print(''); raise SystemExit
field = os.environ['_FIELD']
cur = d
for part in field.split('.'):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        print(''); raise SystemExit
if isinstance(cur, bool):
    print('true' if cur else 'false')
else:
    print(cur)
" 2>/dev/null
}

# Echo uncertainty.json's diff_hash_ring as compact JSON (no spaces) so the
# assertion is not fragile against Python list-repr spacing. Empty string if
# the file or key is absent. Also exposes the ring length for bounding checks.
unc_ring_json() {
    local dir="$1"
    local f
    f="$(unc_json_path "$dir")"
    [ -f "$f" ] || { printf ''; return; }
    _F="$f" python3 -c "
import json, os
try:
    with open(os.environ['_F']) as fh:
        d = json.load(fh)
except Exception:
    print(''); raise SystemExit
ring = d.get('diff_hash_ring', [])
print(json.dumps(ring, separators=(',', ':')))
" 2>/dev/null
}
unc_ring_len() {
    local dir="$1"
    local f
    f="$(unc_json_path "$dir")"
    [ -f "$f" ] || { printf ''; return; }
    _F="$f" python3 -c "
import json, os
try:
    with open(os.environ['_F']) as fh:
        d = json.load(fh)
except Exception:
    print(''); raise SystemExit
ring = d.get('diff_hash_ring', [])
print(len(ring) if isinstance(ring, list) else '')
" 2>/dev/null
}

# Verdict JSON fragment helpers (compact, ASCII only).
V_REJ_SPLIT='{"result":"REJECTED","approve":1,"reject":2}'
V_APPROVED='{"result":"APPROVED","approve":3,"reject":0}'

# ===========================================================================
# Case 1: knob OFF (LOKI_UNCERTAINTY_ESCALATION=0) -> rc 1, NO uncertainty.json
#         written (byte-identical / no-op: zero read, zero write).
# ===========================================================================
echo "Case 1: LOKI_UNCERTAINTY_ESCALATION=0 -> rc 1, no uncertainty.json"
dir="$(new_case case1)"
# Make every proxy hot so that, were the knob ON, this WOULD escalate. Proves
# the knob (not a cold input) is what suppresses the write.
write_proxies "$dir" 99 "A" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"
seed_uncertainty "$dir" '["A","B"]' 1 false 0
# Remove the seeded uncertainty.json so we can prove the OFF path never writes.
rm -f "$(unc_json_path "$dir")"
LOKI_UNCERTAINTY_ESCALATION=0 run_escalate "$dir" 5
[ "$ESC_RC" -eq 1 ] && ok "case1 rc=1 (knob off, no escalate)" || bad "case1 rc=1" "got rc=$ESC_RC"
[ ! -f "$(unc_json_path "$dir")" ] && ok "case1 NO uncertainty.json (byte-identical when off)" \
    || bad "case1 no uncertainty.json when off" "file was written"

# ===========================================================================
# Case 2: zero proxies hot -> rc 1, no escalation, streak stays 0.
# ===========================================================================
echo "Case 2: zero proxies hot -> rc 1, no escalate"
dir="$(new_case case2)"
write_proxies "$dir" 0 "X" "[$V_APPROVED]"   # p1 cold, no recurrence, approved
run_escalate "$dir" 1
[ "$ESC_RC" -eq 1 ] && ok "case2 rc=1 (no proxies hot)" || bad "case2 rc=1" "got rc=$ESC_RC"
[ "$(unc_field "$dir" last_proxies.p1)" = "false" ] && ok "case2 p1 cold" || bad "case2 p1 cold" "p1=$(unc_field "$dir" last_proxies.p1)"
[ "$(unc_field "$dir" last_proxies.p2)" = "false" ] && ok "case2 p2 cold" || bad "case2 p2 cold" "p2=$(unc_field "$dir" last_proxies.p2)"
[ "$(unc_field "$dir" last_proxies.p3)" = "false" ] && ok "case2 p3 cold" || bad "case2 p3 cold" "p3=$(unc_field "$dir" last_proxies.p3)"
[ "$(unc_field "$dir" consecutive_co_occur)" = "0" ] && ok "case2 co_occur=0" || bad "case2 co_occur=0" "got $(unc_field "$dir" consecutive_co_occur)"

# ===========================================================================
# Case 3a: ONLY P1 hot for many rounds -> rc 1 every round, never escalates.
#          Non-vacuous: assert p1 IS hot, p2/p3 cold, co_occur stays 0.
# ===========================================================================
echo "Case 3a: P1-only hot for many rounds -> rc 1 (single proxy never escalates)"
dir="$(new_case case3a)"
fail3a=0
i=1
while [ "$i" -le 4 ]; do
    # p1 hot (99), p2 cold (no hash), p3 cold (approved verdict).
    write_proxies "$dir" 99 "" "[$V_APPROVED]"
    run_escalate "$dir" "$i"
    [ "$ESC_RC" -eq 1 ] || { fail3a=1; bad "case3a round $i rc=1" "got rc=$ESC_RC (escalated on P1 alone)"; }
    [ "$(unc_field "$dir" last_proxies.p1)" = "true" ]  || { fail3a=1; bad "case3a round $i p1 hot" "p1 not hot"; }
    [ "$(unc_field "$dir" last_proxies.p2)" = "false" ] || { fail3a=1; bad "case3a round $i p2 cold" "p2 hot"; }
    [ "$(unc_field "$dir" last_proxies.p3)" = "false" ] || { fail3a=1; bad "case3a round $i p3 cold" "p3 hot"; }
    i=$((i + 1))
done
[ "$fail3a" -eq 0 ] && ok "case3a P1-only across 4 rounds: rc 1, p1 hot, p2/p3 cold"
[ "$(unc_field "$dir" consecutive_co_occur)" = "0" ] && ok "case3a co_occur stays 0" || bad "case3a co_occur=0" "got $(unc_field "$dir" consecutive_co_occur)"
[ "$(unc_field "$dir" escalated_episode)" = "false" ] && ok "case3a escalated_episode=false" || bad "case3a escalated_episode=false" "got $(unc_field "$dir" escalated_episode)"

# ===========================================================================
# Case 3b: ONLY P2 hot for many rounds -> rc 1 every round.
#          Re-seed ring each round so p2 fires from recurrence-at-distance
#          while p1/p3 stay cold.
# ===========================================================================
echo "Case 3b: P2-only hot for many rounds -> rc 1"
dir="$(new_case case3b)"
fail3b=0
i=1
while [ "$i" -le 3 ]; do
    write_proxies "$dir" 0 "A" "[$V_APPROVED]"   # p1 cold, p3 cold
    # ring ["A","B"] + last_diff_hash A -> ring[:-1]==["A"] matches -> p2 true.
    seed_uncertainty "$dir" '["A","B"]' 0 false "$((i - 1))"
    run_escalate "$dir" "$i"
    [ "$ESC_RC" -eq 1 ] || { fail3b=1; bad "case3b round $i rc=1" "got rc=$ESC_RC"; }
    [ "$(unc_field "$dir" last_proxies.p2)" = "true" ]  || { fail3b=1; bad "case3b round $i p2 hot" "p2 not hot"; }
    [ "$(unc_field "$dir" last_proxies.p1)" = "false" ] || { fail3b=1; bad "case3b round $i p1 cold" "p1 hot"; }
    [ "$(unc_field "$dir" last_proxies.p3)" = "false" ] || { fail3b=1; bad "case3b round $i p3 cold" "p3 hot"; }
    i=$((i + 1))
done
[ "$fail3b" -eq 0 ] && ok "case3b P2-only across 3 rounds: rc 1, p2 hot, p1/p3 cold"

# ===========================================================================
# Case 3c: ONLY P3 hot for many rounds -> rc 1 every round.
# ===========================================================================
echo "Case 3c: P3-only hot for many rounds -> rc 1"
dir="$(new_case case3c)"
fail3c=0
i=1
while [ "$i" -le 4 ]; do
    # p1 cold, p2 cold (no hash), p3 hot (2 trailing REJECTED w/ approve>=1).
    write_proxies "$dir" 0 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"
    run_escalate "$dir" "$i"
    [ "$ESC_RC" -eq 1 ] || { fail3c=1; bad "case3c round $i rc=1" "got rc=$ESC_RC"; }
    [ "$(unc_field "$dir" last_proxies.p3)" = "true" ]  || { fail3c=1; bad "case3c round $i p3 hot" "p3 not hot"; }
    [ "$(unc_field "$dir" last_proxies.p1)" = "false" ] || { fail3c=1; bad "case3c round $i p1 cold" "p1 hot"; }
    [ "$(unc_field "$dir" last_proxies.p2)" = "false" ] || { fail3c=1; bad "case3c round $i p2 cold" "p2 hot"; }
    i=$((i + 1))
done
[ "$fail3c" -eq 0 ] && ok "case3c P3-only across 4 rounds: rc 1, p3 hot, p1/p2 cold"
[ "$(unc_field "$dir" consecutive_co_occur)" = "0" ] && ok "case3c co_occur stays 0" || bad "case3c co_occur=0" "got $(unc_field "$dir" consecutive_co_occur)"

# ===========================================================================
# Case 3d: PURE STAGNATION with a REAL repeated hash (A,A,A,...) -> P2 must stay
#          COLD and the run must NOT escalate. This is the regression guard for
#          the W4 council CONCERN: a no-change run repeats the SAME diff hash
#          every round, filling the ring with [A,A,A,...]. P2 must require a
#          genuine intervening distinct hash (A,B,A), otherwise stagnation alone
#          lights both P1 and P2 from one root condition and escalates, breaking
#          the 2-of-3 independent-proxy guarantee. Drive the REAL ring-push path
#          (no seeded ring) so the ring fills naturally with the same hash.
# ===========================================================================
echo "Case 3d: pure stagnation (same hash every round) -> P2 cold, no escalation"
dir="$(new_case case3d)"
fail3d=0
i=1
while [ "$i" -le 5 ]; do
    # p1 hot (99), SAME hash "A" each round (real stagnation), p3 cold (approved).
    write_proxies "$dir" 99 "A" "[$V_APPROVED]"
    run_escalate "$dir" "$i"
    [ "$ESC_RC" -eq 1 ] || { fail3d=1; bad "case3d round $i rc=1" "got rc=$ESC_RC (stagnation alone escalated)"; }
    [ "$(unc_field "$dir" last_proxies.p2)" = "false" ] || { fail3d=1; bad "case3d round $i p2 cold" "p2 hot on pure stagnation (A,A,A)"; }
    [ "$(unc_field "$dir" last_proxies.p1)" = "true" ]  || { fail3d=1; bad "case3d round $i p1 hot" "p1 not hot"; }
    i=$((i + 1))
done
[ "$fail3d" -eq 0 ] && ok "case3d pure stagnation across 5 rounds: rc 1, p1 hot, p2 stays cold (no false oscillation)"
[ "$(unc_field "$dir" consecutive_co_occur)" = "0" ] && ok "case3d co_occur stays 0 (single root condition does not escalate)" || bad "case3d co_occur=0" "got $(unc_field "$dir" consecutive_co_occur)"

# ===========================================================================
# Case 4: TWO proxies hot but only for ONE round (< LOKI_UNCERTAINTY_ROUNDS=2)
#         -> rc 1 (not yet). Streak should be exactly 1.
# ===========================================================================
echo "Case 4: two proxies hot for 1 round (< ROUNDS) -> rc 1 (not yet)"
dir="$(new_case case4)"
# p1 hot + p3 hot, p2 cold. Single call, default last_round_iteration=-1.
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"
run_escalate "$dir" 1
[ "$ESC_RC" -eq 1 ] && ok "case4 rc=1 (one round of co-occurrence is not enough)" || bad "case4 rc=1" "got rc=$ESC_RC (escalated too early)"
[ "$(unc_field "$dir" last_proxies.p1)" = "true" ] && ok "case4 p1 hot" || bad "case4 p1 hot" "p1 not hot"
[ "$(unc_field "$dir" last_proxies.p3)" = "true" ] && ok "case4 p3 hot" || bad "case4 p3 hot" "p3 not hot"
[ "$(unc_field "$dir" consecutive_co_occur)" = "1" ] && ok "case4 co_occur=1 (one round counted)" || bad "case4 co_occur=1" "got $(unc_field "$dir" consecutive_co_occur)"
[ "$(unc_field "$dir" escalated_episode)" = "false" ] && ok "case4 escalated_episode=false" || bad "case4 escalated_episode=false" "got $(unc_field "$dir" escalated_episode)"

# ===========================================================================
# Case 5: TWO proxies hot for N=2 rounds -> rc 0 on the Nth (core positive).
#         Drive across successive iterations; assert rc 1 on round 1, rc 0 on
#         round 2, and escalated_episode flips true.
# ===========================================================================
echo "Case 5: two proxies hot for ROUNDS=2 consecutive rounds -> rc 0 (escalates)"
dir="$(new_case case5)"
# Round 1: p1 + p3 hot. iteration 1.
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"
run_escalate "$dir" 1
[ "$ESC_RC" -eq 1 ] && ok "case5 round1 rc=1 (streak building)" || bad "case5 round1 rc=1" "got rc=$ESC_RC"
[ "$(unc_field "$dir" consecutive_co_occur)" = "1" ] && ok "case5 round1 co_occur=1" || bad "case5 round1 co_occur=1" "got $(unc_field "$dir" consecutive_co_occur)"
# Round 2: keep p1 + p3 hot, advance iteration to 2.
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"
run_escalate "$dir" 2
[ "$ESC_RC" -eq 0 ] && ok "case5 round2 rc=0 (ESCALATES on Nth round)" || bad "case5 round2 rc=0" "got rc=$ESC_RC (did not escalate)"
[ "$(unc_field "$dir" consecutive_co_occur)" = "2" ] && ok "case5 round2 co_occur=2" || bad "case5 round2 co_occur=2" "got $(unc_field "$dir" consecutive_co_occur)"
[ "$(unc_field "$dir" escalated_episode)" = "true" ] && ok "case5 escalated_episode=true" || bad "case5 escalated_episode=true" "got $(unc_field "$dir" escalated_episode)"

# ===========================================================================
# Case 6: DEBOUNCE -- after the case-5-style escalation, calling again with the
#         SAME hot proxies (new iteration) -> rc 1 (does NOT re-fire in-episode).
# ===========================================================================
echo "Case 6: debounce -- escalated episode does not re-fire on next hot round"
dir="$(new_case case6)"
# Build to escalation: round 1 then round 2 (escalates).
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 1
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 2
[ "$ESC_RC" -eq 0 ] || bad "case6 setup" "expected rc=0 on escalation round, got rc=$ESC_RC"
# Round 3: SAME hot proxies, new iteration -> must be suppressed.
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 3
[ "$ESC_RC" -eq 1 ] && ok "case6 rc=1 (debounced -- no re-fire same episode)" || bad "case6 rc=1" "got rc=$ESC_RC (re-fired within episode)"
[ "$(unc_field "$dir" escalated_episode)" = "true" ] && ok "case6 escalated_episode stays true" || bad "case6 escalated_episode true" "got $(unc_field "$dir" escalated_episode)"

# ===========================================================================
# Case 7: RE-ARM -- after debounce, a round where co-occurrence drops below 2
#         clears the episode (escalated_episode=false, co_occur=0); then two hot
#         rounds escalate again (new episode -> rc 0).
# ===========================================================================
echo "Case 7: re-arm -- clear co-occurrence, then a new episode escalates again"
dir="$(new_case case7)"
# Escalate (rounds 1,2).
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 1
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 2
[ "$ESC_RC" -eq 0 ] || bad "case7 setup" "expected rc=0 escalation, got rc=$ESC_RC"
# Round 3: drop a proxy so only p3 hot (co_occur false) -> re-arm.
write_proxies "$dir" 0 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 3
[ "$ESC_RC" -eq 1 ] && ok "case7 round3 rc=1 (co-occurrence cleared)" || bad "case7 round3 rc=1" "got rc=$ESC_RC"
[ "$(unc_field "$dir" escalated_episode)" = "false" ] && ok "case7 episode re-armed (escalated_episode=false)" || bad "case7 re-arm" "escalated_episode=$(unc_field "$dir" escalated_episode)"
[ "$(unc_field "$dir" consecutive_co_occur)" = "0" ] && ok "case7 co_occur reset to 0" || bad "case7 co_occur=0" "got $(unc_field "$dir" consecutive_co_occur)"
# Rounds 4,5: two hot rounds again -> new episode escalates.
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 4
[ "$ESC_RC" -eq 1 ] && ok "case7 round4 rc=1 (new streak building)" || bad "case7 round4 rc=1" "got rc=$ESC_RC"
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"; run_escalate "$dir" 5
[ "$ESC_RC" -eq 0 ] && ok "case7 round5 rc=0 (new episode escalates)" || bad "case7 round5 rc=0" "got rc=$ESC_RC (re-arm did not allow new escalation)"
[ "$(unc_field "$dir" escalated_episode)" = "true" ] && ok "case7 new episode escalated_episode=true" || bad "case7 new episode true" "got $(unc_field "$dir" escalated_episode)"

# ===========================================================================
# Case 8: P2 specifics -- ring A,B,A fires p2; ring A,A does NOT (that is P1).
#         Single-call pre-seed, isolated from p1/p3 (both kept cold).
# ===========================================================================
echo "Case 8a: ring [A,B] + last_diff_hash A -> p2 HOT (recurrence at distance)"
dir="$(new_case case8a)"
write_proxies "$dir" 0 "A" "[$V_APPROVED]"      # p1 cold, p3 cold
seed_uncertainty "$dir" '["A","B"]' 0 false 0    # prior ring; ring[:-1]==["A"]
run_escalate "$dir" 1
[ "$(unc_field "$dir" last_proxies.p2)" = "true" ] && ok "case8a p2 hot (A,B,A recurrence)" || bad "case8a p2 hot" "got p2=$(unc_field "$dir" last_proxies.p2)"
[ "$ESC_RC" -eq 1 ] && ok "case8a rc=1 (p2 alone does not escalate)" || bad "case8a rc=1" "got rc=$ESC_RC"
# Direct diff_hash_ring assertion: prior ring ["A","B"] + cur_hash "A", a
# non-same-round call pushes cur_hash -> ["A","B","A"]. Exercises the ring
# PUSH path (append) directly, not just the p2 read.
[ "$(unc_ring_json "$dir")" = '["A","B","A"]' ] && ok "case8a diff_hash_ring pushed cur_hash -> [A,B,A]" || bad "case8a diff_hash_ring push" "got $(unc_ring_json "$dir")"

echo "Case 8b: ring [A] + last_diff_hash A -> p2 COLD (immediate repeat is P1)"
dir="$(new_case case8b)"
write_proxies "$dir" 0 "A" "[$V_APPROVED]"
seed_uncertainty "$dir" '["A"]' 0 false 0        # ring[:-1]==[] -> no match
run_escalate "$dir" 1
[ "$(unc_field "$dir" last_proxies.p2)" = "false" ] && ok "case8b p2 cold (A,A is not recurrence-at-distance)" || bad "case8b p2 cold" "got p2=$(unc_field "$dir" last_proxies.p2)"

echo "Case 8c: diff_hash_ring is bounded to 6 entries (ring overflow drops oldest)"
dir="$(new_case case8c)"
# Seed a full 6-entry ring, then push a 7th distinct hash on a fresh round.
# Expect the oldest (h0) dropped and the newest (h6) kept: length 6, ends in h6.
write_proxies "$dir" 0 "h6" "[$V_APPROVED]"      # p1/p3 cold; only the ring matters
seed_uncertainty "$dir" '["h0","h1","h2","h3","h4","h5"]' 0 false 0
run_escalate "$dir" 1
[ "$(unc_ring_len "$dir")" = "6" ] && ok "case8c ring bounded to 6 after overflow" || bad "case8c ring length" "got len=$(unc_ring_len "$dir")"
[ "$(unc_ring_json "$dir")" = '["h1","h2","h3","h4","h5","h6"]' ] && ok "case8c oldest dropped, newest kept" || bad "case8c ring contents" "got $(unc_ring_json "$dir")"

# ===========================================================================
# Case 9: IDEMPOTENT per iteration -- calling twice at the SAME iteration does
#         NOT double-advance the streak. First call advances to 1; second call
#         (same ITERATION_COUNT) leaves it at 1 and returns rc 1.
# ===========================================================================
echo "Case 9: idempotent per iteration -- same iteration does not double-advance"
dir="$(new_case case9)"
write_proxies "$dir" 99 "" "[$V_REJ_SPLIT,$V_REJ_SPLIT]"   # p1 + p3 hot (co_occur)
run_escalate "$dir" 1
[ "$(unc_field "$dir" consecutive_co_occur)" = "1" ] && ok "case9 first call co_occur=1" || bad "case9 first call co_occur=1" "got $(unc_field "$dir" consecutive_co_occur)"
co_before="$(unc_field "$dir" consecutive_co_occur)"
# Second call at the SAME iteration (1). Must not advance the streak.
run_escalate "$dir" 1
co_after="$(unc_field "$dir" consecutive_co_occur)"
[ "$ESC_RC" -eq 1 ] && ok "case9 repeat-call rc=1 (no double-fire in same round)" || bad "case9 repeat rc=1" "got rc=$ESC_RC"
[ "$co_after" = "$co_before" ] && ok "case9 streak not double-advanced ($co_before -> $co_after)" || bad "case9 idempotent streak" "co_occur changed $co_before -> $co_after"

# ---------------------------------------------------------------------------
echo
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
