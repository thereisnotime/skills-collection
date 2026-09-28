#!/usr/bin/env bash
#===============================================================================
# tests/test-autocapture-shadow-write-guard.sh
#
# S-156 (BACKLOG 127 remainder): auto_capture_episode's managed-memory
# shadow-write block in autonomy/run.sh had two defects:
#
#   A. `cd "$PROJECT_DIR" && ... python3 -m memory.managed_memory.shadow_write`
#      had no non-empty guard. On bash 3.2 (macOS /bin/bash) `cd ""` succeeds
#      silently, so an empty PROJECT_DIR executed whatever
#      memory/managed_memory/shadow_write.py sits in the cwd. (bash 5.3 rejects
#      `cd ""`, so this case only goes red under bash 3.2.)
#   B. `python3 -c "... float('$_ep_imp') ..."` spliced the episode file's
#      importance value into python source.
#
# The episode_path_file is written by auto_capture_episode's own python
# heredoc (path_out_file, env _LOKI_EPISODE_PATH_FILE) at
# /tmp/loki-episode-path-$$; this test feeds that file directly.
#
# The REAL block is extracted from run.sh (no copy), wrapped in a function,
# and run under "$BASH", so running this file with /bin/bash and with bash 5
# covers both interpreters:
#   bash tests/test-autocapture-shadow-write-guard.sh
#   /bin/bash tests/test-autocapture-shadow-write-guard.sh
#===============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"
BASH_BIN="${BASH:-bash}"

command -v timeout >/dev/null 2>&1 || {
    echo "FAIL: 'timeout' not on PATH; the block would no-op and look like the fix"
    exit 1
}

PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-s156-XXXXXX")"
cleanup() { cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "${WORK:-/nonexistent}"; }
trap cleanup EXIT INT TERM

echo "interpreter: $BASH_BIN ($BASH_VERSION)"

#-------------------------------------------------------------------------------
# Extract the real block: from the RARV-C shadow-write comment to the
# episode_path_file rm. Fail loudly if the anchors move.
#-------------------------------------------------------------------------------
BLOCK="$WORK/block.sh"
{
    echo '_s156_block() {'
    awk '/REFLECT\/VERIFY shadow-write/ {f=1}
         f {print}
         f && /rm -f "\$episode_path_file"/ {exit}' "$RUN_SH"
    echo '}'
} > "$BLOCK"
if ! grep -q 'memory.managed_memory.shadow_write' "$BLOCK" \
    || ! grep -q 'rm -f "\$episode_path_file"' "$BLOCK"; then
    echo "FAIL: could not extract the shadow-write block from $RUN_SH"
    exit 1
fi
"$BASH_BIN" -n "$BLOCK" || { echo "FAIL: extracted block does not parse"; exit 1; }

#-------------------------------------------------------------------------------
# Fixtures: a hostile package at cwd and a legit one at PROJECT_DIR.
#-------------------------------------------------------------------------------
HOSTILE="$WORK/hostile_cwd"
LEGIT="$WORK/legit_project"
HOSTILE_MARKER="$WORK/hostile.marker"
LEGIT_MARKER="$WORK/legit.marker"
PWNED="$WORK/PWNED"
for d in "$HOSTILE" "$LEGIT"; do
    mkdir -p "$d/memory/managed_memory"
    : > "$d/memory/__init__.py"
    : > "$d/memory/managed_memory/__init__.py"
done
printf 'open(r"%s", "w").write("x")\n' "$HOSTILE_MARKER" > "$HOSTILE/memory/managed_memory/shadow_write.py"
printf 'open(r"%s", "w").write("x")\n' "$LEGIT_MARKER" > "$LEGIT/memory/managed_memory/shadow_write.py"
EPISODE="$WORK/episode.json"
echo '{}' > "$EPISODE"

wait_for_file() {
    local f="$1" i=0
    while [ "$i" -lt 12 ]; do
        [ -e "$f" ] && return 0
        sleep 0.5
        i=$((i + 1))
    done
    [ -e "$f" ]
}

# run_block <cwd> <project_dir|__UNSET__> <importance-as-python-literal>
run_block() {
    local cwd="$1" pd="$2" imp="$3" epf="$WORK/epf.json"
    rm -f "$HOSTILE_MARKER" "$LEGIT_MARKER" "$PWNED"
    python3 -c 'import json,sys; json.dump({"path": sys.argv[1], "importance": eval(sys.argv[2])}, open(sys.argv[3], "w"))' \
        "$EPISODE" "$imp" "$epf"
    (
        cd "$cwd" || exit 1
        if [ "$pd" = "__UNSET__" ]; then unset PROJECT_DIR; else PROJECT_DIR="$pd"; fi
        export LOKI_MANAGED_AGENTS=true LOKI_MANAGED_MEMORY=true
        export S156_EPF="$epf" S156_TARGET="$WORK/target" S156_BLOCK="$BLOCK"
        [ "$pd" = "__UNSET__" ] || export PROJECT_DIR
        "$BASH_BIN" -c '
            # shellcheck disable=SC1090
            source "$S156_BLOCK"
            episode_path_file="$S156_EPF"; target_dir="$S156_TARGET"
            _s156_block
        '
    )
}

#===============================================================================
# Case A: PROJECT_DIR unset / empty, hostile package at cwd, importance 0.9.
#===============================================================================
for mode in __UNSET__ ""; do
    label="unset"; [ -z "$mode" ] && label="empty"
    run_block "$HOSTILE" "$mode" "0.9"
    if wait_for_file "$HOSTILE_MARKER"; then
        fail "A ($label PROJECT_DIR): hostile cwd shadow_write.py EXECUTED"
    else
        pass "A ($label PROJECT_DIR): hostile cwd shadow_write.py not executed"
    fi
done

#===============================================================================
# Control: PROJECT_DIR=legit, hostile still at cwd. Legit must run, hostile not.
# Distinguishes the fix from a mutant that disables the feature outright.
#===============================================================================
run_block "$HOSTILE" "$LEGIT" "0.7"
if wait_for_file "$LEGIT_MARKER"; then
    pass "control: legit shadow_write runs with PROJECT_DIR set and importance 0.7"
else
    fail "control: legit shadow_write never ran (feature disabled, not guarded)"
fi
[ -e "$HOSTILE_MARKER" ] && fail "control: hostile marker appeared" || pass "control: hostile marker absent"

run_block "$HOSTILE" "$LEGIT" "0.5"
if wait_for_file "$LEGIT_MARKER"; then
    fail "control: importance 0.5 crossed the 0.6 threshold"
else
    pass "control: importance 0.5 stays below the threshold"
fi

#===============================================================================
# Case B: importance injection. PROJECT_DIR set so only the argv guard matters.
# The card's literal payload is a python SyntaxError when spliced (green-only);
# the second payload actually executes when spliced and is the discriminator.
#===============================================================================
run_block "$WORK" "$LEGIT" "\"0.7'); open('PWNED','w'); ('\""
if wait_for_file "$PWNED" || [ -e "$LEGIT/PWNED" ]; then
    fail "B (card payload): injected importance created PWNED"
else
    pass "B (card payload): no PWNED file"
fi

run_block "$WORK" "$LEGIT" "\"0') or open(r'$PWNED','w') or float('1\""
if wait_for_file "$PWNED"; then
    fail "B (executing payload): importance was spliced into python source and ran"
else
    pass "B (executing payload): importance passed as data, not source"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
