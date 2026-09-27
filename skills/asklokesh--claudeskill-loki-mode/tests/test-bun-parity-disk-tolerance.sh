#!/usr/bin/env bash
# tests/test-bun-parity-disk-tolerance.sh -- BACKLOG 26.
#
# The Bun Parity CI job (.github/workflows/bun-parity.yml) compares
# `doctor --json` output from the bash and Bun routes byte-for-byte after
# jq -S normalization. disk.available_gb is a live df read taken
# independently by each route a few ms apart, so it can legitimately differ
# by a small amount (94 vs 95 GB) between two otherwise-identical routes.
# The old normalization only floored the value (absorbing the Python
# 58.0-vs-JS-58 formatting difference from v7.4.12), which does nothing for
# a genuine integer drift -- 94 and 95 both floor to themselves -- so the
# gate flaked on real, harmless disk-measurement jitter.
#
# This test extracts the CURRENT disk-comparison block from bun-parity.yml
# verbatim (between the BACKLOG-26-DISK-TOLERANCE-BEGIN/END markers) and
# executes it against synthetic doctor-json fixtures, so it exercises the
# exact code the CI job runs rather than a hand-copied re-implementation
# that could silently drift from it.
#
# It also replays the OLD (pre-fix) comparison, extracted via
# `git show a4177fbf:...`, as the RED control: the old logic must flag the
# 94-vs-95 case as a mismatch, proving the bug was real before asserting the
# new logic fixes it.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/bun-parity.yml"
BASE_SHA="a4177fbf354af406460dd987750e4c89ed9dfc9d"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH"
    exit 0
fi

TMPROOT="$(mktemp -d)"
cleanup() { [ -n "${TMPROOT:-}" ] && [ -d "$TMPROOT" ] && rm -rf "$TMPROOT"; }
trap cleanup EXIT

# --- extract the CURRENT comparison block from the workflow file ---------
NEW_BLOCK="$TMPROOT/new_block.sh"
awk '/BACKLOG-26-DISK-TOLERANCE-BEGIN/{f=1} f{print} /BACKLOG-26-DISK-TOLERANCE-END/{f=0}' \
    "$WORKFLOW" > "$NEW_BLOCK"
if [ ! -s "$NEW_BLOCK" ]; then
    bad "could not extract disk-tolerance block from $WORKFLOW (markers missing)"
    exit 1
fi
ok "extracted current disk-comparison block from bun-parity.yml"

# Run the extracted block against a $bun_out/$bash_out pair and report
# whether it treated the pair as a match (PASS) or mismatch (FAIL).
# The block references FAILED+=(...)/PASSED+=(...) and `continue`; run it in
# a function body inside a loop of one so `continue` is legal, and disable -e
# so a `jq -e` false result does not abort the harness itself. Its own
# diagnostic echo/cat output is redirected away so it cannot leak into a
# caller's $(...) capture.
run_new_logic() {
    local bun_out="$1" bash_out="$2"
    local FAILED=() PASSED=()
    local label="fixture"
    local diff_out="$TMPROOT/diff_out.$$"
    local bash_ec=0 bun_ec=0
    set +e
    # shellcheck disable=SC1090,SC2043
    for _once in once; do
        source "$NEW_BLOCK" >/dev/null 2>&1
    done
    set -e
    if [ "${#FAILED[@]}" -gt 0 ]; then
        printf 'FAIL'
    else
        printf 'PASS'
    fi
}

# --- the OLD (pre-fix) comparison, for the RED control -------------------
# Hardcoded rather than read live from $BASE_SHA: this is frozen history
# (bun-parity.yml as of a4177fbf) and cannot drift, and a shallow checkout
# in CI (actions/checkout defaults to fetch-depth 1) would otherwise make
# `git show $BASE_SHA:...` fail, silently skipping every RED/GREEN/mutation
# assertion below while the test still reports overall PASS. If the repo
# history back to $BASE_SHA IS available, cross-check the two agree; if not,
# proceed without blocking (this is a sanity check, not a scope reduction --
# the assertions below never depend on `git show` succeeding).
OLD_JQ_NORM='if .disk?.available_gb? != null then .disk.available_gb = (.disk.available_gb | floor) else . end'
OLD_WORKFLOW="$TMPROOT/old-bun-parity.yml"
if git -C "$REPO_ROOT" show "${BASE_SHA}:.github/workflows/bun-parity.yml" >"$OLD_WORKFLOW" 2>/dev/null; then
    live_old_jq_norm="$(grep -o "JQ_NORM='[^']*'" "$OLD_WORKFLOW" | head -1 | sed "s/^JQ_NORM='//; s/'$//")"
    if [ "$live_old_jq_norm" = "$OLD_JQ_NORM" ]; then
        ok "hardcoded pre-fix JQ_NORM matches $BASE_SHA (cross-checked)"
    else
        bad "hardcoded pre-fix JQ_NORM does not match $BASE_SHA -- got: $live_old_jq_norm"
    fi
else
    echo "INFO: cannot read $BASE_SHA:.github/workflows/bun-parity.yml (shallow clone) -- using the hardcoded pre-fix expression without cross-check"
fi

run_old_logic() {
    local bun_out="$1" bash_out="$2"
    local bun_s="$TMPROOT/old_bun.sorted" bash_s="$TMPROOT/old_bash.sorted"
    if ! jq -S "$OLD_JQ_NORM" "$bun_out" >"$bun_s" 2>/dev/null; then
        echo "FAIL"
        return
    fi
    if ! jq -S "$OLD_JQ_NORM" "$bash_out" >"$bash_s" 2>/dev/null; then
        echo "FAIL"
        return
    fi
    if diff -q "$bash_s" "$bun_s" >/dev/null 2>&1; then
        echo "PASS"
    else
        echo "FAIL"
    fi
}

mkfixture() { printf '%s' "$2" > "$TMPROOT/$1"; echo "$TMPROOT/$1"; }

f_94=$(mkfixture bun94.json '{"disk":{"available_gb":94}}')
f_95=$(mkfixture bash95.json '{"disk":{"available_gb":95}}')
f_50=$(mkfixture v50.json '{"disk":{"available_gb":50}}')
f_float58=$(mkfixture float58.json '{"disk":{"available_gb":58.0}}')
f_int58=$(mkfixture int58.json '{"disk":{"available_gb":58}}')
f_nodisk=$(mkfixture nodisk.json '{}')
f_94b=$(mkfixture bun94_other.json '{"disk":{"available_gb":94},"other":"x"}')
f_94c=$(mkfixture bun94_other2.json '{"disk":{"available_gb":94},"other":"y"}')
f_same_a=$(mkfixture same_a.json '{"a":1}')
f_same_b=$(mkfixture same_b.json '{"a":1}')

# --- RED: the OLD logic must flag the harmless 94-vs-95 drift as a mismatch
old_result="$(run_old_logic "$f_94" "$f_95")"
if [ "$old_result" = "FAIL" ]; then
    ok "RED confirmed: old comparison logic flags 94 vs 95 as a mismatch"
else
    bad "expected old logic to flag 94 vs 95 as a mismatch (got $old_result) -- RED control did not reproduce the bug"
fi

# --- GREEN: the NEW logic must NOT flag 94 vs 95 -------------------------
new_result="$(run_new_logic "$f_94" "$f_95")"
if [ "$new_result" = "PASS" ]; then
    ok "GREEN confirmed: new comparison logic does not flag 94 vs 95"
else
    bad "expected new logic to accept 94 vs 95 (got $new_result)"
fi

# --- a genuinely different value must still be flagged --------------------
new_result_diverge="$(run_new_logic "$f_94" "$f_50")"
if [ "$new_result_diverge" = "FAIL" ]; then
    ok "new logic still flags a real divergence (94 vs 50)"
else
    bad "new logic wrongly accepted a real divergence (94 vs 50, got $new_result_diverge) -- check is too permissive"
fi

# --- the original v7.4.12 case (float vs int formatting) must still pass --
new_result_float="$(run_new_logic "$f_float58" "$f_int58")"
if [ "$new_result_float" = "PASS" ]; then
    ok "new logic preserves the v7.4.12 fix (58.0 vs 58 formatting)"
else
    bad "new logic regressed the v7.4.12 float-vs-int case (got $new_result_float)"
fi

# --- one side missing the key entirely is a real divergence --------------
new_result_missing="$(run_new_logic "$f_94" "$f_nodisk")"
if [ "$new_result_missing" = "FAIL" ]; then
    ok "new logic flags a missing disk.available_gb key on one side"
else
    bad "new logic wrongly accepted a missing key on one side (got $new_result_missing)"
fi

# --- identical disk, but a different unrelated field: must still flag ----
new_result_other_field="$(run_new_logic "$f_94b" "$f_94c")"
if [ "$new_result_other_field" = "FAIL" ]; then
    ok "new logic still flags a real divergence in an unrelated field"
else
    bad "new logic wrongly ignored a divergence outside disk.available_gb (got $new_result_other_field)"
fi

# --- both sides missing disk entirely (e.g. status-json, stats-json,
#     which have no disk key at all) must still pass on an otherwise
#     identical payload ----------------------------------------------------
new_result_nodisk_identical="$(run_new_logic "$f_same_a" "$f_same_b")"
if [ "$new_result_nodisk_identical" = "PASS" ]; then
    ok "new logic passes identical payloads with no disk key on either side"
else
    bad "new logic wrongly flagged identical no-disk payloads (got $new_result_nodisk_identical)"
fi

# --- mutation check: an absurdly large tolerance must let the real
#     divergence through, proving the assertions above actually exercise
#     the tolerance value rather than passing vacuously ------------------
MUTATED_BLOCK="$TMPROOT/mutated_block.sh"
sed 's/DISK_TOLERANCE_GB=3/DISK_TOLERANCE_GB=100/' "$NEW_BLOCK" > "$MUTATED_BLOCK"
run_mutated_logic() {
    local bun_out="$1" bash_out="$2"
    local FAILED=() PASSED=()
    local label="fixture"
    local diff_out="$TMPROOT/diff_out.$$"
    local bash_ec=0 bun_ec=0
    set +e
    # shellcheck disable=SC1090,SC2043
    for _once in once; do
        source "$MUTATED_BLOCK" >/dev/null 2>&1
    done
    set -e
    if [ "${#FAILED[@]}" -gt 0 ]; then
        printf 'FAIL'
    else
        printf 'PASS'
    fi
}
mutated_result="$(run_mutated_logic "$f_94" "$f_50")"
if [ "$mutated_result" = "PASS" ]; then
    ok "mutation check: widening the tolerance to 100 lets 94-vs-50 through, confirming the assertions above depend on the real tolerance value"
else
    bad "mutation check inconclusive: widening tolerance to 100 still flagged 94 vs 50 (got $mutated_result)"
fi

echo ""
echo "test-bun-parity-disk-tolerance.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
