"""get_current_version must not lie about why there is no real version.

THE BUG (BACKLOG 118). Both "no version file has ever been written" and "the
version file exists but is corrupt" returned the exact same default:
{"version": 0, "based_on_sessions": 0, ...}. A corrupt latest.json (disk
truncation, a bad write, a schema change) silently read as "never ran" --
zeros that looked like a normal fresh-install state, not a data problem
worth investigating.

THE FIX. A missing file returns an explicit never-ran marker with null
fields (status "never_ran"). A file that exists but fails to parse returns
a distinct error marker (status "error"), also null fields, never a fake
zero. A valid file still returns its real values untouched.

Also covers the one internal caller this touches: PromptOptimizer.optimize()
computed `current_version + 1` from the same field, which would crash
(`None + 1`, TypeError) once version stopped defaulting to 0.
"""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from dashboard.prompt_optimizer import PromptOptimizer  # noqa: E402


class PromptOptimizerSentinelsTest(unittest.TestCase):
    def test_missing_file_is_never_ran_with_nulls(self):
        with tempfile.TemporaryDirectory() as tmp:
            opt = PromptOptimizer(data_dir=tmp)
            result = opt.get_current_version()

        self.assertEqual(result["status"], "never_ran")
        self.assertIsNone(result["version"])
        self.assertIsNone(result["generated_at"])
        self.assertIsNone(result["based_on_sessions"])
        self.assertIsNone(result["failures_analyzed"])
        self.assertEqual(result["changes"], [])

    def test_corrupt_file_is_error_not_never_ran(self):
        with tempfile.TemporaryDirectory() as tmp:
            opt = PromptOptimizer(data_dir=tmp)
            latest = pathlib.Path(tmp) / "prompts" / "optimized" / "latest.json"
            latest.parent.mkdir(parents=True, exist_ok=True)
            latest.write_text("{not valid json", encoding="utf-8")

            result = opt.get_current_version()

        self.assertEqual(result["status"], "error")
        self.assertNotEqual(result["status"], "never_ran")
        self.assertIsNone(result["version"])
        self.assertIsNone(result["generated_at"])

    def test_valid_file_returns_real_values_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            opt = PromptOptimizer(data_dir=tmp)
            latest = pathlib.Path(tmp) / "prompts" / "optimized" / "latest.json"
            latest.parent.mkdir(parents=True, exist_ok=True)
            real = {
                "version": 3,
                "generated_at": "2026-09-27T00:00:00+00:00",
                "based_on_sessions": 10,
                "failures_analyzed": 2,
                "changes": [{"agent_type": "test_engineer", "description": "x"}],
            }
            latest.write_text(json.dumps(real), encoding="utf-8")

            result = opt.get_current_version()

        self.assertEqual(result["version"], 3)
        self.assertEqual(result["based_on_sessions"], 10)
        self.assertNotIn("status", result)  # a real file has no sentinel status

    def test_optimize_does_not_crash_when_never_ran(self):
        # Regression for the internal caller: current_version + 1 used to
        # crash (TypeError: NoneType + int) once version stopped defaulting
        # to 0. total_failures must be > 0 to reach the increment path.
        with tempfile.TemporaryDirectory() as tmp:
            opt = PromptOptimizer(data_dir=tmp)
            opt._extractor.extract = lambda sessions=10: {
                "total_failures": 1,
                "session_count": 1,
                "failures": [{"type": "timeout", "count": 1, "message": "x"}],
            }

            result = opt.optimize(sessions=1, dry_run=True)

        self.assertEqual(result["version"], 1)


if __name__ == "__main__":
    unittest.main()
