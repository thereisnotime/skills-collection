#!/usr/bin/env bash
# Skills must arrive with the references they cite.
#
# THE DEFECT: copy_skill_files copied skills/*.md into .loki/skills/ and NEVER
# copied references/. The copied skills cite references/*.md 21 times across 8
# files, every one of which exists in the repo, so the agent followed 21 dead
# paths and silently lost the guidance this function believes it ships. Copying
# skills without their references is shipping half a manual.
#
# SECOND DEFECT, found while fixing the first: the SKILL.md path rewrite named 8
# skill filenames explicitly plus a `Read skills/` catchall. Any NEW skill kept
# an unrewritten path, bare paths written as "See skills/..." survived, and
# references/ paths were never rewritten at all.
#
# WHAT IS LOAD-BEARING: the replacement must be PORTABLE. A tidy
# `sed -E 's|(^|[^.])skills/|...'` is rejected by BSD sed ("parentheses not
# balanced"), which fails SILENTLY on macOS and leaves every path unrewritten.
# It must also be IDEMPOTENT. Both are asserted by EXECUTING the function.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-skills-references-copied"

WORK="$(mktemp -d)"
cleanup() { [ -n "${WORK:-}" ] && [ -d "$WORK" ] && /bin/rm -rf -- "$WORK"; }
trap cleanup EXIT

awk '/^copy_skill_files\(\) \{/,/^\}/' autonomy/run.sh > "$WORK/fn.sh"
if [ ! -s "$WORK/fn.sh" ]; then
    fail "copy_skill_files not found in run.sh: NOTHING was measured"
    echo "  $PASS passed, $FAIL failed"; exit 1
fi

{
  echo 'set -uo pipefail'
  echo "PROJECT_DIR=\"$REPO_ROOT\""
  echo 'log_warn(){ :; }; log_info(){ :; }'
  echo '. "$(dirname "$0")/fn.sh"'
  echo 'copy_skill_files'
} > "$WORK/drive.sh"

( cd "$WORK" && bash drive.sh ) >/dev/null 2>&1

# 1. references/ must actually arrive.
NREF="$(ls "$WORK/.loki/references" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${NREF:-0}" -ge 10 ]; then
    pass "$NREF reference files copied to .loki/references/"
else
    fail "only ${NREF:-0} references copied; the agent's citations stay dead"
fi

# 2. THE REAL TEST: every references/ path cited by a COPIED skill must resolve
#    inside .loki. This is the user-visible defect, not the file count.
DEAD=0
for f in $(grep -oh 'references/[a-z0-9-]*\.md' "$WORK"/.loki/skills/*.md 2>/dev/null | sort -u); do
    [ -f "$WORK/.loki/$f" ] || DEAD=$((DEAD + 1))
done
if [ "$DEAD" -eq 0 ]; then
    pass "every references/ path cited by a copied skill resolves"
else
    fail "$DEAD cited reference paths are dead inside .loki/"
fi

# 3. SKILL.md must have no BARE skills/ or references/ path left.
if [ -f "$WORK/.loki/SKILL.md" ]; then
    BARE="$(grep -cE '[^/.](skills|references)/[a-z0-9-]*\.md' "$WORK/.loki/SKILL.md" 2>/dev/null | tr -d ' ')"
    if [ "${BARE:-0}" -eq 0 ]; then
        pass "no unrewritten bare skills/ or references/ path in .loki/SKILL.md"
    else
        fail "${BARE} bare paths survived the rewrite (BSD sed failing silently?)"
    fi
else
    fail "no .loki/SKILL.md produced: the rewrite did not run"
fi

# 4. IDEMPOTENT: never .loki/.loki/
if [ -f "$WORK/.loki/SKILL.md" ] && grep -q '\.loki/\.loki/' "$WORK/.loki/SKILL.md"; then
    fail "double-rewrite produced .loki/.loki/ paths"
else
    pass "no double-rewritten .loki/.loki/ paths"
fi

# 5. The rewrite must actually have DONE something.
if [ -f "$WORK/.loki/SKILL.md" ]; then
    N="$(grep -cE '\.loki/(skills|references)/' "$WORK/.loki/SKILL.md" 2>/dev/null | tr -d ' ')"
    if [ "${N:-0}" -ge 5 ]; then
        pass "$N rewritten .loki/ paths in SKILL.md"
    else
        fail "only ${N:-0} rewritten paths; the rewrite is a no-op"
    fi
fi

# 6. GUARD AGAINST VACUITY. If the skills stopped citing references at all,
#    every assertion above would pass while protecting nothing.
CITES="$(grep -oh 'references/[a-z0-9-]*\.md' skills/*.md 2>/dev/null | wc -l | tr -d ' ')"
if [ "${CITES:-0}" -ge 5 ]; then
    pass "skills cite references $CITES times (so copying them matters)"
else
    fail "skills cite references only ${CITES:-0} times; these assertions guard little"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
