#!/usr/bin/env bash
# Test: every shell script CI runs on macOS must PARSE under bash 3.2.
#
# WHY
#   macOS still ships bash 3.2.57 as /bin/bash (Apple froze it at the last
#   GPLv2 release). GitHub's macos-latest runner is the same. Anything written
#   against bash 5 semantics that 3.2 cannot PARSE fails the entire file
#   immediately -- not the one construct, the whole script.
#
# THE BUG THIS CAUGHT (2026-07-28)
#   tests/test-sandbox-deprecation.sh died on macOS with
#     "line 91: syntax error: unexpected end of file"
#   while passing on ubuntu. Cause: an APOSTROPHE inside a single-quoted
#   heredoc nested in $( ):
#
#     HARNESS="$(cat <<'EOF'
#     # Minimal stubs for the extracted function's dependencies.   <-- this
#     EOF
#     )"
#
#   bash 3.2 scans the heredoc body for a matching quote and never finds one,
#   so it reports "unexpected EOF while looking for matching '" and rejects the
#   file. bash 5 parses it correctly, so the bug is invisible locally on any
#   machine with a modern shell -- which is exactly how it reached main.
#
# SCOPE: parse-only (`bash -n`). This does not execute anything, so it is fast
# and safe. It covers the scripts the macOS CI job actually invokes. Files that
# already fail for unrelated pre-existing reasons are listed in KNOWN_BROKEN so
# this guard stays green on today's tree while still catching NEW breakage.
#
# Proven directions:
#   POSITIVE : every macOS-CI script parses under bash 3.2.
#              RED before the fix (test-sandbox-deprecation.sh failed).
#   NEGATIVE : a file with the known-bad apostrophe pattern IS rejected, so the
#              guard is not vacuously passing on a broken parser check.
#   SKIP     : if no bash 3.2 exists on this machine, say so rather than
#              pretending to have verified anything.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS=0
FAIL=0
ok()  { printf '  PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "=== bash 3.2 parse compatibility (macOS /bin/bash) ==="

# Find a real bash 3.2. /bin/bash is it on macOS; elsewhere there may be none.
BASH32=""
if [ -x /bin/bash ]; then
    _v="$(/bin/bash -c 'echo "${BASH_VERSINFO[0]}"' 2>/dev/null || echo "")"
    [ "$_v" = "3" ] && BASH32=/bin/bash
fi

if [ -z "$BASH32" ]; then
    echo "  SKIP  no bash 3.x on this machine; cannot verify macOS parse compatibility"
    echo "        (CI's macos-latest runner provides it, so this guard runs there)"
    echo ""
    echo "  Passed: 0   Failed: 0"
    exit 0
fi
ok "found bash 3.x at $BASH32 ($("$BASH32" -c 'echo $BASH_VERSION'))"

# Scripts the macOS CI job runs directly (.github/workflows/test.yml, the
# "Run v8 SDK bridge tests" step plus the deprecation suite).
MACOS_CI_SCRIPTS="
test-sdk-done-recog-bridge.sh
test-sdk-text-bridge.sh
test-sdk-council-vote.sh
test-sdk-voter-agents.sh
test-sdk-loop-routing.sh
test-sdk-mode.sh
test-bundled-sdk-provider.sh
test-sandbox-deprecation.sh
test-acceptance-resume-idempotence.sh
"

broken=""
checked=0
for f in $MACOS_CI_SCRIPTS; do
    path="$SCRIPT_DIR/$f"
    [ -f "$path" ] || continue
    checked=$((checked + 1))
    "$BASH32" -n "$path" 2>/dev/null || broken="${broken}${f}\n"
done

if [ "$checked" -eq 0 ]; then
    bad "no macOS-CI scripts found to check (paths moved?)"
elif [ -z "$broken" ]; then
    ok "all $checked macOS-CI scripts parse under bash 3.2"
else
    bad "scripts that bash 3.2 cannot parse (they fail the whole file on macOS):"
    printf "%b" "$broken" | sed 's/^/        /'
fi

# NEGATIVE: prove the checker actually rejects the known-bad pattern, so a
# broken bash -n invocation cannot make this guard pass vacuously.
probe="$(mktemp "${TMPDIR:-/tmp}/loki-b32probe-XXXXXX.sh")"
{
    printf 'X="$(cat <<%sEOF%s\n' "'" "'"
    printf '# apostrophe in a heredoc: the function%ss deps\n' "'"
    printf 'EOF\n)"\necho ok\n'
} > "$probe"
if "$BASH32" -n "$probe" 2>/dev/null; then
    bad "bash 3.2 accepted the known-bad apostrophe-in-heredoc pattern (checker is vacuous)"
else
    ok "checker rejects the known-bad pattern (guard is non-vacuous)"
fi
rm -f "$probe"

echo ""
echo "  Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
