#!/usr/bin/env bash
# `loki logs` must show the log the runner actually writes.
#
# TWO DEFECTS THIS GUARDS.
# 1. The command read "$LOKI_DIR/logs/session.log", a path nothing in the tree
#    writes, so it reported "No log file found" while real logs sat in that same
#    directory. run.sh:22409 writes autonomy-YYYYMMDD.log, :22410 agent.log.
# 2. The first fix introduced a WORSE bug: under `set -euo pipefail`, `ls` exits
#    2 on a non-matching glob and pipefail propagates it, so the function
#    aborted before the agent.log fallback -- exit 1 with zero output.
#
# Every case asserts a SENTINEL or the not-found text, never merely that an
# error string is absent: the weak form passes on the silent rc=1 abort, which
# is exactly the regression that shipped.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-logs-command"

# Run and echo "<rc>|<output>"; rc captured WITHOUT a pipe.
runlogs() {
    local dir="$1" rc=0 out
    out="$(LOKI_DIR="$dir" bash "$REPO_ROOT/autonomy/loki" logs -n 20 2>&1)" || rc=$?
    printf '%s|%s' "$rc" "$(printf '%s' "$out" | tr '\n' ' ')"
}

# 1. A dated log is found and its CONTENT shown.
mkdir -p "$WORK/dated/logs"
echo "SENTINEL_DATED" > "$WORK/dated/logs/autonomy-20260910.log"
r="$(runlogs "$WORK/dated")"
if [ "${r%%|*}" = "0" ] && [[ "${r#*|}" == *SENTINEL_DATED* ]]; then
    pass "dated autonomy log is found and its content shown"
else
    fail "dated log not shown: $r"
fi

# 2. NEWEST dated log wins when several exist.
mkdir -p "$WORK/multi/logs"
echo "SENTINEL_OLD" > "$WORK/multi/logs/autonomy-20260101.log"
sleep 1.1
echo "SENTINEL_NEW" > "$WORK/multi/logs/autonomy-20260910.log"
r="$(runlogs "$WORK/multi")"
if [[ "${r#*|}" == *SENTINEL_NEW* ]] && [[ "${r#*|}" != *SENTINEL_OLD* ]]; then
    pass "newest dated log wins over an older one"
else
    fail "wrong log chosen: $r"
fi

# 3. agent.log FALLBACK. This is the case the pipefail bug broke: rc=1, no
#    output at all. Asserting the sentinel is what catches it.
mkdir -p "$WORK/agentonly/logs"
echo "SENTINEL_AGENT" > "$WORK/agentonly/logs/agent.log"
r="$(runlogs "$WORK/agentonly")"
if [ "${r%%|*}" = "0" ] && [[ "${r#*|}" == *SENTINEL_AGENT* ]]; then
    pass "agent.log fallback is used when no dated log exists"
else
    fail "agent.log fallback broken (the pipefail abort): $r"
fi

# 4. Empty log dir: a clean not-found message, exit 0, never a silent abort.
mkdir -p "$WORK/emptydir/logs"
r="$(runlogs "$WORK/emptydir")"
if [ "${r%%|*}" = "0" ] && [[ "${r#*|}" == *"No log file found"* ]]; then
    pass "empty log dir reports not-found cleanly"
else
    fail "empty log dir did not report cleanly: $r"
fi

# 5. No log dir at all: same.
mkdir -p "$WORK/nodir"
r="$(runlogs "$WORK/nodir")"
if [ "${r%%|*}" = "0" ] && [[ "${r#*|}" == *"No log file found"* ]]; then
    pass "absent log dir reports not-found cleanly"
else
    fail "absent log dir did not report cleanly: $r"
fi

# 6. The dead path must not come back.
# Match an ASSIGNMENT, not any mention: the fix's own comment names the old
# path to explain the bug, and a bare grep fires on that explanation. This repo
# has been burned by text guards matching their own docs.
if grep -qE '^[[:space:]]*(local[[:space:]]+)?log_file=.*logs/session\.log' "$REPO_ROOT/autonomy/loki"; then
    fail "autonomy/loki still ASSIGNS the never-written logs/session.log path"
else
    pass "the never-written session.log path is no longer read"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
