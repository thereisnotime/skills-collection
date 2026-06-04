"""tests/test_wiki_index.py -- R5 wiki code index unit tests.

Covers the grounding substrate: chunking is line-accurate, retrieval is
deterministic, signatures are stable and change on edit, and every path the
index emits is repo-relative (no PII / absolute paths).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LIB = os.path.join(_REPO, "autonomy", "lib")
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

import wiki_index  # noqa: E402


def _make_repo():
    root = tempfile.mkdtemp(prefix="loki-wiki-idx-")
    os.makedirs(os.path.join(root, "src"))
    with open(os.path.join(root, "src", "calc.py"), "w") as f:
        f.write("def add(a, b):\n    return a + b\n\n\nclass Calc:\n"
                "    def mul(self, x, y):\n        return x * y\n")
    with open(os.path.join(root, "src", "web.js"), "w") as f:
        f.write("function startServer(port) {\n  return port;\n}\n")
    # noise that must be excluded
    os.makedirs(os.path.join(root, "node_modules", "junk"))
    with open(os.path.join(root, "node_modules", "junk", "x.js"), "w") as f:
        f.write("module.exports = 1;\n")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                    "commit", "-qm", "init"], cwd=root, check=True)
    return root


class TestWikiIndex(unittest.TestCase):
    def setUp(self):
        self.root = _make_repo()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_lists_source_files_relative_and_excludes_noise(self):
        files = wiki_index.list_source_files(self.root)
        self.assertIn("src/calc.py", files)
        self.assertIn("src/web.js", files)
        # node_modules excluded
        self.assertFalse(any("node_modules" in f for f in files))
        # all relative (no absolute paths -> no PII)
        for f in files:
            self.assertFalse(os.path.isabs(f), f)

    def test_chunks_are_line_accurate(self):
        index = wiki_index.build_index(self.root)
        for ch in index["chunks"]:
            self.assertGreaterEqual(ch["start_line"], 1)
            self.assertGreaterEqual(ch["end_line"], ch["start_line"])
            self.assertFalse(os.path.isabs(ch["file"]))
            # The chunk text really comes from those lines of that file.
            with open(os.path.join(self.root, ch["file"])) as fh:
                lines = fh.read().splitlines()
            expected = "\n".join(lines[ch["start_line"] - 1:ch["end_line"]])
            self.assertEqual(ch["text"], expected)

    def test_retrieve_is_deterministic_and_relevant(self):
        index = wiki_index.build_index(self.root)
        r1 = wiki_index.retrieve(index, "startServer port", k=3)
        r2 = wiki_index.retrieve(index, "startServer port", k=3)
        self.assertEqual([c["id"] for c in r1], [c["id"] for c in r2])
        # The web.js chunk should win for a server query.
        self.assertTrue(r1)
        self.assertEqual(r1[0]["file"], "src/web.js")

    def test_signature_stable_then_changes_on_edit(self):
        sig1 = wiki_index.compute_signature(self.root)
        sig2 = wiki_index.compute_signature(self.root)
        self.assertEqual(sig1, sig2)  # stable when unchanged
        with open(os.path.join(self.root, "src", "calc.py"), "a") as f:
            f.write("\n# changed\n")
        sig3 = wiki_index.compute_signature(self.root)
        self.assertNotEqual(sig1, sig3)  # changes on edit

    def test_extract_definitions_real_lines(self):
        defs = wiki_index.extract_definitions(self.root, "src/calc.py")
        names = {d["name"] for d in defs}
        self.assertIn("add", names)
        self.assertIn("Calc", names)
        # add() is the first line of the file.
        add_line = next(d["line"] for d in defs if d["name"] == "add")
        self.assertEqual(add_line, 1)


if __name__ == "__main__":
    unittest.main()
