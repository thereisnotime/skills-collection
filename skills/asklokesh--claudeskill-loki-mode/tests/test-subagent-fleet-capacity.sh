#!/usr/bin/env bash
# Subagent fleet capacity must be set EXPLICITLY, not inherited from a default.
#
# WHY THIS EXISTS. Claude Code 2.1.217 (and Agent SDK 0.3.217) changed the
# subagent spawn-depth default from 5 to 1: "Changed subagents to no longer
# spawn nested subagents by default; set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
# to allow deeper nesting" -- github.com/anthropics/claude-code/releases/tag/v2.1.217
#
# Loki's documented SDLC fleet dispatches an agent that itself delegates, so at
# depth 1 the second tier never spawns. Nothing errors: the run reports success
# having done strictly less work than the fleet pattern claims. That silent
# shape is exactly what a test has to pin, because no gate goes red on it.
#
# The invariant is "explicit", not "some particular number": an upstream default
# that moves again must not change Loki's behavior.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLAGS="$REPO_ROOT/autonomy/lib/claude-flags.sh"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- sourcing sets the spawn depth explicitly"

got=$(env -u CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH -u LOKI_SUBAGENT_CAPACITY \
      bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-}\"")
if [ -z "$got" ]; then
    bad "spawn depth is unset after sourcing -- nested subagents silently collapse to one tier"
elif [ "$got" -ge 2 ] 2>/dev/null; then
    ok "spawn depth is set to $got (>=2, so a delegating agent can still delegate)"
else
    bad "spawn depth is $got; the fleet pattern needs at least 2"
fi

# The whole point is tree-wide inheritance: subcalls are separate processes.
child=$(env -u CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH -u LOKI_SUBAGENT_CAPACITY \
        bash -c "source '$FLAGS' >/dev/null 2>&1; bash -c 'printf %s \"\${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-}\"'")
if [ "$child" = "$got" ] && [ -n "$child" ]; then
    ok "a child process inherits the depth ($child)"
else
    bad "child process saw '$child' but parent had '$got' -- not exported"
fi

echo
echo "T2 -- the operator always wins"

# A pre-set value must not be overwritten, or an operator who deliberately
# raised the depth would find Loki silently lowering it again.
pre=$(env -u LOKI_SUBAGENT_CAPACITY CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=5 \
      bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\$CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH\"")
if [ "$pre" = "5" ]; then
    ok "a pre-set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=5 is preserved"
else
    bad "pre-set depth 5 became '$pre' -- Loki overwrote an operator's explicit choice"
fi

tuned=$(env -u CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH -u LOKI_SUBAGENT_CAPACITY LOKI_SUBAGENT_SPAWN_DEPTH=3 \
        bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\$CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH\"")
if [ "$tuned" = "3" ]; then
    ok "LOKI_SUBAGENT_SPAWN_DEPTH=3 is honored"
else
    bad "LOKI_SUBAGENT_SPAWN_DEPTH=3 produced '$tuned'"
fi

off=$(env -u CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH LOKI_SUBAGENT_CAPACITY=0 \
      bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-}\"")
if [ -z "$off" ]; then
    ok "LOKI_SUBAGENT_CAPACITY=0 opts out entirely"
else
    bad "opt-out still exported depth '$off'"
fi

echo
echo "T3 -- the concurrency cap is not silently raised"

# Upstream caps concurrent subagents at 20 as a safety default. Raising that on
# every user's machine without them asking is the wrong trade, so it must stay
# unset unless the operator opts in.
dflt=$(env -u CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS -u LOKI_SUBAGENT_CONCURRENCY -u LOKI_SUBAGENT_CAPACITY \
       bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\${CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:-}\"")
if [ -z "$dflt" ]; then
    ok "concurrency is left at the upstream default (not silently raised)"
else
    bad "concurrency was exported as '$dflt' without the operator asking"
fi

optin=$(env -u CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS -u LOKI_SUBAGENT_CAPACITY LOKI_SUBAGENT_CONCURRENCY=32 \
        bash -c "source '$FLAGS' >/dev/null 2>&1; printf '%s' \"\${CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:-}\"")
if [ "$optin" = "32" ]; then
    ok "LOKI_SUBAGENT_CONCURRENCY=32 opts in explicitly"
else
    bad "opt-in produced '$optin'"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
