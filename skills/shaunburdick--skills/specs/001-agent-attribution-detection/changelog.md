# Changelog: Agent Attribution Detection

Requirement-level provenance for
[spec.md](spec.md). Newest first.

The spec describes what is currently required. This file explains why, and what
each requirement replaced. Implementation mechanics — file names, line counts,
verification commands — live in the commit that made the change.

> **Reading FR ids across versions:** ids were regrouped in v1.5 and are not a
> stable public API. The mapping from the pre-v1.5 numbering is in the v1.5
> entry. Nothing outside this directory should be citing them; if something is,
> fix that instead of preserving the old numbers.

---

## v1.5 — 2026-10-03

**Why**: The spec had accreted to 277 lines, of which 100 were a prose
`## Amendments` section. Two requirements had been defined *inside* that
section rather than in `## Functional Requirements`, and the append-only
amendment protocol had left a contradiction in place: FR-003 stated the
harness-name default while AC-16 asserted claim-value resolution for the same
input. A reader who trusted the requirements section implemented behaviour that
failed the acceptance criteria in the same file.

This entry is the restructure that fixes it, not a behaviour change.

**Changed**:
- FR-003 rewritten to match the claim-value rule. The old AC-16 (now AC-006)
  already asserted it; the fix is that entry's fix, now applied to the body
  instead of narrated around it
- Requirements regrouped by concern and renumbered. Pre-v1.5 mapping:
  old FR-003 → new FR-003/FR-005; old FR-009 → new FR-003; old FR-010 → new
  FR-004; old FR-011 → new FR-010; old FR-012 → new FR-011. Others unchanged.
- Acceptance criteria folded in from the amendment log and renumbered
  `AC-001`–`AC-026`. The old log cited sub-labels (`AC-8c`, `AC-8d`, `AC-8e`)
  that no acceptance criterion defined; those cases are now explicit criteria,
  and AC-026 covers FR-008, which previously had none
- `## Clarifications Applied` and `## Amendments` removed from `spec.md`; the
  reasoning they held is here
- `## Out of Scope` reduced to names, pointing here for reasoning

Old AC ids above refer to the pre-v1.5 numbering; the mapping is the inverse of
the FR mapping.

---

## v1.4 — 2026-09-29

**Why**: v1.3's currency check deliberately ignores content outside the marker
block, so that an appended install tolerates arbitrary pre-existing hooks. That
tolerance admitted a specific failure — a hook carrying a stale pre-marker copy
of the attribution logic reported CURRENT, and because the stale copy ran first
and wrote its own less-complete trailer, the current block's dedupe check then
skipped it. The model detail was silently dropped from the trailer while the
check reported the hook as current.

Chosen over tightening the hash to cover the whole file, which would have made
every pre-existing hook in a repo read as OUTDATED — technically correct and
practically useless as a currency signal.

**Changed**: FR-011 added (outside-block staleness gate), AC-021 and AC-022
added.

---

## v1.3 — 2026-09-25

**Why**: The setup and verification steps checked hook existence, executability,
and a marker grep for `AI_AGENT|OPENCODE_TERMINAL`. Any version since v1
satisfies that grep, so a hook left over from before a skill update reported
"has attribution" — the check could not detect drift it existed to detect.

A content hash over the attribution block was chosen over a version-string
comparison because the block is appended into existing hooks, where a version
constant is neither present nor reliably maintained.

**Changed**: FR-010 added (block-hash currency check), AC-017–AC-020 added.
FR-007 updated to invoke the checker in place of the marker grep.

---

## v1.2 — 2026-09-25

**Why**: Harnesses that adopt the emerging `AI_AGENT` convention set it to their
*own name* (`goose`, `amp`, `custom-architect`), but the harness-name default
reported them as a generic agent — or, for a bare `AGENT` marker, as `ai-agent`.
Attribution existed but was not specific.

Chosen over keeping the harness default and layering an override on top, which
left two rules to reconcile and re-introduced the ambiguity this removes. The
cost of this choice is that `OPENCODE_AGENT` must be harness-scoped, or a stale
value from another session misattributes the commit — hence FR-003's scoping
clause and AC-008.

**Changed**: FR-003 rewritten (agent name resolves from the claim value),
FR-004 added (harness-scoped model lookup), FR-005 added (precedence), AC-006
through AC-014 added.

---

## v1.1 — 2026-09-23

**Why**: Two follow-up items raised during review were deferred, then pulled
into the same change on request ("3 and 2 go in this PR"). The second was an
investigation rather than a feature: it established whether an OpenCode v2
plugin could inject environment into the shell tool, which would have removed
the need for an explicit claim convention.

The spike found the injection path existed in v2.0.15 but had been removed on
the dev branch (rewritten bash tool, no hook trigger, upstream TODO pending).
**Chosen:** ship no plugin, and keep the claim convention as the
version-stable mechanism. The spike's conclusion is the requirement; the code
that would have implemented the rejected path is not part of this spec.

**Changed**: scope widened to include both follow-ups. No new FRs — the outcome
is recorded here and in `## Out of Scope`, not as a requirement.

---

## v1.0 — 2026-09-23

**Why**: Initial spec. The `git-safety` hook documented framework-set
environment variables that OpenCode v2 does not set, so attribution failed
silently on the primary harness this repository is used with.

**Changed**: initial requirements FR-001 through FR-008, AC-001 through AC-011.

---

## Process notes

- **No spec-kit scaffolding in this repository.** There is no `.specify/` and
  no `specify init` has been run; `AGENTS.md` is treated as the project
  constitution. Spec, plan, and tasks artifacts here are committed lightweight by
  hand, deliberately, to avoid adding CLI scaffolding to a skills repository.
- **Alternatives considered** (Designs A–F, including the rejected ones) are in
  [plan.md](plan.md), not here. Rejection reasoning is requirement-level and
  appears in the entries above only where it constrains a current requirement.