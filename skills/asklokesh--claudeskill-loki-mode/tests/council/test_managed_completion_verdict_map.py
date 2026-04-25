"""
tests/council/test_managed_completion_verdict_map.py

v7.0.0 Phase 4: VotingResult must map correctly onto the legacy verdict file
layout consumed by council_aggregate_votes in autonomy/completion-council.sh.

The Bash wrapper (council_managed_should_stop) writes a per-role file at
$COUNCIL_STATE_DIR/verdicts/<role>.txt with two/three lines:
    VOTE: <APPROVE|REJECT|CANNOT_VALIDATE>
    REASON: <free text>
    [optional] ISSUES: <SEVERITY>: <desc>

This test re-implements the same projection rules in-process (the Bash code
runs the mapping inside a heredoc, but the logic is plain Python), feeds in a
crafted VotingResult, and asserts the resulting files have the expected
shape. The projection rules:

    STOP           -> APPROVE
    CONTINUE       -> REJECT
    REQUEST_CHANGES -> REJECT
    ABSTAIN / UNKNOWN -> CANNOT_VALIDATE

If vote.severity is set, an extra ISSUES line is appended.

Also covers:
    - Majority fixture cases (all STOP, all CONTINUE, mixed)
    - Reason truncation (> 2000 chars)
    - CRLF sanitization
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path


# Add repo root to path so we can import providers.managed if it's there
# (only needed to borrow the AgentVerdict / VotingResult dataclasses).
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))


try:
    from providers.managed import AgentVerdict, VotingResult
    HAS_MANAGED = True
except ImportError:  # worktree may not have providers/managed.py yet
    HAS_MANAGED = False

    # Minimal shim mirroring the dataclass shape.
    from dataclasses import dataclass, field
    from typing import Any, Dict, List, Optional

    @dataclass
    class AgentVerdict:  # type: ignore[no-redef]
        agent_id: str
        pool_name: str
        verdict: str
        rationale: str = ""
        severity: Optional[str] = None
        raw: Dict[str, Any] = field(default_factory=dict)

    @dataclass
    class VotingResult:  # type: ignore[no-redef]
        votes: List[AgentVerdict] = field(default_factory=list)
        majority: Optional[str] = None
        session_id: Optional[str] = None
        elapsed_ms: int = 0
        partial: bool = False


# Re-implementation of the projection rules used by council_managed_should_stop.
# Kept intentionally close to the inline Python heredoc in completion-council.sh
# so the two stay in sync.
def _vote_to_legacy(verdict_str: str) -> str:
    v = (verdict_str or "").upper()
    if v in ("STOP", "APPROVE"):
        return "APPROVE"
    if v in ("CONTINUE", "REJECT", "REQUEST_CHANGES"):
        return "REJECT"
    return "CANNOT_VALIDATE"


def _project_verdicts(result: VotingResult, verdicts_dir: Path) -> dict:
    verdicts_dir.mkdir(parents=True, exist_ok=True)
    summary = {"voters": []}
    for vote in result.votes:
        role = vote.pool_name or "unknown_voter"
        legacy = _vote_to_legacy(vote.verdict)
        reason = (vote.rationale or "").replace("\r", " ").strip()
        if len(reason) > 2000:
            reason = reason[:2000] + "... [truncated]"
        lines = [
            f"VOTE: {legacy}",
            f"REASON: {reason or 'managed council: no rationale'}",
        ]
        if vote.severity:
            lines.append(f"ISSUES: {vote.severity.upper()}: managed voter flagged issue")
        (verdicts_dir / f"{role}.txt").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        summary["voters"].append({"role": role, "legacy": legacy})
    return summary


class VerdictMapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-verdict-map-")
        self.verdicts_dir = Path(self.tmp) / "verdicts"

    def _parse_vote_file(self, role: str) -> dict:
        text = (self.verdicts_dir / f"{role}.txt").read_text(encoding="utf-8")
        out = {"role": role, "raw": text}
        m = re.search(r"^VOTE:\s*(\w+)", text, re.MULTILINE)
        out["vote"] = m.group(1) if m else None
        m = re.search(r"^REASON:\s*(.*)$", text, re.MULTILINE)
        out["reason"] = m.group(1) if m else None
        m = re.search(r"^ISSUES:\s*(\w+):", text, re.MULTILINE)
        out["severity"] = m.group(1) if m else None
        return out

    def test_stop_maps_to_approve(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="requirements_verifier",
                         verdict="STOP", rationale="all requirements met"),
            AgentVerdict(agent_id="a2", pool_name="test_auditor",
                         verdict="STOP", rationale="tests passing"),
            AgentVerdict(agent_id="a3", pool_name="devils_advocate",
                         verdict="STOP", rationale="no issues found"),
        ], majority="STOP")
        _project_verdicts(result, self.verdicts_dir)
        for role in ("requirements_verifier", "test_auditor", "devils_advocate"):
            parsed = self._parse_vote_file(role)
            self.assertEqual(parsed["vote"], "APPROVE", msg=parsed["raw"])
            self.assertTrue(parsed["reason"])

    def test_continue_maps_to_reject(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="requirements_verifier",
                         verdict="CONTINUE", rationale="PRD item 3 not done"),
            AgentVerdict(agent_id="a2", pool_name="test_auditor",
                         verdict="CONTINUE", rationale="2 tests failing"),
            AgentVerdict(agent_id="a3", pool_name="devils_advocate",
                         verdict="CONTINUE", rationale="suspicious mocks"),
        ], majority="CONTINUE")
        _project_verdicts(result, self.verdicts_dir)
        for role in ("requirements_verifier", "test_auditor", "devils_advocate"):
            parsed = self._parse_vote_file(role)
            self.assertEqual(parsed["vote"], "REJECT")

    def test_request_changes_maps_to_reject(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="requirements_verifier",
                         verdict="REQUEST_CHANGES", rationale="missing feature"),
        ])
        _project_verdicts(result, self.verdicts_dir)
        self.assertEqual(self._parse_vote_file("requirements_verifier")["vote"], "REJECT")

    def test_abstain_maps_to_cannot_validate(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="test_auditor",
                         verdict="ABSTAIN", rationale="no message from voter"),
            AgentVerdict(agent_id="a2", pool_name="devils_advocate",
                         verdict="", rationale=""),
        ])
        _project_verdicts(result, self.verdicts_dir)
        self.assertEqual(self._parse_vote_file("test_auditor")["vote"], "CANNOT_VALIDATE")
        self.assertEqual(self._parse_vote_file("devils_advocate")["vote"], "CANNOT_VALIDATE")

    def test_severity_passed_through_as_issues(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="devils_advocate",
                         verdict="CONTINUE", rationale="mocked tests",
                         severity="high"),
        ])
        _project_verdicts(result, self.verdicts_dir)
        parsed = self._parse_vote_file("devils_advocate")
        self.assertEqual(parsed["vote"], "REJECT")
        self.assertEqual(parsed["severity"], "HIGH")

    def test_reason_truncation(self):
        long_text = "x" * 5000
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="requirements_verifier",
                         verdict="CONTINUE", rationale=long_text),
        ])
        _project_verdicts(result, self.verdicts_dir)
        parsed = self._parse_vote_file("requirements_verifier")
        self.assertIn("[truncated]", parsed["raw"])
        # Body should not exceed 2000 + truncation marker + framing.
        self.assertLess(len(parsed["raw"]), 2100)

    def test_crlf_sanitized(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="devils_advocate",
                         verdict="CONTINUE",
                         rationale="line1\r\nline2\rline3"),
        ])
        _project_verdicts(result, self.verdicts_dir)
        raw = (self.verdicts_dir / "devils_advocate.txt").read_text(encoding="utf-8")
        self.assertNotIn("\r", raw)

    def test_empty_rationale_gets_default(self):
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="test_auditor",
                         verdict="STOP", rationale=""),
        ])
        _project_verdicts(result, self.verdicts_dir)
        parsed = self._parse_vote_file("test_auditor")
        self.assertEqual(parsed["vote"], "APPROVE")
        self.assertIn("no rationale", parsed["reason"])

    def test_majority_semantics_on_mixed_votes(self):
        # Mixed result: 2 STOP, 1 CONTINUE. All three files should be
        # materialized; the majority field on VotingResult should reflect STOP.
        result = VotingResult(votes=[
            AgentVerdict(agent_id="a1", pool_name="requirements_verifier",
                         verdict="STOP", rationale="req ok"),
            AgentVerdict(agent_id="a2", pool_name="test_auditor",
                         verdict="STOP", rationale="tests ok"),
            AgentVerdict(agent_id="a3", pool_name="devils_advocate",
                         verdict="CONTINUE", rationale="not convinced"),
        ], majority="STOP")
        _project_verdicts(result, self.verdicts_dir)
        self.assertEqual(self._parse_vote_file("requirements_verifier")["vote"], "APPROVE")
        self.assertEqual(self._parse_vote_file("test_auditor")["vote"], "APPROVE")
        self.assertEqual(self._parse_vote_file("devils_advocate")["vote"], "REJECT")
        self.assertEqual(result.majority, "STOP")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
