"""
Loki Managed Agents Memory package (v6.83.0 Phase 1).

Opt-in integration with Claude Managed Agents memory stores. All behavior in
this package is gated on the two environment variables:

    LOKI_MANAGED_AGENTS   parent switch (default: false)
    LOKI_MANAGED_MEMORY   child switch  (default: false)

Both must be "true" for any API call to be issued. If the child is "true" while
the parent is "false", the loki runner fails fast at startup (see
autonomy/run.sh). If the flags are off, every exported function is a cheap
no-op -- importing this package will NOT trigger any network or SDK import
side-effects.

This package is intentionally the ONLY place in the codebase that imports the
`anthropic` SDK. A CI test (tests/managed_memory/test_sdk_isolation.sh)
enforces that invariant.

Exports:
    is_enabled()                - bool, True iff both flags are on
    ManagedDisabled             - raised when callers try to force an op while off
    shadow_write_verdict(path)  - shadow-write a council verdict JSON to the store
    shadow_write_pattern(obj)   - shadow-write a semantic pattern dict
    retrieve_related_verdicts(q, top_k=3, store_id=None)
                                - return list of related prior verdicts
    hydrate_patterns(mtime_floor)
                                - pull recent patterns and merge locally
    probe_beta_header()         - return the active beta header string
    emit_managed_event(type, payload)
                                - low-level event writer

None of these functions raise on SDK or network errors. They return empty /
None and log one WARN line. Real SDK errors surface through
`.loki/managed/events.ndjson`.
"""

from __future__ import annotations

import os
from typing import Optional

from ._beta import BETA_HEADER
from .events import emit_managed_event


class ManagedDisabled(Exception):
    """Raised when a managed-memory operation is attempted while flags are off."""


def is_enabled() -> bool:
    """True iff LOKI_MANAGED_AGENTS=true AND LOKI_MANAGED_MEMORY=true."""
    parent = os.environ.get("LOKI_MANAGED_AGENTS", "").strip().lower() == "true"
    child = os.environ.get("LOKI_MANAGED_MEMORY", "").strip().lower() == "true"
    return parent and child


def probe_beta_header() -> str:
    """Return the pinned managed-agents beta header."""
    return BETA_HEADER


# Lazy re-exports. Importing the top-level package MUST NOT import the
# anthropic SDK, so we defer the real imports until the functions are called.


def shadow_write_verdict(verdict_json_path: str) -> None:
    """Shadow-write a council verdict file to the managed store (opt-in)."""
    if not is_enabled():
        return None
    from . import shadow_write as _sw  # local import: gated on flags
    return _sw.shadow_write_verdict(verdict_json_path)


def shadow_write_pattern(pattern: dict) -> None:
    """Shadow-write a semantic pattern dict to the managed store (opt-in)."""
    if not is_enabled():
        return None
    from . import shadow_write as _sw
    return _sw.shadow_write_pattern(pattern)


def retrieve_related_verdicts(
    query: str,
    top_k: int = 3,
    store_id: Optional[str] = None,
):
    """Return related verdicts from the managed store; [] when disabled or on error."""
    if not is_enabled():
        return []
    from . import retrieve as _r
    return _r.retrieve_related_verdicts(query, top_k=top_k, store_id=store_id)


def hydrate_patterns(local_mtime_floor: float):
    """Pull semantic patterns updated after floor; no-op when disabled."""
    if not is_enabled():
        return None
    from . import retrieve as _r
    return _r.hydrate_patterns(local_mtime_floor)


def hydrate(namespace: Optional[str] = None, mtime_floor: Optional[float] = None):
    """Session-boot hydrate (patterns + skills). No-op when disabled."""
    if not is_enabled():
        return {"patterns": 0, "skills": 0, "skipped": True}
    from . import retrieve as _r
    return _r.hydrate(namespace=namespace, mtime_floor=mtime_floor)


__all__ = [
    "BETA_HEADER",
    "ManagedDisabled",
    "emit_managed_event",
    "hydrate",
    "hydrate_patterns",
    "is_enabled",
    "probe_beta_header",
    "retrieve_related_verdicts",
    "shadow_write_pattern",
    "shadow_write_verdict",
]
