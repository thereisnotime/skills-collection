---
name: agent-attribution-detection
version: "1.0.0"
status: approved
---

# Agent Attribution Detection for OpenCode v2 and Cross-Harness Support

## Problem Statement

The `git-safety` skill's `prepare-commit-msg` hook appends a `Generated-By:`
trailer when it detects an AI session via `OPENCODE=1` or `AGENT=1`, and its
documentation claims agent frameworks set these variables automatically. That
claim is false for OpenCode v2 (`anomalyco/opencode`, v2.0.15): v2 sets
exactly one environment variable on every spawned child process
(`OPENCODE_TERMINAL=1`) — unconditionally, on agent tool shells *and* human
interactive terminals — and never sets `OPENCODE`, `AGENT`, or any
`OPENCODE_AGENT`/`OPENCODE_MODEL`/`OPENCODE_SESSION*` variable. Consequences:

1. Commits made by agents on OpenCode v2 silently lack the trailer (the hook
   exits clean, no error) — attribution fails silently in practice.
2. `OPENCODE_TERMINAL=1` MUST NOT be treated as an AI signal — it is also
   present in the human's interactive TUI terminal, so using it would
   misattribute human commits and break the hook's mixed-environment guarantee.
3. The existing check `AGENT == "1"` is also wrong for harnesses that adopted
   the emerging `AGENT` convention with non-`1` values (Goose sets
   `AGENT=goose`, Amp sets `AGENT=amp`).
4. Even the skill's "session-start export" setup step is ineffective on
   OpenCode v2: each bash tool call spawns a fresh login shell, so env vars
   exported at session start do not persist to a later `git commit` call.

The ecosystem is converging on an `AI_AGENT` standard (like `CI=true`,
proposed in agentsmd/agents.md#136) plus a per-harness detection matrix
maintained by `@vercel/detect-agent` and Bun's `isAIAgent()`. This feature
makes the skills' attribution detection honest, cross-harness, and aligned
with that standard — and turns OpenCode v2 silent failure into an explicit
claim convention.

## User Stories

- As a developer committing from an OpenCode v2 agent session, I want the
  commit to carry a `Generated-By:` trailer without me remembering a magic
  incantation, so AI attribution is automatic and EU AI Act Article 50
  transparency holds.
- As an operator mixing agent and human commits in one repo, I want the hook
  to neither misattribute my human commits nor silently drop agent
  attribution, so the history stays trustworthy.
- As a user of other harnesses (Claude Code, Cursor, Gemini CLI, Codex,
  Goose, Amp, Cline, Augment), I want the hook to recognize my harness's
  native environment signal so attribution works without per-harness hacks.

## Functional Requirements

### FR-001 — Cross-harness detection matrix
`prepare-commit-msg` treats the session as AI when **any** of the following
env vars is set to a non-empty value (not just `1`): `AI_AGENT`, `AGENT`,
`OPENCODE`, `OPENCODE_AGENT`, `OPENCODE_MODEL`, `OPENCODE_CLIENT`,
`CLAUDE_CODE`, `CLAUDE_CODE_ENTRYPOINT`, `CURSOR_AGENT`, `GEMINI_CLI`,
`CODEX_SANDBOX`, `AUGMENT_AGENT`, `CLINE_ACTIVE`.

### FR-002 — `OPENCODE_TERMINAL` is never a detection signal
`OPENCODE_TERMINAL=1` alone MUST NOT append a trailer. When it is set and no
FR-001 variable matches and the commit source is not `merge`/`squash`, the
hook prints a non-fatal warning to stderr explaining the `AI_AGENT` claim
convention. The commit always succeeds (exit 0).

### FR-003 — Default attribution derived from the harness
When detection fires but `OPENCODE_AGENT` is unset, the trailer defaults to
the harness name that triggered detection: `opencode`, `claude-code`,
`cursor`, `gemini-cli`, `codex`, `augment`, `cline`, `goose`, `amp`, or
`ai-agent` (bare `AI_AGENT` match). `OPENCODE_AGENT`/`OPENCODE_MODEL`, when
set, produce `Generated-By: <agent> (model: <model>)`, falling back to
`Generated-By: <agent>` when only the agent name is present.

### FR-004 — Idempotent and source-aware
Never append a trailer if the commit message already contains a
`Generated-By:` trailer (amend-safe). Skip `merge` and `squash` sources
regardless of environment.

### FR-005 — git-safety SKILL.md rewritten honestly
The Attribution section is rewritten: accurate "How It Works" (no false
claims about frameworks setting vars), a per-harness signal table, an
explicit note that OpenCode v2 sets no AI marker and why `OPENCODE_TERMINAL`
is not a signal, the commit-time claim convention, removal of the ineffective
session-start export step, an updated mixed-environments table, updated
verification commands, and the inline appendable hook block kept in semantic
parity with the shipped script.

### FR-006 — `git-agent-commit` wrapper script
New `scripts/git-agent-commit`: exports `AI_AGENT` (defaulting to
`opencode`), preserves `OPENCODE_AGENT`/`OPENCODE_MODEL` from the
environment, and `exec`s `git commit "$@"`. Documented as the canonical
OpenCode v2 commit path.

### FR-007 — ai-attribution SKILL.md detection references updated
The Git Commits surface references the cross-harness matrix (`AI_AGENT`,
`AGENT`, tool-specific vars) instead of only `OPENCODE=1`/`AGENT=1`. The
manual trailer-append fallback is retained.

### FR-008 — Bash 3.2+ compatibility, no new dependencies
The hook and wrapper run on macOS's default `/bin/bash` (3.2) and Linux bash
4/5: no associative arrays, no `${var,,}` lowercasing, no `mapfile`. No new
runtime dependencies. `bash -n` passes; shellcheck (when available) reports
no errors.

## Non-Functional Requirements

- **NFR-001 (Safety)**: The hook must never fail or block a commit.
  Attribution is advisory; every non-fatal path exits 0.
- **NFR-002 (Performance)**: Hook overhead < 10 ms (pure env + grep checks).
- **NFR-003 (Determinism)**: Identical input env → identical trailer output,
  regardless of repo state, cwd, or git version.
- **NFR-004 (Maintainability)**: Detection logic lives in exactly two places
  — the shipped script and the SKILL.md appendable block — kept in parity by
  a documented check.
- **NFR-005 (Compatibility)**: Unrecognized harnesses with no signal are
  unaffected (no trailer, no warning) unless `OPENCODE_TERMINAL=1` is set
  (warning only).

## Acceptance Criteria

- **AC-1**: `AI_AGENT=opencode git commit` appends `Generated-By: opencode`.
- **AC-2**: `AGENT=goose git commit` appends `Generated-By: goose`.
- **AC-3**: `CLAUDE_CODE=1 git commit` appends `Generated-By: claude-code`.
- **AC-4**: `OPENCODE_TERMINAL=1 git commit` (no claim) appends nothing,
  prints the stderr warning once, exits 0.
- **AC-5**: plain `git commit` (no vars) appends nothing, prints nothing.
- **AC-6**: commit with an existing `Generated-By:` trailer + claim env →
  no duplicate trailer.
- **AC-7**: `merge`/`squash` commit sources skip attribution regardless of env.
- **AC-8**: `AI_AGENT=opencode OPENCODE_AGENT=my-agent
  OPENCODE_MODEL=my-model git commit` → `Generated-By: my-agent (model: my-model)`.
- **AC-9**: `git-agent-commit` produces byte-identical trailer output to the
  equivalent inline env invocation.
- **AC-10**: `bash -n` passes on the hook, wrapper, and test script; no bash
  4+ syntax in any shipped script.
- **AC-11**: No documentation claims OpenCode v2 (or "frameworks" generally)
  set `OPENCODE`/`AGENT` automatically; the SKILL.md explicitly states
  OpenCode v2 sets only `OPENCODE_TERMINAL`.

## Edge Cases

| Scenario | Expected behavior |
|---|---|
| Human commits inside OpenCode TUI terminal (`OPENCODE_TERMINAL=1`, no claim) | Warning shown, no trailer. Documented in SKILL.md. |
| Amend of an AI commit | Existing trailer detected → no change. |
| Amend of a human commit with claim env set | Trailer appended (claimed agent authored the amendment). |
| `OPENCODE_AGENT` set but no detection var | `OPENCODE_AGENT` itself is a FR-001 detection signal → attributed as `opencode`. |
| `OPENCODE_AGENT` set under a *non-opencode* harness (stale value) | Ignored — scoped to the opencode harness (FR-009, AC-15). |
| `ANTHROPIC_MODEL` set in a plain human shell | Not a marker — no trailer (AC-14). |
| Empty/absent commit message file argument | Hook guards with `${1:-}` and exits 0. |
| Goose/Amp (`AGENT=goose`/`AGENT=amp`) | Non-`1` `AGENT` values match FR-001 → attributed. |
| Bash 3.2 (macOS) | All scripts avoid bash 4+ syntax (FR-008). |

## Out of Scope

- **OpenCode v2 plugin that injects env into the shell tool** (Design B from
  ideation): deferred spike; requires verifying the shell tool accepts an
  `env` input.
- **Upstream feature request** for `anomalyco/opencode` to set an AI marker
  on tool-only ptys (Design C): tracked as a follow-up, not part of this PR.
- **Repo policy gate / CI enforcement** (Design E): optional repo-specific
  enhancement; ai-attribution skill already ships a CI-check reference.
- **Shell-profile kind detection** (Design F): rejected — too invasive.
- **Process-tree detection** (Design D): rejected — false positives under the
  OpenCode TUI terminal.
- Source-file SPDX disclosures and non-commit surfaces: unchanged.

## Clarifications Applied

- Direction approved by user (Sep 23 2026): "Layered fix, full feature" —
  hook matrix update + `AI_AGENT` claim convention + warn-on-silent-miss +
  honest docs rewrite, delivered as a feature branch + PR.
- This repo has no `.specify/` or `specs/` scaffolding; `AGENTS.md` is treated
  as the project constitution. Spec/plan/tasks artifacts are committed
  lightweight (no spec-kit tooling initialized) to avoid polluting the skills
  repo with scaffolding.

## Amendments

- **A1 (Sep 23 2026) — follow-ups #3 and #2 in scope (user: "3 and 2 go in
  this PR")**: the two deferred items are now done on this branch, tracking
  the follow-ups listed in the PR body:
  - **#3 SKILL.md size refactor**: `git-safety/SKILL.md` reduced 546 → 353
    lines. The pre-existing `## PR and Commit Preflights` and
    `## Permission-Denied Reporting and Escalation` (incl. Secret and
    Encrypted-File Boundary) sections moved verbatim to
    `references/preflight-checks.md` and
    `references/permission-denied-reporting.md`, with mandatory-read pointer
    sections and a quick reference left inline so the safety gates stay
    discoverable. Body-equality of the moved sections verified via diff
    against the pre-move extraction.
  - **#2 plugin env-injection spike**: performed, findings recorded in
    `references/attribution-detection.md` (Plugin Automation Spike section).
    Verdict: v2.0.15 supports per-call env injection via
    `ctx.shell.hook("create.before", ...)` (mutable `ShellCreateBefore.env`
    reaches the spawned process), but the dev branch removed that path
    (rewritten bash tool, no hook trigger, upstream TODO pending new V2
    plugin hooks) — so no plugin ships; the claim convention remains the
    version-stable mechanism.

- **A2 (Sep 25 2026) — cross-harness agent name + model attribution
  (user-approved: "Both wins in PR #9")**: extend attribution beyond
  `OPENCODE_AGENT`/`OPENCODE_MODEL` to the rest of the ecosystem:
  - **FR-009 — agent name from claim values**: the `AI_AGENT`/`AGENT` value
    itself is the agent name per agentsmd/agents.md#136 (the value has
    name semantics: `goose`, `amp`, `custom-architect`, ...), unless it is
    a boolean marker (`1`/`true`) or the canonical claim value `opencode`.
    `OPENCODE_AGENT` applies only when the harness is `opencode`, so a
    stale value from another harness's session is ignored. FR-003's
    default-attribution clause is superseded by the A2 precedence rules.
  - **FR-010 — harness-scoped model lookup**: only two model vars are
    consulted — `OPENCODE_MODEL` (opencode) and `ANTHROPIC_MODEL`
    (claude-code, emitted as-is with `[1m]`/provider prefixes preserved).
    No other harness exports a model var to tool subprocesses today
    (`OPENAI_MODEL`/`GEMINI_MODEL` are SDK config vars, not exports). A
    model var alone never triggers attribution — a bare `ANTHROPIC_MODEL`
    in a human shell is not a marker.
  - Trailer precedence: `<agent> (model: <model>)` → `<agent>` →
    `<harness> (model: <model>)` (agent unknown, model known) →
    `<harness>`.
  - New acceptance criteria (test-case labels in parentheses):
    - **AC-12**: `AGENT=whatever git commit` → `Generated-By: whatever`
      (AC-2c).
    - **AC-13**: `CLAUDE_CODE=1 ANTHROPIC_MODEL=claude-opus-4-6 git commit`
      → `Generated-By: claude-code (model: claude-opus-4-6)` (AC-3b);
      identical via `CLAUDE_CODE_ENTRYPOINT` (AC-3c).
    - **AC-14**: bare `ANTHROPIC_MODEL=... git commit` (no harness marker) →
      no trailer (AC-5b).
    - **AC-15**: `CLAUDE_CODE=1 OPENCODE_AGENT=stale git commit` →
      `Generated-By: claude-code` — stale `OPENCODE_AGENT` scoped out
      (AC-2d).
    - **AC-16**: `AI_AGENT=custom-architect git commit` →
      `Generated-By: custom-architect` (AC-8c); `AI_AGENT=1 git commit` →
      `Generated-By: ai-agent` boolean fallback (AC-8d).
    - **AC-17**: `AI_AGENT=opencode OPENCODE_MODEL=my-model git commit` →
      `Generated-By: opencode (model: my-model)` (AC-8e).

- **A3 (Sep 25 2026) — hook install-currency check (user-approved:
  "Implement hash check")**: SKILL.md setup/verification previously checked
  only existence, executability, and a marker grep (`AI_AGENT|OPENCODE_TERMINAL`)
  — which *any* version since v1 satisfies, so a stale installed hook
  reported "has attribution" after a skill update.
  - **FR-011 — block-hash currency check**: new read-only
    `scripts/check-hook.sh` compares the installed hook's extractable
    "AI Commit Attribution" block against the shipped script's block using
    `git hash-object` (content hash, so any byte drift is caught without
    version-string discipline; valid for both full-copy and appended
    installs). Also verifies existence, executability, and block syntax
    (`bash -n` on the extracted block only). Prints exact remediation
    commands; exit 0 = current, exit 1 = missing/not-executable/outdated.
    SKILL.md Step 1 ("Ensure Hook Exists and Is Current") and the
    Verification section invoke the checker; the marker-only grep is
    removed.
  - **AC-18**: `check-hook.sh` verdicts — full-copy install → CURRENT/0
    (AC-18a); tampered block → OUTDATED/1 (AC-18b); missing hook →
    OUTDATED/1 (AC-18c); block appended into a pre-existing hook →
    CURRENT/0 (AC-18d). Covered by harness smoke tests.
  - **AC-19**: SKILL.md no longer uses the marker-only grep for currency;
    Step 1 and Verification run `check-hook.sh`.