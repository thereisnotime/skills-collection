"""tests/test_checklist_verify_tests_pass.py

wave-7 trust gate: autonomy/checklist-verify.py run_check(tests_pass).

A tests_pass checklist item REQUIRES that test verification actually ran. The
jest invocation uses --passWithNoTests, so a zero-match pattern exits 0 with
"No tests found ..." -- which would be a fake-green (a required verification
reporting SUCCESS with no test executed). pytest exits 5 when it collects no
tests. These tests prove the no-test signal now fails the check, while a real
passing run still passes and a real failing run still fails.

The check function is exercised directly with subprocess.run monkeypatched so
the test does not require jest/pytest to be installed in the project dir.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path


def _load_module():
    here = Path(__file__).resolve().parent.parent
    path = here / "autonomy" / "checklist-verify.py"
    spec = importlib.util.spec_from_file_location("loki_checklist_verify", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _FakeCompleted:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class TestsPassTrustGate(unittest.TestCase):
    def setUp(self):
        self.mod = _load_module()
        self.tmp = tempfile.mkdtemp(prefix="loki-checklist-")
        self._orig_run = subprocess.run

    def tearDown(self):
        subprocess.run = self._orig_run
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make_jest_project(self):
        # A package.json WITH a declared scripts.test routes run_check to the
        # project's own runner via `npm test` (runner-agnostic). The command
        # string is irrelevant here because subprocess.run is monkeypatched; only
        # the presence of scripts.test matters for routing.
        with open(os.path.join(self.tmp, "package.json"), "w") as f:
            f.write('{"name": "x", "scripts": {"test": "jest"}}')

    def _make_no_test_script_project(self):
        # package.json but NO scripts.test -> nothing declared to run.
        with open(os.path.join(self.tmp, "package.json"), "w") as f:
            f.write('{"name": "x"}')

    def _patch_run(self, completed):
        def fake_run(cmd, **kwargs):
            self._last_cmd = cmd
            return completed
        subprocess.run = fake_run

    def _check(self, pattern="src"):
        return self.mod.run_check(
            {"type": "tests_pass", "pattern": pattern},
            project_dir=self.tmp,
            timeout=30,
        )

    # ---- jest fake-green: exit 0 but "No tests found" -> must FAIL ----------

    def test_jest_no_tests_found_fails(self):
        self._make_jest_project()
        # Real jest --passWithNoTests output on a zero-match pattern.
        self._patch_run(_FakeCompleted(
            returncode=0,
            stderr="No tests found, exiting with code 0\n"
                   "Pattern: nomatch - 0 matches",
        ))
        result = self._check(pattern="nomatch")
        self.assertFalse(
            result["passed"],
            "tests_pass must NOT report success when no test was discovered",
        )
        self.assertIn("No tests discovered", result["output"])

    def test_jest_real_pass_still_passes(self):
        self._make_jest_project()
        self._patch_run(_FakeCompleted(
            returncode=0,
            stdout="Tests: 3 passed, 3 total\nTest Suites: 1 passed, 1 total",
        ))
        result = self._check()
        self.assertTrue(result["passed"])

    def test_jest_real_failure_still_fails(self):
        self._make_jest_project()
        self._patch_run(_FakeCompleted(
            returncode=1,
            stdout="Tests: 1 failed, 2 passed, 3 total",
        ))
        result = self._check()
        self.assertFalse(result["passed"])

    # ---- pytest path: exit code 5 = no tests collected -> must FAIL ---------

    def test_pytest_no_tests_collected_fails(self):
        # No package.json -> pytest command path.
        self._patch_run(_FakeCompleted(
            returncode=5,
            stdout="no tests ran in 0.01s",
        ))
        result = self._check()
        self.assertFalse(
            result["passed"],
            "pytest exit 5 (no tests collected) must fail the required check",
        )

    def test_pytest_real_pass_still_passes(self):
        self._patch_run(_FakeCompleted(
            returncode=0,
            stdout="3 passed in 0.05s",
        ))
        result = self._check()
        self.assertTrue(result["passed"])

    # ---- runner-agnostic: vitest / no-script / non-jest runners --------------

    def test_vitest_no_test_files_found_fails(self):
        # vitest prints "No test files found, exiting with code 1". Even though
        # rc!=0 already fails, the no-tests gate must catch it explicitly so a
        # runner that exits 0 on an empty run (a mismatched filter) is caught too.
        self._make_jest_project()  # scripts.test present -> npm test path
        self._patch_run(_FakeCompleted(
            returncode=1,
            stderr="No test files found, exiting with code 1"))
        result = self._check()
        self.assertFalse(
            result["passed"],
            "vitest 'No test files found' must fail the required check (no fake-green)")
        self.assertIn("No tests discovered", result["output"])

    def test_vitest_real_pass_passes(self):
        # A real vitest run: "Test Files 1 passed (1) / Tests 26 passed (26)", rc0.
        self._make_jest_project()
        self._patch_run(_FakeCompleted(
            returncode=0,
            stdout="Test Files  1 passed (1)\n      Tests  26 passed (26)"))
        result = self._check()
        self.assertTrue(result["passed"], "a real passing vitest run must pass")

    def test_noop_test_script_is_inconclusive_not_green(self):
        # FAKE-GREEN GUARD (council-found): a no-op scripts.test (`echo done`,
        # `exit 0`, `true`, `:`) exits rc=0 having run ZERO tests. rc==0 alone is
        # NOT proof of a passing test run -- passing it green would be a fake-green
        # (a required verification green with nothing tested). Without a positive
        # "N passed" runner signal the result MUST be inconclusive (None), never
        # True. (Also not False -- that would fake-RED an exotic passing runner.)
        self._make_jest_project()  # scripts.test present -> npm test path
        self._patch_run(_FakeCompleted(returncode=0, stdout="done\n", stderr=""))
        result = self._check()
        self.assertIsNone(
            result["passed"],
            "rc=0 with no 'N passed' signal must be inconclusive, never green")
        self.assertIn("no recognisable", result["output"].lower())

    def test_rc0_with_passed_signal_is_true(self):
        # The other side of the guard: rc=0 WITH a real "N passed" signal -> True.
        self._make_jest_project()
        self._patch_run(_FakeCompleted(
            returncode=0, stdout="Tests: 7 passed, 7 total"))
        result = self._check()
        self.assertTrue(result["passed"], "rc=0 with 'N passed' proof must pass")

    def test_zero_count_pass_signal_is_inconclusive_not_green(self):
        # ZERO-COUNT FAKE-GREEN GUARD (council-found): a runner can print a pass
        # line with count 0 on rc=0 with ZERO tests run -- mocha over an empty
        # describe prints "0 passing"; node:test "# pass 0". A bare \d+ would
        # match and read True = fake-green. The count must be >=1, so a zero
        # count -> inconclusive None, never green.
        self._make_jest_project()
        for zero_out in ("0 passing (1ms)", "Tests: 0 passed, 0 total",
                         "Tests  0 passed (0)", "# pass 0", "0 passed in 0.01s"):
            self._patch_run(_FakeCompleted(returncode=0, stdout=zero_out))
            result = self._check()
            self.assertIsNone(
                result["passed"],
                f"a zero-count pass line ({zero_out!r}) must be inconclusive, "
                "never green (zero tests ran)")

    def test_package_json_without_test_script_is_inconclusive(self):
        # package.json but NO scripts.test: nothing declared to run. Must be
        # INCONCLUSIVE (None), NOT a hardcoded-runner guess (that was the fake-RED
        # -- guessing `npx jest` on a vitest/mocha project) and NOT False (we did
        # not run and fail; we had nothing to run).
        self._make_no_test_script_project()
        # subprocess.run must NOT even be called; make it explode if it is.
        def _boom(*a, **k):
            raise AssertionError("must not invoke a runner when no scripts.test")
        subprocess.run = _boom
        result = self._check()
        self.assertIsNone(
            result["passed"],
            "package.json without scripts.test is inconclusive, never a guess")
        self.assertIn("scripts.test", result["output"])


class GrepCodebaseErrorInconclusiveGate(unittest.TestCase):
    """#142 trust gate: a grep_codebase check whose grep ERRORS (returncode >= 2:
    bad regex, or a grep variant like macOS ugrep that rejects a pattern GNU grep
    accepts) must be INCONCLUSIVE (passed=None), NEVER a hard False.

    Collapsing a grep ERROR to False is a fake-RED: it marks a genuinely-present
    endpoint 'failing' -> the completion council hard-gate blocks a CORRECT build
    forever. Observed live: an LLM-emitted pattern `app\\.get\\('/api/tasks'` made
    ugrep error 'parentheses not balanced' (returncode 2), so 3 working endpoints
    read 'failing' -> a 64-minute non-converging build (issue #124). A clean
    returncode 1 (real no-match) stays an honest False; returncode 0 stays True.
    """

    def setUp(self):
        self.mod = _load_module()
        self.tmp = tempfile.mkdtemp()
        self._orig_run = subprocess.run

    def tearDown(self):
        subprocess.run = self._orig_run
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _patch_run(self, completed):
        def fake_run(cmd, **kwargs):
            return completed
        subprocess.run = fake_run

    def _grep(self, pattern="app.get"):
        return self.mod.run_check(
            {"type": "grep_codebase", "pattern": pattern},
            project_dir=self.tmp,
            timeout=30,
        )

    def _patch_run_seq(self, *completeds):
        # Return completeds[0] for the first grep call (regex), completeds[1] for
        # the second (fixed-string retry after a regex error).
        calls = {"n": 0}
        seq = list(completeds)

        def fake_run(cmd, **kwargs):
            i = min(calls["n"], len(seq) - 1)
            calls["n"] += 1
            return seq[i]
        subprocess.run = fake_run

    def test_grep_regex_error_but_present_recovers_to_true(self):
        # rc=2 (ugrep 'parentheses not balanced') on a PRESENT endpoint: the
        # fixed-string retry finds it -> True. This is the #142 fake-RED fix AND
        # closes the council's absent-and-error hole by recovering real signal.
        self._patch_run_seq(
            _FakeCompleted(returncode=2, stdout="", stderr="grep: parentheses not balanced"),
            _FakeCompleted(returncode=0, stdout="src/app.js\n"))
        result = self._grep(pattern=r"app\.get\('/api/tasks'")
        self.assertTrue(
            result["passed"],
            "a regex error on a PRESENT pattern must recover to True via the "
            "fixed-string retry, not read failing (the #142 fake-RED)")
        self.assertIn("fixed-string retry", result["output"])

    def test_grep_regex_error_then_literal_absent_is_inconclusive(self):
        # If the -E PRIMARY errors (rc=2) AND the -F literal retry finds nothing
        # (rc=1), the result is INCONCLUSIVE (None), NOT False. Rationale: once
        # -E failed to parse the pattern, an escape-stripped literal-absent cannot
        # tell "present only via a regex quantifier" (should be green) from
        # "genuinely absent" -- so False here would be a fake-RED. None -> pending
        # (never blocks). A genuinely-absent endpoint is instead caught by the -E
        # primary's honest rc=1 -> False (see the real-grep tests below), so the
        # moat is preserved WITHOUT risking a false block on this ambiguous path.
        self._patch_run_seq(
            _FakeCompleted(returncode=2, stdout="", stderr="grep: parentheses not balanced"),
            _FakeCompleted(returncode=1, stdout=""))
        result = self._grep(pattern=r"app\.get\('/api/NONEXISTENT'")
        self.assertIsNone(
            result["passed"],
            "a regex-parse error + literal-absent is ambiguous -> inconclusive, "
            "never a hard False (that would be a narrowed fake-RED)")

    def test_grep_error_unrecoverable_is_inconclusive(self):
        # If BOTH the regex and the fixed-string retry error (rc>=2 twice: e.g.
        # unreadable files, not a pattern problem), it is genuinely inconclusive
        # (None) -- a grep that could not run has not proven absence.
        self._patch_run_seq(
            _FakeCompleted(returncode=2, stderr="grep: permission denied"),
            _FakeCompleted(returncode=2, stderr="grep: permission denied"))
        result = self._grep(pattern=r"any\(thing")
        self.assertIsNone(
            result["passed"],
            "an unrecoverable grep error (both attempts fail) is inconclusive")
        self.assertIn("unrecoverable", result["output"])

    def test_grep_present_as_regex_quantifier_is_true(self):
        # REAL-GREP (not mocked): a pattern that matches ONLY as a regex, via a
        # quantifier -- app\.get\(.*tasks -- against a file that contains
        # app.get('/api/tasks'. Under the BRE default this errored (unbalanced
        # paren) AND -F would false-negate (literal .* absent) = a fake-RED. The
        # -E primary must MATCH it (True). This is the case the mocked tests miss.
        src = os.path.join(self.tmp, "app.js")
        with open(src, "w") as f:
            f.write("const app = express();\napp.get('/api/tasks', (req,res)=>res.json([]));\n")
        result = self.mod.run_check(
            {"type": "grep_codebase", "pattern": r"app\.get\(.*tasks"},
            project_dir=self.tmp, timeout=30)
        self.assertTrue(
            result["passed"],
            "a pattern present-as-regex (quantifier) must be True under -E, not "
            "a fake-RED from BRE-error + literal -F miss")

    def test_grep_escaped_paren_present_is_true(self):
        # REAL-GREP: the exact #142 live pattern app\.get\('/api/tasks' against a
        # present endpoint. Under BRE this errored (rc=2 fake-RED); under -E the
        # \( is a literal paren -> clean match -> True.
        src = os.path.join(self.tmp, "app.js")
        with open(src, "w") as f:
            f.write("app.get('/api/tasks', (req,res)=>res.json([]));\n")
        result = self.mod.run_check(
            {"type": "grep_codebase", "pattern": r"app\.get\('/api/tasks'"},
            project_dir=self.tmp, timeout=30)
        self.assertTrue(result["passed"], "the exact #142 live pattern must match present code under -E")

    def test_grep_escaped_paren_absent_is_false(self):
        # REAL-GREP: same escaped-paren pattern but the endpoint is ABSENT -> an
        # honest False under -E (moat: a genuinely-missing endpoint still blocks).
        src = os.path.join(self.tmp, "app.js")
        with open(src, "w") as f:
            f.write("app.get('/api/other', (req,res)=>res.json([]));\n")
        result = self.mod.run_check(
            {"type": "grep_codebase", "pattern": r"app\.get\('/api/NONEXISTENT'"},
            project_dir=self.tmp, timeout=30)
        self.assertFalse(result["passed"], "a genuinely-absent endpoint must stay False (block), not recover green")

    def test_grep_no_match_stays_false(self):
        # returncode 1 = clean 'not found' -> an honest False (moat: a genuinely
        # absent pattern must NOT sneak to inconclusive/green).
        self._patch_run(_FakeCompleted(returncode=1, stdout=""))
        result = self._grep()
        self.assertFalse(result["passed"])
        self.assertIn("0 file", result["output"])

    def test_grep_match_stays_true(self):
        self._patch_run(_FakeCompleted(returncode=0, stdout="src/app.js\n"))
        result = self._grep()
        self.assertTrue(result["passed"])
        self.assertIn("1 file", result["output"])


if __name__ == "__main__":
    unittest.main()
