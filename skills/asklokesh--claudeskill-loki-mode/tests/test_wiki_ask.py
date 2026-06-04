"""tests/test_wiki_ask.py -- R5 grounded cited Q&A behavior.

Covers the anti-fabrication grounding contract:
  - ask returns a grounded answer with citations that resolve on disk.
  - a bogus chunk index ([99]) emitted by the (stubbed) LLM is DROPPED, not
    surfaced as a citation -- fabrication is structurally impossible.
  - the extractive fallback (no LLM, no stub) still yields real citations.
  - no relevant code -> graceful "no relevant code found" (exit 3).

The ask script is invoked as a subprocess (hyphenated filename).
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
_ASK = os.path.join(_REPO, "autonomy", "lib", "wiki-ask.py")


def _make_repo():
    root = tempfile.mkdtemp(prefix="loki-wiki-ask-")
    os.makedirs(os.path.join(root, "src"))
    with open(os.path.join(root, "src", "auth.py"), "w") as f:
        f.write("def login(user, password):\n"
                "    return verify(user, password)\n\n\n"
                "def verify(user, password):\n"
                "    return user == 'admin'\n")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                    "commit", "-qm", "init"], cwd=root, check=True)
    return root


def _ask(root, question, stub=None):
    env = dict(os.environ)
    if stub is not None:
        env["LOKI_WIKI_LLM_STUB"] = stub
    else:
        env.pop("LOKI_WIKI_LLM_STUB", None)
        # Make sure no real provider is found, so the extractive path is used.
        env["PATH"] = ""
        env["LOKI_PROVIDER"] = "claude"
    return subprocess.run(
        [sys.executable, _ASK, "--root", root, "--question", question, "--json"],
        capture_output=True, text=True, env=env,
    )


class TestWikiAsk(unittest.TestCase):
    def setUp(self):
        self.root = _make_repo()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_grounded_answer_with_resolving_citations(self):
        r = _ask(self.root, "where is the login function",
                 stub="The login function is defined at [1].")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertTrue(out["citations"], "expected at least one citation")
        for c in out["citations"]:
            abs_path = os.path.join(self.root, c["file"])
            self.assertTrue(os.path.isfile(abs_path), c["file"])
            nlines = sum(1 for _ in open(abs_path))
            self.assertTrue(1 <= c["line"] <= max(nlines, 1))
        # The rewritten answer must use file:line, not the raw [1] index.
        self.assertNotIn("[1]", out["answer"])
        self.assertIn("src/auth.py", out["answer"])

    def test_bogus_index_is_dropped(self):
        # The stub references a chunk index that does not exist ([99]).
        r = _ask(self.root, "where is login",
                 stub="Real ref [1] and a fabricated ref [99].")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        # [99] must not produce a citation; [1] must.
        files = {c["file"] for c in out["citations"]}
        self.assertIn("src/auth.py", files)
        # No citation can point outside the supplied/real set; the answer must
        # not contain a dangling [99].
        self.assertNotIn("[99]", out["answer"])
        # Every emitted citation resolves on disk (no fabrication survived).
        for c in out["citations"]:
            self.assertTrue(os.path.isfile(os.path.join(self.root, c["file"])))

    def test_extractive_fallback_has_real_citations(self):
        r = _ask(self.root, "login verify", stub=None)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertTrue(out["citations"])
        for c in out["citations"]:
            self.assertTrue(os.path.isfile(os.path.join(self.root, c["file"])))

    def test_no_relevant_code_exit_3(self):
        r = _ask(self.root, "zzzqqq nonexistent topic xylophone",
                 stub="irrelevant")
        # retrieve() returns nothing -> exit 3, empty citations.
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["citations"], [])


if __name__ == "__main__":
    unittest.main()
