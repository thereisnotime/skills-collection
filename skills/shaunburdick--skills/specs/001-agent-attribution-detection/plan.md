# Plan: Agent Attribution Detection for OpenCode v2 + Cross-Harness

## Constitution Alignment

Constitution source: `AGENTS.md` (this repo has no `.specify/` scaffolding —
see spec, Clarifications Applied).

- **Editing rules**: only edit repo copies under `skills/`; never
  `~/.agents/skills/`. ✅ — all changes touch `skills/git-safety/`,
  `skills/ai-attribution/`, and new `specs/` artifacts.
- **Skill dir naming**: lowercase + hyphens. ✅ — `git-agent-commit`,
  `test-prepare-commit-msg.sh` under existing `skills/git-safety/scripts/`.
- **SKILL.md discipline**: keep focused (< 500 lines); move detail to
  `references/` when it grows. The rewritten Attribution section stays
  self-contained (the matrix is small); no new reference files needed.
- **Code quality** (`code-quality` skill): no suppressions, verified before
  commit. The scripts are bash — verified via `bash -n`, shellcheck (if
  present), and a functional test harness.

## Architecture Overview

Three artifacts change, one is added, and docs follow:

```
skills/git-safety/
├── SKILL.md                          # Rewritten Attribution section (v1.2.0)
└── scripts/
    ├── prepare-commit-msg            # Rewritten: matrix + warn (FR-001..004, 008)
    ├── git-agent-commit              # NEW: claim-wrapper for OpenCode v2 (FR-006)
    └── test-prepare-commit-msg.sh    # NEW: functional test harness (T-003)
skills/ai-attribution/
└── SKILL.md                          # Detection references updated (v1.1.0)
specs/001-agent-attribution-detection/
└── spec.md, plan.md, tasks.md        # This feature's SDD artifacts
```

### Detection model

The hook moves from "the framework tells us" to "we recognize the framework,
and OpenCode v2 agents claim explicitly":

**Tier 1 — auto-detect (harnesses that self-identify):**
`AI_AGENT`, `AGENT` (any value), `OPENCODE`, `OPENCODE_CLIENT`,
`CLAUDE_CODE`, `CLAUDE_CODE_ENTRYPOINT`, `CURSOR_AGENT`, `GEMINI_CLI`,
`CODEX_SANDBOX`, `AUGMENT_AGENT`, `CLINE_ACTIVE`, plus `OPENCODE_AGENT` /
`OPENCODE_MODEL` (an explicit claim alone is sufficient).

**Tier 2 — explicit claim (OpenCode v2):**
The agent commits via `git-agent-commit ...` (or inline env
`AI_AGENT=opencode OPENCODE_AGENT=... OPENCODE_MODEL=... git commit ...`).
Env is set on the same command line because OpenCode v2 bash tool calls spawn
a fresh login shell per invocation — session-start exports do not persist.

**Tier 3 — visible silence:**
Detected signals: `OPENCODE_TERMINAL=1` (OpenCode v2 pty, agent shell or
human TUI terminal) with no Tier-1 match → stderr warning, no trailer, exit
0. This converts the historical silent failure into a visible one without
ever misattributing a human commit.

### Hook design (bash 3.2 compatible)

```bash
detect_harness()   # echoes a harness name or empty string; pure env checks
build_attribution  # OPENCODE_AGENT/MODEL → rich form; else harness name
```

- Source gate: `merge|squash` → exit 0 (unchanged).
- Trailer gate: `grep -q '^Generated-By:'` → exit 0 (unchanged, amend-safe).
- Warning gate: `OPENCODE_TERMINAL=1` && harness empty → stderr warning.

Default harness names (FR-003): `ai-agent` (bare `AI_AGENT`), `agent` (bare
`AGENT`), `opencode`, `claude-code`, `cursor`, `gemini-cli`, `codex`,
`augment`, `cline`, `goose`, `amp`.

### `git-agent-commit` wrapper

```bash
#!/usr/bin/env bash
export AI_AGENT="${AI_AGENT:-opencode}"
exec git commit "$@"
```

`OPENCODE_AGENT`/`OPENCODE_MODEL` pass through from the caller's env. The
wrapper exists so agents have one canonical, memorable command; the inline
env form remains valid and documented.

### Test harness (T-003)

`test-prepare-commit-msg.sh`: creates a temp repo (`mktemp -d`), installs the
shipped hook as `prepare-commit-msg`, runs the AC matrix (AC-1..AC-9) by
invoking `git commit` under controlled env, strips the trailer and asserts
via `git log --format=%B`, then cleans up. Prints `PASS`/`FAIL` per case;
exits nonzero on any failure. Uses only bash builtins + coreutils.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Detection basis | Env-var matrix, not process-tree | Process tree false-positives on the OpenCode TUI terminal (Design D rejected) |
| OpenCode v2 path | Explicit claim (wrapper/inline env) | v2 provides no signal; plugin (Design B) spiked and upstream (Design C) tracked — spike verdict: v2.0.15 supports `ctx.shell.hook("create.before")` env injection, dev removes it; not shippable today |
| Signal values | Non-empty, not `== "1"` | Goose/Amp set `AGENT=goose`/`AGENT=amp`; fixes a live bug |
| Failure mode | Warn (stderr), never block | Attribution advisory; human TUI-terminal commits get a benign notice |
| Default trailer | Harness name when unclaimed identity | Richer attribution than the old blanket `opencode` |
| Agent name (A2) | Claim values as names; `OPENCODE_AGENT` scoped to opencode | agents.md#136 says the `AI_AGENT`/`AGENT` value IS the agent name; scoping kills stale-`OPENCODE_AGENT` misattribute |
| Model (A2) | Harness-scoped: `OPENCODE_MODEL`, `ANTHROPIC_MODEL` only | Only vars confirmed exported to tool envs; a bare model var is never a marker (AC-14) |
| Hook currency (A3) | Block-hash comparison (`check-hook.sh`) | Version strings only catch bumps you remember; a content hash catches any byte drift, and the expected hash is derived from the shipped block so it can't go stale (`git hash-object` = portable, zero deps) |
| Bash floor | 3.2 (macOS default) | No associative arrays, no `${var,,}`, no `mapfile` |
| Parity | Script + SKILL.md appendable block | Both carry the same logic; SKILL.md verification checks the block matches |
| Versioning | git-safety 1.1.0→1.2.0, ai-attribution 1.0.0→1.1.0 | Semver across the skill docs |

## Risks

- **Warning fatigue** for humans committing inside the OpenCode TUI terminal:
  accepted; the message is instructive and the alternative (silence) is the
  bug we are fixing.
- **Matrix drift** as harnesses add/change vars: mitigated by the `AI_AGENT`
  standard direction and by documenting the matrix in one table both skills
  reference.
- **Bash 3.2 quirks**: `local`-scoped vars are fine; `${var:-}` fine; avoid
  `declare -A`, `${!prefix*}`, `[[ =~ ]]` with complex patterns. The test
  harness runs on this repo's bash 5.x and is written defensively.

## Verification Plan

1. `bash -n` on all three scripts.
2. shellcheck (if installed) on all three scripts — zero errors.
3. `test-prepare-commit-msg.sh` — AC-1..AC-9 green.
4. Manual edge spot-checks: AC-6 (dedupe), AC-7 (merge source), warning text.
5. `grep` the SKILL.md docs for stale claims (`OPENCODE=1`, "set
   automatically") — zero hits outside the historical-accuracy note.