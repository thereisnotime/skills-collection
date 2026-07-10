#!/usr/bin/env bash
# tests/test-dashboard-identity.sh - asserts the built dashboard carries the
# Autonomi identity and has NO pre-redesign regressions (rec #6, S4).
#
# The built artifact is a single very-long-line minified HTML, so `grep` silently
# false-cleans on it (documented repo gotcha). We use python3 str.count() for
# every assertion, mirroring the verification the S4 reviewer required.
#
# Fails if a future build drops the identity or reintroduces the old brand.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ART="$REPO_ROOT/dashboard/static/index.html"

PASS=0; FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

if [ ! -f "$ART" ]; then
    echo "SKIP: built dashboard $ART not found (run dashboard-ui build first). (Not a fail.)"; exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed. (Not a fail.)"; exit 0
fi

# count <needle> -> integer occurrences in the built artifact (grep-safe).
count() { _NEEDLE="$1" python3 -c "import os;print(open('$ART').read().count(os.environ['_NEEDLE']))" 2>/dev/null || echo -1; }

# --- identity present ---
acc=$(( $(count "553de9") + $(count "553DE9") ))
[ "$acc" -ge 1 ] && ok "accent #553de9 present ($acc)" || bad "accent missing" "count=$acc"
[ "$(count "1FC5A8")" -ge 1 ] && ok "teal dot #1FC5A8 present" || bad "teal dot missing"
[ "$(count "Fraunces")" -ge 1 ] && ok "Fraunces display font present" || bad "Fraunces missing"

# logo mark structural markers (squircle radius + a stroke path + teal coords)
[ "$(count "rx=\"118\"")" -ge 1 ] || [ "$(count "rx='118'")" -ge 1 ] && ok "logo squircle (rx=118) present" || bad "logo squircle missing"

# --- NO regressions (the two live-panel bugs the reviewer caught) ---
[ "$(count "DM Serif Display")" -eq 0 ] && ok "no legacy 'DM Serif Display' in built artifact" || bad "DM Serif Display regressed" "count=$(count "DM Serif Display")"
[ "$(count "7B6BF0")" -eq 0 ] && ok "no legacy accent #7B6BF0 in built artifact" || bad "#7B6BF0 regressed" "count=$(count "7B6BF0")"

# --- theme toggle + multi-repo switcher wired ---
[ "$(count "loki-theme")" -ge 1 ] && ok "theme toggle wiring present (localStorage loki-theme)" || bad "theme toggle missing"
{ [ "$(count "project-switcher")" -ge 1 ] || [ "$(count "running-projects")" -ge 1 ]; } && ok "multi-repo run switcher present" || bad "run switcher missing"

# --- size sanity ---
sz=$(wc -c < "$ART" | tr -d ' ')
[ "$sz" -gt 100000 ] && ok "artifact >100KB (built, not a stub): ${sz}B" || bad "artifact too small" "${sz}B"

echo ""
echo "=== results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
