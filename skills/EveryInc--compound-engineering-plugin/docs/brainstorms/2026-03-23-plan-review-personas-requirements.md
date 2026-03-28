---
date: 2026-03-23
topic: plan-review-personas
---

# Persona-Based Plan Review for document-review

## Problem Frame

The `document-review` skill currently uses a single-voice evaluator with five generic criteria (Clarity, Completeness, Specificity, Appropriate Level, YAGNI). This catches surface-level issues but misses role-specific concerns: a security engineer, product leader, and design reviewer each see different problems in the same plan. The ce:review skill already demonstrates that multi-persona review produces richer, more actionable feedback for code. The same architecture should apply to plan review.

## Requirements

- R1. Replace the current single-voice `document-review` with a persona pipeline that dispatches specialized reviewer agents in parallel against the target document.

- R2. Implement 2 always-on personas that run on every document review:
  - **coherence**: Internal consistency, contradictions, terminology drift, structural issues, ambiguity. Checks whether readers would diverge on interpretation.
  - **feasibility**: Can this actually be built? Architecture decisions, external dependencies, performance requirements, migration strategies. Absorbs the "tech-plan implementability" angle (can an implementer code from this?).

- R3. Implement 4 conditional personas that activate based on document content analysis:
  - **product-lens**: Activates when the document contains user-facing features, market claims, scope decisions, or prioritization. Opens with a "premise challenge" -- 3 diagnostic questions that challenge whether the plan solves the right problem. Asks: "What's the 10-star version? What's the narrowest wedge that proves demand?"
  - **design-lens**: Activates when the document contains UI/UX work, frontend changes, or user flows. Uses a "rate 0-10 and describe what 10 looks like" dimensional rating method. Rates design dimensions concretely, identifies what "great" looks like for each.
  - **security-lens**: Activates when the document contains auth, data handling, external APIs, or payments. Evaluates threat model at the plan level, not code level. Surfaces what the plan fails to account for.
  - **scope-guardian**: Activates when the document contains multiple priority levels, unclear boundaries, or goals that don't align with requirements. Absorbs the "skeptic" angle -- challenges unnecessary complexity, premature abstractions, and frameworks ahead of need. Opens with a "what already exists?" check against the codebase.

- R4. The skill auto-detects which conditional personas are relevant by analyzing the document content. No user configuration required for persona selection.

- R5. Hybrid action model after persona findings are synthesized:
  - **Auto-fix**: Document quality issues (contradictions, terminology drift, structural problems, missing details that can be inferred). These are unambiguously improvements.
  - **Present for user decision**: Strategic/product questions (problem framing, scope challenges, priority conflicts, "is this the right thing to build?"). These require human judgment.

- R6. Each persona returns structured findings with confidence scores. The orchestrator deduplicates overlapping findings across personas and synthesizes into a single prioritized report.

- R7. Maintain backward compatibility with all existing callers:
  - `ce-brainstorm` Phase 4 "Review and refine" option
  - `ce-plan` / `ce-plan-beta` post-generation "Review and refine" option
  - `deepen-plan-beta` post-deepening "Review and refine" option
  - Standalone invocation
  - Returns "Review complete" when done, as callers expect

- R8. Pipeline-compatible: When called from automated pipelines (e.g., future lfg/slfg integration), auto-fixes run silently and only genuinely blocking strategic questions surface to the user.

## Success Criteria

- Running document-review on a plan surfaces role-specific issues that the current single-voice evaluator misses (e.g., security gaps, product framing problems, scope concerns).
- Conditional personas activate only when relevant -- a backend refactor plan does not spawn design-lens.
- Auto-fix changes improve the document without requiring user approval for every edit.
- Strategic findings are presented as clear questions, not vague observations.
- All existing callers (brainstorm, plan, plan-beta, deepen-plan-beta) work without modification.

## Scope Boundaries

- Not adding new callers or pipeline integrations beyond maintaining existing ones.
- Not changing how deepen-plan-beta works (it strengthens with research; document-review reviews for issues).
- Not adding user configuration for persona selection (auto-detection only for now).
- Not inventing new review frameworks -- incorporating established review patterns (premise challenge, dimensional rating, existing-code check) into the respective personas.

## Key Decisions

- **Replace, don't layer**: document-review is fully replaced by the persona pipeline, not enhanced with an optional mode. Simpler mental model, one behavior.
- **2 always-on + 4 conditional**: Coherence and feasibility run on every document. Product-lens, design-lens, security-lens, and scope-guardian activate based on content. Keeps cost proportional to document complexity.
- **Hybrid action model**: Auto-fix document quality issues, present strategic questions. Matches the natural split between what personas surface.
- **Absorb skeptic into scope-guardian**: Both challenge whether the plan is right-sized. One persona with both angles avoids redundancy.
- **Absorb tech-plan implementability into feasibility**: Both ask "can this work?" One persona with both angles.
- **Review patterns as persona behavior, not separate mechanisms**: Premise challenge goes into product-lens, dimensional rating goes into design-lens, existing-code check goes into scope-guardian.

## Dependencies / Assumptions

- Assumes the ce:review agent orchestration pattern (parallel dispatch, synthesis, dedup) can be adapted for plan review without fundamental changes.
- Assumes plan/requirements documents are text-based and contain enough signal for content-based conditional persona selection.

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] What is the exact structured output format for persona findings? Should it mirror ce:review's P1/P2/P3 severity model or use a different classification?
- [Affects R4][Needs research] What content signals reliably detect each conditional persona's relevance? Need to define the heuristics (keyword-based, section-based, or semantic).
- [Affects R1][Technical] Should personas be implemented as compound-engineering agents (like code review agents) or as inline prompt sections within the skill? Agents enable parallel dispatch; inline is simpler.
- [Affects R5][Technical] How should the auto-fix mechanism work -- direct inline edits like current document-review, or a separate "apply fixes" pass after synthesis?
- [Affects R7][Technical] Do any of the 4 existing callers need minor updates to handle the new output format, or is the "Review complete" contract sufficient?

## Next Steps

-> /ce:plan for structured implementation planning
