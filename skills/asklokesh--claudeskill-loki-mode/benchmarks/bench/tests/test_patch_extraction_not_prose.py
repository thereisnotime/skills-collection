#!/usr/bin/env python3
"""Prose must never be certified as a valid patch.

THE DEFECT, measured on a stored 300-instance SWE-bench run
(benchmarks/results/2026-01-05-10-37-54/): 179 of 300 model_patch values were
prose, 128 carrying a fenced diff mid-string. `clean_patch` stripped a fence
ONLY at position 0, so any preamble defeated it. `qa_agent` then validated with
SUBSTRING tests over the whole blob ("---" in patch, "@@" in patch, "a/" in
patch), which prose quoting a diff satisfies. Result: 178 of 179 prose entries
passed EVERY format check. The harness did not detect-and-retry; it silently
CERTIFIED prose as a patch and counted it in generated_count.

That is a false green inside our own benchmark, which is the exact defect class
this product exists to detect.

WHAT IS LOAD-BEARING: a real unified diff has its markers at the START of a
line. Anchoring to line starts is what prose cannot satisfy by accident. These
tests assert BOTH directions: prose is rejected, and a genuine diff still
validates (an over-correction that rejects real patches would be worse).

Run: python3 -m pytest benchmarks/bench/tests/test_patch_extraction_not_prose.py -q
"""
import io
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
SH = os.path.join(REPO, "benchmarks", "run-benchmarks.sh")


def _load():
    """Exec the LAST clean_patch/qa_agent out of the shell file.

    There are two qa_agent definitions in that file; the SWE-bench one is the
    later. Taking the first silently tests unrelated code, which is how an
    earlier version of this probe reported a passing signature of (problem,
    solution).
    """
    src = io.open(SH, encoding="utf-8").read()

    def grab_last(name):
        i = src.rindex("def %s(" % name)
        j = src.index("\ndef ", i + 5)
        return src[i:j]

    ns = {}
    exec("import time,re\nfrom datetime import datetime\n" + grab_last("clean_patch"), ns)
    exec(grab_last("qa_agent"), ns)
    return ns["clean_patch"], ns["qa_agent"]


clean_patch, qa_agent = _load()

GENUINE = "--- a/f.py\n+++ b/f.py\n@@ -1,2 +1,2 @@\n-old\n+new\n"

PROSE_WITH_FENCE = (
    "Based on the architect's analysis, I need to generate a patch for the "
    "astropy repository. The issue is in the `_cstack` function.\n\n"
    "```diff\n" + GENUINE + "```\n\nThis should resolve the issue."
)

PROSE_NO_DIFF = (
    "I analyzed the problem. The fix is to change the --- separator and the @@ "
    "markers in a/file.py, but I was unable to produce the patch."
)


def test_genuine_diff_still_validates():
    """Over-correction would be worse than the bug. This must never fail."""
    assert qa_agent(clean_patch(GENUINE))["valid"] is True


def test_prose_with_a_fenced_diff_is_extracted():
    out = clean_patch(PROSE_WITH_FENCE)
    assert out.startswith("--- a/f.py"), "fence mid-string was not extracted: %r" % out[:80]
    assert qa_agent(out)["valid"] is True


def test_prose_without_any_diff_is_rejected():
    """The killer case: prose that merely MENTIONS ---, @@ and a/.

    Under the old substring checks this passed every single one."""
    out = clean_patch(PROSE_NO_DIFF)
    result = qa_agent(out)
    assert result["valid"] is False, (
        "prose containing no real diff was certified as a valid patch: %r" % result
    )


def test_no_invented_patch():
    """clean_patch must never fabricate. Nothing diff-shaped in, nothing out."""
    out = clean_patch(PROSE_NO_DIFF)
    assert "@@ -" not in out or out == PROSE_NO_DIFF.strip(), (
        "clean_patch synthesized diff structure that was not in the input"
    )


def test_against_the_real_recorded_run():
    """Drive the REAL stored predictions, not a fixture.

    Guards against vacuity: if the results file disappears, this reports
    UNMEASURED rather than passing over nothing.
    """
    path = os.path.join(REPO, "benchmarks", "results",
                        "2026-01-05-10-37-54", "swebench-loki-predictions.json")
    if not os.path.isfile(path):
        import pytest
        pytest.skip("recorded run absent: prose-certification was NOT measured")
    import json
    d = json.load(open(path))
    recs = d if isinstance(d, list) else (d.get("predictions") or [])
    prose = [r["model_patch"] for r in recs
             if isinstance(r, dict) and isinstance(r.get("model_patch"), str)
             and not r["model_patch"].lstrip().startswith(("diff", "---", "Index", "+++"))]
    assert len(prose) > 100, "expected the known prose population; got %d" % len(prose)

    certified_non_diff = 0
    for p in prose:
        c = clean_patch(p)
        if qa_agent(c).get("valid"):
            if not any(l.startswith(("--- ", "diff --git ")) for l in c.splitlines()):
                certified_non_diff += 1
    assert certified_non_diff == 0, (
        "%d prose entries are STILL certified as valid patches" % certified_non_diff
    )
