#!/usr/bin/env bash
# A second repository must actually reach the agent.
#
# THE DEFECT: nothing in autonomy/, providers/, loki-ts/src/ or bin/ ever passed
# --add-dir or additionalDirectories (0 files; positive control run_autonomous =
# 7 files). An agent asked to change a shared type in ../service-b could not
# read it, did NOT error, and guessed. The user got a change that does not
# compile with no signal why.
#
# WHAT IS LOAD-BEARING: a nonexistent directory must be SKIPPED WITH A WARNING,
# never passed through. A typo passed to the CLI aborts it and takes the whole
# run down. Skipping silently would reproduce the very silent-wrong-output
# defect being fixed.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-add-dir-reaches-provider"

WORK="$(mktemp -d)"
trap 'rmdir "$WORK/service-b" 2>/dev/null; rmdir "$WORK/service-c" 2>/dev/null; true' EXIT
mkdir -p "$WORK/service-b" "$WORK/service-c"

_flags() {
    LOKI_ADD_DIRS="${1:-}" bash -c '
        cd "'"$REPO_ROOT"'"
        loki_claude_flag_supported() { return 0; }
        . providers/claude.sh 2>/dev/null || true
        _loki_build_claude_auto_flags "development" "standard" ""
        printf "%s\n" "${_LOKI_CLAUDE_AUTO_FLAGS[@]+"${_LOKI_CLAUDE_AUTO_FLAGS[@]}"}"
    ' 2>/dev/null
}

OUT="$(_flags "$WORK/service-b")"
if printf '%s' "$OUT" | grep -q -- '--add-dir' && printf '%s' "$OUT" | grep -qF "$WORK/service-b"; then
    pass "a real directory reaches the provider argv as --add-dir <path>"
else
    fail "--add-dir did not reach the argv for an existing directory"
fi

N="$(_flags "$WORK/service-b:$WORK/service-c" | grep -c -- '--add-dir' | tr -d ' ')"
if [ "${N:-0}" -eq 2 ]; then
    pass "two colon-separated directories produce two --add-dir pairs"
else
    fail "expected 2 --add-dir pairs, got ${N:-0}"
fi

N2="$(_flags "/nope/does/not/exist" | grep -c -- '--add-dir' | tr -d ' ')"
if [ "${N2:-0}" -eq 0 ]; then
    pass "a nonexistent directory is not passed to the CLI"
else
    fail "a nonexistent directory was passed; the CLI would abort the run"
fi

if LOKI_ADD_DIRS="/nope/does/not/exist" bash -c '
        cd "'"$REPO_ROOT"'"
        loki_claude_flag_supported() { return 0; }
        . providers/claude.sh 2>/dev/null || true
        _loki_build_claude_auto_flags "development" "standard" ""
   ' 2>&1 >/dev/null | grep -q 'not a directory, skipping'; then
    pass "a skipped directory is announced on stderr"
else
    fail "a directory was dropped silently, which is the defect being fixed"
fi

N3="$(_flags "$WORK/service-b:/nope" | grep -c -- '--add-dir' | tr -d ' ')"
if [ "${N3:-0}" -eq 1 ]; then
    pass "a valid directory still reaches the agent when a sibling entry is bad"
else
    fail "expected 1 surviving --add-dir, got ${N3:-0}"
fi

N4="$(_flags "" | grep -c -- '--add-dir' | tr -d ' ')"
if [ "${N4:-0}" -eq 0 ]; then
    pass "no --add-dir when LOKI_ADD_DIRS is unset"
else
    fail "--add-dir appeared without the operator asking for it"
fi

# Gated on CLI support so an older CLI degrades instead of erroring.
# Comments stripped: the comment explaining this fix names the flag.
sed 's/#.*//' providers/claude.sh > "$WORK/stripped.sh"
if grep -q 'loki_claude_flag_supported "--add-dir"' "$WORK/stripped.sh"; then
    pass "the flag is gated on CLI support"
else
    fail "not gated on flag support; an older CLI would error"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
