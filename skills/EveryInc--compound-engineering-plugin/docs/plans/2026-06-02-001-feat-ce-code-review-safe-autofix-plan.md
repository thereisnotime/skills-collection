---
title: "feat: Safe self-applied fixes for ce-code-review"
type: feat
status: active
date: 2026-06-02
---
# feat: Safe self-applied fixes for ce-code-review

## Overview

Re-introduce auto-fixing into `ce-code-review`, but as a lightweight, judgment-based **act policy** modeled on discussion about not having heavyweight `mode:autofix` machinery the review-only refactor removed. The reviewer (or the agent that owns the tree) applies the fixes it's confident in, surfaces them legibly, and the safety comes from the work being **reversible edits in a visible diff handled by a smart agent**, not from a permission gate.

This partially walks back the "review-only, never mutate" stance of `refactor/ce-code-review-review-only` — deliberately. The review-only refactor solved two real problems (apply *machinery* complexity, and orchestration interruption). This plan keeps both solved while recovering the "it just took things off my plate" delight that the main-branch version had.

## Problem Frame

The review-only refactor was an overcorrection. It conflated two separable things:

- **Bad (correctly removed):** the apply *machinery* — `mode:autofix`, `autofix_class`-as-permission, in-skill batching/subagent-dispatch/residual-gate. This added complexity and let the review mutate a tree an upstream orchestrator (ce-work) was managing, which interrupted the pipeline.
- **Good (wrongly removed):** a narrow, behavior-preserving convenience that just happens — e.g., the main-branch run that auto-applied test hardening ("assert the no-op stays a no-op," "cover the unknown-id/empty-array guards") and reported it in an "Applied automatically" table.

Two failed framings were explored and rejected before settling:

1. **"Apply only when sure / when unsure, report."** Agents are already conservative; a "when unsure, report" thumb compounds into "reports everything, fixes nothing." The control was placed as a *precondition gate* (judgment about safety before acting), which is exactly what makes smart agents hedge.
2. **A categorical deny-list** ("never auto-apply security / contracts / migrations / **anything needing product judgment**"). "Product judgment" is a gameable escape hatch — almost any change can be reasoned into it — and the rest of the list mostly guards against actions a code-review fix doesn't take anyway: **code-review fixes are edits to a git tree, reversible by construction and visible in the diff.** You address a migration finding by editing the file, not by running it; you don't fix a payments finding by charging a card. Telling a smart agent "auth is high-stakes" tells it what it already knows — the over-prescription `AGENTS.md` warns against.

## Decisions settled in dialogue

- **Control downside by relocating the guardrail, not by gating action.** For reversible, visible edits the control is *after* (revert), *ambient* (the diff + a smart agent), and at the *permanence step* — which is the **push**, not the commit (a local commit is private and reversible) — not *before* (a precondition). **Gate the push, not the action.**
- **Keep the act policy minimal and judgment-based, plus a bias-to-act framing.** The entire apply policy is a few lines: apply clear improvements, push back (don't apply) when the reviewer is wrong, defer what needs a decision. This works because the agent is smart and the only guardrail is a judgment one ("push back if wrong"). Add an explicit anti-conservatism instruction so the agent does not hedge on clear, reversible improvements.
- **No deny-list.** Dropped entirely. The one genuine residual ("green tests ≠ safe" for auth/contract/concurrency edits) is handled by surfacing those prominently in the report, not by blocking them.
- **The tree-owner acts.** Whoever owns the working tree applies. It dissolves the orchestration-interruption scar.
- **Keep our richer signal as *signal*, not a gate.** Severity (P0–P3), confidence anchors, cross-reviewer agreement, and `autofix_class` continue to exist and inform *what to act on first* and *how prominently to surface*, but they do not mechanically gate the apply decision. The decision is the agent's judgment.

## Requirements Trace

- **R1. Act policy.** When acting on findings, default to applying every finding that is a clear improvement and a reversible edit, regardless of severity. Push back (do not apply) when the reviewer is wrong, with reasoning. Use judgment to skip taste/conflicting findings — but **surface** what was skipped; never silently drop. Explicitly frame leaving a clear, reversible, improvement unapplied "to be safe" as the failure mode.
- **R2. Tree-owner-acts placement.** The review applies fixes itself in **default (interactive) mode** — when it is the top-level agent. In `**mode:agent**` (the machine-handoff mode; `mode:headless` is a deprecated alias for it, `mode:report-only` is ignored), the review stays **report-only** and the caller applies. This preserves the read-only contract programmatic callers rely on and removes the interruption.
- **R3. Scope correctness invariant.** Apply only on a tree that *is* what was reviewed (`local-aligned` / standalone). In `pr-remote` / `branch-remote`, the working tree is not the reviewed head — do not apply; report instead. (Correctness, not a safety gate.)
- **R4. Verify-then-keep.** After applying, run the relevant tests/lint. If they fail, revert that fix and report it as a finding instead. This is competence (a fix you didn't verify isn't finished), framed lightly — not a ceremonial gate.
- **R5. Legible reporting.** Add an **Applied** section to the markdown report (the "Applied automatically" table: `# | File | Fix | Reviewer`), plus a one-line validation outcome (e.g., "pin tests 4 → 6; suite 94 pass, lint clean"). Applied findings move to the Applied section; everything else stays in the severity/actionable tables. No `applied_fixes` JSON field: the only mode that emits JSON (`mode:agent`) is report-only and applies nothing, so applied work surfaces only in default-mode markdown.
- **R6. "Green ≠ safe" surfacing.** Auth/authz, public or cross-service contract/schema, and concurrency edits that were applied must be flagged prominently in the Applied section so the diff reviewer's eye goes there. A nudge, not a block.
- **R7. ce-work apply step adopts the same act philosophy.** `references/review-findings-followup.md`'s current eligibility filter ("apply only if `suggested_fix` present AND confidence 100/75 AND mechanical AND evidence matches; when unsure, skip") is the conservative trap. Reframe it to bias-to-act for the tree-owner, consistent with R1, so the orchestrated path isn't timid while the standalone path is bold.
- **R8. Explicit non-revival.** Do not reintroduce `mode:autofix`, `autofix_class`-as-permission, or a deny-list. Keep the apply policy judgment-based.
- **R9. Tests + docs.** Update `tests/review-skill-contract.test.ts`, the numbering fixture, the output template, and the skill doc as needed; check the `ce-work-beta` counterpart.
- **R10. Commit ownership = permanence owner.** The permanence gate is the **push**, not the commit (a local commit is private and reversible). In default (interactive) mode the review applies and **commits the fixes as an isolated `fix(review):` commit when the working tree was clean before the review**; on a dirty tree it applies but leaves them for the human's commit (the fixes can't be isolated from the user's WIP). It never pushes. In `mode:agent` the **caller** (ce-work) applies and commits after its diff review. This is "gate the push, not the action" — apply and commit locally (both reversible), never push.

## Behavior Spec

### Act policy (R1)

The instruction the skill carries (paraphrase, to be tightened in SKILL.md):

> Default to applying every finding that is a clear improvement and a reversible edit. Don't hedge: the work is a tracked, visible diff you can revert, so leaving a clean fix unapplied "to be safe" is the failure mode, not the safe choice. Push back — don't apply — when the reviewer is wrong, and say why. Skip taste calls and conflicting suggestions using judgment, but list what you skipped and why. Severity, confidence, and cross-reviewer agreement tell you what to do first and what to flag loudly — they don't decide for you.

### Who acts and who commits (R2, R10)

There are only two modes: **default** (interactive markdown) and `**mode:agent**` (machine handoff; `mode:headless` aliases it, `mode:report-only` is ignored).


| Invocation            | Tree/permanence owner      | Apply                                               | Commit                                                                                                                                                                            |
| --------------------- | -------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default (interactive) | The human                  | Review applies + verifies + reports Applied section | **Commit when the pre-review tree was clean** — isolated `fix(review):` commit. On a dirty tree, apply but leave the fixes for the human's commit (can't isolate from WIP). Never push. |
| `mode:agent`          | The caller (e.g., ce-work) | Review is **report-only**; `applied_fixes: []`      | Caller applies *and* commits after its own diff review (ce-work already does `fix(review): …` today)                                                                              |


This relaxes the prior "`mode:agent` changes serialization only" invariant into "`mode:agent` is the machine-handoff mode: serialization *and* defer-apply-to-caller." That is an intentional, explainable evolution — `mode:agent` already means "a caller owns the workflow."

**Edge case — default mode run without a human (e.g., wired into a cron/loop).** Behavior is unchanged: apply, commit if the tree was clean (else leave the fixes for whatever commits the WIP), report; never push. Operators who want autonomous apply-and-commit on a dirty tree should use `mode:agent` with a caller (ce-work) that owns the commit. We do not add a third mode for this.

### Output (R5)

Markdown (top-level runs), new section above the severity tables:

```markdown
### Applied (safe, verified)

| # | File | Fix | Reviewer |
|---|------|-----|----------|
| 1 | `worktrees.test.ts:2987` | no-op test now asserts isPinned stays unchanged | testing |

Validation: pin tests 4 → 6; worktrees.test.ts 94 pass, lint clean.
```

JSON (`mode:agent` and as a machine record on top-level runs):

```json
"applied_fixes": [
  { "n": 1, "file": "worktrees.test.ts", "line": 2987, "fix": "...", "reviewer": "testing", "verified": true }
]
```

In `mode:agent`, `applied_fixes` is empty (caller applies) and the same findings appear in `actionable_findings` as today.

## Non-goals

- No `mode:autofix` revival; no autofix *mode* at all.
- No `autofix_class`-as-permission gate; the class stays as caller-handoff signal only.
- No deny-list / "product judgment" category.
- No confidence anchor used as an apply gate (it remains a synthesis/surfacing signal).
- No change to reviewer selection, scope detection, or the merge/dedup pipeline.

## Implementation Map

- `plugins/compound-engineering/skills/ce-code-review/SKILL.md`
  - Add the act policy + bias-to-act framing (R1) at the synthesis/output phase, inline (load-bearing).
  - Add the who-acts table (R2) and the scope invariant (R3) to the apply guidance.
  - Add verify-then-keep (R4) and the "green ≠ safe" surfacing nudge (R6).
  - Re-document the skill as "review + safe self-apply when top-level; report-only as a stage" (the operating-principles "review-only" line changes).
- `plugins/compound-engineering/skills/ce-code-review/references/review-output-template.md`
  - Add the **Applied** section + example (R5); note `applied_fixes` in the agent-mode subsection.
- `plugins/compound-engineering/skills/ce-code-review/references/action-class-rubric.md`
  - Clarify the routing classes are caller-handoff signal, not an apply gate (R8).
- `plugins/compound-engineering/skills/ce-work/references/review-findings-followup.md` (+ `ce-work-beta` counterpart, + `ce-work` SKILL.md anchor if affected)
  - Reframe the apply step to bias-to-act for the tree-owner (R7).
- `tests/review-skill-contract.test.ts`, `tests/fixtures/ce-code-review-stable-numbering.md`
  - Update contract assertions: review applies when top-level, report-only in `mode:agent`; `applied_fixes` field; Applied section in template; no deny-list / no `mode:autofix`.
- `docs/skills/ce-code-review.md`
  - Update framing if the high-level purpose shifts (review-only → review + safe self-apply). Likely yes this time.

## Test Plan

- Contract test: assert SKILL.md carries the act policy, the who-acts split, the scope invariant, verify-then-keep, and the Applied/`applied_fixes` output contract; assert no `mode:autofix` and no deny-list language.
- Fixture: extend `ce-code-review-stable-numbering.md` (or add a fixture) to include an Applied section and assert numbering remains stable across Applied + severity + Actionable sections.
- Full suite green vs. the current 47 pre-existing failures (CLI install/cleanup), zero new.

## Resolved decisions

- **ce-work apply boldness (R7).** Same act policy as the standalone review — bias-to-act, judgment. ce-work already reviews diffs before committing, which is its permanence gate.
- **Commit behavior (R10).** The permanence gate is the **push, not the commit** (a local commit is private and reversible). Interactive review applies and, **when the working tree was clean before the review, commits the fixes as an isolated `fix(review):` commit**; on a dirty tree it applies but leaves them for the user's commit (the fixes can't be cleanly isolated from the user's WIP). It never pushes. `mode:agent` caller applies and commits. No third "autonomous top-level" mode.
- **Modes.** Only `default` and `mode:agent` exist (`mode:headless` is a deprecated alias; `mode:report-only` ignored). The earlier draft's separate `mode:headless` apply row was wrong and is removed.

## Open Questions

1. **Verify granularity (R4).** Targeted tests for the touched files vs. a broader run when multiple files changed. Lean: targeted by default, broader when fixes span files (mirror existing Stage 6 validation guidance).

## Stable/Beta Sync

`ce-code-review` has no `-beta` counterpart. `ce-work` does (`ce-work-beta`) — R7 must be propagated to both `ce-work/references/review-findings-followup.md` and `ce-work-beta/references/review-findings-followup.md`, with the sync decision stated explicitly at implementation time.