# Plan: Release Tagging for Skill Consumers

## Constitution Alignment

Constitution source: `AGENTS.md` (this repo has no `.specify/` scaffolding,
same as the 001 feature).

- **Scope**: only repo files change; no installed copies under
  `~/.agents/skills/` are touched. ✅
- **Version rule**: every skill change already bumps `metadata.version`; the
  tag workflow reads that value and the guard enforces it. ✅
- **Skill content**: untouched. ✅
- **Quality**: `code-quality` — no suppressions; scripts pass `bash -n` and
  shellcheck when available. `github-actions` — pinned actions, least
  privilege, no untrusted interpolation. `git-safety` — no force-push, no
  protected-branch commit; work stays on `issue-33`.

## Technical Context

- Repo default branch: `main`. Today it has no tags, no releases, and no
  workflows.
- Nine skills under `skills/`, each with `metadata.version` in `SKILL.md`
  frontmatter (`1.0.0`–`2.9.2`).
- `actions/checkout` latest stable is v7.0.1; SHA
  `3d3c42e5aac5ba805825da76410c181273ba90b1`. `fetch-depth: 0` and
  `fetch-tags: true` give the diff base and existing tags.
- Verified: APM accepts `owner/repo/path#tag`; the `skills` CLI accepts a tag
  ref. No research.md needed.
- The workflow has no releases to generate, so no `gh` CLI dependency; git
  push with the checkout token creates tags.

## Architecture

```
.github/
├── workflows/tag-skills.yml     # trigger, permissions, checkout
├── scripts/tag-skills.sh        # guard + tag creation (testable locally)
└── dependabot.yml               # keeps the pinned checkout SHA current
specs/002-release-tagging/
├── spec.md
├── plan.md
└── tasks.md
```

### Workflow (`tag-skills.yml`)

- `name: Tag skill releases`
- `on.push.branches: [main]` with `paths: ['skills/**']`, plus
  `workflow_dispatch`.
- `permissions: contents: write` at workflow level (AC-011).
- `concurrency: { group: tag-skills, cancel-in-progress: false }` so two
  merges cannot race on the same tag names.
- One `ubuntu-latest` job: checkout at the pinned SHA with full history and
  tags, then run `tag-skills.sh` with `EVENT_NAME`, `BEFORE_SHA`, `AFTER_SHA`,
  and `DEFAULT_BRANCH` passed through `env:` (no `${{ }}` in `run:`).

### Script (`tag-skills.sh`)

`set -euo pipefail`; three parts:

1. **Version reader** — awk over the `metadata:` block in `SKILL.md`, so only
   that field is read, not the description or body.
2. **Guard (push only)** — diff `BEFORE_SHA..AFTER_SHA` for `skills/**`,
   derive the touched skill names, and compare each skill's version before
   and after. Fail, naming the skills, when a skill changed without a bump or
   when the new version is already tagged. Exit before any tag is created.
   New skills, deleted skills, and an empty/zero `BEFORE_SHA` are exempt.
3. **Tagging** — candidates are touched skills on push, all skills on
   dispatch. For each, skip if `refs/tags/<skill>/v<version>` exists; otherwise
   create a lightweight tag at the target commit (the merge commit on push,
   default-branch HEAD on dispatch) and push it.

### Tag target

- Push: `AFTER_SHA` (the merge commit), so AC-001 holds.
- Dispatch: `git rev-parse origin/$DEFAULT_BRANCH`, not the branch selected in
  the UI.

### Dependabot

One weekly `github-actions` group update. The pin is a full SHA with a version
comment; Dependabot is the mechanism that keeps it from going stale, per the
`github-actions` checklist.

## Key Decisions

- **Per-skill tags** (`code-quality/v1.6.1`) over one repo-wide tag: chosen by
  the user; only changed skills' pins move.
- **Tag name uses `/v`** over `-v` or `@`: mirrors the skill path and stays
  unambiguous in an APM ref after `#`.
- **Lightweight tags** over annotated: no tagger identity, no extra metadata;
  the ref is the contract.
- **Merge-triggered workflow** over a release script: chosen by the user; no
  hand step after the one-time backfill.
- **Guard fails before publishing**: one run either creates the valid tags or
  none, so a red run leaves no half-release.
- **No Releases**: chosen by the user; no notes, no `gh` dependency.
- **`git push`** over the REST API: the checkout token already authenticates
  it, and one push per tag keeps the script small.
- **Rejected**: tagging every untagged skill on every push (would backfill
  implicitly but make unrelated merges publish tags); bumping the version in
  CI (the version lives in the file the author is already editing).

## Risks

- Tag rulesets can block `GITHUB_TOKEN` pushes. The repo has none today; if one
  is added later, the workflow needs an allow rule.
- `paths: ['skills/**']` means the workflow file's own merge triggers nothing;
  the backfill dispatch is the deliberate first run.
- A version decrease to an untagged value is not caught; the spec only forbids
  reuse of a tagged version.

## Verification

Local, in a scratch clone with a bare origin:

1. `bash -n .github/scripts/tag-skills.sh` (and shellcheck if present).
2. Touch a skill without a bump → script exits 1, names the skill, no tag.
3. Bump two skills in one commit → two tags, both at that commit.
4. Run again → no new tags (idempotent).
5. Dispatch mode with no tags → one tag per skill at the default-branch HEAD.
6. A non-`skills/` commit → the workflow does not trigger.

Post-merge: run `workflow_dispatch`, `git fetch --tags`, confirm nine tags;
then a version-bump merge to confirm AC-001/AC-003.

Skipped artifacts: `research.md` (no unverified premise), `data-model.md` (no
persisted entity), `contracts/` (the tag name is the only interface and is in
the spec), `quickstart.md` (the commands above are short enough for tasks.md).
