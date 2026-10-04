---
name: agent-attribution-detection
version: "1.5.0"
status: approved
updated: 2026-10-03
---

# Agent Attribution Detection for OpenCode v2 and Cross-Harness Support

> This file describes **current intended behaviour only**. Why each requirement
> exists, and what it replaced, is in [changelog.md](changelog.md).

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
3. The check `AGENT == "1"` is wrong for harnesses that adopted the emerging
   `AGENT` convention with non-`1` values (Goose sets `AGENT=goose`, Amp sets
   `AGENT=amp`).
4. The skill's "session-start export" setup step is ineffective on OpenCode v2:
   each bash tool call spawns a fresh login shell, so env vars exported at
   session start do not persist to a later `git commit` call.

The ecosystem is converging on an `AI_AGENT` standard (like `CI=true`, proposed
in agentsmd/agents.md#136) plus a per-harness detection matrix maintained by
`@vercel/detect-agent` and Bun's `isAIAgent()`. This feature makes the skills'
attribution detection honest, cross-harness, and aligned with that standard —
and turns OpenCode v2 silent failure into an explicit claim convention.

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

Requirements are grouped by concern and numbered within each group. On amend,
regroup freely — IDs are not a stable public API.

### Session detection

#### FR-001 — Cross-harness detection matrix
`prepare-commit-msg` treats the session as AI when **any** of the following env
vars is set to a non-empty value (not just `1`): `AI_AGENT`, `AGENT`, `OPENCODE`,
`OPENCODE_AGENT`, `OPENCODE_MODEL`, `OPENCODE_CLIENT`, `CLAUDE_CODE`,
`CLAUDE_CODE_ENTRYPOINT`, `CURSOR_AGENT`, `GEMINI_CLI`, `CODEX_SANDBOX`,
`AUGMENT_AGENT`, `CLINE_ACTIVE`.

#### FR-002 — `OPENCODE_TERMINAL` is never a detection signal, and a silent miss warns
`OPENCODE_TERMINAL=1` alone MUST NOT append a trailer — it is also set on human
TUI terminals. When it is set, no FR-001 variable matches, and the commit
source is not `merge`/`squash`, the hook prints a non-fatal warning to stderr
explaining the `AI_AGENT` claim convention. The commit always succeeds (exit 0).

### Attribution content

#### FR-003 — Agent name resolves from the claim value
When `AI_AGENT` or `AGENT` is set to a non-empty, non-boolean value other than
the canonical `opencode`, **that value is the agent name** — `goose`, `amp`,
`custom-architect`, and so on (per agentsmd/agents.md#136, the value carries
name semantics).

A boolean marker (`1`, `true`) or the canonical value `opencode` is not a name;
resolution falls through to FR-005. `OPENCODE_AGENT` supplies the agent name
**only** when detection was triggered by an opencode signal, so a stale
`OPENCODE_AGENT` left over from another harness's session is ignored.

#### FR-004 — Harness-scoped model lookup
Only two model variables are consulted: `OPENCODE_MODEL` (opencode) and
`ANTHROPIC_MODEL` (claude-code, emitted as-is with `[1m]`/provider prefixes
preserved). No other harness exports a model variable to tool subprocesses
today (`OPENAI_MODEL`/`GEMINI_MODEL` are SDK config vars, not exports).

A model variable **alone** never triggers attribution — a bare `ANTHROPIC_MODEL`
in a human shell is not a marker (see FR-001).

#### FR-005 — Trailer precedence
Resolve in this order, taking the first that yields a value:

1. `<agent> (model: <model>)` — agent and model both known
2. `<agent>` — agent known, model unknown
3. `<harness> (model: <model>)` — agent unknown, model known
4. `<harness>` — neither, where `<harness>` is the signal that triggered
   detection (`opencode`, `claude-code`, `cursor`, `gemini-cli`, `codex`,
   `augment`, `cline`, `goose`, `amp`, or `ai-agent` for a bare `AI_AGENT`)

### Commit safety

#### FR-006 — Idempotent and source-aware
Never append a trailer if the commit message already contains a `Generated-By:`
trailer (amend-safe). Skip `merge` and `squash` sources regardless of
environment.

### Documentation and interface

#### FR-007 — git-safety SKILL.md states the real detection behaviour
The Attribution section is rewritten: accurate "How It Works" (no false claims
about frameworks setting vars), a per-harness signal table, an explicit note
that OpenCode v2 sets no AI marker and why `OPENCODE_TERMINAL` is not a signal,
the commit-time claim convention, removal of the ineffective session-start
export step, an updated mixed-environments table, updated verification commands,
and the inline appendable hook block kept in semantic parity with the shipped
script.

#### FR-008 — ai-attribution SKILL.md references the same matrix
The Git Commits surface references the cross-harness matrix (FR-001) instead of
only `OPENCODE=1`/`AGENT=1`. The manual trailer-append fallback is retained.

#### FR-009 — `git-agent-commit` wrapper script
`scripts/git-agent-commit` exports `AI_AGENT` (defaulting to `opencode`),
preserves `OPENCODE_AGENT`/`OPENCODE_MODEL` from the environment, and `exec`s
`git commit "$@"`. Documented as the canonical OpenCode v2 commit path.

### Install currency

#### FR-010 — Block-hash currency check
`scripts/check-hook.sh` compares the installed hook's extractable "AI Commit
Attribution" block against the shipped script's block using `git hash-object`.
A content hash catches any byte drift without version-string discipline, and
works for both full-copy and appended installs. The check also verifies
existence, executability, and block syntax (`bash -n` on the extracted block
only). It prints exact remediation commands. Exit 0 = current, exit 1 =
missing, not executable, or outdated.

FR-007's setup and verification steps invoke this checker; the older
marker-only grep is removed.

#### FR-011 — Outside-block staleness gate
FR-010's hash deliberately ignores content **outside** the markers, because an
appended install must tolerate arbitrary pre-existing hooks. That tolerance
admits one failure: a hook carrying a stale pre-marker copy of the attribution
logic reports CURRENT, and because the stale copy runs first and writes its own
less-complete trailer, the current block's dedupe check then skips — silently
dropping the model detail.

`check-hook.sh` therefore scans non-comment lines outside the marker block for
`Generated-By`. Any hit is OUTDATED/1, naming the offending line and giving
fresh-install remediation. Comment-only prose mentions are ignored, so a
documented appended install does not false-positive.

### Compatibility

#### FR-012 — Bash 3.2+ compatibility, no new dependencies
The hook and wrapper run on macOS's default `/bin/bash` (3.2) and Linux bash
4/5: no associative arrays, no `${var,,}` lowercasing, no `mapfile`. No new
runtime dependencies.

## Non-Functional Requirements

- **NFR-001 (Safety)**: The hook must never fail or block a commit.
  Attribution is advisory; every non-fatal path exits 0.
- **NFR-002 (Performance)**: Hook overhead < 10 ms (pure env + grep checks).
- **NFR-003 (Determinism)**: Identical input env → identical trailer output,
  regardless of repo state, cwd, or git version.
- **NFR-004 (Maintainability)**: Detection logic lives in exactly two places —
  the shipped script and the SKILL.md appendable block — kept in parity by
  FR-010.
- **NFR-005 (Compatibility)**: Unrecognized harnesses with no signal are
  unaffected (no trailer, no warning) unless `OPENCODE_TERMINAL=1` is set
  (warning only).

## Acceptance Criteria

Binary — each either passes or does not.

**Detection**

- [ ] **AC-001**: `AI_AGENT=opencode git commit` → `Generated-By: opencode`
- [ ] **AC-002**: `AGENT=goose git commit` → `Generated-By: goose`
- [ ] **AC-003**: `CLAUDE_CODE=1 git commit` → `Generated-By: claude-code`
- [ ] **AC-004**: `OPENCODE_TERMINAL=1 git commit` (no claim) → no trailer,
      one stderr warning, exit 0
- [ ] **AC-005**: plain `git commit` (no vars) → no trailer, no output

**Agent name (FR-003)**

- [ ] **AC-006**: `AI_AGENT=custom-architect git commit` →
      `Generated-By: custom-architect`
- [ ] **AC-007**: `AI_AGENT=1 git commit` → `Generated-By: ai-agent` (boolean
      marker is not a name)
- [ ] **AC-008**: `CLAUDE_CODE=1 OPENCODE_AGENT=stale git commit` →
      `Generated-By: claude-code` (stale var scoped out)
- [ ] **AC-009**: `AI_AGENT=goose git commit` → `Generated-By: goose`, **not**
      `ai-agent` (non-boolean value is the name)

**Model and precedence (FR-004, FR-005)**

- [ ] **AC-010**: `AI_AGENT=opencode OPENCODE_AGENT=my-agent OPENCODE_MODEL=my-model`
      → `Generated-By: my-agent (model: my-model)`
- [ ] **AC-011**: `AI_AGENT=my-agent git commit` → `Generated-By: my-agent`
- [ ] **AC-012**: `AI_AGENT=opencode OPENCODE_MODEL=my-model` →
      `Generated-By: opencode (model: my-model)` (agent unknown, model known)
- [ ] **AC-013**: bare `ANTHROPIC_MODEL=claude-opus-4-6 git commit`, no harness
      marker → no trailer
- [ ] **AC-014**: `CLAUDE_CODE=1 ANTHROPIC_MODEL=claude-opus-4-6 git commit` →
      `Generated-By: claude-code (model: claude-opus-4-6)`; identical result via
      `CLAUDE_CODE_ENTRYPOINT`

**Commit safety (FR-006)**

- [ ] **AC-015**: existing `Generated-By:` trailer + claim env → no duplicate
- [ ] **AC-016**: `merge`/`squash` sources → no trailer regardless of env

**Install currency (FR-010, FR-011)**

- [ ] **AC-017**: full-copy install → `CURRENT` / exit 0
- [ ] **AC-018**: attribution block tampered → `OUTDATED` / exit 1
- [ ] **AC-019**: hook missing → `OUTDATED` / exit 1
- [ ] **AC-020**: current block appended into a pre-existing hook →
      `CURRENT` / exit 0
- [ ] **AC-021**: stale pre-marker attribution code + current block →
      `OUTDATED` / exit 1, naming the stale logic
- [ ] **AC-022**: appended install mentioning `Generated-By` only in a comment →
      `CURRENT` / exit 0

**Interface, docs, syntax (FR-007–FR-009, FR-012)**

- [ ] **AC-023**: `git-agent-commit` produces byte-identical trailer output to
      the equivalent inline env invocation
- [ ] **AC-024**: no documentation claims OpenCode v2 (or "frameworks"
      generally) set `OPENCODE`/`AGENT` automatically; SKILL.md states OpenCode
      v2 sets only `OPENCODE_TERMINAL`
- [ ] **AC-025**: `bash -n` passes on the hook, wrapper, and test script; no
      bash 4+ syntax in any shipped script
- [ ] **AC-026**: the `ai-attribution` skill's Git Commits surface lists the
      full FR-001 matrix and no longer describes detection as `OPENCODE=1` /
      `AGENT=1` only; the manual trailer-append fallback is still documented

## Edge Cases

| Scenario | Expected behavior |
|---|---|
| Human commits inside the OpenCode TUI terminal (`OPENCODE_TERMINAL=1`, no claim) | Warning shown, no trailer (FR-002) |
| Amend of an AI commit | Existing trailer detected → no change (FR-006) |
| Amend of a human commit with claim env set | Trailer appended — the claimed agent authored the amendment |
| `OPENCODE_AGENT` set but no other detection var | `OPENCODE_AGENT` is itself an FR-001 signal → attributed as `opencode` |
| `OPENCODE_AGENT` set under a *non-opencode* harness | Ignored, harness-scoped (FR-003, AC-008) |
| `ANTHROPIC_MODEL` set in a plain human shell | Not a marker → no trailer (FR-004, AC-013) |
| Empty/absent commit-message file argument | Hook guards with `${1:-}`, exits 0 (NFR-001) |
| Bash 3.2 (macOS) | All scripts avoid bash 4+ syntax (FR-012) |

## Out of Scope

Excluded from this feature. Reasoning for each exclusion is recorded in
[changelog.md](changelog.md); the alternatives considered more widely are in
[plan.md](plan.md).

- An OpenCode v2 plugin that injects env into the shell tool
- An upstream feature request for `anomalyco/opencode` to set an AI marker on
  tool-only ptys
- Repo policy gate / CI enforcement (optional enhancement; the `ai-attribution`
  skill already ships a CI-check reference)
- Shell-profile kind detection
- Process-tree detection