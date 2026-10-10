# Feature Spec Template

Copy this template to `specs/###-feature-name/spec.md`. Replace all `<placeholder>` values. Never leave `[NEEDS CLARIFICATION]` markers when handing off to planning.

> **This spec is a live document.** It describes the application's entire
> intended feature set at this moment: reading `## Functional Requirements`
> alone must produce correct behaviour — no superseded entries, no
> contradictions, nothing the code no longer does. History lives in the
> companion `changelog.md`; behavioural detail lives in ACs and Edge Cases,
> not in the FR list.

---

```markdown
# Feature ###: <Feature Name>

> Version: 1.0
> Last Updated: <date>
> Status: Draft | In Review | Approved
> Dependencies: Feature 001, Feature 002 (or "None")

## Problem Statement

<One to three paragraphs. What problem are we solving? Who experiences it? Why does it matter now?>

## User Stories

- As a **<role>**, I want to **<action>** so that **<benefit>**.
- As a **<role>**, I want to **<action>** so that **<benefit>**.

## Functional Requirements

- **FR-001**: <Specific, testable requirement — WHAT, not HOW>
- **FR-002**: <Specific, testable requirement>
- **FR-003**: <Specific, testable requirement>

**Granularity**: one FR = one capability a single implementation task could
deliver. Field-level behaviour, error messages, and edge cases are ACs and
Edge Cases, not FRs. Keep the list to one screen — past ~15 FRs the spec is
enumerating behaviour instead of capability; consolidate or split before
adding.

## Non-Functional Requirements

- **Performance**: <Concrete targets — e.g., "p95 latency < 200ms under 100 concurrent users">
- **Security**: <Auth requirements, data sensitivity, threat model>
- **Reliability**: <Uptime target, error handling, retry behavior>
- **Compatibility**: <Browser support, OS, runtime versions>
- **Observability**: <Logging, metrics, tracing requirements>

## Acceptance Criteria

- [ ] **AC-001**: <Behaviour the operator can observe, falsifiable by a change in behaviour — not inventory: no counts of controls, no closed-string sets asserted by equality, no "byte-for-byte unchanged" lists (a diff review covers those). Note what verifying it will cost: if it needs N files touched, the criterion is too structural>
- [ ] **AC-002**: <Verifiable, binary criterion>
- [ ] **AC-003**: <Verifiable, binary criterion>

## Out of Scope

The following are explicitly **not** part of this feature:

- <Item 1>
- <Item 2>

## Edge Cases

- <Edge case 1>: <Expected behavior>
- <Edge case 2>: <Expected behavior>
- Empty state: <What the user sees when there is no data>
- Error state: <What happens on 4xx/5xx/timeout>

## Examples

<For user-facing features: show example messages, UI states, or API request/response pairs.
The more concrete, the better — architects and implementers should not have to guess.>

## Open Questions

- [ ] <Unresolved question — must be resolved before planning begins>
```

---

## Companion file: `changelog.md`

Create alongside `spec.md` when the spec is amended. Provenance lives here, not
in the spec — the spec describes what is currently required, and the changelog
explains why it came to require that.

```markdown
# Changelog: <Feature Name>

<!-- One entry per amendment. Newest first. -->

## v1.1 — <date>

**Why**: <requirement-level decision — chosen approach, and the alternative it
was chosen over>

**Changed**: +1 / ~1 / −0 FRs — FR-008 (rewritten — <what changed and what it
replaced>); FR-003 (deleted — <what replaced it>)
```

**Record**: requirement-level rationale, superseded approaches worth
remembering, decisions that would otherwise look arbitrary.

**Do not record**: file names, line counts, sections moved, script internals,
verification commands, test mechanics. Git already has those, in the commit
that made the change. A changelog entry that does not change what a
requirement *means* belongs in the commit body.

Phase 3's clarification Q&A is resolved history: the answers belong in the
requirements they produced (in `spec.md`), the questions and reasoning behind
them belong here.
