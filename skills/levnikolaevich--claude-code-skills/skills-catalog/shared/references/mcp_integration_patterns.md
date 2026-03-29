# MCP Integration Patterns

<!-- SCOPE: Hex-line unique tool patterns for skills. Referenced via MANDATORY READ. -->

## When to Use

These patterns use hex-line tools that have **no built-in equivalent**. Hooks already redirect Read/Edit/Write/Grep → hex-line automatically. These patterns are for tools the agent won't discover without explicit guidance.

## Patterns

### Outline-First Read

**When:** Unfamiliar code file >100 lines.
**Tools:** `outline` → `read_file(ranges)`

```
1. outline(path) → get function/class structure (10 lines vs 500)
2. read_file(path, ranges=["42-68"]) → read only relevant section
```

### Verified Edit Cycle

**When:** Any code modification.
**Tools:** `read_file` → `edit_file(base_revision)` → `verify`

```
1. read_file(path) → get revision from response header
2. edit_file(path, edits=[...], base_revision=rev) → hash-verified edit
3. verify(path, checksums) → confirm no stale state
```

### Bulk Cleanup

**When:** Same replacement across >3 files (e.g., import rename, dead code removal).
**Tools:** `bulk_replace(dry_run)` → `bulk_replace`

```
1. bulk_replace(replacements=[{search, replace}], glob="src/**/*.ts", dry_run=true) → preview
2. Review dry_run output
3. bulk_replace(..., dry_run=false) → apply
```

### Semantic Diff Review

**When:** Reviewing implementation changes before approval.
**Tools:** `changes(compare_against)`

```
1. changes(path="src/", compare_against="HEAD~1") → AST-level diff summary
2. Focus review on structural changes, not whitespace
```

## Integration in Skills

Add to `allowed-tools` frontmatter (append to existing):
```yaml
allowed-tools: Read, Grep, Glob, Bash, mcp__hex-line__outline, mcp__hex-line__verify, mcp__hex-line__changes
```

Add body instruction (follow "Graph acceleration" pattern):
```markdown
**Hex-line acceleration (if available):** IF hex-line MCP server is available:
- **Outline-first:** `outline(path)` before reading large code files
- **Verified edits:** `edit_file(base_revision=rev)` → `verify(checksums)`
- Fall back to built-in Read/Edit if unavailable.
```
