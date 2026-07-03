#!/usr/bin/env bash
# tests/test-loki-dir-double-path.sh -- regression guard for the double-.loki
# COMPLETED-path bug (task #80).
#
# THE BUG
#   autonomy/loki sets LOKI_DIR="${LOKI_DIR:-.loki}" (so at runtime LOKI_DIR is
#   the string ".loki", not unset). Two sites in autonomy/run.sh built the loki
#   working dir with the brace CLOSED BEFORE the "/.loki" append:
#       local loki_dir="${LOKI_DIR:-${TARGET_DIR:-.}}/.loki"
#   With LOKI_DIR=".loki" this expands to ".loki" + "/.loki" = ".loki/.loki".
#   The COMPLETED marker write (_advance_current_phase caller) then did
#       echo ... > "$loki_dir/COMPLETED"
#   which failed at runtime with ".loki/.loki/COMPLETED: No such file or
#   directory". The correct sibling form keeps "/.loki" INSIDE the :- default:
#       local loki_dir="${LOKI_DIR:-${TARGET_DIR:-.}/.loki}"
#   so a SET LOKI_DIR is used verbatim and only the UNSET fallback appends.
#
# WHAT THIS TEST DOES (source-grounded, no hardcoded copy of the fix)
#   1. Extracts EVERY `local loki_dir="${LOKI_DIR:-...` line from the real
#      autonomy/run.sh and asserts each resolves to ".loki" (single) under
#      LOKI_DIR=".loki", and to "$TARGET_DIR/.loki" when LOKI_DIR is unset.
#      A regression at ANY of those sites fails this test.
#   2. Proves the assertion is NOT vacuous by evaluating the BUGGY literal
#      in-process and asserting it yields the double ".loki/.loki" -- so we get
#      RED evidence WITHOUT ever reverting the real source file. (Reverting to
#      prove RED has silently dropped a fix before; we never do that here.)
#   3. Guards the COMPLETED-marker path specifically: the _advance_current_phase
#      loki_dir and the session-completed loki_dir must both be single-.loki.

set -uo pipefail

SCRIPT_DIR_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_TEST/.." && pwd)"
RUN_SH="${LOKI_RUN_SH_OVERRIDE:-$REPO_ROOT/autonomy/run.sh}"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if [ ! -f "$RUN_SH" ]; then
    echo "SKIP: $RUN_SH not found. (Not a fail.)"; exit 0
fi

# resolve_rhs: eval a bare loki_dir RHS in a clean subshell with the two inputs
# set explicitly. The `local` keyword is stripped by the caller (it cannot be
# used at top level). We `unset` the OTHER variable so nothing ambient leaks in.
# $1 = the RHS expression (e.g. '${LOKI_DIR:-${TARGET_DIR:-.}/.loki}')
# $2 = value for LOKI_DIR, or the literal token __UNSET__ to leave it unset
# $3 = value for TARGET_DIR, or __UNSET__
resolve_rhs() {
    local rhs="$1" lokidir_val="$2" targetdir_val="$3"
    (
        if [ "$lokidir_val" = "__UNSET__" ]; then unset LOKI_DIR; else LOKI_DIR="$lokidir_val"; fi
        if [ "$targetdir_val" = "__UNSET__" ]; then unset TARGET_DIR; else TARGET_DIR="$targetdir_val"; fi
        eval "resolved=\"$rhs\""
        # shellcheck disable=SC2154  # 'resolved' is assigned by the eval above.
        printf '%s' "$resolved"
    )
}

# ---------------------------------------------------------------------------
# 1. NON-VACUITY (RED evidence, no revert): the BUGGY literal must double.
# ---------------------------------------------------------------------------
BUGGY_RHS='${LOKI_DIR:-${TARGET_DIR:-.}}/.loki'
red_set="$(resolve_rhs "$BUGGY_RHS" ".loki" "__UNSET__")"
echo "RED (buggy form, LOKI_DIR=.loki): loki_dir='$red_set'"
if [ "$red_set" = ".loki/.loki" ]; then
    ok "buggy form doubles to .loki/.loki (assertion is non-vacuous)"
else
    bad "buggy form did NOT double" "got '$red_set' (test would not catch the bug)"
fi

# ---------------------------------------------------------------------------
# 2. GREEN: every real LOKI_DIR-referencing site resolves single-.loki.
# ---------------------------------------------------------------------------
# Pull each `local loki_dir="${LOKI_DIR:-...` line from the live source, strip
# the `    local loki_dir=` prefix and the surrounding double-quotes, leaving the
# bare RHS expression for eval.
mapfile -t SITE_LINES < <(grep -nF 'local loki_dir="${LOKI_DIR:-' "$RUN_SH")

if [ "${#SITE_LINES[@]}" -eq 0 ]; then
    bad "no LOKI_DIR-referencing loki_dir sites found in run.sh" "grep returned nothing"
fi

for entry in "${SITE_LINES[@]}"; do
    lineno="${entry%%:*}"
    # everything after the first colon is the source line
    src="${entry#*:}"
    # extract the RHS inside the double quotes: local loki_dir="<RHS>"
    rhs="${src#*local loki_dir=\"}"
    rhs="${rhs%\"*}"

    # GREEN case A: LOKI_DIR set to ".loki" (the real autonomy/loki default) ->
    # must be exactly ".loki", never ".loki/.loki".
    got_set="$(resolve_rhs "$rhs" ".loki" "__UNSET__")"
    if [ "$got_set" = ".loki" ]; then
        ok "run.sh:$lineno LOKI_DIR=.loki -> '.loki' (single)"
    else
        bad "run.sh:$lineno double-.loki regression" "LOKI_DIR=.loki gave '$got_set' (want '.loki')"
    fi

    # GREEN case B: LOKI_DIR UNSET, TARGET_DIR=/tmp/x -> "/tmp/x/.loki"
    # (proves the unset fallback is preserved; no behavior change there).
    got_unset="$(resolve_rhs "$rhs" "__UNSET__" "/tmp/x")"
    if [ "$got_unset" = "/tmp/x/.loki" ]; then
        ok "run.sh:$lineno LOKI_DIR unset,TARGET_DIR=/tmp/x -> '/tmp/x/.loki'"
    else
        bad "run.sh:$lineno unset-fallback changed" "got '$got_unset' (want '/tmp/x/.loki')"
    fi
done

# ---------------------------------------------------------------------------
# 3. COMPLETED-marker paths specifically: EVERY `> "$loki_dir/COMPLETED"` write
#    must be fed by a loki_dir that resolves single-.loki under LOKI_DIR=".loki".
#    This is the exact class of line whose misresolution produced
#    ".loki/.loki/COMPLETED: No such file or directory". We check the nearest
#    PRECEDING `local loki_dir=` assignment for each write, whatever its form
#    (LOKI_DIR-based or TARGET_DIR-based), so a regression at either marker site
#    is caught.
# ---------------------------------------------------------------------------
mapfile -t COMPLETED_WRITES < <(grep -nF '> "$loki_dir/COMPLETED"' "$RUN_SH")
if [ "${#COMPLETED_WRITES[@]}" -eq 0 ]; then
    bad "COMPLETED marker write not found" "expected a '> \"\$loki_dir/COMPLETED\"' line in run.sh"
fi
for cw in "${COMPLETED_WRITES[@]}"; do
    cw_lineno="${cw%%:*}"
    # nearest preceding loki_dir assignment (any form).
    preceding="$(awk -v n="$cw_lineno" 'NR<n && /local loki_dir=/ {ln=NR; line=$0} END{print ln"\t"line}' "$RUN_SH")"
    p_lineno="${preceding%%$'\t'*}"
    p_src="${preceding#*$'\t'}"
    p_rhs="${p_src#*local loki_dir=\"}"
    p_rhs="${p_rhs%\"*}"
    p_got="$(resolve_rhs "$p_rhs" ".loki" "__UNSET__")"
    # The invariant is "no doubled .loki segment" -- both the LOKI_DIR form
    # (-> ".loki") and the TARGET_DIR form (-> "./.loki" when TARGET_DIR unset)
    # are correct single-.loki paths; only ".loki/.loki" is the reported bug.
    case "$p_got" in
        *.loki/.loki*)
            bad "COMPLETED write run.sh:$cw_lineno doubles" "loki_dir run.sh:$p_lineno resolved '$p_got' -> would write '$p_got/COMPLETED' (the reported failure)"
            ;;
        *)
            ok "COMPLETED write run.sh:$cw_lineno fed by loki_dir run.sh:$p_lineno -> '$p_got/COMPLETED' (no double .loki)"
            ;;
    esac
done

# ---------------------------------------------------------------------------
echo ""
echo "loki-dir double-path: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
