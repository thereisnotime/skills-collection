# Spec Triage Guide

Before creating a new spec, **always** scan existing specs to determine whether the work belongs to an existing spec. Spec sprawl — where "improve combat" becomes a new spec instead of updating the combat spec — undermines the entire workflow.

## Triage Process

When a new piece of work is requested:

1. **List all existing specs** — read `specs/` and review each `spec.md` title, problem statement, and functional requirements.
2. **Score relevance** — for each existing spec, ask: "Does this work change, extend, or fix something described in this spec?"
3. **Decide** — apply the decision matrix below.
4. **Document the decision** — regardless of outcome, record what you found and why you made the choice.

## Decision Matrix

| Condition | Action | Example |
|-----------|--------|---------|
| Work modifies existing FRs or ACs | **Amend existing spec** | "Improve combat damage calculation" → update FR-003 in the combat spec |
| Work adds new FRs to an existing domain | **Amend existing spec** — after consolidating what the change replaces (see [How to Amend](#how-to-amend-an-existing-spec)) | "Add ranged weapons to combat" → generalize the weapon FRs rather than appending a sibling |
| Work would net-add ≈3+ FRs, or the spec is already past ~15 | **Run the [Amendment Gate](#amendment-gate-run-before-writing-the-amendment)** — do not grow | "Add a subsystem to a 100-FR spec" → merge, generalize, or split first |
| Work fixes bugs in existing spec's scope | **Amend existing spec** | "Fix combat hit detection" → update ACs in the combat spec |
| Work is a genuinely new, unrelated feature | **Create new spec** | "Add inventory system" → new spec (first time this domain appears) |
| Work spans multiple existing specs | **Create new spec** with explicit references | "Crafting system that uses inventory + combat" → new spec that cites both |
| Work is ambiguous — could go either way | **Ask the user** before proceeding | "Better NPC behavior" — is this combat AI or dialogue? |

## How to Amend an Existing Spec

An amendment **rewrites the spec to describe the current intended behaviour.** It
is an edit, not an append. A spec is not a record of how it got here — it is a
description of what it now requires.

1. **Consolidate before adding.** Read the existing FRs in the affected area
   first. A merge candidate (a sibling FR sharing the subject), a
   generalization (an existing FR that stretches to cover the new case), or an
   invalidation (the change kills an existing FR) all beat a new FR. Every FR
   that survives as genuinely new must name, in the changelog entry, the FR(s)
   it replaces or generalizes.
2. **Edit the body.** A changed requirement is rewritten in place. A removed
   behaviour is deleted. Never leave superseded text behind with a "superseded
   by FR-0xx" note: a reader who trusts `## Functional Requirements` must get
   correct behaviour from that section alone.
3. **Renumber and regroup freely.** Order requirements by concern, not by the
   order they arrived. An identifier is only load-bearing if something outside
   the spec cites it.
4. **Update Acceptance Criteria in the same pass.** Every FR should have at
   least one AC, and no AC may describe behaviour that no FR requires.
5. **Update the Problem Statement** only when the *problem* changed — not merely
   the solution.
6. **Add one entry to `changelog.md`** (below). Do not create a new spec
   directory.

## Where Provenance Lives: `changelog.md`

Provenance belongs in `changelog.md`, beside the spec — **not** inside
`spec.md`. Two reasons: the spec stays short enough to read in one pass, and
history becomes opt-in context that nobody pays for unless they ask why the
spec looks like this way.

Division of labour:

| File | Holds |
|---|---|
| `spec.md` | Current intended behaviour and its acceptance test. Nothing else. |
| `changelog.md` | Requirement-level **why** — what was chosen, and what it was chosen over. |
| commit / PR body | **What** — the diff, the file list, line counts, verification commands. |

```markdown
# Changelog: <Feature Name>

## v1.2 — 2026-10-03

**Why**: <the requirement-level decision — chosen approach, and the alternative
it was chosen over>

**Changed**: +2 / ~1 / −0 FRs — FR-007, FR-012 (added); FR-003 (rewritten —
the agent name now comes from the claim value, superseding the harness-name
default)
```

Every `Changed:` line opens with the `+ / ~ / −` FR counts, so growth is
visible at a glance. An entry reading `+N / ~0 / −0` is not an amendment — it
is an append; go back to the Amendment Gate.

Banned from `changelog.md`, because git already stores it: file names, line
counts, which section moved where, script internals, verification commands,
test-case mechanics. **If it does not change what a requirement means, it
belongs in the commit body.**

Never use a changelog entry as a substitute for editing the body. If an entry
has to explain that the body is wrong, the body needs fixing.

## Amendment Gate (run before writing the amendment)

Amending is right while the spec still models one coherent thing. Run this gate
**before** drafting — after the draft is after the damage. Three checks, in
order:

1. **Net addition under control?** More than ~3 new FRs, or a spec already
   past ~15 FRs, means *do not add*: consolidate first. Merge FRs that share a
   subject, generalize an existing FR to cover the new case, or rewrite the
   model at a coarser granularity where one FR absorbs what were several.
2. **Rewrite share sane?** A draft that would rewrite more than a third of
   the FRs is not a change to the spec — it is evidence the spec's model of
   the domain was wrong. Rewrite it, or split it into two specs that reference
   each other.
3. **One-paragraph test:** can you still state the Problem Statement in one
   paragraph without "and also"? If not, the spec is two features — split it
   into two specs that reference each other.

Growing an oversized spec further is always the wrong default. Rewriting a
spec to fix its model is not spec sprawl. The test is whether one Problem
Statement still describes the work.

## The WHAT / WHERE Line

`spec.md` says **what** is required and how it is verified. `plan.md` and
`research.md` say **why**, plus rejected alternatives and trade-offs.

Recording a rejected design *inside the spec* is the most common source of spec
bloat: the reasoning already lives in `research.md`, and restating it in the
requirement document makes every future reader re-derive a decision that was
made once. `## Out of Scope` states what is excluded, and points at
`changelog.md` for why.

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Correct Approach |
|---|---|---|
| "Improve X" as a new spec | Fragments related work, creates orphaned specs | Amend the X spec |
| "Add feature Y to Z" as a new spec | The Z spec already owns this domain | Add FRs to Z's spec |
| "Fix bug in X" as a new spec | Bugs are part of the spec's scope | Update ACs in X's spec |
| Never amending specs | Specs become stale snapshots, not living documents | Rewrite the body; log to `changelog.md` |
| **Append-only amendment** | Requirements accumulate in arrival order and superseded text stays authoritative-looking, so a reader of the FR section implements the old behaviour | Edit the requirement in place; delete what it replaced |
| **Additive-only amendment** (`+N / ~0 / −0`) | The change nets nothing out — no merge, no generalization, nothing invalidated. The spec grows past the point where one pass describes the system and the new feature hides in the tail | Run the Amendment Gate: merge, generalize, or split before adding |
| **Changelog inside `spec.md`** | Every read of the spec pays for history it did not ask for, and the tail is the part readers skim | Separate `changelog.md` |
| **Changelog recording implementation detail** | Duplicates git; the document bloats without gaining information | Requirement-level why only — `what` goes to the commit |
| **Never renumbering** | FRs accumulate in arrival order, so no read-through builds a mental model | Regroup by concern; git preserves the diff |

## Examples

### Example 1: Combat Improvement

**Request:** "Improve the combat system"

**Wrong:** Create `specs/005-improve-combat/spec.md`
**Right:** Open the existing combat spec and edit it — new FRs for the
improvements, existing ACs updated, one `changelog.md` entry.

### Example 2: New Weapon Type

**Request:** "Add ranged weapons to the game"

**Wrong:** Create `specs/006-ranged-weapons/spec.md`
**Right:** Amend the combat spec with the ranged mechanics. If weapons are
genuinely a separate domain, create a new spec that references the combat spec
— and check the Problem Statement test first.

### Example 3: Bug Fix

**Request:** "Fix the dodge mechanic not working"

**Wrong:** Create `specs/007-fix-dodge/spec.md`
**Right:** Update the combat spec's ACs in place. The bug was always inside the
spec's scope; a fix closes a gap rather than opening a feature.

### Example 4: Genuinely New Feature

**Request:** "Add an inventory system"

**Right:** Create `specs/005-inventory-system/spec.md` — a new domain no existing
spec covers.

### Example 5: A Requirement That Changed (the case append-only gets wrong)

**Request:** "The agent name should come from whatever the claim says, not from
the harness."

FR-003 currently reads: *"the trailer defaults to the harness name that triggered
detection."*

**Wrong** — append FR-013 and add a note that FR-003 is superseded:

```markdown
### FR-013 — Agent name from claim value
... (see A2 for precedence)
> FR-003's default-attribution clause is superseded by FR-013.
```

Now the FR section contradicts its own entry, and a reader who stops at FR-003
implements the old behaviour.

**Right** — rewrite FR-003 to state the new rule, and record the decision in
`changelog.md`:

```markdown
### FR-003 — Agent name from the claim value
When `AI_AGENT`/`AGENT` is set to a non-boolean, non-canonical value, that
value **is** the agent name (`goose`, `amp`, `custom-architect`). ...
```

```markdown
## v1.2 — 2026-09-25
**Why**: The harness-name default was wrong for tools that set `AI_AGENT` to
their own name; they were being reported as a generic agent. Chosen over
keeping the harness default plus an override, which left two rules to reconcile.
**Changed**: +1 / ~1 / −0 FRs — FR-003 (rewritten), FR-010 (added),
AC-12…AC-17 (added)
```

### Example 6: The Amendment That Would Add 25 FRs

**Request:** "Add ship combat to the mecha-turk spec 002 (already 100+ FRs)."

**Wrong:** append FR-101…FR-125. The FR list is already past unreadable, the
new feature hides in the tail, and a reader of `## Functional Requirements`
now has a hundred-plus entries to reconcile with the code.

**Right:** run the Amendment Gate. Past ~15 FRs, do not add: open the existing
FRs and consolidate — the movement, targeting, and damage requirements usually
generalize to cover ships. If the feature genuinely outgrows the spec, split:
extract `specs/006-ship-combat/spec.md` for the new domain and amend spec 002
to reference it. Either way the changelog records `+2 / ~6 / −1 FRs` — not
`+25`.

## What "Scanning Existing Specs" Means in Practice

The agent should:

1. Run `ls specs/` to list all spec directories.
2. For each directory, read the **title**, **problem statement**, and **functional requirements** (first ~30 lines of `spec.md` is usually enough).
3. Check if the requested work overlaps with any existing FRs or falls within any spec's domain.
4. If overlap exists, apply the decision matrix above.
5. Only create a new spec if no existing spec covers the domain.
