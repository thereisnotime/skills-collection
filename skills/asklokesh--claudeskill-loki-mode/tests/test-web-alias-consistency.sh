#!/usr/bin/env bash
# `loki web` must not silently do the wrong thing.
#
# WHY THIS EXISTS. Purple Lab (port 57375) was deprecated in v7.44.0 and `loki
# web start` now redirects to the dashboard (57374). The redirect left three
# user-visible defects, none of which errored:
#
#   1. `loki web --prd <file>` parsed the flag, shifted past it, and DROPPED it.
#      The user named a spec and sat in front of an empty dashboard believing it
#      had loaded. Silent loss of the one input they typed.
#   2. `start` hit the dashboard while `stop`/`status` still acted on Purple Lab,
#      so a user could not stop what they had just started.
#   3. quickstart's closing tip said to run `loki dashboard`, but the bare command
#      prints help and exits -- it does not start. Every first-run user who
#      followed the tip got a help screen instead of their build.
#
# All three are the same failure shape: the command appears to work. That is
# what a test has to hold, because nothing goes red on its own.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"
QS="$REPO_ROOT/autonomy/quickstart.sh"

PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "T1 -- a dropped --prd is reported, never silent"

if grep -q '_web_dropped_prd' "$LOKI"; then
    ok "the redirect records a dropped --prd"
else
    bad "no record of a dropped --prd; the user's spec vanishes silently"
fi

# Recording it is useless if nothing is printed, and it must name the command
# that does accept a PRD rather than just complaining.
if grep -A4 'if \[ -n "\$_web_dropped_prd" \]' "$LOKI" | grep -q 'loki start'; then
    ok "the notice names 'loki start' as the command that takes a PRD"
else
    bad "a dropped --prd is not surfaced with an actionable alternative"
fi

echo
echo "T2 -- stop and status act on what start actually launched"

# Scope to the WEB dispatch block specifically. There are five `stop)` arms in
# this file (dashboard, web, and three others); an unscoped grep matched the
# dashboard's own arm and stayed green when the web one was deleted -- a guard
# that could not see its own regression. Anchor on the web redirect that opens
# the block and read only to the end of that case statement.
_web_case=$(awk '/^    case "\$subcommand" in$/,/^    esac$/' "$LOKI" \
            | awk '/cmd_web_redirect_to_dashboard/,0')

if printf '%s' "$_web_case" | grep -A6 '^        stop)' | grep -q 'cmd_dashboard_stop'; then
    ok "web stop stops the dashboard that web start launched"
else
    bad "web stop does not stop the dashboard; a user cannot stop what they started"
fi

if printf '%s' "$_web_case" | grep -A6 '^        status)' | grep -q 'cmd_dashboard_status'; then
    ok "web status reports on the dashboard that web start launched"
else
    bad "web status reports on a server that web start does not launch"
fi

echo
echo "T3 -- the first-run tip names a command that starts something"

# Bare `loki dashboard` prints help (cmd_dashboard_help) and exits.
if grep -q "loki dashboard start' in another terminal" "$QS"; then
    ok "quickstart tells the user 'loki dashboard start'"
else
    bad "quickstart's tip does not name a command that actually starts the dashboard"
fi

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS+FAIL)) total"
[ "$FAIL" -eq 0 ]
