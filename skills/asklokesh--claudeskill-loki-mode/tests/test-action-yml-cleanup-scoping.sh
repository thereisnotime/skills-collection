#!/usr/bin/env bash
# Regression test: action.yml's "Cleanup" step must never kill a process
# outside this job's own workspace.
#
# THE BUG. The step ran `pkill -f "loki-run-"` with no scoping to a PID, a
# working directory, or a Loki-specific marker beyond the substring itself.
# `pkill -f` matches the full command line of every process visible to the
# runner. A GitHub-hosted runner is normally a single-job ephemeral VM, but
# this action also runs on persistent self-hosted runners, which can host
# several concurrent jobs -- and the step runs unconditionally (`if: always()`)
# on every invocation, success or failure. Fixed to `loki stop` (no --all),
# which is folder-scoped to the current directory's .loki (autonomy/loki
# cmd_stop), exactly this job's own checkout, and never touches another job's
# run. See docs/v10/DECISIONS.md D14/D15/D16.
#
# T1 (static, LOAD-BEARING): the Cleanup step's run: block, extracted via a
# real YAML parser (never a text grep on the whole file, which could be
# satisfied by an unrelated step), no longer contains an unscoped
# `pkill -f "loki-run-"`.
#
# T2 (behavioral): the Cleanup step's run: block is extracted the same way and
# executed for real (from a sandboxed HOME/cwd, LOKI_DIR pointed at a fixture
# with no .loki, so `loki stop`'s no-op path is exercised without touching
# anything real) while a decoy process carrying "loki-run-" in its argv, in a
# DIFFERENT process group, from an unrelated cwd, survives. The decoy records
# its own PID immediately after backgrounding -- never derived from a pattern
# match against real process argv -- and carries a unique per-run token.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ACTION_YML="$REPO_ROOT/action.yml"
PY=$(command -v python3.12 || command -v python3)

[ -f "$ACTION_YML" ] || { echo "FAIL: $ACTION_YML missing"; exit 1; }
[ -n "$PY" ] || { echo "SKIPPED: no python3 (cannot parse YAML)"; echo "RESULT: 0 passed, 0 failed"; exit 0; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-actionyml-XXXXXX")
trap 'rm -rf "$WORK"' EXIT

CLEANUP_SCRIPT="$WORK/cleanup.sh"
"$PY" - "$ACTION_YML" "$CLEANUP_SCRIPT" <<'PYEOF'
import sys
import yaml

action_path, out_path = sys.argv[1], sys.argv[2]
with open(action_path) as f:
    doc = yaml.safe_load(f)

steps = doc.get("runs", {}).get("steps", [])
cleanup_steps = [s for s in steps if s.get("name") == "Cleanup"]
if len(cleanup_steps) != 1:
    sys.stderr.write(f"expected exactly 1 step named 'Cleanup', found {len(cleanup_steps)}\n")
    sys.exit(1)

run_block = cleanup_steps[0].get("run", "")
if not run_block.strip():
    sys.stderr.write("Cleanup step has no run: block\n")
    sys.exit(1)

with open(out_path, "w") as f:
    f.write(run_block)
PYEOF
PYRC=$?
if [ $PYRC -ne 0 ] || [ ! -s "$CLEANUP_SCRIPT" ]; then
    bad "could not isolate action.yml's Cleanup step run: block via YAML parse"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    exit 1
fi
ok "isolated action.yml Cleanup step run: block via YAML parse"

# --- T1: static check -- no bare, unscoped pkill -f on loki-run- -----------
# Strip comment lines first: the fix's own explanatory comment quotes the OLD
# buggy pattern by name, which would otherwise trip this exact assertion on
# fixed code (see feedback-comment-quoting-a-counted-pattern). Only live code
# lines count.
CLEANUP_CODE=$(grep -v '^[[:space:]]*#' "$CLEANUP_SCRIPT")
if echo "$CLEANUP_CODE" | grep -qE 'pkill[^|]*-f[[:space:]]+"loki-run-"'; then
    bad "action.yml Cleanup step still runs a bare, unscoped pkill -f \"loki-run-\""
else
    ok "action.yml Cleanup step has no bare unscoped pkill -f \"loki-run-\""
fi
if echo "$CLEANUP_CODE" | grep -qE '^\s*loki stop\b' && ! echo "$CLEANUP_CODE" | grep -q -- '--all'; then
    ok "action.yml Cleanup step uses folder-scoped 'loki stop' (no --all)"
else
    bad "action.yml Cleanup step does not use a folder-scoped 'loki stop'"
fi

# --- T2: behavioral -- a foreign loki-run-* decoy in a DIFFERENT process ----
# group, unrelated cwd, survives the Cleanup step's run: block executing for
# real against a sandboxed, empty .loki (loki stop's no-op path).
PERL="$(command -v perl || true)"
LOKI_BIN="$REPO_ROOT/autonomy/loki"
if [ -z "$PERL" ] || [ ! -f "$LOKI_BIN" ]; then
    echo "SKIPPED: perl or autonomy/loki not available (T1 static check above still counts)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

TOKEN="actionymltest-$$-${RANDOM}-$(date +%s 2>/dev/null || echo 0)"
SBX_HOME="$WORK/home"
SBX_CWD="$WORK/cwd"
FOREIGN_CWD="$WORK/foreign"
mkdir -p "$SBX_HOME" "$SBX_CWD" "$FOREIGN_CWD"

DECOY_PIDFILE="$FOREIGN_CWD/decoy.pid"
if command -v setsid >/dev/null 2>&1; then
    ( cd "$FOREIGN_CWD" && setsid perl -e '
        open(my $f, ">", $ARGV[0]) or die $!;
        print $f $$;
        close $f;
        $0 = $ARGV[1];
        sleep 30;
    ' "$DECOY_PIDFILE" "bash /tmp/loki-run-$TOKEN.sh" >/dev/null 2>&1 & )
else
    ( cd "$FOREIGN_CWD" && perl -e '
        use POSIX qw(setsid);
        setsid();
        open(my $f, ">", $ARGV[0]) or die $!;
        print $f $$;
        close $f;
        $0 = $ARGV[1];
        sleep 30;
    ' "$DECOY_PIDFILE" "bash /tmp/loki-run-$TOKEN.sh" >/dev/null 2>&1 & )
fi
i=0
while [ $i -lt 30 ]; do [ -s "$DECOY_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
DECOY_PID=$(cat "$DECOY_PIDFILE" 2>/dev/null || true)

if [ -z "$DECOY_PID" ] || ! kill -0 "$DECOY_PID" 2>/dev/null; then
    bad "decoy did not start (test setup broken, not the step under test)"
elif ! pgrep -f "loki-run-$TOKEN" 2>/dev/null | grep -qx "$DECOY_PID"; then
    bad "positive control failed: pgrep cannot even enumerate the decoy on this platform -- a later 'survived' result would be vacuous"
else
    RUNNER_TEMP="$WORK/runner-temp"
    mkdir -p "$RUNNER_TEMP"
    # Strip the rm -rf line before executing: the extracted block also removes
    # /tmp/loki-* and $TMPDIR/loki-* wildcard globs, unrelated to the kill
    # logic under test, which would delete OTHER sessions' run-owned temp
    # directories on this shared machine. Only the kill-scoping line
    # ("loki stop") is exercised here.
    ISOLATED_CLEANUP="$WORK/isolated_cleanup.sh"
    grep -v 'rm -rf' "$CLEANUP_SCRIPT" > "$ISOLATED_CLEANUP"
    ( cd "$SBX_CWD" && \
      PATH="$REPO_ROOT/autonomy:$PATH" \
      HOME="$SBX_HOME" LOKI_DIR="$SBX_CWD/.loki" RUNNER_TEMP="$RUNNER_TEMP" \
      bash "$ISOLATED_CLEANUP" >/dev/null 2>&1 )
    sleep 0.5
    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "a foreign loki-run-* process in a DIFFERENT process group survived the Cleanup step"
    else
        bad "a foreign loki-run-* process was KILLED by the Cleanup step -- the bug is still present"
    fi
fi

kill -9 "$DECOY_PID" 2>/dev/null || true

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
