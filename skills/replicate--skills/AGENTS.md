# Replicate Skills: Agent Notes

## Purpose

This repo publishes a single Agent Skills document for Replicate.

Keep it short and focused: a human- and agent-readable guide to discovering models, inspecting schemas, running predictions, and handling outputs.

## Files that matter

- `skills/replicate/SKILL.md` is the canonical skill.
- `.mcp.json` points to the remote MCP server.
- `.claude-plugin/` contains marketplace metadata for Claude Code.

## Editing guidelines

- Keep `SKILL.md` concise and practical. Prefer bullet lists over long prose.
- Treat `https://api.replicate.com/openapi.json` as the source of truth.
- Keep mentions of deprecated or unofficial endpoints out of the skill.
- Do not add language-specific client guidance unless explicitly requested.

## Linting

Lint before committing changes:

```
script/lint
```
