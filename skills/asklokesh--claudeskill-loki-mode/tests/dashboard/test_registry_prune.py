"""Tests for registry hygiene: prune_missing_projects + the project switcher.

The registry (~/.loki/dashboard/projects.json) records every cwd ever seen by
`loki start` and, before this change, never garbage-collected. Dead / renamed /
temp project directories accumulated forever, bloating the dashboard project
switcher (fed by GET /api/running-projects) with paths that no longer exist.

These tests pin the two halves of the fix:

  1. registry.prune_missing_projects removes only entries whose path is gone AND
     which are not running, atomically and idempotently. Running projects (by id
     or by a live recorded pid) are retained even if the disk check would fail.
  2. GET /api/running-projects returns a CLEAN list (existing-or-running only),
     opportunistically prunes dead entries from the on-disk store, and never
     leaks the internal sort key.

HERMETICITY
-----------
registry.REGISTRY_DIR / REGISTRY_FILE are read at call time (not import time),
so each test redirects them to a per-test temp dir. The real ~/.loki is never
touched. Liveness uses this test process's own pid for "running" entries.
"""

from __future__ import annotations

import os
import tempfile
import shutil
import unittest
from pathlib import Path

import dashboard.registry as registry


class _TempRegistry(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-registry-prune-test-")
        self._orig_dir = registry.REGISTRY_DIR
        self._orig_file = registry.REGISTRY_FILE
        reg_dir = Path(self.tmp) / "registry"
        reg_dir.mkdir(parents=True, exist_ok=True)
        registry.REGISTRY_DIR = reg_dir
        registry.REGISTRY_FILE = reg_dir / "projects.json"

    def tearDown(self):
        registry.REGISTRY_DIR = self._orig_dir
        registry.REGISTRY_FILE = self._orig_file
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _real_dir(self, name: str) -> str:
        d = os.path.join(self.tmp, name)
        os.makedirs(d, exist_ok=True)
        return d

    def _inject(self, name: str, path: str, pid=None) -> str:
        """Insert a raw registry entry (path need not exist) and return its id."""
        reg = registry._load_registry()
        project_id = registry._generate_project_id(path)
        reg["projects"][project_id] = {
            "id": project_id,
            "path": path,
            "name": name,
            "status": "active",
            "pid": pid,
        }
        registry._save_registry(reg)
        return project_id


class PruneMissingProjectsTest(_TempRegistry):
    def test_prunes_dead_keeps_real_and_running(self):
        # 3 real dirs.
        real_ids = [
            registry.register_project(self._real_dir(n), name=n)["id"]
            for n in ("a", "b", "c")
        ]
        # 5 nonexistent paths; one of them has a live pid (this process) so it
        # represents a running build whose dir momentarily fails to stat.
        fake_ids = [
            self._inject(f"gone-{i}", os.path.join(self.tmp, f"gone-{i}"))
            for i in range(5)
        ]
        running_fake = self._inject(
            "gone-running", os.path.join(self.tmp, "gone-running"), pid=os.getpid()
        )

        self.assertEqual(len(registry._load_registry()["projects"]), 9)

        pruned = registry.prune_missing_projects()
        pruned_ids = {p["id"] for p in pruned}
        self.assertEqual(pruned_ids, set(fake_ids))  # the 5 dead-idle entries

        survivors = set(registry._load_registry()["projects"])
        for rid in real_ids:
            self.assertIn(rid, survivors)
        # Live-pid entry kept despite missing path.
        self.assertIn(running_fake, survivors)
        for fid in fake_ids:
            self.assertNotIn(fid, survivors)

    def test_running_ids_override_retains_dead_path(self):
        dead = self._inject("keep-me", os.path.join(self.tmp, "keep-me"))
        pruned = registry.prune_missing_projects(running_ids={dead})
        self.assertEqual(pruned, [])
        self.assertIn(dead, registry._load_registry()["projects"])

    def test_idempotent_when_all_valid(self):
        registry.register_project(self._real_dir("a"), name="a")
        # First prune leaves the real dir untouched; second is a no-op.
        self.assertEqual(registry.prune_missing_projects(), [])
        self.assertEqual(registry.prune_missing_projects(), [])

    def test_no_save_when_nothing_pruned(self):
        # An all-valid registry must not be rewritten (returns empty list).
        registry.register_project(self._real_dir("a"), name="a")
        before = registry.REGISTRY_FILE.read_text()
        pruned = registry.prune_missing_projects()
        self.assertEqual(pruned, [])
        self.assertEqual(registry.REGISTRY_FILE.read_text(), before)


class RunningProjectsSwitcherTest(_TempRegistry):
    def test_clean_list_excludes_and_prunes_dead(self):
        try:
            from fastapi.testclient import TestClient
            import httpx  # noqa: F401
        except Exception:
            self.skipTest("fastapi TestClient / httpx not available")

        # Two real dirs (one running via live pid), one dead-but-running, three
        # dead-idle paths.
        real_running = self._real_dir("running")
        real_idle = self._real_dir("idle")
        rid = registry.register_project(real_running, name="running")["id"]
        registry.register_project(real_idle, name="idle")

        reg = registry._load_registry()
        reg["projects"][rid]["pid"] = os.getpid()
        registry._save_registry(reg)

        self._inject(
            "dead-running",
            os.path.join(self.tmp, "dead-running"),
            pid=os.getpid(),
        )
        dead_idle = [
            self._inject(f"dead-{i}", os.path.join(self.tmp, f"dead-{i}"))
            for i in range(3)
        ]

        self.assertEqual(len(registry._load_registry()["projects"]), 6)

        import dashboard.server as server

        client = TestClient(server.app, raise_server_exceptions=False)
        resp = client.get("/api/running-projects")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        names = sorted(p["name"] for p in data["projects"])
        # dead-idle paths are excluded from the response.
        self.assertEqual(names, ["dead-running", "idle", "running"])
        # internal sort key must not leak.
        self.assertTrue(all("_last_accessed" not in p for p in data["projects"]))

        # dead-idle entries pruned from the on-disk store; dead-running survives.
        remaining = set(registry._load_registry()["projects"])
        for did in dead_idle:
            self.assertNotIn(did, remaining)
        self.assertEqual(len(remaining), 3)


if __name__ == "__main__":
    unittest.main()
