---
name: hex-line
description: hex-line MCP tool preferences with compact coding style
keep-coding-instructions: true
---

# MCP Tool Preferences

**PREFER** hex-line MCP for code files. Hash-annotated reads and verified edits keep context cheap and safe.

| Instead of | Use | Why |
|-----------|-----|-----|
| Read | `mcp__hex-line__read_file` | Hash-annotated, revision-aware |
| Edit | `mcp__hex-line__edit_file` | Hash-verified anchors + conservative auto-rebase |
| Write | `mcp__hex-line__write_file` | No prior Read needed |
| Grep | `mcp__hex-line__grep_search` | Edit-ready matches |
| Edit (text rename) | `mcp__hex-line__bulk_replace` | Multi-file text rename/refactor |
| Bash `find`/`tree` | `mcp__hex-line__directory_tree` | Pattern search, gitignore-aware |
| Full code read | `mcp__hex-line__outline` then `read_file` with ranges | Structure first, read targeted |

**Bootstrap**: if hex-line calls fail, load schemas: `ToolSearch('+hex-line read edit')`

## Workflow Paths

| Path | When | Flow |
|------|------|------|
| Surgical | Know the target | `grep_search` → `edit_file` |
| Exploratory | Need context first | `outline` → `read_file` (ranges) → `edit_file` |
| Multi-file | Text rename/refactor | `bulk_replace` |
| Verify | Check freshness | `verify` → reread only if STALE |

Bash OK for: npm/node/git/docker/curl, pipes, compound commands.
**Built-in OK for:** images, PDFs, notebooks, Glob (always), `.claude/settings.json`, `.claude/settings.local.json`.

## Edit Workflow

| Do | Don't |
|----|-------|
| Batch all hunks in one `edit_file` | Chain same-file `edit_file` calls |
| Carry `revision` → `base_revision` | Full-file rewrite for local changes |
| `verify` before reread | `bulk_replace` for block rewrites |
| `post_edit` checksum for follow-up | — |


## hex-graph — Code Analysis

Run `index_project` once per session before using other graph tools.

| Task | Tool | Output |
|------|------|--------|
| Refactoring / moving code | `find_references`, `find_implementations` | All usages + implementations |
| Code review / tech debt | `find_cycles`, `find_hotspots` | Circular deps, complexity hotspots |
| Dead code cleanup | `find_unused_exports` | Exports nobody imports |
| Architecture overview | `get_architecture`, `get_module_metrics` | Module map + coupling metrics |
| Duplicate detection | `find_clones` | Similar code blocks |
| Impact analysis | `trace_paths` | Call chains A → B |
| Symbol lookup | `search_symbols`, `get_symbol` | Find by name, get details |
# Response Style

Keep responses compact and operational. Explain only what is needed to complete the task or justify a non-obvious decision.

Prefer:
- short progress updates
- direct tool calls without discovery chatter
- concise summaries of edits and verification

Avoid:
- mandatory educational blocks
- long prose around tool usage
- repeating obvious implementation details
