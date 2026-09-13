#!/usr/bin/env bash
# Hallucinated-dependency detector (slopsquatting guard)
#
# Usage: ./tests/detect-hallucinated-deps.sh [DIR] [--strict]
#   --strict: exit non-zero on any unresolvable package (for a CI/quality gate)
#
# THE RISK. A model asked to add a dependency can emit a package name that does
# not exist. An attacker who registers that name owns code execution in every
# install that follows. This is documented as "slopsquatting"; see
# arxiv.org/pdf/2606.13918 (2026-06-15) on detecting hallucinated package
# imports in AI-assisted code.
#
# WHAT THIS DOES. Parses dependency manifests, resolves each declared package
# against its registry, and reports names that do not resolve.
#
# FAIL OPEN, DELIBERATELY. No network, no curl, or a registry 5xx means the
# package was NOT CHECKED -- which is reported as `unchecked`, never as a pass
# and never as a failure. Blocking a build because a registry was briefly
# unreachable would be a worse failure mode than the one being prevented, and
# silently passing would make the gate theatre. Three states, as everywhere
# else in this repo: resolved / MISSING / unchecked.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
case "${1:-}" in --strict) TARGET="$(cd "$SCRIPT_DIR/.." && pwd)" ;; esac
STRICT=0
for a in "$@"; do [ "$a" = "--strict" ] && STRICT=1; done

TIMEOUT="${LOKI_DEP_CHECK_TIMEOUT:-3}"
MISSING=0; RESOLVED=0; UNCHECKED=0
MISSING_LIST=""

if ! command -v curl >/dev/null 2>&1; then
    echo "detect-hallucinated-deps: curl unavailable; every package is UNCHECKED (not a pass)"
    exit 0
fi

# npm: one HEAD per package against the registry.
_check_npm() {
    local pkg="$1" code
    case "$pkg" in ""|.*|*" "*) return 0 ;; esac
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
            "https://registry.npmjs.org/$(printf '%s' "$pkg" | sed 's|/|%2f|g')" 2>/dev/null)" || code=""
    # NOTE: -f is deliberately ABSENT. With -f curl exits nonzero on 404, the
    # `|| code=""` fires, and a genuinely missing package is misreported as
    # "unchecked" -- turning the detector into theatre. Verified: with -f the
    # capture is "404CURL FAILED"; without it, "404".
    case "$code" in
        200) RESOLVED=$((RESOLVED+1)) ;;
        404) MISSING=$((MISSING+1)); MISSING_LIST="${MISSING_LIST}
  npm: $pkg" ;;
        *)   UNCHECKED=$((UNCHECKED+1)) ;;   # network/5xx: NOT a verdict
    esac
}

_check_pypi() {
    local pkg="$1" code
    case "$pkg" in ""|-*|*" "*) return 0 ;; esac
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
            "https://pypi.org/pypi/${pkg}/json" 2>/dev/null)" || code=""
    case "$code" in
        200) RESOLVED=$((RESOLVED+1)) ;;
        404) MISSING=$((MISSING+1)); MISSING_LIST="${MISSING_LIST}
  pypi: $pkg" ;;
        *)   UNCHECKED=$((UNCHECKED+1)) ;;
    esac
}

# package.json: dependencies + devDependencies, skipping local/git/workspace specs.
while IFS= read -r manifest; do
    [ -f "$manifest" ] || continue
    while IFS= read -r pkg; do
        [ -n "$pkg" ] && _check_npm "$pkg"
    done < <(python3 - "$manifest" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for key in ("dependencies", "devDependencies"):
    for name, spec in (d.get(key) or {}).items():
        s = str(spec)
        # a local path, git url, or workspace protocol is not a registry name
        if s.startswith(("file:", "link:", "git", "workspace:", "portal:", "http")):
            continue
        print(name)
PY
    )
done < <(find "$TARGET" -name package.json -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -40)

# requirements.txt
while IFS= read -r manifest; do
    [ -f "$manifest" ] || continue
    while IFS= read -r pkg; do
        [ -n "$pkg" ] && _check_pypi "$pkg"
    done < <(python3 - "$manifest" <<'PY' 2>/dev/null
import re, sys
try:
    lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
except Exception:
    sys.exit(0)
for l in lines:
    l = l.split("#", 1)[0].strip()
    if not l or l.startswith("-"):       # -r, -e, --index-url
        continue
    if l.startswith(("git+", "http")) or "://" in l:
        continue
    m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", l)
    if m:
        print(m.group(1))
PY
    )
done < <(find "$TARGET" -name requirements.txt -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -40)

TOTAL=$((RESOLVED + MISSING + UNCHECKED))
echo "detect-hallucinated-deps: $TOTAL declared packages"
echo "  resolved : $RESOLVED"
echo "  MISSING  : $MISSING"
echo "  unchecked: $UNCHECKED (network unavailable; NOT a pass and NOT a failure)"

if [ "$MISSING" -gt 0 ]; then
    echo ""
    echo "Packages that do not exist on their registry:${MISSING_LIST}"
    echo ""
    echo "A name that does not resolve is how a hallucinated dependency becomes a"
    echo "supply-chain compromise: an attacker registers it and owns every install."
    [ "$STRICT" -eq 1 ] && exit 1
fi
exit 0
