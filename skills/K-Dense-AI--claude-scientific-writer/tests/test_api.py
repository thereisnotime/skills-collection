"""Tests for scientific_writer.api model resolution and result building."""

from datetime import datetime, timezone

from scientific_writer import api
from scientific_writer.utils import scan_paper_directory


class TestEffortLevelModels:
    def test_three_effort_levels_exist(self):
        assert set(api.EFFORT_LEVEL_MODELS) == {"low", "medium", "high"}

    def test_effort_level_model_assignments(self):
        assert api.EFFORT_LEVEL_MODELS["low"] == "claude-haiku-4-5"
        assert api.EFFORT_LEVEL_MODELS["medium"] == "claude-opus-4-8"
        assert api.EFFORT_LEVEL_MODELS["high"] == "claude-opus-4-8"

    def test_no_effort_level_uses_fable(self):
        """Project policy: Opus 4.8 is the top tier; nothing selects Fable."""
        for model in api.EFFORT_LEVEL_MODELS.values():
            assert "fable" not in model.lower()

    def test_map_is_shared_with_core(self):
        """One source of truth: api re-exports the map defined in core."""
        from scientific_writer.core import EFFORT_LEVEL_MODELS

        assert api.EFFORT_LEVEL_MODELS is EFFORT_LEVEL_MODELS


def test_build_paper_result_created_at_is_utc(tmp_path):
    paper_dir = tmp_path / "20250101_120000_demo_topic"
    paper_dir.mkdir()
    file_info = scan_paper_directory(paper_dir)

    result = api._build_paper_result(paper_dir, file_info)

    parsed = datetime.fromisoformat(result.metadata.created_at)
    assert parsed.tzinfo is not None
    expected = datetime.fromtimestamp(paper_dir.stat().st_ctime, tz=timezone.utc)
    assert abs((parsed - expected).total_seconds()) < 1
