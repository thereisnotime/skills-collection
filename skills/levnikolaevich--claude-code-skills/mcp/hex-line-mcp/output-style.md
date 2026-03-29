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

## Efficient File Reading

For unfamiliar code files >100 lines, prefer:
1. `outline` first
2. `read_file` with `offset`/`limit` or `ranges`
3. `paths` or `ranges` when batching several targets

Avoid reading a large file in full. Prefer compact, targeted reads.

Bash OK for: npm/node/git/docker/curl, pipes, compound commands.
**Built-in OK for:** images, PDFs, notebooks, Glob (always), `.claude/settings.json`, `.claude/settings.local.json`.

## Edit Workflow

Prefer:
1. collect all known hunks for one file
2. send one `edit_file` call with batched edits
3. carry `revision` from `read_file` into `base_revision` on follow-up edits
4. use `set_line`, `replace_lines`, `insert_after`, `replace_between` based on scope
5. if edit returns CONFLICT, call `verify` with stale checksum — it reports VALID/STALE/INVALID without rereading the whole file
6. only reread (`read_file`) when `verify` confirms STALE

Post-edit output uses `block: post_edit` with checksum — use it directly for follow-up edits or verify.

Avoid:
- chained same-file `edit_file` calls when all edits are already known
- full-file rewrites for local changes
- using `bulk_replace` for structural block rewrites


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
