---
title: Add Gemini CLI as a Target Provider
type: feat
status: completed
completed_date: 2026-02-14
completed_by: "Claude Opus 4.6"
actual_effort: "Completed in one session"
date: 2026-02-14
---

# Add Gemini CLI as a Target Provider

## Overview

Add `gemini` as a sixth target provider in the converter CLI, alongside `opencode`, `codex`, `droid`, `cursor`, and `pi`. This enables `--to gemini` for both `convert` and `install` commands, converting Claude Code plugins into Gemini CLI-compatible format.

Gemini CLI ([google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)) is Google's open-source AI agent for the terminal. It supports GEMINI.md context files, custom commands (TOML format), agent skills (SKILL.md standard), MCP servers, and extensions -- making it a strong conversion target with good coverage of Claude Code plugin concepts.

## Component Mapping

| Claude Code | Gemini Equivalent | Notes |
|---|---|---|
| `agents/*.md` | `.gemini/skills/*/SKILL.md` | Agents become skills -- Gemini activates them on demand via `activate_skill` tool based on description matching |
| `commands/*.md` | `.gemini/commands/*.toml` | TOML format with `prompt` and `description` fields; namespaced via directory structure |
| `skills/*/SKILL.md` | `.gemini/skills/*/SKILL.md` | **Identical standard** -- copy directly |
| MCP servers | `settings.json` `mcpServers` | Same MCP protocol; different config location (`settings.json` vs `.mcp.json`) |
| `hooks/` | `settings.json` hooks | Gemini has hooks (`BeforeTool`, `AfterTool`, `SessionStart`, etc.) but different format; emit `console.warn` and skip for now |
| `.claude/` paths | `.gemini/` paths | Content rewriting needed |

### Key Design Decisions

**1. Agents become skills (not GEMINI.md context)**

With 29 agents, dumping them into GEMINI.md would flood every session's context. Instead, agents convert to skills -- Gemini autonomously activates them based on the skill description when relevant. This matches how Claude Code agents are invoked on demand via the Task tool.

**2. Commands use TOML format with directory-based namespacing**

Gemini CLI commands are `.toml` files where the path determines the command name: `.gemini/commands/git/commit.toml` becomes `/git:commit`. This maps cleanly from Claude Code's colon-namespaced commands (`workflows:plan` -> `.gemini/commands/workflows/plan.toml`).

**3. Commands use `{{args}}` placeholder**

Gemini's TOML commands support `{{args}}` for argument injection, mapping from Claude Code's `argument-hint` field. Commands with `argument-hint` get `{{args}}` appended to the prompt.

**4. MCP servers go into project-level settings.json**

Gemini CLI reads MCP config from `.gemini/settings.json` under the `mcpServers` key. The format is compatible -- same `command`, `args`, `env` fields, plus Gemini-specific `cwd`, `timeout`, `trust`, `includeTools`, `excludeTools`.

**5. Skills pass through unchanged**

Gemini adopted the same SKILL.md standard (YAML frontmatter with `name` and `description`, markdown body). Skills copy directly.

### TOML Command Format

```toml
description = "Brief description of the command"
prompt = """
The prompt content that will be sent to Gemini.

User request: {{args}}
"""
```

- `description` (string): One-line description shown in `/help`
- `prompt` (string): The prompt sent to the model; supports `{{args}}`, `!{shell}`, `@{file}` placeholders

### Skill (SKILL.md) Format

```yaml
---
name: skill-name
description: When and how Gemini should use this skill
---

# Skill Title

Detailed instructions...
```

Identical to Claude Code's format. The `description` field is critical -- Gemini uses it to decide when to activate the skill.

### MCP Server Format (settings.json)

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "env": { "KEY": "value" }
    }
  }
}
```

## Acceptance Criteria

- [x] `bun run src/index.ts convert --to gemini ./plugins/compound-engineering` produces valid Gemini config
- [x] Agents convert to `.gemini/skills/*/SKILL.md` with populated `description` in frontmatter
- [x] Commands convert to `.gemini/commands/*.toml` with `prompt` and `description` fields
- [x] Namespaced commands create directory structure (`workflows:plan` -> `commands/workflows/plan.toml`)
- [x] Commands with `argument-hint` include `{{args}}` placeholder in prompt
- [x] Commands with `disable-model-invocation: true` are still included (TOML commands are prompts, not code)
- [x] Skills copied to `.gemini/skills/` (identical format)
- [x] MCP servers written to `.gemini/settings.json` under `mcpServers` key
- [x] Existing `.gemini/settings.json` is backed up before overwrite, and MCP config is merged (not clobbered)
- [x] Content transformation rewrites `.claude/` and `~/.claude/` paths to `.gemini/` and `~/.gemini/`
- [x] `/workflows:plan` transformed to `/workflows:plan` (Gemini preserves colon namespacing via directories)
- [x] `Task agent-name(args)` transformed to `Use the agent-name skill to: args`
- [x] Plugins with hooks emit `console.warn` about format differences
- [x] Writer does not double-nest `.gemini/.gemini/`
- [x] `model` and `allowedTools` fields silently dropped (no Gemini equivalent in skills/commands)
- [x] Converter and writer tests pass
- [x] Existing tests still pass (`bun test`)

## Implementation

### Phase 1: Types

**Create `src/types/gemini.ts`**

```typescript
export type GeminiSkill = {
  name: string
  content: string // Full SKILL.md with YAML frontmatter
}

export type GeminiSkillDir = {
  name: string
  sourceDir: string
}

export type GeminiCommand = {
  name: string       // e.g. "plan" or "workflows/plan"
  content: string    // Full TOML content
}

export type GeminiBundle = {
  generatedSkills: GeminiSkill[]     // From agents
  skillDirs: GeminiSkillDir[]         // From skills (pass-through)
  commands: GeminiCommand[]
  mcpServers?: Record<string, {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }>
}
```

### Phase 2: Converter

**Create `src/converters/claude-to-gemini.ts`**

Core functions:

1. **`convertClaudeToGemini(plugin, options)`** -- main entry point
   - Convert each agent to a skill via `convertAgentToSkill()`
   - Convert each command via `convertCommand()`
   - Pass skills through as directory references
   - Convert MCP servers to settings-compatible object
   - Emit `console.warn` if `plugin.hooks` has entries

2. **`convertAgentToSkill(agent)`** -- agent -> SKILL.md
   - Frontmatter: `name` (from agent name), `description` (from agent description, max ~300 chars)
   - Body: agent body with content transformations applied
   - Prepend capabilities section if present
   - Silently drop `model` field (no Gemini equivalent)
   - If description is empty, generate from agent name: `"Use this skill for ${agent.name} tasks"`

3. **`convertCommand(command, usedNames)`** -- command -> TOML file
   - Preserve namespace structure: `workflows:plan` -> path `workflows/plan`
   - `description` field from command description
   - `prompt` field from command body with content transformations
   - If command has `argument-hint`, append `\n\nUser request: {{args}}` to prompt
   - Body: apply `transformContentForGemini()` transformations
   - Silently drop `allowedTools` (no Gemini equivalent)

4. **`transformContentForGemini(body)`** -- content rewriting
   - `.claude/` -> `.gemini/` and `~/.claude/` -> `~/.gemini/`
   - `Task agent-name(args)` -> `Use the agent-name skill to: args`
   - `@agent-name` references -> `the agent-name skill`
   - Skip file paths (containing `/`) and common non-command patterns

5. **`convertMcpServers(servers)`** -- MCP config
   - Map each `ClaudeMcpServer` entry to Gemini-compatible JSON
   - Pass through: `command`, `args`, `env`, `url`, `headers`
   - Drop `type` field (Gemini infers transport)

6. **`toToml(description, prompt)`** -- TOML serializer
   - Escape TOML strings properly
   - Use multi-line strings (`"""`) for prompt field
   - Simple string for description

### Phase 3: Writer

**Create `src/targets/gemini.ts`**

Output structure:

```
.gemini/
├── commands/
│   ├── plan.toml
│   └── workflows/
│       └── plan.toml
├── skills/
│   ├── agent-name-1/
│   │   └── SKILL.md
│   ├── agent-name-2/
│   │   └── SKILL.md
│   └── original-skill/
│       └── SKILL.md
└── settings.json          (only mcpServers key)
```

Core function: `writeGeminiBundle(outputRoot, bundle)`

- `resolveGeminiPaths(outputRoot)` -- detect if path already ends in `.gemini` to avoid double-nesting (follow droid writer pattern)
- Write generated skills to `skills/<name>/SKILL.md`
- Copy original skill directories to `skills/` via `copyDir()`
- Write commands to `commands/` as `.toml` files, creating subdirectories for namespaced commands
- Write `settings.json` with `{ "mcpServers": {...} }` via `writeJson()` with `backupFile()` for existing files
- If settings.json exists, read it first and merge `mcpServers` key (don't clobber other settings)

### Phase 4: Wire into CLI

**Modify `src/targets/index.ts`**

```typescript
import { convertClaudeToGemini } from "../converters/claude-to-gemini"
import { writeGeminiBundle } from "./gemini"
import type { GeminiBundle } from "../types/gemini"

// Add to targets:
gemini: {
  name: "gemini",
  implemented: true,
  convert: convertClaudeToGemini as TargetHandler<GeminiBundle>["convert"],
  write: writeGeminiBundle as TargetHandler<GeminiBundle>["write"],
},
```

**Modify `src/commands/convert.ts`**

- Update `--to` description: `"Target format (opencode | codex | droid | cursor | pi | gemini)"`
- Add to `resolveTargetOutputRoot`: `if (targetName === "gemini") return path.join(outputRoot, ".gemini")`

**Modify `src/commands/install.ts`**

- Same two changes as convert.ts

### Phase 5: Tests

**Create `tests/gemini-converter.test.ts`**

Test cases (use inline `ClaudePlugin` fixtures, following existing converter test patterns):

- Agent converts to skill with SKILL.md frontmatter (`name` and `description` populated)
- Agent with empty description gets default description text
- Agent with capabilities prepended to body
- Agent `model` field silently dropped
- Agent with empty body gets default body text
- Command converts to TOML with `prompt` and `description` fields
- Namespaced command creates correct path (`workflows:plan` -> `workflows/plan`)
- Command with `disable-model-invocation` is still included
- Command `allowedTools` silently dropped
- Command with `argument-hint` gets `{{args}}` placeholder in prompt
- Skills pass through as directory references
- MCP servers convert to settings.json-compatible config
- Content transformation: `.claude/` paths -> `.gemini/`
- Content transformation: `~/.claude/` paths -> `~/.gemini/`
- Content transformation: `Task agent(args)` -> natural language skill reference
- Hooks present -> `console.warn` emitted
- Plugin with zero agents produces empty generatedSkills array
- Plugin with only skills works correctly
- TOML output is valid (description and prompt properly escaped)

**Create `tests/gemini-writer.test.ts`**

Test cases (use temp directories, following existing writer test patterns):

- Full bundle writes skills, commands, settings.json
- Generated skills written as `skills/<name>/SKILL.md`
- Original skills copied to `skills/` directory
- Commands written as `.toml` files in `commands/` directory
- Namespaced commands create subdirectories (`commands/workflows/plan.toml`)
- MCP config written as valid JSON `settings.json` with `mcpServers` key
- Existing `settings.json` is backed up before overwrite
- Output root already ending in `.gemini` does NOT double-nest
- Empty bundle produces no output

### Phase 6: Documentation

**Create `docs/specs/gemini.md`**

Document the Gemini CLI spec as reference, following existing `docs/specs/codex.md` pattern:

- GEMINI.md context file format
- Custom commands format (TOML with `prompt`, `description`)
- Skills format (identical SKILL.md standard)
- MCP server configuration (`settings.json`)
- Extensions system (for reference, not converted)
- Hooks system (for reference, format differences noted)
- Config file locations (user-level `~/.gemini/` vs project-level `.gemini/`)
- Directory layout conventions

**Update `README.md`**

Add `gemini` to the supported targets in the CLI usage section.

## What We're NOT Doing

- Not converting hooks (Gemini has hooks but different format -- `BeforeTool`/`AfterTool` with matchers -- warn and skip)
- Not generating full `settings.json` (only `mcpServers` key -- user-specific settings like `model`, `tools.sandbox` are out of scope)
- Not creating extensions (extension format is for distributing packages, not for converted plugins)
- Not using `@{file}` or `!{shell}` placeholders in converted commands (would require analyzing command intent)
- Not transforming content inside copied SKILL.md files (known limitation -- skills may reference `.claude/` paths internally)
- Not clearing old output before writing (matches existing target behavior)
- Not merging into existing settings.json intelligently beyond `mcpServers` key (too risky to modify user config)

## Complexity Assessment

This is a **medium change**. The converter architecture is well-established with five existing targets, so this is mostly pattern-following. The key novelties are:

1. The TOML command format (unique among all targets -- need simple TOML serializer)
2. Agents map to skills rather than a direct 1:1 concept (but this is the same pattern as codex)
3. Namespaced commands use directory structure (new approach vs flattening in cursor/codex)
4. MCP config goes into a broader `settings.json` file (need to merge, not clobber)

Skills being identical across platforms simplifies things significantly. The TOML serialization is simple (only two fields: `description` string and `prompt` multi-line string).

## References

- [Gemini CLI Repository](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Configuration](https://geminicli.com/docs/get-started/configuration/)
- [Custom Commands (TOML)](https://geminicli.com/docs/cli/custom-commands/)
- [Agent Skills](https://geminicli.com/docs/cli/skills/)
- [Creating Skills](https://geminicli.com/docs/cli/creating-skills/)
- [Extensions](https://geminicli.com/docs/extensions/writing-extensions/)
- [MCP Servers](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)
- Existing cursor plan: `docs/plans/2026-02-12-feat-add-cursor-cli-target-provider-plan.md`
- Existing codex converter: `src/converters/claude-to-codex.ts` (has `uniqueName()` and skill generation patterns)
- Existing droid writer: `src/targets/droid.ts` (has double-nesting guard pattern)
- Target registry: `src/targets/index.ts`

## Completion Summary

### What Was Delivered
- [x] Phase 1: Types (`src/types/gemini.ts`)
- [x] Phase 2: Converter (`src/converters/claude-to-gemini.ts`)
- [x] Phase 3: Writer (`src/targets/gemini.ts`)
- [x] Phase 4: CLI wiring (`src/targets/index.ts`, `src/commands/convert.ts`, `src/commands/install.ts`)
- [x] Phase 5: Tests (`tests/gemini-converter.test.ts`, `tests/gemini-writer.test.ts`)
- [x] Phase 6: Documentation (`docs/specs/gemini.md`, `README.md`)

### Implementation Statistics
- 10 files changed
- 27 new tests added (129 total, all passing)
- 148 output files generated from compound-engineering plugin conversion
- 0 dependencies added

### Git Commits
- `201ad6d` feat(gemini): add Gemini CLI as sixth target provider
- `8351851` docs: add Gemini CLI spec and update README with gemini target

### Completion Details
- **Completed By:** Claude Opus 4.6
- **Date:** 2026-02-14
- **Session:** Single session
