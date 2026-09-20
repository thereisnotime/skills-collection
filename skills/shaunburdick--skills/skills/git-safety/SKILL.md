---
name: git-safety
description: Enforces safe git practices for AI coding agents. Defines branch protection rules, commit policies, amend rules, and force-push boundaries. Load this skill at the start of any session where the agent may run git commands — especially before committing, branching, pushing, or resetting. Prevents accidental commits to protected branches (main, master, develop), history rewrites, and other irreversible operations.
license: MIT
metadata:
  author: shaunburdick
  version: "1.1.0"
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

If you are authoring an agent definition (e.g., an OpenCode `.md` agent file), add these permissions to the YAML frontmatter to enforce branch protection at the tool level — blocking dangerous commands before they can run:

```yaml
permission:
  bash:
    "git commit *": ask
    "git push": deny
    "git push *": deny
    "git merge": deny
    "git merge *": deny
    "git checkout main": deny
    "git checkout master": deny
    "git checkout develop": deny
    "git switch main": deny
    "git switch master": deny
    "git switch develop": deny
```

> Note: These permissions are set by the human author in the agent definition file — a running agent cannot modify its own permissions. This section is a reference for when you're helping set up or review an agent configuration.

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

Before any commit, push, synchronization, or pull-request creation, run the
following preflight checks in order. Each check has a binary continue/stop
outcome. If any check stops, do not proceed to the next — resolve or escalate
the blocker first.

### 1. Working-Tree Status Check

Verify the working tree is clean or appropriately staged:

```bash
git status --porcelain
```

- **Valid case**: Output is empty (clean tree) or shows only staged changes
  relevant to the current task. **Continue**.
- **Failure case**: Output shows unstaged or untracked changes unrelated to the
  current task. **Stop** — the working tree is dirty and may include unintended
  modifications.
- **Next action**: Ask the user whether to stash, commit, or discard the
  unrelated changes before proceeding. Never auto-reset or auto-stash without
  explicit user confirmation.

### 2. Protected-Branch Check

Verify the current branch is not a protected branch:

```bash
git branch --show-current
```

- **Valid case**: Output is a feature, fix, or other non-protected branch name
  (e.g., `001-feature-name`). **Continue**.
- **Failure case**: Output is `main`, `master`, or `develop`. **Stop** — do not
  commit, push, or create a PR from a protected branch.
- **Next action**: Create or switch to a feature branch:
  `git checkout -b 001-my-feature`. If the user intended to work on a protected
  branch, escalate for explicit approval.

### 3. Local and Remote Branch Presence Check

Verify the current branch exists both locally and on the remote:

```bash
# Local branch
git rev-parse --verify HEAD

# Remote branch (replace origin with the actual remote)
git ls-remote --heads origin "$(git branch --show-current)"
```

- **Valid case**: Both commands return a commit SHA. The branch exists locally
  and on the remote. **Continue**.
- **Failure case**: `git ls-remote` returns empty — the branch has no remote
  counterpart. **Stop** — the branch is unpublished.
- **Next action**: Inform the user that PR creation requires a published branch.
  Request an explicit user-approved push: `git push -u origin
  $(git branch --show-current)`. Do not push without user confirmation.

### 4. Local-vs-Remote Divergence Check

Verify the local branch is not diverged from its remote tracking branch:

```bash
git rev-list --left-right --count HEAD...@{upstream}
```

- **Valid case**: Output is `0 0` (in sync) or only ahead counts are nonzero
  (local commits not yet pushed). **Continue**.
- **Failure case**: The behind count is nonzero — the remote has commits the
  local branch does not. **Stop** — the branch is diverged and a PR would
  exclude upstream changes or create merge conflicts.
- **Next action**: Advise the user to pull or rebase:
  `git pull --rebase origin $(git branch --show-current)`. If rebase is
  complex or involves conflicts, escalate to the user rather than resolving
  automatically.

### 5. Relative-to-Base Check

Verify the branch has at least one commit relative to its merge base:

```bash
git merge-base --is-ancestor main HEAD && echo "based on main" || echo "not based"
git rev-list --count main..HEAD
```

(Replace `main` with the actual base branch for this repository.)

- **Valid case**: The count is ≥ 1 — the branch has commits beyond the base.
  **Continue**.
- **Failure case**: The count is 0 — the branch has no commits relative to its
  base. **Stop** — there is nothing to include in a PR.
- **Next action**: Inform the user that the branch has no changes relative to
  the base. Either make the intended commits or close the branch.

### 6. Unpublished Branch Stop

A combined gate that stops PR creation when the branch cannot be published:

- **Condition**: No remote branch exists (check 3) OR no commits are visible
  to the remote (the remote branch points to the same commit as the base).
- **Stop**: Do not invoke `gh pr create` or any PR-creation workflow.
- **Next action**: Instruct the agent to obtain user-approved push or publish
  action before retrying PR creation. Record the preflight result with the
  exact missing condition.

### 7. No-Commit Stop

A combined gate that stops PR creation when there is nothing to review:

- **Condition**: Zero commits between the branch and its base (check 5 returns
  0), OR all commits are already merged into the base.
- **Stop**: Do not invoke `gh pr create`.
- **Next action**: Inform the user and either request the intended changes or
  close the branch. Record the preflight result with the commit count.

### Preflight Result Format

When a preflight stops, report the result as:

```
Preflight: [check name]
Status: stop
Branch: [branch name]
Evidence: [command output or observation]
Next action: [specific user-approved action required]
```

This record MUST be preserved in any orchestration handoff or verification
report for traceability.

## Permission-Denied Reporting and Escalation

When a git operation is denied by permissions, tool configuration, or
server-side policy, the agent MUST follow these rules without exception.

### Permission-Denied Reporting

When a permission-denied error is returned, report ALL of the following:

1. **Exact operation denied**: Name the full command that was blocked (e.g.,
   `git push origin 001-feature-name`).
2. **Denial source**: Identify whether the denial came from the platform
   permission matcher, a server-side hook, or a repository policy.
3. **Failure evidence**: Preserve the exact error message, exit code, and
   any stderr output. Do not paraphrase or truncate the evidence.
4. **Context**: Report the branch, remote, and any flags that were in use.

- **Valid case**: Agent receives a permission error and reports: "Operation
  `git push origin 001-feature-name` denied by platform permission matcher.
  Exit code: 128. Stderr: `remote: error: GH006: Protected branch update failed
  for refs/heads/main.` Evidence preserved." **Escalate to user.**
- **Failure case**: Agent receives a permission error and silently retries the
  same operation, or reports "push failed" without naming the command or
  preserving evidence. **Stop** — this hides the root cause.
- **Next action**: Present the exact operation, denial source, and evidence to
  the user with a recommended escalation path (e.g., "Request branch protection
  exception from the repository admin" or "Use an authorized remote").

### Prohibition on Bypasses

Agents MUST NOT attempt to circumvent a permission denial. The following
actions are explicitly prohibited when a permission error has occurred:

- ❌ **NEVER** use `--no-verify` to skip client-side hooks that enforced the
  denial.
- ❌ **NEVER** use `--force` or `--force-with-lease` to override a push
  rejection.
- ❌ **NEVER** use `git -c core.hooksPath=/dev/null` or any equivalent to
  disable hooks.
- ❌ **NEVER** use `GIT_TERMINAL_PROMPT=0` or other environment overrides to
  bypass authentication prompts.
- ❌ **NEVER** reconfigure the remote URL to bypass SSH or HTTPS policy.
- ❌ **NEVER** copy, move, or rename files to circumvent `.gitattributes`
  filters or git-crypt boundaries.

- **Valid case**: Agent receives `git push --no-verify` rejected. Agent
  reports the denial, does not retry with `-n`, and escalates to the user.
  **Escalate.**
- **Failure case**: Agent receives a denial and attempts `git push -n` as a
  workaround. **Stop** — this is a policy violation and MUST NOT occur.
- **Next action**: If the user explicitly requests a bypass after being informed
  of the risk, the user MUST provide informed consent documenting the specific
  bypass and its justification. The agent MUST record this consent in the
  session or handoff before proceeding.

### User Approval and Escalation Path

For any denied operation, follow this escalation sequence:

1. **Report** the denial with full evidence (see Permission-Denied Reporting).
2. **Recommend** a safe alternative (e.g., push to a non-protected branch,
   request a merge via PR, ask the repo admin for an exception).
3. **Request** explicit user approval for the recommended alternative. Do not
   proceed without a clear affirmative response.
4. **Record** the user's decision (approve, reject, or alternative) in the
   session or orchestration handoff for traceability.
5. **If the user rejects all alternatives**, stop the workflow and document
   the blocker. Do not invent workarounds.

- **Valid case**: Push to `main` is denied. Agent reports: "Push to `main`
  denied (protected branch). Recommended: push to `001-feature-name` and
  create a PR." User approves the PR path. Agent proceeds. **Continue.**
- **Failure case**: Push to `main` is denied. Agent silently pushes to a
  different branch without user approval, or attempts to force-push.
  **Stop** — this bypasses the escalation path.
- **Next action**: Present the recommendation, await user approval, and record
  the decision before any subsequent action.

### Secret and Encrypted-File Boundary

Agents MUST NOT access, expose, or modify secrets or encrypted content
during git operations. Specifically:

- ❌ **NEVER** read, print, or display the contents of `.gitconfig.secret`,
  `.gnupg/`, or any file with `filter=git-crypt` in `.gitattributes`.
- ❌ **NEVER** run `git show`, `git diff`, `git log -p`, or `cat` on these
  files.
- ❌ **NEVER** rewrite, relocate, or decrypt these files — even if requested
  by the user as part of a "cleanup" or "migration."
- ❌ **NEVER** include secret contents in orchestration handoffs, verification
  reports, or session transcripts.
- ✅ **ALWAYS** check `.gitattributes` for `git-crypt` entries before reading
  any file that might be encrypted.
- ✅ **ALWAYS** treat `git-crypt` encrypted files as opaque — reference them
  by path only, never by content.

- **Valid case**: Agent needs to verify `.gitattributes` entries. Agent runs
  `grep git-crypt .gitattributes` and reports the file paths that are
  encrypted, without reading or displaying their contents. **Continue.**
- **Failure case**: Agent runs `git show HEAD:.gitconfig.secret` to "verify
  the configuration" and prints the contents in a response or handoff.
  **Stop** — this is a security violation.
- **Next action**: If secret content is needed for a task, escalate to the
  user with the specific file path and purpose. The user must unlock and
  verify the content themselves; the agent MUST NOT handle it directly.

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

### How It Works

If your environment provides a `prepare-commit-msg` hook that detects AI
sessions (via env vars like `OPENCODE=1`, `AGENT=1`, or similar), the hook
appends the trailer automatically. If absent (human terminal commit), it
exits silently.

**Optional env vars for richer attribution** (set at session start):

```bash
export OPENCODE_AGENT="<your-agent-name>"
export OPENCODE_MODEL="<your-model-id>"
```

If not set, the hook defaults to `Generated-By: opencode`.

### Session-Start Setup

At the start of every session where you may make git commits, perform these
steps **once**. Do not repeat them on every commit.

#### Step 1: Set Attribution Env Vars (Optional)

For richer attribution, set these env vars with your agent name and model
from your system prompt:

```bash
export OPENCODE_AGENT="<your-agent-name>"
export OPENCODE_MODEL="<your-model-id>"
```

If you skip this step, the trailer uses a generic attribution.

#### Step 2: Ensure Hook Exists

First, resolve the hook directory. Git uses `core.hooksPath` when set (e.g.,
Husky sets it to `.husky/_/`). When unset, it defaults to `.git/hooks/`.

```bash
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-.git/hooks}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"
```

> **Note**: Hook directories are not tracked by git. The hook must be
> installed per-repo. If you clone the repo fresh, you'll need to run this
> step again.

Check if the hook exists at the resolved path:

```bash
test -f "$HOOK_PATH" && echo "exists" || echo "missing"
```

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

**If exists but missing attribution logic**, check for the marker:

```bash
grep -q "OPENCODE\|AGENT" "$HOOK_PATH" && echo "has attribution" || echo "needs update"
```

If it needs update, append the attribution block:

```bash
cat >> "$HOOK_PATH" << 'HOOK'

# --- AI Commit Attribution (added by git-safety skill) ---
commit_msg_file="${1:-}"
commit_source="${2:-}"
case "${commit_source}" in
  merge|squash) exit 0 ;;
esac
if [[ "${OPENCODE:-}" == "1" ]] || [[ "${AGENT:-}" == "1" ]]; then
  if ! grep -q "^Generated-By:" "$commit_msg_file"; then
    agent="${OPENCODE_AGENT:-}"
    model="${OPENCODE_MODEL:-}"
    if [[ -n "$agent" ]] && [[ -n "$model" ]]; then
      attr="${agent} (model: ${model})"
    elif [[ -n "$agent" ]]; then
      attr="$agent"
    else
      attr="opencode"
    fi
    printf "\nGenerated-By: %s\n" "$attr" >> "$commit_msg_file"
  fi
fi
# --- end AI Commit Attribution ---
HOOK
fi
```

### Mixed Environments (AI + Human Commits)

The hook is safe in mixed environments:

| Scenario | Detection env | Hook behavior |
|----------|---------------|---------------|
| Agent session | `OPENCODE=1` or `AGENT=1` | appends `Generated-By:` trailer |
| Human terminal | not set | exits immediately, no trailer |
| Agent with env vars | `1` + `OPENCODE_AGENT`/`OPENCODE_MODEL` | appends rich attribution |

Humans never need to opt out or take any action. The hook only activates
when the agent environment variable is set.

### Verification

After setup, verify the hook is installed:

```bash
# Resolve hook path (same as setup)
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-.git/hooks}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"

# Check hook exists and is executable
ls -la "$HOOK_PATH"

# Check hook contains attribution logic
grep -q "OPENCODE\|AGENT" "$HOOK_PATH" && echo "hook has attribution" || echo "hook needs update"

# Check env vars are set (in agent session)
echo "OPENCODE=${OPENCODE:-unset} OPENCODE_AGENT=${OPENCODE_AGENT:-unset} OPENCODE_MODEL=${OPENCODE_MODEL:-unset}"
```

### Uninstall

To remove AI attribution from a repo:

```bash
# Resolve hook path
HOOK_DIR=$(git config core.hooksPath 2>/dev/null || true)
HOOK_DIR="${HOOK_DIR:-.git/hooks}"
HOOK_PATH="${HOOK_DIR}/prepare-commit-msg"

# Remove the hook (only if it was installed by this skill)
rm -f "$HOOK_PATH"
```

If the hook was appended to an existing hook (not installed fresh), you'll
need to manually remove the attribution block between the
`# --- AI Commit Attribution` markers.

### Parsing Attribution

To find all AI-generated commits:

```bash
git log --trailer=Generated-By --oneline
```

To extract unique agents/models:

```bash
git log --format='%(trailers:valueonly,separator=%x2C,unfold,separator=%x2Ckey=Generated-By)' | sort | uniq -c | sort -rn
```

## Related Skills

- **[ai-attribution](../ai-attribution/)**: Covers AI attribution footers for PR bodies, comments, and issues — surfaces beyond what this skill's commit hook handles.
