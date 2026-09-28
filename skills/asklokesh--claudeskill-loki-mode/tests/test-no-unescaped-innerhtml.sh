#!/usr/bin/env bash
# S-171 (BACKLOG 124): a run-written value spliced into dashboard markup
# without the file's escape helper is an XSS sink. Cycle 4 fixed two panels in
# build-standalone.js (f6050ef1); this guard stops the class coming back.
#
# The scanner (tests/lib/scan-unescaped-innerhtml.py) walks
# dashboard-ui/components/*.js and dashboard-ui/scripts/build-standalone.js,
# finds every HTML-building template literal and `+` chain, and flags any
# value that reaches the output unescaped. Existing sites are in its in-file
# ALLOWLIST with a reason; the ones marked REPORTED are real unescaped API
# fields left for fix-forward.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-no-unescaped-innerhtml"

SCANNER="tests/lib/scan-unescaped-innerhtml.py"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: innerHTML escaping was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi
if [ ! -f "$SCANNER" ]; then
    fail "$SCANNER is missing; innerHTML escaping is unmeasured"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-s171.XXXXXXXX")" || exit 1
trap 'rm -rf -- "$WORK"' EXIT

# 1. The real tree is clean. Exit contract: 0 clean, 1 offenders, 2 unmeasured.
OUT="$(python3 "$SCANNER" --stats 2>&1)"; RC=$?
case "$RC" in
    0) pass "every unescaped value in dashboard HTML strings has a recorded verdict" ;;
    1) fail "unescaped value in an HTML string, not recorded: $(printf '%s' "$OUT" | head -3 | tr '\n' ' ')" ;;
    *) fail "innerHTML scan could not run (rc=$RC): $OUT -- unmeasured, not clean" ;;
esac

# 2. Non-vacuity: a scanner that reads nothing, or a matcher that finds no
#    HTML strings, reports clean. Require a real corpus.
STATS="$(printf '%s\n' "$OUT" | grep '^STATS ' | tail -1)"
NFILES="$(printf '%s' "$STATS" | sed -n 's/.*files=\([0-9]*\).*/\1/p')"
NSITES="$(printf '%s' "$STATS" | sed -n 's/.*sites=\([0-9]*\).*/\1/p')"
NFIND="$(printf '%s' "$STATS" | sed -n 's/.*findings=\([0-9]*\).*/\1/p')"
if [ "${NFILES:-0}" -ge 20 ] && [ "${NSITES:-0}" -ge 100 ] && [ "${NFIND:-0}" -ge 1 ]; then
    pass "the scan is non-vacuous (files=$NFILES html_sites=$NSITES findings=$NFIND)"
else
    fail "the scan examined too little to mean anything (files=${NFILES:-?} sites=${NSITES:-?} findings=${NFIND:-?})"
fi

# 3. A planted offender is caught, with exactly rc 1 (a crash is rc 2 and must
#    not pass as "caught"). Covers both shapes: template literal and concat.
cat >"$WORK/planted-tpl.js" <<'JS'
class Planted extends HTMLElement {
  render(data) { this.el.innerHTML = `<b>${data.name}</b>`; }
}
JS
cat >"$WORK/planted-concat.js" <<'JS'
function show(list, x) { list.innerHTML = '<span>' + x.rootCause + '</span>'; }
JS
cat >"$WORK/planted-safe.js" <<'JS'
class Safe extends HTMLElement {
  _escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  render(data) { this.el.innerHTML = `<b>${this._escapeHtml(data.name)}</b> ${data.items.length}`; }
}
JS
for shape in tpl concat; do
    POUT="$(python3 "$SCANNER" "$WORK/planted-$shape.js" 2>&1)"; PRC=$?
    if [ "$PRC" -eq 1 ] && printf '%s' "$POUT" | grep -q 'unescaped value'; then
        pass "planted $shape offender is flagged (rc=1)"
    else
        fail "planted $shape offender not flagged (rc=$PRC): $POUT"
    fi
done
SOUT="$(python3 "$SCANNER" "$WORK/planted-safe.js" 2>&1)"; SRC=$?
if [ "$SRC" -eq 0 ]; then
    pass "escaped field and numeric .length are not flagged (rc=0)"
else
    fail "escaped planted component was flagged (rc=$SRC): $SOUT"
fi

# 4. An allowlist entry with an empty reason is a mute button: the scanner
#    must refuse to report clean (rc 2). Plant one into a scratch copy.
mkdir -p "$WORK/lib"
python3 - "$SCANNER" "$WORK/lib/scan.py" <<'PY'
import sys
src = open(sys.argv[1]).read()
anchor = "ALLOWLIST = {\n"
assert src.count(anchor) == 1, "ALLOWLIST anchor not found exactly once"
open(sys.argv[2], "w").write(src.replace(anchor, anchor + '    "x.js::y": "",\n'))
PY
EOUT="$(python3 "$WORK/lib/scan.py" 2>&1)"; ERC=$?
if [ "$ERC" -eq 2 ] && printf '%s' "$EOUT" | grep -q 'x.js::y'; then
    pass "an allowlist entry with an empty reason fails the scan (rc=2)"
else
    fail "empty-reason allowlist entry was accepted (rc=$ERC): $EOUT"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
