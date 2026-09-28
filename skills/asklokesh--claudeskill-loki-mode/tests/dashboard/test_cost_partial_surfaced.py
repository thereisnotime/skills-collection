"""tests/dashboard/test_cost_partial_surfaced.py
S-158 (BACKLOG 118): a partly priced run is a lower bound, not a total.

autonomy/lib/efficiency_cost.py writes cost.cost_partial into proof.json when
only some records carried a price. /api/cost/timeline runs[] and /api/proofs
used to copy only cost.usd, so cost.html and proofs.html printed the lower
bound as if it were the full cost. This checks the whole chain: proof.json ->
endpoint JSON -> the page's own inline script rendering that JSON.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_STATIC = _REPO / "dashboard" / "static"


class _ForceLokiDir:
    def __init__(self, tmpdir: str):
        self.tmp = tmpdir
        self._orig = None

    def __enter__(self):
        from dashboard import server as _server
        self._orig = _server._get_loki_dir
        _server._get_loki_dir = lambda: Path(self.tmp)
        return self

    def __exit__(self, exc_type, exc, tb):
        from dashboard import server as _server
        _server._get_loki_dir = self._orig


def _client():
    from dashboard.server import app
    from fastapi.testclient import TestClient
    return TestClient(app, raise_server_exceptions=False)


# Runs the page's main inline script with fetch resolving to the given JSON,
# then prints what it wrote into #content.
_NODE_PROBE = r"""
const fs = require('node:fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const payload = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = scripts.find(s => s.includes('fetch('));
const content = { innerHTML: '' };
global.document = { getElementById: () => content,
                    documentElement: { setAttribute() {} } };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
new Function(main)();
setTimeout(() => process.stdout.write(content.innerHTML), 20);
"""


def _render(page: str, payload: dict, tmp: str) -> str:
    node = shutil.which("node")
    if not node:
        raise unittest.SkipTest("node unavailable")
    probe = Path(tmp) / "probe.js"
    probe.write_text(_NODE_PROBE)
    data = Path(tmp) / "payload.json"
    data.write_text(json.dumps(payload))
    res = subprocess.run([node, str(probe), str(_STATIC / page), str(data)],
                         capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        raise AssertionError(res.stderr)
    return res.stdout


class CostPartialSurfacedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-cost-partial-")
        proofs = Path(self.tmp) / "proofs"
        # Newest first after the endpoint sorts: partial, priced, legacy, unknown.
        fixtures = {
            "run-partial": ("2026-09-27T12:00:00Z",
                            {"usd": 1.25, "cost_partial": True}),
            "run-priced": ("2026-09-26T12:00:00Z",
                           {"usd": 0.5, "cost_partial": False}),
            "run-legacy": ("2026-09-25T12:00:00Z", {"usd": 0.75}),
            "run-unknown": ("2026-09-24T12:00:00Z",
                            {"usd": None, "cost_partial": "yes"}),
        }
        for rid, (ts, cost) in fixtures.items():
            d = proofs / rid
            d.mkdir(parents=True)
            (d / "proof.json").write_text(json.dumps(
                {"run_id": rid, "generated_at": ts, "cost": cost}))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _get(self, path):
        with _ForceLokiDir(self.tmp):
            r = _client().get(path)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def _assert_rows(self, rows):
        by_id = {r["run_id"]: r for r in rows}
        self.assertEqual(rows[0]["run_id"], "run-partial")
        self.assertIs(rows[0]["cost_partial"], True)
        self.assertIs(by_id["run-priced"]["cost_partial"], False)
        # A missing key is false, never null or absent.
        self.assertIn("cost_partial", by_id["run-legacy"])
        self.assertIs(by_id["run-legacy"]["cost_partial"], False)
        # Only a real JSON true counts.
        self.assertIs(by_id["run-unknown"]["cost_partial"], False)

    def test_timeline_runs_carry_cost_partial(self):
        self._assert_rows(self._get("/api/cost/timeline")["runs"])

    def test_proofs_list_carries_cost_partial(self):
        self._assert_rows(self._get("/api/proofs")["proofs"])

    def test_cost_page_renders_partial_as_at_least(self):
        html = _render("cost.html", self._get("/api/cost/timeline"), self.tmp)
        cells = dict(re.findall(
            r'<tr><td class="mono">(run-[a-z]+)</td>.*?'
            r'<td class="num mono">([^<]*)</td></tr>', html))
        self.assertEqual(cells.get("run-partial"), "at least $1.25", html)
        self.assertEqual(cells.get("run-priced"), "$0.50")
        self.assertEqual(cells.get("run-legacy"), "$0.75")
        self.assertEqual(cells.get("run-unknown"), "not recorded")

    def test_proofs_page_renders_partial_as_at_least(self):
        html = _render("proofs.html", self._get("/api/proofs"), self.tmp)
        usd = dict(re.findall(
            r'<span class="rid">(run-[a-z]+)</span>.*?'
            r'(?:<span class="usd">([^<]*)</span>|</a>)', html))
        self.assertEqual(usd.get("run-partial"), "at least $1.25", html)
        self.assertEqual(usd.get("run-priced"), "$0.50")
        self.assertEqual(usd.get("run-legacy"), "$0.75")
        self.assertEqual(usd.get("run-unknown"), "")
        self.assertNotIn("at least not recorded", html)


if __name__ == "__main__":
    unittest.main()
