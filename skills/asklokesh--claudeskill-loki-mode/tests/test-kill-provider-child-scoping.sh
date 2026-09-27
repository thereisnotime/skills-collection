#!/usr/bin/env bash
# Regression test: kill_provider_child (autonomy/run.sh) must never kill a
# process outside this run's own process group.
#
# THE BUG. The reparented-leaf sweep used `pkill -f "^${proc}( |$)"` for
# proc in claude/codex/aider/cline, with NO scoping to a PID, PGID, working
# directory, or Loki-specific marker. `pkill -f` matches the FULL COMMAND
# LINE of every matching process on the ENTIRE MACHINE. This function runs
# on: a supervisor signal, double Ctrl+C, a single Ctrl+C in perpetual mode,
# and normal interrupted-session cleanup -- i.e. every time a loki-mode
# session ends via signal, not just `loki stop`. A user reported: every time
# a loki-mode session completed, some OTHER unrelated Claude Code session (in
# a different terminal, a different project) got terminated. Root cause:
# this exact line killed any "claude"/"codex"/"aider"/"cline" process on the
# machine, unconditionally. Fixed to scope the sweep to processes sharing
# THIS run's process group id -- a reparented leaf (parent exited, still
# alive) keeps the pgid it was launched into unless it called
# setpgid/setsid, so this still catches the real cleanup target while never
# touching an unrelated session in its own process group.
#
# WHAT A REAL "REPARENTED LEAF" ACTUALLY LOOKS LIKE. run.sh runs the
# provider as a pipeline stage: `claude ... | tee ... | python3 ...`.
# Bash does not put a foreground pipeline in its own process group, so every
# stage shares run.sh's own pgid. If run.sh's own process is interrupted or
# an earlier retry iteration's pipeline leaks a stage, that leaf becomes a
# GRANDCHILD whose immediate parent already exited (ppid becomes 1) while it
# keeps run.sh's original pgid -- invisible to the function's first pass
# (`pgrep -P $$`, direct children only), which is exactly the gap the pgid
# sweep exists to close.
#
# THIS TEST PREVIOUSLY BROUGHT THE SAME BUG BACK, caught by a 4-reviewer
# HIGH-tier council (all 4 flagged it, one REJECT) before it shipped:
#   1. It found its "unrelated other session" decoy with
#      `pgrep -f 'claude --dangerously-skip-permissions --continue' | tail -1`
#      -- the exact argv of a REAL Claude Code session -- and then
#      unconditionally `kill -9`'d whatever PID that returned. On a machine
#      where PIDs had wrapped, `tail -1` picked the live review session
#      instead of the decoy. Reviewers reproduced the wrong-PID selection
#      without executing the kill.
#   2. Its "reparented leaf in this run's own process group" decoy was
#      launched in a SEPARATE bash subprocess from the one that later called
#      kill_provider_child, so the two were never in the same process group
#      to begin with -- the assertion was vacuous in the other direction
#      (rewriting it to a genuine same-shell orphan, per the paragraph
#      above, reproduced this: the decoy's pgid differed from the harness
#      subprocess's own pgid, so the sweep correctly, but uselessly, found
#      nothing to clean up).
# Fixed here: the "reparented leaf" case launches its decoy as a
# backgrounded subshell of THIS SAME test process (no separate `bash`
# invocation), so it genuinely shares this process's pgid while its
# immediate parent (the subshell) exits, giving it ppid=1 -- exactly the
# grandchild-orphan shape described above, invisible to `pgrep -P $$`.
# The "unrelated other session" decoy still gets its own process group
# (setsid/perl POSIX::setsid) and writes its OWN pid to a file immediately
# after backgrounding -- never derived from a pattern match against real
# process argv, and every decoy's argv carries a unique per-run token so no
# assertion can ever be satisfied by matching a real, unrelated process.
#
# ROUND 2 OF REVIEW FOUND A FIFTH INSTANCE OF THE SAME BUG CLASS, this time
# in the test's OWN ISOLATION, not its decoy-selection logic: once the
# decoys were fixed, the test still calls the REAL kill_provider_child in
# whatever process group it happens to inherit from its caller. That
# function's pgid sweep SIGTERMs every "claude"/"codex"/"aider"/"cline"
# process sharing the CALLER's pgid -- including a process this test never
# launched and never recorded, if one happens to already be running in that
# pgid (a sibling test-runner lane that doesn't detach its subprocesses, a
# CI step that backgrounds `claude -p` before running the suite, an agent
# harness with no job control). Reproduced: `perl -e '$0="claude
# --outside-victim-$$"; sleep 30' &` in the SAME shell that then runs this
# test terminates the victim even though the test reports "6 passed, 0
# failed" -- proof itself is not what killed it, the FUNCTION UNDER TEST is,
# reached exactly the way a real caller would reach it.
#
# Fixed by putting the WHOLE TEST in its own new session before anything
# else runs, so the only processes ever in its process group are its own.
# The fork happens before setsid so this also works when the test is
# already a process group leader (an interactive terminal).
if [ -z "${LOKI_KPC_ISOLATED:-}" ] && command -v perl >/dev/null 2>&1; then
    LOKI_KPC_ISOLATED=1 exec perl -e '
        use POSIX ();
        my $p = fork();
        die "fork: $!" unless defined $p;
        if ($p) { waitpid($p, 0); exit(($? >> 8)); }
        POSIX::setsid() != -1 or die "setsid: $!";
        exec { $ENV{BASH} // "bash" } @ARGV or die "exec: $!";
    ' "${BASH:-bash}" "$0" "$@"
fi

# See docs/v10/DECISIONS.md D14/D15/D16 and
# feedback-pkill-f-substring-killed-the-session,
# feedback-a-test-can-reintroduce-the-bug-it-guards-against (project memory).
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

[ -f "$RUN_SH" ] || { echo "FAIL: $RUN_SH missing"; exit 1; }

# --- T1: static check -- no bare, unscoped pkill -f on a provider name -----
# Matches the exact vulnerable shape: pkill -f "^claude..." / "^${proc}..."
# with no pgid/pid check anywhere in the same function body.
FN_BODY="$(awk '/^kill_provider_child\(\) \{/,/^\}/' "$RUN_SH")"
[ -n "$FN_BODY" ] || { echo "FAIL: could not extract kill_provider_child() from run.sh"; exit 1; }

if echo "$FN_BODY" | grep -qE 'pkill[^|]*-f[[:space:]]+"\^\$\{?proc\}?'; then
    bad "kill_provider_child still runs a bare, unscoped pkill -f by provider name"
else
    ok "kill_provider_child has no bare unscoped pkill -f by provider name"
fi
if echo "$FN_BODY" | grep -q 'pgid'; then
    ok "kill_provider_child scopes its provider-leaf sweep by process group"
else
    bad "kill_provider_child does not appear to scope by process group"
fi

# --- T2: live behavior -- an unrelated same-named process in a DIFFERENT ---
# process group must survive; a reparented leaf sharing THIS process's own
# process group must still be killed (the cleanup this function exists for).
PERL="$(command -v perl || true)"
if [ -z "$PERL" ]; then
    echo "SKIPPED: no perl (live behavior not exercised, static checks above still count)"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FN_FILE="$WORK/kill_fn.sh"
printf '%s\n' "$FN_BODY" > "$FN_FILE"
# shellcheck disable=SC1090
source "$FN_FILE"

# A per-run token so no decoy's argv can ever collide with a real process on
# this machine. Never use a real CLI invocation string as a test fixture.
TOKEN="lokikpctest-$$-$RANDOM-$(date +%s 2>/dev/null || echo 0)"

# Tripwire, defense in depth: if a future regression reintroduces a bare
# pkill/killall inside kill_provider_child, this test would otherwise still
# report PASS as long as it happened not to hit anything in the run right
# now. Shadow both commands so any call other than THIS test's own (which
# never calls them directly) is caught, logged, and fails the run instead of
# silently reaching a real process. kill_provider_child's fixed sweep does
# not call pkill/killall at all -- it uses pgrep plus per-pid `kill`.
PKILL_TRIPWIRE_LOG="$WORK/pkill-tripwire.log"
# shellcheck disable=SC2317  # invoked indirectly if kill_provider_child ever calls it
pkill()   { echo "TRIPWIRE: pkill $*" >> "$PKILL_TRIPWIRE_LOG"; return 1; }
# shellcheck disable=SC2317
killall() { echo "TRIPWIRE: killall $*" >> "$PKILL_TRIPWIRE_LOG"; return 1; }

wait_for_pidfile() { # wait_for_pidfile <pidfile> -> prints the pid once written
    local pidfile="$1" i=0
    while [ $i -lt 30 ]; do
        [ -s "$pidfile" ] && { cat "$pidfile"; return 0; }
        sleep 0.1
        i=$((i + 1))
    done
    return 1
}

# --- Decoy A: a genuine grandchild-orphan sharing THIS PROCESS's own pgid -
# Backgrounded from a subshell of THIS test process (no separate `bash`
# invocation, so the pgid is guaranteed identical to what kill_provider_child
# sees via $$ below). The subshell exits immediately after launching the
# decoy, so the decoy's ppid becomes 1 while its pgid is unchanged -- a real
# reparented leaf, invisible to `pgrep -P $$`, which is what the pgid sweep
# exists to still catch.
MY_PGID_BEFORE="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
SAME_PIDFILE="$WORK/same.pid"
( perl -e '
    open(my $f, ">", $ARGV[0]) or die $!;
    print $f $$;
    close $f;
    $0 = $ARGV[1];
    sleep 30;
' "$SAME_PIDFILE" "claude --loki-test-same-$TOKEN" & )
SAME_PID="$(wait_for_pidfile "$SAME_PIDFILE")" || SAME_PID=""

if [ -z "$SAME_PID" ] || ! kill -0 "$SAME_PID" 2>/dev/null; then
    bad "same-group decoy did not start (test setup broken, not the function under test)"
else
    SAME_PPID="$(ps -o ppid= -p "$SAME_PID" 2>/dev/null | tr -d ' ')"
    SAME_PGID="$(ps -o pgid= -p "$SAME_PID" 2>/dev/null | tr -d ' ')"
    DIRECT_CHILD="$(pgrep -P $$ 2>/dev/null | grep -x "$SAME_PID" || true)"
    if [ "$SAME_PPID" = "1" ] && [ "$SAME_PGID" = "$MY_PGID_BEFORE" ] && [ -z "$DIRECT_CHILD" ]; then
        ok "same-group decoy is a genuine grandchild-orphan (ppid=1, pgid matches this process, not a direct child) -- the assertion below actually exercises the pgid sweep"
    else
        bad "same-group decoy setup is wrong (ppid=$SAME_PPID want 1; pgid=$SAME_PGID want $MY_PGID_BEFORE; direct_child=${DIRECT_CHILD:-no}) -- the assertion below would be vacuous"
    fi

    kill_provider_child >/dev/null 2>&1
    sleep 0.3

    if kill -0 "$SAME_PID" 2>/dev/null; then
        bad "a reparented leaf in THIS run's own process group was not cleaned up (over-corrected)"
    else
        ok "a reparented leaf sharing this run's process group is still cleaned up"
    fi
fi

# --- Decoy B: its own session leader (a distinct pgid) --------------------
# Simulates a completely unrelated Claude Code session in another
# terminal/project. Its pid is recorded by the decoy itself, never derived
# from a pattern match against real process argv.
#
# Launched inside a SUBSHELL that exits immediately after backgrounding it
# (same reason as Decoy A above): `setsid()` changes a process's own
# session and process group, but NEVER its PPID -- `pgrep -P $$` (used by
# both this function's first pass AND its final SIGKILL escalation pass)
# still finds a plain `setsid ... &` job as a direct child of this shell
# for as long as this shell is alive, which would make it collateral of the
# escalation pass regardless of the pgid fix under test. A subshell that
# exits removes it from `pgrep -P $$` entirely (ppid becomes 1), which is
# also the only shape a truly unrelated, independently-launched session can
# ever take relative to this process.
launch_recorded_decoy() { # launch_recorded_decoy <pidfile> <fake-argv0-suffix>
    local pidfile="$1" suffix="$2"
    if command -v setsid >/dev/null 2>&1; then
        ( setsid perl -e '
            open(my $f, ">", $ARGV[0]) or die $!;
            print $f $$;
            close $f;
            $0 = $ARGV[1];
            sleep 30;
        ' "$pidfile" "claude $suffix" >/dev/null 2>&1 & )
    else
        ( perl -e '
            use POSIX qw(setsid);
            setsid();
            open(my $f, ">", $ARGV[0]) or die $!;
            print $f $$;
            close $f;
            $0 = $ARGV[1];
            sleep 30;
        ' "$pidfile" "claude $suffix" >/dev/null 2>&1 & )
    fi
}

OTHER_PIDFILE="$WORK/other.pid"
launch_recorded_decoy "$OTHER_PIDFILE" "--loki-test-other-$TOKEN"
OTHER_PID="$(wait_for_pidfile "$OTHER_PIDFILE")" || OTHER_PID=""

if [ -z "$OTHER_PID" ] || ! kill -0 "$OTHER_PID" 2>/dev/null; then
    bad "unrelated-group decoy did not start (test setup broken, not the function under test)"
else
    OTHER_PGID="$(ps -o pgid= -p "$OTHER_PID" 2>/dev/null | tr -d ' ')"
    OTHER_PPID="$(ps -o ppid= -p "$OTHER_PID" 2>/dev/null | tr -d ' ')"
    OTHER_DIRECT_CHILD="$(pgrep -P $$ 2>/dev/null | grep -x "$OTHER_PID" || true)"
    if [ -n "$OTHER_PGID" ] && [ "$OTHER_PGID" != "$MY_PGID_BEFORE" ] && [ -z "$OTHER_DIRECT_CHILD" ]; then
        ok "unrelated-group decoy is in a distinct process group and not a direct child of this process (pgid=$OTHER_PGID, ppid=$OTHER_PPID)"
    else
        bad "unrelated-group decoy setup is wrong (pgid=$OTHER_PGID want != $MY_PGID_BEFORE; direct_child=${OTHER_DIRECT_CHILD:-no} want none) -- setsid changes pgid but NEVER ppid, so a plain 'setsid ... &' with no enclosing subshell stays a pgrep -P \$\$ direct child and the assertion below would be vacuous against this function's separate SIGKILL escalation pass"
    fi

    kill_provider_child >/dev/null 2>&1
    sleep 0.3

    if kill -0 "$OTHER_PID" 2>/dev/null; then
        ok "an unrelated 'claude' process in a DIFFERENT process group survived"
    else
        bad "an unrelated 'claude' process in a different process group was KILLED -- the bug is still present"
    fi
fi

# Cleanup: only the exact recorded PIDs from this run, never a pattern.
[ -n "$SAME_PID" ] && kill -9 "$SAME_PID" 2>/dev/null || true
[ -n "$OTHER_PID" ] && kill -9 "$OTHER_PID" 2>/dev/null || true

if [ -s "$PKILL_TRIPWIRE_LOG" ]; then
    bad "kill_provider_child called pkill/killall directly -- a regression to the exact bug class this test guards against: $(cat "$PKILL_TRIPWIRE_LOG")"
else
    ok "kill_provider_child never calls pkill/killall directly (per-pid kill only)"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
