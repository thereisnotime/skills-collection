"""Tests for AgentPerformanceTracker."""

import json
import os
import tempfile
import pytest
from swarm.performance import AgentPerformanceTracker, MAX_RECENT_SCORES


@pytest.fixture
def tmp_storage(tmp_path):
    """Return a path to a temp storage file that doesn't exist yet."""
    return str(tmp_path / "agent-performance.json")


@pytest.fixture
def tracker(tmp_storage):
    """Fresh tracker with temp storage."""
    return AgentPerformanceTracker(storage_path=tmp_storage)


# -------------------------------------------------------------------------
# record_task_completion
# -------------------------------------------------------------------------

class TestRecordTaskCompletion:
    def test_basic_recording(self, tracker):
        tracker.record_task_completion("eng-qa", 0.8, 120.0)
        data = tracker.get_agent_data("eng-qa")
        assert data is not None
        assert data["total_tasks"] == 1
        assert data["avg_quality"] == 0.8
        assert data["avg_duration"] == 120.0

    def test_running_average(self, tracker):
        tracker.record_task_completion("eng-qa", 0.6, 100.0)
        tracker.record_task_completion("eng-qa", 0.8, 200.0)
        data = tracker.get_agent_data("eng-qa")
        assert data["total_tasks"] == 2
        assert data["avg_quality"] == pytest.approx(0.7, abs=0.001)
        assert data["avg_duration"] == pytest.approx(150.0, abs=0.1)

    def test_quality_clamped_above_1(self, tracker):
        tracker.record_task_completion("eng-qa", 1.5, 10.0)
        data = tracker.get_agent_data("eng-qa")
        assert data["avg_quality"] == 1.0

    def test_quality_clamped_below_0(self, tracker):
        tracker.record_task_completion("eng-qa", -0.5, 10.0)
        data = tracker.get_agent_data("eng-qa")
        assert data["avg_quality"] == 0.0

    def test_duration_clamped_below_0(self, tracker):
        tracker.record_task_completion("eng-qa", 0.5, -100.0)
        data = tracker.get_agent_data("eng-qa")
        assert data["avg_duration"] == 0.0

    def test_multiple_agent_types_independent(self, tracker):
        tracker.record_task_completion("eng-qa", 0.9, 50.0)
        tracker.record_task_completion("eng-frontend", 0.7, 100.0)
        assert tracker.get_agent_data("eng-qa")["avg_quality"] == 0.9
        assert tracker.get_agent_data("eng-frontend")["avg_quality"] == 0.7

    def test_last_updated_set(self, tracker):
        tracker.record_task_completion("eng-qa", 0.8, 10.0)
        data = tracker.get_agent_data("eng-qa")
        assert data["last_updated"] != ""
        # Should contain a valid ISO-like timestamp
        assert "T" in data["last_updated"]


# -------------------------------------------------------------------------
# Recent scores window
# -------------------------------------------------------------------------

class TestRecentScoresWindow:
    def test_scores_accumulated(self, tracker):
        for i in range(5):
            tracker.record_task_completion("eng-qa", 0.5 + i * 0.1, 10.0)
        data = tracker.get_agent_data("eng-qa")
        assert len(data["recent_scores"]) == 5

    def test_trimmed_at_max(self, tracker):
        for i in range(MAX_RECENT_SCORES + 10):
            tracker.record_task_completion("eng-qa", 0.5, 10.0)
        data = tracker.get_agent_data("eng-qa")
        assert len(data["recent_scores"]) == MAX_RECENT_SCORES

    def test_keeps_most_recent(self, tracker):
        for i in range(MAX_RECENT_SCORES + 5):
            tracker.record_task_completion("eng-qa", round(i * 0.01, 4), 10.0)
        data = tracker.get_agent_data("eng-qa")
        # The first 5 values (0.0 through 0.04) should be trimmed
        assert data["recent_scores"][0] == round(5 * 0.01, 4)


# -------------------------------------------------------------------------
# _compute_trend
# -------------------------------------------------------------------------

class TestComputeTrend:
    def test_improving_trend(self, tracker):
        scores = [0.3, 0.3, 0.3, 0.7, 0.8, 0.9]
        trend = tracker._compute_trend(scores)
        assert trend > 0

    def test_declining_trend(self, tracker):
        scores = [0.9, 0.8, 0.7, 0.3, 0.3, 0.3]
        trend = tracker._compute_trend(scores)
        assert trend < 0

    def test_flat_trend(self, tracker):
        scores = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
        trend = tracker._compute_trend(scores)
        assert trend == 0.0

    def test_single_score_returns_zero(self, tracker):
        assert tracker._compute_trend([0.5]) == 0.0

    def test_empty_scores_returns_zero(self, tracker):
        assert tracker._compute_trend([]) == 0.0

    def test_two_scores(self, tracker):
        trend = tracker._compute_trend([0.3, 0.9])
        assert trend > 0

    def test_clamped_to_range(self, tracker):
        # Extreme difference
        scores = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0]
        trend = tracker._compute_trend(scores)
        assert -1.0 <= trend <= 1.0


# -------------------------------------------------------------------------
# get_recommended_agents
# -------------------------------------------------------------------------

class TestGetRecommendedAgents:
    def test_ranking_with_data(self, tracker):
        tracker.record_task_completion("eng-qa", 0.9, 50.0)
        tracker.record_task_completion("eng-frontend", 0.5, 100.0)
        tracker.record_task_completion("eng-backend", 0.7, 80.0)

        ranked = tracker.get_recommended_agents(
            ["eng-qa", "eng-frontend", "eng-backend"]
        )
        assert ranked[0] == "eng-qa"
        assert ranked[-1] == "eng-frontend"

    def test_unknown_agents_get_neutral_score(self, tracker):
        tracker.record_task_completion("eng-qa", 0.9, 50.0)
        ranked = tracker.get_recommended_agents(
            ["eng-qa", "unknown-agent"], top_n=5
        )
        # eng-qa (0.9) should rank above unknown (0.5)
        assert ranked[0] == "eng-qa"

    def test_top_n_limits_output(self, tracker):
        for i, agent in enumerate(["a", "b", "c", "d", "e"]):
            tracker.record_task_completion(agent, 0.5, 10.0)
        ranked = tracker.get_recommended_agents(
            ["a", "b", "c", "d", "e"], top_n=3
        )
        assert len(ranked) == 3

    def test_empty_candidates(self, tracker):
        assert tracker.get_recommended_agents([]) == []

    def test_all_unknown_agents_returns_all(self, tracker):
        ranked = tracker.get_recommended_agents(["x", "y", "z"])
        assert len(ranked) == 3


# -------------------------------------------------------------------------
# save / load round-trip
# -------------------------------------------------------------------------

class TestSaveLoad:
    def test_round_trip(self, tmp_storage):
        tracker1 = AgentPerformanceTracker(storage_path=tmp_storage)
        tracker1.record_task_completion("eng-qa", 0.85, 120.0)
        tracker1.record_task_completion("eng-frontend", 0.7, 90.0)
        tracker1.save()

        tracker2 = AgentPerformanceTracker(storage_path=tmp_storage)
        assert tracker2.get_agent_data("eng-qa") is not None
        assert tracker2.get_agent_data("eng-qa")["total_tasks"] == 1
        assert tracker2.get_agent_data("eng-frontend")["avg_quality"] == 0.7

    def test_load_missing_file(self, tmp_path):
        path = str(tmp_path / "nonexistent.json")
        tracker = AgentPerformanceTracker(storage_path=path)
        # Should initialize with empty data, no crash
        assert tracker.get_agent_data("anything") is None

    def test_load_corrupted_json(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("{invalid json!!!")
        tracker = AgentPerformanceTracker(storage_path=str(path))
        # Should fallback to empty data
        assert tracker.get_agent_data("anything") is None

    def test_load_empty_file(self, tmp_path):
        path = tmp_path / "empty.json"
        path.write_text("")
        tracker = AgentPerformanceTracker(storage_path=str(path))
        assert tracker.get_agent_data("anything") is None

    def test_save_creates_parent_dirs(self, tmp_path):
        path = str(tmp_path / "deep" / "nested" / "perf.json")
        tracker = AgentPerformanceTracker(storage_path=path)
        tracker.record_task_completion("eng-qa", 0.8, 10.0)
        tracker.save()
        assert os.path.exists(path)

    def test_atomic_write_no_partial_on_success(self, tmp_storage):
        """Verify that save produces valid JSON."""
        tracker = AgentPerformanceTracker(storage_path=tmp_storage)
        tracker.record_task_completion("eng-qa", 0.8, 10.0)
        tracker.save()
        with open(tmp_storage) as f:
            data = json.load(f)
        assert "eng-qa" in data


# -------------------------------------------------------------------------
# get_performance_scores
# -------------------------------------------------------------------------

class TestGetPerformanceScores:
    def test_returns_all_tracked(self, tracker):
        tracker.record_task_completion("eng-qa", 0.9, 50.0)
        tracker.record_task_completion("eng-frontend", 0.7, 100.0)
        scores = tracker.get_performance_scores()
        assert "eng-qa" in scores
        assert "eng-frontend" in scores
        assert scores["eng-qa"]["task_count"] == 1
        assert "trend" in scores["eng-qa"]

    def test_empty_tracker(self, tracker):
        assert tracker.get_performance_scores() == {}


# -------------------------------------------------------------------------
# clear
# -------------------------------------------------------------------------

class TestClear:
    def test_clear_removes_all(self, tracker):
        tracker.record_task_completion("eng-qa", 0.9, 50.0)
        tracker.clear()
        assert tracker.get_agent_data("eng-qa") is None
        assert tracker.get_performance_scores() == {}
