#!/usr/bin/env python3
"""v7.7.24: cross-project knowledge "lift" report (the memory moat proof).

WHAT THIS MEASURES (honestly):
    Loki's moat claim is that knowledge learned on one project helps a
    DIFFERENT project. The transfer mechanism is real and already in the
    codebase: each project's semantic patterns (.loki/memory/semantic/)
    are extracted into an org-wide knowledge graph
    (memory/knowledge_graph.py -> ~/.loki/knowledge/patterns.jsonl), and
    any other project can query that graph (query_patterns).

    "Lift" here is a RETRIEVAL-COVERAGE metric, not a task-success metric.
    For a target project's set of task goals we count how many RELEVANT
    patterns are retrievable in two conditions:
        baseline: only the target project's own patterns are in the graph
        cross:    the target's patterns PLUS sibling projects' patterns
    Lift = (relevant retrieved in cross) - (relevant retrieved in baseline),
    and net-new = relevant patterns that ONLY the sibling projects could
    supply (the target could never have surfaced them alone).

WHAT THIS DOES NOT CLAIM:
    - It does NOT claim downstream task success / fewer iterations / lower
      cost. That requires running real LLM tasks end-to-end, which this
      offline harness does not do. Measuring that is a separate, larger
      benchmark.
    - "Relevant" is keyword-overlap against the goal, not semantic ground
      truth. It is a proxy. The number is a coverage signal, not a
      correctness guarantee.

The harness is fully self-contained: it seeds synthetic projects in a
temp dir, points the knowledge graph at a temp knowledge dir, runs both
conditions, prints a report, and self-cleans. It never touches a real
~/.loki/knowledge or any real .loki/memory.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_HERE)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


# Synthetic patterns per source project. Each is a semantic pattern dict
# matching what memory/knowledge_graph.py reads (name/category/description).
SOURCE_PROJECTS = {
    "payments-api": [
        {"name": "idempotency-key-on-charge", "category": "reliability",
         "description": "retry-safe charge endpoints require an idempotency key header"},
        {"name": "stripe-webhook-signature-verify", "category": "security",
         "description": "verify stripe webhook signatures before processing payment events"},
        {"name": "decimal-money-never-float", "category": "correctness",
         "description": "represent money as integer cents or Decimal, never float"},
    ],
    "auth-service": [
        {"name": "jwt-short-ttl-refresh-rotation", "category": "security",
         "description": "access tokens short ttl with rotating refresh tokens"},
        {"name": "rate-limit-login-by-ip-and-account", "category": "security",
         "description": "rate limit login attempts per ip and per account to stop credential stuffing"},
        {"name": "argon2-password-hash", "category": "security",
         "description": "hash passwords with argon2id not bcrypt for new services"},
    ],
}

# Patterns the TARGET project already knows on its own (so they are NOT
# net-new from siblings).
TARGET_OWN_PATTERNS = [
    {"name": "openapi-spec-first", "category": "design",
     "description": "write the openapi spec before implementing the api"},
]

# The target project's task goals. Each goal SHOULD be served by a
# sibling pattern (that the target lacks). These are the realistic
# overlaps a new billing+login service would hit.
TARGET_GOALS = [
    "make the charge endpoint safe to retry",
    "verify incoming payment webhooks are authentic",
    "store monetary amounts without rounding errors",
    "secure login against credential stuffing attacks",
    "choose a password hashing algorithm",
    "design the api contract up front",  # served by target's OWN pattern
]


def _seed_project(root: Path, name: str, patterns: list) -> None:
    semantic = root / name / ".loki" / "memory" / "semantic"
    semantic.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(patterns):
        with open(semantic / f"pattern_{i}.json", "w") as f:
            json.dump(p, f)


def _relevant(pattern: dict, goal: str) -> bool:
    """Keyword-overlap relevance proxy: any meaningful token from the
    pattern name/description appears in the goal, or vice versa."""
    stop = {"the", "a", "an", "to", "for", "of", "and", "or", "with",
            "without", "is", "are", "be", "up", "on", "in", "by", "not",
            "make", "choose", "store"}
    def toks(s):
        return {t for t in s.lower().replace("-", " ").split() if t not in stop and len(t) > 2}
    goal_t = toks(goal)
    pat_t = toks(pattern.get("name", "")) | toks(pattern.get("description", ""))
    return len(goal_t & pat_t) >= 2


def _coverage(graph, goals, top_k):
    """For each goal, query the graph and count goals that retrieved at
    least one relevant pattern. Returns (covered_goals, served_by_sibling)."""
    covered = 0
    sibling_served = 0
    details = []
    for goal in goals:
        results = graph.query_patterns(goal, max_results=top_k)
        relevant = [r for r in results if _relevant(r, goal)]
        is_covered = len(relevant) > 0
        # served_by_sibling: at least one relevant result came from a
        # non-target source project.
        from_sibling = any(
            r.get("_source_project", "").rsplit("/", 1)[-1] != "target-billing-login"
            for r in relevant
        )
        if is_covered:
            covered += 1
        if is_covered and from_sibling:
            sibling_served += 1
        details.append({
            "goal": goal,
            "covered": is_covered,
            "relevant_count": len(relevant),
            "served_by_sibling": is_covered and from_sibling,
        })
    return covered, sibling_served, details


def run(top_k: int, as_json: bool) -> int:
    tmp = tempfile.mkdtemp(prefix="loki-xproj-lift-")
    try:
        from memory.knowledge_graph import OrganizationKnowledgeGraph

        projects_root = Path(tmp) / "git"
        projects_root.mkdir(parents=True)

        # Seed sibling source projects + the target project.
        for name, pats in SOURCE_PROJECTS.items():
            _seed_project(projects_root, name, pats)
        _seed_project(projects_root, "target-billing-login", TARGET_OWN_PATTERNS)

        target_dir = projects_root / "target-billing-login"
        sibling_dirs = [projects_root / n for n in SOURCE_PROJECTS]

        # BASELINE: knowledge graph built from the target alone.
        base_kg = OrganizationKnowledgeGraph(
            knowledge_dir=str(Path(tmp) / "knowledge-baseline"))
        base_pats = base_kg.extract_patterns([target_dir])
        base_kg.save_patterns(base_kg.deduplicate_patterns(base_pats))
        base_covered, base_sibling, base_detail = _coverage(base_kg, TARGET_GOALS, top_k)

        # CROSS: knowledge graph built from target + siblings.
        cross_kg = OrganizationKnowledgeGraph(
            knowledge_dir=str(Path(tmp) / "knowledge-cross"))
        cross_pats = cross_kg.extract_patterns([target_dir] + sibling_dirs)
        cross_kg.save_patterns(cross_kg.deduplicate_patterns(cross_pats))
        cross_covered, cross_sibling, cross_detail = _coverage(cross_kg, TARGET_GOALS, top_k)

        n = len(TARGET_GOALS)
        lift = cross_covered - base_covered
        report = {
            "goals": n,
            "baseline_covered": base_covered,
            "cross_covered": cross_covered,
            "lift_absolute": lift,
            "lift_pct_points": round(100.0 * lift / n, 1),
            "net_new_from_siblings": cross_sibling - base_sibling,
            "top_k": top_k,
            "method": "retrieval-coverage (keyword-overlap relevance proxy), NOT task-success",
            "per_goal": cross_detail,
        }

        if as_json:
            print(json.dumps(report, indent=2))
        else:
            print("Cross-project knowledge LIFT report (memory moat proof)")
            print(f"  target goals:               {n}")
            print(f"  covered (target alone):     {base_covered}/{n}")
            print(f"  covered (target + siblings): {cross_covered}/{n}")
            print(f"  LIFT:                       +{lift} goals "
                  f"(+{report['lift_pct_points']} pts)")
            print(f"  net-new served by siblings: {report['net_new_from_siblings']}")
            print(f"  method: {report['method']}")
            print("  per-goal:")
            for d in cross_detail:
                tag = "sibling" if d["served_by_sibling"] else ("self" if d["covered"] else "MISS")
                print(f"    [{tag:7}] {d['goal']}")

        # Exit non-zero if there is no measurable lift (so it can gate CI:
        # a regression that breaks cross-project transfer would fail here).
        return 0 if lift > 0 else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Cross-project knowledge lift report")
    ap.add_argument("--top-k", type=int, default=5, help="patterns retrieved per goal")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    args = ap.parse_args()
    sys.exit(run(args.top_k, args.json))


if __name__ == "__main__":
    main()
