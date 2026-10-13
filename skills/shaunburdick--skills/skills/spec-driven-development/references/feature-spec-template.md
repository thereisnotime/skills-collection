# Feature Spec Template

Copy this template to `specs/###-feature-name/spec.md`. Replace all `<placeholder>` values. Never leave `[NEEDS CLARIFICATION]` markers when handing off to planning.

> **This spec is a live document.** It describes the application's entire
> intended feature set at this moment: reading `## Functional Requirements`
> alone must produce correct behaviour — no superseded entries, no
> contradictions, nothing the code no longer does. History lives in the
> companion `changelog.md`; behavioural detail lives in ACs and Edge Cases,
> not in the FR list.

**If the request does not say it, do not specify it.** Leave the section out
and list the gap under Open Questions. A missing section is a question for the
user, not a slot to fill with a reasonable default. In particular: no
documentation, comment, logging, coverage, performance, or observability
requirements unless the user asked for them by name.

---

```markdown
# Feature ###: <Feature Name>

> Version: 1.0
> Last Updated: <date>
> Status: Draft | In Review | Approved
> Dependencies: Feature 001, Feature 002 (or "None")

## Problem Statement

<One paragraph. What problem are we solving, for whom, and why now. Use the user's words where possible.>

## Done when

<One sentence an operator could check. This is the whole feature's exit criterion.>

## Functional Requirements

- **FR-001**: <Specific, testable requirement — WHAT, not HOW>
- **FR-002**: <Specific, testable requirement>

**Granularity**: one FR = one capability a single implementation task could
deliver. Field-level behaviour, error messages, and edge cases are ACs and
Edge Cases, not FRs. Keep the list to one screen — past ~15 FRs the spec is
enumerating behaviour instead of capability; consolidate or split before
adding.

## Acceptance Criteria

- [ ] **AC-001**: <Behaviour the operator can observe, falsifiable by a change in behaviour — not inventory: no counts of controls, no closed-string sets asserted by equality, no "byte-for-byte unchanged" lists (a diff review covers those). Note what verifying it will cost: if it needs N files touched, the criterion is too structural>
- [ ] **AC-002**: <Verifiable, binary criterion>

## Not doing

Explicitly excluded, so nobody downstream adds it back:

- <Item 1>
- <Item 2>

## Edge Cases

<Only the cases the request names or that would plausibly break. Do not enumerate empty/null/error states mechanically.>

- <Edge case>: <Expected behavior>

## Open Questions

- [ ] <Unresolved question — must be resolved before planning begins>
```

Optional sections, included only when the request names the concern: **User
Stories** (`As a <role>, I want <action> so that <benefit>`), a single named
**Non-Functional Requirement** (one concrete target, e.g. "p95 < 200ms"), and
**Examples** (request/response pairs or UI states when the words are ambiguous).

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
