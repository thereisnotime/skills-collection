"""Reference CORRECT change for config-merge-mutation (NOT shown to the agent).

Kept only to PROVE the FAIL_TO_PASS blocker is non-vacuous: applying this over
the base fixture flips the grader RED -> GREEN. Used by
tests/test_bench_mergeability.py; never handed to any tool.
"""

import copy


def deep_merge(base, override):
    """Return a NEW dict merging `override` onto `base`; inputs untouched."""
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged
