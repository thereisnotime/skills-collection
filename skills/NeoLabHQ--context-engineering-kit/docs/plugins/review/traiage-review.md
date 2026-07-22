# traiage-review - Change Review Prioritization

Use when a changeset is too large to review in full and you need to prioritize which files deserve limited human attention.

- Purpose - Build a prioritized shortlist of the files most likely to cause a review to fail
- Output - A report with Key Facts, a Key Files table, a Random Sample, and Declarative Files

## What It Does

Human review time is limited and a reviewer cannot inspect every changed file. Instead of trying to find every issue, this skill builds an exhaustive shortlist of the files from the whole pool of changes that are most likely to cause the change to fail review.

An orchestrator agent launches four specialized triage agents in parallel, each building its own list of key files from a different perspective. The orchestrator then aggregates those lists (top files per agent, up to 20) and runs a random-sample step, producing a final prioritized report. 

## Review Modes

The orchestrator determines the review mode before launching any agents, checking in this order:

- **commit** - reviews the diff introduced by a single commit, not the whole changeset. Triggered by passing `commit <commit-hash>` (reviews that specific commit) or `commit` / `latest commit` with no hash (the orchestrator resolves HEAD to a concrete commit hash via `git rev-parse HEAD` and reviews that). This takes precedence over the other two modes.
- **branch diff** - review changes between the current branch and the detected default branch (`origin/main` or `origin/master`). Triggered explicitly by passing `branch`, or automatically when there are no local changes and the current branch is not the default branch.
- **local changes** - review staged, unstaged, and untracked changes. The default behavior when local changes exist and no other mode was requested.

## Usage

| Invocation | Mode | What it reviews |
|------------|------|------------------|
| `/traiage-review` | local changes (default) | Staged, unstaged, and untracked changes in the working tree |
| `/traiage-review branch` | branch diff | Current branch vs. the detected default branch (`origin/main` or `origin/master`) |
| `/traiage-review commit <commit-hash>` | commit | The diff introduced by that specific commit only |
| `/traiage-review commit` | commit | The diff introduced by the latest commit (HEAD) |
| `/traiage-review latest commit` | commit | The diff introduced by the latest commit (HEAD) - same as `commit` with no hash |

For the commit mode's two no-hash forms (`commit` and `latest commit`), the orchestrator resolves the latest commit to a concrete hash with `git rev-parse HEAD` before doing anything else, then treats it exactly like an explicitly given hash - every agent and the random-sample step receive that resolved concrete hash. The reviewed diff is the diff introduced by that single commit (equivalent to `git show <commit-hash>` or `git diff <commit-hash>^!`), not the cumulative diff up to that commit.

## Triage Agents

The four agents run in parallel, each receiving the mode-appropriate prompt (local-changes, branch-diff, or commit):

| Agent | Focus |
|-------|-------|
| change-story-agent | Builds the change "story" - intent, architecture change, design decisions, risks, and solutions - plus key facts, and picks the top files needed to understand the change |
| change-impact-agent | Rates files by blast radius, impact, exposure, and uncertainty (indirect and side effects weigh more than direct impact) |
| change-failure-agent | Rates files by failure severity and detectability, prioritizing high-severity, low-detectability files |
| change-expectation-agent | Flags files sensitive to misunderstood requirements or irreversible side effects, and lists declarative files (API specs, ORM models, types, config) |

## Aggregation

1. Each agent returns its own key-files list with ratings and confidence.
2. The orchestrator picks the top files from each agent, favoring files scored highly across criteria with sufficient confidence, until the list reaches 20 files (declarative files excluded at this stage).
3. A Python script picks up random files from the whole changeset (mode-appropriate); the orchestrator adds 5 logic-related files from that sample to the final list.
4. The orchestrator reports the final list with key facts, the random sample, and the declarative files.

## Output Format

```md
### Key Facts

- What change trying to achieve: <if any>
- Architecture change: <if any>
- Design decisions: <if any>
- Risks: <if any>
- Solutions: <if any>

### Key Files

| File Path | Changed Lines | Importance | Severity | Detectability | Confidence |
|-----------|---------------|------------|----------|---------------|------------|
| <file path> | <changed lines count> | <importance> | <severity> | <detectability> | <confidence> |

### Random Sample

| File Path | Changed Lines |
|-----------|---------------|
| <file path> | <changed lines count> |

### Declarative Files

| File Path | Changed Lines |
|-----------|---------------|
| <file path> | <changed lines count> |
```
