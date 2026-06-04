"""tests/test_wiki_generator.py -- R5 wiki generator behavior.

Covers:
  - generation on a small fixture repo produces wiki.json + rendered md.
  - every citation points at a REAL file (and a valid line).
  - incremental regen SKIPS when the codebase is unchanged, regenerates on edit.
  - the LLM is mocked via LOKI_WIKI_LLM_STUB (zero paid calls in CI).
  - no absolute paths leak into the output (no PII).

The generator is invoked as a subprocess (its filename has a hyphen), matching
how the bash CLI calls it.
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
_GEN = os.path.join(_REPO, "autonomy", "lib", "wiki-generator.py")


def _make_repo():
    root = tempfile.mkdtemp(prefix="loki-wiki-gen-")
    os.makedirs(os.path.join(root, "src"))
    with open(os.path.join(root, "src", "main.py"), "w") as f:
        f.write("def main():\n    return run()\n\n\ndef run():\n    return 42\n")
    with open(os.path.join(root, "src", "util.js"), "w") as f:
        f.write("export function helper(x) {\n  return x + 1;\n}\n")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                    "commit", "-qm", "init"], cwd=root, check=True)
    return root


def _run_gen(root, *extra, stub="Prose about the project [1]."):
    env = dict(os.environ)
    env["LOKI_WIKI_LLM_STUB"] = stub
    return subprocess.run(
        [sys.executable, _GEN, "--root", root, "--quiet", *extra],
        capture_output=True, text=True, env=env,
    )


class TestWikiGenerator(unittest.TestCase):
    def setUp(self):
        self.root = _make_repo()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_generates_wiki_with_real_citations(self):
        r = _run_gen(self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        wiki_dir = os.path.join(self.root, ".loki", "wiki")
        self.assertTrue(os.path.isfile(os.path.join(wiki_dir, "wiki.json")))
        self.assertTrue(os.path.isfile(os.path.join(wiki_dir, "index.md")))
        for sec in ("architecture", "modules", "data-flow"):
            self.assertTrue(os.path.isfile(os.path.join(wiki_dir, sec + ".md")))

        wiki = json.load(open(os.path.join(wiki_dir, "wiki.json")))
        self.assertEqual([s["id"] for s in wiki["sections"]],
                         ["architecture", "modules", "data-flow"])
        # Every citation must resolve to a real file and a valid line.
        total_cites = 0
        for sec in wiki["sections"]:
            for c in sec["citations"]:
                total_cites += 1
                abs_path = os.path.join(self.root, c["file"])
                self.assertTrue(os.path.isfile(abs_path),
                                "citation points at a missing file: " + c["file"])
                nlines = sum(1 for _ in open(abs_path))
                self.assertTrue(1 <= c["line"] <= max(nlines, 1),
                                "citation line out of range: %s:%d" % (c["file"], c["line"]))
        self.assertGreater(total_cites, 0, "wiki produced no citations")

    def test_no_absolute_paths_in_output(self):
        _run_gen(self.root)
        wiki_dir = os.path.join(self.root, ".loki", "wiki")
        for fn in os.listdir(wiki_dir):
            content = open(os.path.join(wiki_dir, fn)).read()
            self.assertNotIn("/Users/", content, fn)
            self.assertNotIn(self.root, content, fn)

    def test_incremental_skip_then_regen_on_edit(self):
        r1 = _run_gen(self.root)
        self.assertEqual(r1.returncode, 0)
        manifest = os.path.join(self.root, ".loki", "wiki", "wiki-manifest.json")
        sig1 = json.load(open(manifest))["signature"]

        # Re-run without changes: must report up-to-date (no rewrite).
        env = dict(os.environ)
        env["LOKI_WIKI_LLM_STUB"] = "x [1]."
        r2 = subprocess.run([sys.executable, _GEN, "--root", self.root],
                            capture_output=True, text=True, env=env)
        self.assertEqual(r2.returncode, 0)
        self.assertIn("up to date", r2.stdout.lower())

        # Edit a source file: signature must change and regen must happen.
        with open(os.path.join(self.root, "src", "main.py"), "a") as f:
            f.write("\ndef extra():\n    return 1\n")
        r3 = _run_gen(self.root)
        self.assertEqual(r3.returncode, 0)
        sig2 = json.load(open(manifest))["signature"]
        self.assertNotEqual(sig1, sig2)

    def test_force_regenerates_even_when_unchanged(self):
        _run_gen(self.root)
        r = _run_gen(self.root, "--force")
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("up to date", r.stdout.lower())


if __name__ == "__main__":
    unittest.main()
