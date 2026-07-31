#!/usr/bin/env bash
# Every variable in docs/environment-variables.md must exist in the source.
#
# WHY THIS EXISTS. There was no single place to look up the operator-facing
# LOKI_* variables: SETUP.md mentioned 17, README.md 34, `loki config schema`
# covered 64 keys that did NOT include the ones an operator most needs
# (LOKI_BUDGET_LIMIT, LOKI_MAX_TIER, LOKI_PROVIDER). So the reference had to be
# written -- and a hand-written variable reference is exactly the kind of
# document that rots into confident fiction after two refactors.
#
# THE DIRECTION OF THIS TEST IS DELIBERATE. It asserts doc -> source: every
# variable the document PROMISES must be real. It does not assert source -> doc,
# because most LOKI_* tokens are internal plumbing and demanding they all be
# documented would either bloat the page or train people to silence the test.
#
# A survey of this CLI counted ~286 LOKI_* tokens. That number is inflated --
# it includes prefix fragments and internal wiring -- and the document says so
# rather than quoting it as an operator surface. Publishing an inflated count
# would be its own small overclaim.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC="$REPO_ROOT/docs/environment-variables.md"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

[ -f "$DOC" ] || { echo "FAIL: docs/environment-variables.md missing"; exit 1; }

# Variables are documented in table rows as `| \`LOKI_X\` | ... |`. Pull the
# names out of the backticks rather than grepping the whole file, so a mention
# in prose is not mistaken for a documented knob.
mapfile -t documented < <(grep -oE '^\| `LOKI_[A-Z0-9_]+`' "$DOC" | tr -d '|` ' | sort -u)

if [ "${#documented[@]}" -lt 10 ]; then
    # A collapsed count means the table shape changed and this test is now
    # asserting nothing. Fail loudly rather than report full coverage over an
    # empty set -- a gate that passes vacuously is worse than no gate.
    bad "only ${#documented[@]} variables parsed out of the doc; the table format changed"
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
    exit 1
fi
ok "parsed ${#documented[@]} documented variables from the reference table"

missing=""
for var in "${documented[@]}"; do
    # Search the runtime, not the docs: a variable that only appears in
    # markdown is precisely the fiction this test exists to catch.
    if grep -rq "$var" "$REPO_ROOT/autonomy" "$REPO_ROOT/loki-ts/src" 2>/dev/null; then
        continue
    fi
    missing="${missing}${var} "
done

if [ -z "$missing" ]; then
    ok "every documented variable exists in autonomy/ or loki-ts/src"
else
    bad "documented but ABSENT from the source: ${missing}"
fi

# Spot-check the claims most likely to mislead if wrong. A default stated
# incorrectly sends an operator to debug behavior that was never configured
# the way the page said.
check_default() {
    local var="$1" want="$2"
    local found
    found="$(grep -rhoE "\\\$\{${var}:-[^}]*\}" "$REPO_ROOT/autonomy/run.sh" "$REPO_ROOT/autonomy/loki" 2>/dev/null | head -1)"
    case "$found" in
        *"${want}"*) ok "${var} default is ${want} as documented" ;;
        "")          printf 'NOTE: %s has no inline default to verify\n' "$var" ;;
        *)           bad "${var} default is '${found}', documented as '${want}'" ;;
    esac
}

check_default LOKI_MAX_ITERATIONS 1000
check_default LOKI_PROVIDER claude
check_default LOKI_DURABLE_STATE 0

# The safety claim in the doc must hold: errors survive the quietest setting.
# Documenting a floor that does not exist would be worse than documenting no
# floor, because an operator would trust a quiet run to still report failures.
case "$(cat "$DOC")" in
    *"Errors are never suppressed"*) ok "the doc states the error floor" ;;
    *) bad "the doc does not state that errors survive every log level" ;;
esac

if grep -q 'log_error() { echo' "$REPO_ROOT/autonomy/run.sh"; then
    ok "log_error is genuinely ungated in run.sh (the floor is real)"
else
    bad "log_error appears gated -- the documented error floor may not hold"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
