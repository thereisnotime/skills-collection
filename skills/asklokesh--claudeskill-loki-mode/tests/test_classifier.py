"""Tests for PRD Complexity Classifier."""

import os
import pytest
from swarm.classifier import PRDClassifier, FEATURE_KEYWORDS, TIER_AGENT_COUNTS


@pytest.fixture
def classifier():
    """Fresh classifier instance with no env override."""
    # Ensure no override is active
    os.environ.pop("LOKI_COMPLEXITY", None)
    return PRDClassifier()


# -------------------------------------------------------------------------
# Simple PRD tests
# -------------------------------------------------------------------------

class TestSimpleClassification:
    def test_landing_page_prd(self, classifier):
        prd = "Build a simple landing page with a hero section and contact form."
        result = classifier.classify(prd)
        assert result["tier"] == "simple"
        assert result["agent_count"] == 3

    def test_single_api_endpoint(self, classifier):
        prd = "Create a single REST endpoint that returns user profile data."
        result = classifier.classify(prd)
        assert result["tier"] == "simple"

    def test_empty_prd_defaults_to_simple(self, classifier):
        result = classifier.classify("")
        assert result["tier"] == "simple"
        assert result["agent_count"] == 3

    def test_none_like_empty(self, classifier):
        """Very short PRD with no keywords should be simple."""
        result = classifier.classify("Fix button color")
        assert result["tier"] == "simple"


# -------------------------------------------------------------------------
# Standard PRD tests
# -------------------------------------------------------------------------

class TestStandardClassification:
    def test_react_db_auth(self, classifier):
        prd = """
        Build a React dashboard with PostgreSQL database.
        Users authenticate via JWT tokens. The app needs responsive design
        and supports dark mode. We need unit testing with Jest.
        Deploy using Docker.
        """
        result = classifier.classify(prd)
        assert result["tier"] in ("standard", "complex")
        assert result["agent_count"] >= 6

    def test_fullstack_feature(self, classifier):
        prd = """
        Implement user registration with email verification via SendGrid.
        Backend uses Node.js with PostgreSQL and Redis caching. Frontend is
        a responsive form with accessibility support and i18n.
        Include migration scripts. Deploy with Docker.
        """
        result = classifier.classify(prd)
        assert result["tier"] in ("standard", "complex")

    def test_moderate_feature_count(self, classifier):
        prd = """
        Build a dashboard with charts and real-time websocket updates.
        Use Redis for caching and PostgreSQL for storage.
        Include E2E tests with Playwright.
        """
        result = classifier.classify(prd)
        total = sum(result["features"].values())
        assert total >= 6


# -------------------------------------------------------------------------
# Complex PRD tests
# -------------------------------------------------------------------------

class TestComplexClassification:
    def test_microservices_k8s(self, classifier):
        prd = """
        Build a microservice architecture with 5 services communicating
        via message broker (RabbitMQ). Deploy on Kubernetes with Helm charts.
        CI/CD pipeline using GitHub Actions. Blue-green deployment strategy.
        PostgreSQL with read replicas. Redis for caching and pub/sub.
        Playwright E2E tests and load testing with k6.
        React frontend with i18n and accessibility (a11y).
        OAuth2 authentication with RBAC. JWT session management.
        """
        result = classifier.classify(prd)
        assert result["tier"] in ("complex", "enterprise")
        assert result["agent_count"] >= 8

    def test_multi_env_deployment(self, classifier):
        prd = """
        Deploy to staging and production environments using Docker and
        Kubernetes. Terraform for infrastructure. GitOps with ArgoCD.
        Load balancer with Nginx. MongoDB with sharding.
        E2E testing with Cypress. Performance testing with Artillery.
        React frontend with responsive design and SSR.
        API gateway with rate limiting and webhook support.
        OAuth2 SSO with multi-factor authentication.
        """
        result = classifier.classify(prd)
        assert result["tier"] in ("complex", "enterprise")


# -------------------------------------------------------------------------
# Enterprise PRD tests
# -------------------------------------------------------------------------

class TestEnterpriseClassification:
    def test_enterprise_keywords(self, classifier):
        prd = """
        Enterprise SaaS platform with SOC2 compliance and HIPAA
        certification. Multi-tenant architecture with data residency
        requirements. High availability with 99.99% SLA.
        """
        result = classifier.classify(prd)
        assert result["tier"] == "enterprise"
        assert result["agent_count"] == 12

    def test_compliance_heavy(self, classifier):
        prd = """
        Build a healthcare platform that must be HIPAA compliant with
        audit logging. PCI-DSS for payment processing. GDPR compliance
        for European users. ISO 27001 certification required.
        Disaster recovery with multi-region failover.
        """
        result = classifier.classify(prd)
        assert result["tier"] == "enterprise"

    def test_high_feature_count_triggers_enterprise(self, classifier):
        """PRD with 25+ feature hits should be enterprise even without keywords."""
        prd = """
        Microservice worker queue event bus message broker RabbitMQ
        OAuth Stripe payment email service Twilio third-party webhook
        PostgreSQL MongoDB Redis migration join foreign key replication
        Docker Kubernetes CI/CD staging Helm Terraform GitHub Actions
        E2E Playwright performance test load test security scan
        responsive accessibility i18n dashboard real-time websocket chart
        RBAC multi-tenant SSO 2FA JWT session management
        """
        result = classifier.classify(prd)
        assert result["tier"] == "enterprise"


# -------------------------------------------------------------------------
# Feature extraction tests
# -------------------------------------------------------------------------

class TestFeatureExtraction:
    def test_all_categories_present(self, classifier):
        features = classifier.extract_features("some text")
        for category in FEATURE_KEYWORDS:
            assert category in features

    def test_service_count_keywords(self, classifier):
        prd = "Deploy microservice workers connected via message broker and queue"
        features = classifier.extract_features(prd)
        assert features["service_count"] >= 3

    def test_database_keywords(self, classifier):
        prd = "Use PostgreSQL with migrations and Redis for caching"
        features = classifier.extract_features(prd)
        assert features["database_complexity"] >= 2

    def test_auth_keywords(self, classifier):
        prd = "Implement RBAC with SSO and 2FA using JWT tokens"
        features = classifier.extract_features(prd)
        assert features["auth_complexity"] >= 3

    def test_case_insensitive(self, classifier):
        prd_lower = "use postgresql and docker"
        prd_upper = "Use POSTGRESQL and DOCKER"
        f_lower = classifier.extract_features(prd_lower)
        f_upper = classifier.extract_features(prd_upper)
        assert f_lower == f_upper

    def test_empty_prd_all_zeros(self, classifier):
        features = classifier.extract_features("")
        assert all(v == 0 for v in features.values())


# -------------------------------------------------------------------------
# Override and confidence tests
# -------------------------------------------------------------------------

class TestOverrideAndConfidence:
    def test_loki_complexity_override(self, classifier):
        os.environ["LOKI_COMPLEXITY"] = "enterprise"
        try:
            result = classifier.classify("Simple landing page")
            assert result["tier"] == "enterprise"
            assert result["confidence"] == 1.0
            assert result["override"] is True
            assert result["agent_count"] == 12
        finally:
            os.environ.pop("LOKI_COMPLEXITY", None)

    def test_override_with_each_tier(self, classifier):
        for tier in PRDClassifier.TIERS:
            os.environ["LOKI_COMPLEXITY"] = tier
            try:
                result = classifier.classify("anything")
                assert result["tier"] == tier
                assert result["agent_count"] == TIER_AGENT_COUNTS[tier]
            finally:
                os.environ.pop("LOKI_COMPLEXITY", None)

    def test_invalid_override_ignored(self, classifier):
        os.environ["LOKI_COMPLEXITY"] = "invalid_tier"
        try:
            result = classifier.classify("Simple page")
            assert result["tier"] != "invalid_tier"
            assert result["override"] is False
        finally:
            os.environ.pop("LOKI_COMPLEXITY", None)

    def test_confidence_between_zero_and_one(self, classifier):
        for prd in ["", "simple page", "microservice docker kubernetes postgresql"]:
            result = classifier.classify(prd)
            assert 0.0 <= result["confidence"] <= 1.0

    def test_confidence_higher_away_from_boundary(self, classifier):
        """PRDs clearly in one tier should have higher confidence."""
        simple_result = classifier.classify("Fix the button text")
        # Very few features = clearly simple
        assert simple_result["confidence"] >= 0.5


# -------------------------------------------------------------------------
# Agent count tests
# -------------------------------------------------------------------------

class TestAgentCounts:
    def test_simple_gets_3(self, classifier):
        result = classifier.classify("")
        assert result["agent_count"] == 3

    def test_enterprise_gets_12(self, classifier):
        prd = "Enterprise SOC2 HIPAA compliance multi-tenant"
        result = classifier.classify(prd)
        assert result["agent_count"] == 12

    def test_all_tiers_have_counts(self):
        for tier in PRDClassifier.TIERS:
            assert tier in TIER_AGENT_COUNTS
            assert TIER_AGENT_COUNTS[tier] > 0
