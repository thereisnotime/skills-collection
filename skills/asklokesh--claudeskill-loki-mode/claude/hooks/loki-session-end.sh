#!/usr/bin/env bash
# v7.7.18 sample Claude Code SessionEnd hook (MANUAL install only).
#
# Pipes the Claude Code session transcript through `loki memory ingest`
# so the project's .loki/memory/ store accumulates real episodes from
# every Claude Code session (not just `loki start <prd>` sessions).
#
# v7.7.18 council fix (Opus 2): supports BOTH (a) the documented JSON-
# on-stdin payload format with `transcript_path` key, AND (b) the legacy
# $CLAUDE_TRANSCRIPT_PATH env var as fallback. Whichever Claude Code
# version is running, one of them works.
#
# Manual installation (recommended -- automated installer deferred to
# v7.7.19 pending empirical schema verification):
#   1. Add to your ~/.claude/settings.json:
#      {
#        "hooks": {
#          "SessionEnd": [
#            {
#              "matcher": "clear",
#              "hooks": [
#                {
#                  "type": "command",
#                  "command": "/absolute/path/to/loki-session-end.sh"
#                }
#              ]
#            }
#          ]
#        }
#      }
#   2. Reload Claude Code (or open a new session).
#   3. End a session with `/clear` to trigger the hook.
#
# Note: SessionEnd only fires on /clear, NOT on normal exits per the
# Claude Code documentation. To capture EVERY session, alternative
# event types may be needed (researched in v7.7.19+).
#
# Escape hatches:
#   LOKI_MEMORY_CAPTURE_DISABLED=true   # blocks ingest at the engine
#
# Privacy: the ingester scrubs credential keywords + high-entropy
# token shapes (sk-, ghp_/ghs_, xox*, AIza, AKIA) before writing.
# Path-aware scrubbing for sensitive directories added in v7.7.18.
set -u

if [ "${LOKI_MEMORY_CAPTURE_DISABLED:-}" = "true" ]; then
    exit 0
fi

# Resolve transcript path from EITHER stdin JSON OR env var.
TRANSCRIPT=""

# 1. Try stdin JSON (documented Claude Code hook payload format).
#    Only read stdin if it's not a TTY (i.e. there's actual data).
if [ ! -t 0 ]; then
    # Read up to 16KB of stdin (JSON payloads are tiny)
    STDIN_DATA=$(head -c 16384 2>/dev/null || true)
    if [ -n "$STDIN_DATA" ] && command -v python3 >/dev/null 2>&1; then
        TRANSCRIPT=$(printf '%s' "$STDIN_DATA" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get('transcript_path', ''), end='')
except Exception:
    pass
" 2>/dev/null || true)
    fi
fi

# 2. Fallback to env var (legacy / undocumented variant).
if [ -z "$TRANSCRIPT" ]; then
    TRANSCRIPT="${CLAUDE_TRANSCRIPT_PATH:-}"
fi

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
    # Nothing to ingest -- silent exit so we never block SessionEnd.
    exit 0
fi

# Find the loki binary; silent skip if not installed.
if ! command -v loki >/dev/null 2>&1; then
    exit 0
fi

# Fire-and-forget ingest. Backgrounded so SessionEnd is not blocked.
loki memory ingest --from-claude-transcript "$TRANSCRIPT" >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
