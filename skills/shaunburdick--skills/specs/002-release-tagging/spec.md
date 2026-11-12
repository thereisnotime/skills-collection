---
name: release-tagging
version: "0.2.0"
status: approved
updated: 2026-11-11
---

# Release Tagging for Skill Consumers

## Problem Statement

Downstream installs pin this repository at a commit. The user's APM config
carries ten entries that all point at the same 40-character SHA:

```
- shaunburdick/skills/skills/code-quality#7ac7b76cce2debef7e85bbc0c37a82e37e5b43d4
```

Bumping means editing ten lines with a new hash, and the diff says nothing
about which skill moved. APM and the `skills` CLI both accept a tag ref, so a
per-skill tag named after the version already recorded in each `SKILL.md`
would make the pin readable.

## Done when

A merged skill change produces a tag `<skill>/v<version>` at the merge commit,
and a skill change without a version bump fails the workflow run.

## User Stories

- As a consumer pinning these skills in APM, I want to pin
  `code-quality/v1.6.1` instead of a 40-character SHA, so the ref says what
  version I am on.
- As the repository owner, I want tags cut automatically when a skill's
  version changes, so I never hand-tag and cannot forget.
- As the repository owner, I want to backfill tags for the skills that exist
  today, so the ten SHA pins can be swapped for readable refs with no content
  change.
- As a maintainer, I want an unbumped skill change to fail loudly, so a
  changed skill never ships without a new tag.

## Functional Requirements

#### FR-001 — Tag name and source

Each tag is named `<skill>/v<version>`, where `<skill>` is the skill's
directory name under `skills/` and `<version>` is the value of
`metadata.version` in `skills/<skill>/SKILL.md`, used verbatim (for example
`code-quality/v1.6.1`). One tag exists per skill version. A published tag is
never moved or deleted; a bad tag is superseded by publishing a new version. A
change that would set a version already tagged for that skill (for example a
revert) fails the run naming the skill; version numbers are never reused.

#### FR-002 — Automatic tagging on merge

A push to the default branch that changes anything under `skills/` creates a
tag for every skill touched by that push whose `<skill>/v<version>` tag does
not yet exist, pointing at the default-branch commit that carried the change.
Skills already tagged at their current version, and skills not touched by the
push, get no new tag.

#### FR-003 — Unbumped change fails the run

A push that changes files under `skills/<skill>/` without changing that
skill's `metadata.version` fails the workflow run, and the run output names
each offending skill. No tag is published for the offending skill, and the
guard runs before any tag is created, so a run that trips it publishes no tag.
A push that removes a skill folder is exempt: its last tag keeps pointing where
it did and no new tag is created.

#### FR-004 — Manual backfill

A `workflow_dispatch` run tags every skill under `skills/` that has no tag
yet, at the current default-branch HEAD, with no content change required.
Running it again changes nothing.

#### FR-005 — Least privilege

The workflow uses the repository's default `GITHUB_TOKEN` with
`contents: write` and no broader permission. It uses no personal access token,
and every action it references is pinned to a full commit SHA.

## Acceptance Criteria

Binary — each either passes or does not.

**Tag naming (FR-001)**

- [ ] **AC-001**: After a merge that bumps `code-quality` to version X,
      `git ls-remote --tags origin 'code-quality/v*'` lists
      `code-quality/vX`, and `git rev-parse code-quality/vX^{commit}` equals
      the merge commit.
- [ ] **AC-002**: A later default-branch commit that touches no skill files
      leaves every existing tag at its original commit (`git rev-parse <tag>`
      unchanged).

**Automatic tagging (FR-002)**

- [ ] **AC-003**: A merge changing only `skills/code-quality/` with a bumped
      version adds exactly one tag; the tag list for every other skill is
      identical before and after (`git ls-remote --tags` diff is empty).
- [ ] **AC-004**: A merge changing only non-`skills/` paths (for example
      `README.md`) triggers no run of the tagging workflow
      (`gh run list --workflow <file> --limit 1` shows the previous run) and
      adds no tag.
- [ ] **AC-005**: A push with one change to `skills/code-quality/` and another
      to `skills/git-safety/`, both versions bumped, produces one tag per
      skill, both at the merge commit.

**Guard (FR-003)**

- [ ] **AC-006**: A push changing `skills/code-quality/` with
      `metadata.version` unchanged ends with
      `gh run view <id> --json conclusion --jq .conclusion` printing `failure`,
      the failed step's log contains `code-quality`, and no new tag exists for
      that skill.
- [ ] **AC-007**: A push changing two skills' files without bumping either
      names both skills in the failed run's output and creates no tag for
      either.
- [ ] **AC-008**: A push reverting a skill's version to a value already tagged
      for that skill fails the run, names the skill, and leaves the existing
      tag at its original commit.

**Backfill (FR-004)**

- [ ] **AC-009**: On a repository where skills have no tags, `gh workflow run
      <file>` followed by `git fetch --tags` gives every skill currently under
      `skills/` a tag `<skill>/v<metadata.version>` pointing at the
      default-branch HEAD at dispatch time.
- [ ] **AC-010**: A second dispatch adds no tags (tag count unchanged).

**Least privilege (FR-005)**

- [ ] **AC-011**: The workflow file's top-level `permissions` block contains
      `contents: write` and no other scope; it references no secret other than
      the default token, and every `uses:` line names a 40-character commit
      SHA.

## Not doing

- Editing or rewriting the ten existing SHA pins in the user's APM config
- GitHub Releases and generated release notes
- A repository-wide version tag
- Per-commit tags
- Semver range resolution (`^1.6.0`, `latest`, and similar)
- Tag signing
- Changing any skill's content
- Documentation beyond what the tag contract itself needs

## Edge Cases

| Scenario | Expected behavior |
|---|---|
| A skill is added for the first time | Tagged at its declared version (FR-002) |
| Two skills bumped in one push | One tag per skill, both at the merge commit |
| Skill folder changed, version not bumped | Run fails, skill named, no tag (FR-003) |
| Repository has no tags yet | Backfill tags every skill at HEAD (FR-004) |
| Skill folder deleted | Existing tags remain (FR-001); no new tag is created; run succeeds |
| Version reverted to a value already tagged | Run fails, skill named; the existing tag is not moved (FR-001) |
