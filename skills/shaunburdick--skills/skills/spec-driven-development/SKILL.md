---
name: spec-driven-development
description: Structured spec-driven development workflow. Load this skill whenever starting a new feature, building a system from scratch, requirements are unclear, or a user asks to "plan", "spec out", "design", or "architect" something — even if they don't use the word "spec". A size gate routes the change first — a Small change (no decisions to agree, nothing outside the repo broken, reversible in one revert) gets a two-paragraph note and no artifacts; anything else runs the six phases — constitution → specification → clarification → plan → tasks → implement. Always review existing specs before creating new ones, and amend them by editing the requirement in place rather than appending.
license: MIT
metadata:
  author: shaunburdick
  version: "2.3.0"
---

# Spec-Driven Development

A disciplined, phase-gated approach to software development based on the [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md): **specifications are the source of truth — code serves specifications, not the other way around**.

The most common failure mode of AI-assisted coding is jumping straight to implementation before the problem is understood. This workflow prevents that.

## Tooling: spec-kit

This workflow is powered by the [spec-kit CLI](https://github.com/github/spec-kit). For installation, initialization, slash commands, and project state detection, load the **`spec-kit` skill**.

Quick reference for the impatient — initialize a project with `uvx` (no install required):

```bash
# New project
uvx --from git+https://github.com/github/spec-kit.git specify init <project-name> --integration opencode

# Existing project
uvx --from git+https://github.com/github/spec-kit.git specify init . --here --integration opencode
```

Supported `--integration` values include `opencode`, `claude`, `copilot`, `cursor-agent`, `codex`, `gemini`, and many others — run `specify integration list` from an initialized project for the full catalog.

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
| 4   | Plan          | Architect | `specs/###-name/plan.md` + supporting docs | User approves                        |
| 5   | Tasks         | Architect | `specs/###-name/tasks.md`                  | User approves                        |
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

**Worked examples:**

| Change | 1 · ACs unaided | 2 · Breaks a consumed contract | 3 · One revert | Lane |
|---|---|---|---|---|
| Add a display name to an existing field | yes | no — additive | yes | **Small** |
| Typo fix in a doc | yes | no | yes | **Small** |
| Add an optional field to a public response | yes | no — additive | yes | **Small** |
| Change what an existing field means | yes | yes | yes | **Full** |
| New feature reaching 40% of the work | no — open questions | yes | no | **Full** |

Answer check 1 by trying: draft the criteria. It takes seconds and cannot be
argued with, which is the point — a change with ten open questions does not pass
by asserting it has none.

**Scale is not the gate.** A 40-file mechanical refactor with no open questions
and no contract change is Small: its spec would contain no information, and what
it actually needs is better tests. Conversely a 5-line change that breaks a
consumed API is Full. If the checks pass but the diff is enormous, that is a
large *diff*, not a complex *change*. File and line counts make a reasonable
"this is probably not Small" nag; they are not the gate.

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
- **Quality standards** (test coverage target, linting, type safety)
- **Anti-patterns to avoid** with examples
- **Success metrics** (product, technical, operational)

The constitution must be approved before writing any feature specs. All subsequent decisions must reference it. If a requirement conflicts with the constitution, resolve the conflict explicitly — don't silently ignore either.

---

## Phase 2: Specification

### Triage: Existing Specs First

Before creating any new spec, **scan all existing specs** to determine whether this work belongs to an existing spec. See [references/spec-triage-guide.md](references/spec-triage-guide.md) for the full decision matrix and examples.

**Process:**

1. Run `ls specs/` to list all existing spec directories.
2. For each spec, read the title, problem statement, and functional requirements (first ~30 lines of `spec.md`).
3. Ask: "Does this work modify, extend, or fix something described in an existing spec?"
4. **If yes** → amend the existing spec. **Amend means edit:** rewrite the
   changed requirements in place so the body describes only the current
   intended behaviour, update the matching ACs, and add one entry to
   `changelog.md`. Never append a new FR and leave the old one standing with a
   "superseded by" note — a reader of `## Functional Requirements` must get
   correct behaviour from that section alone.
5. **If no** → create a new spec as described below.
6. **If ambiguous** → ask the user before proceeding.

**Common mistake to avoid:** "Improve combat" is not a new feature — it's an amendment to the combat spec. "Add inventory system" is a new feature. When in doubt, check.

The other failure is over-correcting into sprawl: a spec that has accreted a
hundred lines of amendments has stopped being readable, and the fix is to
**rewrite it**, not to split it. See "When to Stop Amending" in the triage guide.

### Create the Spec

Create `specs/###-feature-name/spec.md` for each feature (the `/speckit.specify` command scaffolds this via the helper scripts). See [references/feature-spec-template.md](references/feature-spec-template.md) for the full template.

Key sections:

- **Problem Statement** — one paragraph, what and why
- **User Stories** — `As a <role>, I want <action> so that <benefit>`
- **Functional Requirements** — `FR-001`, `FR-002`, … (WHAT, not HOW)
- **Non-Functional Requirements** — performance, security, compatibility
- **Acceptance Criteria** — specific, measurable, binary pass/fail
- **Out of Scope** — explicitly named exclusions, pointing at `changelog.md` for the reasoning
- **Edge Cases** — documented with expected behavior

**What makes a requirement "executable":**

- Concrete, not abstract: "respond within 500ms" not "respond quickly"
- Measurable: "≥80% test coverage" not "good test coverage"
- Explicit error handling: document 404, 500, timeout, empty state behavior
- Example inputs/outputs for all user-facing elements

**What does not belong in `spec.md`:** provenance, rejected alternatives, and
implementation mechanics. Those go to `changelog.md` (requirement-level why)
and `research.md` / the commit body (what and how). A spec that records its own
history stops being readable as a statement of current behaviour — and the
requirement it is read for is usually in the part that gets skipped.

---

## Phase 3: Clarification

Before handing off to planning, eliminate every ambiguity.

**Process:**

1. Ask 3–5 targeted questions at a time (not a wall of 20)
2. For each question, explain _why_ the answer matters
3. Give an example of what a complete answer looks like
4. Document every answer as a requirement in the body — an existing FR edited
   to the clarified behaviour, or a new one added alongside it
5. Bump the spec version and record the question, answer, and resulting
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

Read the response shape, not just the field list. A real example: GitHub's
issue-event object does carry `actor` ("the person who generated the event"),
so a design that assumed issue history could not be attributed was wrong — but
`commented` events do *not* use that common shape and carry `user` instead. An
implementation reading `event.actor.login` would work on most events and return
null on every comment. One API read surfaces both halves; a memory-only
assumption surfaces neither.

Create a feature branch and run the planning setup:

```bash
git checkout -b 001-feature-name   # see git-safety skill for branch rules
.specify/scripts/bash/setup-plan.sh --json
```

Produce the following files in `specs/###-feature-name/`:

**`plan.md`** — Technical context, constitution alignment check, concrete project structure (no "Option A / Option B"), architecture overview, key decisions with rationale.

**`research.md`** — Technology choices with specific versions, rationale, and alternatives considered and rejected.

**`data-model.md`** — Complete entity definitions: fields with types and constraints, relationships, validation rules, state transitions. See [references/data-model-guide.md](references/data-model-guide.md).

**`contracts/`** — API/event schemas (OpenAPI, GraphQL, or event definitions).

**`quickstart.md`** — Setup instructions, how to run tests, key flows to validate manually, expected outputs.

After planning, agent context files are managed by the integrations system — if you changed agents or upgraded spec-kit, refresh with `specify integration upgrade`.

**Gate:** Present the plan. Do not proceed until approved.

---

## Phase 5: Tasks

Create `specs/###-feature-name/tasks.md`:

```markdown
# Tasks: <Feature Name>

- [ ] T-001: Set up project scaffold and install dependencies
- [ ] T-002: Implement data model / database schema
- [ ] T-003: [P] Write unit tests for core logic
- [ ] T-004: Implement core business logic
- [ ] T-005: Implement API layer
- [ ] T-006: Integration tests
- [ ] T-007: Update documentation
```

Rules:

- Each task completable in one sitting
- Mark parallel-safe tasks with `[P]`
- Order by dependency — foundational tasks first
- Test tasks sit alongside (not after) implementation tasks

**Gate:** Present tasks. Do not proceed until approved.

---

## Phase 6: Implement

Execute tasks in order, following the approved plan and referencing the constitution for quality standards.

For all code quality rules, lint suppression policy, type safety requirements, and the pre-commit verification protocol, load and follow the **`code-quality` skill**.

Key reminders:
- ✅ TDD preferred — write tests before or alongside implementation
- ✅ Check off tasks in `tasks.md` as you complete them
- ❌ No lint suppressions of any kind — fix the code instead

---

## References

- [references/feature-spec-template.md](references/feature-spec-template.md) — Full spec template to copy
- [references/constitution-template.md](references/constitution-template.md) — Constitution template
- [references/data-model-guide.md](references/data-model-guide.md) — Data model authoring guide
- [references/spec-triage-guide.md](references/spec-triage-guide.md) — When to amend existing specs vs. create new ones
- **`spec-kit` skill** — CLI installation, slash commands, project state detection
- [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md) — The full spec-driven development manifesto
- [spec-kit repo](https://github.com/github/spec-kit) — Tooling source and docs
