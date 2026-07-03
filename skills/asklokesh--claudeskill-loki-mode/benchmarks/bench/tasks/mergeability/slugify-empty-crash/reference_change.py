"""Reference CORRECT change for slugify-empty-crash (NOT shown to the agent).

Kept in the task dir purely to PROVE the FAIL_TO_PASS blocker is non-vacuous:
applying this reference solution to the base fixture must flip the grader from
RED (blocker fails) to GREEN (all checks pass). It is the maintainer's "known
good" diff, used by tests/test_bench_mergeability.py, never handed to any tool.

This file is content, not code the harness imports at runtime.
"""

import re

_NON_WORD = re.compile(r"[^a-z0-9]+")


def slugify(title):
    """Return a lowercase, hyphen-separated slug; 'untitled' for empty/None."""
    if title is None:
        return "untitled"
    lowered = str(title).lower()
    collapsed = _NON_WORD.sub("-", lowered)
    slug = collapsed.strip("-")
    return slug if slug else "untitled"
