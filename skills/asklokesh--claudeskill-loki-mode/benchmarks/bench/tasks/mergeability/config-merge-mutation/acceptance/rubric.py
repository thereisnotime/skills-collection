#!/usr/bin/env python3
"""HELD-OUT mergeability grader for config-merge-mutation.

Never shown to the agent. Copied into the workdir only AFTER the agent runs.
Prints {"checks": {id: bool, ...}} as JSON on stdout. Pure stdlib, no network,
no install: CI-safe and deterministic.
"""

import copy
import json
import os
import sys


def _load_merge():
    sys.path.insert(0, os.getcwd())
    try:
        import config_merge as mod  # noqa: WPS433
        return getattr(mod, "deep_merge", None)
    except Exception:
        return None


def main():
    checks = {}
    deep_merge = _load_merge()

    if deep_merge is None:
        for cid in ("fail_to_pass", "correct_result", "override_untouched",
                    "no_shared_refs", "handles_new_keys"):
            checks[cid] = False
        print(json.dumps({"checks": checks}))
        return

    def fresh():
        base = {"a": 1, "nested": {"x": 1, "y": 2}}
        override = {"b": 2, "nested": {"y": 20, "z": 30}}
        return base, override

    # BLOCKER (reverse-classical FAIL_TO_PASS): merging must NOT mutate the
    # caller's base dict. Fails on base fixture (it mutates in place).
    base, override = fresh()
    base_snapshot = copy.deepcopy(base)
    try:
        deep_merge(base, override)
        checks["fail_to_pass"] = (base == base_snapshot)
    except Exception:
        checks["fail_to_pass"] = False

    # NON-BLOCKER: the merged result is correct.
    base, override = fresh()
    try:
        result = deep_merge(base, override)
        expected = {"a": 1, "b": 2, "nested": {"x": 1, "y": 20, "z": 30}}
        checks["correct_result"] = (result == expected)
    except Exception:
        checks["correct_result"] = False

    # NON-BLOCKER: the override dict is left untouched too.
    base, override = fresh()
    override_snapshot = copy.deepcopy(override)
    try:
        deep_merge(base, override)
        checks["override_untouched"] = (override == override_snapshot)
    except Exception:
        checks["override_untouched"] = False

    # NON-BLOCKER: no shared nested references leak from inputs into the result
    # (mutating the result must not reach back into base or override).
    base, override = fresh()
    try:
        result = deep_merge(base, override)
        if isinstance(result.get("nested"), dict):
            result["nested"]["z"] = 999
            leaked = (override.get("nested", {}).get("z") == 999
                      or base.get("nested", {}).get("z") == 999)
            checks["no_shared_refs"] = (not leaked)
        else:
            checks["no_shared_refs"] = False
    except Exception:
        checks["no_shared_refs"] = False

    # NON-BLOCKER: override-only keys appear in the result.
    base, override = fresh()
    try:
        result = deep_merge(base, override)
        checks["handles_new_keys"] = (result.get("b") == 2
                                      and result.get("nested", {}).get("z") == 30)
    except Exception:
        checks["handles_new_keys"] = False

    print(json.dumps({"checks": checks}))


if __name__ == "__main__":
    main()
