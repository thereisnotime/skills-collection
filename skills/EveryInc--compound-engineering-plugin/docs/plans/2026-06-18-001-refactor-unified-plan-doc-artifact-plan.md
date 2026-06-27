---
title: "refactor: Unify brainstorm and plan artifacts"
type: refactor
date: 2026-06-18
---

# refactor: Unify brainstorm and plan artifacts

## Summary

Unify `ce-brainstorm` and `ce-plan` around one canonical document in `docs/plans/`: a requirements-first plan skeleton that `ce-plan` later enriches in place with technical decisions, implementation units, verification, and goal-mode completion criteria.

This preserves the current WHAT/HOW workflow separation in the skills while removing the artifact split that causes requirements drift, weak shareability, and inefficient traceability.

---

## Problem Frame

Today `ce-brainstorm` writes a requirements document under `docs/brainstorms/`, and `ce-plan` writes a separate implementation plan under `docs/plans/`. That mirrors common human documentation practice, but it creates a fragile handoff for agents: the implementation agent primarily reads the plan, the requirements live elsewhere, and later requirement changes can drift from the technical plan.

The proposed change makes "plan" mean the whole decision artifact: product contract, scenarios, technical planning, implementation units, and definition of done. `ce-brainstorm` creates the artifact when requirements exploration is warranted; `ce-plan` can either enrich that artifact or create the same artifact directly when brainstorming is skipped.

---

## Requirements

**Unified artifact**

- R1. `ce-brainstorm` writes a requirements-first unified plan document under `docs/plans/`, not a new canonical `docs/brainstorms/*-requirements.*` document.
- R2. `ce-plan` enriches an existing unified plan in place when invoked from `ce-brainstorm`, preserving product decisions and stable IDs.
- R3. `ce-plan` still works as a direct entry point and can create a unified plan with both product and technical sections from a bare request.
- R4. Existing legacy brainstorm documents and plans with `origin: docs/brainstorms/...` continue to resolve indefinitely.
- R4a. Brainstorm-sourced unified plans carry an origin-equivalent metadata field so reviewers can distinguish `ce-brainstorm` product contracts from greenfield `ce-plan` bootstraps.

**Agent execution quality**

- R5. The unified document uses stable section headings and a `Goal Capsule` near the top so downstream agents wayfind by heading scan and route themselves without reading the whole file.
- R6. The document includes a `Definition of Done` section with global and per-unit completion criteria suitable for `/goal` or equivalent long-running workflows.
- R7. The launch prompt for an artifact's current readiness is **emitted by the skill at handoff** — printed as a copyable `/goal` prompt on hosts where `/goal` is user-typed (Claude Code), or started directly via a callable goal tool (Codex `create_goal`). It is **not** baked into the document as a section, so it never goes stale as the template evolves. The single source is `ce-work`'s `references/execution-engines.md`.
- R7a. `ce-plan` may offer to kick off that launch prompt only when the output has a concrete goal-shaped deliverable, done criteria, and stop condition. Implementation-ready code plans get implementation goals; approach-plans and "plan for a plan" outputs may get planning or knowledge-work goals, but never a code-execution goal unless the accepted deliverable is itself a software implementation plan.
- R8. Each implementation unit remains self-contained enough that a subagent can execute that unit after reading the `Goal Capsule`, `Definition of Done`, and that unit.
- R8a. Implementation-ready plan docs include repo-specific verification commands, quality gates, and test scenarios discovered during planning; the emitted launch prompt must not depend on the launching agent already knowing the repo's test commands or review conventions.

**Format and workflow compatibility**

- R9. Markdown and HTML output modes remain supported as exclusive alternatives, with HTML gaining stronger navigation for longer unified artifacts.
- R10. `ce-work`, `ce-doc-review`, `ce-proof`, `ce-code-review`, and docs pages understand the unified artifact and do not misclassify a requirements-only plan skeleton as execution-ready.
- R10a. `ce-work` may use goal-mode as an implementation engine when the host exposes a callable goal tool (Codex `create_goal`), while retaining `ce-work` ownership of implementation-engine selection, bounded plan reading, unit execution, and standalone quality gates. `create_goal` sets the active objective for the current session, so it is used standalone, never in return-to-caller (which must return control).
- R10b. `lfg` always invokes `ce-work` for implementation after `ce-plan` produces an implementation-ready code plan. `ce-work`, not LFG, decides whether to execute inline, with subagents, or with goal-mode. LFG's changes are limited to unified-plan readiness gating, explicit plan-path handoff, return-to-caller invocation, and post-`ce-work` pipeline continuation.
- R10c. `ce-work` supports a return-to-caller mode for LFG: it implements and verifies the plan, then returns control so LFG can run its larger simplify/review/test/PR/CI pipeline without duplicating `ce-work`'s standalone handoff.
- R10d. `ce-work` treats dynamic workflows / ultracode-style orchestration as a distinct execution engine from goal-mode when the host platform supports it.
- R10e. Adjacent skills with plan discovery or brainstorm handoffs, including `ce-work-beta`, `ce-ideate`, and `ce-riffrec-feedback-analysis`, are either updated or explicitly documented as out of scope with a guard.
- R11. Tests enforce the new single-artifact contract, legacy compatibility, heading-scan wayfinding, skill-emitted launch behavior, and downstream discovery behavior.

---

## Key Technical Decisions

- **Keep one canonical artifact under `docs/plans/`:** This aligns with `ce-work`, which already treats plan documents as the execution source, and avoids teaching every downstream skill to stitch together two files.
- **Use readiness metadata, not mutable progress status:** Add explicit artifact-shape metadata such as `artifact_contract: ce-unified-plan/v1`, `artifact_readiness: requirements-only|implementation-ready`, and `product_contract_source`, but do not introduce an execution `status:` lifecycle. Progress still lives in git, task trackers, commits, and final summaries.
- **Replace `origin:` with an origin-equivalent only for new unified artifacts:** New brainstorm-sourced unified plans should use `product_contract_source: ce-brainstorm`. Direct `ce-plan` bootstraps should use `product_contract_source: ce-plan-bootstrap`. Legacy plans keep `origin: docs/brainstorms/...`, and readers must continue to resolve that field.
- **Retain legacy `docs/brainstorms/` as read-only historical input:** Do not migrate or rewrite old brainstorm documents. `ce-plan` and reviewers should search both legacy requirements docs and unified plan docs during the transition.
- **Top-load the reader contract:** The first screen of the document must tell agents what to read for their role. Long documents are acceptable only if readers can avoid loading appendices and unrelated sections.
- **Make the document the authority; emit the launch prompt, don't bake it:** The launch prompt is generated by the skill at handoff (a copyable `/goal` on Claude Code, or `create_goal` on Codex) from a single living template — it is **not** a section in the document. The durable authority for scope, decisions, verification, and completion lives in the document body, because any goal or agent that reads the plan uses those sections after the initial prompt is forgotten or summarized. Baking a rendered prompt into each doc would only let it drift from the current template as the template evolves.
- **Make completion criteria visible prose, not hidden machine data:** The goal and DoD sections should be normal markdown or visible HTML so humans and agents consume the same authority.
- **Do not let brainstorm leak implementation detail:** The unified artifact can be plan-shaped before it is implementation-ready, but `ce-brainstorm` still owns product behavior, scope, scenarios, and success criteria only.
- **Make verification portable:** `ce-plan` must write concrete repo-specific commands and quality gates into the plan from local research, such as `bun test`, `bun run release:validate`, `pytest`, `npm test`, `rails test`, lint/typecheck commands, review requirements, and any skill-specific validation like `skill-creator`. A goal launched weeks later should not need to infer the test suite from scratch.
- **Gate launch behavior by goal kind:** The unified contract applies to code implementation artifacts. `ce-plan` also supports universal planning, answer-seeking, and approach-altitude "plan for a plan" outputs; those are valid `ce-plan` outcomes and some can be goal-shaped, but they must not invent a third unified readiness state such as `artifact_readiness: approach-plan`. Implementation launch offers require both `execution: code` and `artifact_readiness: implementation-ready`. Planning or knowledge-work launch offers require a saved approach-plan with a concrete deliverable, authority sources, done criteria, and a stop condition.
- **Probe for a callable goal tool, not a command name:** The literal `/goal` slash command is not skill-invocable on any host. Codex exposes a callable goal **tool** (`create_goal`/`update_goal`) that a skill can use to start a goal directly; Claude Code exposes no goal tools at all (confirmed empirically). So skills probe for the tool: where present (Codex), call `create_goal` to start the goal in the current session; where absent (Claude Code), emit a copyable `/goal` prompt for the user to paste, or fall back to inline/subagent/dynamic-workflow execution. `create_goal` sets the current session's active objective — it is not a background worker and returns no awaitable envelope — and the working session marks completion via `update_goal`, so the launching skill does not call `update_goal` itself.
- **Keep blank discovery conservative:** Blank `ce-work` must not silently skip a newest requirements-only, knowledge-work, or approach-plan artifact to execute an older implementation plan. Auto-execution should require an implementation-ready code artifact or an unambiguous user-supplied path/match.
- **Keep one owner for the tail:** Simplification, review, PR, and CI can belong to a top-level goal/dynamic workflow, standalone `ce-work`, or LFG, but not more than one at the same time. Launch prompts and skill modes must declare whether they are implementation-only or end-to-end.
- **Default Claude Code launch to `/goal`, escalate to `ultracode` only by shape:** For implementation-ready unified plans, the normal Claude Code recommendation is `/goal` because the plan already supplies the objective, authority, U-ID decomposition, and DoD. Recommend a dynamic workflow / `ultracode:` prompt only when the plan needs script-owned orchestration: many independent U-IDs, codebase-wide sweeps, large migrations, adversarial cross-checking, or multi-angle research/planning where intermediate results should stay out of the main context.

---

## Proposed Unified Document Contract

Required top-level shape for markdown:

```markdown
---
title: Example capability - Plan
type: feat
date: 2026-06-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only # requirements-only | implementation-ready
product_contract_source: ce-brainstorm # ce-brainstorm | ce-plan-bootstrap | legacy-requirements
execution: code # optional; same semantics as today
---

# Example capability - Plan

## Goal Capsule
## Product Contract
## Planning Contract       # implementation-ready only
## Implementation Units    # implementation-ready only
## Verification Contract   # implementation-ready only
## Definition of Done      # implementation-ready, optional draft in requirements-only
## Sources & Research
## Appendix
```

There is no `Goal Launch Block` section, and no `Reader Index`: the launch prompt is skill-emitted at handoff (copyable `/goal` on Claude Code, `create_goal` on Codex) from `ce-work`'s `references/execution-engines.md`, and consumers wayfind by scanning the stable section headings (markdown) or `<h1>`–`<h3>`/anchor ids (HTML) rather than from an in-doc index. A requirements-only artifact is slim: `Goal Capsule` + `Product Contract` only; `ce-plan` adds the implementation sections when it enriches in place.

`artifact_readiness: requirements-only` means the artifact is not yet executable by `ce-work`. `artifact_readiness: implementation-ready` means `ce-plan` has supplied implementation units, verification, and DoD material. These are document-readiness values, not work-progress values; tests should reject progress words such as `active`, `in_progress`, `completed`, or `done`.

This contract is for software implementation plans. Universal-planning outputs and approach-plans should keep their domain-appropriate formats unless the deliverable itself is a software implementation plan. In those modes, `ce-plan` can still produce strong plans, but it must not label them `artifact_contract: ce-unified-plan/v1` unless they include the Product Contract, Planning Contract, Implementation Units, and Definition of Done required for code execution.

HTML must render the same metadata visibly in the document header and provide persistent navigation to each major section. For long unified HTML artifacts, the left or top navigation should distinguish "Read first", "Product", "Planning", "Units", "Done", and "Appendix" rather than presenting a flat heading list.

---

## Section Semantics

### Section ID Registry

The unified artifact contract needs a stable section registry so consumers know what to grep before reading the whole document. This registry belongs in the skill instructions and rendering references, not only inside generated documents.

| Logical section | Markdown heading | HTML id | Grep / selector hint |
|---|---|---|---|
| Goal Capsule | `## Goal Capsule` | `goal-capsule` | `^## Goal Capsule$` / `#goal-capsule` |
| Product Contract | `## Product Contract` | `product-contract` | `^## Product Contract$` / `#product-contract` |
| Product Requirements | `### Requirements` under Product Contract | `product-requirements` | nearest `### Requirements` after Product Contract / `#product-requirements` |
| Planning Contract | `## Planning Contract` | `planning-contract` | `^## Planning Contract$` / `#planning-contract` |
| Implementation Units | `## Implementation Units` | `implementation-units` | `^## Implementation Units$` / `#implementation-units` |
| Unit | `### U<N>. <name>` | `u<N>` | `^### U[0-9]+\\.` / `[id^="u"]` |
| Verification Contract | `## Verification Contract` | `verification-contract` | `^## Verification Contract$` / `#verification-contract` |
| Definition of Done | `## Definition of Done` | `definition-of-done` | `^## Definition of Done$` / `#definition-of-done` |
| Appendix | `## Appendix` | `appendix` | `^## Appendix$` / `#appendix` |

HTML rendering must make these ids visible as normal anchors on section elements. Do not rely on hidden JSON, duplicate metadata, or data attributes as the primary reader contract.

### Reader Strategy

The document does not teach efficient reading by itself. Consuming skills must carry the read algorithm before they open the file. The stable section **headings** (markdown) and anchor ids (HTML) are the extraction target; the consumer scans them to wayfind rather than reading the whole file.

Every consuming skill that accepts a unified plan should use this order:

1. **Pre-read only metadata and heading map.**
   - Markdown: read the YAML frontmatter plus the first screen, then run a heading scan equivalent to `rg -n '^(#|##|### U[0-9]+\\.)' <plan>`.
   - HTML: read the visible metadata/header region, then scan for the section ids in the Section ID Registry.
2. **Classify artifact readiness.**
   - If `artifact_readiness: requirements-only`, execution skills stop and route to `ce-plan`.
   - If `artifact_readiness: implementation-ready`, execution skills continue.
   - If metadata is absent, fall back to legacy plan behavior.
3. **Extract role-specific sections by heading range.**
   - Do not read the entire unified document first unless the file is small or the role genuinely requires full-document review.
   - Read appendices only when a selected section explicitly cites them or the user asks for source detail.
4. **Escalate only on ambiguity.**
   - If heading extraction fails, metadata conflicts with content, or a required section is missing, then read wider context and report the contract problem.

Role-specific defaults:

| Consumer | First sections to read | Skip by default | Escalate when |
|---|---|---|---|
| `ce-plan` enriching a skeleton | Metadata, Goal Capsule, full Product Contract, Open Questions, cited Sources | Appendix details and unrelated legacy docs | Product Contract conflicts with repo research or planning needs missing product decisions |
| `ce-work` executing | Metadata, Goal Capsule, Definition of Done, Verification Contract, Implementation Units heading list, first candidate U-ID | Appendix, full Product Contract, unrelated U-IDs | Plan is requirements-only, active unit references an R/F/AE/KTD not yet read, verification cannot be assessed, or no supported execution engine is available |
| `lfg` pipeline | Metadata, artifact readiness, execution mode, plan path, Definition of Done availability | Interactive menus, HTML artifacts, universal/approach outputs unless explicitly pipeline-safe | `ce-plan` did not produce an implementation-ready code plan, no plan path is discoverable, or `ce-work` cannot be invoked |
| `ce-doc-review` | Metadata, Goal Capsule, then reviewer-specific section slices | Sending the full document to every persona | A consistency reviewer needs cross-section trace or a section slice is insufficient |
| `ce-code-review` | Metadata, Product Contract > Requirements, Verification Contract, Definition of Done, implemented U-IDs from PR body or branch context | Full plan body and appendices | Requirements are nested unexpectedly or PR claims work outside cited U-IDs |
| `ce-proof` | Metadata and title only for publishing label, then full file as publish payload | None for upload payload | Publishing label or format cannot be determined |

Wayfinding is size-aware: a short plan (lightweight or requirements-only) can be read in full, but for a long implementation-ready plan the skills must locate sections with heading/anchor scans and read only the needed ranges before doing expensive full reads.

For `ce-work`, the same rule must apply to subagent dispatch. The parent should pass the plan path plus a compact packet containing Goal Capsule, Definition of Done, the selected U-ID section, and any referenced R/F/AE/KTD excerpts. It should not send "read the whole plan file" as the default worker prompt for unified artifacts.

Blank `ce-work` discovery must be conservative. The newest matching `docs/plans/*` file should be classified before execution. If the newest artifact is `artifact_readiness: requirements-only`, `execution: knowledge-work`, an approach-plan, or an unclassified universal plan, blank `ce-work` should stop and explain the required explicit path or next planning step. It should not silently fall back to an older implementation-ready plan unless the user supplied an unambiguous path, branch context, or keyword that identifies that older plan.

`ce-work` may choose an implementation engine after it has classified an implementation-ready code plan:

- **Inline/subagent engine:** current default. `ce-work` owns task creation, unit sequencing, subagent dispatch, verification, review escalation, commits, and handoff.
- **Goal-mode engine:** available only when the host exposes a callable goal tool (Codex `create_goal`). `create_goal` sets the active objective for the **current session** — it is not a background worker and returns no awaitable summary — so the session itself continues toward the DoD, and the goal lifecycle marks completion (`ce-work` does not call `update_goal`). Because it steers the current session, goal-mode is for standalone use only, never return-to-caller (which must return control). On hosts with no goal tool (Claude Code), `ce-work` emits a copyable `/goal` prompt for the user or runs inline/subagents instead of trying to call anything internally. The goal must not open the PR, finalize the session, or bypass the owning workflow's gates.
- **Dynamic-workflow engine:** available only when the host platform exposes a callable dynamic workflow / ultracode-style orchestration primitive. Prefer this over goal-mode for large fan-out plans, many independent U-IDs, cross-checking loops, or migrations where intermediate worker state should live outside the main conversation. Claude Code dynamic workflows are triggered by user prompt opt-in such as `ultracode:` or by `/effort ultracode`; skills should output a prompt block for the user rather than trying to start the workflow internally. Dynamic workflows must return structured results and blockers; they must not require mid-run user decisions.

Because `create_goal` steers the current session rather than dispatching a separate worker, goal-mode is used only in standalone `ce-work`: the session works toward the DoD and then continues through `ce-work`'s normal post-implementation quality gates and handoff. Return-to-caller mode (LFG) never uses `create_goal` — it must return a structured envelope to LFG, so it runs inline/subagents and returns control before simplify/review/PR/CI. Goal-mode is a way to get better sustained implementation focus, not a way to skip the owning workflow's finish discipline.

Return-to-caller invocation should be explicit, for example `ce-work mode:return-to-caller <plan-path>` or `ce-work caller:lfg <plan-path>`. `ce-work` should parse the mode before normal input triage, execute implementation units and relevant local verification, then return a structured summary containing: status, plan path, changed files beyond the plan, U-IDs attempted/completed, verification commands/results, blockers, whether behavior changed, and confirmation that the standalone shipping tail was skipped.

Tail ownership profiles:

| Profile | Owner | Includes simplify/review/PR/CI? | Use when |
|---|---|---|---|
| Implementation-only engine | `ce-work` under LFG or another caller | No; return to caller before tail | LFG will run `ce-simplify-code`, `ce-code-review`, PR, and CI itself. |
| Standalone `ce-work` | `ce-work` | Yes for `ce-work`'s normal quality/handoff gates | User invoked `ce-work` directly or `ce-plan` handed off interactively. |
| Top-level `/goal` | Goal runner | Yes when the prompt says the goal owns quality gates | User manually launches a goal from the plan and no wrapper will run those gates afterward. |
| E2E dynamic workflow | Workflow script | Yes, if encoded in the script and returned as structured evidence | Host supports ultracode/dynamic workflows and the workflow is intended to replace, not sit inside, LFG. |

If a top-level goal or dynamic workflow owns simplification/review/PR/CI, LFG should not run those same steps afterward. Conversely, if LFG is the caller, the goal or workflow launched beneath `ce-work` should be implementation-only so LFG can run its deterministic outer pipeline.

Claude Code launch decision for generated docs:

| Plan shape | Recommended Claude Code launch | Why |
|---|---|---|
| Normal implementation-ready plan with sequential or modest U-ID decomposition | `/goal` | The plan already defines the end condition; `/goal` keeps turns going until the DoD is visibly satisfied. |
| Large fan-out plan with many independent U-IDs or broad codebase sweep | `ultracode:` dynamic workflow | Workflow scripts hold branching, loops, and intermediate results outside the main context and can coordinate many agents. |
| Hard planning/research artifact needing several independent angles before committing | `ultracode:` dynamic workflow | Workflows can cross-check findings and synthesize competing drafts before reporting. |
| LFG/autopilot pipeline | LFG -> `ce-work mode:return-to-caller` | LFG owns the outer shipping tail; `ce-work` owns implementation strategy. |
| Host without callable/top-level goal or workflow support | `ce-work` fallback prompt | Preserve the same heading-scan / DoD / U-ID discipline without relying on unavailable host features. |

The generated document should name one recommended Claude Code launch path, not present `/goal` and `ultracode:` as equally likely choices. It may include the non-recommended alternative under "Advanced / large-scale option" only when the plan shape plausibly warrants it.

For `lfg`, the unified artifact is not a launch menu. It is a machine gate between `ce-plan` and `ce-work`. LFG should invoke `ce-plan`, record the produced plan path, inspect metadata/readiness, and proceed only when the artifact is an implementation-ready code plan. It should then invoke `ce-work` with the exact plan path in return-to-caller mode. It should not look for a launch prompt in the doc, should not rely on `ce-plan`'s interactive post-generation offer, should not launch `/goal` directly, and should not auto-run implementation on a requirements-only skeleton, universal plan, answer, or approach-plan unless that path explicitly created an implementation-ready software plan first.

After `ce-work` returns, LFG must verify implementation changed files beyond the plan and continue its own downstream pipeline: run `ce-simplify-code` when applicable, run `ce-code-review mode:agent plan:<path>`, apply eligible review fixes, run browser tests, commit/push/open PR, and watch CI. The goal-mode decision is centralized inside `ce-work`; LFG remains the outer autonomous shipping pipeline.

### Launch prompts (emitted at handoff)

The launch prompt is **not a section in the artifact**. It is generated by the skill at handoff — printed as a copyable block on Claude Code, or passed to `create_goal` on Codex — from a single living template (`ce-work`'s `references/execution-engines.md`). It is readiness-specific: a planning prompt for requirements-only, an implementation prompt for implementation-ready.

Each emitted prompt stays thin. It names the action, path, read order, tail profile, and stop condition, then points into the document's sections rather than duplicating requirements, implementation details, full verification matrices, or product rationale — the plan body is the authority.

For `artifact_readiness: requirements-only`, the emitted prompt routes to planning, not execution:

```text
/goal Enrich docs/plans/example-plan.md into an implementation-ready plan.

Use the Product Contract as authority. Produce Planning Contract, Implementation Units, Verification Contract, and Definition of Done. Do not implement code. If open product questions would change behavior, stop and report the exact questions instead of inventing scope.
```

For `artifact_readiness: implementation-ready` with `execution: code`, the emitted prompt routes to implementation and declares which tail profile owns quality gates. Generated handoffs prefer a standalone top-level prompt for humans and an implementation-only prompt for skill callers that need an internal engine.

```text
/goal Implement docs/plans/example-plan.md through its Definition of Done.

First read: Goal Capsule, Definition of Done, and the Implementation Units heading map (scan headings to find sections; do not read the whole plan). Work unit-by-unit. For each U-ID, read only that unit plus referenced R/F/AE/KTD sections. Track progress outside the doc.

This top-level goal owns implementation quality gates. Run simplification and code review when the plan or diff meets the repo's normal criteria, apply eligible fixes, and surface any residual findings. Do not open a PR unless the prompt explicitly requests a shipping goal.

The condition is satisfied when the transcript shows: all non-deferrable U-IDs are completed; each Per-Unit DoD row has an observed verification result; required repo checks passed or are documented as not applicable; applicable simplification/review gates ran or were explicitly skipped with reason; no plan body progress/status was written; and no PR was opened by this goal. Stop early only when a named blocker prevents completion.
```

When a skill caller needs an internal implementation engine, use a shorter implementation-only variant:

```text
/goal Implement docs/plans/example-plan.md as an implementation-only engine for the owning workflow.

Read Goal Capsule, Definition of Done, and active U-IDs (scan headings to find them). Complete implementation and local verification only. Do not run simplification, code review, PR creation, CI watching, or final handoff; return a summary with changed files, U-IDs completed, verification results, and blockers so the owning workflow can run its tail.
```

Fallback when callable goal-mode is unavailable:

```text
Use ce-work on docs/plans/example-plan.md.

First classify artifact_readiness and execution mode. If implementation-ready code, scan headings and read Goal Capsule, Definition of Done, and the Implementation Units heading map (not the whole doc) before choosing inline, subagent, or dynamic-workflow execution. Preserve U-ID references, read only active-unit sections plus cited R/F/AE/KTD excerpts, and finish through the owning workflow's tail profile.
```

Keep each prompt under 4,000 characters. Put the literal path in the prompt. Include an action verb, the artifact readiness assumption, the tail ownership profile, the read order, the unit strategy, and an evaluator-visible stop condition. Goal prompts should require the agent to surface verification results in the transcript before declaring completion. When goal-mode is unavailable, the fallback prompt should preserve the same read order and tail ownership semantics through `ce-work`.

Claude Code-specific launch guidance:

- For `/goal`, `ce-plan` or `ce-work` should print the copyable command block for the user to paste at the start of a message. Do not try to invoke `/goal` internally from a skill.
- For dynamic workflows, print a copyable prompt beginning with `ultracode:` or equivalent natural-language workflow request. Use this only when the plan shape warrants workflow orchestration rather than ordinary goal persistence.
- For normal skill-driven execution, continue with `ce-work` inline/subagents when the user does not paste the goal/workflow prompt.

Example dynamic-workflow launch for a large fan-out plan:

```text
ultracode: Execute docs/plans/example-plan.md as an end-to-end dynamic workflow.

Use the plan as authority. First build a workflow around the Implementation Units and Definition of Done. Parallelize only independent U-IDs with disjoint file ownership, keep intermediate agent results inside the workflow, run simplification/review/verification gates inside the workflow tail, and return a final summary with changed files, U-IDs completed, verification results, residual findings, and blockers.
```

For universal-planning mode, answer-seeking mode, and approach-altitude "plan for a plan" outputs, do not emit this implementation launch prompt unless the output is explicitly a software implementation plan. Those modes may still offer a `/goal` launch when the output is saved, goal-shaped, and has its own done criteria. The prompt must name the real deliverable, such as "produce the implementation plan from this approach-plan" or "execute this research plan and deliver the synthesis," not "implement code."

After writing a plan, `ce-plan` should use this launch matrix:

| Output classification | `ce-plan` post-output offer |
|---|---|
| Unified artifact, `artifact_readiness: requirements-only` | Offer to continue with `ce-plan` enrichment using the plan path. Do not offer execution. |
| Unified artifact, `artifact_readiness: implementation-ready`, `execution: code` | Offer to start the launch prompt (copyable `/goal` on Claude Code, `create_goal` on Codex), or to hand off to `ce-work`. |
| Universal plan, `execution: knowledge-work` | Offer a knowledge-work goal only when the saved plan has a concrete deliverable and DoD; otherwise offer the domain-appropriate next step from universal-planning. |
| Answer-seeking universal-planning output | Deliver the answer; no saved-plan launch offer. |
| Approach-altitude / plan-for-a-plan output | Offer the checkpoint choices from `references/approach-altitude.md`: execute now, save/deepen, start a planning/knowledge-work goal, or stop. Only route into code implementation if the accepted deliverable is an implementation-ready software plan. |
| LFG / pipeline caller | No interactive offer. Return the plan path, readiness, and execution mode to the caller; the caller enforces the pipeline gate and invokes `ce-work` in return-to-caller mode. |

Approach-plans are especially good goal inputs when the expensive work is cognitive rather than code execution: reading sources, reconciling constraints, producing a PRD, producing the real implementation plan, or generating a decision memo. Their launch prompt should make the next artifact explicit and bounded:

```text
/goal Execute docs/plans/example-approach-plan.md to produce the implementation plan it describes.

Use the approach-plan as process authority. Produce the named deliverable only. Do not implement code. Stop when the deliverable's acceptance criteria are satisfied or when a blocker invalidates the approach.
```

### Goal Capsule

Ten to twenty lines. It must summarize:

- the outcome being pursued
- the non-negotiable scope boundaries
- the current readiness
- the next expected workflow
- the shortest route to verify done

### Product Contract

Former brainstorm content:

- Summary
- Problem Frame
- Actors
- Key Flows
- Requirements
- Acceptance Examples
- Scope Boundaries
- Dependencies / Assumptions
- Open Questions

### Planning Contract

Former plan content, included only when `artifact_readiness: implementation-ready`:

- Key Technical Decisions
- High-Level Technical Design
- System-Wide Impact
- Risks & Dependencies
- Documentation / Operational Notes
- Sources & Research

### Implementation Units

Preserve the existing `### U1. Name` unit heading contract. Required unit fields remain:

- Goal
- Requirements
- Dependencies
- Files
- Approach
- Execution note, when material
- Patterns to follow
- Test scenarios
- Verification

### Verification Contract

Required once the artifact is implementation-ready. This section makes the plan portable across agents and time by recording the repo-specific verification surface discovered during planning.

Required fields:

| Field | Purpose |
|---|---|
| Required commands | Exact commands to run before done, such as `bun test`, `npm test`, `pytest`, `rails test`, `go test ./...`, `bun run release:validate`, lint, typecheck, or build commands. |
| Conditional commands | Commands that run only for certain surfaces, such as browser tests, Xcode tests, migrations, generated fixtures, or release validation when plugin inventory changes. |
| Quality gates | Simplification, code review, doc review, security review, or design review triggers with concrete thresholds or conditions. |
| Manual verification | Human-visible checks, screenshots, browser flows, CLI examples, generated artifact inspection, or operational validation. |
| Test coverage expectations | Happy path, edge case, error path, integration, and regression categories that apply to this plan. |
| Metric thresholds | When the goal is optimization-shaped (build time, latency, coverage, bundle size), a measurable exit threshold (e.g., "p95 latency < 200ms", "build time reduced 30%") rather than a boolean check. Route metric-driven loops to `ce-optimize`. |
| Known skips | Checks intentionally skipped and the reason the skip is acceptable. |

The emitted launch prompt and Definition of Done should reference this section rather than relying on generic phrases like "run tests." Per-unit `Verification` fields still name local unit checks; the Verification Contract names global and conditional repo checks. A metric target is a sharper done signal for a long-running goal than a boolean check, because the goal runner re-evaluates it after each turn (Claude Code) or drives toward it autonomously over hours (Codex) — see the `/goal` guide in Sources & Research.

### Definition of Done

Required once the artifact is implementation-ready. Requirements-only skeletons may include a product-level draft DoD when it helps goal shaping, but should omit plan-only sections that would be empty padding.

```markdown
## Definition of Done

### Global DoD
- **Scope complete:** All non-deferred R-IDs are satisfied or explicitly reclassified.
- **Implementation complete:** All required U-IDs are complete or intentionally deferred.
- **Verification complete:** Each unit's Verification field has an observed result.
- **Tests complete:** Feature-bearing changes have tests for applicable happy path, edge case, failure, and integration scenarios.
- **Regression check:** Relevant repo checks pass, or remaining failures are documented as unrelated.
- **Docs / ops complete:** Required docs, config, migration, rollout, or operational notes are updated.
- **Review readiness:** No unresolved P0/P1 doc-review or code-review findings remain.
- **Cleanup complete:** Dead-end and experimental code from approaches that did not pan out is removed from the diff, not left behind (matters most for long autonomous goal runs that accumulate abandoned attempts).
- **Handoff complete:** Final summary names changed files, checks run, deferred work, and residual risks.

### Per-Unit DoD
| Unit | Done Signal | Required Verification | Blocking Dependencies | Deferrable? |
|---|---|---|---|---|
| U1 | Concrete observable outcome | Test/manual check result | Named dependency | no |
```

### Legacy launch-prompt sections

New unified artifacts contain **no** launch-prompt section — the launch prompt is skill-emitted (see "Launch prompts (emitted at handoff)"). Older docs may carry a `## Goal-Mode Prompt` or `## Goal Launch Block` section; readers treat any such section as stale and rely on the skill-emitted prompt instead, never executing a frozen in-doc prompt.

---

## Implementation Units

### U1. Define the unified artifact contract

- **Goal:** Replace the separate brainstorm/plan artifact model with a single documented contract that both skills consume.
- **Requirements:** R1, R2, R3, R5, R6, R7, R8, R9.
- **Files:**
  - Modify: `skills/ce-plan/references/plan-sections.md`
  - Modify or replace: `skills/ce-brainstorm/references/brainstorm-sections.md`
  - Modify: `skills/ce-plan/references/markdown-rendering.md`
  - Modify: `skills/ce-plan/references/html-rendering.md`
  - Mirror rendering changes into `ce-brainstorm` and `ce-ideate` reference copies if parity tests still require them.
- **Approach:** Introduce `artifact_contract: ce-unified-plan/v1`, `artifact_readiness`, `product_contract_source`, `Goal Capsule`, `Product Contract`, `Planning Contract`, `Verification Contract`, and `Definition of Done` as the new contract (the launch prompt is skill-emitted and consumers wayfind by heading scan, so neither is a section). Keep no-status language, and define readiness as document completeness rather than work progress.
- **Test scenarios:**
  - Contract tests detect required metadata fields and reject `status:`.
  - Contract tests reject progress-like readiness values such as `active`, `in_progress`, `completed`, and `done`.
  - Contract tests require the Section ID Registry in the skill/reference instructions.
  - Rendering tests require visible metadata and navigation for HTML.
  - HTML rendering tests require stable ids such as `goal-capsule`, `product-contract`, `implementation-units`, and `definition-of-done`.
  - Markdown tests require pure markdown, top-loaded reader sections, and no hidden machine copy.
- **Verification:** Tests identify the unified contract and no longer require a standalone requirements filename for new brainstorm outputs.

### U2. Update `ce-brainstorm` to create plan skeletons

- **Goal:** Make `ce-brainstorm` write the first version of the unified plan in `docs/plans/`.
- **Requirements:** R1, R2, R5, R9.
- **Files:**
  - Modify: `skills/ce-brainstorm/SKILL.md`
  - Modify: `skills/ce-brainstorm/references/handoff.md`
  - Modify: `skills/ce-brainstorm/references/synthesis-summary.md`
  - Modify tests under `tests/skills/ce-brainstorm-*`
- **Approach:** Phase 3 writes `docs/plans/YYYY-MM-DD-NNN-<type>-<topic>-plan.<md|html>` with `artifact_readiness: requirements-only` and `product_contract_source: ce-brainstorm`. It fills `Goal Capsule` and `Product Contract`, omits empty plan-only sections, and routes next steps to `ce-plan` with the same path.
- **Test scenarios:**
  - `output:md` writes a markdown unified plan skeleton under `docs/plans/`.
  - `output:html` writes an HTML unified plan skeleton with visible readiness metadata.
  - Handoff to `ce-plan` passes the plan path, not a requirements path.
  - Requirements-only skeletons do not claim to be executable.
  - Requirements-only artifacts do not point implementers at missing `Definition of Done` or `Implementation Units` sections.
  - Requirements-only artifacts emit no launch-prompt section; the next step (ce-plan enrichment) is conveyed by the handoff menu, not the doc.
  - `Build it now` / direct-to-`ce-work` handoff is hidden unless a requirements-only artifact is explicitly deemed small enough to skip planning and the needed DoD is present in chat or the artifact.
- **Verification:** New tests fail if `ce-brainstorm` points new outputs at `docs/brainstorms/*-requirements.*`.

### U3. Update `ce-plan` to enrich unified plans in place

- **Goal:** Make `ce-plan` detect requirements-only unified plans, preserve product contract content, and enrich the same file.
- **Requirements:** R2, R3, R4, R6, R7, R8, R11.
- **Files:**
  - Modify: `skills/ce-plan/SKILL.md`
  - Modify: `skills/ce-plan/references/synthesis-summary.md`
  - Modify: `skills/ce-plan/references/deepening-workflow.md`
  - Modify: `skills/ce-plan/references/plan-handoff.md`
  - Modify tests under `tests/skills/ce-plan-*`
- **Approach:** Phase 0 searches for explicit paths first, then recent unified plans with `artifact_readiness: requirements-only`, then legacy `docs/brainstorms/*-requirements.*`. When enriching, `ce-plan` updates `artifact_readiness: implementation-ready`, fills `Planning Contract`, `Implementation Units`, `Verification Contract`, and `Definition of Done`, and preserves R/A/F/AE IDs.
- **Test scenarios:**
  - Direct `ce-plan` creates a complete unified plan without an origin doc.
  - `ce-plan <unified-plan-path>` updates that file rather than creating a duplicate.
  - Legacy `origin: docs/brainstorms/...` still resolves.
  - Brainstorm-sourced unified plans use `product_contract_source: ce-brainstorm` and do not trigger greenfield/adversarial bootstrap review behavior.
  - Product Contract conflicts discovered during planning become explicit questions or assumptions, not silent rewrites.
  - `ce-plan` post-output menu offers to launch the goal prompt only for implementation-ready code plans; universal-planning, answer-seeking, and approach-altitude outputs keep their own handoff/checkpoint behavior.
- **Verification:** A plan sourced from a unified skeleton has origin-equivalent metadata without requiring a separate `origin:` path.

### U4. Make downstream readers readiness-aware

- **Goal:** Prevent downstream skills from treating requirements-only unified plans as implementation-ready.
- **Requirements:** R4, R8, R10.
- **Files:**
  - Modify: `skills/ce-work/SKILL.md`
  - Modify or explicitly guard: `skills/ce-work-beta/SKILL.md`
  - Modify: `skills/lfg/SKILL.md`
  - Modify: `skills/ce-doc-review/SKILL.md`
  - Modify: `skills/ce-doc-review/references/subagent-template.md`
  - Modify: `skills/ce-doc-review/references/synthesis-and-presentation.md`
  - Modify: `skills/ce-proof/SKILL.md`
  - Modify: `skills/ce-code-review/SKILL.md`
  - Modify or document exception: `skills/ce-riffrec-feedback-analysis/SKILL.md`
  - Modify or document exception: `skills/ce-riffrec-feedback-analysis/references/extensive-analysis.md`
  - Modify or document exception: `skills/ce-riffrec-feedback-analysis/scripts/analyze_riffrec_zip.py`
  - Modify related docs and tests.
- **Approach:** `ce-work` should route `artifact_readiness: requirements-only` files to `ce-plan` when explicitly receiving a plan, and blank `ce-work` should stop rather than silently falling back when the newest plan artifact is requirements-only, knowledge-work, approach-plan, or otherwise not implementation-ready code. For implementation-ready unified plans, `ce-work` must replace its current full-document-first read with the metadata, heading-map, Goal Capsule, DoD, and active-unit extraction strategy. `ce-work` may also choose a supported goal-mode or dynamic-workflow engine for implementation, but must resume the correct tail after implementation: standalone quality gates in normal use, or return-to-caller return when invoked by LFG. `lfg` should verify that `ce-plan` produced an implementation-ready code plan before invoking `ce-work`, pass the exact plan path to `ce-work mode:return-to-caller <plan-path>` (or equivalent explicit syntax), and stop with a clear message for requirements-only, universal, answer-seeking, or approach-plan outputs that are not code-executable. `ce-doc-review` should classify unified artifacts by readiness and `product_contract_source`, reviewing Product Contract and Planning Contract with different lenses. HTML unified artifacts should remain report-only or skipped until `ce-doc-review` has a real HTML-safe mutation path; do not claim safe HTML mutation without implementing it. `ce-proof` should publish markdown unified plans only and label them by readiness; HTML unified artifacts stay on the local browser/open path.
- **Test scenarios:**
  - Blank `ce-work` stops when the newest plan artifact is requirements-only, knowledge-work, approach-plan, or unclassified universal output, unless the user supplied an explicit path or unambiguous branch/keyword match.
  - Explicit `ce-work <requirements-only-plan>` tells the user the plan needs `ce-plan` enrichment.
  - Explicit `ce-work <knowledge-work-plan>` still routes to the existing non-code execution carve-out.
  - `ce-work` no longer instructs agents to read large unified documents completely before metadata, heading-map, Goal Capsule, DoD, and active-unit extraction.
  - `ce-work` subagent prompts pass a bounded unit packet rather than only a full plan path when executing unified artifacts.
  - `ce-work` can use a supported goal-mode engine for implementation, then resumes standalone review/simplification/testing/commit/handoff gates when not caller-owned.
  - `ce-work` can use a supported dynamic-workflow engine for large fan-out plans and returns structured results/blockers.
  - Goal-mode `ce-work` prompts are scoped to implementation only and explicitly do not open PRs, finalize handoff, or bypass the owning workflow's gates.
  - Emitted launch prompts distinguish standalone top-level goals from implementation-only engine prompts, and only the standalone profile owns simplify/review gates by default.
  - `lfg` stops after `ce-plan` when the produced artifact is not `artifact_readiness: implementation-ready` plus `execution: code`.
  - `lfg` passes the recorded unified plan path to `ce-work` in return-to-caller mode, then to `ce-code-review mode:agent plan:<path>` and later pipeline steps.
  - `ce-work mode:return-to-caller` returns status, plan path, changed files, U-IDs attempted/completed, verification results, blockers, behavior-change signal, and confirmation that standalone shipping was skipped.
  - LFG never launches `/goal` directly; when goal-mode is appropriate, `ce-work` launches it and returns control to LFG after implementation verification.
  - LFG's post-`ce-work` pipeline still runs `ce-simplify-code`, `ce-code-review mode:agent plan:<path>`, review-fix application, tests, PR, and CI watch.
  - `ce-doc-review` can review requirements-only and implementation-ready markdown unified artifacts by section slice.
  - HTML unified artifacts are either skipped with the current markdown-only message or reviewed in report-only mode with no mutation path.
  - `ce-doc-review` routes persona agents by section slice instead of blindly sending the full unified document to every reviewer.
  - `ce-doc-review` has a unified-artifact classification path distinct from legacy standalone requirements docs and legacy implementation plans.
  - `ce-code-review` protects and discovers `docs/plans/*.{md,html}` and extracts requirements from `Product Contract > Requirements`, legacy top-level `## Requirements`, and legacy `## Requirements Trace`.
  - `ce-code-review` classifies readiness before requirements completeness; requirements-only unified plans can inform product intent but must not trigger implementation-unit completeness findings.
  - `ce-proof` publishes markdown unified artifacts with readiness-aware labels and does not try to upload HTML artifacts.
  - `ce-work-beta` either matches stable `ce-work` unified-plan guards or explicitly rejects `artifact_contract: ce-unified-plan/v1` with a route to stable `ce-work`.
  - `ce-riffrec-feedback-analysis` either keeps `docs/brainstorms/riffrec-feedback/` as a documented analysis-artifact exception or migrates its defaults/help text to the new convention.
- **Verification:** Downstream consumers no longer key only on path prefixes like `docs/brainstorms/`.

### U5. Strengthen output-mode and HTML navigation behavior

- **Goal:** Keep markdown and HTML parity while making long unified HTML documents navigable.
- **Requirements:** R9, R10.
- **Files:**
  - Modify: shared `markdown-rendering.md` copies.
  - Modify: shared `html-rendering.md` copies.
  - Modify: `tests/skills/html-output-invariants.test.ts`
  - Modify: `tests/compound-support-files.test.ts` if the parity strategy changes.
- **Approach:** Preserve exclusive output mode. Re-evaluate separate `brainstorm_output` and `plan_output` config keys because both skills now write the same artifact class. Prefer a backward-compatible config migration: keep both keys initially, but document exact enrichment precedence: explicit path format wins for in-place enrichment; explicit `output:` may convert only with a visible old-path/new-path note; pipeline mode may force markdown only by writing the canonical markdown path and leaving the HTML artifact untouched with a clear note. When a conversion or pipeline override creates same-basename `.md` and `.html` siblings, the new artifact path is canonical for later automated discovery, and the old sibling must be marked or reported as non-canonical so `ce-plan`/`ce-work` do not treat both as competing latest plans.
- **Test scenarios:**
  - HTML unified plans include visible readiness metadata and a navigation region.
  - Long HTML documents expose anchors for `Goal Capsule`, `Product Contract`, `Planning Contract`, `Implementation Units`, and `Definition of Done`.
  - Markdown documents include the same sections without embedded HTML.
  - `brainstorm_output: html` followed by `ce-plan` preserves HTML unless an explicit conversion or pipeline override applies.
  - Explicit `ce-plan output:md <html-unified-plan>` documents the conversion path instead of silently forking canonical artifacts.
  - Pipeline mode behavior is tested for a requirements-only HTML skeleton.
  - Same-basename `.md` and `.html` siblings have one canonical discovery target after conversion or pipeline override.
- **Verification:** Existing HTML mode tests pass after being updated from requirements/plan sibling assumptions to unified plan assumptions.

### U6. Update documentation and examples

- **Goal:** Teach users that `ce-brainstorm -> ce-plan -> ce-work` is now one artifact moving through readiness states.
- **Requirements:** R1, R2, R3, R4, R10.
- **Files:**
  - Modify: `skills/ce-ideate/SKILL.md`
  - Modify: `skills/ce-ideate/references/post-ideation-workflow.md`
  - Modify: `docs/skills/ce-brainstorm.md`
  - Modify: `docs/skills/ce-ideate.md`
  - Modify: `docs/skills/ce-plan.md`
  - Modify: `docs/skills/ce-work.md`
  - Modify: `docs/skills/ce-doc-review.md`
  - Modify: `docs/skills/ce-proof.md`
  - Modify: `docs/skills/README.md`
  - Modify: `README.md`
  - Modify: `plugins/compound-engineering/README.md`
  - Modify: `AGENTS.md`
- **Approach:** Replace "requirements doc plus plan doc" language with readiness-based unified-plan language. Update the canonical repo convention so new brainstorm-produced unified artifacts live in `docs/plans/`, while `docs/brainstorms/` is documented as legacy/historical input that remains readable. Update `ce-ideate` handoff language so "Brainstorm one idea" points to a requirements-only unified plan, not a standalone requirements artifact.
- **Test scenarios:**
  - Documentation convention tests no longer assert new brainstorm output under `docs/brainstorms/`.
  - README examples show `docs/plans/...-plan.md` after both brainstorm and plan.
- **Verification:** `bun run release:validate` passes if plugin descriptions or counts change.

### U7. Add compatibility and migration tests

- **Goal:** Guard the refactor against the highest-risk regressions.
- **Requirements:** R4, R10, R11.
- **Files:**
  - Modify: `tests/skills/ce-brainstorm-output-mode.test.ts`
  - Modify: `tests/skills/ce-brainstorm-section-order.test.ts`
  - Modify: `tests/skills/ce-plan-output-mode.test.ts`
  - Modify: `tests/skills/ce-plan-handoff-routing.test.ts`
  - Modify: `tests/pipeline-review-contract.test.ts`
  - Modify: `tests/review-skill-contract.test.ts`
  - Modify: `tests/skills/ce-ideate-output-mode.test.ts`
  - Modify: `tests/compound-support-files.test.ts`
  - Add: `tests/skills/unified-plan-artifact-contract.test.ts`
  - Add or extend fixtures for markdown/HTML section extraction and same-basename canonical path selection.
  - Add fixtures for requirements-only, implementation-ready, and legacy requirements artifacts.
- **Approach:** Write tests against skill prose and reference contracts because these behaviors are largely prompt-contract changes. Include fixture-driven tests where parsers or helper scripts exist.
- **Test scenarios:**
  - New brainstorm output path is `docs/plans/`.
  - Legacy requirements docs still appear in ce-plan discovery guidance.
  - Unified artifacts include `Goal Capsule` and `Product Contract`, and, when implementation-ready, `Planning Contract`, `Verification Contract`, and `Definition of Done`. No `Goal Launch Block` or `Reader Index` section exists.
  - The skill-emitted launch prompt stays thin and points to authoritative sections instead of duplicating requirements, verification, or implementation details.
  - Unified artifact consumers define a pre-read algorithm before any full-document read.
  - Heading scans can find major markdown sections and U-ID ranges.
  - HTML extraction guidance can find visible metadata and section anchors without parsing hidden machine data.
  - Section ID registry tests cover markdown headings and HTML ids for every required logical section.
  - `ce-work` guidance rejects requirements-only execution.
  - Blank `ce-work` does not auto-execute latest knowledge-work, approach-plan, or unclassified universal artifacts from `docs/plans/`.
  - `ce-work-beta` matches stable `ce-work` unified-artifact guards or explicitly rejects unified artifacts with a route to stable `ce-work`.
  - `lfg` invokes `ce-work` with an explicit return-to-caller mode and the recorded plan path.
  - `ce-doc-review` guidance distinguishes Product Contract from Planning Contract.
  - `ce-code-review` handles markdown and HTML unified plans and nested Product Contract requirements.
  - `ce-code-review` tests cover readiness classification before requirements completeness.
  - Implementation-ready fixtures include repo-specific verification commands and quality gate applicability, not generic "run tests" prose.
  - `ce-ideate` handoff tests no longer assert a standalone requirements artifact from `ce-brainstorm`.
  - Canonical selection tests cover same-basename `.md`/`.html` artifacts after conversion or pipeline override.
- **Verification:** `bun test` passes.

---

## System-Wide Impact

- **Docs convention:** `docs/brainstorms/` changes from the primary brainstorm output directory to a legacy/historical input surface. Update `AGENTS.md` in the implementation PR so the canonical repo convention matches the new skill behavior.
- **Skill invocation flow:** `ce-brainstorm` no longer hands a requirements file to `ce-plan`; it hands the unified plan path.
- **Auto-discovery:** Any "latest plan" behavior becomes readiness-sensitive.
- **Review behavior:** Reviewers need to know whether they are reviewing product scope, implementation plan, or both.
- **HTML behavior:** Unified HTML artifacts will be longer than current requirements or plan docs, so navigation becomes load-bearing.

---

## Goal Execution Readiness

This document is suitable for top-level `/goal` execution only if the launching agent can answer these questions from the document without inventing scope:

| Readiness check | Required evidence in this plan | Current state |
|---|---|---|
| Concrete objective | Summary and Goal Capsule name the refactor and target artifact. | Ready |
| Authority source | Requirements, Key Technical Decisions, and System-Wide Impact define what must hold. | Ready |
| Work decomposition | Implementation Units have U-IDs, goals, files, approaches, tests, and verification. | Ready |
| Completion criteria | Global DoD and Per-Unit DoD define observable done signals. | Ready |
| Verification commands | Verification Contract and DoD name `bun test`, `bun run release:validate` when applicable, and `skill-creator` behavioral evaluation. | Ready |
| Stop conditions | The emitted launch prompt sets the stop condition (blocker, wrong naming/config migration, or unsatisfied DoD). | Ready |
| Tail ownership | The emitted standalone launch prompt owns implementation quality gates but does not open a PR. | Ready |
| Context discipline | The emitted launch prompt and the Reader Strategy tell the agent what to read first and when to avoid full-doc reads. | Ready |
| Deferred decisions | Open Questions are **non-blocking**: naming/config decisions carried sensible defaults during implementation (e.g., `requirements-only`/`implementation-ready`; both output config keys retained). Per the readiness rule, a *blocking* open question would have kept this `requirements-only`; these did not. | Ready (open questions deferred) |

For top-level `/goal`, the launch prompt should include:

- exact plan path
- read order
- authority hierarchy
- U-ID execution strategy
- verification commands
- explicit no-progress-mutation rule
- tail ownership profile
- stop conditions
- evaluator-visible completion condition

If any readiness row is not satisfied, the correct goal is not "implement"; it is a planning/enrichment goal that updates the document until the row becomes satisfied.

---

## Risks & Mitigations

- **Risk: requirements-only plans are executed by mistake.** Mitigate with `artifact_readiness`, `ce-work` readiness checks, and tests.
- **Risk: readiness metadata becomes a disguised mutable status field.** Mitigate by documenting readiness as artifact completeness, not work progress, and keeping "no `status:`" tests.
- **Risk: unified docs become too large for downstream agents.** Mitigate with stable headings for heading-scan wayfinding, a top-loaded `Goal Capsule`, self-contained U-IDs, and appendix routing.
- **Risk: legacy artifacts break.** Mitigate by keeping legacy discovery and origin resolution indefinitely.
- **Risk: output config becomes confusing.** Mitigate with a backward-compatible transition and clear docs around format preservation.
- **Risk: HTML review remains weaker.** Mitigate by documenting the existing markdown-only `ce-doc-review` limitation and not overstating HTML review coverage.
- **Risk: goal-mode behavior varies by host.** Mitigate by treating goal-mode as an optional capability with a probe and fallback, not as a universal callable slash command.
- **Risk: dynamic workflows are collapsed into `/goal`.** Mitigate by modeling dynamic workflows / ultracode-style orchestration as a separate `ce-work` execution engine for large fan-out or cross-checking tasks.

---

## Definition of Done

### Global DoD

- **Artifact contract landed:** Skill references define the unified plan contract, metadata, readiness semantics, goal launch block, reader index, goal capsule, and DoD.
- **Brainstorm flow updated:** `ce-brainstorm` writes requirements-only unified plans under `docs/plans/` and hands the same path to `ce-plan`.
- **Plan flow updated:** `ce-plan` enriches requirements-only unified plans in place and still supports direct planning plus legacy requirements docs.
- **Downstream readers updated:** `ce-work`, `lfg`, `ce-doc-review`, `ce-proof`, `ce-code-review`, `ce-work-beta`, and relevant review/adjacent flows are readiness-aware or explicitly guarded.
- **Formats preserved:** Markdown and HTML output modes both render the unified artifact with agent-readable navigation.
- **Compatibility preserved:** Historical `docs/brainstorms/*-requirements.*` documents and old `origin:` references still resolve.
- **Tests complete:** Verification Contract commands pass, including `bun test` with coverage for unified, requirements-only, implementation-ready, and legacy artifacts.
- **Release validation complete:** `bun run release:validate` passes if skill inventory, descriptions, or marketplace metadata are affected.
- **Skill behavior evaluated:** Behavioral skill changes are tested through the `skill-creator` eval workflow, not cached in-session plugin invocation.

### Per-Unit DoD

| Unit | Done Signal | Required Verification | Blocking Dependencies | Deferrable? |
|---|---|---|---|---|
| U1 | Unified artifact contract is documented and tested. | Contract tests pass. | Agreement on `artifact_readiness` naming. | No |
| U2 | `ce-brainstorm` writes requirements-only unified plans. | Brainstorm output-mode and handoff tests pass. | U1 contract. | No |
| U3 | `ce-plan` enriches unified plans in place. | Plan output, resume, and legacy-origin tests pass. | U1 and U2. | No |
| U4 | Downstream readers are readiness-aware. | `ce-work` and review routing tests pass. | U1 metadata. | No |
| U5 | HTML and markdown rendering support long unified docs. | HTML invariant and support-file parity tests pass. | U1 section contract. | No |
| U6 | User-facing docs describe readiness-based unified plans. | Documentation tests and `release:validate` pass. | U1-U5 final terminology. | Yes, only if docs are split into a follow-up PR |
| U7 | Migration and compatibility tests guard legacy behavior. | Full `bun test` passes. | U1-U4 behavior. | No |

---

## Execution Prompt (record)

> This is a **pre-contract meta-plan**: it *defines* the `ce-unified-plan/v1`
> contract and therefore predates it. It uses classic plan sections (Summary,
> Requirements, Key Technical Decisions, Implementation Units, Definition of
> Done) rather than the v1 registry (Goal Capsule / Product Contract /
> Planning Contract / Verification Contract). Under the contract this
> plan landed, the launch prompt is skill-emitted at handoff, not a baked
> section; the prompt below is retained only as a record of how this plan was
> executed. The read-first list names the sections this document actually
> contains.

```text
/goal Implement docs/plans/2026-06-18-001-refactor-unified-plan-doc-artifact-plan.md through its Definition of Done.

Read first:
1. Goal Execution Readiness
2. Summary
3. Requirements
4. Key Technical Decisions
5. Implementation Units heading map
6. Definition of Done
7. Risks & Mitigations

Authority:
- Requirements define the behavior that must hold after the refactor.
- Key Technical Decisions define pinned design choices.
- Implementation Units define the work order and verification expectations.
- Risks & Mitigations define constraints to preserve during implementation.

Execution rules:
- First verify the Goal Execution Readiness table is still satisfied. If not, stop and report the missing readiness row instead of implementing.
- Work unit-by-unit and preserve U-ID references in task updates and final summaries.
- Do not migrate or rewrite historical docs/brainstorms artifacts.
- Do not introduce a mutable execution status lifecycle.
- This is a top-level goal: run applicable simplification and code-review gates before declaring done, but do not open a PR.
- If implementation shows that artifact_readiness naming or config migration is wrong, stop and surface that decision before proceeding.

Done when:
- The transcript shows every non-deferrable Per-Unit DoD row is satisfied.
- The transcript shows Global DoD is satisfied.
- The transcript shows `bun test` passed.
- The transcript shows `bun run release:validate` passed when applicable or was explicitly not applicable.
- The transcript shows applicable simplification/code-review gates ran or were explicitly skipped with reason.
- No plan body progress/status was written.
- No PR was opened by this goal.
```

---

## Rollout Strategy

1. Land the unified artifact contract and tests first.
2. Update `ce-brainstorm` to write requirements-only unified plans.
3. Update `ce-plan` to enrich unified plans and preserve legacy requirements inputs.
4. Update downstream readers to be readiness-aware.
5. Update docs and examples.
6. Run `bun test` and `bun run release:validate`.
7. Use `skill-creator` eval workflow to test edited skill behavior from disk, because plugin skill definitions cache at session start in Claude Code.

Do not migrate historical `docs/brainstorms/` files. They are durable records and compatibility fixtures.

---

## Sources & Research

- OpenAI Codex manual, fetched with the local `openai-docs` skill helper from `https://developers.openai.com/codex/codex-manual.md`: Codex recommends prompts include goal, context, constraints, and done criteria; Goal mode uses a persistent objective and completion criteria; subagents help isolate noisy exploration.
- Anthropic Claude Code goal docs: `https://code.claude.com/docs/en/goal`. Claude `/goal` evaluates a visible condition after each turn; effective conditions need a measurable end state, a stated check, and important constraints.
- Dominik Kundel (OpenAI), "A guide to /goal": `https://www.linkedin.com/pulse/guide-goal-dominik-kundel-webic` (also posted at `https://x.com/dkundel/status/2062650378089594955`). Codex goal mode drives toward a concrete outcome autonomously over hours/days (120+ hour runs cited). Key reinforcements adopted here: the goal prompt is direction-plus-exit-criteria and must stay short (durable scope belongs in the document, not the prompt, because long runs forget it); prefer measurable thresholds as exit criteria; provide a starting point and progress-measurement tooling; avoid pure-visual done criteria; review and remove dead-end/experimental code after completion. Codex's draft-PR progress-visibility pattern is intentionally NOT adopted — it conflicts with this plan's tail-ownership rule that the goal does not open a PR.
- Anthropic dynamic workflows docs: `https://code.claude.com/docs/en/workflows`. Dynamic workflows move orchestration into a script so intermediate results stay out of the main context.
- Anthropic Claude Code commands docs: `https://code.claude.com/docs/en/commands`. Commands are recognized at the start of a user message and include workflow controls.
- Anthropic Claude Code skills docs: `https://code.claude.com/docs/en/skills`. Skills are prompt-based instructions that Claude loads or users invoke with `/skill-name`; they are not documented as a general mechanism for invoking arbitrary slash commands from inside a skill.
- Anthropic subagent docs: `https://code.claude.com/docs/en/sub-agents`. Subagents preserve context by doing high-volume work in separate context windows and returning summaries.
- Matt Pocock `grilling` skill: `https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md`. The useful pattern is one-question-at-a-time decision-tree resolution with recommended answers and codebase exploration when the code can answer.
- Matt Pocock `grill-with-docs` wrapper: `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/grill-with-docs/SKILL.md`. The wrapper points the grilling session at documentation-producing workflows.
- Search note: I found a separate X post about "Grill to Goal" building on Matt Pocock's `grill-me`, but not a Matt-authored `/grill-to-goal` source. The plan therefore borrows from verified `grill-me`/`grilling` mechanics rather than attributing a specific goal artifact shape to Matt.

---

## Review Reconciliation

Cursor reviewed the reader strategy through an Orca-managed `cursor` worktree and agreed with the direction, but flagged that the previous draft still treated efficient reading as too document-local. The accepted changes are:

- Add a Section ID Registry so "what to grep" is mechanical for markdown and HTML.
- Require consumer SKILL.md files to carry the pre-read algorithm before they open unified artifacts.
- Make requirements-only artifacts avoid pointing to absent DoD or implementation sections.
- Ensure `ce-work` subagents receive bounded unit packets instead of only a full plan path.
- Add explicit `ce-doc-review` unified-artifact classification and section-slice routing.
- Extend tests around stable section IDs, HTML ids, and no-full-doc-first consumer behavior.

Claude was requested separately through Orca-managed `claude`, but did not produce a review because the session failed with `API Error: 401 Invalid authentication credentials` after workspace trust prompts. No Claude findings were incorporated.

Rationale: Cursor's feedback is consistent with the core design principle: the document can expose stable affordances, but skills must own the reading algorithm. The plan now treats the stable section **headings/anchors** as the extraction target, not an in-doc index, and never the source of reader behavior.

Two additional Codex subagent reviews were run after the LFG/`ce-work` goal-mode discussion:

- **Skill impact review:** Accepted findings that blank `ce-work` discovery must be conservative, return-to-caller needs explicit syntax and a return envelope, `ce-doc-review` HTML behavior must remain skipped/report-only until mutation is safe, and impacted scope must include `ce-work-beta`, `ce-ideate`, `ce-riffrec-feedback-analysis`, `tests/review-skill-contract.test.ts`, and same-basename output-mode tests.
- **Goal/dynamic workflow review:** Accepted findings that goal-mode must be treated as a host capability rather than a universally callable slash command, implementation launch prompts need evaluator-visible completion conditions, requirements-only enrichment goals must stop on product blockers, and dynamic workflows / ultracode-style orchestration deserve a separate engine lane from `/goal`.

Rejected/adjusted feedback: LFG should not choose goal-mode directly. The reconciled design keeps LFG as the outer pipeline caller and centralizes implementation-engine selection inside `ce-work`; LFG invokes `ce-work` in return-to-caller mode and resumes its own pipeline afterward.

---

## Open Questions

- Should `artifact_readiness` values be exactly `requirements-only|implementation-ready`, or should the requirements value be more explicit, such as `product-contract-only`?
- Should the old `brainstorm_output` config key remain indefinitely, or should it be deprecated in favor of a unified `plan_output` key after one release?
- Should requirements-only unified plans include a draft `Definition of Done`, or should `Definition of Done` be reserved for `ce-plan` finalization?
