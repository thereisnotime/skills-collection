# Commit Attribution: Hook Setup, Detection, and Verification

Moved out of `SKILL.md` so the always-loaded skill stays short. Load this when
installing or checking the `prepare-commit-msg` hook, or when a commit was not
attributed as expected.

### How It Works

A `prepare-commit-msg` hook appends the trailer when the commit environment
identifies an AI session. Detection is layered — auto-detect, explicit claim,
visible silence:

1. **Auto-detect** — harnesses that set an environment marker on their
   subprocesses are recognized from the signal matrix below.
2. **Explicit claim** — OpenCode v2 sets no marker; its agents claim the
   commit via `git-agent-commit` or inline `AI_AGENT=opencode git commit ...`.
3. **Visible silence** — an OpenCode session with no claim (agent forgot, or
   a human in the TUI terminal) is never misattributed; the hook prints a
   stderr warning instead of failing silently.

**Richer attribution** is resolved cross-harness (details:
[attribution-detection.md](attribution-detection.md)):

- **Agent name** — `OPENCODE_AGENT` (opencode) or the `AI_AGENT`/`AGENT`
  value itself (per agents.md#136 the value is the agent name: `goose`,
  `amp`, `custom-architect`, ...). Boolean markers (`1`/`true`) and the
  canonical `opencode` value fall back to the harness name.
- **Model** — `OPENCODE_MODEL` (opencode) or `ANTHROPIC_MODEL`
  (claude-code, when Claude Code exports it). Other harnesses expose no
  model var today, and a model var alone never triggers attribution.

## Detection (Signal Matrix)

The hook treats the session as AI when **any** of these env vars is set to a
non-empty value (not just `1`):

`AI_AGENT`, `AGENT` (any value — `goose`/`amp` and other names become the
agent name), `OPENCODE`, `OPENCODE_CLIENT`, `CLAUDE_CODE`, `CLAUDE_CODE_ENTRYPOINT`,
`CURSOR_AGENT`, `GEMINI_CLI`, `CODEX_SANDBOX`, `AUGMENT_AGENT`,
`CLINE_ACTIVE`, `OPENCODE_AGENT`, `OPENCODE_MODEL`.

`OPENCODE_TERMINAL` is **never** a detection signal (see below). The full
per-harness table and notes live in
[attribution-detection.md](attribution-detection.md).

## OpenCode v2: Claim Your Commits

OpenCode v2 (anomalyco/opencode) sets no AI-session marker — only
`OPENCODE_TERMINAL=1`, on agent tool shells AND the human TUI terminal — and
each `shell` call spawns a fresh login shell, so session-start exports do
not persist. Claim each commit explicitly (full reasoning:
[attribution-detection.md](attribution-detection.md)):

```bash
git-agent-commit -m "feat: add widget"              # Generated-By: opencode
OPENCODE_AGENT="my-agent" OPENCODE_MODEL="my-model" \
  git-agent-commit -m "feat: add widget"            # Generated-By: my-agent (model: my-model)
# identical inline form:
AI_AGENT=opencode OPENCODE_AGENT="my-agent" OPENCODE_MODEL="my-model" \
  git commit -m "feat: add widget"
```

`git-agent-commit` ships in this skill's `scripts/` directory; copy it onto
your PATH once per machine:

```bash
cp .agents/skills/git-safety/scripts/git-agent-commit ~/.local/bin/
chmod +x ~/.local/bin/git-agent-commit
```

Trailer defaults: no agent name → harness name (e.g. `opencode`); agent name
only → agent name; model only → `<harness> (model: <model>)`; both →
`<agent> (model: <model>)`. For other harnesses, `CLAUDE_CODE=1
ANTHROPIC_MODEL=...` yields `Generated-By: claude-code (model: ...)` when
Claude Code exports the model.

## Session Setup

At the start of every session where you may make git commits, perform these
steps **once**. Do not repeat them on every commit.

### Step 1: Ensure Hook Exists and Is Current

First, resolve the hook directory. Git uses `core.hooksPath` when set (e.g.,
Husky sets it to `.husky/_/`). When unset, ask git for the default — never
hardcode `.git/hooks`, because in a linked worktree `.git` is a *file*
pointing at the parent repo, not a directory:

```bash
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-$(git rev-parse --git-path hooks 2>/dev/null || echo .git/hooks)}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"
```

> **Note**: Hook directories are not tracked by git. The hook must be
> installed per-repo. If you clone the repo fresh, you'll need to run this
> step again. Hooks are **shared across linked worktrees** — git resolves
> them from the parent repo, so one install covers every worktree (and a
> worktree's own `.git/hooks` path does not exist).

Verify the hook is installed **and current** — the bundled checker compares
the installed hook's attribution block byte-for-byte against the shipped
script (content hash, so any drift is caught):

```bash
bash .agents/skills/git-safety/scripts/check-hook.sh
```

Output: `CURRENT` (exit 0) when the installed block matches the shipped
script; `OUTDATED` (exit 1) with exact remediation commands when the hook is
missing, not executable, its attribution block differs (e.g. after a
skill update), or stale attribution logic sits outside the block — a
hybrid install where the stale copy runs first and wins. The checker
covers both install modes below.

**Common hook managers and their paths:**

| Tool | `core.hooksPath` | Hook directory |
|------|------------------|----------------|
| Git (default) | unset | `.git/hooks/` |
| Husky v9 | `.husky/_/` | `.husky/_/` |
| Lefthook | unset (uses `.git/hooks/`) | `.git/hooks/` |
| simple-git-hooks | respects existing | wherever `core.hooksPath` points |

**If missing**, copy the hook from your agent framework's skill directory:

```bash
# Example path — adjust to your framework's skill location
cp .agents/skills/git-safety/scripts/prepare-commit-msg "$HOOK_PATH"
chmod +x "$HOOK_PATH"
```

**If `check-hook.sh` reports OUTDATED**, update the hook — it prints the
exact commands. The update paths mirror the install modes below (the shipped
script's attribution block is the single source of truth, no copy-paste
divergence):

```bash
sed -n '/^# --- AI Commit Attribution/,/^# --- end AI Commit Attribution/p' \
  .agents/skills/git-safety/scripts/prepare-commit-msg >> "$HOOK_PATH"
```

The extracted block is self-contained: it reads `$1`/`$2` (message file and
commit source), skips merge/squash, applies the detection matrix, and appends
the trailer or emits the unclaimed-session warning. Verify the result:

```bash
bash -n "$HOOK_PATH" && echo "hook syntax OK"
```

## Mixed Environments (AI + Human Commits)

Humans never need to opt out — the hook only attributes when an agent marker
or explicit claim is present, and `OPENCODE_TERMINAL` alone never
misattributes a human commit. Scenario → behavior matrix:
[attribution-detection.md](attribution-detection.md).

## Verification

After setup, verify the hook is installed:

```bash
# Resolve hook path (same as setup)
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-$(git rev-parse --git-path hooks 2>/dev/null || echo .git/hooks)}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"

# Check hook exists and is executable
ls -la "$HOOK_PATH"

# Check hook exists and is current (attribution block hash matches shipped)
bash .agents/skills/git-safety/scripts/check-hook.sh

# Check claim vars are set (in agent session)
echo "AI_AGENT=${AI_AGENT:-unset} OPENCODE_AGENT=${OPENCODE_AGENT:-unset} OPENCODE_MODEL=${OPENCODE_MODEL:-unset}"
```

Run the skill's functional tests (detection matrix, cross-harness
agent/model attribution, hook install-currency smoke tests,
hybrid-install detection, and linked-worktree hook resolution — 28 cases):

```bash
bash .agents/skills/git-safety/scripts/test-prepare-commit-msg.sh
```

## Uninstall

To remove AI attribution from a repo:

```bash
# Resolve hook path
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-$(git rev-parse --git-path hooks 2>/dev/null || echo .git/hooks)}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"

# Remove the hook (only if it was installed by this skill)
rm -f "$HOOK_PATH"
```

If the hook was appended to an existing hook (not installed fresh), you'll
need to manually remove the attribution block between the
`# --- AI Commit Attribution` markers.

## Parsing Attribution

Find AI-generated commits and unique agents/models — full commands, and why
they are shaped that way, in
[attribution-detection.md](attribution-detection.md).
The essentials (git's trailer parser, not a message grep):

```bash
# hash <TAB> attribution <TAB> subject — attributed commits only
git log --format='%h%x09%(trailers:key=Generated-By,valueonly,separator=)%x09%s' | awk -F'\t' '$2 != ""'
```

