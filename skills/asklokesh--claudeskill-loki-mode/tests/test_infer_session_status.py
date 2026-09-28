"""_infer_session_status must not guess "completed" without a real signal.

S-46 / BACKLOG 115: a failed or paused run whose state file happened to be
5+ minutes old, or a directory that merely contained a source file, used to
be reported as "completed". Both are guesses presented as certainty. This
covers the three cases the slice calls out:

  1. a genuinely completed run (a real completion marker) -> "completed"
  2. a paused/failed run whose state file is old -> NOT "completed"
  3. a directory with only a source file, no other signal -> NOT "completed"
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
import tempfile
import time
import unittest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SERVER_PY = _ROOT / "web-app" / "server.py"

_STALE_SECONDS = 301  # just past the 5-minute freshness window


def _load_infer_session_status():
    spec = importlib.util.spec_from_file_location("_web_app_server", _SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod._infer_session_status


_infer_session_status = _load_infer_session_status()


def _backdate(path: pathlib.Path, seconds_ago: float) -> None:
    old = time.time() - seconds_ago
    os.utime(path, (old, old))


class InferSessionStatusTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.entry = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _write_dashboard_state(self, phase: str, seconds_old: float = 0):
        loki_dir = self.entry / ".loki"
        loki_dir.mkdir(parents=True, exist_ok=True)
        state_file = loki_dir / "dashboard-state.json"
        state_file.write_text('{"phase": "%s"}' % phase)
        if seconds_old:
            _backdate(state_file, seconds_old)

    def _write_autonomy_state(self, status: str, seconds_old: float = 0):
        state_file = self.entry / "autonomy-state.json"
        state_file.write_text('{"status": "%s"}' % status)
        if seconds_old:
            _backdate(state_file, seconds_old)

    # -- 1. genuinely completed --------------------------------------------

    def test_fresh_completed_phase_reports_completed(self):
        self._write_dashboard_state("completed")
        self.assertEqual(_infer_session_status(self.entry), "completed")

    def test_stale_completed_phase_still_reports_completed(self):
        # A real completion marker is trustworthy regardless of age -- the
        # run finished and nothing will touch the file again.
        self._write_dashboard_state("completed", seconds_old=_STALE_SECONDS)
        self.assertEqual(_infer_session_status(self.entry), "completed")

    def test_autonomy_state_completed_flag_reports_completed(self):
        state_file = self.entry / "autonomy-state.json"
        state_file.write_text('{"completed": true}')
        _backdate(state_file, _STALE_SECONDS)
        self.assertEqual(_infer_session_status(self.entry), "completed")

    # -- 2. paused/failed run whose state file is merely old -----------------

    def test_stale_paused_phase_is_not_completed(self):
        self._write_dashboard_state("paused", seconds_old=_STALE_SECONDS)
        status = _infer_session_status(self.entry)
        self.assertNotEqual(status, "completed")
        self.assertEqual(status, "paused")

    def test_stale_failed_phase_is_not_completed(self):
        self._write_dashboard_state("failed", seconds_old=_STALE_SECONDS)
        status = _infer_session_status(self.entry)
        self.assertNotEqual(status, "completed")
        self.assertEqual(status, "failed")

    def test_stale_active_phase_is_unknown_not_completed(self):
        # An active-looking phase (a RARV step) that has simply gone quiet is
        # not evidence of a clean finish -- it must not be reported as
        # completed, and it must not keep claiming to be actively running.
        self._write_dashboard_state("ACT", seconds_old=_STALE_SECONDS)
        status = _infer_session_status(self.entry)
        self.assertNotEqual(status, "completed")
        self.assertEqual(status, "unknown")

    def test_stale_in_progress_autonomy_status_is_unknown_not_completed(self):
        self._write_autonomy_state("in_progress", seconds_old=_STALE_SECONDS)
        status = _infer_session_status(self.entry)
        self.assertNotEqual(status, "completed")
        self.assertEqual(status, "unknown")

    def test_fresh_active_phase_still_reports_live_phase(self):
        # Sanity check: freshness still trusts an active phase verbatim, so
        # the fix does not regress the live/running case.
        self._write_dashboard_state("ACT", seconds_old=0)
        self.assertEqual(_infer_session_status(self.entry), "ACT")

    # -- 3. directory with only a source file, no other signal --------------

    def test_bare_source_file_is_not_completed(self):
        (self.entry / "index.py").write_text("print('hello')\n")
        status = _infer_session_status(self.entry)
        self.assertNotEqual(status, "completed")
        self.assertEqual(status, "unknown")

    def test_empty_directory_is_empty(self):
        self.assertEqual(_infer_session_status(self.entry), "empty")

    def test_prd_only_is_started(self):
        (self.entry / "PRD.md").write_text("# Spec\n")
        self.assertEqual(_infer_session_status(self.entry), "started")


if __name__ == "__main__":
    unittest.main()
