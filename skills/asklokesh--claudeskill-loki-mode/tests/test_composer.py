"""Tests for Dynamic Swarm Composition."""

import pytest
from swarm.composer import SwarmComposer, BASE_TEAM, FEATURE_AGENT_MAP, ENTERPRISE_AGENTS
from swarm.classifier import PRDClassifier, TIER_AGENT_COUNTS


@pytest.fixture
def composer():
    return SwarmComposer()


@pytest.fixture
def classifier():
    import os
    os.environ.pop("LOKI_COMPLEXITY", None)
    return PRDClassifier()


def _make_classification(tier="standard", features=None, agent_count=None, override=False):
    """Helper to build classification dicts for testing."""
    if features is None:
        features = {
            "service_count": 0,
            "external_apis": 0,
            "database_complexity": 0,
            "deployment_complexity": 0,
            "testing_requirements": 0,
            "ui_complexity": 0,
            "auth_complexity": 0,
        }
    if agent_count is None:
        agent_count = TIER_AGENT_COUNTS.get(tier, 6)
    return {
        "tier": tier,
        "confidence": 0.8,
        "features": features,
        "agent_count": agent_count,
        "override": override,
    }


# -------------------------------------------------------------------------
# Base team tests
# -------------------------------------------------------------------------

class TestBaseTeam:
    def test_base_team_always_included(self, composer):
        result = composer.compose(_make_classification("simple"))
        agent_types = [a["type"] for a in result["agents"]]
        for base_agent in BASE_TEAM:
            assert base_agent["type"] in agent_types

    def test_base_team_has_planner(self, composer):
        result = composer.compose(_make_classification("simple"))
        agent_types = [a["type"] for a in result["agents"]]
        assert "orch-planner" in agent_types

    def test_base_team_has_backend(self, composer):
        result = composer.compose(_make_classification("simple"))
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-backend" in agent_types

    def test_base_team_has_code_review(self, composer):
        result = composer.compose(_make_classification("simple"))
        agent_types = [a["type"] for a in result["agents"]]
        assert "review-code" in agent_types


# -------------------------------------------------------------------------
# Feature-driven additions
# -------------------------------------------------------------------------

class TestFeatureDrivenAgents:
    def test_database_features_add_eng_database(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 3, "deployment_complexity": 0,
            "testing_requirements": 0, "ui_complexity": 0, "auth_complexity": 0,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-database" in agent_types

    def test_ui_features_add_eng_frontend(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 0, "deployment_complexity": 0,
            "testing_requirements": 0, "ui_complexity": 2, "auth_complexity": 0,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-frontend" in agent_types

    def test_external_apis_add_eng_api(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 2,
            "database_complexity": 0, "deployment_complexity": 0,
            "testing_requirements": 0, "ui_complexity": 0, "auth_complexity": 0,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-api" in agent_types

    def test_deployment_features_add_ops_devops(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 0, "deployment_complexity": 3,
            "testing_requirements": 0, "ui_complexity": 0, "auth_complexity": 0,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "ops-devops" in agent_types

    def test_testing_features_add_eng_qa(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 0, "deployment_complexity": 0,
            "testing_requirements": 2, "ui_complexity": 0, "auth_complexity": 0,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-qa" in agent_types

    def test_auth_features_add_ops_security(self, composer):
        classification = _make_classification(features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 0, "deployment_complexity": 0,
            "testing_requirements": 0, "ui_complexity": 0, "auth_complexity": 2,
        })
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "ops-security" in agent_types

    def test_zero_features_only_base_team(self, composer):
        classification = _make_classification("simple")
        result = composer.compose(classification)
        assert len(result["agents"]) == len(BASE_TEAM)


# -------------------------------------------------------------------------
# Enterprise tier
# -------------------------------------------------------------------------

class TestEnterpriseTier:
    def test_enterprise_adds_compliance_agents(self, composer):
        classification = _make_classification("enterprise", agent_count=12)
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        for ea in ENTERPRISE_AGENTS:
            assert ea["type"] in agent_types

    def test_enterprise_has_sre(self, composer):
        classification = _make_classification("enterprise", agent_count=12)
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "ops-sre" in agent_types

    def test_enterprise_has_compliance(self, composer):
        classification = _make_classification("enterprise", agent_count=12)
        result = composer.compose(classification)
        agent_types = [a["type"] for a in result["agents"]]
        assert "ops-compliance" in agent_types


# -------------------------------------------------------------------------
# Agent count cap
# -------------------------------------------------------------------------

class TestAgentCountCap:
    def test_simple_tier_capped_at_3(self, composer):
        # Even with features, simple tier caps at 3
        classification = _make_classification("simple", features={
            "service_count": 0, "external_apis": 1,
            "database_complexity": 1, "deployment_complexity": 1,
            "testing_requirements": 1, "ui_complexity": 1, "auth_complexity": 1,
        }, agent_count=3)
        result = composer.compose(classification)
        assert len(result["agents"]) <= 3

    def test_standard_tier_capped_at_6(self, composer):
        classification = _make_classification("standard", features={
            "service_count": 1, "external_apis": 1,
            "database_complexity": 1, "deployment_complexity": 1,
            "testing_requirements": 1, "ui_complexity": 1, "auth_complexity": 1,
        }, agent_count=6)
        result = composer.compose(classification)
        assert len(result["agents"]) <= 6

    def test_priority_ordering_preserved_after_cap(self, composer):
        """When capping, higher priority agents should be kept."""
        classification = _make_classification("simple", features={
            "service_count": 0, "external_apis": 1,
            "database_complexity": 1, "deployment_complexity": 1,
            "testing_requirements": 1, "ui_complexity": 1, "auth_complexity": 1,
        }, agent_count=3)
        result = composer.compose(classification)
        # Base team has priority 1, should be kept
        agent_types = [a["type"] for a in result["agents"]]
        assert "orch-planner" in agent_types


# -------------------------------------------------------------------------
# Org patterns
# -------------------------------------------------------------------------

class TestOrgPatterns:
    def test_org_patterns_add_matching_agents(self, composer):
        classification = _make_classification("standard")
        org_patterns = [
            {"name": "react-patterns", "category": "frontend", "description": "React best practices"},
        ]
        result = composer.compose(classification, org_patterns=org_patterns)
        agent_types = [a["type"] for a in result["agents"]]
        assert "eng-frontend" in agent_types

    def test_no_org_patterns_uses_classifier_only(self, composer):
        classification = _make_classification("simple")
        result = composer.compose(classification, org_patterns=None)
        assert result["composition_source"] in ("classifier", "override")

    def test_org_patterns_sets_source(self, composer):
        classification = _make_classification("standard")
        org_patterns = [
            {"name": "flutter-app", "description": "Mobile app with Flutter"},
        ]
        result = composer.compose(classification, org_patterns=org_patterns)
        # Should be org_knowledge if it added agents
        agent_types = [a["type"] for a in result["agents"]]
        if "eng-mobile" in agent_types:
            assert result["composition_source"] == "org_knowledge"

    def test_org_patterns_no_duplicates(self, composer):
        """Org patterns should not duplicate agents already in team."""
        classification = _make_classification("standard", features={
            "service_count": 0, "external_apis": 0,
            "database_complexity": 2, "deployment_complexity": 0,
            "testing_requirements": 0, "ui_complexity": 0, "auth_complexity": 0,
        })
        org_patterns = [
            {"name": "postgres-patterns", "category": "database", "description": "PostgreSQL usage"},
        ]
        result = composer.compose(classification, org_patterns=org_patterns)
        agent_types = [a["type"] for a in result["agents"]]
        # eng-database should appear exactly once
        assert agent_types.count("eng-database") == 1


# -------------------------------------------------------------------------
# Rationale and structure
# -------------------------------------------------------------------------

class TestOutputStructure:
    def test_result_has_required_keys(self, composer):
        result = composer.compose(_make_classification("simple"))
        assert "agents" in result
        assert "rationale" in result
        assert "composition_source" in result

    def test_each_agent_has_required_fields(self, composer):
        result = composer.compose(_make_classification("standard"))
        for agent in result["agents"]:
            assert "type" in agent
            assert "role" in agent
            assert "priority" in agent

    def test_rationale_is_nonempty_string(self, composer):
        result = composer.compose(_make_classification("standard"))
        assert isinstance(result["rationale"], str)
        assert len(result["rationale"]) > 0

    def test_override_source_when_overridden(self, composer):
        classification = _make_classification("enterprise", override=True)
        result = composer.compose(classification)
        assert result["composition_source"] == "override"


# -------------------------------------------------------------------------
# Integration with classifier
# -------------------------------------------------------------------------

class TestClassifierIntegration:
    def test_classifier_output_feeds_composer(self, classifier, composer):
        prd = """
        Build a React app with PostgreSQL, Docker deployment,
        and E2E tests using Playwright.
        """
        classification = classifier.classify(prd)
        result = composer.compose(classification)
        assert len(result["agents"]) >= 3
        assert result["composition_source"] in ("classifier", "org_knowledge", "override")
