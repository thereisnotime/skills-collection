#!/usr/bin/env bash
# tests/test-v10-pulse.sh -- regression tests for scripts/v10-pulse.sh.
#
# All external data sources are overridden via env vars (BOARD_MD,
# CONTROL_MD, PULSE_REPO_ROOT, PULSE_MAIN_REF, PULSE_NPM_CMD, PULSE_GH_CMD,
# PULSE_WORKTREE_CMD, PULSE_MOAT_RESULT, PULSE_SWARM_START, PULSE_NOW). No
# test here makes a real npm/gh network call or depends on real wall-clock
# time or the real docs/v10/BOARD.md.
#
# PULSE_TEST_SHELL selects which shell interprets scripts/v10-pulse.sh
# ("bash" default, or "sh" for macOS's real bash 3.2.57 in POSIX mode) so
# the whole suite can be run twice to back the bash-3.2-compatible claim,
# not just bash -n on both files.
set -uo pipefail
# A git hook (this suite's eventual pre-push caller, per tests/moat/run.sh's
# own comment on the same hazard) exports GIT_DIR. Inherited here, every git
# command this file's fixture setup runs below -- git init, commit, tag,
# config, reset --hard -- would operate on the REAL repo's .git instead of
# the fake $FAKE_REPO it thinks it is building, silently corrupting shared
# state (branch position, tags, the repo-local user.email/name) rather than
# a throwaway fixture. Scrub before creating anything.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR \
    GIT_ALTERNATE_OBJECT_DIRECTORIES
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Overridable so mutation testing can point the whole suite at a mutated
# copy without ever touching the real script (see the loki-verify skill's
# guidance: a mutation must go red in a copy, never in the file under test).
PULSE_SH="${PULSE_SH:-$REPO_ROOT/scripts/v10-pulse.sh}"
TEST_SHELL="${PULSE_TEST_SHELL:-bash}"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

# One run-owned temp dir for every fixture this file writes, removed at exit.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/test-v10-pulse.XXXXXX")" || {
    echo "cannot create temp dir" >&2
    exit 2
}
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# A small git repo the script can run its real (harmless) git commands
# against: a v1.0.0 tag with two moat properties pending, then a "main"
# branch (explicit -b main: git's own default-branch default is not
# guaranteed, and PULSE_MAIN_REF defaults to "main").
FAKE_REPO="$WORK/repo"
mkdir -p "$FAKE_REPO"
(
    cd "$FAKE_REPO" || exit 1
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "test"
    mkdir -p tests/moat
    printf 'P1.case-a milestone reason\nP2.case-b milestone reason\n' > tests/moat/pending.txt
    git add tests/moat/pending.txt
    GIT_AUTHOR_DATE="2026-09-20T00:00:00Z" GIT_COMMITTER_DATE="2026-09-20T00:00:00Z" \
        git commit -q -m "initial"
    git tag v1.0.0
)

CONTROL_OK="$WORK/CONTROL-ok.md"
python3 -c "
for i in range(10):
    print('line %d' % i)
" > "$CONTROL_OK"

CONTROL_OVERSIZE="$WORK/CONTROL-big.md"
python3 -c "
for i in range(50):
    print('line %d' % i)
" > "$CONTROL_OVERSIZE"

# Real tests/moat/run.sh summary-line fixtures (finding 3): a measured PASS
# result (7 of 9, no rule failures) and a measured FAIL result (SAME count,
# 7 of 9, with an unlisted REGRESSION line, so only the suite-failed check
# can explain a violation, not a count drop), matching run.sh's own exact
# wording ("moat: N of 9 properties proven", "moat suite: FAIL (K rule
# failure(s))").
MOAT_RESULT_PASS="$WORK/moat-result-pass.txt"
cat > "$MOAT_RESULT_PASS" <<'EOF'
P1 portable proof: PROVEN
moat: 7 of 9 properties proven
moat suite: no rule failed (7 of 9 proven; the moat is NOT proven)
EOF

# Deliberately the SAME count as the v1.0.0 baseline (7 of 9): this isolates
# the suite_failed check from the separate count-drop check. If the count
# path alone explained a violation here, mutating away the suite_failed
# check (finding 3's actual fix) would not turn this test red -- exactly the
# real-repo case (measured 2 of 9 with baseline ALSO 2 of 9; P7 has no
# pending.txt line at either ref, so only the live FAIL line reveals it).
MOAT_RESULT_FAIL="$WORK/moat-result-fail.txt"
cat > "$MOAT_RESULT_FAIL" <<'EOF'
FAIL: REGRESSION P7.dashboard-client-routes-exist: FAIL but not listed in tests/moat/pending.txt
moat: 7 of 9 properties proven
moat suite: FAIL (1 rule failure(s))
EOF

# write_moat_sha RESULT_FILE REPO REF -- writes RESULT_FILE.sha holding the
# full SHA `git rev-parse REF` currently resolves to in REPO (BACKLOG 133:
# the sidecar convention scripts/v10-pulse.sh now requires). Must be called
# AFTER any fixture commit that moves REF, and again after each later commit
# that moves it further, or the sidecar goes stale exactly like the real bug.
write_moat_sha() {
    local result_file="$1" repo="$2" ref="$3"
    (cd "$repo" && git rev-parse "$ref") > "${result_file}.sha"
}

# A fabricated, well-formed-looking but wrong SHA: proves the comparison is a
# real inequality check against the CURRENT resolved ref, not a vacuous
# "sidecar exists" check.
STALE_SHA="0000000000000000000000000000000000dead"

# A worktree-list fixture builder. Writes a porcelain listing (primary
# worktree first, always skipped by position) followed by N builder
# worktrees, each a real .git-file + gitdir with HEAD/index/logs/HEAD, whose
# mtimes are set explicitly relative to a given "now" epoch (never left to
# the real wall clock, which is already past any fixed PULSE_NOW and would
# make every untouched file read as freshly modified).
# make_worktree DIR AGE_MINUTES NOW_EPOCH
make_worktree() {
    local dir="$1" age_min="$2" now_epoch="$3"
    local gitdir="$dir/.git-real"
    mkdir -p "$gitdir/logs"
    : > "$gitdir/HEAD"
    : > "$gitdir/index"
    : > "$gitdir/logs/HEAD"
    printf 'gitdir: %s\n' "$gitdir" > "$dir/.git"
    local mt
    mt=$(python3 -c "print(int($now_epoch - $age_min * 60))")
    python3 -c "
import os
mt = $mt
for p in ['$gitdir/HEAD', '$gitdir/index', '$gitdir/logs/HEAD']:
    os.utime(p, (mt, mt))
os.utime('$gitdir', (mt, mt))
"
}

# worktree_cmd_for REPO_PATH DIR... -> a PULSE_WORKTREE_CMD value (a shell
# command printing porcelain output) with REPO_PATH listed first (primary,
# always skipped) followed by each DIR.
worktree_cmd_for() {
    local out="worktree $1\nHEAD dead\nbranch refs/heads/main\n\n"
    shift
    local d
    for d in "$@"; do
        out="${out}worktree $d\nHEAD dead\n\n"
    done
    printf 'printf %s' "$(printf '%q' "$out")"
}

# run_pulse ENV_ARGS... -- runs scripts/v10-pulse.sh under $TEST_SHELL with
# the given env assignments (as separate "VAR=val" args), captures stdout
# into $OUT, returns the real exit code.
run_pulse() {
    local out="$WORK/out.$$"
    env "$@" "$TEST_SHELL" "$PULSE_SH" > "$out" 2>"$WORK/err.$$"
    local rc=$?
    OUT="$(cat "$out")"
    rm -f "$out" "$WORK/err.$$"
    return $rc
}

COMMON_ARGS=(
    "PULSE_REPO_ROOT=$FAKE_REPO"
    "PULSE_MAIN_REF=main"
    "CONTROL_MD=$CONTROL_OK"
    "PULSE_NPM_CMD=false"
    "PULSE_GH_CMD=false"
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO")"
    "PULSE_MOAT_RESULT="
    "PULSE_SWARM_START=2026-09-26T23:00Z"
    "PULSE_NOW=2026-09-27T02:00:00Z"
)

assert_exact_violations() {
    # assert_exact_violations "case name" "expected\nlines"
    local name="$1" expected="$2"
    local actual
    actual="$(printf '%s\n' "$OUT" | grep '^VIOLATION:' || true)"
    if [ "$actual" = "$expected" ]; then
        ok "$name: exact VIOLATION block matches"
    else
        bad "$name: VIOLATION block mismatch"
        echo "  --- expected ---"
        printf '%s\n' "$expected"
        echo "  --- actual ---"
        printf '%s\n' "$actual"
    fi
}

echo "T1 -- idle builders (fewer than 6 active builder worktrees while ready slices exist)"
BOARD_IDLE="$WORK/BOARD-idle.md"
cat > "$BOARD_IDLE" <<'EOF'
| ID | Owner | File set | Tier | Status | Notes |
|---|---|---|---|---|---|
| S-01 | a | x | LOW | ready@2026-09-27T01:00Z | |
| S-02 | a | x | LOW | ready@2026-09-27T01:00Z | |
| S-03 | a | x | LOW | building@2026-09-27T01:00Z | |
EOF
# PULSE_NOW for COMMON_ARGS is 2026-09-27T02:00:00Z = epoch 1790474400. One
# worktree active 5 minutes ago, plus five more aged 120 minutes (over the
# 30-minute cutoff) -- both to prove the filter actually filters (a mutant
# that deletes the age check would count all six as active, not one).
WT1="$WORK/wt1"; mkdir -p "$WT1"; make_worktree "$WT1" 5 1790474400
WT1_STALE=()
for i in 1 2 3 4 5; do
    d="$WORK/wt1stale$i"; mkdir -p "$d"; make_worktree "$d" 120 1790474400
    WT1_STALE+=("$d")
done
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_IDLE" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "$WT1" "${WT1_STALE[@]}")"; then rc=0; else rc=$?; fi
if printf '%s\n' "$OUT" | grep -qF "Active builder worktrees (last 30 min): 1 of 6 checked"; then
    ok "worktree age filter: 1 of 6 counted active (5 stale ones correctly excluded)"
else
    bad "worktree age filter mismatch: output follows"
    printf '%s\n' "$OUT"
fi
EXPECTED_T1="VIOLATION: IDLE_BUILDERS: only 1 active builder worktree(s) while 2 ready slice(s) exist on BOARD (S-01, S-02)
VIOLATION: LOW_READY: only 2 ready slice(s) on BOARD (want at least 8); cut 6 more"
assert_exact_violations "T1 IDLE_BUILDERS" "$EXPECTED_T1"

echo "T2 -- merged-but-unreleased slice older than 30 min, CI green"
BOARD_UNRELEASED="$WORK/BOARD-unreleased.md"
{
    echo "| ID | Owner | File set | Tier | Status | Notes |"
    echo "|---|---|---|---|---|---|"
    for i in 1 2 3 4 5 6; do echo "| S-0$i | a | x | LOW | building@2026-09-27T01:00Z | |"; done
    for i in 7 8 9; do echo "| S-0$i | a | x | LOW | ready@2026-09-27T01:00Z | |"; done
    for i in 10 11 12 13 14; do echo "| S-$i | a | x | LOW | ready@2026-09-27T01:00Z | |"; done
    echo "| S-15 | a | x | LOW | merged@2026-09-27T01:00Z | |"
} > "$BOARD_UNRELEASED"
(
    cd "$FAKE_REPO" || exit 1
    echo "change" > file.txt
    git add file.txt
    GIT_AUTHOR_DATE="2026-09-27T01:00:00Z" GIT_COMMITTER_DATE="2026-09-27T01:00:00Z" \
        git commit -q -m "unreleased change"
)
UNRELEASED_SHA="$(cd "$FAKE_REPO" && git rev-parse --short=8 HEAD)"
GH_GREEN_JSON="$WORK/gh-green.json"
printf '[{"status":"completed","conclusion":"success","workflowName":"Tests"}]' > "$GH_GREEN_JSON"
WT_MANY=()
for i in 1 2 3 4 5 6; do
    d="$WORK/wtu$i"; mkdir -p "$d"; make_worktree "$d" 5 1790474400
    WT_MANY+=("$d")
done
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_UNRELEASED" \
    "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_MANY[@]}")"; then rc=0; else rc=$?; fi
EXPECTED_T2="VIOLATION: UNRELEASED_MERGE: S-15 1 commit(s) merged but unreleased for 60.0 minutes since v1.0.0 (oldest $UNRELEASED_SHA) while CI is green"
assert_exact_violations "T2 UNRELEASED_MERGE" "$EXPECTED_T2"
(cd "$FAKE_REPO" || exit 1; git reset -q --hard v1.0.0)

echo "T3 -- main CI red (a failure alongside an in_progress run still fires CI_RED)"
GH_RED_JSON="$WORK/gh-red.json"
python3 -c "
import json
print(json.dumps([
    {'status': 'completed', 'conclusion': 'failure', 'workflowName': 'Lint'},
    {'status': 'in_progress', 'conclusion': None, 'workflowName': 'Tests'},
]))
" > "$GH_RED_JSON"
BOARD_ANY="$WORK/BOARD-any.md"
cat > "$BOARD_ANY" <<'EOF'
| ID | Owner | File set | Tier | Status | Notes |
|---|---|---|---|---|---|
| S-01 | a | x | LOW | ready@2026-09-27T01:00Z | |
EOF
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_ANY" "PULSE_GH_CMD=cat $GH_RED_JSON"; then rc=0; else rc=$?; fi
head_sha_short="$(cd "$FAKE_REPO" && git rev-parse --short=8 main)"
EXPECTED_T3="VIOLATION: CI_RED: main CI is RED at $head_sha_short (Lint)
VIOLATION: IDLE_BUILDERS: only 0 active builder worktree(s) while 1 ready slice(s) exist on BOARD (S-01)
VIOLATION: LOW_READY: only 1 ready slice(s) on BOARD (want at least 8); cut 7 more"
assert_exact_violations "T3 CI_RED" "$EXPECTED_T3"
if [ "$(printf '%s\n' "$OUT" | grep '^VIOLATION:' | head -1)" = "VIOLATION: CI_RED: main CI is RED at $head_sha_short (Lint)" ]; then
    ok "CI_RED is printed first (priority 1), pinned by exact ordering"
else
    bad "CI_RED not first in the ordered VIOLATIONS block"
    printf '%s\n' "$OUT"
fi

echo "T3b -- cancelled-only CI run is UNKNOWN, never CI_RED"
GH_CANCELLED_JSON="$WORK/gh-cancelled.json"
printf '[{"status":"completed","conclusion":"cancelled","workflowName":"Tests"}]' > "$GH_CANCELLED_JSON"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_ANY" "PULSE_GH_CMD=cat $GH_CANCELLED_JSON"; then rc=0; else rc=$?; fi
if printf '%s\n' "$OUT" | grep -q "^Main CI (main @ $head_sha_short): UNKNOWN" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: CI_RED"; then
    ok "cancelled-only CI run: UNKNOWN, no CI_RED violation"
else
    bad "cancelled-only case: output follows"
    printf '%s\n' "$OUT"
fi

echo "T4 -- clean case: no violations, full status block still prints, exact ordering"
BOARD_CLEAN="$WORK/BOARD-clean.md"
{
    echo "| ID | Owner | File set | Tier | Status | Notes |"
    echo "|---|---|---|---|---|---|"
    for i in 1 2 3 4 5 6 7 8; do echo "| S-0$i | a | x | LOW | ready@2026-09-27T01:00Z | |"; done
} > "$BOARD_CLEAN"
NPM_TIME_JSON="$WORK/npm-time.json"
python3 -c "
import json
print(json.dumps({
    'created': '2020-01-01T00:00:00.000Z',
    'modified': '2026-09-27T01:55:00.000Z',
    '9.54.0': '2026-09-27T01:00:00.000Z',
    '9.55.0': '2026-09-27T01:50:00.000Z',
}))
" > "$NPM_TIME_JSON"
WT_CLEAN=()
for i in 1 2 3 4 5 6; do
    d="$WORK/wtc$i"; mkdir -p "$d"; make_worktree "$d" 5 1790474400
    WT_CLEAN+=("$d")
done
# One extra worktree aged 120 minutes: proves the "6 of 7 checked" count
# reflects the age filter, not just how many were listed.
WT_CLEAN_STALE="$WORK/wtc-stale"; mkdir -p "$WT_CLEAN_STALE"
make_worktree "$WT_CLEAN_STALE" 120 1790474400
write_moat_sha "$MOAT_RESULT_PASS" "$FAKE_REPO" main
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_PASS" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}" "$WT_CLEAN_STALE")"; then rc=0; else rc=$?; fi
if [ "$rc" = 0 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^=== v10-pulse status" \
    && printf '%s\n' "$OUT" | grep -q "^BOARD status counts:" \
    && printf '%s\n' "$OUT" | grep -q "^Moat proven (pending-derived, informational, NOT suite-verified):" \
    && printf '%s\n' "$OUT" | grep -qF "Moat proven (measured, PULSE_MOAT_RESULT): 7 of 9" \
    && printf '%s\n' "$OUT" | grep -qF "Active builder worktrees (last 30 min): 6 of 7 checked" \
    && printf '%s\n' "$OUT" | grep -q "^CONTROL.md line count:"; then
    ok "clean case: exit 0, no VIOLATION lines, full status block present, worktree count 6 of 7, measured moat 7 of 9"
else
    bad "clean case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T4b -- clean case but with NO PULSE_MOAT_RESULT: moat regression is UNKNOWN, not falsely clean"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}" "$WT_CLEAN_STALE")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (no PULSE_MOAT_RESULT supplied"; then
    ok "no PULSE_MOAT_RESULT: moat_regression reports UNKNOWN (exit 2), never a false clean"
else
    bad "T4b no-measured-result case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T4c -- BACKLOG 133: a STALE PULSE_MOAT_RESULT (sidecar SHA does not match current main) is UNKNOWN, never a false clean"
# Same real, parseable, clean (7 of 9, no rule failures) MOAT_RESULT_PASS
# fixture as T4 -- proves the false-clean this fixes: without the SHA check,
# this input alone would report exit 0 with no MOAT_REGRESSION violation.
MOAT_RESULT_STALE="$WORK/moat-result-stale.txt"
cp "$MOAT_RESULT_PASS" "$MOAT_RESULT_STALE"
printf '%s\n' "$STALE_SHA" > "${MOAT_RESULT_STALE}.sha"
MAIN_SHA_T4C="$(cd "$FAKE_REPO" && git rev-parse main)"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_STALE" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}" "$WT_CLEAN_STALE")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (moat result is stale, measured against ${STALE_SHA:0:8} but main is now at ${MAIN_SHA_T4C:0:8})"; then
    ok "stale sidecar SHA: moat_regression reports UNKNOWN with the stale reason, never a false clean"
else
    bad "T4c stale-sha case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T4d -- BACKLOG 133: a PULSE_MOAT_RESULT with NO sidecar SHA at all is UNKNOWN, never a confident verdict"
# A real FAIL result (would otherwise fire MOAT_REGRESSION) with no
# "<file>.sha" sidecar present -- the older-style capture with no provenance.
# Must fail closed to UNKNOWN, not fire the violation and not read as clean.
MOAT_RESULT_NO_SHA="$WORK/moat-result-no-sha.txt"
cp "$MOAT_RESULT_FAIL" "$MOAT_RESULT_NO_SHA"
rm -f "${MOAT_RESULT_NO_SHA}.sha"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_NO_SHA" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}" "$WT_CLEAN_STALE")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (PULSE_MOAT_RESULT has no provenance:"; then
    ok "no sidecar SHA: moat_regression reports UNKNOWN, never a confident verdict from unprovenanced input"
else
    bad "T4d no-sha case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T5 -- CONTROL.md over the 40-line budget"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "CONTROL_MD=$CONTROL_OVERSIZE" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_PASS" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")"; then rc=0; else rc=$?; fi
if [ "$rc" = 1 ] && printf '%s\n' "$OUT" | grep -qF "VIOLATION: CONTROL_OVERSIZE: docs/v10/CONTROL.md is 50 lines (budget is 40); trim 10 line(s)"; then
    ok "exact CONTROL_OVERSIZE violation line fires, exit 1"
else
    bad "CONTROL_OVERSIZE case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T6 -- finding-3 exact repro: pending.txt UNCHANGED (ratchet-legal) between baseline and current,"
echo "      but a measured/live moat result reports FAIL -- MOAT_REGRESSION must still fire, not stay clean"
# pending.txt at HEAD is byte-identical to v1.0.0's (no widening at all, the
# ratchet's most favorable case for the old, broken heuristic) yet the
# measured result (as tests/moat/run.sh would really report, see the P7
# fixture above) says the suite FAILED. The old pending-only logic could
# never flag this: proven-by-absence at both refs reads as "no drop". Fixed
# logic must fire on the measured FAIL regardless. MOAT_RESULT_FAIL's count
# (7 of 9) deliberately equals the baseline's 7 of 9, isolating the
# suite-failed check from the separate count-drop check -- only the fixed
# suite_failed path can explain this violation, so a clean CLEAN_ARGS give a
# meaningful exit-code assertion: exit 1 becomes exit 0 if that check is
# ever reverted (verified: mutation testing exit 0 under the reverted code).
CLEAN_MOAT_ARGS=(
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON"
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")"
)
write_moat_sha "$MOAT_RESULT_FAIL" "$FAKE_REPO" main
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_FAIL" \
    "${CLEAN_MOAT_ARGS[@]}"; then rc=0; else rc=$?; fi
if [ "$rc" = 1 ] \
    && printf '%s\n' "$OUT" | grep -qF "Moat proven (pending-derived, informational, NOT suite-verified): 7 of 9" \
    && printf '%s\n' "$OUT" | grep -qF "VIOLATION: MOAT_REGRESSION: measured moat suite reports FAIL (1 rule failure(s))" \
    && [ "$(printf '%s\n' "$OUT" | grep -c '^VIOLATION:')" = 1 ]; then
    ok "unchanged/ratchet-legal pending.txt still correctly flags MOAT_REGRESSION from the measured FAIL (exit 1, the ONLY violation)"
else
    bad "T6 finding-3 repro case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T6c -- measured count drop with no suite failure also fires MOAT_REGRESSION (count-based path)"
MOAT_RESULT_COUNT_DROP="$WORK/moat-result-count-drop.txt"
cat > "$MOAT_RESULT_COUNT_DROP" <<'EOF'
moat: 6 of 9 properties proven
moat suite: no rule failed (6 of 9 proven; the moat is NOT proven)
EOF
write_moat_sha "$MOAT_RESULT_COUNT_DROP" "$FAKE_REPO" main
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_COUNT_DROP"; then rc=0; else rc=$?; fi
if [ "$rc" = 1 ] \
    && printf '%s\n' "$OUT" | grep -qF "VIOLATION: MOAT_REGRESSION: measured moat proven count dropped to 6 of 9 (was 7 of 9 pending-derived at last release)"; then
    ok "measured count drop with no live suite failure still fires MOAT_REGRESSION"
else
    bad "T6c count-drop case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi


echo "T7 -- timeout case: all three external calls hang, script still finishes fast with honest UNKNOWNs, exit 2"
SLOW_CMD="$WORK/slow.sh"
cat > "$SLOW_CMD" <<'EOF'
#!/bin/sh
sleep 30
EOF
chmod +x "$SLOW_CMD"
start_ts=$(date +%s)
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=$SLOW_CMD" "PULSE_GH_CMD=$SLOW_CMD" "PULSE_WORKTREE_CMD=$SLOW_CMD" \
    "PULSE_DEADLINE_SECS=2"; then rc=0; else rc=$?; fi
end_ts=$(date +%s)
elapsed=$((end_ts - start_ts))
if [ "$elapsed" -lt 10 ] \
    && printf '%s\n' "$OUT" | grep -q "^Releases (24h): UNKNOWN" \
    && printf '%s\n' "$OUT" | grep -q "^Active builder worktrees: UNKNOWN" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: NO_RECENT_RELEASE" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: LOW_RELEASE_VOLUME" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: IDLE_BUILDERS" \
    && [ "$rc" = 2 ]; then
    ok "all-hung external calls: UNKNOWN metrics, no false violation, ${elapsed}s elapsed (< 10s), exit 2"
else
    bad "timeout case: rc=$rc elapsed=${elapsed}s output follows"
    printf '%s\n' "$OUT"
fi

echo "T7b -- npm hangs alone; gh still answers (finish_proc timeout floor, not starved to UNKNOWN)"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" \
    "PULSE_NPM_CMD=$SLOW_CMD" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")" \
    "PULSE_DEADLINE_SECS=3"; then rc=0; else rc=$?; fi
if printf '%s\n' "$OUT" | grep -q "^Releases (24h): UNKNOWN" \
    && printf '%s\n' "$OUT" | grep -q "^Main CI (main @ .*): GREEN"; then
    ok "npm-only hang: releases UNKNOWN but Main CI still resolves GREEN (not starved)"
else
    bad "npm-only-hang case: output follows"
    printf '%s\n' "$OUT"
fi

echo "T8 -- unreadable BOARD.md: other metrics still print, exit 2, no false violation"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$WORK/does-not-exist.md"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && printf '%s\n' "$OUT" | grep -q "^BOARD.md: UNKNOWN" \
    && printf '%s\n' "$OUT" | grep -q "^CONTROL.md line count:" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:"; then
    ok "missing BOARD.md: UNKNOWN reported, rest of block prints, exit 2, no false violation"
else
    bad "missing BOARD.md case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T9 -- moat baseline UNKNOWN when the last-release tag is unreadable (not 'no prior release')"
NO_GIT_REPO="$WORK/no-git-repo"
mkdir -p "$NO_GIT_REPO/tests/moat"
printf 'P1.case-a milestone reason\n' > "$NO_GIT_REPO/tests/moat/pending.txt"
if run_pulse "PULSE_REPO_ROOT=$NO_GIT_REPO" "PULSE_MAIN_REF=main" \
    "BOARD_MD=$BOARD_CLEAN" "CONTROL_MD=$CONTROL_OK" \
    "PULSE_NPM_CMD=false" "PULSE_GH_CMD=false" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO")" \
    "PULSE_SWARM_START=2026-09-26T23:00Z" "PULSE_NOW=2026-09-27T02:00:00Z"; then rc=0; else rc=$?; fi
# No .git at all in NO_GIT_REPO: the pending-derived informational count is
# now read via `git show MAIN_REF:...` (never the raw working tree, per
# finding 1's fix applied here too), so with no git repository present at
# all it correctly reads UNKNOWN rather than falling back to a working-tree
# file read that would silently ignore PULSE_MAIN_REF.
if printf '%s\n' "$OUT" | grep -qF "Moat proven (pending-derived, informational, NOT suite-verified): UNKNOWN" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_baseline" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_proven"; then
    ok "moat baseline AND pending-derived count both UNKNOWN (no .git at all), reported honestly, not as 'no prior release'"
else
    bad "moat-baseline-unknown case: output follows"
    printf '%s\n' "$OUT"
fi

echo "T9b -- BACKLOG 133 supersedes the old contract here: with NO .git at all, PULSE_MAIN_REF's HEAD"
echo "      cannot be resolved either, so SHA provenance can't be verified -- a measured FAIL must now"
echo "      report UNKNOWN (fail closed), NOT fire MOAT_REGRESSION, even though the result itself parses"
# Before BACKLOG 133's SHA-pinning fix, this case fired MOAT_REGRESSION
# because the suite-FAIL check did not need the pending-derived baseline at
# all. It now ALSO needs to resolve PULSE_MAIN_REF's current HEAD to verify
# the result's sidecar SHA is current -- and NO_GIT_REPO has no .git, so that
# resolution fails too. A result that cannot be proven current must not be
# trusted to fire a violation, so this correctly downgrades to UNKNOWN.
write_moat_sha "$MOAT_RESULT_FAIL" "$FAKE_REPO" main
if run_pulse "PULSE_REPO_ROOT=$NO_GIT_REPO" "PULSE_MAIN_REF=main" \
    "BOARD_MD=$BOARD_CLEAN" "CONTROL_MD=$CONTROL_OK" \
    "PULSE_NPM_CMD=false" "PULSE_GH_CMD=false" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO")" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_FAIL" \
    "PULSE_SWARM_START=2026-09-26T23:00Z" "PULSE_NOW=2026-09-27T02:00:00Z"; then rc=0; else rc=$?; fi
# rc=1 here, not 2: BOARD_CLEAN's 8 ready slices with zero builder worktrees
# passed independently fire IDLE_BUILDERS -- an unrelated, correct violation
# from this fixture's shape. The assertion below isolates the thing this test
# actually verifies: MOAT_REGRESSION must NOT be among the fired violations,
# and moat_regression must be UNKNOWN with the provenance-unresolvable reason.
if ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: MOAT_REGRESSION" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_baseline" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (could not verify PULSE_MOAT_RESULT's provenance: main's current HEAD could not be resolved)"; then
    ok "with no .git anywhere, MAIN_REF's HEAD cannot be resolved either, so the measured FAIL correctly downgrades to UNKNOWN instead of firing"
else
    bad "T9b baseline-unknown-but-measured case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T10 -- oldest review-pending slice reports the MAXIMUM age, not the minimum"
BOARD_REVIEWS="$WORK/BOARD-reviews.md"
cat > "$BOARD_REVIEWS" <<'EOF'
| ID | Owner | File set | Tier | Status | Notes |
|---|---|---|---|---|---|
| S-01 | a | x | LOW | review@2026-09-27T01:50Z | |
| S-02 | a | x | LOW | review@2026-09-27T01:40Z | |
EOF
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_REVIEWS"; then rc=0; else rc=$?; fi
if printf '%s\n' "$OUT" | grep -qF "Oldest review-pending slice: S-02 (20.0 min)" \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: REVIEW_STALE"; then
    ok "oldest review-pending slice is the one with the LARGEST age (S-02, 20 min), no REVIEW_STALE (under 45)"
else
    bad "oldest-review-age case: output follows"
    printf '%s\n' "$OUT"
fi

echo "T11 -- everything-except-CI_RED fires together, in the spec's fixed priority order"
BOARD_ALL="$WORK/BOARD-all.md"
cat > "$BOARD_ALL" <<'EOF'
| ID | Owner | File set | Tier | Status | Notes |
|---|---|---|---|---|---|
| S-01 | a | x | LOW | review@2026-09-27T01:00Z | |
| S-02 | a | x | LOW | ready@2026-09-27T01:00Z | |
EOF
NPM_OLD_JSON="$WORK/npm-old.json"
python3 -c "
import json
print(json.dumps({
    'created': '2020-01-01T00:00:00.000Z',
    'modified': '2026-09-25T00:00:00.000Z',
    '9.50.0': '2026-09-25T00:00:00.000Z',
}))
" > "$NPM_OLD_JSON"
(
    cd "$FAKE_REPO" || exit 1
    printf 'P1.case-a milestone reason\nP2.case-b milestone reason\nP3.case-c milestone reason\n' > tests/moat/pending.txt
    echo "change" > file2.txt
    git add file2.txt
    GIT_AUTHOR_DATE="2026-09-27T01:00:00Z" GIT_COMMITTER_DATE="2026-09-27T01:00:00Z" \
        git commit -q -m "unreleased change 2"
)
write_moat_sha "$MOAT_RESULT_FAIL" "$FAKE_REPO" main
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_ALL" \
    "PULSE_NPM_CMD=cat $NPM_OLD_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_FAIL" \
    "PULSE_SWARM_START=2026-09-01T00:00Z"; then rc=0; else rc=$?; fi
UNRELEASED_ALL_SHA="$(cd "$FAKE_REPO" && git rev-parse --short=8 main)"
EXPECTED_ALL="VIOLATION: MOAT_REGRESSION: measured moat suite reports FAIL (1 rule failure(s)) -- a live suite failure is always a regression regardless of the proven count (see $MOAT_RESULT_FAIL)
VIOLATION: UNRELEASED_MERGE: 1 commit(s) merged but unreleased for 60.0 minutes since v1.0.0 (oldest $UNRELEASED_ALL_SHA) while CI is green
VIOLATION: REVIEW_STALE: review-pending past 45 minutes: S-01 (60.0 min)
VIOLATION: IDLE_BUILDERS: only 0 active builder worktree(s) while 1 ready slice(s) exist on BOARD (S-02)
VIOLATION: LOW_READY: only 1 ready slice(s) on BOARD (want at least 8); cut 7 more
VIOLATION: NO_RECENT_RELEASE: no release in the last 90 minutes (3000.0 minutes since last release)
VIOLATION: LOW_RELEASE_VOLUME: only 0 release(s) in the last 24h (want at least 30) after 626.0 hours of swarm operation"
assert_exact_violations "T11 all-except-CI_RED" "$EXPECTED_ALL"
EXPECTED_NEXT_ALL="NEXT ACTION: MOAT_REGRESSION: identify which moat property regressed and revert or fix it before any further merge -- measured moat suite reports FAIL (1 rule failure(s)) -- a live suite failure is always a regression regardless of the proven count (see $MOAT_RESULT_FAIL)
NEXT ACTION: UNRELEASED_MERGE: cut a release now, main has been unreleased past the 30-minute budget -- 1 commit(s) merged but unreleased for 60.0 minutes since v1.0.0 (oldest $UNRELEASED_ALL_SHA) while CI is green
NEXT ACTION: REVIEW_STALE: escalate or finish review for the named slice(s), they have exceeded the 45-minute budget -- review-pending past 45 minutes: S-01 (60.0 min)
NEXT ACTION: IDLE_BUILDERS: dispatch more builders against the named ready slice(s) in docs/v10/BOARD.md -- only 0 active builder worktree(s) while 1 ready slice(s) exist on BOARD (S-02)
NEXT ACTION: LOW_READY: the Product Owner should cut the named number of additional slices onto the ready queue -- only 1 ready slice(s) on BOARD (want at least 8); cut 7 more
NEXT ACTION: NO_RECENT_RELEASE: cut a release now, none has shipped in over 90 minutes -- no release in the last 90 minutes (3000.0 minutes since last release)
NEXT ACTION: LOW_RELEASE_VOLUME: investigate why release throughput is below the 30/day target -- only 0 release(s) in the last 24h (want at least 30) after 626.0 hours of swarm operation"
actual_next_all="$(printf '%s\n' "$OUT" | grep '^NEXT ACTION:' || true)"
if [ "$actual_next_all" = "$EXPECTED_NEXT_ALL" ]; then
    ok "T11 NEXT ACTIONS: exact block matches (deleting the whole section would go red here)"
else
    bad "T11 NEXT ACTIONS mismatch"
    echo "  --- expected ---"
    printf '%s\n' "$EXPECTED_NEXT_ALL"
    echo "  --- actual ---"
    printf '%s\n' "$actual_next_all"
fi
(cd "$FAKE_REPO" || exit 1; git reset -q --hard v1.0.0)

echo "T11b -- same fixture, swarm started under 24h ago: LOW_RELEASE_VOLUME must be absent"
(
    cd "$FAKE_REPO" || exit 1
    printf 'P1.case-a milestone reason\nP2.case-b milestone reason\nP3.case-c milestone reason\n' > tests/moat/pending.txt
    echo "change" > file2.txt
    git add file2.txt
    GIT_AUTHOR_DATE="2026-09-27T01:00:00Z" GIT_COMMITTER_DATE="2026-09-27T01:00:00Z" \
        git commit -q -m "unreleased change 2"
)
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_ALL" \
    "PULSE_NPM_CMD=cat $NPM_OLD_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_SWARM_START=2026-09-27T01:00Z"; then rc=0; else rc=$?; fi
if ! printf '%s\n' "$OUT" | grep -q "^VIOLATION: LOW_RELEASE_VOLUME"; then
    ok "swarm started under 24h ago: LOW_RELEASE_VOLUME correctly absent"
else
    bad "T11b: LOW_RELEASE_VOLUME incorrectly fired"
    printf '%s\n' "$OUT"
fi
(cd "$FAKE_REPO" || exit 1; git reset -q --hard v1.0.0)

echo "T12 -- D7: an importable cwd cannot shadow a stdlib module the script needs"
SHADOW_DIR="$WORK/shadow-cwd"
mkdir -p "$SHADOW_DIR"
python3 -c "
open('$SHADOW_DIR/calendar.py', 'w').write('raise SystemExit(99)\n')
open('$SHADOW_DIR/json.py', 'w').write('raise SystemExit(99)\n')
"
_prev_pwd="$PWD"
cd "$SHADOW_DIR" || exit 1
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN"; then rc=0; else rc=$?; fi
cd "$_prev_pwd" || exit 1
if [ "$rc" != 99 ] && printf '%s\n' "$OUT" | grep -q "^=== v10-pulse status"; then
    ok "a shadow calendar.py/json.py in cwd cannot hijack the script (rc=$rc, status block printed)"
else
    bad "D7 shadow case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T13 -- excepthook backstop: a bad env var gives PULSE ERROR + exit 2, never an uncaught exit 1"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_DEADLINE_SECS=not-a-number"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] && printf '%s\n' "$OUT" | grep -q "^PULSE ERROR:"; then
    ok "malformed PULSE_DEADLINE_SECS: PULSE ERROR line, exit 2 (not 1)"
else
    bad "excepthook case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T14 -- finding 1: git-derived metrics pin to PULSE_MAIN_REF, not the calling process's own HEAD"
# Build a second tag (v2.0.0) ahead of v1.0.0 on main, add tests/moat/pending.txt
# content that differs between the two tags, then run the script with
# PULSE_REPO_ROOT's HEAD DETACHED at the OLDER tag (v1.0.0) while main has
# moved on to v2.0.0 -- exactly the reviewer's repro ("a scratch checkout at
# an older tag"). If the tag lookup, the moat-baseline read, or the pending-
# derived informational read ever again followed the calling process's own
# HEAD/working-tree instead of PULSE_MAIN_REF, this would resolve v1.0.0
# (2 pending -> 7 of 9) instead of v2.0.0 (0 pending -> 9 of 9), and would
# compute unreleased-merge age from v1.0.0 instead of v2.0.0's (later,
# smaller) commit set.
(
    cd "$FAKE_REPO" || exit 1
    printf '' > tests/moat/pending.txt
    git add tests/moat/pending.txt
    GIT_AUTHOR_DATE="2026-09-25T00:00:00Z" GIT_COMMITTER_DATE="2026-09-25T00:00:00Z" \
        git commit -q -m "close out remaining moat properties"
    git tag v2.0.0
    # One commit after v2.0.0 so "merged but unreleased" has something to
    # measure relative to the NEWER tag, not the older one.
    echo "post-v2 change" > post-v2.txt
    git add post-v2.txt
    GIT_AUTHOR_DATE="2026-09-27T01:30:00Z" GIT_COMMITTER_DATE="2026-09-27T01:30:00Z" \
        git commit -q -m "unreleased after v2.0.0"
    # Detach HEAD at the OLDER tag: this is what a "scratch checkout at an
    # older tag" (the reviewer's repro) looks like. main still points at the
    # tip. PULSE_REPO_ROOT is this same working copy either way -- only HEAD
    # differs from main.
    git checkout -q v1.0.0
)
DETACHED_HEAD_SHA="$(cd "$FAKE_REPO" && git rev-parse --short=8 HEAD)"
MAIN_TIP_SHA="$(cd "$FAKE_REPO" && git rev-parse --short=8 main)"
if [ "$DETACHED_HEAD_SHA" = "$MAIN_TIP_SHA" ]; then
    bad "T14 fixture setup: detached HEAD accidentally matches main tip, test would not discriminate"
fi
MOAT_RESULT_T14="$WORK/moat-result-t14.txt"
cat > "$MOAT_RESULT_T14" <<'EOF'
moat: 9 of 9 properties proven
moat suite: all 9 properties proven
EOF
# BACKLOG 133: the sidecar SHA must likewise be resolved against
# PULSE_MAIN_REF (main's tip), never the calling process's own detached HEAD
# -- write it against main here, so this run stays a real "SHA matches"
# clean measurement rather than tripping the new stale-SHA check.
write_moat_sha "$MOAT_RESULT_T14" "$FAKE_REPO" main
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_T14"; then rc=0; else rc=$?; fi
# Both the pending-derived informational count and the release-baseline read
# via `git show`, so both must resolve against PULSE_MAIN_REF's v2.0.0 (empty
# pending.txt -> 9 of 9), NEVER the detached HEAD's own working tree (which
# still holds v1.0.0's 2 pending ids -> 7 of 9, if either read regressed back
# to a raw file read). The unreleased-merge age must likewise read "since
# v2.0.0", never "since v1.0.0".
if printf '%s\n' "$OUT" | grep -qF "Moat proven (pending-derived, informational, NOT suite-verified): 9 of 9" \
    && printf '%s\n' "$OUT" | grep -qF "Moat proven at last release (pending-derived baseline): 9 of 9" \
    && printf '%s\n' "$OUT" | grep -qF "Moat proven (measured, PULSE_MOAT_RESULT): 9 of 9" \
    && printf '%s\n' "$OUT" | grep -q "since v2.0.0" \
    && ! printf '%s\n' "$OUT" | grep -q "since v1.0.0"; then
    ok "moat pending-derived count, baseline, unreleased-merge age, and the SHA-pinned measured result all resolve against PULSE_MAIN_REF's v2.0.0 tag, not the detached HEAD's v1.0.0"
else
    bad "T14 finding-1 repro case: rc=$rc output follows (HEAD detached at $DETACHED_HEAD_SHA, main at $MAIN_TIP_SHA)"
    printf '%s\n' "$OUT"
fi

echo "T14b -- BACKLOG 133: same fixture, but the sidecar SHA is written against the DETACHED HEAD"
echo "        (the v1.0.0 tag), not main -- must report UNKNOWN as stale, proving the SHA compare"
echo "        pins to PULSE_MAIN_REF and does not silently accept the calling process's own HEAD"
write_moat_sha "$MOAT_RESULT_T14" "$FAKE_REPO" HEAD
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_T14" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (moat result is stale, measured against ${DETACHED_HEAD_SHA} but main is now at ${MAIN_TIP_SHA})"; then
    ok "sidecar SHA pinned to the calling process's own detached HEAD (not main) correctly reports stale/UNKNOWN"
else
    bad "T14b HEAD-vs-main-pinning case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi
(cd "$FAKE_REPO" || exit 1; git checkout -q main; git tag -d v2.0.0 >/dev/null; git reset -q --hard v1.0.0)

echo "T15 -- finding 2: merged-but-unreleased age walks --first-parent, not into a merged branch's own history"
# A side branch with a commit dated BEFORE the release tag, merged into main
# AFTER it. Non-first-parent history would find the side commit's original
# (pre-release) timestamp and report a much older "oldest since tag" -- a
# false UNRELEASED_MERGE age. --first-parent must instead report the merge
# commit's own (post-release) time.
(
    cd "$FAKE_REPO" || exit 1
    git checkout -q -b side-branch v1.0.0
    echo "side work" > side.txt
    git add side.txt
    # Committed on the side branch BEFORE v1.0.0 was tagged (backdated,
    # simulating work started earlier and merged much later).
    GIT_AUTHOR_DATE="2026-09-10T00:00:00Z" GIT_COMMITTER_DATE="2026-09-10T00:00:00Z" \
        git commit -q -m "side branch work, authored well before the release"
    git checkout -q main
    GIT_AUTHOR_DATE="2026-09-27T01:45:00Z" GIT_COMMITTER_DATE="2026-09-27T01:45:00Z" \
        git merge -q --no-ff -m "merge: side branch work" side-branch
)
MERGE_SHA="$(cd "$FAKE_REPO" && git rev-parse --short=8 main)"
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT="; then rc=0; else rc=$?; fi
if printf '%s\n' "$OUT" | grep -qF "Merged-but-unreleased age: 15.0 min (1 commit(s) since v1.0.0, oldest $MERGE_SHA)"; then
    ok "first-parent walk reports the MERGE commit's time (15.0 min), not the side branch's backdated commit"
else
    bad "T15 finding-2 repro case: rc=$rc output follows (merge sha $MERGE_SHA)"
    printf '%s\n' "$OUT"
fi
(cd "$FAKE_REPO" || exit 1; git branch -D side-branch >/dev/null; git reset -q --hard v1.0.0)

echo "T16 -- finding 3 (verdict-line strictness): a bare count line with no terminal verdict line is UNKNOWN"
# A truncated or unrelated capture could contain a "moat: N of 9" substring
# without ever reaching tests/moat/run.sh's actual conclusion. Requiring one
# of its recognized terminal verdict lines guards against reading that as a
# real measurement.
MOAT_RESULT_NO_VERDICT="$WORK/moat-result-no-verdict.txt"
cat > "$MOAT_RESULT_NO_VERDICT" <<'EOF'
some unrelated log noise mentioning moat: 9 of 9 properties proven in passing
EOF
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_NO_VERDICT" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (PULSE_MOAT_RESULT file did not contain a parseable"; then
    ok "count line without a terminal verdict line is rejected as UNKNOWN, not treated as a real measurement"
else
    bad "T16 no-verdict-line case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T16b -- finding 3: tests/moat/run.sh's own COULD-NOT-CHECK verdict is never read as a measured clean"
# tests/moat/run.sh exits 2 (could not check, e.g. no release tag reachable)
# and in that case prints "moat suite: COULD NOT CHECK (...)" -- NOT one of
# the PASS/FAIL verdict lines -- even though it still unconditionally prints
# the "moat: N of 9 properties proven" count line first (see tests/moat/run.sh
# around its final echo block). If pulse's verdict-line regex ever matched
# this wording (or matched on the count line alone), a run that could not
# even check the ratchets would silently read as a real measured result.
MOAT_RESULT_COULD_NOT_CHECK="$WORK/moat-result-could-not-check.txt"
cat > "$MOAT_RESULT_COULD_NOT_CHECK" <<'EOF'
could not check: no release tag reachable; fetch tags
moat: 0 of 9 properties proven
moat suite: COULD NOT CHECK (the ratchets did not run; this is not a pass)
EOF
if run_pulse "${COMMON_ARGS[@]}" "BOARD_MD=$BOARD_CLEAN" "PULSE_MOAT_RESULT=$MOAT_RESULT_COULD_NOT_CHECK" \
    "PULSE_NPM_CMD=cat $NPM_TIME_JSON" "PULSE_GH_CMD=cat $GH_GREEN_JSON" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO" "${WT_CLEAN[@]}")"; then rc=0; else rc=$?; fi
if [ "$rc" = 2 ] \
    && ! printf '%s\n' "$OUT" | grep -q "^VIOLATION:" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_regression" \
    && printf '%s\n' "$OUT" | grep -qF "Moat regression check: UNKNOWN (PULSE_MOAT_RESULT file did not contain a parseable"; then
    ok "a real 'COULD NOT CHECK' capture is rejected as UNKNOWN, never read as a measured clean"
else
    bad "T16b could-not-check case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo "T17 -- finding 3 (decoupling): a failed pending-derived read AND an UNKNOWN release baseline do not"
echo "      blank the measured MOAT_REGRESSION check, once its own SHA provenance still checks out"
# A real .git repo (so PULSE_MAIN_REF's HEAD CAN be resolved for the BACKLOG
# 133 SHA check) tagged v1.0.0 but with no tests/moat/pending.txt blob AT
# EITHER the tag or main -- so BOTH the pending-derived informational read
# (`git show main:...`) and the release-baseline read (`git show v1.0.0:...`,
# used by the count-drop path and reported as moat_baseline UNKNOWN) fail on
# their own, while a measured, SHA-matched PULSE_MOAT_RESULT result must
# still be evaluated and still fire on a live suite FAIL. The three checks
# (pending-derived, baseline, measured) are independent safe() calls
# specifically so one's failure cannot silently blank another -- this is the
# same case T9b/T17 covered before BACKLOG 133 (an UNKNOWN baseline must not
# gate the measured suite-FAIL check), reconstructed here with a repo whose
# main IS resolvable so the new SHA check does not also fire. (Pre-BACKLOG-133
# this used NO_GIT_REPO, which had no .git at all -- that now also makes
# MAIN_REF's HEAD unresolvable, which is the different, UNKNOWN-provenance
# case T9b covers instead.)
NO_PENDING_REPO="$WORK/no-pending-repo"
mkdir -p "$NO_PENDING_REPO"
(
    cd "$NO_PENDING_REPO" || exit 1
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "test"
    echo "no moat dir here" > README.md
    git add README.md
    GIT_AUTHOR_DATE="2026-09-27T00:00:00Z" GIT_COMMITTER_DATE="2026-09-27T00:00:00Z" \
        git commit -q -m "no tests/moat/pending.txt on this repo"
    git tag v1.0.0
)
write_moat_sha "$MOAT_RESULT_FAIL" "$NO_PENDING_REPO" main
if run_pulse "PULSE_REPO_ROOT=$NO_PENDING_REPO" "PULSE_MAIN_REF=main" \
    "BOARD_MD=$BOARD_CLEAN" "CONTROL_MD=$CONTROL_OK" \
    "PULSE_NPM_CMD=false" "PULSE_GH_CMD=false" \
    "PULSE_WORKTREE_CMD=$(worktree_cmd_for "$FAKE_REPO")" \
    "PULSE_MOAT_RESULT=$MOAT_RESULT_FAIL" \
    "PULSE_SWARM_START=2026-09-26T23:00Z" "PULSE_NOW=2026-09-27T02:00:00Z"; then rc=0; else rc=$?; fi
if [ "$rc" = 1 ] \
    && printf '%s\n' "$OUT" | grep -qF "Moat proven (pending-derived, informational, NOT suite-verified): UNKNOWN" \
    && printf '%s\n' "$OUT" | grep -q "^UNKNOWN metrics:.*moat_baseline" \
    && printf '%s\n' "$OUT" | grep -qF "VIOLATION: MOAT_REGRESSION: measured moat suite reports FAIL"; then
    ok "pending-derived read AND release-baseline both UNKNOWN (no pending.txt blob anywhere) do not stop the independent, SHA-verified measured-result check from firing"
else
    bad "T17 decoupling case: rc=$rc output follows"
    printf '%s\n' "$OUT"
fi

echo ""
echo "=== bash 3.2 syntax + full-suite check (via /bin/sh, real bash 3.2.57 on macOS) ==="
if command -v /bin/sh >/dev/null 2>&1 && /bin/sh -c 'case "$BASH_VERSION" in 3.2*) exit 0;; *) exit 1;; esac' 2>/dev/null; then
    if /bin/sh -n "$PULSE_SH"; then
        ok "scripts/v10-pulse.sh: /bin/sh -n (bash 3.2.57) syntax OK"
    else
        bad "scripts/v10-pulse.sh: /bin/sh -n syntax check FAILED"
    fi
    if /bin/sh -n "$SCRIPT_DIR/test-v10-pulse.sh"; then
        ok "tests/test-v10-pulse.sh: /bin/sh -n (bash 3.2.57) syntax OK"
    else
        bad "tests/test-v10-pulse.sh: /bin/sh -n syntax check FAILED"
    fi
    if [ "$TEST_SHELL" = "bash" ]; then
        echo "  (this run interprets scripts/v10-pulse.sh with bash; re-run with"
        echo "   PULSE_TEST_SHELL=sh to execute the whole suite under real bash 3.2.57)"
    fi
else
    echo "  [SKIP] /bin/sh is not bash 3.2.x on this host; bash -n fallback only"
fi
if bash -n "$PULSE_SH"; then
    ok "scripts/v10-pulse.sh: bash -n syntax OK"
else
    bad "scripts/v10-pulse.sh: bash -n syntax check FAILED"
fi
if bash -n "$SCRIPT_DIR/test-v10-pulse.sh"; then
    ok "tests/test-v10-pulse.sh: bash -n syntax OK"
else
    bad "tests/test-v10-pulse.sh: bash -n syntax check FAILED"
fi

echo ""
TOTAL=$((PASS + FAIL))
echo "Results: $PASS passed, $FAIL failed, $TOTAL total"
[ "$FAIL" -eq 0 ]
