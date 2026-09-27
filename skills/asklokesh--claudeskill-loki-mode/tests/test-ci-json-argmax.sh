#!/usr/bin/env bash
# Test: `loki ci --format json` on a diff whose findings exceed ARG_MAX
# (BACKLOG item 25, review-reproduced 2026-09-26).
#
# cmd_ci's JSON renderer built its findings/test-suggestion payloads with
# `export LOKI_CI_JSON_FINDINGS=...` (and companions) before a `python3
# <<HEREDOC` invocation that reads them back via os.environ. An exported
# environment string shares the SAME execve() size ceiling as argv (plus, on
# Linux, its own MAX_ARG_STRLEN cap of 128 KiB per single string) -- so it is
# not a safe alternative to passing a large value as an argv element. A diff
# with enough findings -- not necessarily a byte-huge diff, since each
# finding renders as fixed-length text -- pushed LOKI_CI_JSON_FINDINGS past
# that ceiling and crashed with "argument list too long" (bash exit 126,
# empty stdout) instead of emitting the report. Reproduced directly against
# the pre-fix commit: a synthetic repo with 20,000 bare-except lines, then
# `LOKI_LEGACY_BASH=1 bash autonomy/loki ci --format json` failed rc=126.
#
# The fix moves the large payloads (LOKI_CI_JSON_FINDINGS, LOKI_CI_JSON_TESTS)
# to temp files read as sys.argv[1]/[2]; only the small, fixed-width META and
# COUNTS strings stay as env vars. This test drives the real end-to-end
# command (not a unit-level extraction) against a fixture sized to clear
# ARG_MAX, and asserts exit 0 with valid, complete JSON.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKI="$SCRIPT_DIR/../autonomy/loki"

PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1 -- $2"; FAIL=$((FAIL + 1)); }

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/loki-ci-json-argmax.XXXXXX")
cleanup() { [ -n "${LOKI_TEST_KEEP_WORKDIR:-}" ] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT

ARG_MAX="$(getconf ARG_MAX 2>/dev/null || echo 0)"
case "$ARG_MAX" in '' | *[!0-9]*) ARG_MAX=0 ;; esac

REPO_DIR="$WORK_DIR/repo"
mkdir -p "$REPO_DIR"
(
    cd "$REPO_DIR" || exit 1
    git init -q
    git config user.email "test@example.invalid"
    git config user.name "loki test fixture"
    git config commit.gpgsign false
    echo "init" >app.py
    git add app.py
    git commit -q -m "init"
) >/dev/null 2>&1

# The crash site is the EXPORTED RAW findings string (LOKI_CI_JSON_FINDINGS,
# pipe-delimited, ~72 bytes/finding measured against this exact fixture
# shape), not the indented JSON that cmd_ci finally prints -- the JSON output
# is larger per finding (quotes, keys, indentation) than the raw exported
# value that actually has to clear execve()'s limit. Sizing off the JSON
# output undercounts the true crash threshold, so this uses the raw-string
# rate.
#
# FINDING_COUNT is derived from the MEASURED ARG_MAX on whatever machine
# runs this test, not a fixed constant: a fixture sized for macOS's ~1 MiB
# ARG_MAX (16,000 findings, ~1.15 MB raw) silently under-shoots Linux CI's
# ~4 MiB ARG_MAX (measured: getconf ARG_MAX 4194304 on the GitHub Actions
# ubuntu runner), so the raw export never actually exceeds the ceiling
# there and the crash this test exists to catch goes unexercised -- exactly
# how a fixture this size passed locally and then still failed to prove
# anything on CI. 2x margin over the measured ARG_MAX, ~72 bytes/finding.
_argmax_for_sizing="$ARG_MAX"
case "$_argmax_for_sizing" in '' | 0 | *[!0-9]*) _argmax_for_sizing=1048576 ;; esac
FINDING_COUNT=$(( (_argmax_for_sizing * 2) / 72 ))
[ "$FINDING_COUNT" -lt 16000 ] && FINDING_COUNT=16000
(
    cd "$REPO_DIR" || exit 1
    python3 -c "
lines = ['init']
for i in range($FINDING_COUNT):
    lines.append('try:')
    lines.append('    pass')
    lines.append('except:')
open('app.py', 'w').write('\n'.join(lines) + '\n')
"
    git add app.py
    git commit -q -m "big change"
) >"$WORK_DIR/fixture-build.log" 2>&1
if ! [ -s "$REPO_DIR/app.py" ]; then
    log_fail "fixture setup" "app.py was not built; see $WORK_DIR/fixture-build.log"
    cat "$WORK_DIR/fixture-build.log" 2>/dev/null | sed 's/^/    /'
fi

OUT_FILE="$WORK_DIR/out.json"
ERR_FILE="$WORK_DIR/err.log"
exit_code=0
(
    cd "$REPO_DIR" &&
        LOKI_LEGACY_BASH=1 bash "$LOKI" ci --format json >"$OUT_FILE" 2>"$ERR_FILE"
) || exit_code=$?

if [ "$exit_code" -eq 0 ]; then
    log_pass "loki ci --format json exits 0 on a diff whose findings exceed ARG_MAX"
else
    log_fail "loki ci --format json exits 0 on a diff whose findings exceed ARG_MAX" "got exit $exit_code"
    echo "  stderr (first 10 lines):"
    head -10 "$ERR_FILE" | sed 's/^/    /'
fi

OUT_SIZE=$(wc -c <"$OUT_FILE" 2>/dev/null | tr -d ' ')
OUT_SIZE=${OUT_SIZE:-0}

# What actually has to clear execve()'s limit is the RAW pipe-delimited
# findings string cmd_ci builds internally (LOKI_CI_JSON_FINDINGS pre-fix,
# the findings temp file post-fix) -- one fixed-text line per "except:" this
# fixture adds. Reconstruct that exact string here rather than trust the
# larger, differently-shaped JSON output size, so this assertion measures the
# real crash threshold instead of a looser proxy for it.
RAW_LINE='diff|9|MEDIUM|anti-pattern|Bare except clause|Catch specific exceptions'
RAW_SIZE=$(( (${#RAW_LINE} + 1) * FINDING_COUNT ))
if [ "$ARG_MAX" -gt 0 ] && [ "$RAW_SIZE" -le "$ARG_MAX" ]; then
    log_fail "fixture clears ARG_MAX on the raw export" "raw findings string is only ~$RAW_SIZE bytes (ARG_MAX $ARG_MAX) -- fixture too small to exercise the crash this fix addresses"
else
    log_pass "fixture clears ARG_MAX on the raw export (~$RAW_SIZE bytes, ARG_MAX $ARG_MAX; rendered JSON output $OUT_SIZE bytes)"
fi

if [ -s "$OUT_FILE" ]; then
    json_check=$(python3 -c "
import json, sys
try:
    d = json.load(open('$OUT_FILE'))
    total = d.get('summary', {}).get('total', -1)
    n = len(d.get('findings', []))
    exit_field = d.get('exit_code', -1)
    status = d.get('status', '')
    if total == $FINDING_COUNT and n == $FINDING_COUNT and status == 'pass':
        print('OK')
    else:
        print(f'MISMATCH: total={total} findings_len={n} status={status} exit_code={exit_field}')
except Exception as e:
    print(f'INVALID: {e}')
" 2>&1)
    if [ "$json_check" = "OK" ]; then
        log_pass "output is valid, complete JSON with all $FINDING_COUNT findings"
    else
        log_fail "output is valid, complete JSON with all $FINDING_COUNT findings" "$json_check"
    fi
else
    log_fail "output is valid, complete JSON with all $FINDING_COUNT findings" "empty output"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
