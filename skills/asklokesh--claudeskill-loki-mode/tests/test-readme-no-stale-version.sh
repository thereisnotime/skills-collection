#!/usr/bin/env bash
# The README must not hand-maintain a version string.
#
# WHY THIS EXISTS. README.md carried "**Current release: v9.16.0**" while the
# repo shipped v9.24.0 -- eight releases of drift on the first screen a visitor
# reads, which is the worst place in the repo to be stale. Nothing caught it,
# because no gate looked.
#
# The fix was to DELETE the line, not to bump it. A hand-maintained version
# string in prose has no single source of truth and drifts by default: the same
# mechanism put server.json 30+ releases behind and plugin.json 3 behind, both
# of which needed their own tests. The README links to CHANGELOG.md, which is
# generated per release and cannot drift.
#
# So this asserts ABSENCE, and deliberately allows version strings that are not
# release claims: a pinned dependency, an example, a Docker tag.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- no hand-maintained release claim"

# Match the claim SHAPE, not one version, so a bumped-but-still-manual line
# fails too. "Current release: vX.Y.Z", "Latest release: ...", "Version: vX.Y.Z".
hits=$(grep -nEi '(current|latest) (release|version)[[:space:]]*:?[[:space:]]*\**[[:space:]]*v?[0-9]+\.[0-9]+\.[0-9]+' "$README" || true)
if [ -z "$hits" ]; then
    ok "README states no release version in prose"
else
    bad "README hand-maintains a release version and will drift:"
    echo "$hits" | sed 's/^/         /'
fi

echo
echo "T2 -- the canonical source is still linked"

# Deleting the line is only safe if a reader can still find the version.
if grep -q 'CHANGELOG.md' "$README"; then
    ok "README links CHANGELOG.md, which is generated per release"
else
    bad "no CHANGELOG link: removing the version line would leave no way to find it"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
