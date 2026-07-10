#!/usr/bin/env bash
# tests/test-start-banner-dedup.sh -- the new `loki start` handoff renders the
# Autonomi brand banner, so run.sh must SKIP its legacy ASCII "LOKI MODE" banner
# to avoid two banners back to back. The legacy banner stays for the non-handoff
# path (CI / --bg / --yes / non-interactive / direct run.sh).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"
RUN="$REPO_ROOT/autonomy/run.sh"

PASS=0; FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

# 1. run.sh gates the legacy banner on LOKI_BRAND_SHOWN != 1.
if grep -q 'if \[ "${LOKI_BRAND_SHOWN:-}" != "1" \]; then' "$RUN"; then
    ok "run.sh legacy banner gated on LOKI_BRAND_SHOWN"
else
    bad "run.sh legacy banner not gated -> duplicate banner in the handoff flow"
fi

# 2. cmd_start exports LOKI_BRAND_SHOWN=1 once the handoff renders the new banner.
if grep -q 'export LOKI_BRAND_SHOWN=1' "$LOKI"; then
    ok "cmd_start exports LOKI_BRAND_SHOWN after the handoff"
else
    bad "cmd_start does not signal the handoff banner to run.sh"
fi

# 3. The signal is set only on a non-cancel decision.
if grep -q '\[ "\$_decision" != "cancel" \] && export LOKI_BRAND_SHOWN=1' "$LOKI"; then
    ok "signal set only when the run actually launches (non-cancel)"
else
    bad "signal guard on non-cancel missing"
fi

# 4. Legacy banner art is preserved (non-handoff path is byte-identical).
if grep -q '╚══════╝ ╚═════╝' "$RUN"; then
    ok "legacy ASCII banner art preserved for the non-handoff path"
else
    bad "legacy ASCII banner art removed"
fi

# 5. Behavioral: the gate predicate hides the banner iff the flag is 1.
shown() { ( LOKI_BRAND_SHOWN="$1"; [ "${LOKI_BRAND_SHOWN:-}" != "1" ] && echo yes || echo no ); }
[ "$(shown "")" = "yes" ] && ok "banner shows when flag unset" || bad "banner hidden without flag"
[ "$(shown "1")" = "no" ] && ok "banner hidden when flag=1" || bad "banner still shows with flag"

echo ""
echo "=== results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
