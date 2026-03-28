"""Dynamic Swarm Composition - Optimal agent team assembly.

Composes a team of agents based on PRD classification results and
optional organization knowledge patterns. Handles base team selection,
feature-driven additions, org pattern matching, and priority assignment.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .registry import AGENT_TYPES, AGENT_CAPABILITIES, SWARM_CATEGORIES
from .classifier import TIER_AGENT_COUNTS


# Base team: always included regardless of tier
BASE_TEAM = [
    {"type": "orch-planner", "role": "orchestration", "priority": 1},
    {"type": "eng-backend", "role": "engineering", "priority": 1},
    {"type": "review-code", "role": "review", "priority": 1},
]

# Feature-to-agent mapping: which features trigger which agents
FEATURE_AGENT_MAP: Dict[str, Dict[str, Any]] = {
    "database_complexity": {
        "type": "eng-database",
        "role": "engineering",
        "priority": 2,
    },
    "ui_complexity": {
        "type": "eng-frontend",
        "role": "engineering",
        "priority": 2,
    },
    "external_apis": {
        "type": "eng-api",
        "role": "engineering",
        "priority": 2,
    },
    "deployment_complexity": {
        "type": "ops-devops",
        "role": "operations",
        "priority": 2,
    },
    "testing_requirements": {
        "type": "eng-qa",
        "role": "engineering",
        "priority": 2,
    },
    "auth_complexity": {
        "type": "ops-security",
        "role": "operations",
        "priority": 2,
    },
}

# Enterprise-tier additional agents
ENTERPRISE_AGENTS = [
    {"type": "ops-sre", "role": "operations", "priority": 3},
    {"type": "ops-compliance", "role": "operations", "priority": 3},
    {"type": "data-analytics", "role": "data", "priority": 3},
]


class SwarmComposer:
    """Composes an optimal team of agents based on project classification.

    The composition process:
    1. Start with a base team (planner, backend, code review)
    2. Add agents based on detected PRD features
    3. Optionally refine using org knowledge patterns
    4. Cap at recommended agent count for the tier
    5. Assign priorities (1=critical, 2=important, 3=optional)
    """

    def compose(
        self,
        classification: Dict[str, Any],
        org_patterns: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Compose an agent team from classification results.

        Args:
            classification: Output from PRDClassifier.classify(), containing
                tier, confidence, features, agent_count keys.
            org_patterns: Optional list of pattern dicts from the org
                knowledge graph (e.g., patterns with 'name', 'category',
                'description' fields).

        Returns:
            Dict with keys:
                agents: List of {type, role, priority} dicts
                rationale: Human-readable explanation
                composition_source: "classifier", "org_knowledge", or "override"
        """
        tier = classification.get("tier", "standard")
        features = classification.get("features", {})
        max_agents = classification.get("agent_count", TIER_AGENT_COUNTS.get(tier, 6))
        is_override = classification.get("override", False)

        # Step 1: Start with base team
        agents = [dict(a) for a in BASE_TEAM]
        agent_types_added = {a["type"] for a in agents}

        # Step 2: Add agents based on features
        for feature_name, agent_def in FEATURE_AGENT_MAP.items():
            if features.get(feature_name, 0) > 0:
                if agent_def["type"] not in agent_types_added:
                    agents.append(dict(agent_def))
                    agent_types_added.add(agent_def["type"])

        # Step 3: Enterprise tier additions
        if tier == "enterprise":
            for agent_def in ENTERPRISE_AGENTS:
                if agent_def["type"] not in agent_types_added:
                    agents.append(dict(agent_def))
                    agent_types_added.add(agent_def["type"])

        # Step 4: Org pattern influence
        composition_source = "override" if is_override else "classifier"
        if org_patterns:
            added_from_org = self._apply_org_patterns(
                agents, agent_types_added, org_patterns
            )
            if added_from_org:
                composition_source = "org_knowledge"

        # Step 5: Cap at recommended count, keeping by priority
        agents.sort(key=lambda a: a["priority"])
        if len(agents) > max_agents:
            agents = agents[:max_agents]

        # Build rationale
        rationale = self._build_rationale(tier, features, agents, composition_source)

        return {
            "agents": agents,
            "rationale": rationale,
            "composition_source": composition_source,
        }

    def _apply_org_patterns(
        self,
        agents: List[Dict[str, Any]],
        agent_types_added: set,
        org_patterns: List[Dict[str, Any]],
    ) -> bool:
        """Apply organization knowledge patterns to refine composition.

        Looks for technology mentions in org patterns and ensures the right
        agents are included for known technologies.

        Args:
            agents: Current agent list (modified in place).
            agent_types_added: Set of agent types already in the team.
            org_patterns: Patterns from the org knowledge graph.

        Returns:
            True if any agents were added based on org patterns.
        """
        added = False

        # Technology -> agent type mapping
        tech_to_agent = {
            "react": "eng-frontend",
            "vue": "eng-frontend",
            "svelte": "eng-frontend",
            "angular": "eng-frontend",
            "next.js": "eng-frontend",
            "nuxt": "eng-frontend",
            "postgresql": "eng-database",
            "mongodb": "eng-database",
            "redis": "eng-database",
            "mysql": "eng-database",
            "docker": "ops-devops",
            "kubernetes": "ops-devops",
            "terraform": "ops-devops",
            "playwright": "eng-qa",
            "cypress": "eng-qa",
            "jest": "eng-qa",
            "stripe": "eng-api",
            "graphql": "eng-api",
            "rest api": "eng-api",
            "react-native": "eng-mobile",
            "flutter": "eng-mobile",
            "swift": "eng-mobile",
            "kotlin": "eng-mobile",
            "ml": "data-ml",
            "machine learning": "data-ml",
            "analytics": "data-analytics",
        }

        # Search through org patterns for technology mentions
        for pattern in org_patterns:
            pattern_text = " ".join([
                str(pattern.get("name", "")),
                str(pattern.get("pattern", "")),
                str(pattern.get("description", "")),
                str(pattern.get("category", "")),
            ]).lower()

            for tech, agent_type in tech_to_agent.items():
                if tech in pattern_text and agent_type not in agent_types_added:
                    # Determine role from swarm categories
                    role = "engineering"
                    for cat, types in SWARM_CATEGORIES.items():
                        if agent_type in types:
                            role = cat
                            break

                    agents.append({
                        "type": agent_type,
                        "role": role,
                        "priority": 2,
                    })
                    agent_types_added.add(agent_type)
                    added = True

        return added

    def _build_rationale(
        self,
        tier: str,
        features: Dict[str, int],
        agents: List[Dict[str, Any]],
        source: str,
    ) -> str:
        """Build a human-readable rationale for the composition.

        Args:
            tier: Complexity tier.
            features: Feature counts.
            agents: Final agent list.
            source: Composition source.

        Returns:
            Rationale string.
        """
        parts = [f"Tier: {tier} ({len(agents)} agents)."]

        active_features = [k for k, v in features.items() if v > 0]
        if active_features:
            parts.append(
                f"Active features: {', '.join(active_features)}."
            )
        else:
            parts.append("No specific features detected; using base team.")

        agent_types = [a["type"] for a in agents]
        parts.append(f"Team: {', '.join(agent_types)}.")
        parts.append(f"Source: {source}.")

        return " ".join(parts)
