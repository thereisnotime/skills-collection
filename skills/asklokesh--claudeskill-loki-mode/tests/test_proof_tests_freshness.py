"""S-176 (BACKLOG 98): the proof headline must not read a stale test-results.json.

_collect_tests feeds facts.tests and the headline. A test-results.json whose
.test-results.iter marker names an earlier iteration than ITERATION_COUNT is
not this run's evidence and must read as not_run, except a stale failure,
which stays failed. A matching marker keeps the recorded status, and
ITERATION_COUNT unset keeps the pre-82 reading.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_GENERATOR = os.path.join(_REPO, "autonomy", "lib", "proof-generator.py")


class ProofTestsFreshness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-proof-fresh-")
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(self.proj)

        def git(*a):
            return subprocess.run(
                ["git", "-C", self.proj, "-c", "user.email=t@t.test",
                 "-c", "user.name=tester"] + list(a),
                capture_output=True, text=True, check=True)
        git("init")
        with open(os.path.join(self.proj, "a.txt"), "w") as f:
            f.write("one\n")
        git("add", "a.txt")
        git("commit", "-m", "init")
        self.base = git("rev-parse", "HEAD").stdout.strip()
        with open(os.path.join(self.proj, "a.txt"), "w") as f:
            f.write("one\ntwo\n")
        git("add", "a.txt")
        git("commit", "-m", "second")

        self.loki = os.path.join(self.proj, ".loki")
        q = os.path.join(self.loki, "quality")
        os.makedirs(q)
        with open(os.path.join(q, "test-results.json"), "w") as f:
            json.dump({"runner": "pytest", "command": "pytest -q",
                       "exit_code": 0, "status": "verified",
                       "passed_count": 10, "failed_count": 0}, f)
        with open(os.path.join(q, "build-results.json"), "w") as f:
            json.dump({"command": "make build", "ran": True, "exit_code": 0,
                       "duration_sec": 1.0}, f)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, marker, iteration):
        if marker is not None:
            with open(os.path.join(self.loki, "quality", ".test-results.iter"),
                      "w") as f:
                f.write(marker + "\n")
        out = os.path.join(self.tmp, "out-%s-%s" % (marker, iteration))
        env = dict(os.environ)
        for k in ("PRD_PATH", "LOKI_SESSION_ID", "LOKI_DEPLOYED_URL",
                  "ITERATION_COUNT"):
            env.pop(k, None)
        env["_LOKI_RUN_START_SHA"] = self.base
        if iteration is not None:
            env["ITERATION_COUNT"] = iteration
        r = subprocess.run(
            [sys.executable, _GENERATOR, "--loki-dir", self.loki,
             "--out-dir", out, "--run-id", "fresh-001",
             "--loki-version", "10.0.0", "--quiet"],
            capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "proof.json")) as f:
            return json.load(f)

    def test_fresh_marker_keeps_verified(self):
        d = self._run("5", "5")
        self.assertEqual(d["facts"]["tests"]["status"], "verified")
        self.assertEqual(d["honesty"]["headline"], "VERIFIED")

    def test_stale_marker_reads_not_run(self):
        fresh = self._run("5", "5")["honesty"]["headline"]
        d = self._run("4", "5")
        self.assertEqual(d["facts"]["tests"]["status"], "not_run")
        self.assertNotEqual(d["honesty"]["headline"], fresh)
        self.assertNotEqual(d["honesty"]["headline"], "VERIFIED")

    def test_missing_marker_in_loop_reads_not_run(self):
        d = self._run(None, "5")
        self.assertEqual(d["facts"]["tests"]["status"], "not_run")

    def test_stale_failure_still_reads_failed(self):
        # An earlier red is never discarded: staleness only blocks a green.
        with open(os.path.join(self.loki, "quality", "test-results.json"),
                  "w") as f:
            json.dump({"runner": "pytest", "command": "pytest -q",
                       "exit_code": 1, "status": "failed"}, f)
        d = self._run("4", "5")
        self.assertEqual(d["facts"]["tests"]["status"], "failed")
        self.assertEqual(d["honesty"]["headline"], "NOT VERIFIED")

    def test_iteration_unset_keeps_reading(self):
        d = self._run("4", None)
        self.assertEqual(d["facts"]["tests"]["status"], "verified")


if __name__ == "__main__":
    unittest.main()
