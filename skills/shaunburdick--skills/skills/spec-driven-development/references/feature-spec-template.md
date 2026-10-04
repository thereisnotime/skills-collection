# Feature Spec Template

Copy this template to `specs/###-feature-name/spec.md`. Replace all `<placeholder>` values. Never leave `[NEEDS CLARIFICATION]` markers when handing off to planning.

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

## Non-Functional Requirements

- **Performance**: <Concrete targets — e.g., "p95 latency < 200ms under 100 concurrent users">
- **Security**: <Auth requirements, data sensitivity, threat model>
- **Reliability**: <Uptime target, error handling, retry behavior>
- **Compatibility**: <Browser support, OS, runtime versions>
- **Observability**: <Logging, metrics, tracing requirements>

## Acceptance Criteria

- [ ] **AC-001**: <Verifiable, binary — either it passes or it doesn't>
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

**Changed**: FR-008 (added); FR-003 (rewritten — <what changed and what it
replaced>)
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
