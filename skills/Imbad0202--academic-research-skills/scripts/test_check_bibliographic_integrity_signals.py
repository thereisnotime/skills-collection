"""Tests for the #678 canonical bibliographic-integrity signal carrier."""
from __future__ import annotations

import copy
import json
import shutil
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


SCRIPTS = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import bibliographic_integrity_signals as signals  # noqa: E402
import check_bibliographic_integrity_signals as checker  # noqa: E402


def _fixture(name: str) -> dict:
    path = SCRIPTS / "fixtures/bibliographic_integrity_signals" / name
    return json.loads(path.read_text(encoding="utf-8"))


def _validator() -> Draft202012Validator:
    return Draft202012Validator(
        signals.load_schema(), format_checker=Draft202012Validator.FORMAT_CHECKER
    )


def test_all_epistemic_class_fixtures_round_trip() -> None:
    for name in (
        "retraction.json",
        "retraction_check_attestation.json",
        "tortured_phrase.json",
    ):
        fixture = _fixture(name)
        assert not list(_validator().iter_errors(fixture))
        assert json.loads(json.dumps(fixture)) == fixture


def test_closed_schema_rejects_undeclared_field() -> None:
    fixture = _fixture("retraction.json")
    fixture["undeclared"] = True
    assert any("Additional properties" in err.message for err in _validator().iter_errors(fixture))


def test_heuristic_cannot_use_deterministic_label() -> None:
    fixture = _fixture("tortured_phrase.json")
    fixture["epistemic_label"] = "RESOLVER-OR-LIST-OBSERVATION"
    assert list(_validator().iter_errors(fixture))


def test_unknown_or_degraded_can_never_be_clean() -> None:
    fixture = _fixture("retraction.json")
    fixture["check_status"] = "degraded"
    fixture["finding"] = "not_detected"
    assert list(_validator().iter_errors(fixture))


def test_legacy_migration_preserves_epistemic_boundaries() -> None:
    entry = {
        "citation_key": "legacy2024",
        "source_pointer": "zotero://select/items/0_LEGACY",
        "obtained_at": "2026-08-01T00:00:00Z",
        "contamination_signals": {
            "preprint_post_llm_inflection": True,
            "semantic_scholar_unmatched": False,
        },
        "contamination_signal_omissions": {"openalex_unmatched": "api_degraded"},
        "retraction_check": True,
    }
    migrated = signals.migrate_legacy_entry(
        entry, recorded_at="2026-08-08T00:00:00Z"
    )
    by_type = {item["signal_type"]: item for item in migrated}
    assert by_type["preprint_post_llm_inflection"]["epistemic_class"] == "heuristic_advisory"
    assert by_type["semantic_scholar_unmatched"]["epistemic_class"] == "deterministic_fact"
    assert by_type["openalex_unmatched"]["check_status"] == "degraded"
    assert by_type["openalex_unmatched"]["finding"] == "unresolved"
    assert by_type["retraction_status"]["epistemic_class"] == "process_attestation"
    assert by_type["retraction_status"]["finding"] == "unresolved"
    assert all(not signals.validation_errors(item) for item in migrated)
    assert "contamination_signals" in entry
    assert "retraction_check" in entry


def test_multiple_signals_compose_in_one_section_without_marker_token() -> None:
    fixtures = [_fixture("retraction.json"), _fixture("tortured_phrase.json")]
    rendered = signals.render_advisory_section(fixtures)
    assert rendered.count("## Bibliographic Integrity Advisories") == 1
    assert "CONTAMINATED-" not in rendered
    assert "<!--ref:" not in rendered
    assert rendered.index("bis:jones2025") < rendered.index("bis:smith2024")
    for heading in (
        "signal type",
        "source version",
        "source sha256",
        "checked at",
        "recorded at",
        "stale after",
        "source pointer",
    ):
        assert heading in rendered


def test_checked_but_unresolved_attestation_is_visibly_not_clean() -> None:
    rendered = signals.render_advisory_section(
        [_fixture("retraction_check_attestation.json")]
    )
    assert "| checked | NOT CLEAN — UNRESOLVED |" in rendered


def _minimal_repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    paths = [
        "shared/contracts/passport/bibliographic_integrity_signal.schema.json",
        "shared/contracts/passport/literature_corpus_entry.schema.json",
        "shared/bibliographic_integrity_signals.md",
        "shared/handoff_schemas.md",
        "academic-pipeline/agents/pipeline_orchestrator_agent.md",
        "academic-paper/agents/formatter_agent.md",
        "scripts/fixtures/bibliographic_integrity_signals/retraction.json",
        "scripts/fixtures/bibliographic_integrity_signals/retraction_check_attestation.json",
        "scripts/fixtures/bibliographic_integrity_signals/tortured_phrase.json",
    ]
    for relative in paths:
        source = REPO_ROOT / relative
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return root


def test_sync_checker_passes_current_repo() -> None:
    assert checker.run_checks(REPO_ROOT) == []


def test_sync_checker_detects_formatter_drift(tmp_path: Path) -> None:
    root = _minimal_repo(tmp_path)
    path = root / "academic-paper/agents/formatter_agent.md"
    text = path.read_text(encoding="utf-8").replace(
        "**NOT CLEAN — UNRESOLVED**", "**CLEAN**"
    )
    path.write_text(text, encoding="utf-8")
    found = checker.run_checks(root)
    assert any("formatter_agent.md" in error for error in found)


def test_existing_canonical_record_wins_idempotently() -> None:
    fixture = _fixture("retraction.json")
    entry = {
        "citation_key": "smith2024",
        "retraction_check": True,
        "bibliographic_integrity_signals": [copy.deepcopy(fixture)],
    }
    migrated = signals.migrate_legacy_entry(
        entry, recorded_at="2026-08-08T01:00:00Z"
    )
    assert migrated == [fixture]


@pytest.mark.parametrize(
    "existing",
    [
        [{}],
        [{"signal_id": ""}],
        [
            {"signal_id": "bis:smith2024:retraction_status"},
            {"signal_id": "bis:smith2024:retraction_status"},
        ],
    ],
)
def test_lossy_existing_carrier_is_rejected(existing: list[dict]) -> None:
    entry = {
        "citation_key": "smith2024",
        "bibliographic_integrity_signals": existing,
    }
    with pytest.raises(ValueError):
        signals.migrate_legacy_entry(entry, recorded_at="2026-08-08T01:00:00Z")


def test_evidence_cannot_be_empty() -> None:
    fixture = _fixture("retraction.json")
    fixture["evidence"] = []
    assert list(_validator().iter_errors(fixture))


def test_handoff_source_id_projects_to_a_schema_safe_stable_signal_id() -> None:
    entry = {"id": "[S01]", "retraction_check": False}
    first = signals.migrate_legacy_entry(
        entry, recorded_at="2026-08-08T01:00:00Z"
    )
    second = signals.migrate_legacy_entry(
        entry, recorded_at="2026-08-08T01:00:00Z"
    )
    assert first == second
    assert first[0]["subject"]["citation_key"] == "[S01]"
    assert first[0]["signal_id"].startswith("bis:source-")
    assert not signals.validation_errors(first[0])
