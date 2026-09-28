#!/usr/bin/env bash
#===============================================================================
# tests/test-council-shadow-write-project-dir.sh
#
# Sibling of the S-22 fix (BACKLOG 63): council_should_stop's shadow-write
# call ran `cd "${PROJECT_DIR:-$(pwd)}"` then EXECUTED
# `python3 -m memory.managed_memory.shadow_write` as a module. With
# PROJECT_DIR unset, cwd defaults to wherever the council happens to run --
# which can ship its own memory/managed_memory/shadow_write.py shadowing the
# real one. Because this path EXECUTES the module (not just imports one for
# reading, like S-22's retrieve.py sibling), an unset PROJECT_DIR here is
# real arbitrary code execution in the council's environment, confirmed by a
# reviewer who built a hostile shadow_write.py and observed it run.
#
# On the primary `loki start` route, autonomy/run.sh sets PROJECT_DIR (to
# the loki install root) before sourcing completion-council.sh, so this is
# defense-in-depth for that route; the vector is live for any caller that
# sources completion-council.sh directly without that bootstrap (tests,
# alternate entry points). Either way the contract must hold: PROJECT_DIR
# unset -> no execution, ever.
#
# This test proves, with two DISTINCT marker files (one hostile, one
# legitimate), which module executes, against the REAL (fixed)
# council_should_stop:
#
#   1. GREEN: PROJECT_DIR unset, cwd = a directory shipping its own
#      memory/managed_memory/shadow_write.py -> the module must NOT execute
#      (checked over a full poll window, since the real call is
#      backgrounded + disowned), and council_should_stop must still return 0
#      (STOP) and still write COMPLETED -- the skip is clean, not an error.
#   2. Mutation-discriminating control: PROJECT_DIR explicitly set to a
#      SEPARATE legitimate project directory that ALSO has its own
#      memory/managed_memory/shadow_write.py (writing legit.marker), while
#      the hostile package is STILL PRESENT at cwd. Only legit.marker may
#      appear; hostile.marker must not.
#   3. In-file mutant leg (S-172, BACKLOG 132): a scratch copy of
#      completion-council.sh with the `-n PROJECT_DIR` guard removed AND the
#      cd restored to the pre-fix `cd "${PROJECT_DIR:-$(pwd)}"`. The leg must
#      go RED, asserted on the hostile executed-module marker.
#
# Why the mutant is not "strip the guard only": with the guard gone and
# PROJECT_DIR unset the call becomes `cd ""`. bash 5.3 hard-fails that
# ("cd: null directory") so nothing executes and a strip-only mutant stays
# green; /bin/bash 3.2.57 treats it as a no-op, stays in the hostile cwd and
# executes. Measured 2026-09-27 on 5.3.9 and 3.2.57. The mutant therefore
# restores the pre-fix cwd fallback, which runs identically on every bash, so
# the assertion is on which module executed, never on what `cd ""` does.
# The mutation is verified to apply exactly once per anchor, so a rewording
# of the fix fails this test loudly instead of turning the leg vacuous.
#
# Every leg runs under /bin/bash (when present) AND the PATH bash; both
# version strings are printed.
#
# Runnable standalone: bash tests/test-council-shadow-write-project-dir.sh
# Exits 0 on pass, non-zero on fail. Self-cleaning via mktemp + trap.
#===============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COUNCIL_SH="$REPO_ROOT/autonomy/completion-council.sh"

[ -f "$COUNCIL_SH" ] || { echo "FAIL: cannot find $COUNCIL_SH"; exit 1; }

command -v timeout >/dev/null 2>&1 || {
    echo "FAIL: 'timeout' not on PATH -- this would silently no-op and look like the fix"
    exit 1
}

PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-shadow-write-pd-XXXXXX")"
cleanup() { cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "${WORK:-/nonexistent}"; }
trap cleanup EXIT INT TERM

#-------------------------------------------------------------------------------
# Mutant copy: $WORK/autonomy mirrors the real autonomy/ via symlinks (so
# BASH_SOURCE-relative sourcing of siblings still resolves), except
# completion-council.sh, which is the mutated file.
#-------------------------------------------------------------------------------
MUTANT_DIR="$WORK/autonomy"
MUTANT_SH="$MUTANT_DIR/completion-council.sh"
mkdir -p "$MUTANT_DIR"
for _entry in "$REPO_ROOT/autonomy"/*; do
    [ "$(basename "$_entry")" = "completion-council.sh" ] && continue
    ln -s "$_entry" "$MUTANT_DIR/$(basename "$_entry")"
done
GUARD_ANCHOR='[ -n "${PROJECT_DIR:-}" ]; then'
CD_ANCHOR='cd "$PROJECT_DIR" 2>/dev/null'
n_guard="$(grep -cF "$GUARD_ANCHOR" "$COUNCIL_SH")"
n_cd="$(grep -cF "$CD_ANCHOR" "$COUNCIL_SH")"
if [ "$n_guard" != "1" ] || [ "$n_cd" != "1" ]; then
    echo "FAIL: mutation anchors not unique in completion-council.sh (guard=$n_guard cd=$n_cd); update the mutant leg"
    exit 1
fi
# shellcheck disable=SC2016
sed -e 's|\[ -n "\${PROJECT_DIR:-}" \]; then|true; then|' \
    -e 's|cd "\$PROJECT_DIR" 2>/dev/null|cd "${PROJECT_DIR:-$(pwd)}" 2>/dev/null|' \
    "$COUNCIL_SH" > "$MUTANT_SH"
n_diff="$(diff "$COUNCIL_SH" "$MUTANT_SH" | grep -c '^>')"
if [ "$n_diff" != "2" ] || grep -qF "$GUARD_ANCHOR" "$MUTANT_SH" || grep -qF "$CD_ANCHOR" "$MUTANT_SH"; then
    echo "FAIL: mutant did not apply cleanly (changed lines=$n_diff, expected 2)"
    exit 1
fi

#-------------------------------------------------------------------------------
# Fixtures: two distinct memory.managed_memory.shadow_write modules under
# $1 (one fresh set per interpreter, so a late backgrounded write from one
# interpreter's legs can never land in the next interpreter's poll window).
#-------------------------------------------------------------------------------
make_fixtures() {
    local base="$1" pkg
    for pkg in hostile_repo legit_project; do
        mkdir -p "$base/$pkg/memory/managed_memory"
        : > "$base/$pkg/memory/__init__.py"
        : > "$base/$pkg/memory/managed_memory/__init__.py"
    done
    cat > "$base/hostile_repo/memory/managed_memory/shadow_write.py" <<PYEOF
with open(r"$base/hostile.marker", "w") as f:
    f.write("HOSTILE-SHADOW-WRITE-EXECUTED")
PYEOF
    cat > "$base/legit_project/memory/managed_memory/shadow_write.py" <<PYEOF
with open(r"$base/legit.marker", "w") as f:
    f.write("LEGIT-SHADOW-WRITE-EXECUTED")
PYEOF
    echo 'unset PROJECT_DIR' > "$base/env-unset.sh"
    echo "export PROJECT_DIR=\"$base/legit_project\"" > "$base/env-ctrl.sh"
}

#-------------------------------------------------------------------------------
# Poll helper: wait up to ($2 * 0.5)s (default 20 iters ~10s) for file $1.
# Used for BOTH positive and negative checks -- a negative check racing a
# short sleep against a backgrounded job is not trustworthy.
#-------------------------------------------------------------------------------
wait_for_file() {
    local f="$1" max_iters="${2:-20}" i=0
    while [ "$i" -lt "$max_iters" ]; do
        [ -e "$f" ] && return 0
        sleep 0.5
        i=$((i + 1))
    done
    [ -e "$f" ]
}

#-------------------------------------------------------------------------------
# run_council: under interpreter $1, source council file $2, stub the heavy
# deps the same way tests/test-council-force-stop-wave7.sh does, force the
# STOP + council_evaluate-approves path, and call council_should_stop.
# Args: $1 = bash binary, $2 = council file, $3 = cwd, $4 = env script,
#       $5 = target dir. Prints "rc:completed", or SOURCE-FAILED.
#-------------------------------------------------------------------------------
run_council() {
    local sh_bin="$1" council="$2" run_cwd="$3" env_script="$4" target_dir="$5"
    "$sh_bin" -c '
        set +e
        COUNCIL_SH="$1"; RUN_CWD="$2"; ENV_SCRIPT="$3"; TARGET_DIR="$4"
        cd "$RUN_CWD" || exit 1

        # shellcheck disable=SC1090
        source "$COUNCIL_SH" >/dev/null 2>&1
        declare -F council_should_stop >/dev/null || { echo SOURCE-FAILED; exit 3; }

        log_info() { :; }; log_warn() { :; }; log_error() { :; }
        log_header() { :; }; log_debug() { :; }; log_success() { :; }

        council_write_report()                { :; }
        council_augment_from_managed_memory()  { return 0; }
        council_managed_should_stop()          { return 1; }
        council_circuit_breaker_triggered()    { return 1; }
        council_evaluate()                     { return 0; }   # approve -> STOP branch

        COUNCIL_ENABLED="true"
        COUNCIL_MIN_ITERATIONS=3
        COUNCIL_CHECK_INTERVAL=5
        ITERATION_COUNT=10
        mkdir -p "$TARGET_DIR/.loki/council/verdicts" 2>/dev/null || true
        echo "{\"verdict\":\"approve\"}" > "$TARGET_DIR/.loki/council/verdicts/iteration-10.json"

        LOKI_MANAGED_AGENTS=true
        LOKI_MANAGED_MEMORY=true

        # shellcheck disable=SC1090
        source "$ENV_SCRIPT"

        council_should_stop
        rc=$?
        completed="0"
        [ -f "$TARGET_DIR/.loki/COMPLETED" ] && completed="1"
        echo "${rc}:${completed}"
    ' _ "$council" "$run_cwd" "$env_script" "$target_dir"
}

#-------------------------------------------------------------------------------
# Interpreters: /bin/bash when present, plus the PATH bash (deduplicated).
#-------------------------------------------------------------------------------
INTERPS=()
[ -x /bin/bash ] && INTERPS+=("/bin/bash")
PATH_BASH="$(command -v bash)"
if [ -n "$PATH_BASH" ] && [ "$PATH_BASH" != "/bin/bash" ]; then
    INTERPS+=("$PATH_BASH")
fi
[ "${#INTERPS[@]}" -gt 0 ] || { echo "FAIL: no bash interpreter found"; exit 1; }

idx=0
for SH_BIN in "${INTERPS[@]}"; do
    idx=$((idx + 1))
    ver="$("$SH_BIN" --version | head -1)"
    echo ""
    echo "=== interpreter: $SH_BIN -- $ver ==="
    B="$WORK/run$idx"
    make_fixtures "$B"
    HOSTILE_MARKER="$B/hostile.marker"
    LEGIT_MARKER="$B/legit.marker"

    #---------------------------------------------------------------------------
    # 1. GREEN: PROJECT_DIR unset, cwd = hostile repo.
    #---------------------------------------------------------------------------
    mkdir -p "$B/target_green"
    out_green="$(run_council "$SH_BIN" "$COUNCIL_SH" "$B/hostile_repo" "$B/env-unset.sh" "$B/target_green")"
    rc_green="${out_green%%:*}"
    completed_green="${out_green##*:}"

    if wait_for_file "$HOSTILE_MARKER" 20; then
        fail "[$ver] council_should_stop (PROJECT_DIR unset, hostile cwd) EXECUTED the hostile shadow_write.py: $(cat "$HOSTILE_MARKER" 2>/dev/null)"
    else
        pass "[$ver] council_should_stop (PROJECT_DIR unset, hostile cwd) does NOT execute the hostile module (checked over full poll window)"
    fi

    if [ "$rc_green" = "0" ] && [ "$completed_green" = "1" ]; then
        pass "[$ver] council_should_stop still returns 0 (STOP) and writes COMPLETED (rc=$rc_green completed=$completed_green)"
    else
        fail "[$ver] STOP semantics broken (out=$out_green, expected 0:1)"
    fi
    rm -f "$HOSTILE_MARKER"

    #---------------------------------------------------------------------------
    # 2. Control: PROJECT_DIR set to the legit project, hostile package still
    #    present at cwd. Only legit.marker may appear.
    #---------------------------------------------------------------------------
    mkdir -p "$B/target_ctrl"
    run_council "$SH_BIN" "$COUNCIL_SH" "$B/hostile_repo" "$B/env-ctrl.sh" "$B/target_ctrl" >/dev/null

    if wait_for_file "$LEGIT_MARKER" 20; then
        pass "[$ver] with PROJECT_DIR set to the legit project, the legit shadow_write.py executes -- the fix HONORS PROJECT_DIR"
    else
        fail "[$ver] legit.marker never appeared -- fix may just be disabling the feature outright"
    fi
    if [ -e "$HOSTILE_MARKER" ]; then
        fail "[$ver] hostile.marker appeared -- PROJECT_DIR did not override cwd"
    else
        pass "[$ver] hostile.marker did NOT appear even though the hostile package is still present at cwd"
    fi
    rm -f "$HOSTILE_MARKER" "$LEGIT_MARKER"

    #---------------------------------------------------------------------------
    # 3. Mutant leg: guard removed + pre-fix cwd fallback. Must go RED, i.e.
    #    the hostile module must execute (asserted on its marker content).
    #---------------------------------------------------------------------------
    mkdir -p "$B/target_mutant"
    out_mut="$(run_council "$SH_BIN" "$MUTANT_SH" "$B/hostile_repo" "$B/env-unset.sh" "$B/target_mutant")"
    if [ "$out_mut" = "SOURCE-FAILED" ]; then
        fail "[$ver] mutant copy failed to source -- mutant leg would be vacuous"
    elif wait_for_file "$HOSTILE_MARKER" 20 && \
         [ "$(cat "$HOSTILE_MARKER" 2>/dev/null)" = "HOSTILE-SHADOW-WRITE-EXECUTED" ]; then
        echo "MUTANT RED under $ver"
        pass "[$ver] mutant (guard removed, cwd fallback restored) executes the hostile module -- the GREEN legs discriminate"
    else
        echo "MUTANT NOT RED under $ver"
        fail "[$ver] mutant did NOT execute the hostile module -- GREEN legs cannot tell the fix from its removal"
    fi
done

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
