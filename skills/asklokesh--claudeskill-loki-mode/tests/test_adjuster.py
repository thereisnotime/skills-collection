"""Tests for SwarmAdjuster mid-project agent adjustment."""

import pytest
from swarm.adjuster import SwarmAdjuster, GATE_TO_AGENT


@pytest.fixture
def adjuster():
    return SwarmAdjuster()


def _agents(*types, priority=1):
    """Helper to build agent lists quickly."""
    return [{"type": t, "priority": priority} for t in types]


def _agents_with_priorities(*pairs):
    """Helper: pairs of (type, priority)."""
    return [{"type": t, "priority": p} for t, p in pairs]


# -------------------------------------------------------------------------
# GATE_TO_AGENT mapping
# -------------------------------------------------------------------------

class TestGateToAgentMapping:
    def test_testing_gates_map_to_eng_qa(self):
        for gate in ("mock_detector", "mock_detection", "test_coverage",
                      "testing", "unit_test", "integration_test", "e2e"):
            assert GATE_TO_AGENT[gate] == "eng-qa"

    def test_security_gates_map_to_ops_security(self):
        for gate in ("security", "security_scan", "vulnerability", "owasp"):
            assert GATE_TO_AGENT[gate] == "ops-security"

    def test_code_quality_gates_map_to_review_code(self):
        for gate in ("code_quality", "code_review", "lint", "static_analysis"):
            assert GATE_TO_AGENT[gate] == "review-code"

    def test_performance_gates(self):
        for gate in ("performance", "load_test", "benchmark"):
            assert GATE_TO_AGENT[gate] == "eng-perf"

    def test_infrastructure_and_database_gates(self):
        assert GATE_TO_AGENT["infrastructure"] == "eng-infra"
        assert GATE_TO_AGENT["database"] == "eng-database"
        assert GATE_TO_AGENT["migration"] == "eng-database"

    def test_frontend_gates(self):
        for gate in ("frontend", "ui", "accessibility"):
            assert GATE_TO_AGENT[gate] == "eng-frontend"

    def test_documentation_gate(self):
        assert GATE_TO_AGENT["documentation"] == "prod-techwriter"


# -------------------------------------------------------------------------
# Rule 1: Failing quality gates after iterations
# -------------------------------------------------------------------------

class TestRule1FailingGates:
    def test_triggers_when_gate_pass_low_and_iterations_high(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.3,
                "iteration_count": 5,
                "failed_gates": ["security"],
            },
        )
        assert result["action"] == "add"
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "ops-security" in added_types

    def test_does_not_trigger_at_low_iteration_count(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.3,
                "iteration_count": 2,
                "failed_gates": ["security"],
            },
        )
        # Rule 1 should not fire (iteration_count <= 3)
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "ops-security" not in added_types

    def test_does_not_add_duplicate_agent_type(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("ops-security"),
            quality_signals={
                "gate_pass_rate": 0.2,
                "iteration_count": 5,
                "failed_gates": ["security"],
            },
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "ops-security" not in added_types

    def test_multiple_failing_gates_add_multiple_agents(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.1,
                "iteration_count": 10,
                "failed_gates": ["security", "test_coverage", "lint"],
            },
        )
        added_types = {a["type"] for a in result["agents_to_add"]}
        assert "ops-security" in added_types
        assert "eng-qa" in added_types
        assert "review-code" in added_types

    def test_unknown_gate_name_ignored(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.1,
                "iteration_count": 10,
                "failed_gates": ["nonexistent_gate"],
            },
        )
        assert result["agents_to_add"] == []

    def test_gate_name_case_insensitive(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.3,
                "iteration_count": 5,
                "failed_gates": ["SECURITY"],
            },
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "ops-security" in added_types


# -------------------------------------------------------------------------
# Rule 2: Low test coverage
# -------------------------------------------------------------------------

class TestRule2LowCoverage:
    def test_triggers_below_60_percent(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={"test_coverage": 0.5},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "eng-qa" in added_types

    def test_does_not_trigger_at_60_percent(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={"test_coverage": 0.6},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "eng-qa" not in added_types

    def test_does_not_add_if_eng_qa_already_present(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend", "eng-qa"),
            quality_signals={"test_coverage": 0.3},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "eng-qa" not in added_types


# -------------------------------------------------------------------------
# Rule 3: Low review pass rate
# -------------------------------------------------------------------------

class TestRule3LowReviewRate:
    def test_triggers_below_50_percent(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={"review_pass_rate": 0.4},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "review-security" in added_types

    def test_does_not_trigger_at_50_percent(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={"review_pass_rate": 0.5},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "review-security" not in added_types

    def test_does_not_add_if_already_present(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend", "review-security"),
            quality_signals={"review_pass_rate": 0.2},
        )
        added_types = [a["type"] for a in result["agents_to_add"]]
        assert "review-security" not in added_types


# -------------------------------------------------------------------------
# Rule 4: Trimming when healthy
# -------------------------------------------------------------------------

class TestRule4Trimming:
    def test_removes_lowest_priority_agent_when_all_healthy(self, adjuster):
        agents = _agents_with_priorities(
            ("eng-frontend", 1),
            ("eng-backend", 1),
            ("eng-qa", 2),
            ("review-code", 2),
            ("prod-techwriter", 5),  # priority >= 3, highest number
        )
        result = adjuster.evaluate_adjustment(
            current_agents=agents,
            quality_signals={
                "gate_pass_rate": 0.9,
                "test_coverage": 0.9,
                "review_pass_rate": 0.9,
            },
        )
        assert result["action"] == "remove"
        removed_types = [a["type"] for a in result["agents_to_remove"]]
        assert "prod-techwriter" in removed_types

    def test_no_trimming_with_4_or_fewer_agents(self, adjuster):
        agents = _agents_with_priorities(
            ("eng-frontend", 1),
            ("eng-backend", 1),
            ("eng-qa", 2),
            ("prod-techwriter", 5),
        )
        result = adjuster.evaluate_adjustment(
            current_agents=agents,
            quality_signals={
                "gate_pass_rate": 0.9,
                "test_coverage": 0.9,
                "review_pass_rate": 0.9,
            },
        )
        assert result["action"] == "none"

    def test_no_trimming_when_no_low_priority_agents(self, adjuster):
        agents = _agents_with_priorities(
            ("eng-frontend", 1),
            ("eng-backend", 1),
            ("eng-qa", 1),
            ("review-code", 2),
            ("eng-database", 2),
        )
        result = adjuster.evaluate_adjustment(
            current_agents=agents,
            quality_signals={
                "gate_pass_rate": 0.9,
                "test_coverage": 0.9,
                "review_pass_rate": 0.9,
            },
        )
        # No agents with priority >= 3
        assert result["action"] == "none"

    def test_no_trimming_if_signals_at_boundary_0_8(self, adjuster):
        """0.8 is NOT > 0.8, so trimming should not trigger."""
        agents = _agents_with_priorities(
            ("a", 1), ("b", 1), ("c", 1), ("d", 2), ("e", 5),
        )
        result = adjuster.evaluate_adjustment(
            current_agents=agents,
            quality_signals={
                "gate_pass_rate": 0.8,
                "test_coverage": 0.8,
                "review_pass_rate": 0.8,
            },
        )
        assert result["action"] == "none"


# -------------------------------------------------------------------------
# Action determination
# -------------------------------------------------------------------------

class TestActionDetermination:
    def test_action_none_when_no_changes(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.9,
                "test_coverage": 0.9,
                "review_pass_rate": 0.9,
            },
        )
        assert result["action"] == "none"
        assert "acceptable range" in result["rationale"]

    def test_action_add_when_only_adding(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={"test_coverage": 0.3},
        )
        assert result["action"] == "add"

    def test_action_remove_when_only_removing(self, adjuster):
        agents = _agents_with_priorities(
            ("a", 1), ("b", 1), ("c", 1), ("d", 1), ("e", 5),
        )
        result = adjuster.evaluate_adjustment(
            current_agents=agents,
            quality_signals={
                "gate_pass_rate": 0.9,
                "test_coverage": 0.9,
                "review_pass_rate": 0.9,
            },
        )
        assert result["action"] == "remove"

    def test_action_replace_when_adding_and_removing(self, adjuster):
        """Force both add and remove to happen simultaneously.

        This requires Rule 1/2/3 to add agents AND Rule 4 to remove.
        But Rule 4 only fires when no agents_to_add, so "replace" requires
        a creative scenario. Actually, Rule 4 checks `not agents_to_add`,
        so replace cannot happen through normal rule flow. Let's verify
        that the code path exists by checking that it returns replace
        if both lists are non-empty (which in practice doesn't occur
        from the current rules).
        """
        # With current rules, add and remove cannot co-occur because
        # Rule 4 requires `not agents_to_add`. So "replace" is unreachable.
        # Just verify no crash with empty signals.
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={},
        )
        assert result["action"] == "none"


# -------------------------------------------------------------------------
# Edge cases
# -------------------------------------------------------------------------

class TestEdgeCases:
    def test_empty_failed_gates(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.1,
                "iteration_count": 10,
                "failed_gates": [],
            },
        )
        # Rule 1 fires but no gates to map -> no agents added from Rule 1
        # Other rules may still fire depending on defaults
        assert result["action"] in ("none", "add")

    def test_empty_quality_signals(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={},
        )
        # Defaults: gate_pass_rate=1.0, test_coverage=1.0,
        # review_pass_rate=1.0, iteration_count=0, failed_gates=[]
        assert result["action"] == "none"

    def test_boundary_values_all_zero(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 0.0,
                "test_coverage": 0.0,
                "review_pass_rate": 0.0,
                "iteration_count": 0,
                "failed_gates": [],
            },
        )
        # gate_pass_rate < 0.5 but iteration_count <= 3 -> Rule 1 skipped
        # test_coverage < 0.6 -> Rule 2 fires
        # review_pass_rate < 0.5 -> Rule 3 fires
        assert result["action"] == "add"
        added_types = {a["type"] for a in result["agents_to_add"]}
        assert "eng-qa" in added_types
        assert "review-security" in added_types

    def test_boundary_values_all_one(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={
                "gate_pass_rate": 1.0,
                "test_coverage": 1.0,
                "review_pass_rate": 1.0,
                "iteration_count": 100,
                "failed_gates": [],
            },
        )
        # All signals healthy but only 1 agent (< 4), no trimming
        assert result["action"] == "none"

    def test_boundary_0_8_values(self, adjuster):
        """All signals at exactly 0.8 -- no rule should trigger."""
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("a", "b"),
            quality_signals={
                "gate_pass_rate": 0.8,
                "test_coverage": 0.8,
                "review_pass_rate": 0.8,
                "iteration_count": 10,
                "failed_gates": [],
            },
        )
        assert result["action"] == "none"

    def test_empty_current_agents(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=[],
            quality_signals={"test_coverage": 0.1, "review_pass_rate": 0.1},
        )
        assert result["action"] == "add"

    def test_result_structure(self, adjuster):
        result = adjuster.evaluate_adjustment(
            current_agents=_agents("eng-frontend"),
            quality_signals={},
        )
        assert "action" in result
        assert "agents_to_add" in result
        assert "agents_to_remove" in result
        assert "rationale" in result
        assert isinstance(result["agents_to_add"], list)
        assert isinstance(result["agents_to_remove"], list)
        assert isinstance(result["rationale"], str)
