# `ce-doc-review`

> Review requirements or plan documents using parallel persona agents that surface role-specific issues.

`ce-doc-review` is the **document review** skill — sibling to `/ce-code-review` for the docs side of the chain. It analyzes a requirements doc or implementation plan, selects reviewer personas based on what the doc contains (product framing, design surfaces, security implications, scope sprawl), dispatches them in parallel, then auto-applies safe fixes and routes the rest through a structured four-option interaction (per-finding walk-through, auto-resolve with best judgment, append to Open Questions, report-only).

The compound-engineering ideation chain is `/ce-ideate → /ce-brainstorm → /ce-plan → /ce-work`. `ce-doc-review` is the **review skill for the artifacts produced by `ce-brainstorm` and `ce-plan`** — invoked at their respective Phase 4 / Phase 5.3.8 handoffs, and also directly when you want a structured review of a doc on disk.

---

## TL;DR

| Question | Answer |
|----------|--------|
| What does it do? | Selects reviewer personas based on doc content, dispatches them in parallel, applies `safe_auto` fixes, routes remaining findings through structured interaction |
| When to use it | After `ce-brainstorm` produces a requirements doc; after `ce-plan` writes a plan; before handing either to implementation |
| What it produces | An updated doc with `safe_auto` fixes applied, plus structured handling of `gated_auto` / `manual` findings |
| Modes | Interactive (default), Headless |

---

## The Problem

Document review is harder than code review in specific ways:

- **No type checker** — there's no compiler error when a requirements doc has internal contradictions
- **No execution** — you can't "run" a plan to see if its scope fits its goals
- **Generalist review collapses** — "looks good" misses the design gap, the security implication, the unstated scope expansion
- **Interleaved concerns** — product framing, security, design, scope, and feasibility all need different lenses, but a single reviewer prioritizes one
- **Findings lack ownership** — "consider revising" without saying who decides or what to do
- **Rejected findings re-surface** — the same issue gets flagged round after round because the rejection wasn't recorded

## The Solution

`ce-doc-review` runs document review as a structured pipeline with explicit gates:

- **Always-on personas** for coherence and feasibility
- **Conditional personas** selected based on doc content — product-lens, design-lens, security-lens, scope-guardian, adversarial
- **Parallel persona dispatch** with bounded concurrency
- **Synthesis pipeline** with cross-persona agreement promotion, contradiction resolution, and three-tier routing (`safe_auto`, `gated_auto`, `manual` + FYI)
- **Decision primer** — round-to-round suppression so rejected findings don't re-surface and applied findings get verification
- **Four-option interaction** — per-finding walk-through, auto-resolve with best judgment, append to Open Questions, report-only

---

## What Makes It Novel

### 1. Doc-content-aware persona selection

Conditional personas activate based on what the doc actually says, not keyword matching:

- **`ce-product-lens-reviewer`** — when the doc makes challengeable claims about what to build and why, or when the proposed work carries strategic weight (trajectory, identity, adoption, opportunity cost)
- **`ce-design-lens-reviewer`** — when the doc contains UI/UX references, user flows, interaction descriptions, or visual design language
- **`ce-security-lens-reviewer`** — when the doc touches auth, public APIs, data handling, PII, payments, third-party trust boundaries
- **`ce-scope-guardian-reviewer`** — when the doc has multiple priority tiers, large requirement counts, or scope-boundary language that seems misaligned
- **`ce-adversarial-document-reviewer`** — when the doc has 5+ requirements, explicit architectural decisions, high-stakes domains, or proposes new abstractions

The 2 always-on (`ce-coherence-reviewer`, `ce-feasibility-reviewer`) run on every review. Conditional personas add depth where the doc's content warrants it.

### 2. Synthesis pipeline with three-tier routing

After all personas return, synthesis:

- Validates each finding against the schema
- Applies an anchor-based gate (drops findings that don't anchor to actual doc content)
- Deduplicates across personas
- **Promotes findings on cross-persona agreement** — two reviewers spotting the same issue raises priority
- Resolves contradictions (different personas disagree on what to do)
- Auto-promotes safe-auto candidates that meet the bar
- Routes findings into three tiers — `safe_auto` (applied directly), `gated_auto` / `manual` (user decision), and FYI (advisory only)

The output is one consolidated set, not a flat list of every persona's raw output.

### 3. Decision primer — round-to-round suppression

When the user runs multiple rounds in the same session (apply some findings, leave the rest, run again), the decision primer carries forward what was applied vs rejected:

- **Applied findings** flow back so round-N+1 personas can verify the fix actually landed
- **Rejected findings** (skip / defer / acknowledge) are suppressed via fingerprint + evidence-substring overlap matching, so the same issue doesn't re-surface

The primer uses an evidence-snippet (first ~120 chars of each finding's evidence) for the overlap test, beyond just title fingerprinting. Without the snippet, suppression falls back to title-only and either re-surfaces rejected findings or suppresses too aggressively.

### 4. Four-option interaction model

When findings land in `gated_auto` / `manual` tiers, the user picks how to handle them:

| Option | Effect |
|--------|--------|
| Per-finding walk-through | Step through each finding individually; apply, skip, defer to Open Questions, or acknowledge |
| Auto-resolve with best judgment | Skill applies what it judges safe; user reviews bulk preview before committing |
| Append to Open Questions | All findings deferred to the doc's `## Open Questions` section as a batch |
| Report-only | No edits; report stays in chat |

The walk-through itself supports an "auto-resolve the rest" escape mid-flow if the user has reviewed enough to trust the rest.

### 5. Bulk-action preview before mass changes

When the user picks "Auto-resolve with best judgment" or "Append to Open Questions" — or escapes mid walk-through to "Auto-resolve the rest" — the skill shows a preview of every change before applying. The preview includes the section, finding title, action (apply / skip / defer / acknowledge), and brief rationale. The user confirms or cancels. This is the safety valve for bulk operations: the user sees what's about to land before it does.

### 6. Two modes — Interactive and Headless

| Mode | When | Behavior |
|------|------|----------|
| **Interactive** _(default)_ | Direct user invocation | Routing question, per-finding walk-through, bulk-preview confirmations |
| **Headless** | `mode:headless` | Apply `safe_auto` silently; return all other findings as structured text; no prompts |

Headless is for skill-to-skill invocation (e.g., `/ce-plan` Phase 5.3.8 calling this skill from a longer flow). Interactive is the user-facing mode.

### 7. Bounded parallelism with backpressure

Persona dispatch respects the harness's active-subagent limit. Selected reviewers queue; the skill dispatches as many as the harness accepts and fills freed slots as reviewers complete. Active-agent / concurrency-limit spawn errors are treated as backpressure (retry after a slot frees), not as reviewer failure. Reviewers are recorded as failed only when a successful dispatch times out or fails for a non-capacity reason.

### 8. Coverage transparency

The output names which personas ran, which were activated by what signals, and whether any failed or timed out. The user can audit "did the right reviewers actually look at this" without parsing internal state.

---

## Quick Example

`/ce-plan` finishes producing a Standard plan for a notification-mute feature. Phase 5.3.8 invokes `/ce-doc-review` with the plan path.

The skill reads the doc, classifies it as `plan`, and analyzes content for conditional personas. It detects: explicit architectural decisions (Key Technical Decisions section is non-trivial), user-facing behavior (UI flow for the mute UI), 6 requirements + 4 implementation units. It activates `ce-feasibility-reviewer` (always-on), `ce-coherence-reviewer` (always-on), `ce-design-lens-reviewer` (UI surface), and `ce-adversarial-document-reviewer` (5+ requirements). Security-lens skips (no auth touched). Scope-guardian skips (single priority tier).

Four reviewers dispatch in parallel. They return 11 raw findings. Synthesis merges them into 7 distinct findings: 2 `safe_auto` (typo, broken cross-reference), 4 `gated_auto` (wording on the durability tradeoff, missing edge case in test scenarios for U2, ambiguous scope wording in Out, design-lens flag on the toggle copy), 1 FYI (suggested scope clarification).

The 2 `safe_auto` apply directly. The user picks "Per-finding walk-through" and steps through the 4 `gated_auto`: applies 3, defers 1 to Open Questions with a reason. The 1 FYI is informational only.

Plan returns to `/ce-plan` Phase 5.3.8 → 5.4 to present the final post-generation menu.

---

## When to Reach For It

Reach for `ce-doc-review` when:

- A requirements doc just landed from `/ce-brainstorm` and you want a structured review before planning
- A plan just landed from `/ce-plan` and you want a deeper review before execution
- You're in headless mode and a programmatic caller (the chain skills) needs review with structured output
- You want round-to-round refinement on a doc — the decision primer prevents loops

Skip `ce-doc-review` when:

- The doc is trivially short (a 2-bullet plan; review overhead exceeds yield)
- You want code review, not doc review → `/ce-code-review`
- The doc is purely informational (a learning doc, a release note) — there's nothing to "review for shipping"

---

## Use as Part of the Workflow

`ce-doc-review` is invoked from doc-producing skills as their review pass:

- **`/ce-brainstorm` Phase 4** — offered as one of the post-doc options ("Agent review of requirements doc")
- **`/ce-plan` Phase 5.3.8** — runs as a mandatory document review step after the confidence check, regardless of whether deepening fired
- **`/ce-resolve-pr-feedback`** — when reviewer feedback lands on a brainstorm or plan doc rather than code

In headless mode, callers receive structured findings and route the user-decision options themselves.

---

## Use Standalone

The skill works directly on any requirements or plan doc:

- **Specific path** — `/ce-doc-review docs/plans/2026-05-04-001-feat-notification-mute-plan.md`
- **Ask the user** — `/ce-doc-review` with no path asks which doc to review (or auto-finds the most recent in `docs/brainstorms/` or `docs/plans/`)
- **Headless** — `/ce-doc-review mode:headless docs/plans/.../plan.md` returns structured findings without interactive prompts

---

## Reference

| Argument | Effect |
|----------|--------|
| _(empty, interactive)_ | Asks which doc to review or auto-finds the most recent |
| `<doc path>` | Reviews that specific doc |
| `mode:headless <doc path>` | Headless mode; structured text output, no prompts |

Headless mode requires a path; without one it errors out rather than guessing.

---

## FAQ

**What's the difference between this and `ce-code-review`?**
`ce-code-review` reviews diffs (code changes); `ce-doc-review` reviews docs (requirements, plans). Different reviewer personas, different findings shape, different routing. Both share the multi-persona dispatch + synthesis pattern but are tuned for their respective artifact types.

**Why does the decision primer matter?**
Without it, every round re-surfaces the same findings, including ones the user already rejected. The primer uses fingerprint + evidence-snippet matching to suppress rejected findings and verify applied fixes — making round-to-round refinement actually iterate, not loop.

**What's "Append to Open Questions" for?**
For findings the user wants to address later, not now. Rather than losing them in chat, they get appended to the doc's `## Open Questions` section so they survive the session and the next planner / implementer sees them.

**Why does it have a bulk preview?**
Because mass changes deserve a confirmation step. "Auto-resolve with best judgment" feels like delegation, but if the skill silently applies 12 changes you can't review without a preview, that's a risk. The preview shows the changes before commit so the user can cancel.

**What if a persona times out or fails?**
The skill proceeds with findings from agents that completed and notes the failure in the Coverage section. A single agent failure doesn't block the entire review.

**Can it review documents other than requirements and plans?**
The personas are tuned for those two types specifically. Reviewing a learning doc or release note works mechanically but the persona advice may not be calibrated for that artifact type. For broad doc review, this is the right tool; for specific other types, the personas may surface noise.

---

## See Also

- [`ce-brainstorm`](./ce-brainstorm.md) — produces the requirements docs this skill reviews
- [`ce-plan`](./ce-plan.md) — produces the plan docs this skill reviews; invokes this skill at Phase 5.3.8
- [`ce-code-review`](./ce-code-review.md) — sibling skill for code (diffs); same multi-persona pattern, different artifact
- [`ce-proof`](./ce-proof.md) — alternative HITL review path via Every's collaborative editor; complementary, not a substitute
