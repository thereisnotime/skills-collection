#!/usr/bin/env bash
# Increments a turn counter in .loki/state/v10-drift-audit-counter and
# prints "DRIFT AUDIT DUE" on every 6th turn (founder directive: run a
# drift audit every 6th turn, comparing the last 6 hours of commits and
# releases against docs/v10/CONTROL.md).
#
# Deliberately minimal: this script only counts and signals. It does NOT
# write the audit itself -- that requires reading commit history and
# comparing against CONTROL.md, real judgment work that belongs in the
# agent's own turn, not a hook script. The hook's job is just to make
# "is an audit due" visible in the injected pulse context every turn,
# so the agent (not a script) performs the audit when it's due.
#
# State lives under .loki/state/ (gitignored, session-local) so counting
# survives across pulse hook invocations within one project checkout,
# never committed, never shared across machines.

set -uo pipefail

COUNTER_FILE="${V10_DRIFT_COUNTER_FILE:-.loki/state/v10-drift-audit-counter}"
EVERY_N="${V10_DRIFT_AUDIT_EVERY:-6}"

mkdir -p "$(dirname "$COUNTER_FILE")" 2>/dev/null || true

count=0
if [ -f "$COUNTER_FILE" ]; then
    read -r count < "$COUNTER_FILE" 2>/dev/null || count=0
fi
case "$count" in
    ''|*[!0-9]*) count=0 ;;
esac

count=$((count + 1))
printf '%s\n' "$count" > "$COUNTER_FILE" 2>/dev/null || true

if [ $((count % EVERY_N)) -eq 0 ]; then
    printf 'DRIFT AUDIT DUE (turn %s, every %s)\n' "$count" "$EVERY_N"
fi

exit 0
