# Tool Preferences for Code Editing

Hash-verified file operations via `hex-line-mcp` MCP server.

## hex-line-mcp (MCP — preferred)

MCP server at `mcp/hex-line-mcp/`. 11 tools with FNV-1a hash verification:

| Tool | Purpose | When to use |
|------|---------|-------------|
| `outline` | AST structural overview (10 lines vs 500) | Before reading large files |
| `read_file` | Hash-annotated read with range checksums | Examining file contents |
| `edit_file` | Hash-verified anchor edits (set_line, replace_lines, insert_after) | Modifying code — hash-only, no text replace |
| `write_file` | Create new files | New files only |
| `grep_search` | ripgrep with hash-annotated results | Finding code patterns |
| `bulk_replace` | Text rename/refactor across files | Renaming variables, updating imports |
| `verify` | Check if held checksums still valid | Before editing after a pause |
| `directory_tree` | Compact tree with .gitignore support | Exploring project structure |
| `get_file_info` | File metadata (size, mtime, type) | Quick file checks |
| `changes` | Git-based semantic diff | Reviewing modifications |
| `setup_hooks` | Install hooks for agents | Initial setup |

**Hash format:** `{tag}.{lineNum}\t{content}` where tag = 2-char FNV-1a.
**Checksums:** `checksum: start-end:8hex` after each read range.

## Detection Sequence

1. **hex-line-mcp MCP** — `read_file`/`outline` in tool list → use MCP
2. **Standard tools** — fallback. Built-in Read/Edit/Write/Grep

## When to Use

- **USE for CODE files** (.ts, .js, .py, .go, .rs, .java, etc.)
- **USE for markdown structure discovery:** prefer `outline` first for larger `.md` files, then targeted reads by section
- **DO NOT use for:** tiny JSON/YAML files where a full read is cheaper than hash/anchor setup
- **Workflow:** outline → read (specific ranges) → edit by anchor → verify. Text rename → bulk_replace

## Setup

```bash
npx -y @levnikolaevich/hex-line-mcp
claude mcp add -s user hex-line -- npx -y @levnikolaevich/hex-line-mcp
```

---
**Version:** 5.0.0
**Last Updated:** 2026-03-20
