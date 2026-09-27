#!/usr/bin/env bash
# Regression test: autonomy/verify.sh's _verify_runtime_teardown (the runtime
# gate's app-boot teardown) must never kill a process it does not own.
#
# THE BUG. The port-reclaim pass ran `lsof -ti tcp:$port` with NO -sTCP:LISTEN
# filter and NO ownership check at all: it matched every socket referencing
# that port number -- including a CLIENT process with an established
# connection whose REMOTE port happens to equal $port (e.g. a browser tab
# open to localhost:$port), and any unrelated process that happens to be
# LISTENING on the port after reuse. Every matched PID got an unconditional
# kill -9. Same D14/D15/D16 class as this session's other fixes.
#
# Fixed to (1) filter to LISTEN sockets only, and (2) verify each candidate is
# part of THIS launcher's own tree (pgid matches the launcher's captured
# child_pgid, or its direct parent is app_pid) before killing it.
#
# T1 (static, LOAD-BEARING): the port-reclaim lsof call includes -sTCP:LISTEN,
# and the kill inside the read loop is gated on a pgid/ppid match, not
# unconditional.
# T2 (behavioral): a genuine own-tree listener (spawned as a direct child of
# a launcher this test controls, sharing its pgid) IS still reclaimed --
# proving the fix does not just delete all kill logic. A decoy listener that
# shares no relationship with the launcher survives. A decoy CLIENT holding an
# open connection whose remote port matches survives even though the old
# lsof -ti (no -sTCP:LISTEN) would have matched it.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_SH="$REPO_ROOT/autonomy/verify.sh"
PY=$(command -v python3.12 || command -v python3)

[ -f "$VERIFY_SH" ] || { echo "FAIL: $VERIFY_SH missing"; exit 1; }
[ -n "$PY" ] || { echo "SKIPPED: no python3"; echo "RESULT: 0 passed, 0 failed"; exit 0; }

FN_BODY="$(awk '/^_verify_runtime_teardown\(\) \{/,/^\}/' "$VERIFY_SH")"
[ -n "$FN_BODY" ] || { echo "FAIL: could not extract _verify_runtime_teardown() from $VERIFY_SH"; exit 1; }
# The fourth ownership arm (round 4) calls a second helper,
# _verify_runtime_pid_has_token(); it must be extracted and sourced alongside
# _verify_runtime_teardown or every call to it fails with "command not found"
# in this test's isolated harness -- which would silently make the fourth arm
# untestable here without ever failing the harness itself (bash treats the
# missing-command error as just another false condition in the || chain).
TOKEN_FN_BODY="$(awk '/^_verify_runtime_pid_has_token\(\) \{/,/^\}/' "$VERIFY_SH")"
[ -n "$TOKEN_FN_BODY" ] || { echo "FAIL: could not extract _verify_runtime_pid_has_token() from $VERIFY_SH"; exit 1; }

# --- T1: static checks ------------------------------------------------------
if echo "$FN_BODY" | grep -qE 'lsof -ti tcp:"\$_rp" -sTCP:LISTEN'; then
    ok "_verify_runtime_teardown filters the port-reclaim lsof to LISTEN sockets"
else
    bad "_verify_runtime_teardown does not filter the port-reclaim lsof to LISTEN sockets"
fi
# The kill inside the "while IFS= read -r pid" loop must be gated on a pgid or
# ppid comparison, not a bare unconditional kill -9 "$pid".
READ_LOOP="$(printf '%s\n' "$FN_BODY" | awk '/while IFS= read -r pid/{f=1} f{print} f&&/^[[:space:]]*done/{exit}')"
if echo "$READ_LOOP" | grep -qE '_h_pgid.*=.*child_pgid|_h_ppid.*=.*app_pid'; then
    ok "port-reclaim kill loop is gated on a pgid/ppid ownership match"
else
    bad "port-reclaim kill loop is not gated on ownership (unconditional kill)"
fi

# --- T2: behavioral ----------------------------------------------------------
WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-teardowntest-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
FN_FILE="$WORK/teardown_fn.sh"
{
    printf '%s\n' "$TOKEN_FN_BODY"
    printf '%s\n' "$FN_BODY"
} > "$FN_FILE"
# shellcheck disable=SC1090
source "$FN_FILE"

PORT=$((41000 + (RANDOM % 5000)))

listener_script() {
    # NOTE: this text is embedded inside a SINGLE-quoted shell string when the
    # launcher script is generated below -- a literal apostrophe anywhere in
    # this comment breaks that quoting and corrupts the generated script with
    # a confusing downstream syntax error, not an error here. Write around
    # contractions/possessives instead of using one.
    cat <<PYEOF
import socket, signal, time
# Ignore SIGTERM (the isolation control demanded by the D14/D15/D16 council
# round-2 review): _verify_runtime_teardown does an EARLIER pkill -P
# "\$app_pid" pass (a plain SIGTERM, no -9) that would otherwise kill a
# default-handling listener before the port-reclaim loop under test ever
# runs, making the reclaim assertion pass even if that loop were a complete
# no-op -- exactly the gap that let the daemonized-leak regression slip
# through review undetected. A SIGTERM-ignoring listener can only be brought
# down by an explicit kill -9, so this assertion can only pass if the
# reclaim loop itself does the work.
signal.signal(signal.SIGTERM, signal.SIG_IGN)
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", $PORT))
s.listen(5)
time.sleep(30)
PYEOF
}

# Own-tree listener: launched as a DIRECT CHILD of a launcher subshell so it
# shares this test's own pgid when app_pid (the launcher) also does -- this
# mirrors the real launcher-and-its-server relationship _verify_runtime_teardown
# is designed to reap.
LAUNCHER_SCRIPT="$WORK/launcher.sh"
LISTENER_PIDFILE="$WORK/listener.pid"
cat > "$LAUNCHER_SCRIPT" <<EOF
#!/usr/bin/env bash
"$PY" -c '$(listener_script)' &
echo \$! > "$LISTENER_PIDFILE"
wait
EOF
chmod +x "$LAUNCHER_SCRIPT"
"$LAUNCHER_SCRIPT" >/dev/null 2>&1 &
APP_PID=$!
i=0
while [ $i -lt 40 ]; do [ -s "$LISTENER_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
LISTENER_PID=$(cat "$LISTENER_PIDFILE" 2>/dev/null || true)

if [ -z "$LISTENER_PID" ] || ! kill -0 "$LISTENER_PID" 2>/dev/null || ! kill -0 "$APP_PID" 2>/dev/null; then
    bad "own-tree launcher+listener did not start (test setup broken, not the function under test)"
else
    LISTENER_PPID="$(ps -o ppid= -p "$LISTENER_PID" 2>/dev/null | tr -d ' ')"
    if [ "$LISTENER_PPID" != "$APP_PID" ]; then
        bad "own-tree listener setup is wrong (ppid=$LISTENER_PPID want $APP_PID) -- the assertion below would be vacuous"
    else
        ok "own-tree listener is a genuine direct child of app_pid"
    fi

    # Positive control: confirm the port is actually enumerable before
    # asserting anything about survival/reclamation.
    if ! lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$LISTENER_PID"; then
        bad "positive control failed: lsof cannot enumerate the own-tree listener on this platform"
    else
        ok "positive control: lsof enumerates the own-tree listener before teardown"
        _verify_runtime_teardown "$APP_PID" "$PORT" ""
        sleep 0.5
        if kill -0 "$LISTENER_PID" 2>/dev/null; then
            bad "own-tree listener was NOT reclaimed -- teardown deleted its kill logic instead of scoping it"
        else
            ok "own-tree listener (direct child of app_pid) is reclaimed"
        fi
    fi
    kill -9 "$APP_PID" 2>/dev/null || true
    kill -9 "$LISTENER_PID" 2>/dev/null || true
fi

# --- Decoy A: unrelated listener on a DIFFERENT free port, no relationship --
# to any app_pid/child_pgid this teardown call is given. `setsid` (util-linux)
# does not exist on macOS, so each of the decoy and the fake launcher is given
# its OWN session/process group via perl's POSIX::setsid() (portable) inside a
# subshell that exits immediately after backgrounding -- the same technique
# tests/test-kill-provider-child-scoping.sh uses, and for the same reason:
# backgrounding either directly in THIS script's shell (no setsid, no
# subshell) would put it in this test's own pgid, which is exactly the
# false-failure trap D16 documents -- the "unrelated" pair would then share a
# pgid with each other by accident of bash job control, not by test design.
DECOY_PORT=$((46000 + (RANDOM % 5000)))
DECOY_PIDFILE="$WORK/decoy.pid"
PERL="$(command -v perl || true)"
if [ -z "$PERL" ]; then
    bad "no perl available (cannot construct genuinely unrelated decoy process groups)"
else
    ( perl -e '
        use POSIX qw(setsid);
        setsid();
        open(my $f, ">", $ARGV[1]) or die $!;
        print $f $$;
        close $f;
        exec($ARGV[0], "-c", "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((\"127.0.0.1\", '"$DECOY_PORT"'))
s.listen(5)
time.sleep(30)
");
    ' "$PY" "$DECOY_PIDFILE" >/dev/null 2>&1 & )
fi
i=0
while [ $i -lt 40 ]; do [ -s "$DECOY_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
DECOY_PID=$(cat "$DECOY_PIDFILE" 2>/dev/null || true)

FAKE_APP_PIDFILE="$WORK/fakeapp.pid"
if [ -n "$PERL" ]; then
    ( perl -e '
        use POSIX qw(setsid);
        setsid();
        open(my $f, ">", $ARGV[0]) or die $!;
        print $f $$;
        close $f;
        sleep 30;
    ' "$FAKE_APP_PIDFILE" >/dev/null 2>&1 & )
    i=0
    while [ $i -lt 40 ]; do [ -s "$FAKE_APP_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
    FAKE_APP_PID=$(cat "$FAKE_APP_PIDFILE" 2>/dev/null || true)
else
    sleep 30 &
    FAKE_APP_PID=$!
fi

DECOY_PGID="$(ps -o pgid= -p "$DECOY_PID" 2>/dev/null | tr -d ' ')"
FAKE_APP_PGID="$(ps -o pgid= -p "$FAKE_APP_PID" 2>/dev/null | tr -d ' ')"
FAKE_APP_PPID="$(ps -o ppid= -p "$FAKE_APP_PID" 2>/dev/null | tr -d ' ')"

if [ -z "$DECOY_PID" ] || ! kill -0 "$DECOY_PID" 2>/dev/null; then
    bad "unrelated decoy listener did not start (test setup broken, not the function under test)"
elif ! lsof -ti tcp:"$DECOY_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$DECOY_PID"; then
    bad "positive control failed: lsof cannot enumerate the unrelated decoy listener"
elif [ -z "$DECOY_PGID" ] || [ "$DECOY_PGID" = "$FAKE_APP_PGID" ] || [ "$DECOY_PID" = "$FAKE_APP_PPID" ]; then
    bad "decoy/fake-launcher setup is wrong (decoy_pgid=$DECOY_PGID fake_app_pgid=$FAKE_APP_PGID fake_app_ppid=$FAKE_APP_PPID) -- they are not genuinely unrelated, the assertion below would be vacuous"
else
    ok "positive control: lsof enumerates the unrelated decoy listener, and decoy/fake-launcher are genuinely unrelated process trees"
    _verify_runtime_teardown "$FAKE_APP_PID" "$DECOY_PORT" ""
    sleep 0.5
    if kill -0 "$DECOY_PID" 2>/dev/null; then
        ok "unrelated decoy listener on a different port survives an unrelated teardown call"
    else
        bad "unrelated decoy listener was KILLED by an unrelated teardown call -- the bug is still present"
    fi
    kill -9 "$FAKE_APP_PID" 2>/dev/null || true
fi
kill -9 "$DECOY_PID" 2>/dev/null || true

# --- T3: the actual regression this round's council round-2 REJECT found and
# reproduced. autonomy/verify.sh launches the app via
# `exec "$timeout_bin" "$boot_timeout" sh -c "$method"` (verify.sh:1699) from a
# subshell, so app_pid IS timeout's own pid (exec replaces the subshell image,
# no fork). GNU `timeout` makes ITSELF the process-group leader. If the
# launched command forks a server and the parent (timeout, then sh -c) exits
# -- the classic "daemonized" leak this function's own comments describe --
# by teardown time: timeout has already exited, so child_pgid (captured via
# `ps -o pgid= -p "$app_pid"`) is EMPTY; the orphaned listener's ppid is 1, not
# app_pid; but its pgid is STILL app_pid, the value it inherited when timeout
# created the group. Neither the child_pgid arm nor the ppid arm can ever
# match this shape -- only a third arm comparing the holder's pgid directly
# against app_pid closes it. This scenario is the one the OTHER two decoys in
# this file (own-tree direct-child, and unrelated-process-group) do NOT
# reproduce, which is why the regression passed this file's own suite before
# being caught by human/council review instead.
GNU_TIMEOUT="$(command -v timeout || true)"
if [ -z "$GNU_TIMEOUT" ] || ! "$GNU_TIMEOUT" --version 2>/dev/null | grep -qi 'GNU coreutils'; then
    echo "SKIPPED: no GNU timeout on PATH (BSD timeout does not reproduce this process-group shape) -- T1/T2 above still count"
else
    DAEMON_PORT=$((48000 + (RANDOM % 3000)))
    METHOD="$PY -c \"
import socket, os, sys, time
pid = os.fork()
if pid == 0:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', $DAEMON_PORT))
    s.listen(5)
    time.sleep(30)
else:
    sys.exit(0)
\""
    (
        export PORT="$DAEMON_PORT"
        exec "$GNU_TIMEOUT" 30 sh -c "$METHOD"
    ) &
    DAEMON_APP_PID=$!
    sleep 1.5
    DAEMON_LISTENER_PID="$(lsof -ti tcp:"$DAEMON_PORT" -sTCP:LISTEN 2>/dev/null | head -1)"

    if [ -z "$DAEMON_LISTENER_PID" ]; then
        bad "GNU-timeout daemonize setup did not bind its port (test setup broken, not the function under test)"
    else
        DAEMON_LISTENER_PGID="$(ps -o pgid= -p "$DAEMON_LISTENER_PID" 2>/dev/null | tr -d ' ')"
        DAEMON_LISTENER_PPID="$(ps -o ppid= -p "$DAEMON_LISTENER_PID" 2>/dev/null | tr -d ' ')"
        APP_STILL_ALIVE="no"; kill -0 "$DAEMON_APP_PID" 2>/dev/null && APP_STILL_ALIVE="yes"
        if [ "$DAEMON_LISTENER_PPID" != "1" ] || [ "$APP_STILL_ALIVE" = "yes" ] || [ "$DAEMON_LISTENER_PGID" != "$DAEMON_APP_PID" ]; then
            bad "GNU-timeout daemonize setup is wrong (listener_ppid=$DAEMON_LISTENER_PPID want 1; timeout_still_alive=$APP_STILL_ALIVE want no; listener_pgid=$DAEMON_LISTENER_PGID want $DAEMON_APP_PID) -- the assertion below would be vacuous"
        else
            ok "GNU-timeout daemonize setup reproduces the exact regression shape (listener orphaned to ppid=1, pgid still equals the exited timeout's own pid)"
            _verify_runtime_teardown "$DAEMON_APP_PID" "$DAEMON_PORT" ""
            sleep 0.5
            if kill -0 "$DAEMON_LISTENER_PID" 2>/dev/null; then
                bad "own daemon listener LEAKED by _verify_runtime_teardown -- the council round-2 regression is still present"
            else
                ok "own daemon listener (orphaned via GNU timeout daemonize) is reclaimed"
            fi
        fi
    fi
    kill -9 "$DAEMON_LISTENER_PID" 2>/dev/null || true
    kill -9 "$DAEMON_APP_PID" 2>/dev/null || true
fi

# --- T4: the round-4 regression. Case I's real fixture (test-runtime-gate.sh)
# uses Node's child_process.spawn({detached:true}), which calls setsid(): the
# daemon becomes its OWN session/process group leader (pgid == its own pid,
# ppid == 1), which T3's GNU-timeout fixture does NOT reproduce (there the
# daemon's pgid is still timeout's exited pid -- a DIFFERENT shape). None of
# the three pgid/ppid arms can ever match a genuinely setsid'd process, so
# T3's pass does not prove this case is covered, and indeed it was not: this
# was reported as a real, reproduced regression (case I red on every run)
# even after T3's fix landed and this file went green. The fourth arm closes
# it via LOKI_VERIFY_RUN_TOKEN, an env-var ownership proof that survives
# setsid() (env vars are inherited across fork/exec/setsid regardless of
# process-group changes). `setsid` (util-linux) does not exist on macOS, so
# each of the own-daemon and the decoy is given a genuine session via perl's
# POSIX::setsid() inside a subshell that exits immediately -- same technique
# used elsewhere in this file and in tests/test-kill-provider-child-scoping.sh.
PERL="$(command -v perl || true)"
if [ -z "$PERL" ]; then
    echo "SKIPPED: no perl (T1/T2/T3 above still count)"
else
    TOK_OWN="tok-own-$$-${RANDOM}-${RANDOM}"
    TOK_DECOY="tok-decoy-$$-${RANDOM}-${RANDOM}"
    OWN_PORT=$((60000 + (RANDOM % 3000)))
    # round-5 fix: 63000 + (RANDOM % 3000) can reach 65999, above 65535 (the
    # max valid TCP port) -- whenever RANDOM % 3000 >= 2536 (~15.5% of runs,
    # confirmed against the theoretical rate and reproduced deterministically
    # with a pinned out-of-range value), python3's socket.bind() raised an
    # uncaught OverflowError and the decoy process died immediately. Silent
    # (stderr was redirected to /dev/null), and NOT a timing issue: the perl
    # wrapper still wrote its pidfile before exec either way, so the wait loop
    # always broke fast regardless of outcome -- the earlier 4s/8s timing
    # widening never touched this failure mode at all. Narrowed to keep the
    # max at 64999, safely in range.
    DECOY_TOK_PORT=$((63000 + (RANDOM % 2500)))

    # Own daemon: genuinely setsid'd (own session+pgid, ppid=1), carries
    # TOK_OWN in its environment -- exactly what _verify_runtime_teardown's
    # launch site now exports as LOKI_VERIFY_RUN_TOKEN for a real run.
    # stderr goes to a per-fixture LOG file, not /dev/null: a silent
    # subprocess death (the port-overflow bug above) is otherwise invisible,
    # which is exactly what let that bug hide before. Surfaced below on setup
    # failure so any future silent death is diagnosable instead of swallowed.
    OWN_PIDFILE="$WORK/setsid_own.pid"
    OWN_LOG="$WORK/setsid_own.log"
    ( LOKI_VERIFY_RUN_TOKEN="$TOK_OWN" perl -e '
        use POSIX qw(setsid);
        setsid();
        open(my $f, ">", $ARGV[0]) or die $!;
        print $f $$;
        close $f;
        exec($ARGV[1], "-c", "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((\"127.0.0.1\", '"$OWN_PORT"'))
s.listen(5)
time.sleep(30)
");
    ' "$OWN_PIDFILE" "$PY" >"$OWN_LOG" 2>&1 & )
    i=0
    # 4s budget (matches every other decoy in this file). The round-4 comment
    # here previously claimed this needed widening to 8s for timing reasons;
    # round 5 found the real bug (a port-overflow OverflowError killing the
    # decoy outright, not a slow start) and confirmed via direct measurement
    # that the pidfile write itself takes ~0.1s -- the wait loop was never
    # the bottleneck. Reverted to 4s.
    while [ $i -lt 40 ]; do [ -s "$OWN_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
    OWN_TOK_PID=$(cat "$OWN_PIDFILE" 2>/dev/null || true)

    # Decoy: genuinely setsid'd too, listening on a DIFFERENT port, carrying a
    # DIFFERENT token -- must survive a teardown call scoped to TOK_OWN.
    DECOY_PIDFILE="$WORK/setsid_decoy.pid"
    DECOY_LOG="$WORK/setsid_decoy.log"
    ( LOKI_VERIFY_RUN_TOKEN="$TOK_DECOY" perl -e '
        use POSIX qw(setsid);
        setsid();
        open(my $f, ">", $ARGV[0]) or die $!;
        print $f $$;
        close $f;
        exec($ARGV[1], "-c", "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((\"127.0.0.1\", '"$DECOY_TOK_PORT"'))
s.listen(5)
time.sleep(30)
");
    ' "$DECOY_PIDFILE" "$PY" >"$DECOY_LOG" 2>&1 & )
    i=0
    while [ $i -lt 40 ]; do [ -s "$DECOY_PIDFILE" ] && break; sleep 0.1; i=$((i+1)); done
    DECOY_TOK_PID=$(cat "$DECOY_PIDFILE" 2>/dev/null || true)

    if [ -z "$OWN_TOK_PID" ] || ! kill -0 "$OWN_TOK_PID" 2>/dev/null \
       || [ -z "$DECOY_TOK_PID" ] || ! kill -0 "$DECOY_TOK_PID" 2>/dev/null; then
        bad "setsid own/decoy token fixtures did not start or died immediately (test setup broken, not the function under test) -- own_log: $(cat "$OWN_LOG" 2>/dev/null | tr '\n' ' '); decoy_log: $(cat "$DECOY_LOG" 2>/dev/null | tr '\n' ' ')"
    else
        OWN_TOK_PGID="$(ps -o pgid= -p "$OWN_TOK_PID" 2>/dev/null | tr -d ' ')"
        OWN_TOK_PPID="$(ps -o ppid= -p "$OWN_TOK_PID" 2>/dev/null | tr -d ' ')"
        if [ "$OWN_TOK_PPID" != "1" ] || [ "$OWN_TOK_PGID" != "$OWN_TOK_PID" ]; then
            bad "own-daemon setsid setup is wrong (ppid=$OWN_TOK_PPID want 1; pgid=$OWN_TOK_PGID want $OWN_TOK_PID) -- the assertion below would be vacuous"
        else
            ok "own-daemon is genuinely setsid'd (pgid equals its own pid, ppid=1) -- the exact shape none of the first three arms can match"
        fi
        if ! lsof -ti tcp:"$OWN_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$OWN_TOK_PID"; then
            bad "positive control failed: lsof cannot enumerate the setsid own-daemon listener"
        else
            ok "positive control: lsof enumerates the setsid own-daemon listener before teardown"
            # app_pid does not matter for the token arm; pass a fake, dead PID
            # to prove the first three arms cannot be what reclaims this.
            _verify_runtime_teardown 999999 "$OWN_PORT" "" "$TOK_OWN"
            sleep 0.5
            if kill -0 "$OWN_TOK_PID" 2>/dev/null; then
                bad "own-daemon setsid listener LEAKED -- the round-4 regression is still present"
            else
                ok "own-daemon setsid listener (carrying the run token) is reclaimed by the fourth arm"
            fi
        fi
        if ! lsof -ti tcp:"$DECOY_TOK_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$DECOY_TOK_PID"; then
            bad "positive control failed: lsof cannot enumerate the setsid decoy listener"
        else
            ok "positive control: lsof enumerates the setsid decoy listener before teardown"
            _verify_runtime_teardown 999999 "$DECOY_TOK_PORT" "" "$TOK_OWN"
            sleep 0.5
            if kill -0 "$DECOY_TOK_PID" 2>/dev/null; then
                ok "setsid decoy carrying a DIFFERENT token survives a teardown scoped to the own token"
            else
                bad "setsid decoy with a different token was KILLED -- the fourth arm is not scoped to the exact token"
            fi
        fi
    fi
    kill -9 "$OWN_TOK_PID" 2>/dev/null || true
    kill -9 "$DECOY_TOK_PID" 2>/dev/null || true
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
