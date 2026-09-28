#!/usr/bin/env bash
# Test: web-app/src/pages/SettingsPage.tsx must not list Gemini as a
# provider, and must not carry a hardcoded build date.
#
# WHY THIS EXISTS
#   Gemini CLI was deprecated and removed from the runtime in v7.5.18
#   (CLAUDE.md, providers/*.sh). SettingsPage.tsx still listed it in
#   PROVIDERS and in the default providerPriority chain, so the settings UI
#   offered a provider that cannot run. The same file also hardcoded a
#   build date string that goes stale on every release (S-51/BACKLOG 117,
#   S-130).
#
# Proven directions:
#   POSITIVE: current file has no 'gemini' token and no hardcoded date.
#   NEGATIVE: reintroducing either regresses this test (verified by hand
#             during S-130 by temporarily restoring the old lines).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="$SCRIPT_DIR/../web-app/src/pages/SettingsPage.tsx"

fail=0

if [ ! -f "$FILE" ]; then
    echo "FAIL: $FILE not found"
    exit 1
fi

if grep -qi 'gemini' "$FILE"; then
    echo "FAIL: SettingsPage.tsx still references gemini"
    fail=1
fi

if grep -qE '2026-03-24' "$FILE"; then
    echo "FAIL: SettingsPage.tsx still hardcodes the old build date"
    fail=1
fi

if [ "$fail" -eq 0 ]; then
    echo "PASS: SettingsPage.tsx has no gemini reference and no hardcoded build date"
fi

exit "$fail"
