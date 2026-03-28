---
title: "feat: Make ce:review-beta autonomous and pipeline-safe"
type: feat
status: active
date: 2026-03-23
origin: direct user request and planning discussion on ce:review-beta standalone vs. autonomous pipeline behavior
---

# Make ce:review-beta Autonomous and Pipeline-Safe

## Overview

Redesign `ce:review-beta` from a purely interactive standalone review workflow into a policy-driven review engine that supports three explicit modes: `interactive`, `autonomous`, and `report-only`. The redesign should preserve the current standalone UX for manual review, enable hands-off review and safe autofix in automated workflows, and define a clean residual-work handoff for anything that should not be auto-fixed. This plan remains beta-only; promotion to stable `ce:review` and any `lfg` / `slfg` cutover should happen only in a follow-up plan after the beta behavior is validated.

## Problem Frame

`ce:review-beta` currently mixes three responsibilities in one loop:

1. Review and synthesis
2. Human approval on what to fix
3. Local fixing, re-review, and push/PR next steps

That is acceptable for standalone use, but it is the wrong shape for autonomous orchestration:

- `lfg` currently treats review as an upstream producer before downstream resolution and browser testing
- `slfg` currently runs review and browser testing in parallel, which is only safe if review is non-mutating
- `resolve-todo-parallel` expects a durable residual-work contract (`todos/`), while `ce:review-beta` currently tries to resolve accepted findings inline
- The findings schema lacks routing metadata, so severity is doing too much work; urgency and autofix eligibility are distinct concerns

The result is a workflow that is hard to promote safely: it can be interactive, or autonomous, or mutation-owning, but not all three at once without an explicit mode model and clearer ownership boundaries.

## Requirements Trace

- R1. `ce:review-beta` supports explicit execution modes: `interactive` (default), `autonomous`, and `report-only`
- R2. `autonomous` mode never asks the user questions, never waits for approval, and applies only policy-allowed safe fixes
- R3. `report-only` mode is strictly read-only and safe to run in parallel with other read-only verification steps
- R4. Findings are routed by explicit fixability metadata, not by severity alone
- R5. `ce:review-beta` can run one bounded in-skill autofix pass for `safe_auto` findings and then re-review the changed scope
- R6. Residual actionable findings are emitted as durable downstream work artifacts; advisory outputs remain report-only
- R7. CE helper outputs (`learnings`, `agent-native`, `schema-drift`, `deployment-verification`) are preserved but only some become actionable work items
- R8. The beta contract makes future orchestration constraints explicit so a later `lfg` / `slfg` cutover does not run a mutating review concurrently with browser testing on the same checkout
- R9. Repeated regression classes around interaction mode, routing, and orchestration boundaries gain lightweight contract coverage

## Scope Boundaries

- Keep the existing persona ensemble, confidence gate, and synthesis model as the base architecture
- Do not redesign every reviewer persona's prompt beyond the metadata they need to emit
- Do not introduce a new general-purpose orchestration framework; reuse existing skill patterns where possible
- Do not auto-fix deployment checklists, residual risks, or other advisory-only outputs
- Do not attempt broad converter/platform work in this change unless the review skill's frontmatter or references require it
- Beta remains the only implementation target in this plan; stable promotion is intentionally deferred to a follow-up plan after validation

## Context & Research

### Relevant Code and Patterns

- `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`
  - Current staged review pipeline with interactive severity acceptance, inline fixer, re-review offer, and post-fix push/PR actions
- `plugins/compound-engineering/skills/ce-review-beta/references/findings-schema.json`
  - Structured persona finding contract today; currently missing routing metadata for autonomous handling
- `plugins/compound-engineering/skills/ce-review/SKILL.md`
  - Current stable review workflow; creates durable `todos/` artifacts rather than fixing findings inline
- `plugins/compound-engineering/skills/resolve-todo-parallel/SKILL.md`
  - Existing residual-work resolver; parallelizes item handling once work has already been externalized
- `plugins/compound-engineering/skills/file-todos/SKILL.md`
  - Existing review -> triage -> todo -> resolve integration contract
- `plugins/compound-engineering/skills/lfg/SKILL.md`
  - Sequential orchestrator whose future cutover constraints should inform the beta contract, even though this plan does not modify it
- `plugins/compound-engineering/skills/slfg/SKILL.md`
  - Swarm orchestrator whose current review/browser parallelism defines an important future integration constraint, even though this plan does not modify it
- `plugins/compound-engineering/skills/ce-compound-refresh/SKILL.md`
  - Strong repo precedent for explicit `mode:autonomous` argument handling and conservative non-interactive behavior
- `plugins/compound-engineering/skills/ce-plan/SKILL.md`
  - Strong repo precedent for pipeline mode skipping interactive questions

### Institutional Learnings

- `docs/solutions/skill-design/compound-refresh-skill-improvements.md`
  - Explicit autonomous mode beats tool-based auto-detection
  - Ambiguous cases in autonomous mode should be recorded conservatively, not guessed
  - Report structure should distinguish applied actions from recommended follow-up
- `docs/solutions/skill-design/beta-skills-framework.md`
  - Beta skills should remain isolated until validated
  - Promotion is the right time to rewire `lfg` / `slfg`, which is out of scope for this plan

### External Research Decision

Skipped. This is a repo-internal orchestration and skill-design change with strong existing local patterns for autonomous mode, beta promotion, and residual-work handling.

## Key Technical Decisions

- **Use explicit mode arguments instead of auto-detection.** Follow `ce:compound-refresh` and require `mode:autonomous` / `mode:report-only` arguments. Interactive remains the default. This avoids conflating "no question tool" with "headless workflow."
- **Split review from mutation semantically, not by creating two separate skills.** `ce:review-beta` should always perform the same review and synthesis stages. Mutation behavior becomes a mode-controlled phase layered on top.
- **Route by fixability, not severity.** Add explicit per-finding routing fields such as `autofix_class`, `owner`, and `requires_verification`. Severity remains urgency; it no longer implies who acts.
- **Keep one in-skill fixer, but only for `safe_auto` findings.** The current "one fixer subagent" rule is still right for consistent-tree edits. The change is that the fixer is selected by policy and routing metadata, not by an interactive severity prompt.
- **Emit both ephemeral and durable outputs.** Use `.context/compound-engineering/ce-review-beta/<run-id>/` for the per-run machine-readable report and create durable `todos/` items only for unresolved actionable findings that belong downstream.
- **Treat CE helper outputs by artifact class.**
  - `learnings-researcher`: contextual/advisory unless a concrete finding corroborates it
  - `agent-native-reviewer`: often `gated_auto` or `manual`, occasionally `safe_auto` when the fix is purely local and mechanical
  - `schema-drift-detector`: default `manual` or `gated_auto`; never auto-fix blindly by default
  - `deployment-verification-agent`: always advisory / operational, never autofix
- **Design the beta contract so future orchestration cutover is safe.** The beta must make it explicit that mutating review cannot run concurrently with browser testing on the same checkout. That requirement is part of validation and future cutover criteria, not a same-plan rewrite of `slfg`.
- **Move push / PR creation decisions out of autonomous review.** Interactive standalone mode may still offer next-step prompts. Autonomous and report-only modes should stop after producing fixes and/or residual artifacts; any future parent workflow decides commit, push, and PR timing.
- **Add lightweight contract tests.** Repeated regressions have come from instruction-boundary drift. String- and structure-level contract tests are justified here even though the behavior is prompt-driven.

## Open Questions

### Resolved During Planning

- **Should `ce:review-beta` keep any embedded fix loop?** Yes, but only for `safe_auto` findings under an explicit mode/policy. Residual work is handed off.
- **Should autonomous mode be inferred from lack of interactivity?** No. Use explicit `mode:autonomous`.
- **Should `slfg` keep review and browser testing in parallel?** No, not once review can mutate the checkout. Run browser testing after the mutating review phase on the stabilized tree.
- **Should residual work be `todos/`, `.context/`, or both?** Both. `.context` holds the run artifact; `todos/` is only for durable unresolved actionable work.

### Deferred to Implementation

- Exact metadata field names in `findings-schema.json`
- Whether `report-only` should imply a different default output template section ordering than `interactive` / `autonomous`
- Whether residual `todos/` should be created directly by `ce:review-beta` or via a small shared helper/reference template used by both review and resolver flows

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```text
review stages -> synthesize -> classify outputs by autofix_class/owner
               -> if mode=report-only: emit report + stop
               -> if mode=interactive: acquire policy from user
               -> if mode=autonomous: use policy from arguments/defaults
               -> run single fixer on safe_auto set
               -> verify tests + focused re-review
               -> emit residual todos for unresolved actionable items
               -> emit advisory/report sections for non-actionable outputs
```

## Implementation Units

- [x] **Unit 1: Add explicit mode handling and routing metadata to ce:review-beta**

**Goal:** Give `ce:review-beta` a clear execution contract for standalone, autonomous, and read-only pipeline use.

**Requirements:** R1, R2, R3, R4, R7

**Dependencies:** None

**Files:**
- Modify: `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`
- Modify: `plugins/compound-engineering/skills/ce-review-beta/references/findings-schema.json`
- Modify: `plugins/compound-engineering/skills/ce-review-beta/references/review-output-template.md`
- Modify: `plugins/compound-engineering/skills/ce-review-beta/references/subagent-template.md` (if routing metadata needs to be spelled out in spawn prompts)

**Approach:**
- Add a Mode Detection section near the top of `SKILL.md` using the established `mode:autonomous` argument pattern from `ce:compound-refresh`
- Introduce `mode:report-only` alongside `mode:autonomous`
- Scope all interactive question instructions so they apply only to interactive mode
- Extend `findings-schema.json` with routing-oriented fields such as:
  - `autofix_class`: `safe_auto | gated_auto | manual | advisory`
  - `owner`: `review-fixer | downstream-resolver | human | release`
  - `requires_verification`: boolean
- Update the review output template so the final report can distinguish:
  - applied fixes
  - residual actionable work
  - advisory / operational notes

**Patterns to follow:**
- `plugins/compound-engineering/skills/ce-compound-refresh/SKILL.md` explicit autonomous mode structure
- `plugins/compound-engineering/skills/ce-plan/SKILL.md` pipeline-mode question skipping

**Test scenarios:**
- Interactive mode still presents questions and next-step prompts
- `mode:autonomous` never asks a question and never waits for user input
- `mode:report-only` performs no edits and no commit/push/PR actions
- A helper-agent output can be preserved in the final report without being treated as auto-fixable work

**Verification:**
- `tests/review-skill-contract.test.ts` asserts the three mode markers and interactive scoping rules
- `bun run release:validate` passes

- [x] **Unit 2: Redesign the fix loop around policy-driven safe autofix and bounded re-review**

**Goal:** Replace the current severity-prompt-centric fix loop with one that works in both interactive and autonomous contexts.

**Requirements:** R2, R4, R5, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`
- Add: `plugins/compound-engineering/skills/ce-review-beta/references/fix-policy.md` (if the classification and policy table becomes too large for `SKILL.md`)
- Modify: `plugins/compound-engineering/skills/ce-review-beta/references/review-output-template.md`

**Approach:**
- Replace "Severity Acceptance" as the primary decision point with a classification stage that groups synthesized findings by `autofix_class`
- In interactive mode, ask the user only for policy decisions that remain ambiguous after classification
- In autonomous mode, use conservative defaults:
  - apply `safe_auto`
  - leave `gated_auto`, `manual`, and `advisory` unresolved
- Keep the "exactly one fixer subagent" rule for consistency
- Bound the loop with `max_rounds` (for example 2) and require targeted verification plus focused re-review after any applied fix set
- Restrict commit / push / PR creation steps to interactive mode only; autonomous and report-only modes stop after emitting outputs

**Patterns to follow:**
- `docs/solutions/skill-design/compound-refresh-skill-improvements.md` applied-vs-recommended distinction
- Existing `ce-review-beta` single-fixer rule

**Test scenarios:**
- A `safe_auto` testing finding gets fixed and re-reviewed without user input in autonomous mode
- A `gated_auto` API contract or authz finding is preserved as residual actionable work, not auto-fixed
- A deployment checklist remains advisory and never enters the fixer queue
- Zero findings skip the fix phase entirely
- Re-review is bounded and does not recurse indefinitely

**Verification:**
- `tests/review-skill-contract.test.ts` asserts that autonomous mode has no mandatory user-question step in the fix path
- Manual dry run: read the fix-loop prose end-to-end and verify there is no mutation-owning step outside the policy gate

- [x] **Unit 3: Define residual artifact and downstream handoff behavior**

**Goal:** Make autonomous review compatible with downstream workflows instead of competing with them.

**Requirements:** R5, R6, R7

**Dependencies:** Unit 2

**Files:**
- Modify: `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`
- Modify: `plugins/compound-engineering/skills/resolve-todo-parallel/SKILL.md`
- Modify: `plugins/compound-engineering/skills/file-todos/SKILL.md`
- Add: `plugins/compound-engineering/skills/ce-review-beta/references/residual-work-template.md` (if a dedicated durable-work shape helps keep review prose smaller)

**Approach:**
- Write a per-run review artifact under `.context/compound-engineering/ce-review-beta/<run-id>/` containing:
  - synthesized findings
  - what was auto-fixed
  - what remains unresolved
  - advisory-only outputs
- Create durable `todos/` items only for unresolved actionable findings whose `owner` is downstream resolution
- Update `resolve-todo-parallel` to acknowledge this source explicitly so residual review work can be picked up without pretending everything came from stable `ce:review`
- Update `file-todos` integration guidance to reflect the new flow:
  - review-beta autonomous -> residual todos -> resolve-todo-parallel
  - advisory-only outputs do not become todos

**Patterns to follow:**
- `.context/compound-engineering/<workflow>/<run-id>/` scratch-space convention from `AGENTS.md`
- Existing `file-todos` review/resolution lifecycle

**Test scenarios:**
- Autonomous review with only advisory outputs creates no todos
- Autonomous review with 2 unresolved actionable findings creates exactly 2 residual todos
- Residual work items exclude protected-artifact cleanup suggestions
- The run artifact is sufficient to explain what the in-skill fixer changed vs. what remains

**Verification:**
- `tests/review-skill-contract.test.ts` asserts the documented `.context` and `todos/` handoff rules
- `bun run release:validate` passes after any skill inventory/reference changes

- [x] **Unit 4: Add contract-focused regression coverage for mode, handoff, and future-integration boundaries**

**Goal:** Catch the specific instruction-boundary regressions that have repeatedly escaped manual review.

**Requirements:** R8, R9

**Dependencies:** Units 1-3

**Files:**
- Add: `tests/review-skill-contract.test.ts`
- Optionally modify: `package.json` only if a new test entry point is required (prefer using the existing Bun test setup without package changes)

**Approach:**
- Add a focused test that reads the relevant skill files and asserts contract-level invariants instead of brittle full-file snapshots
- Cover:
  - `ce-review-beta` mode markers and mode-specific behavior phrases
  - absence of unconditional interactive prompts in autonomous/report-only paths
  - explicit residual-work handoff language
  - explicit documentation that mutating review must not run concurrently with browser testing on the same checkout
- Keep assertions semantic and localized; avoid snapshotting large markdown files

**Patterns to follow:**
- Existing Bun tests that read repository files directly for release/config validation

**Test scenarios:**
- Missing `mode:autonomous` block fails
- Reintroduced unconditional "Ask the user" text in the autonomous path fails
- Missing residual todo handoff text fails
- Missing future integration constraint around mutating review vs. browser testing fails

**Verification:**
- `bun test tests/review-skill-contract.test.ts`
- full `bun test`

## Risks & Dependencies

- **Over-aggressive autofix classification.**
  - Mitigation: conservative defaults, `gated_auto` bucket, bounded rounds, focused re-review
- **Dual ownership confusion between `ce:review-beta` and `resolve-todo-parallel`.**
  - Mitigation: explicit owner/routing metadata and durable residual-work contract
- **Brittle contract tests.**
  - Mitigation: assert only boundary invariants, not full markdown snapshots
- **Promotion churn.**
  - Mitigation: keep beta isolated until Unit 4 contract coverage and manual verification pass

## Sources & References

- Related skills:
  - `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`
  - `plugins/compound-engineering/skills/ce-review/SKILL.md`
  - `plugins/compound-engineering/skills/resolve-todo-parallel/SKILL.md`
  - `plugins/compound-engineering/skills/file-todos/SKILL.md`
  - `plugins/compound-engineering/skills/lfg/SKILL.md`
  - `plugins/compound-engineering/skills/slfg/SKILL.md`
- Institutional learnings:
  - `docs/solutions/skill-design/compound-refresh-skill-improvements.md`
  - `docs/solutions/skill-design/beta-skills-framework.md`
- Supporting pattern reference:
  - `plugins/compound-engineering/skills/ce-compound-refresh/SKILL.md`
  - `plugins/compound-engineering/skills/ce-plan/SKILL.md`
