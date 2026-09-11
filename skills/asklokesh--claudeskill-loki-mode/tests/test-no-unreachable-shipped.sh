#!/usr/bin/env bash
# A module that SHIPS must have a recorded verdict on whether anything reaches it.
#
# THE RECURRING DEFECT: a subsystem gets built, tested, listed in package.json
# files[], and never wired to anything that runs. Its own tests import it, so CI
# is green. It ships to every npm user. It does nothing. The CHANGELOG then
# describes it as a feature. That is how "Jira/Linear bidirectional sync" came
# to be advertised while the only dispatcher was never spawned and its Jira
# branch threw on construction.
#
# The distinction that matters is NOT "does anything reference this file" --
# tests and CI smoke-imports reference everything. It is "does any RUNTIME path
# reach it". A module required only by
# .github/workflows/integrity-audit.yml's `node -e "require(...)"` is proven to
# LOAD, not to RUN.
#
# The scanner allowlists with REASONS, not silence: each entry records that
# someone looked and decided shipping it is correct. Adding an entry is a
# deliberate act and shows up in review as one.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-no-unreachable-shipped"

SCANNER="tests/lib/scan-unreachable-shipped.py"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: reachability was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

if [ ! -f "$SCANNER" ]; then
    fail "$SCANNER is missing; shipped-module reachability is unmeasured"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# 1. No unlisted unreachable module ships.
#    Exit contract: 0 clean, 1 offenders found, 2 UNMEASURED (never clean).
OUT="$(python3 "$SCANNER" 2>&1)"; RC=$?
case "$RC" in
    0) pass "every shipped integration module has a recorded reachability verdict" ;;
    1) fail "shipped but unreachable, and not recorded: $(printf '%s' "$OUT" | head -3 | tr '\n' ' ')" ;;
    *) fail "reachability scan could not run (rc=$RC): $OUT -- unmeasured, not clean" ;;
esac

# 2. GUARD AGAINST VACUITY. A scanner that examines nothing reports nothing
#    missing. Assert it actually walked a non-trivial corpus and module set:
#    an empty result is an absent measurement, not a pass.
COUNTS="$(python3 - <<'PY' 2>&1
import importlib.util, os
spec = importlib.util.spec_from_file_location("m", "tests/lib/scan-unreachable-shipped.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
mods = m.js_modules_under("src/integrations")
corpus = 0
for dp, dn, fn in os.walk("."):
    dn[:] = [d for d in dn if d not in m.SKIP_DIRS]
    corpus += sum(1 for n in fn if n.endswith((".js", ".ts", ".sh", ".py", ".json")))
print("%d %d %d" % (len(mods), corpus, len(m.ALLOWLIST)))
PY
)"
set -- $COUNTS
NMODS="${1:-0}"; NCORPUS="${2:-0}"; NALLOW="${3:-0}"
if [ "$NMODS" -ge 10 ] && [ "$NCORPUS" -ge 200 ]; then
    pass "the scan is non-vacuous ($NMODS modules against $NCORPUS files)"
else
    fail "the scan examined too little to mean anything (modules=$NMODS corpus=$NCORPUS)"
fi

# 3. Every allowlist entry must carry a REASON. An entry with an empty reason is
#    a mute button, which is the failure mode this design exists to avoid.
BAD="$(python3 - <<'PY' 2>&1
import importlib.util
spec = importlib.util.spec_from_file_location("m", "tests/lib/scan-unreachable-shipped.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
for k, v in m.ALLOWLIST.items():
    if not isinstance(v, str) or len(v.strip()) < 40:
        print(k)
PY
)"
if [ -z "$BAD" ]; then
    pass "every allowlisted module carries a substantive reason ($NALLOW entries)"
else
    fail "allowlist entries without a real reason: $(printf '%s' "$BAD" | tr '\n' ' ')"
fi

# 4. The historical bidirectional-sync claim must carry its correction. It is a
#    shipped CHANGELOG entry, so it is annotated in place rather than rewritten.
if grep -q 'CORRECTION, v9.33.0' CHANGELOG.md; then
    pass "the bidirectional-sync claim carries its correction"
else
    fail "CHANGELOG advertises bidirectional sync with no correction; no runtime path reaches it"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
