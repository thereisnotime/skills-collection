---
name: spec-driven-development
description: >-
  Structured spec-driven development workflow. Load this skill whenever starting a new feature, building a system from scratch, requirements are unclear, or a user asks to "plan", "spec out", "design", or "architect" something — even if they don't use the word "spec".
  Two independent questions route the work: a spec exists only when a contract changes — new, amended, or consolidated — and a plan exists only when a decision is open, so effort size scales the plan and never the spec. Always review existing specs before creating new ones, and amend by editing the requirement in place rather than appending.
license: MIT
metadata:
  author: shaunburdick
  version: "2.11.2"
---

# Spec-Driven Development

A disciplined, phase-gated approach to software development based on the [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md): **specifications are the source of truth — code serves specifications, not the other way around**.

The most common failure mode of AI-assisted coding is jumping straight to implementation before the problem is understood. This workflow prevents that. A spec describes what the system must do; the change that gets it there is a plan.

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

## Two Questions

Specs and plans are independent. Routing a change through a single size decision is how a
rewrite becomes a feature spec: it has decisions, so it is "not small", so it
gets a spec, and the spec describes the rewrite.

**Spec — does the contract change?** The contract is whatever a consumer
relies on: behaviour, a name, a path, a schema, a default. Consumers are
people, other repos and other agents; maintainers of this repo are not.

- **No** — no spec. If the document itself is wrong (drifted from the code,
  written around a migration, or one contract split across several specs),
  repair it.
- **Yes, nobody owns it** — new spec (Phase 2).
- **Yes, one spec owns it** — amend it in place (Phase 2, Triage).
- **Yes, several specs own it** — consolidate into one owner, then amend.

**Plan — is a decision open?** A decision is open when someone else must agree
to it before code: an interface, a parity strategy, a migration, a target to
adopt.

- **No** — no plan. The commit or PR body carries what changed, what was
  removed, and why.
- **Yes** — a design note sized to the decision (Phase 4), with tasks when it
  spans more than one sitting (Phase 5).

Both axes at once is normal. Effort size appears on the plan axis only: a
ten-line contract change still amends, and a 500-file refactor with no open
decision still needs no spec. Nothing changing — a question, a review, an
explanation — gets an answer, not an artifact.

### Work type to process

| Work | Process | Gate |
| --- | --- | --- |
| A question or review | Answer | None |
| No contract change, no decision | The change + commit/PR body | None |
| No contract change, a decision open | Plan, then change | User approves the plan |
| Contract change, one owner | Amend in place + `changelog.md`; plan if a decision is open | User approves the amendment, and the plan if there is one |
| Contract change, no owner | Phases 2–3, then plan/tasks if decisions are open | User approves the spec, and the plan |

The six phases below apply in full only to a new spec. An amendment edits the
owning spec; a plan exists only when a decision is open, and its weight follows
the decision, not the size of the spec or the diff.

These rules apply to every change:

- **Premise check** — verify claims about third-party behaviour before building
  on them (see [Premise check](#premise-check-mandatory-for-any-external-api)).
- **Escalate mid-flight** — a decision that surfaces during implementation is
  still a decision: stop and ask rather than quietly picking a default.
- **Triage** — if the change belongs to an existing spec, amend it; do not
  create a parallel one (see [Phase 2](#triage-existing-specs-first)).
- **Executable criteria** — write each acceptance criterion as a command and
  its expected output wherever the change allows (a test, a grep, a diff). A
  prose criterion ("output is byte-identical", "at least five rows") is what
  turns a cheap conformance check into a long adjudication; rewrite it before
  dispatch.

---

## Phase 1: Constitution

Create `.specify/memory/constitution.md` **before anything else**. This is the north star for all decisions. It is project setup, not a per-change phase.

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

A spec is a durable contract for a feature: a capability someone can name and ask
for. Months later, someone who was not in the room opens it to learn what the
system must do. So before creating one, name who would open it again; if nobody
would, there is nothing to write. If you cannot name, in one sentence, what a
consumer relies on that this file now owns, stop: you are writing a plan.

### Triage: Existing Specs First

Before creating any new spec, **scan all existing specs** to determine whether this work belongs to an existing spec. Find the owner by the surface the change touches — a delivery channel, an interface, a store — not by the data it reads. Amend when the request changes or extends a contract an existing spec describes; create a new spec only for a distinct user goal or capability, not merely because it depends on existing features. See [references/spec-triage-guide.md](references/spec-triage-guide.md) for the full decision matrix and examples.

**Process:** list `specs/`, read each spec's title, problem statement and
first FRs, and ask whether this work changes a contract an existing spec owns.
If yes, **amend by editing**: rewrite the changed requirements in place so the
body describes only current behaviour, update the matching ACs, and add one
`changelog.md` entry; never leave a superseded FR standing with a "superseded
by" note. If the spec has drifted from the code and nothing it requires
changes, repair it instead — no changelog entry. Each new FR names what it
replaces, and a change that would net-add more than ~3 FRs, or lands on a spec
past ~15, goes through the Amendment Gate in the triage guide. If no spec owns
it, create one only after the approval step below. If ambiguous, ask. "Improve
combat" is an amendment; "add inventory system" is new. A spec that has accreted
a hundred lines of amendments is rewritten, not split.

**Amend in one pass per section.** Apply a findings list by rewriting each
affected requirement once rather than patching it finding by finding, and never
chain an edit onto text an earlier edit already rewrote. Past a handful of
edits to one file, prefer a single scripted replacement pass over a stream of
anchored edits.

### Create the Spec

Before creating one, say in your reply what capability the spec would name and
who would read it later — in your own sentence, not a filled-in template — and
wait for the user's approval. Create no file or directory until the answer
comes back.

Create `specs/###-feature-name/spec.md` for each feature only after the yes
(the `/speckit.specify` command scaffolds this via the helper scripts and runs
only after the same approval). See [references/feature-spec-template.md](references/feature-spec-template.md) for the full template.

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
5. Record each answer where it belongs: an answer that changes what a consumer
   gets edits an FR (or adds one beside it); an answer that constrains how the
   work is delivered — sequencing, parity strategy, module split — goes to the
   plan, not into a requirement
6. Bump the spec version and record the question, answer, and any requirement
   change in `changelog.md` — not in `spec.md`

**Exit criteria:** Zero `[NEEDS CLARIFICATION]` markers remain. Every question is answered and recorded — as a requirement only where behaviour changed. A developer could implement from this spec without asking further questions.

---

## Phase 4: Plan

A plan exists when a decision is open, and its weight follows the decision. An
interface choice gets a paragraph in the issue; a rewrite with a module split, a
parity strategy and a migration gets `plan.md` and tasks. A plan with no spec
lives where the work is tracked — the issue, or a short design note in the repo
— not in a new spec directory invented to hold it.

### Premise check (mandatory for any external API)

Before planning on a claim about a third party's behaviour ("GitHub does not
record X"), fetch the endpoint and read it. One `curl` or one doc lookup.
Record the response shape in `research.md`, or in the plan when there is no
spec.

If a premise cannot be verified, do not specify on it. An unverified premise
encodes a guess into the spec, and every FR derived from it multiplies the cost
of the guess.

Read the response shape, not just the field list; a worked example of a
premise that was half right is in
[references/premise-check.md](references/premise-check.md#a-premise-that-was-half-right).

Create a branch (see `git-safety`). When a spec owns the work, run the planning
setup:

```bash
git checkout -b 001-feature-name
.specify/scripts/bash/setup-plan.sh --json
```

Produce `plan.md` beside the spec, or a design note at a path the issue names:
technical context the implementer cannot infer from the repository, constitution
check, concrete project structure (no "Option A / Option B"), and key decisions
with the alternative each was chosen over. A plan or task never schedules a code
comment — the engineer decides on comments while writing the code. A planned
doc or test appears only with the reader question or regression it answers.

Supporting artifacts only when earned, never by default:

- **`research.md`** — a premise about a third party had to be verified; record the response shape.
- **`data-model.md`** — a persisted entity is added or changed. See [references/data-model-guide.md](references/data-model-guide.md).
- **`contracts/`** — the spec names a contract consumed outside this repo.
- **`quickstart.md`** — verification needs steps a reader cannot infer from the test command.

Say which you skipped.

After planning, agent context files are managed by the integrations system — if you changed agents or upgraded spec-kit, refresh with `specify integration upgrade`.

Phases 4 and 5 are **one handoff** when a plan exists: the architect returns
`plan.md` and `tasks.md` together, and one gate covers both. Splitting them
doubled the hops for no extra decision; the task list is the plan made concrete,
and a reader can only judge one against the other.

## Phase 5: Tasks

Create the tasks in the same handoff — `tasks.md` beside the spec, or in the
issue when there is no spec:

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

Execute the plan's tasks, or the change itself when there is no plan, following the approved plan and referencing the constitution for quality standards.

For all code quality rules, lint suppression policy, type safety requirements, and the pre-commit verification protocol, load and follow the **`code-quality` skill**.

Key reminders:
- ✅ Make the smallest change that satisfies the task, then remove anything in the diff that does not contribute
- ✅ A new test must fail without the source change; if it cannot, do not add it
- ✅ Check off tasks where they live as you complete them
- ✅ When implementation changes what a requirement means, the spec edit lands in the same change — a spec that drifts from the code is a bug
- ✅ Three acceptable outcomes: done; done with less than the task implied, with the reason; nothing needed
- ❌ No lint suppressions of any kind — fix the code instead
- ❌ Nothing from `Not doing` comes back, and no comments, docs, or tests appear that no task asked for

---

## References

- [references/feature-spec-template.md](references/feature-spec-template.md) — Full spec template to copy
- [references/constitution-template.md](references/constitution-template.md) — Constitution template
- [references/data-model-guide.md](references/data-model-guide.md) — Data model authoring guide
- [references/spec-triage-guide.md](references/spec-triage-guide.md) — When to amend an existing spec, create one, or repair the document
- [references/premise-check.md](references/premise-check.md) — Verifying a third-party claim before building on it
- **`spec-kit` skill** — CLI installation, slash commands, project state detection
- [SDD philosophy](https://github.com/github/spec-kit/blob/main/spec-driven.md) — The full spec-driven development manifesto
- [spec-kit repo](https://github.com/github/spec-kit) — Tooling source and docs
