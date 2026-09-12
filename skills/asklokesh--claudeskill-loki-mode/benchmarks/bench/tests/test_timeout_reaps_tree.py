#!/usr/bin/env python3
"""A timed-out adapter run must kill the whole process tree, not just the child.

THE DEFECT, measured: `subprocess.run(timeout=...)` kills only the process it
spawned. `loki start` re-execs as /tmp/loki-run-*.sh and spawns its own
descendants, so a timed-out bench cell left that tree ALIVE. A stopped matrix
leaked SEVEN live loki-bench-loki-* runs that survived more than an hour, kept
holding provider capacity, starved later trials into their own 600s timeouts,
and made clean verification runs look like they "died immediately".

A timeout that does not reap manufactures the very failure it reports: the next
trial times out because the last one is still running.

WHAT IS LOAD-BEARING: the GRANDCHILD must die. A test that only checks the
direct child would have passed against the buggy code -- subprocess.run did
always kill that one. The grandchild is the whole defect, so it is what is
asserted here, by PID, after the timeout returns.

Run: python3 -m pytest benchmarks/bench/tests/test_timeout_reaps_tree.py -q
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adapters import _base  # noqa: E402


def _alive(pid):
    """True while pid exists. Signal 0 checks existence without delivering."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _spawn_parent_with_grandchild(tmpdir):
    """A shell that backgrounds a long-lived grandchild and writes its PID.

    This mirrors the real shape: `loki start` (child) spawns /tmp/loki-run-*.sh
    (grandchild) which outlives a naive child-only kill.
    """
    pidfile = os.path.join(tmpdir, "grandchild.pid")
    # A UNIQUELY NAMED sleeper. A bare `sleep 300` is indistinguishable from
    # the sleeps a real loki run uses internally, and a cleanup matching that
    # pattern killed a live verification run mid-review. The marker argument
    # makes this fixture's processes addressable without collateral damage.
    script = (
        "sh -c 'exec -a loki-bench-test-sleeper sleep 300' & echo $! > %s; "
        "sleep 300"
    ) % pidfile
    return ["sh", "-c", script], pidfile


def test_timeout_kills_the_grandchild(tmp_path):
    cmd, pidfile = _spawn_parent_with_grandchild(str(tmp_path))

    rc, out, err, status, duration = _base.run_cli(
        cmd, cwd=str(tmp_path), timeout=2
    )

    assert status == "timeout", "expected a timeout, got %r" % status
    assert rc == 124, "timeout must report rc=124, got %r" % rc

    # The grandchild PID is written by the shell before it sleeps. If the file
    # never appeared the fixture did not reproduce the shape under test, and a
    # passing assertion below would be vacuous.
    deadline = time.time() + 5
    while time.time() < deadline and not os.path.exists(pidfile):
        time.sleep(0.05)
    assert os.path.exists(pidfile), "fixture never spawned a grandchild"
    gc_pid = int(open(pidfile).read().strip())

    # Give the reaper a moment; SIGKILL is delivered after a TERM grace period.
    deadline = time.time() + 10
    while time.time() < deadline and _alive(gc_pid):
        time.sleep(0.1)

    assert not _alive(gc_pid), (
        "grandchild %d survived the timeout: the process tree was not reaped, "
        "so it keeps holding provider capacity and starves the next trial"
        % gc_pid
    )


def test_injected_runner_still_works(tmp_path):
    """The mock path must be untouched: tests inject a subprocess.run-compatible
    fake, and it must not be handed kwargs it does not accept."""
    calls = {}

    class FakeProc:
        returncode = 0
        stdout = "ok"
        stderr = ""

    def fake_runner(cmd, **kwargs):
        calls["kwargs"] = kwargs
        return FakeProc()

    rc, out, err, status, duration = _base.run_cli(
        ["anything"], cwd=str(tmp_path), timeout=5, runner=fake_runner
    )

    assert rc == 0 and out == "ok" and status == "completed"
    assert "start_new_session" not in calls["kwargs"], (
        "the injected fake was handed start_new_session; a subprocess.run-"
        "compatible mock does not accept it and would raise"
    )


def test_normal_completion_is_unaffected(tmp_path):
    """A run that finishes inside the timeout must behave exactly as before."""
    rc, out, err, status, duration = _base.run_cli(
        [sys.executable, "-c", "print('hello')"], cwd=str(tmp_path), timeout=30
    )
    assert rc == 0, "clean run returned rc=%r (%s)" % (rc, err)
    assert "hello" in out
    assert status == "completed"
