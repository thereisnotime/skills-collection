#!/usr/bin/env python3
"""HELD-OUT mergeability grader for slugify-empty-crash.

Never shown to the agent (lives in the acceptance/ overlay, copied into the
workdir only AFTER the agent finishes). Runs each rubric check against the
produced slugify.py and prints {"checks": {id: bool, ...}} as JSON on stdout.

Pure stdlib, no network, no install: CI-safe and deterministic. Each check is
independent so a crash in one (e.g. an import error) fails only that check.
"""

import json
import os
import sys


def _load_slugify():
    """Import slugify from the workdir; return the callable or None."""
    sys.path.insert(0, os.getcwd())
    try:
        import slugify as mod  # noqa: WPS433
        return getattr(mod, "slugify", None)
    except Exception:
        return None


def _safe(fn, *args):
    """Call fn(*args); return (ok, value). ok=False if it raised."""
    try:
        return True, fn(*args)
    except Exception:
        return False, None


def main():
    checks = {}
    slug = _load_slugify()

    if slug is None:
        # Module cannot even import -> every check fails.
        for cid in ("fail_to_pass", "preserves_existing",
                    "collapses_separators", "strips_result", "idempotent"):
            checks[cid] = False
        print(json.dumps({"checks": checks}))
        return

    # BLOCKER (reverse-classical FAIL_TO_PASS): the untitled/empty/None inputs
    # must return the "untitled" fallback rather than "" or a crash. This FAILS
    # on the base fixture (empty -> "", None -> AttributeError) and PASSES only
    # after the correct change.
    ok_empty, v_empty = _safe(slug, "")
    ok_ws, v_ws = _safe(slug, "   ")
    ok_none, v_none = _safe(slug, None)
    checks["fail_to_pass"] = bool(
        ok_empty and v_empty == "untitled"
        and ok_ws and v_ws == "untitled"
        and ok_none and v_none == "untitled"
    )

    # NON-BLOCKER: existing happy-path behavior preserved (no regression).
    ok1, v1 = _safe(slug, "Hello World")
    ok2, v2 = _safe(slug, "  A/B  Test ")
    checks["preserves_existing"] = bool(
        ok1 and v1 == "hello-world" and ok2 and v2 == "a-b-test"
    )

    # NON-BLOCKER: runs of non-word characters collapse to a SINGLE hyphen
    # (independent of the untitled-fallback blocker: a change could fix the
    # fallback yet regress collapsing, or vice versa).
    ok_c, v_c = _safe(slug, "a   b///c")
    checks["collapses_separators"] = bool(ok_c and v_c == "a-b-c")

    # NON-BLOCKER: results never carry leading/trailing hyphens.
    ok3, v3 = _safe(slug, "--Weird--Title--")
    checks["strips_result"] = bool(
        ok3 and isinstance(v3, str) and v3 == v3.strip("-") and v3 != ""
    )

    # NON-BLOCKER: slugify is idempotent (slug of a slug is itself).
    ok4, v4 = _safe(slug, "Hello World")
    if ok4 and isinstance(v4, str):
        ok5, v5 = _safe(slug, v4)
        checks["idempotent"] = bool(ok5 and v5 == v4)
    else:
        checks["idempotent"] = False

    print(json.dumps({"checks": checks}))


if __name__ == "__main__":
    main()
