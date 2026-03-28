# Gemini CLI Spec (GEMINI.md, Commands, Skills, MCP, Settings)

Last verified: 2026-02-14

## Primary sources

```
https://github.com/google-gemini/gemini-cli
https://geminicli.com/docs/get-started/configuration/
https://geminicli.com/docs/cli/custom-commands/
https://geminicli.com/docs/cli/skills/
https://geminicli.com/docs/cli/creating-skills/
https://geminicli.com/docs/extensions/writing-extensions/
https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
```

## Config locations

- User-level config: `~/.gemini/settings.json`
- Project-level config: `.gemini/settings.json`
- Project-level takes precedence over user-level for most settings.
- GEMINI.md context file lives at project root (similar to CLAUDE.md).

## GEMINI.md context file

- A markdown file at project root loaded into every session's context.
- Used for project-wide instructions, coding standards, and conventions.
- Equivalent to Claude Code's CLAUDE.md.

## Custom commands (TOML format)

- Custom commands are TOML files stored in `.gemini/commands/`.
- Command name is derived from the file path: `.gemini/commands/git/commit.toml` becomes `/git:commit`.
- Directory-based namespacing: subdirectories create namespaced commands.
- Each command file has two fields:
  - `description` (string): One-line description shown in `/help`
  - `prompt` (string): The prompt sent to the model
- Supports placeholders:
  - `{{args}}` — user-provided arguments
  - `!{shell}` — output of a shell command
  - `@{file}` — contents of a file
- Example:

```toml
description = "Create a git commit with a good message"
prompt = """
Look at the current git diff and create a commit with a descriptive message.

User request: {{args}}
"""
```

## Skills (SKILL.md standard)

- A skill is a folder containing `SKILL.md` plus optional supporting files.
- Skills live in `.gemini/skills/`.
- `SKILL.md` uses YAML frontmatter with `name` and `description` fields.
- Gemini activates skills on demand via `activate_skill` tool based on description matching.
- The `description` field is critical — Gemini uses it to decide when to activate the skill.
- Format is identical to Claude Code's SKILL.md standard.
- Example:

```yaml
---
name: security-reviewer
description: Review code for security vulnerabilities and OWASP compliance
---

# Security Reviewer

Detailed instructions for security review...
```

## MCP server configuration

- MCP servers are configured in `settings.json` under the `mcpServers` key.
- Same MCP protocol as Claude Code; different config location.
- Supports `command`, `args`, `env` for stdio transport.
- Supports `url`, `headers` for HTTP/SSE transport.
- Additional Gemini-specific fields: `cwd`, `timeout`, `trust`, `includeTools`, `excludeTools`.
- Example:

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-playwright"]
    }
  }
}
```

## Hooks

- Gemini supports hooks: `BeforeTool`, `AfterTool`, `SessionStart`, etc.
- Hooks use a different format from Claude Code hooks (matchers-based).
- Not converted by the plugin converter — a warning is emitted.

## Extensions

- Extensions are distributable packages for Gemini CLI.
- They extend functionality with custom tools, hooks, and commands.
- Not used for plugin conversion (different purpose from Claude Code plugins).

## Settings.json structure

```json
{
  "model": "gemini-2.5-pro",
  "mcpServers": { ... },
  "tools": {
    "sandbox": true
  }
}
```

- Only the `mcpServers` key is written during plugin conversion.
- Other settings (model, tools, sandbox) are user-specific and out of scope.
