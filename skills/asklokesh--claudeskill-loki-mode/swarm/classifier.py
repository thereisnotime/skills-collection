"""PRD Complexity Classifier - Rule-based project complexity analysis.

Analyzes PRD text to determine project complexity without LLM calls.
Uses keyword matching and feature extraction for fast classification.

Tiers:
- simple: Landing pages, single APIs, UI fixes (3 agents)
- standard: Full-stack features with auth/DB (6 agents)
- complex: Microservices, multi-env, external integrations (8 agents)
- enterprise: Multi-tenant, compliance, HA, 25+ features (12 agents)
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional


# Feature detection keywords grouped by category
FEATURE_KEYWORDS: Dict[str, List[str]] = {
    "service_count": [
        "microservice", "micro-service", "worker", "queue", "event bus",
        "message broker", "event-driven", "pub/sub", "pubsub", "kafka",
        "rabbitmq", "celery", "sidekiq", "background job", "cron",
        "scheduler", "api gateway", "service mesh", "grpc",
    ],
    "external_apis": [
        "oauth", "stripe", "payment", "email service", "sendgrid",
        "mailgun", "sms", "twilio", "third-party", "third party",
        "webhook", "external api", "integration", "aws sdk", "gcp",
        "azure", "s3 bucket", "cloudflare", "cdn", "openai api",
        "slack api", "discord bot", "zapier",
    ],
    "database_complexity": [
        "postgresql", "postgres", "mysql", "mongodb", "redis",
        "migration", "relationship", "join", "foreign key", "index",
        "replication", "sharding", "read replica", "database",
        "dynamodb", "cassandra", "elasticsearch", "full-text search",
        "prisma", "drizzle", "typeorm", "sequelize", "sqlalchemy",
    ],
    "deployment_complexity": [
        "docker", "kubernetes", "k8s", "ci/cd", "ci cd", "staging",
        "production", "helm", "terraform", "ansible", "github actions",
        "gitlab ci", "jenkins", "argocd", "gitops", "blue-green",
        "canary", "rolling update", "multi-region", "load balancer",
        "nginx", "caddy", "traefik", "ecs", "fargate",
    ],
    "testing_requirements": [
        "e2e", "end-to-end", "playwright", "cypress", "selenium",
        "performance test", "load test", "stress test", "security scan",
        "penetration test", "pen test", "sast", "dast", "fuzz",
        "property-based", "contract test", "smoke test", "chaos",
        "benchmark", "k6", "artillery", "locust",
    ],
    "ui_complexity": [
        "responsive", "accessibility", "a11y", "i18n",
        "internationalization", "l10n", "localization", "animation",
        "dashboard", "real-time", "realtime", "websocket", "sse",
        "drag and drop", "drag-and-drop", "chart", "graph",
        "visualization", "theme", "dark mode", "design system",
        "storybook", "component library",
    ],
    "auth_complexity": [
        "oidc", "openid", "rbac", "role-based", "multi-tenant",
        "multitenant", "sso", "single sign-on", "2fa", "mfa",
        "two-factor", "multi-factor", "saml", "ldap", "jwt",
        "session management", "permission", "access control",
        "api key", "oauth2", "auth0", "clerk", "supabase auth",
    ],
}

# Enterprise-specific keywords that directly indicate enterprise tier
ENTERPRISE_KEYWORDS: List[str] = [
    "enterprise", "soc2", "soc 2", "hipaa", "pci-dss", "pci dss",
    "iso27001", "iso 27001", "gdpr", "compliance", "audit log",
    "audit trail", "high availability", "ha cluster", "disaster recovery",
    "failover", "multi-region", "data residency", "data sovereignty",
    "sla", "99.99", "five nines", "zero downtime",
]

# Agent count recommendations per tier
TIER_AGENT_COUNTS: Dict[str, int] = {
    "simple": 3,
    "standard": 6,
    "complex": 8,
    "enterprise": 12,
}


class PRDClassifier:
    """Classifies PRD complexity based on content analysis.

    Uses rule-based keyword matching for fast, deterministic classification
    without requiring any LLM calls.
    """

    TIERS = ["simple", "standard", "complex", "enterprise"]

    def extract_features(self, prd_text: str) -> Dict[str, int]:
        """Extract complexity features from PRD text.

        Counts keyword matches in each feature category. Each unique keyword
        is counted at most once to avoid inflating scores from repeated mentions.

        Args:
            prd_text: The PRD text to analyze.

        Returns:
            Dict mapping feature category to match count.
        """
        if not prd_text:
            return {category: 0 for category in FEATURE_KEYWORDS}

        text_lower = prd_text.lower()
        features: Dict[str, int] = {}

        for category, keywords in FEATURE_KEYWORDS.items():
            matched = set()
            for keyword in keywords:
                if keyword in text_lower:
                    matched.add(keyword)
            features[category] = len(matched)

        return features

    def _total_feature_hits(self, features: Dict[str, int]) -> int:
        """Sum all feature hits across categories."""
        return sum(features.values())

    def _count_active_categories(self, features: Dict[str, int]) -> int:
        """Count how many feature categories have at least one hit."""
        return sum(1 for v in features.values() if v > 0)

    def _has_enterprise_keywords(self, prd_text: str) -> bool:
        """Check if PRD contains enterprise-specific keywords."""
        if not prd_text:
            return False
        text_lower = prd_text.lower()
        return any(kw in text_lower for kw in ENTERPRISE_KEYWORDS)

    def _score_tier(self, features: Dict[str, int], prd_text: str = "") -> str:
        """Determine complexity tier from extracted features.

        Scoring rules:
        - simple: <= 5 total feature hits, typically single service
        - standard: 6-15 features, 2-3 active categories
        - complex: 16-25 features, 4+ active categories
        - enterprise: 25+ features or explicit enterprise keywords

        Args:
            features: Feature counts from extract_features().
            prd_text: Original PRD text (for enterprise keyword check).

        Returns:
            One of: "simple", "standard", "complex", "enterprise"
        """
        total = self._total_feature_hits(features)
        active_categories = self._count_active_categories(features)

        # Enterprise check: explicit keywords or very high feature count
        if self._has_enterprise_keywords(prd_text) or total > 25:
            return "enterprise"

        # Complex: high feature count or many active categories
        if total >= 16 or (total >= 12 and active_categories >= 4):
            return "complex"

        # Standard: moderate features
        if total >= 6 or active_categories >= 3:
            return "standard"

        return "simple"

    def _compute_confidence(self, features: Dict[str, int]) -> float:
        """Compute classification confidence.

        Higher confidence when features clearly indicate a specific tier,
        lower confidence near tier boundaries.

        Args:
            features: Feature counts from extract_features().

        Returns:
            Confidence value between 0.0 and 1.0.
        """
        total = self._total_feature_hits(features)

        # Near tier boundaries = lower confidence
        # Boundaries at: 5/6, 15/16, 25/26
        boundary_distances = [
            abs(total - 5.5),
            abs(total - 15.5),
            abs(total - 25.5),
        ]
        min_distance = min(boundary_distances)

        # Base confidence from distance to nearest boundary
        # At boundary: 0.5, far from boundary: up to 0.95
        base_confidence = min(0.95, 0.5 + (min_distance * 0.05))

        # Boost confidence if we have many active categories (clearer signal)
        active = self._count_active_categories(features)
        if active >= 5:
            base_confidence = min(0.95, base_confidence + 0.05)

        # Reduce confidence for very low feature counts (ambiguous)
        if total <= 2:
            base_confidence = min(base_confidence, 0.7)

        return round(base_confidence, 2)

    def _recommend_agents(self, tier: str) -> int:
        """Get recommended agent count for a tier.

        Args:
            tier: Complexity tier name.

        Returns:
            Recommended number of agents.
        """
        return TIER_AGENT_COUNTS.get(tier, 6)

    def classify(self, prd_text: str) -> Dict[str, Any]:
        """Classify a PRD and return tier with metadata.

        Args:
            prd_text: The full PRD text to analyze.

        Returns:
            Dict with keys: tier, confidence, features, agent_count
        """
        # Check for environment variable override
        override = os.environ.get("LOKI_COMPLEXITY", "").lower().strip()
        if override in self.TIERS:
            features = self.extract_features(prd_text)
            return {
                "tier": override,
                "confidence": 1.0,
                "features": features,
                "agent_count": TIER_AGENT_COUNTS[override],
                "override": True,
            }

        features = self.extract_features(prd_text)
        tier = self._score_tier(features, prd_text)
        return {
            "tier": tier,
            "confidence": self._compute_confidence(features),
            "features": features,
            "agent_count": self._recommend_agents(tier),
            "override": False,
        }
