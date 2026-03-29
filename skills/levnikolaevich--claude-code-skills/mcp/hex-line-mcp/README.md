# hex-line-mcp

Hash-verified file editing MCP + token efficiency hook for AI coding agents.

[![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-line-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp)
[![downloads](https://img.shields.io/npm/dm/@levnikolaevich/hex-line-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp)
[![license](https://img.shields.io/npm/l/@levnikolaevich/hex-line-mcp)](./LICENSE)
![node](https://img.shields.io/node/v/@levnikolaevich/hex-line-mcp)

Every line carries an FNV-1a content hash. Every edit must present those hashes back -- proving the agent is editing what it thinks it's editing. No stale context, no silent corruption.

## Features

### 10 MCP Tools

Core day-to-day tools:

- `read_file`
- `edit_file`
- `grep_search`
- `outline`
- `verify`
- `bulk_replace`

Advanced / occasional:

- `write_file`
- `directory_tree`
- `get_file_info`
- `changes`

| Tool | Description | Key Feature |
|------|-------------|-------------|
| `read_file` | Read file with hash-annotated lines, checksums, and revision | Partial reads via `offset`/`limit` or `ranges`, compact output by default |
| `edit_file` | Revision-aware anchor edits (`set_line`, `replace_lines`, `insert_after`, `replace_between`) | Batched same-file edits + conservative auto-rebase |
| `write_file` | Create new file or overwrite, auto-creates parent dirs | Path validation, no hash overhead |
| `grep_search` | Search with ripgrep, 3 output modes, per-group checksums | Plain `files`/`count`, compact edit-ready `content` |
| `outline` | AST-based structural overview with hash anchors via tree-sitter WASM. Supports code (15+ langs) and fence-aware markdown headings | 95% token reduction, direct edit anchors |
| `verify` | Check if held checksums / revision are still current | Staleness check without full re-read |
| `directory_tree` | Compact directory tree with root .gitignore support | Skips node_modules/.git, shows file sizes |
| `get_file_info` | File metadata without reading content | Size, lines, mtime, type, binary detection |
| `changes` | Compare file against git ref, shows added/removed/modified symbols | AST-level semantic diff |
| `bulk_replace` | Search-and-replace across multiple files by glob | Compact summary (default) or capped diffs via `format`, dry_run, max_files |

### Hooks (PreToolUse + PostToolUse)

| Event | Trigger | Action |
|-------|---------|--------|
| **PreToolUse** | Read/Edit/Write/Grep on text files | Size-aware redirect: cheap small operations may pass, expensive ones are redirected |
| **PreToolUse** | Bash with dangerous commands | Blocks `rm -rf /`, `git push --force`, etc. Agent must confirm with user |
| **PostToolUse** | Bash with 50+ lines output | RTK: deduplicates, truncates, shows filtered summary to Claude as feedback |
| **SessionStart** | Session begins | Injects a short no-discovery workflow for hex-line tools |


### Bash Redirects

PreToolUse also intercepts simple Bash commands: cat, head, tail, tree, find, stat, wc -l, grep, rg, sed -i — redirects to hex-line equivalents. `ls`/`dir` only redirected for recursive listing (`ls -R`, `dir /s`); simple `ls path` is allowed. Compound commands with pipes are allowed.
## Install

### MCP Server

```bash
npm i -g @levnikolaevich/hex-line-mcp
claude mcp add -s user hex-line -- hex-line-mcp
```

ripgrep is bundled via `@vscode/ripgrep` — no manual install needed for `grep_search`.

### Hooks

Hooks and output style are auto-synced on every MCP server startup. The server compares installed files with bundled versions and updates only when content differs. First run after `npm i -g` triggers full install automatically.

Hooks are written to global `~/.claude/settings.json` with absolute path to `hook.mjs`. Output style is installed to `~/.claude/output-styles/hex-line.md` and activated if no other style is set. To activate manually: `/config` > Output style > hex-line.

## Validation

Use the normal package checks:

```bash
npm test
npm run lint
npm run check
```

Maintainers can also run the internal scenario harness when they want reproducible repo-local workflow regressions:

```bash
npm run scenarios -- --repo /path/to/repo
npm run scenarios:diagnostic -- --repo /path/to/repo
```

Comparative built-in vs hex-line benchmarks are maintained outside this package.

### Optional Graph Enrichment

If a project already has `.hex-skills/codegraph/index.db`, `hex-line` can add lightweight graph hints to `read_file`, `outline`, `grep_search`, and `edit_file`.

- Graph enrichment is optional. If `.hex-skills/codegraph/index.db` is missing, `hex-line` falls back to standard behavior silently.
- `better-sqlite3` is optional. If it is unavailable, `hex-line` still works without graph hints.
- `edit_file` reports **Call impact**, not full semantic blast radius. The warning uses call-graph callers only.

`hex-line` does not read `hex-graph` internals directly anymore. The integration uses a small read-only contract exposed by `hex-graph-mcp`:

- `hex_line_contract`
- `hex_line_symbol_annotations`
- `hex_line_call_edges`

## Tools Reference

## Common Workflows

### Local code edit in one file

1. `outline` for large code files
2. `read_file` for the exact range you need
3. `edit_file` with all known hunks in one call

### Follow-up edit on the same file

1. Carry `revision` from the earlier `read_file` or `edit_file`
2. Pass it back as `base_revision`
3. Use `verify` before rereading the file

### Rewrite a long block

Use `replace_between` inside `edit_file` when you know stable start/end anchors and want to replace a large function, class, or config block without reciting the old body.

### Literal rename / refactor

Use `bulk_replace` for text rename patterns across one or more files. Returns compact summary by default; pass `format: "full"` for capped diffs. Do not use it as a substitute for structured block rewrites.

### read_file

Read a file as canonical edit-ready blocks. Each valid range becomes a `read_range` block with absolute span, line entries, and a checksum covering exactly the emitted lines. Invalid ranges become explicit diagnostic blocks. Supports batch reads, multi-range reads, and directory listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File or directory path |
| `paths` | string[] | no | Array of file paths to read (batch mode) |
| `offset` | number | no | Start line, 1-indexed (default: 1) |
| `limit` | number | no | Max lines to return (default: 2000, 0 = all) |
| `ranges` | array | no | Explicit line ranges, e.g. `[{ "start": 10, "end": 30 }]` |
| `include_graph` | boolean | no | Opt in to graph annotations when the graph index exists |
| `plain` | boolean | no | Omit hashes, output `lineNum\|content` instead |

Default output is compact but block-structured:

```
File: lib/search.mjs
meta: 282 lines, 10.2KB, 2 hours ago
revision: rev-12-a1b2c3d4
file: 1-282:beefcafe

block: read_range
span: 1-3
ab.1    import { resolve } from "node:path";
cd.2    import { readFileSync } from "node:fs";
ef.3    ...
checksum: 1-3:f7e2a1b0
```

### edit_file

Edit using revision-aware hash-verified anchors. Prefer one batched call per file. For text rename use bulk_replace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File to edit |
| `edits` | string | yes | JSON array of edit operations (see below) |
| `dry_run` | boolean | no | Preview changes without writing |
| `restore_indent` | boolean | no | Auto-fix indentation to match anchor context (default: false) |
| `base_revision` | string | no | Prior revision from `read_file` / `edit_file` for same-file follow-up edits |
| `conflict_policy` | enum | no | `conservative` or `strict` (default: `conservative`) |

Edit operations (JSON array):

```json
[
  {"set_line": {"anchor": "ab.12", "new_text": "replacement line"}},
  {"replace_lines": {"start_anchor": "ab.10", "end_anchor": "cd.15", "new_text": "...", "range_checksum": "10-15:a1b2c3d4"}},
  {"insert_after": {"anchor": "ab.20", "text": "inserted line"}},
  {"replace_between": {"start_anchor": "ab.30", "end_anchor": "cd.80", "new_text": "...", "boundary_mode": "inclusive"}}
]
```

Result footer includes:

- `status: OK | AUTO_REBASED | CONFLICT`
- `revision: ...`
- `file: ...`
- `changed_ranges: ...` when relevant
- `remapped_refs: ...` when stale anchors were uniquely relocated
- `retry_checksum: ...` on local conflicts

### write_file

Create a new file or overwrite an existing one. Creates parent directories automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `content` | string | yes | File content |

### grep_search

Search file contents using ripgrep. Three output modes: `content` (canonical `search_hunk` blocks), `files` (plain path list), `count` (plain `file:count` list).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Search pattern (regex by default, literal if `literal:true`) |
| `path` | string | no | Directory or file to search (default: cwd) |
| `glob` | string | no | Glob filter, e.g. `"*.ts"` |
| `type` | string | no | File type filter, e.g. `"js"`, `"py"` |
| `output` | enum | no | Output format: `"content"` (default), `"files"`, `"count"` |
| `case_insensitive` | boolean | no | Ignore case |
| `smart_case` | boolean | no | CI when lowercase, CS when uppercase (`-S`) |
| `literal` | boolean | no | Literal string search, no regex (`-F`) |
| `multiline` | boolean | no | Pattern can span multiple lines (`-U`) |
| `context` | number | no | Symmetric context lines around matches (`-C`) |
| `context_before` | number | no | Context lines BEFORE match (`-B`) |
| `context_after` | number | no | Context lines AFTER match (`-A`) |
| `limit` | number | no | Max matches per file (default: 100) |
| `total_limit` | number | no | Total match events across all files; multiline matches count as 1 (0 = unlimited) |
| `plain` | boolean | no | Omit hash tags inside block entries, return `lineNum\|content` |

`content` mode returns canonical `search_hunk` blocks with per-hunk checksums enabling direct `replace_lines` from grep results without intermediate `read_file`.

### outline

AST-based structural outline with hash anchors for direct `edit_file` usage. Supports code files (15+ languages) and fence-aware markdown heading navigation (`.md`/`.mdx`). Each entry includes a hash tag for immediate anchor use without intermediate `read_file`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Source file path |

Supported languages: JavaScript, TypeScript (JSX/TSX), Python, Go, Rust, Java, C, C++, C#, Ruby, PHP, Kotlin, Swift, Bash -- 15+ via tree-sitter WASM.

Not for `.json`, `.yaml`, `.txt` -- use `read_file` directly for those.

### verify

Check if range checksums from prior read/search blocks are still valid, optionally relative to a prior `base_revision`. Returns a deterministic verification report with `status`, `summary`, and one line per checksum entry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `checksums` | string[] | yes | Array of checksum strings, e.g. `["1-50:f7e2a1b0"]` |
| `base_revision` | string | no | Prior revision to compare against latest state |

Example output:

```text
status: STALE
revision: rev-17-deadbeef
file: 1-120:abc123ef
summary: valid=0 stale=1 invalid=0
base_revision: rev-16-feedcafe
changed_ranges: 10-12(replace)

STALE 10-12 checksum: 10-12:oldc0de0 current=10-12:newc0de0
```

### directory_tree

Compact directory tree with root .gitignore support (path-based rules, negation, dir-only). Nested .gitignore files are not loaded.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory path |
| `pattern` | string | no | Glob filter on names (e.g. `"*-mcp"`, `"*.mjs"`). Returns flat match list instead of tree |
| `type` | string | no | `"file"`, `"dir"`, or `"all"` (default). Like `find -type f/d` |
| `max_depth` | number | no | Max recursion depth (default: 3, or 20 in pattern mode) |
| `gitignore` | boolean | no | Respect root .gitignore patterns (default: true). Nested .gitignore not supported |
| `format` | string | no | `"compact"` = names only, no sizes, depth 1. `"full"` = default with sizes |

Skips `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.next`, `coverage` by default.

### get_file_info

File metadata without reading content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |

Returns: size, line count, modification time (absolute + relative), file type, binary detection.

## Hook

The unified hook (`hook.mjs`) handles four events:

### PreToolUse: Tool Redirect

Blocks built-in `Read`, `Edit`, `Write`, `Grep` on text files and redirects to hex-line equivalents. Binary files (images, PDFs, notebooks, archives, executables, fonts, media) are excluded.

### PreToolUse: Bash Redirect + Dangerous Blocker

Intercepts simple Bash commands (`cat`, `head`, `tail`, `ls`, `find`, `grep`, `sed -i`, etc.) and redirects to hex-line tools. Blocks dangerous commands (`rm -rf /`, `git push --force`, `git reset --hard`, `DROP TABLE`, `chmod 777`, `mkfs`, `dd`).

### PostToolUse: RTK Output Filter

Triggers on `Bash` tool output exceeding 50 lines. Pipeline:

1. **Detect command type** -- npm install, test, build, pip install, git verbose, or generic
2. **Normalize** -- replaces UUIDs, timestamps, IPs, hex values, large numbers with placeholders
3. **Deduplicate** -- collapses identical normalized lines with `(xN)` counts
4. **Truncate** -- keeps first 15 + last 15 lines, omits the middle

Configuration constants in `hook.mjs`:

| Constant | Default | Purpose |
|----------|---------|--------|
| `LINE_THRESHOLD` | 50 | Minimum lines to trigger filtering |
| `HEAD_LINES` | 15 | Lines to keep from start |
| `TAIL_LINES` | 15 | Lines to keep from end |

### SessionStart: Tool Preferences

Injects a short operational workflow into agent context at session start: no `ToolSearch`, prefer `outline -> read_file -> edit_file -> verify`, and use targeted reads over full-file reads.

## Architecture

```
hex-line-mcp/
  server.mjs          MCP server (stdio transport, 11 tools)
  hook.mjs            Unified hook (PreToolUse + PostToolUse + SessionStart)
  package.json
  lib/
    hash.mjs          FNV-1a hashing, 2-char tags, range checksums
    read.mjs          File reading with hash annotation
    edit.mjs          Anchor-based edits, diff output
    search.mjs        ripgrep wrapper with hash-annotated results
    outline.mjs       tree-sitter WASM AST outline
    verify.mjs        Range checksum verification
    info.mjs          File metadata (size, lines, mtime, type)
    tree.mjs          Directory tree with .gitignore support
    changes.mjs       Semantic git diff via AST
    bulk-replace.mjs  Multi-file search-and-replace
    setup.mjs         Claude hook installation + output style setup
    format.mjs        Output formatting utilities
    coerce.mjs        Parameter pass-through (identity)
    security.mjs      Path validation, binary detection, size limits
    normalize.mjs     Output normalization, deduplication, truncation
```

### Hash Format

```
ab.42    const x = calculateTotal(items);
```

- `ab` -- 2-char FNV-1a tag derived from content (whitespace-normalized)
- `42` -- line number (1-indexed)
- Tab separator, then original content
- Tag alphabet: `abcdefghijklmnopqrstuvwxyz234567` (32 symbols, bitwise selection)

### Range Checksums

```
checksum: 1-50:f7e2a1b0
```

FNV-1a accumulator over all line hashes in the range (little-endian byte feed). Detects changes to any line, even ones not being edited.

### Security

- Path canonicalization via `realpathSync` (resolves symlinks)
- Binary file detection (null byte scan in first 8KB)
- 10 MB file size limit
- Write path validation (ancestor directory must exist)
- Directory restrictions delegated to Claude Code sandbox


## FAQ

<details>
<summary><b>Does it work without Claude Code?</b></summary>

Yes. hex-line-mcp is a standard MCP server (stdio transport). It works with any MCP-compatible client -- Claude Code, Gemini CLI, Codex CLI, or custom integrations. Hook installation is Claude-specific; Gemini/Codex use MCP Tool Preferences guidance instead.

</details>

<details>
<summary><b>What happens if a hash is stale?</b></summary>

The edit is rejected with an error showing which lines changed since the last read. The agent must re-read the affected range and retry. This prevents silent overwrites from stale context.

</details>

<details>
<summary><b>Is outline available for all file types?</b></summary>

Outline works on code files (15+ languages via tree-sitter WASM) and markdown heading navigation (`.md`/`.mdx`, fenced code blocks ignored). For JSON, YAML, and text files use `read_file` directly. Each outline entry includes a hash anchor (`tag.line-range: symbol`) for direct use in `edit_file`.

</details>

<details>
<summary><b>How does the RTK filter work?</b></summary>

The PostToolUse hook normalizes Bash output (replaces UUIDs, timestamps, IPs with placeholders), deduplicates identical lines, and truncates to first 15 + last 15 lines. The filtered summary is shown to Claude as stderr feedback via exit code 2.

</details>

<details>
<summary><b>Can I disable the built-in tool blocking?</b></summary>

Yes. Remove the PreToolUse hook from `.claude/settings.local.json`. The MCP tools will still work, but agents will be free to use built-in Read/Edit/Write/Grep alongside hex-line tools.

</details>

## Hex Family

| Package | Purpose | npm |
|---------|---------|-----|
| [hex-line-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) | Local file editing with hash verification + hooks | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-line-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) |
| [hex-ssh-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) | Remote file editing over SSH | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-ssh-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) |
| [hex-graph-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) | Code knowledge graph with AST indexing | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-graph-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) |

## License

MIT
