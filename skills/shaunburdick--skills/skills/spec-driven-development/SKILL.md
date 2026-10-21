---
name: spec-driven-development
description: Structured spec-driven development workflow. Load this skill whenever starting a new feature, building a system from scratch, requirements are unclear, or a user asks to "plan", "spec out", "design", or "architect" something — even if they don't use the word "spec". A size gate routes the change first — a Small change (no decisions to agree, nothing outside the repo broken, reversible in one revert) gets a two-paragraph note and no artifacts; anything else runs the six phases — constitution → specification → clarification → plan → tasks → implement. Always review existing specs before creating new ones, and amend them by editing the requirement in place rather than appending.
license: MIT
metadata:
  author: shaunburdick
  version: "2.9.0"
---

# Spec-Driven Development

A disciplined, phase-gated approach to software development based on the [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md): **specifications are the source of truth — code serves specifications, not the other way around**.

The most common failure mode of AI-assisted coding is jumping straight to implementation before the problem is understood. This workflow prevents that.

## Tooling: spec-kit

The [spec-kit CLI](https://github.com/github/spec-kit) scaffolds and drives
this workflow; the **`spec-kit` skill** covers installation, the slash
commands, and state detection.

## Directory Structure

```
project/
├── .specify/
│   ├── memory/
│   │   └── constitution.md          # Project principles — scaffolded at init, refined FIRST
│   └── scripts/bash/                # spec-kit helper scripts
└── specs/                           # One directory per feature, at the repo root
    ├── 001-feature-name/
    │   ├── spec.md                  # Feature specification (/speckit.specify)
    │   ├── changelog.md             # Why requirements changed — opt-in, kept out of spec.md
    │   ├── plan.md                  # Created during planning phase
    │   ├── research.md
    │   ├── data-model.md
    │   ├── contracts/
    │   ├── quickstart.md
    │   └── tasks.md
    └── 002-feature-name/
        └── ...
```

> For full CLI setup, slash commands, and state detection, see the **`spec-kit` skill**.

## Phases Overview

| #   | Phase         | Owner     | Output                                     | Gate                                 |
| --- | ------------- | --------- | ------------------------------------------ | ------------------------------------ |
| 1   | Constitution  | Planner   | `.specify/memory/constitution.md`          | User approves                        |
| 2   | Specification | Planner   | `specs/###-name/spec.md`                   | User approves                        |
| 3   | Clarification | Planner   | Updated specs, zero ambiguities            | Zero `[NEEDS CLARIFICATION]` markers |
| 4–5 | Plan + Tasks  | Architect | `specs/###-name/plan.md` and `tasks.md`, one handoff | One gate: user approves both |
| 6   | Implement     | Architect | Working, tested code                       | All acceptance criteria met          |

**Size gate — check this first.**

| Lane | Condition | Artifacts |
|---|---|---|
| **Small** | All three checks below pass | Two-paragraph note in the PR body (or the commit body when there is no PR). No spec, no plan, no tasks, no gates. |
| **Full** | Any one check fails | Phases 1–6. |

The gate asks one question: **are there decisions here that must be agreed before
someone writes code?** That is what the Full lane exists to do, so a change with
no decisions to resolve gains nothing from it.

**All three must pass for Small:**

1. **You can write the acceptance criteria without asking anyone anything.** If
   you cannot, there is something to agree on. This is Phase 3's entire job — if
   nothing needs clarifying, the phase has nothing to do.
2. **Nothing breaks that no local test can catch.** Wire format, public API,
   persisted schema, event payload, authz boundary — anything consumed outside
   this repo. **Additive is not breaking**: a new optional field is Small;
   changing or removing an existing one is Full.
3. **One `git revert` undoes it.** No data migration, no external coordination,
   no published artifact to recall. A wrong guess should cost one commit.

Worked examples, and why scale is not the gate:
[references/size-gate-examples.md](references/size-gate-examples.md).

"Never skip a phase" applies to the Full lane. Over-specifying a small change
costs more than it prevents: the process artifacts get re-read by every later
session, and a wrong premise baked into a spec survives longer than a wrong line
of code.

**Escalate mid-flight.** Small is a claim about now, not a licence for the rest
of the task. If implementation surfaces a decision you were not authorised to
make — an undefined case, an ambiguous requirement, a third-party behaviour you
had assumed — stop and escalate to Full rather than quietly picking a default.

The Small lane skips artifacts, not judgement. Two rules apply in **both**
lanes because each costs one command and each prevents a rewrite:

- **Premise check** — verify claims about third-party behaviour before building
  on them (see [Premise check](#premise-check-mandatory-for-any-external-api)).
- **Triage** — if the change belongs to an existing spec, amend it; do not
  create a parallel one (see [Phase 2](#triage-existing-specs-first)).

---

## Phase 1: Constitution

Create `.specify/memory/constitution.md` **before anything else**. This is the north star for all decisions.

Include:

- **Core principles** (5–7 max — more dilutes them)
- **Technical decisions** (stack, deployment, storage) with rationale for each
- **Quality standards** (linting, type safety, what a test must earn)
- **Anti-patterns to avoid** with examples

A constitution clause that demands artifacts (examples, tests, docs, schemas)
for every change is itself an anti-pattern: it multiplies every downstream
spec. Clauses demand evidence of behaviour, not inventory.

The constitution must be approved before writing any feature specs. All subsequent decisions must reference it. If a requirement conflicts with the constitution, resolve the conflict explicitly — don't silently ignore either.

---

## Phase 2: Specification

### Triage: Existing Specs First

Before creating any new spec, **scan all existing specs** to determine whether this work belongs to an existing spec. Amend when the request changes or extends a capability an existing spec describes; create a new spec only for a distinct user goal or capability, not merely because it depends on existing features. See [references/spec-triage-guide.md](references/spec-triage-guide.md) for the full decision matrix and examples.

**Process:** list `specs/`, read each spec's title, problem statement and
first FRs, and ask whether this work modifies, extends, or fixes something
already described. If yes, **amend by editing**: rewrite the changed
requirements in place so the body describes only current behaviour, update the
matching ACs, and add one `changelog.md` entry; never leave a superseded FR
standing with a "superseded by" note. Each new FR names what it replaces, and
a change that would net-add more than ~3 FRs, or lands on a spec past ~15,
goes through the Amendment Gate in the triage guide. If no, create a new
spec. If ambiguous, ask. "Improve combat" is an amendment; "add inventory
system" is new. A spec that has accreted a hundred lines of amendments is
rewritten, not split.

### Create the Spec

Create `specs/###-feature-name/spec.md` for each feature (the `/speckit.specify` command scaffolds this via the helper scripts). See [references/feature-spec-template.md](references/feature-spec-template.md) for the full template.

Key sections:

- **Problem Statement** — one paragraph, what and why, in the user's words
- **Done when** — one sentence an operator could check
- **Functional Requirements** — `FR-001`, `FR-002`, … (WHAT, not HOW)
- **Acceptance Criteria** — observable behaviour, binary pass/fail, not inventory of controls or closed string sets
- **Not doing** — explicitly named exclusions, so nobody downstream adds them back
- **Edge Cases** — only those the request names or that would plausibly break

**If the request does not say it, do not specify it.** No documentation,
comment, logging, coverage, performance, or observability requirements unless
the user asked for them by name. A missing section is a question for the user
(Phase 3), not a slot to fill with a reasonable default. A spec that says more
than the request is the most expensive bug in this workflow: every later agent
treats it as settled.

**Two shape rules, enforced at creation as much as at amendment:**

1. **The spec is a live document.** It describes the application's entire
   intended feature set at this moment. Reading `## Functional Requirements`
   alone must produce correct behaviour — no superseded entries, no
   contradictions, nothing the code no longer does. History lives in
   `changelog.md`; behavioural detail lives in ACs and Edge Cases.
2. **One FR = one capability.** One implementation task could deliver it.
   Field-level behaviour, error messages, and edge cases are ACs, not FRs.
   The FR list fits on one screen — past ~15 FRs the spec is enumerating
   behaviour instead of capability, and the fix is to consolidate or split,
   never to keep adding.

**What makes a requirement "executable":**

- Concrete, not abstract: "respond within 500ms" not "respond quickly"
- Observable: "a second submit within 5s returns the first order" not "handles double submits"
- Error behaviour only where the request names it or a user would hit it
- Example inputs/outputs where the words are ambiguous

**What does not belong in `spec.md`:** provenance, rejected alternatives, and
implementation mechanics. Those go to `changelog.md` (requirement-level why)
and `research.md` / the commit body (what and how). A spec that records its own
history stops being readable as a statement of current behaviour — and the
requirement it is read for is usually in the part that gets skipped.

---

## Phase 3: Clarification

Before handing off to planning, eliminate every ambiguity.

**Process:**

1. Write the questions into your message text **first**, then call the
   `question` tool with the same content. A `question` call that times out ends
   the turn as an error and leaves nothing on screen — a gate the user cannot
   see is a gate that silently stalls until they happen to notice.
2. Ask 3–5 targeted questions at a time (not a wall of 20)
3. For each question, explain _why_ the answer matters
4. Give an example of what a complete answer looks like
5. Document every answer as a requirement in the body — an existing FR edited
   to the clarified behaviour, or a new one added alongside it
6. Bump the spec version and record the question, answer, and resulting
   requirement change in `changelog.md` — not in `spec.md`

**Exit criteria:** Zero `[NEEDS CLARIFICATION]` markers remain. Every question has been answered and documented as a requirement. A developer could implement from this spec without asking further questions.

---

## Phase 4: Plan

### Premise check (mandatory for any external API)

Before planning on a claim about a third party's behaviour ("GitHub does not
record X"), fetch the endpoint and read it. One `curl` or one doc lookup.
Record the response shape in `research.md`.

If a premise cannot be verified, do not specify on it. An unverified premise
encodes a guess into the spec, and every FR derived from it multiplies the cost
of the guess.

Read the response shape, not just the field list; a worked example of a
premise that was half right is in
[references/size-gate-examples.md](references/size-gate-examples.md#a-premise-that-was-half-right).

Create a feature branch and run the planning setup:

```bash
git checkout -b 001-feature-name   # see git-safety skill for branch rules
.specify/scripts/bash/setup-plan.sh --json
```

Produce `plan.md` in `specs/###-feature-name/`: technical context the
implementer cannot infer from the repository, constitution check, concrete
project structure (no "Option A / Option B"), and key decisions with the
alternative each was chosen over. A planned comment, doc, or test appears only
with the reader question or regression it answers.

Supporting artifacts only when earned, never by default:

- **`research.md`** — a premise about a third party had to be verified; record the response shape.
- **`data-model.md`** — a persisted entity is added or changed. See [references/data-model-guide.md](references/data-model-guide.md).
- **`contracts/`** — the spec names a contract consumed outside this repo.
- **`quickstart.md`** — verification needs steps a reader cannot infer from the test command.

Say which you skipped.

After planning, agent context files are managed by the integrations system — if you changed agents or upgraded spec-kit, refresh with `specify integration upgrade`.

Phases 4 and 5 are **one handoff**: the architect returns `plan.md` and
`tasks.md` together, and one gate covers both. Splitting them doubled the hops
for no extra decision; the task list is the plan made concrete, and a reader
can only judge one against the other.

## Phase 5: Tasks

Create `specs/###-feature-name/tasks.md` in the same handoff:

```markdown
# Tasks: <Feature Name>

- [ ] T001 Add the Order entity in src/models/order.py (FR-001)
- [ ] T002 Implement order placement in src/services/orders.py (FR-001, depends on T001)
- [ ] T003 Expose POST /orders in src/api/orders.py (AC-001)
- [ ] T004 Test: a second submit within 5s returns the first order, fails without T002 (AC-002)
```

Rules:

- Every task names the FR or AC it serves. A task with nothing behind it is cut.
- Each task completable in one sitting; mark parallel-safe tasks with `[P]`
- Order by dependency, riskiest first where dependencies allow
- A test task exists only when the spec names a behaviour this project's own logic would otherwise leave unprotected, and names the regression it catches
- No documentation, logging, validation, hardening, cleanup, or optimization tasks unless an FR asks for them

**Gate:** Present the plan and tasks together. Do not proceed until approved.

---

## Phase 6: Implement

Execute tasks in order, following the approved plan and referencing the constitution for quality standards.

For all code quality rules, lint suppression policy, type safety requirements, and the pre-commit verification protocol, load and follow the **`code-quality` skill**.

Key reminders:
- ✅ Make the smallest change that satisfies the task, then remove anything in the diff that does not contribute
- ✅ A new test must fail without the source change; if it cannot, do not add it
- ✅ Check off tasks in `tasks.md` as you complete them
- ✅ When implementation changes what a requirement means, the spec edit lands in the same change — a spec that drifts from the code is a bug
- ✅ Three acceptable outcomes: done; done with less than the task implied, with the reason; nothing needed
- ❌ No lint suppressions of any kind — fix the code instead
- ❌ Nothing from `Not doing` comes back, and no comments, docs, or tests appear that no task asked for

---

## References

- [references/feature-spec-template.md](references/feature-spec-template.md) — Full spec template to copy
- [references/constitution-template.md](references/constitution-template.md) — Constitution template
- [references/data-model-guide.md](references/data-model-guide.md) — Data model authoring guide
- [references/spec-triage-guide.md](references/spec-triage-guide.md) — When to amend existing specs vs. create new ones
- [references/size-gate-examples.md](references/size-gate-examples.md) — Size-gate worked examples and the premise-check example
- **`spec-kit` skill** — CLI installation, slash commands, project state detection
- [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md) — The full spec-driven development manifesto
- [spec-kit repo](https://github.com/github/spec-kit) — Tooling source and docs
