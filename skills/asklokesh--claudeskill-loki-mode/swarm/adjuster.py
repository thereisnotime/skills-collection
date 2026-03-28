"""Mid-Project Agent Adjustment - Dynamic swarm reconfiguration.

Monitors quality signals during project execution and recommends
agent additions, removals, or replacements based on performance data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


# Map failing gate names to specialist agent types
GATE_TO_AGENT: Dict[str, str] = {
    "mock_detector": "eng-qa",
    "mock_detection": "eng-qa",
    "test_coverage": "eng-qa",
    "testing": "eng-qa",
    "unit_test": "eng-qa",
    "integration_test": "eng-qa",
    "e2e": "eng-qa",
    "security": "ops-security",
    "security_scan": "ops-security",
    "vulnerability": "ops-security",
    "owasp": "ops-security",
    "code_quality": "review-code",
    "code_review": "review-code",
    "lint": "review-code",
    "static_analysis": "review-code",
    "performance": "eng-perf",
    "load_test": "eng-perf",
    "benchmark": "eng-perf",
    "deployment": "ops-devops",
    "ci_cd": "ops-devops",
    "infrastructure": "eng-infra",
    "database": "eng-database",
    "migration": "eng-database",
    "frontend": "eng-frontend",
    "ui": "eng-frontend",
    "accessibility": "eng-frontend",
    "api": "eng-api",
    "documentation": "prod-techwriter",
}


class SwarmAdjuster:
    """Monitors quality signals and adjusts agent composition mid-project.

    Evaluates quality signals (gate pass rates, test coverage, review
    feedback) and recommends swarm composition changes to address
    detected weaknesses.
    """

    def evaluate_adjustment(
        self,
        current_agents: List[Dict[str, Any]],
        quality_signals: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Evaluate whether the swarm needs adjustment.

        Args:
            current_agents: List of agent dicts with at least 'type' and
                'priority' keys.
            quality_signals: Dict with quality metrics:
                gate_pass_rate: float (0-1) -- fraction of quality gates passing
                test_coverage: float (0-1) -- code test coverage
                review_pass_rate: float (0-1) -- fraction of reviews passing
                iteration_count: int -- current RARV iteration
                failed_gates: list[str] -- names of failing quality gates

        Returns:
            Dict with keys:
                action: "none" | "add" | "remove" | "replace"
                agents_to_add: list of {type, reason} dicts
                agents_to_remove: list of {type, reason} dicts
                rationale: human-readable explanation
        """
        gate_pass_rate = quality_signals.get("gate_pass_rate", 1.0)
        test_coverage = quality_signals.get("test_coverage", 1.0)
        review_pass_rate = quality_signals.get("review_pass_rate", 1.0)
        iteration_count = quality_signals.get("iteration_count", 0)
        failed_gates = quality_signals.get("failed_gates", [])

        current_types = {a.get("type", "") for a in current_agents}
        agents_to_add: List[Dict[str, str]] = []
        agents_to_remove: List[Dict[str, str]] = []
        reasons: List[str] = []

        # Rule 1: Failing quality gates after several iterations
        if gate_pass_rate < 0.5 and iteration_count > 3:
            for gate_name in failed_gates:
                agent_type = GATE_TO_AGENT.get(gate_name.lower())
                if agent_type and agent_type not in current_types:
                    agents_to_add.append({
                        "type": agent_type,
                        "reason": f"Gate '{gate_name}' failing consistently",
                    })
                    current_types.add(agent_type)
            if agents_to_add:
                reasons.append(
                    f"Gate pass rate ({gate_pass_rate:.0%}) below 50% "
                    f"after {iteration_count} iterations"
                )

        # Rule 2: Low test coverage
        if test_coverage < 0.6 and "eng-qa" not in current_types:
            agents_to_add.append({
                "type": "eng-qa",
                "reason": f"Test coverage at {test_coverage:.0%}, below 60% threshold",
            })
            current_types.add("eng-qa")
            reasons.append(f"Test coverage ({test_coverage:.0%}) critically low")

        # Rule 3: Low review pass rate
        if review_pass_rate < 0.5 and "review-security" not in current_types:
            agents_to_add.append({
                "type": "review-security",
                "reason": f"Review pass rate at {review_pass_rate:.0%}, adding security review",
            })
            current_types.add("review-security")
            reasons.append(f"Review pass rate ({review_pass_rate:.0%}) below 50%")

        # Rule 4: Everything healthy -- consider trimming
        if (
            gate_pass_rate > 0.8
            and test_coverage > 0.8
            and review_pass_rate > 0.8
            and len(current_agents) > 4
            and not agents_to_add
        ):
            # Find lowest-priority agent to potentially remove
            optional_agents = [
                a for a in current_agents
                if a.get("priority", 1) >= 3
            ]
            if optional_agents:
                # Remove the one with highest priority number (least critical)
                to_remove = max(optional_agents, key=lambda a: a.get("priority", 1))
                agents_to_remove.append({
                    "type": to_remove.get("type", "unknown"),
                    "reason": "All quality signals healthy; reducing team size",
                })
                reasons.append(
                    "All signals above 80%; trimming optional agent"
                )

        # Determine action
        if agents_to_add and agents_to_remove:
            action = "replace"
        elif agents_to_add:
            action = "add"
        elif agents_to_remove:
            action = "remove"
        else:
            action = "none"
            reasons.append("All quality signals within acceptable range")

        return {
            "action": action,
            "agents_to_add": agents_to_add,
            "agents_to_remove": agents_to_remove,
            "rationale": "; ".join(reasons) if reasons else "No adjustment needed",
        }
