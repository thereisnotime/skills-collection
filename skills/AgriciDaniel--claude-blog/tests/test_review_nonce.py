"""Nonce-bound review.md provenance tests (VULN-803, v1.9.1).

Gate 4 v1.9.0 trusted any writer of <draft>/review.md. The 5-gate
contract collapsed to '4 gates + 1 filesystem write the orchestrator
trusts.' v1.9.1 adds nonce-bound provenance:

  1. Before dispatching the blog-reviewer agent, the orchestrator runs
     `blog_preflight.py --init-review-nonce --draft <dir>` which writes
     a CSPRNG nonce to <draft>/.review-nonce.
  2. The agent's prompt template includes the nonce; the agent emits
     `Nonce: <NONCE>` somewhere in review.md.
  3. Gate 4 reads .review-nonce, then verifies review.md contains
     `Nonce: <matching value>`. Missing or mismatched -> gate fails.

Backwards compat for v1.9.x: if .review-nonce is absent, Gate 4 emits
a deprecation warning but does not block. v1.10.0 will make the nonce
mandatory.
"""
from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT = ROOT / "scripts" / "blog_preflight.py"


@pytest.fixture
def preflight_module(monkeypatch):
    spec = importlib.util.spec_from_file_location("blog_preflight", PREFLIGHT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["blog_preflight_test_mod"] = mod
    spec.loader.exec_module(mod)
    return mod


def _make_draft(tmp_path: Path, review_text: str = "", nonce_text: str | None = None) -> Path:
    draft = tmp_path / "post"
    draft.mkdir()
    if review_text:
        (draft / "review.md").write_text(review_text, encoding="utf-8")
    if nonce_text is not None:
        (draft / ".review-nonce").write_text(nonce_text, encoding="utf-8")
    return draft


def test_init_review_nonce_creates_file_with_csprng_value(tmp_path, preflight_module):
    draft = tmp_path / "post"
    draft.mkdir()
    preflight_module._init_review_nonce(draft)
    nonce_file = draft / ".review-nonce"
    assert nonce_file.exists()
    nonce_value = nonce_file.read_text(encoding="utf-8").strip()
    # 32 hex chars (16 bytes via secrets.token_hex(16))
    assert re.fullmatch(r"[0-9a-f]{32}", nonce_value), (
        f"nonce must be 32 hex chars, got {nonce_value!r}"
    )


def test_init_review_nonce_overwrites_existing(tmp_path, preflight_module):
    draft = tmp_path / "post"
    draft.mkdir()
    (draft / ".review-nonce").write_text("OLDNONCE", encoding="utf-8")
    preflight_module._init_review_nonce(draft)
    assert (draft / ".review-nonce").read_text(encoding="utf-8").strip() != "OLDNONCE"


def test_gate_4_passes_when_nonce_matches(tmp_path, preflight_module):
    nonce = "a" * 32
    review = f"Scorecard...\nNonce: {nonce}\nBLOCKING: false (cleared)\n"
    draft = _make_draft(tmp_path, review_text=review, nonce_text=nonce)
    result = preflight_module.gate_4_content_review(draft)
    assert result["passed"] is True, f"Gate should pass with matching nonce: {result}"


def test_gate_4_fails_when_nonce_file_present_but_review_lacks_nonce(tmp_path, preflight_module):
    nonce = "b" * 32
    review = "Scorecard...\nBLOCKING: false (cleared)\n"  # no Nonce: line
    draft = _make_draft(tmp_path, review_text=review, nonce_text=nonce)
    result = preflight_module.gate_4_content_review(draft)
    assert result["passed"] is False, "Gate should fail when nonce file exists but review lacks Nonce: line"
    assert any("nonce" in v.lower() for v in result.get("violations", []))


def test_gate_4_fails_when_review_has_wrong_nonce(tmp_path, preflight_module):
    real_nonce = "c" * 32
    fake_nonce = "d" * 32
    review = f"Scorecard...\nNonce: {fake_nonce}\nBLOCKING: false (cleared)\n"
    draft = _make_draft(tmp_path, review_text=review, nonce_text=real_nonce)
    result = preflight_module.gate_4_content_review(draft)
    assert result["passed"] is False, "Gate should fail on nonce mismatch"
    assert any("nonce" in v.lower() for v in result.get("violations", []))


def test_gate_4_soft_pass_when_nonce_file_absent_backwards_compat(tmp_path, preflight_module):
    """v1.9.x backwards compat: drafts initialised before v1.9.1 (no nonce file)
    pass with a deprecation warning, do not block."""
    review = "Scorecard...\nBLOCKING: false (cleared)\n"
    draft = _make_draft(tmp_path, review_text=review)  # no nonce file
    assert not (draft / ".review-nonce").exists()
    result = preflight_module.gate_4_content_review(draft)
    assert result["passed"] is True, "Backwards-compat path must not block on missing nonce file"
    assert any("nonce" in w.lower() for w in result.get("warnings", [])), (
        "Must emit deprecation warning when nonce file is absent"
    )


def test_gate_4_nonce_must_be_exact_match_no_suffix_attack(tmp_path, preflight_module):
    """Nonce match must be word-bounded; substring match shouldn't fool the gate."""
    nonce = "e" * 32
    # Attacker emits a different 32-char string that contains the real nonce as
    # a prefix or suffix in raw text.
    leaked = nonce + "f" * 4  # 36 chars, starts with the real nonce
    review = f"Some text containing the leaked nonce.\nNonce: {leaked}\nBLOCKING: false\n"
    draft = _make_draft(tmp_path, review_text=review, nonce_text=nonce)
    result = preflight_module.gate_4_content_review(draft)
    assert result["passed"] is False, "Suffix attack on nonce match must be refused"


def test_init_review_nonce_cli_flag(tmp_path):
    """`blog_preflight.py --init-review-nonce --draft <dir>` exits 0 and writes the file."""
    draft = tmp_path / "post"
    draft.mkdir()
    result = subprocess.run(
        [sys.executable, str(PREFLIGHT), "--init-review-nonce", "--draft", str(draft)],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    assert result.returncode == 0, (
        f"--init-review-nonce should exit 0; stdout={result.stdout!r} stderr={result.stderr!r}"
    )
    assert (draft / ".review-nonce").exists()
    value = (draft / ".review-nonce").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"[0-9a-f]{32}", value)
