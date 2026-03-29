# Tools Config Guide

<!-- SCOPE: How skills read, bootstrap, and update docs/tools_config.md in target projects. Single Source of Truth for tool availability detection and runtime error handling. -->

## Phase 0: Read or Bootstrap (standard for ALL skills needing external tools)

```
1. Read docs/tools_config.md
2. IF file missing:
   a. FOR EACH tool category → run Detection (per section in template)
   b. Write docs/tools_config.md with detected values
   c. WARN user: "Created docs/tools_config.md. Review and adjust if needed."
3. Extract required settings (task_provider, research_chain, agents, git)
4. Use provider values to select operations (per storage_mode_detection.md)
```

**MANDATORY READ:** Load this file in Phase 0 of any skill that uses external tools (Linear, MCP Ref, agents, git worktree).

## Config Sections

| Section | Key Fields |
|---------|-----------|
| **Task Management** | Provider (linear/file), Status, Team ID, Fallback |
| **Research** | Provider (ref/context7/websearch), Fallback chain |
| **File Editing** | Provider — see `mcp_tool_preferences.md` |
| **External Agents** | Agent statuses (codex, gemini) |
| **Git** | Worktree (available/unavailable), Branch strategy |

## Runtime Error Handling

```
FOR EACH tool operation:
  TRY primary tool (per Provider in config)
  ON SUCCESS → continue
  ON ERROR (401/403/429/500/timeout):
    1. WARN user (ONE TIME per tool per session):
       "⚠️ {tool} unavailable: {error}. Using {fallback}.
        Fix: {troubleshooting from tools_config.md}"
    2. UPDATE docs/tools_config.md:
       Provider → fallback value
       Status → "unavailable ({error}, {date})"
    3. EXECUTE via fallback
```

**Circuit Breaker:** After first error, disable tool for rest of session. Do NOT retry on every operation.

## Bootstrap Detection Order

When creating tools_config.md from scratch, detect tools in this order:

| Step | Tool | Detection Method |
|------|------|-----------------|
| 1 | Linear MCP | Call `list_teams()`. Success → active. 401 → auth expired. Not found → unavailable |
| 2 | MCP Ref | Call `ref_search_documentation(query="test")`. Success → active |
| 3 | MCP Context7 | Call `resolve-library-id(libraryName="react")`. Success → active |
| 4 | File Editing tools | Per mcp_tool_preferences.md detection sequence |
| 5 | Agents | Run `codex --version` / `gemini --version`. Exit 0 → available |
| 6 | Git worktree | Run `git worktree list`. Success → available |

## Usage in SKILL.md

```markdown
**MANDATORY READ:** Load `shared/references/tools_config_guide.md`

## Phase 0: Tools Config
Read `docs/tools_config.md` (bootstrap if missing per tools_config_guide.md).
Extract: task_provider = {Task Management → Provider}
```

---
**Version:** 1.0.0
**Last Updated:** 2026-03-04
