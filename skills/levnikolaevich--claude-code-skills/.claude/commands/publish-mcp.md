---
description: "Publish MCP server to npm (hex-line-mcp, hex-ssh-mcp, or hex-graph-mcp). Auto-detects unpublished changes, suggests bump type, syncs server.mjs version."
allowed-tools: Bash, Glob, AskUserQuestion, mcp__hex-line__read_file, mcp__hex-line__edit_file, mcp__hex-line__grep_search, mcp__hex-line__write_file
---

# Publish MCP Server

Publishes one of the bundled MCP servers to npm. Tag push triggers GitHub Actions → `npm publish --provenance`.

**IMPORTANT:** Set `PROJECT_ROOT` to the absolute path of the repo root at the start. Use `$PROJECT_ROOT` in all `cd` and path references to avoid CWD-related failures.

## Package Registry

| Package | Directory | Tag Pattern | CI Workflow |
|---------|-----------|-------------|-------------|
| @levnikolaevich/hex-line-mcp | `mcp/hex-line-mcp/` | `hex-line-v*` | publish-hex-line.yml |
| @levnikolaevich/hex-ssh-mcp | `mcp/hex-ssh-mcp/` | `hex-ssh-v*` | publish-hex-ssh.yml |
| @levnikolaevich/hex-graph-mcp | `mcp/hex-graph-mcp/` | `hex-graph-v*` | publish-hex-graph.yml |

**Shared dependency:** `mcp/hex-common/` (private, `file:` linked) — changes there affect ALL 3 packages.

## Workflow

### 1. Scan all packages for unpublished changes

For each of the 3 packages above, run in parallel:

```bash
# Last tag for this package
git tag -l "${TAG_PREFIX}*" --sort=-v:refname | head -1

# Commits since last tag touching this package
git log ${LAST_TAG}..HEAD --oneline -- mcp/${PKG}/

# Unstaged changes (not yet committed)
git diff --stat -- mcp/${PKG}/

# Local version
node --input-type=module -e "import{readFileSync}from'fs';console.log(JSON.parse(readFileSync('$PROJECT_ROOT/mcp/${PKG}/package.json','utf8')).version)"

# npm registry version
npm view @levnikolaevich/${PKG} version 2>/dev/null || echo "not published"
```

Also check shared dependency:
```bash
git diff --stat -- mcp/hex-common/
git log ${LAST_TAG}..HEAD --oneline -- mcp/hex-common/
```

A package **needs release** if it has commits since tag OR unstaged changes. If only `mcp/hex-common/` changed, ALL packages that import from it need release.

Display summary table:

```
| Package       | Local  | npm    | Commits | Unstaged | Status         |
|---------------|--------|--------|---------|----------|----------------|
| hex-line-mcp  | 1.1.1  | 1.1.1  | 2       | 6 files  | needs release  |
| hex-graph-mcp | 0.2.1  | 0.2.1  | 0       | 3 files  | needs release  |
| hex-ssh-mcp   | 1.1.1  | 1.1.1  | 0       | 0        | up to date     |
```

If no packages need release → report "All packages up to date" and stop.

### 2. Choose package

AskUserQuestion: "Which MCP server to publish?" — list only packages that need release (commits > 0 OR unstaged changes). If only one needs release, suggest it as default. Allow "all" if multiple need release.

Set variables:
- `PKG` = selected package name (e.g. `hex-line-mcp`)
- `PKG_DIR` = `mcp/${PKG}/`
- `TAG_PREFIX` = `hex-line-v` | `hex-ssh-v` | `hex-graph-v`
- `PKG_NAME` = `@levnikolaevich/${PKG}`
- `LAST_TAG` = most recent tag for this package

### 3. Show changes since last release

```bash
git log ${LAST_TAG}..HEAD --oneline -- mcp/${PKG}/ mcp/hex-common/
git diff --stat ${LAST_TAG}..HEAD -- mcp/${PKG}/ mcp/hex-common/
```

Display the output to the user.

### 4. Suggest bump type

Analyze the diff and commit messages:
- Only existing file modifications, `fix:` commits → suggest **patch**
- New files, new exports, `feat:` commits → suggest **minor**
- Removed/renamed public API, `BREAKING CHANGE` or `!:` → suggest **major**

AskUserQuestion with the recommendation marked "(Recommended)":
- **patch** (X.Y.Z → X.Y.Z+1): bug fixes, tweaks
- **minor** (X.Y.Z → X.Y+1.0): new features, new tools
- **major** (X.Y.Z → X+1.0.0): breaking changes

### 5. Pre-publish checks

```bash
cd $PROJECT_ROOT/mcp/hex-common && npm test && cd $PROJECT_ROOT/mcp/${PKG} && npm run check && npm run lint && npm test
```

**Gate:** hex-common tests + package check/lint/test must all pass. If any fails — fix before proceeding.

**README tool count check** (Bash grep OK here — runs on single files, not piped through built-in Grep):
```bash
actual=$(grep -c 'registerTool' $PROJECT_ROOT/mcp/${PKG}/server.mjs || echo 0)
claimed=$(grep -oE '[0-9]+ MCP Tools' $PROJECT_ROOT/mcp/${PKG}/README.md | grep -oE '[0-9]+' || echo "0")
[ "$actual" != "$claimed" ] && echo "FAIL: README claims $claimed tools, actual $actual — update README" || echo "README tool count OK ($actual)"
```
If mismatch — update `N MCP Tools` in README.md before proceeding.

### 6. Bump version

```bash
cd $PROJECT_ROOT/mcp/${PKG} && npm version ${BUMP_TYPE} --no-git-tag-version
node --input-type=module -e "import{readFileSync}from'fs';console.log(JSON.parse(readFileSync('$PROJECT_ROOT/mcp/${PKG}/package.json','utf8')).version)"
```

### 7. Build bundle (inlines hex-common + injects version)

```bash
cd $PROJECT_ROOT/mcp/${PKG} && npm run build
```

Version is injected at build time via esbuild `define: { __HEX_VERSION__ }`. No manual sync in server.mjs needed.

Verify version in bundle using `mcp__hex-line__grep_search`:
- pattern: `"${NEW_VERSION}"` (literal), path: `mcp/${PKG}/dist/server.mjs`, limit: 1

### 7b. Sync version in server.json (MCP Registry metadata)

Update both `version` and `packages[0].version` in `mcp/${PKG}/server.json`:
```bash
jq --arg v "${NEW_VERSION}" '.version = $v | .packages[0].version = $v' $PROJECT_ROOT/mcp/${PKG}/server.json > /tmp/server.tmp && mv /tmp/server.tmp $PROJECT_ROOT/mcp/${PKG}/server.json
```

Verify:
```bash
jq '.version, .packages[0].version' $PROJECT_ROOT/mcp/${PKG}/server.json
```

### 8. Commit + tag + push

**CRITICAL:** Commit ALL repo changes (`git add -A`), not just the package directory. Other pending changes (skills, commands, docs) ride along with the release commit. Never scope `git add` to a subdirectory.

```bash
git add -A
git commit -m "release: ${PKG_NAME} v${NEW_VERSION}"
git tag ${TAG_PREFIX}${NEW_VERSION}
git push origin master --tags
```

### 9. Verify publish

Wait ~30s, then:
```bash
gh run list --limit 1
npm view ${PKG_NAME} version
```

### 10. Report

Display: package name, old → new version, npm URL (`https://www.npmjs.com/package/${PKG_NAME}`), GitHub Actions run status.

---

### 11. Meta-Analysis

**MANDATORY READ:** Load `shared/references/meta_analysis_protocol.md`

Analyze this session per protocol §7. Output per protocol format.
