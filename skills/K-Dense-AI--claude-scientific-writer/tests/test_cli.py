"""Tests for scientific_writer.cli."""

import inspect

from scientific_writer import cli


def test_help_mentions_current_research_backend(capsys):
    cli._print_help()
    out = capsys.readouterr().out
    assert "Perplexity" not in out
    assert "Parallel" in out


def test_cli_source_has_no_stale_backend_or_blocking_sleep():
    source = inspect.getsource(cli)
    assert "Perplexity" not in source, "CLI still references the removed Perplexity backend"
    assert "time.sleep(" not in source, "blocking sleep inside the async event loop"


class TestResolveModel:
    def test_default_effort_is_medium_opus(self):
        assert cli._resolve_model() == "claude-opus-4-8"

    def test_effort_levels_resolve_via_shared_map(self):
        from scientific_writer.core import EFFORT_LEVEL_MODELS

        for level, model in EFFORT_LEVEL_MODELS.items():
            assert cli._resolve_model(level) == model

    def test_unknown_effort_falls_back_to_medium(self):
        assert cli._resolve_model("turbo") == "claude-opus-4-8"
