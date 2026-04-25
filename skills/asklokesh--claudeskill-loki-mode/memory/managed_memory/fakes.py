"""
Loki Managed Agents Memory - FakeManagedClient for CI tests (v6.83.0 Phase 1).

Implements the same surface as ManagedClient but keeps state in memory and
returns deterministic responses keyed on input path. Used by
tests/managed_memory/test_*_mock.py so CI does not call the real API.

This file is importable without the `anthropic` SDK installed.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional


class _Conflict(Exception):
    """Simulated 409 raised by memory_create on sha256 mismatch."""

    status_code = 409


class FakeManagedClient:
    """In-memory fake matching ManagedClient's public interface."""

    def __init__(self) -> None:
        self.stores: Dict[str, Dict[str, Any]] = {}
        # memories keyed by (store_id, path) -> dict(content, sha, version)
        self.memories: Dict[tuple, Dict[str, Any]] = {}
        self.calls: List[Dict[str, Any]] = []

    # ---------- stores --------------------------------------------------

    def stores_list(self) -> List[Dict[str, Any]]:
        self.calls.append({"op": "stores_list"})
        return list(self.stores.values())

    def stores_get_or_create(
        self, name: str, description: str = "", scope: str = "project"
    ) -> Dict[str, Any]:
        self.calls.append({"op": "stores_get_or_create", "name": name})
        for s in self.stores.values():
            if s.get("name") == name:
                return s
        store_id = f"store_{len(self.stores) + 1:04d}"
        store = {
            "id": store_id,
            "name": name,
            "description": description,
            "scope": scope,
        }
        self.stores[store_id] = store
        return store

    # ---------- memories ------------------------------------------------

    def memory_create(
        self,
        store_id: str,
        path: str,
        content: str,
        sha256_precondition: Optional[str] = None,
    ) -> Dict[str, Any]:
        self.calls.append(
            {
                "op": "memory_create",
                "store_id": store_id,
                "path": path,
                "sha256_precondition": sha256_precondition,
            }
        )
        key = (store_id, path)
        sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
        existing = self.memories.get(key)
        if existing is not None and sha256_precondition is not None:
            if existing["sha"] != sha256_precondition:
                # Simulated 409: caller must re-read + merge + retry.
                raise _Conflict(
                    f"sha256 mismatch for {path}: "
                    f"have={existing['sha']}, want={sha256_precondition}"
                )
        version = (existing.get("version", 0) + 1) if existing else 1
        entry = {
            "id": f"mem_{abs(hash(key)) % 10**8:08d}",
            "store_id": store_id,
            "path": path,
            "content": content,
            "sha": sha,
            "version": version,
        }
        self.memories[key] = entry
        return entry

    def memory_read(self, store_id: str, memory_id: str) -> Dict[str, Any]:
        self.calls.append({"op": "memory_read", "memory_id": memory_id})
        for entry in self.memories.values():
            if entry.get("id") == memory_id:
                return entry
        raise KeyError(memory_id)

    def memories_list(
        self, store_id: str, path_prefix: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        self.calls.append(
            {"op": "memories_list", "store_id": store_id, "path_prefix": path_prefix}
        )
        out = []
        for (sid, path), entry in self.memories.items():
            if sid != store_id:
                continue
            if path_prefix and not path.startswith(path_prefix):
                continue
            out.append(entry)
        return out


# Helper exported for tests that need to simulate the 409 without
# importing the private _Conflict class directly.
def make_conflict_error() -> Exception:
    return _Conflict("forced conflict for tests")
