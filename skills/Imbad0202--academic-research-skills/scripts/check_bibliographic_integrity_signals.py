#!/usr/bin/env python3
"""Drift guard for the #678 bibliographic-integrity signal contract."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


DEFAULT_REPO_ROOT = Path(__file__).resolve().parent.parent


def _load(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load {path}: {exc}")
        return None
    if not isinstance(value, dict):
        errors.append(f"{path}: expected a JSON object")
        return None
    return value


def run_checks(repo_root: Path) -> list[str]:
    errors: list[str] = []
    schema_path = (
        repo_root
        / "shared/contracts/passport/bibliographic_integrity_signal.schema.json"
    )
    schema = _load(schema_path, errors)
    if schema is None:
        return errors
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:  # pragma: no cover - exercised by the CLI guard
        errors.append(f"invalid canonical schema: {exc}")
        return errors
    validator = Draft202012Validator(
        schema, format_checker=Draft202012Validator.FORMAT_CHECKER
    )

    required = set(schema.get("required", []))
    expected = {
        "schema_version",
        "signal_id",
        "signal_type",
        "epistemic_class",
        "epistemic_label",
        "check_status",
        "finding",
        "evidence",
        "provenance",
        "subject",
        "terminal_policy",
        "display",
    }
    if required != expected:
        errors.append("canonical schema required-field set drifted")

    fixtures_dir = repo_root / "scripts/fixtures/bibliographic_integrity_signals"
    fixtures: list[dict[str, Any]] = []
    for fixture_path in sorted(fixtures_dir.glob("*.json")):
        fixture = _load(fixture_path, errors)
        if fixture is None:
            continue
        fixture_errors = sorted(validator.iter_errors(fixture), key=lambda err: list(err.path))
        for err in fixture_errors:
            errors.append(f"{fixture_path}: {err.message}")
        if json.loads(json.dumps(fixture, sort_keys=True)) != fixture:
            errors.append(f"{fixture_path}: JSON round-trip changed the fixture")
        fixtures.append(fixture)
    fixture_types = {fixture.get("signal_type") for fixture in fixtures}
    if not {"retraction_status", "tortured_phrase_match"}.issubset(fixture_types):
        errors.append("fixtures must cover both #651 retraction and #660 tortured phrase")
    fixture_classes = {fixture.get("epistemic_class") for fixture in fixtures}
    if fixture_classes != {
        "deterministic_fact",
        "heuristic_advisory",
        "process_attestation",
    }:
        errors.append("fixtures must cover all three epistemic classes")
    labels = {
        fixture.get("epistemic_class"): fixture.get("epistemic_label")
        for fixture in fixtures
    }
    if labels.get("deterministic_fact") == labels.get("heuristic_advisory"):
        errors.append("deterministic facts and heuristics share an epistemic label")
    if any(fixture.get("display", {}).get("marker_token") is not None for fixture in fixtures):
        errors.append("v1 fixture minted a ref-marker advisory token")

    entry_schema = _load(
        repo_root / "shared/contracts/passport/literature_corpus_entry.schema.json",
        errors,
    )
    if entry_schema is not None:
        carrier = entry_schema.get("properties", {}).get(
            "bibliographic_integrity_signals"
        )
        if not isinstance(carrier, dict) or carrier.get("type") != "array":
            errors.append("literature corpus schema does not declare the canonical array")

    text_requirements = {
        "shared/bibliographic_integrity_signals.md": (
            "single schema authority",
            "NOT CLEAN — UNRESOLVED",
            "Pinned migration and deprecation path",
            "legacy `retraction_check: true`",
        ),
        "academic-pipeline/agents/pipeline_orchestrator_agent.md": (
            "Canonical bibliographic-integrity carrier (#678)",
            "The finalizer writes no",
            "`display.marker_token`",
            "never clean results",
        ),
        "academic-paper/agents/formatter_agent.md": (
            "Bibliographic Integrity Advisories (#678)",
            "sort rows lexically by `signal_id`",
            "Never mint",
            "NOT CLEAN — UNRESOLVED",
        ),
        "shared/handoff_schemas.md": (
            "Legacy execution attestation",
            "`true` never means",
        ),
    }
    for relative, needles in text_requirements.items():
        path = repo_root / relative
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            errors.append(f"cannot read {path}: {exc}")
            continue
        normalized = " ".join(text.split())
        for needle in needles:
            if needle not in text and needle not in normalized:
                errors.append(f"{relative}: missing sync anchor {needle!r}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    args = parser.parse_args()
    errors = run_checks(args.repo_root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Bibliographic-integrity signal contract: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
