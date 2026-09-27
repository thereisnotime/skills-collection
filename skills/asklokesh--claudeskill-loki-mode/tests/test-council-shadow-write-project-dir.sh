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
# council_should_stop -- no copy, no derived pre-fix fixture, so the test
# cannot be fooled by a harmless rewording of the fix:
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
#      appear; hostile.marker must not. This proves the fix HONORS
#      PROJECT_DIR (executes the real target) rather than merely disabling
#      the feature outright -- a control keyed on "hostile marker absent"
#      alone would also pass for a function that always no-ops.
#
# RED (pre-fix behavior) and the mutation-discrimination result are recorded
# by running this exact test against origin/main (pre-fix) and against a
# guard-broken mutant, respectively, outside this file (see the commit
# message / task report). Embedding that as a self-mutating step in the
# committed test was tried and rejected: deriving a pre-fix copy from the
# file under test ties RED to GREEN, so a harmless rewording of the fix (not
# a regression) can make the derivation vacuous and abort the run before any
# behavioral assertion executes.
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
# Fixtures: two distinct memory.managed_memory.shadow_write modules.
#-------------------------------------------------------------------------------
HOSTILE_REPO="$WORK/hostile_repo"
LEGIT_PROJECT="$WORK/legit_project"
mkdir -p "$HOSTILE_REPO/memory/managed_memory"
mkdir -p "$LEGIT_PROJECT/memory/managed_memory"

touch "$HOSTILE_REPO/memory/__init__.py" "$LEGIT_PROJECT/memory/__init__.py"
: > "$HOSTILE_REPO/memory/managed_memory/__init__.py"
: > "$LEGIT_PROJECT/memory/managed_memory/__init__.py"

HOSTILE_MARKER="$WORK/hostile.marker"
LEGIT_MARKER="$WORK/legit.marker"

cat > "$HOSTILE_REPO/memory/managed_memory/shadow_write.py" <<PYEOF
# Hostile stand-in: proves EXECUTION, not just import (threat model here is
# more severe than S-22's retrieve.py sibling).
with open(r"$HOSTILE_MARKER", "w") as f:
    f.write("HOSTILE-SHADOW-WRITE-EXECUTED")
PYEOF

cat > "$LEGIT_PROJECT/memory/managed_memory/shadow_write.py" <<PYEOF
# Legitimate stand-in: distinct marker, distinct package, proves the fix
# honors PROJECT_DIR rather than just disabling the feature.
with open(r"$LEGIT_MARKER", "w") as f:
    f.write("LEGIT-SHADOW-WRITE-EXECUTED")
PYEOF

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
# run_council: source completion-council.sh, stub the heavy deps the same
# way tests/test-council-force-stop-wave7.sh does, force the STOP+
# council_evaluate-approves path, and call the real council_should_stop.
# Args: $1 = cwd to run from, $2 = env script (sets/unsets PROJECT_DIR),
#       $3 = target dir.
#-------------------------------------------------------------------------------
run_council() {
    local run_cwd="$1" env_script="$2" target_dir="$3"
    bash -c '
        set +e
        COUNCIL_SH="$1"; RUN_CWD="$2"; ENV_SCRIPT="$3"; TARGET_DIR="$4"
        cd "$RUN_CWD" || exit 1

        # shellcheck disable=SC1090
        source "$COUNCIL_SH" >/dev/null 2>&1

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
    ' _ "$COUNCIL_SH" "$run_cwd" "$env_script" "$target_dir"
}

#===============================================================================
# 1. GREEN: PROJECT_DIR unset, cwd = hostile repo.
#    Expect: no marker over the full poll window, and council_should_stop
#    still cleanly returns 0/STOP with COMPLETED written.
#===============================================================================
TARGET_GREEN="$WORK/target_green"
mkdir -p "$TARGET_GREEN"
ENV_UNSET="$WORK/env-unset.sh"
cat > "$ENV_UNSET" <<'EOF'
unset PROJECT_DIR
EOF

out_green="$(run_council "$HOSTILE_REPO" "$ENV_UNSET" "$TARGET_GREEN")"
rc_green="${out_green%%:*}"
completed_green="${out_green##*:}"

if wait_for_file "$HOSTILE_MARKER" 20; then
    fail "council_should_stop (PROJECT_DIR unset, hostile cwd) EXECUTED the hostile shadow_write.py: $(cat "$HOSTILE_MARKER" 2>/dev/null)"
else
    pass "council_should_stop (PROJECT_DIR unset, hostile cwd) does NOT execute the hostile module (checked over full poll window)"
fi

if [ "$rc_green" = "0" ] && [ "$completed_green" = "1" ]; then
    pass "council_should_stop still returns 0 (STOP) and writes COMPLETED -- the skip is clean, not an error (rc=$rc_green completed=$completed_green)"
else
    fail "STOP semantics broken by the fix (rc=$rc_green completed=$completed_green, expected 0:1)"
fi
rm -f "$HOSTILE_MARKER"

#===============================================================================
# 2. Mutation-discriminating control: PROJECT_DIR set to a SEPARATE legit
#    project, hostile package STILL PRESENT at cwd. Only legit.marker may
#    appear. A "just disable the feature" mutant produces no markers at
#    all, which this control distinguishes from the correct fix by also
#    requiring the LEGIT marker to be present.
#===============================================================================
TARGET_CTRL="$WORK/target_ctrl"
mkdir -p "$TARGET_CTRL"
ENV_CTRL="$WORK/env-ctrl.sh"
cat > "$ENV_CTRL" <<EOF
export PROJECT_DIR="$LEGIT_PROJECT"
EOF

run_council "$HOSTILE_REPO" "$ENV_CTRL" "$TARGET_CTRL" >/dev/null

if wait_for_file "$LEGIT_MARKER" 20; then
    pass "with PROJECT_DIR set to the legit project (hostile package still present at cwd), the legit shadow_write.py executes -- proves the fix HONORS PROJECT_DIR, not just disables the feature"
else
    fail "legit.marker never appeared -- fix may just be disabling the feature outright, not honoring PROJECT_DIR (mutation-discrimination failure)"
fi

if [ -e "$HOSTILE_MARKER" ]; then
    fail "hostile.marker appeared -- PROJECT_DIR did not override cwd"
else
    pass "hostile.marker did NOT appear even though the hostile package is still present at cwd"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
