---
description: Create a GitHub release — audits commits, updates CHANGELOG, builds release notes
allowed-tools: Read, Bash, Grep, AskUserQuestion
---

# Create Release

Create a tagged GitHub release with structured release notes. Audits commits since last release, updates CHANGELOG.md, builds release notes, asks for confirmation, then publishes.

## Prerequisites

| Requirement | Check Command | Install |
|-------------|---------------|---------|
| GitHub CLI | `gh --version` | [cli.github.com](https://cli.github.com) |
| Authenticated | `gh auth status` | `gh auth login` |

## Workflow

### 1. Determine Version (CalVer)

Default version is today's date in CalVer format: `YYYY.MM.DD`.

```bash
date +%Y.%m.%d
```

Store as `VERSION`. If `$ARGUMENTS` is provided, use it as version override instead.

Also update the version in README.md badge and marketplace.json to match the new release version.

### 2. Check for Existing Release

```bash
gh release view "v${VERSION}" 2>&1
```

If release already exists, stop and inform the user. Do NOT overwrite.

### 3. Audit Commits Since Last Release

CHANGELOG is a summary, **commits are the source of truth**. Always verify.

```bash
gh release list --limit 1                                    # find last release tag
git log {LAST_TAG}..HEAD --oneline                           # overview
git log {LAST_TAG}..HEAD --format="%h %s%n%b" --no-merges    # full bodies
```

Collect all changes from commits — not just what CHANGELOG says.

### 4. Update CHANGELOG.md

Compare commits vs existing CHANGELOG entries:
- If CHANGELOG is missing items or inaccurate — update it with bullet points derived from commits
- Max 5 bullets per entry (per CHANGELOG scope comment)
- Use `## YYYY-MM-DD` heading format

### 5. Build Release Notes

Assemble release notes from the **updated** CHANGELOG:

````markdown
## What's New in v{VERSION}

{bullets from updated CHANGELOG}

### Install

/plugin add levnikolaevich/claude-code-skills

**All plugins & docs:** [README.md](README.md)
````

### 6. Confirm with User
Present the assembled release notes and version tag to the user via AskUserQuestion:

- Show: `Release: v{VERSION}`
- Show: full release notes markdown
- Ask: "Publish this release? (yes/no)"

Do NOT proceed without explicit confirmation.

### 7. Create Release

```bash
gh release create "v${VERSION}" --title "v${VERSION}" --notes "${RELEASE_NOTES}"
```

**Verify:**

```bash
gh release view "v${VERSION}" --json tagName,url --jq '"\(.tagName) -> \(.url)"'
```

Report the release URL to the user.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Version not found in README | Check badge format: `version-X.Y.Z-blue` |
| Release already exists | Use a new version or delete the existing release first |
| CHANGELOG empty or no recent entry | Add a `## YYYY-MM-DD` section with bullets before creating release |
| `gh` not authenticated | Run `gh auth login` |

## Related Documentation

- [README.md](README.md) -- version badge source
- [CHANGELOG.md](CHANGELOG.md) -- release notes source

---
**Last Updated:** 2026-03-21
