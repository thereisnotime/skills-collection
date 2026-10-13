---
name: git-safety
description: Enforces safe git practices for AI coding agents. Defines branch protection rules, commit policies, amend rules, and force-push boundaries. Load this skill at the start of any session where the agent may run git commands — especially before committing, branching, pushing, or resetting. Prevents accidental commits to protected branches (main, master, develop), history rewrites, and other irreversible operations.
license: MIT
metadata:
  author: shaunburdick
  version: "1.7.0"
---

# Git Safety

A set of non-negotiable rules for safe git operations in AI-assisted development. These rules exist to prevent accidental history rewrites, force-pushes to protected branches, and other irreversible operations.

## Branch Protection Policy

**Protected branches** (never commit, switch to, or merge directly):
- `main`
- `master`
- `develop`

**Allowed branches** (safe to commit on):
- Feature branches: `001-feature-name`, `feature/*`
- Fix branches: `fix/*`, `bugfix/*`
- Any other non-protected branch

## Commit Rules

- ❌ **NEVER** commit to `main`, `master`, or `develop`
- ❌ **NEVER** switch to `main`, `master`, or `develop`
- ❌ **NEVER** run `git push --force` or `git push -f` unless the user explicitly requests it — and warn them if targeting a protected branch
- ❌ **NEVER** run `git rebase -i` or other interactive commands (requires interactive input)
- ❌ **NEVER** run `git reset --hard` without explicit user confirmation
- ❌ **NEVER** skip hooks with `--no-verify` or `--no-gpg-sign` unless the user explicitly requests it
- ✅ **ALWAYS** check the current branch before committing: `git branch --show-current`
- ✅ **OK** to ask the user before committing if you're unsure about the branch
- ✅ **OK** to amend the most recent commit **only when ALL conditions are met**:
  1. User explicitly requested amend, OR the commit succeeded but a pre-commit hook auto-modified files that need including
  2. The HEAD commit was created by you in this conversation (verify: `git log -1 --format='%an %ae'`)
  3. The commit has NOT been pushed to remote (verify: `git status` shows "Your branch is ahead")

## Agent Permission Configuration

When authoring an agent definition, enforce branch protection at the tool
level rather than in prose; the frontmatter block is in
[references/agent-permissions.md](references/agent-permissions.md).

## Pre-Commit Branch Check

Before every commit, run:

```bash
git branch --show-current
```

If the output is `main`, `master`, or `develop` — **stop**. Create or switch to a feature branch first:

```bash
git checkout -b 001-my-feature
```

## Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <short description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`

Examples:
- `feat: add user authentication endpoint`
- `fix: resolve null pointer in payment processor`
- `docs: update API contract for order service`


## PR and Commit Preflights

Run the preflight gates that apply to the operation you are about to
perform. Each is a binary continue/stop check; a stopped check blocks the
operation until resolved or escalated. **MUST READ**:
[references/preflight-checks.md](references/preflight-checks.md) — read it
before the first git mutation of a session; it carries the
operation → checks table (a first commit on a fresh branch runs 1 and 2
only).

Quick reference — scope in brackets:

1. `git status --porcelain` — clean, or staged changes only `[all]`
2. `git branch --show-current` — not `main`/`master`/`develop` `[all]`
3. `git rev-parse --verify HEAD` + `git ls-remote --heads origin <branch>`
   `[push/sync/PR]`
4. `git rev-list --left-right --count HEAD...@{upstream}` — never behind
   `[push/sync/PR]`
5. `git merge-base --is-ancestor main HEAD` — ≥ 1 commit past base `[PR]`
6. Unpublished branch → no `gh pr create` until user-approved push `[PR]`
7. No commits past base → no `gh pr create` `[PR]`

Stopped preflights are recorded in the Preflight Result Format (see the
reference) and preserved in handoffs for traceability.

## Permission Denials, Escalation, and Secrets

When a git operation is denied, report the exact operation, denial source,
failure evidence, and context; recommend a safe alternative; request explicit
approval; record the decision; escalate rather than work around.
**MUST READ**: [references/permission-denied-reporting.md](references/permission-denied-reporting.md) — the full rules, valid/failure
examples, the Prohibition on Bypasses, and the Secret and Encrypted-File
Boundary.

Non-negotiables (full detail in the reference):
- ❌ NEVER bypass a denial: no `--no-verify`, no `--force-with-lease`, no
  `git -c core.hooksPath=/dev/null`, no env overrides to dodge auth prompts,
  no remote-URL rewrites, no git-crypt boundary crossings
- ❌ NEVER read, print, or decrypt `.gitconfig.secret`, `.gnupg/`, or any
  `filter=git-crypt` file — reference them by path only
- ✅ ALWAYS check `.gitattributes` for `git-crypt` entries before reading files

## AI Commit Attribution

All commits made by AI agents MUST include a `Generated-By` trailer to
transparently attribute AI-generated code. This follows the Apache Software
Foundation's `Generated-by` convention and aligns with EU AI Act Article 50
disclosure requirements. For attribution on PRs, comments, and issues, see
the [ai-attribution](../ai-attribution/) skill.

### Format

```
Generated-By: <agent-name> (model: <model-name>)
```

Use the exact agent name and model ID from your system prompt. The `Author:`
field contains the human operator — the `Generated-By:` trailer is for the
AI agent only.

### Claim your commits

A `prepare-commit-msg` hook appends the trailer when the session is detectably
an AI session (`CLAUDE_CODE*`, `CURSOR_AGENT`, `GEMINI_CLI`, `AI_AGENT`, and
others) or claimed explicitly. OpenCode v2 sets no marker, so its agents claim
each commit:

```bash
git-agent-commit -m "feat: add widget"                       # Generated-By: opencode
OPENCODE_AGENT="my-agent" OPENCODE_MODEL="m" git-agent-commit -m "..."   # with agent and model
```

Once per session, check the hook is installed and current:

```bash
bash .agents/skills/git-safety/scripts/check-hook.sh
```

Install, update, detection matrix, mixed human/AI environments, uninstall and
parsing: [references/commit-attribution.md](references/commit-attribution.md).

## References

- **[references/commit-attribution.md](references/commit-attribution.md)**: Hook install and update, session setup, verification, uninstall.
- **[references/agent-permissions.md](references/agent-permissions.md)**: Frontmatter permission block for agent definitions.
- **[references/attribution-detection.md](references/attribution-detection.md)**: Full detection matrix, OpenCode v2 environment reality, and parsing commands.
- **[references/preflight-checks.md](references/preflight-checks.md)**: The operation-scoped preflight gates — MUST read before the first git mutation of a session.
- **[references/permission-denied-reporting.md](references/permission-denied-reporting.md)**: Denial reporting, escalation, and the Secret and Encrypted-File Boundary.

## Related Skills

- **[ai-attribution](../ai-attribution/)**: Covers AI attribution footers for PR bodies, comments, and issues — surfaces beyond what this skill's commit hook handles.
