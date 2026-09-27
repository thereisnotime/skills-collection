"""Audit chain verify: checking nothing is not a verified chain.

BACKLOG 113: verify_all_logs_in_dir() answers valid:True with files_checked:0
when there is no audit directory or every file predates integrity hashing, and
the console printed "[VALID] Audit chain integrity verified." for it. `valid`
stays as it is (it means "no break found", and the cross-chain verifier reads
it); the additive `verified` and `status` fields say whether anything was
actually checked.
"""

import json
from unittest import mock

import pytest

from dashboard import audit


def _write_chain(path, n, tamper_line=None):
    prev = "0" * 64
    lines = []
    for i in range(n):
        entry = {"timestamp": "2026-09-26T00:00:0%dZ" % i, "action": "a%d" % i}
        h = audit._compute_chain_hash(json.dumps(entry, sort_keys=True, default=str), prev)
        if tamper_line == i + 1:
            entry["action"] = "edited"
        lines.append(json.dumps(dict(entry, _integrity_hash=h)))
        prev = h
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _shapes(tmp_path):
    missing = tmp_path / "missing"
    pre = tmp_path / "pre"
    pre.mkdir()
    (pre / "audit-2020-01-01.jsonl").write_text('{"action": "old"}\n', encoding="utf-8")
    good = tmp_path / "good"
    good.mkdir()
    _write_chain(good / "audit-2026-09-26.jsonl", 3)
    bad = tmp_path / "bad"
    bad.mkdir()
    _write_chain(bad / "audit-2026-09-26.jsonl", 3, tamper_line=2)
    return missing, pre, good, bad


def test_verify_all_logs_in_dir_says_whether_anything_was_checked(tmp_path):
    missing, pre, good, bad = _shapes(tmp_path)
    for d in (missing, pre):
        r = audit.verify_all_logs_in_dir(d)
        assert r["files_checked"] == 0
        assert r["valid"] is True  # unchanged: no break was found
        assert r["verified"] is False
        assert r["status"] == "nothing_checked"
    r = audit.verify_all_logs_in_dir(good)
    assert (r["verified"], r["status"], r["files_checked"]) == (True, "verified", 1)
    r = audit.verify_all_logs_in_dir(bad)
    assert (r["valid"], r["verified"], r["status"]) == (False, False, "tampered")
    assert r["first_tampered_line"] == 2


@pytest.mark.parametrize("shape,want", [
    ("missing", "nothing_checked"),
    ("pre", "nothing_checked"),
    ("good", "verified"),
    ("bad", "tampered"),
])
def test_audit_verify_route_carries_status(tmp_path, shape, want):
    dirs = dict(zip(("missing", "pre", "good", "bad"), _shapes(tmp_path)))
    from dashboard.server import app
    from fastapi.testclient import TestClient
    with mock.patch("dashboard.audit.AUDIT_DIR", dirs[shape]):
        resp = TestClient(app, raise_server_exceptions=False).get("/api/v2/audit/verify")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == want
    assert body["verified"] is (want == "verified")
    assert "valid" in body and "files_checked" in body
