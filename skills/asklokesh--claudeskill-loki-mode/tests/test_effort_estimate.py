"""tests/test_effort_estimate.py -- per-build effort_estimate in proof.json (Rank 6).

Proves the engineering-hours estimator that rides the proof/evidence rail:

  1. No LLM (headless CI / offline) -> proof.json.effort_estimate exists with
     method == "heuristic", hours/low/high present, inputs_hash present, and it
     is labeled uncalibrated. (RED against the pre-change generator: no
     effort_estimate key at all.)
  2. AC#3: two builds of CLEARLY different scope yield MATERIALLY different
     hours. The old iterations x 15 heuristic gave both the same 30min; the
     work-based estimator must not.
  3. Determinism: identical inputs -> byte-identical estimate (hash + hours).
  4. inputs_hash matches an independent recomputation over the canonical inputs.
  5. LLM path is gated + honest: it flips to method == "llm" ONLY when both the
     opt-in flag AND a parseable model number are present; with the flag off it
     stays "heuristic"; with the flag on but unparseable output it FAILS OPEN to
     "heuristic" and NEVER fabricates method == "llm".

The generator is invoked as a subprocess (its filename has a hyphen so it is
not importable), matching how run.sh calls it. The estimator module is also
imported directly for the pure-unit determinism/hash checks.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_GENERATOR = os.path.join(_REPO, "autonomy", "lib", "proof-generator.py")
_LIB = os.path.join(_REPO, "autonomy", "lib")


def _load_estimator():
    spec = importlib.util.spec_from_file_location(
        "effort_estimator", os.path.join(_LIB, "effort_estimator.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True,
                       text=True, timeout=30)
    return r


def _init_repo_with_change(workdir, files):
    """Create a git repo, commit a baseline, then apply `files` (path->content)
    as a second commit so `git diff HEAD~1 HEAD` reflects real work.
    files values with more lines produce a bigger diff stat.
    """
    _git(workdir, "init", "-q")
    _git(workdir, "config", "user.email", "t@t.t")
    _git(workdir, "config", "user.name", "t")
    with open(os.path.join(workdir, "README.md"), "w") as f:
        f.write("baseline\n")
    _git(workdir, "add", "-A")
    _git(workdir, "commit", "-q", "-m", "baseline")
    for rel, content in files.items():
        full = os.path.join(workdir, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True) if os.path.dirname(rel) else None
        with open(full, "w") as f:
            f.write(content)
    _git(workdir, "add", "-A")
    _git(workdir, "commit", "-q", "-m", "change")


def _seed_loki(loki_dir, *, brief="Build a thing.", tests_status="verified",
               n_iters=2):
    os.makedirs(os.path.join(loki_dir, "queue"), exist_ok=True)
    os.makedirs(os.path.join(loki_dir, "quality"), exist_ok=True)
    with open(os.path.join(loki_dir, "queue", "completed.json"), "w") as f:
        json.dump([{"id": i} for i in range(n_iters)], f)
    with open(os.path.join(loki_dir, "quality", "test-results.json"), "w") as f:
        json.dump({"runner": "pytest", "command": "pytest",
                   "exit_code": 0, "status": tests_status,
                   "passed_count": 3, "failed_count": 0}, f)
    with open(os.path.join(loki_dir, "generated-prd.md"), "w") as f:
        f.write(brief)


def _run_generator(loki_dir, out_dir, target_dir, *, env_extra=None):
    cmd = [sys.executable, _GENERATOR, "--loki-dir", loki_dir,
           "--out-dir", out_dir, "--run-id", "eff-fixed-001",
           "--loki-version", "7.9.0", "--quiet"]
    env = dict(os.environ)
    for k in ("PRD_PATH", "_LOKI_ITER_START_SHA", "LOKI_SESSION_ID",
              "LOKI_DEPLOYED_URL", "LOKI_EFFORT_LLM", "LOKI_EFFORT_LLM_STUB"):
        env.pop(k, None)
    if env_extra:
        env.update(env_extra)
    # Run the generator FROM target_dir so its git diffstat sees the fixture.
    r = subprocess.run(cmd, capture_output=True, text=True, env=env,
                       timeout=60, cwd=target_dir)
    assert r.returncode == 0, "generator failed: %s" % r.stderr
    return json.load(open(os.path.join(out_dir, "proof.json")))


class EffortEstimateProofTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-effort-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _build(self, name, files, *, brief, tests_status="verified",
               env_extra=None):
        target = os.path.join(self.tmp, name)
        os.makedirs(target)
        _init_repo_with_change(target, files)
        loki_dir = os.path.join(target, ".loki")
        _seed_loki(loki_dir, brief=brief, tests_status=tests_status)
        out_dir = os.path.join(self.tmp, name + "-out")
        os.makedirs(out_dir)
        return _run_generator(loki_dir, out_dir, target, env_extra=env_extra)

    def test_no_llm_heuristic_field_present(self):
        proof = self._build(
            "small", {"a.py": "x = 1\n"}, brief="Tiny tweak.")
        self.assertIn("effort_estimate", proof,
                      "proof.json must gain effort_estimate")
        ee = proof["effort_estimate"]
        self.assertEqual(ee["method"], "heuristic")
        self.assertEqual(ee["model"], "")
        self.assertFalse(ee["calibrated"])
        self.assertIn("uncalibrated", ee["label"])
        for k in ("hours", "low", "high", "inputs_hash"):
            self.assertIn(k, ee)
        self.assertTrue(ee["inputs_hash"], "inputs_hash must be non-empty")
        self.assertIsInstance(ee["hours"], (int, float))
        self.assertLessEqual(ee["low"], ee["hours"])
        self.assertGreaterEqual(ee["high"], ee["hours"])

    def test_different_scope_different_hours(self):
        # Small: a one-line schema tweak.
        small = self._build(
            "scope-small", {"schema.py": "FIELD = 1\n"},
            brief="Add one field.")
        # Large: a full-stack feature -- many files, hundreds of lines, tests.
        big_files = {
            "src/api/routes.py": "\n".join("def r%d(): pass" % i
                                           for i in range(120)) + "\n",
            "src/api/models.py": "\n".join("class M%d: pass" % i
                                           for i in range(80)) + "\n",
            "src/web/app.js": "\n".join("const c%d = %d;" % (i, i)
                                        for i in range(150)) + "\n",
            "tests/test_api.py": "\n".join("def test_%d(): assert True" % i
                                           for i in range(60)) + "\n",
        }
        big = self._build(
            "scope-big", big_files,
            brief="Build a full-stack CRUD feature with auth, persistence, "
                  "REST endpoints, a web UI, and an end-to-end test suite. " * 8)
        hs = small["effort_estimate"]["hours"]
        hb = big["effort_estimate"]["hours"]
        # Materially different: the big build must be several times the small.
        self.assertGreater(hb, hs * 3,
                           "work-based estimator must separate scopes: "
                           "small=%s big=%s" % (hs, hb))

    def test_deterministic_for_fixed_inputs(self):
        files = {"a.py": "x = 1\ny = 2\n", "b.py": "z = 3\n"}
        p1 = self._build("det1", files, brief="Same inputs.")
        # Rebuild an identical repo -> identical work signals -> identical hash.
        p2 = self._build("det2", dict(files), brief="Same inputs.")
        e1, e2 = p1["effort_estimate"], p2["effort_estimate"]
        self.assertEqual(e1["inputs_hash"], e2["inputs_hash"])
        self.assertEqual(e1["hours"], e2["hours"])
        self.assertEqual((e1["low"], e1["high"]), (e2["low"], e2["high"]))

    def test_inputs_hash_recomputable(self):
        est = _load_estimator()
        files_changed = {"count": 2, "insertions": 30, "deletions": 5,
                         "files": [{"path": "b.py"}, {"path": "a.py"}]}
        tests = {"status": "verified", "passed_count": 4, "failed_count": 0}
        spec = {"source": "prd", "brief": "hello world"}
        iterations = {"count": 3}
        out = est.estimate(files_changed, tests, spec, iterations)
        canon = est._canonical_inputs(files_changed, tests, spec, iterations)
        expect = hashlib.sha256(
            est._canonical(canon).encode("utf-8")).hexdigest()
        self.assertEqual(out["inputs_hash"], expect)

    def test_inputs_hash_recomputable_from_written_proof_long_brief(self):
        # AUDITABILITY: a third party must be able to recompute inputs_hash from
        # the WRITTEN proof.json. The generator truncates spec.brief to 600
        # chars; the estimator caps the hashed brief_len to the same bound so a
        # brief > 600 chars still recomputes cleanly. Regression for the cap.
        est = _load_estimator()
        long_brief = "LONG " * 300  # 1500 chars, well over the 600 cap
        proof = self._build("longbrief", {"a.py": "x = 1\n"}, brief=long_brief)
        ee = proof["effort_estimate"]
        stored_brief = proof["spec"]["brief"]
        self.assertEqual(len(stored_brief), 600,
                         "generator should have truncated the brief to 600")
        # Recompute from the WRITTEN artifact (truncated brief) and compare.
        canon = est._canonical_inputs(
            proof["files_changed"], proof["facts"]["tests"],
            proof["spec"], proof["iterations"])
        recomputed = est._inputs_hash(canon)
        self.assertEqual(ee["inputs_hash"], recomputed,
                         "inputs_hash must be recomputable from the receipt")

    def test_llm_gate_and_no_fabrication(self):
        est = _load_estimator()
        fc = {"count": 3, "insertions": 100, "deletions": 10, "files": []}
        tests = {"status": "verified"}
        spec = {"brief": "x"}
        it = {"count": 2}

        # (a) Flag OFF, stub present -> heuristic (flag gates the whole path).
        os.environ.pop("LOKI_EFFORT_LLM", None)
        os.environ["LOKI_EFFORT_LLM_STUB"] = '{"hours": 40, "low": 30, "high": 50}'
        try:
            out = est.estimate(fc, tests, spec, it)
            self.assertEqual(out["method"], "heuristic")
            self.assertEqual(out["model"], "")

            # (b) Flag ON + parseable stub -> method flips to llm, model recorded.
            os.environ["LOKI_EFFORT_LLM"] = "1"
            os.environ["LOKI_EFFORT_LLM_MODEL"] = "claude-test-model"
            out = est.estimate(fc, tests, spec, it)
            self.assertEqual(out["method"], "llm")
            self.assertEqual(out["hours"], 40.0)
            self.assertEqual(out["model"], "claude-test-model")

            # (c) Flag ON but UNPARSEABLE output -> FAIL OPEN to heuristic,
            #     never fabricate method == "llm".
            os.environ["LOKI_EFFORT_LLM_STUB"] = "the model rambled with no number here"
            out = est.estimate(fc, tests, spec, it)
            self.assertEqual(out["method"], "heuristic")
            self.assertEqual(out["model"], "")
        finally:
            for k in ("LOKI_EFFORT_LLM", "LOKI_EFFORT_LLM_STUB",
                      "LOKI_EFFORT_LLM_MODEL"):
                os.environ.pop(k, None)

    def test_llm_stub_is_separate_from_wiki_stub(self):
        # The estimator must NOT reuse the wiki LLM stub env: setting only the
        # wiki stub (and NOT the effort flag) must leave the path heuristic.
        est = _load_estimator()
        os.environ["LOKI_WIKI_LLM_STUB"] = '{"hours": 999}'
        os.environ.pop("LOKI_EFFORT_LLM", None)
        try:
            out = est.estimate({"count": 1, "insertions": 5, "deletions": 0,
                                "files": []}, {}, {}, {"count": 1})
            self.assertEqual(out["method"], "heuristic")
            self.assertNotEqual(out["hours"], 999)
        finally:
            os.environ.pop("LOKI_WIKI_LLM_STUB", None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
