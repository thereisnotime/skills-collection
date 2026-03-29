# Universal Validator & Source of Truth Alignment

## Context

The claude-code-plugins ecosystem has **4 competing validators** and **3 reference docs** that all say different things about what's valid. The Python validator checks agent fields (`capabilities`, `expertise_level`, `activation_priority`) that don't exist in the Anthropic spec, while missing fields that DO (`tools`, `disallowedTools`, `maxTurns`, `memory`, `background`, `isolation`). The shell validator requires 4 plugin.json fields as errors when Anthropic only requires `name`. No validator checks a plugin as a complete unit. Result: 95% of skills are non-compliant with our own stated policy ("if Anthropic says optional, we require it").

**User's mandate**: "We play by the book. If it's optional we require it. No drift from Anthropic."

**This plan**: Build ONE universal validator with schemas derived directly from Anthropic docs, update the reference docs to match, and add compliance tracking to the inventory.

## Anthropic Official Schemas (from code.claude.com, fetched 2026-03-21)

### Skill Frontmatter (11 fields — ALL required per our policy)
```yaml
name: string              # kebab-case, max 64 chars (defaults to dir name)
description: string       # what + when to use (defaults to first paragraph)
allowed-tools: string     # comma-separated tool names
model: string             # sonnet|haiku|opus|inherit|full-id
effort: string            # low|medium|high|max
argument-hint: string     # autocomplete hint
context: string           # "fork" only
agent: string             # subagent type (requires context: fork)
user-invocable: boolean   # default: true
disable-model-invocation: boolean  # default: false
hooks: object             # lifecycle hooks
```

### SKILL.md Body Template (required subsections)

The body of every SKILL.md must contain these sections in this order:
```markdown
# {Skill Title}

{One-line summary of what the skill does.}

## Overview
{What this skill does, why it exists, what problem it solves.}

## Prerequisites
{What must be installed/configured/available before using this skill.}

## Instructions
{Step-by-step workflow. Numbered steps. The core of the skill.}

## Output
{What the skill produces. Expected results, artifacts, side effects.}

## Error Handling
{Common errors, recovery steps, troubleshooting table.}

## Examples
{Concrete usage examples with code blocks.}

## Resources
{External links, related skills, reference docs.}
```

**Source of truth**: Intent Solutions enterprise standard, derived from Anthropic's example skill patterns. Anthropic says body is free-form — we choose to enforce structure. Missing any section = **ERROR** in enterprise tier. All 7 required.

### SKILL.md Line Limit (Anthropic mandate)
Anthropic says: "Keep SKILL.md under 500 lines. Move detailed reference material to separate files."
- **301-500 lines = WARNING**: "Approaching limit. Consider extracting to references/."
- **>500 lines = ERROR**: "Exceeds Anthropic 500-line limit. Must extract to references/."
- Rubric Token Economy scoring unchanged: ≤150=10pts, 151-300=7pts, 301-500=4pts, >500=0pts

### Skill Supporting Files (required per our policy, even if empty)
```
skill-name/
├── SKILL.md        (required)
├── references/     (required — directory with .md files, loaded on demand)
├── examples/       (optional — OR examples in SKILL.md ## Examples)
└── scripts/        (required if skill uses ${CLAUDE_SKILL_DIR}/scripts/)
```

Note: It's `references/` (directory, plural), NOT `reference.md` (singular file). Zero files named `reference.md` exist in the repo. The pattern is a directory.

### Agent Frontmatter (14 fields — name+description required by Anthropic)
```yaml
name: string              # REQUIRED by Anthropic
description: string       # REQUIRED by Anthropic
model: string             # sonnet|haiku|opus|inherit
effort: string            # low|medium|high|max
maxTurns: integer          # max agentic turns
tools: string             # comma-separated allowlist
disallowedTools: string   # comma-separated denylist
skills: array             # skill names to preload
mcpServers: object|array  # MCP server configs
hooks: object             # lifecycle hooks
memory: string            # user|project|local
background: boolean       # run as background task
isolation: string         # "worktree" only
permissionMode: string    # default|acceptEdits|dontAsk|bypassPermissions|plan
```

**Plugin agents restriction**: `hooks`, `mcpServers`, `permissionMode` NOT supported (ignored silently).

### Plugin Manifest — plugin.json (only `name` required by Anthropic)
```json
{
  "name": "string (REQUIRED)",
  "version": "string (semver)",
  "description": "string",
  "author": {"name": "string", "email": "string", "url": "string"},
  "homepage": "string",
  "repository": "string",
  "license": "string (SPDX)",
  "keywords": ["array"],
  "commands": "string|array (component path)",
  "agents": "string|array",
  "skills": "string|array",
  "hooks": "string|array|object",
  "mcpServers": "string|array|object",
  "outputStyles": "string|array",
  "lspServers": "string|array|object"
}
```

### Plugin Directory Structure (Anthropic official)
```
plugin-root/
├── .claude-plugin/plugin.json   (manifest, optional)
├── commands/                    (legacy — use skills/)
├── agents/                      (agent markdown files)
├── skills/skill-name/SKILL.md   (skill directories)
├── hooks/hooks.json             (hook configuration)
├── .mcp.json                    (MCP server definitions)
├── .lsp.json                    (LSP server configurations)
├── settings.json                (default plugin settings)
├── scripts/                     (utility scripts)
├── LICENSE
└── CHANGELOG.md
```

### Our Enterprise Additions (on top of Anthropic, for marketplace listing)
Skills get 5 extra fields: `version`, `author`, `license`, `compatible-with`, `tags`
Total skill fields: **16** (11 Anthropic + 5 enterprise)

### NOT in Anthropic Spec (currently in our validator — REMOVE)
- `capabilities` (agent field — invented by us)
- `expertise_level` (agent field — invented by us)
- `activation_priority` (agent field — invented by us)
- `when_to_use` (deprecated skill field)
- `mode` (deprecated skill field)
- `compatibility` (AgentSkills.io, not Anthropic)
- `metadata` (AgentSkills.io, not Anthropic)

## What's Wrong Today

| Problem | Evidence |
|---------|----------|
| **5 validators, not 4** | Python (`validate-skills-schema.py`), Shell (`validate-all-plugins.sh`), ccpi TS skills (`packages/cli/src/lib/validator/skills.ts`), ccpi TS frontmatter (`packages/cli/src/lib/validator/frontmatter.ts`), + 3 reference docs |
| **CI uses ccpi, not Python** | `validate-plugins.yml` lines 407-418 call `ccpi validate --strict/--skills/--frontmatter`. The Python validator is NOT called in CI. |
| Agent validator checks wrong fields | Checks `capabilities`, `expertise_level`, `activation_priority` — none in Anthropic spec. Misses `tools`, `disallowedTools`, `maxTurns`, `memory`, `background`, `isolation` |
| `effort` missing `max` | Line 730 Python: `['low', 'medium', 'high']`. ccpi frontmatter.ts same bug. Anthropic says `max` is valid (Opus 4.6). |
| `disallowedTools` type wrong | Python validator correctly checks array (line 819). But plan schema had it as string. It's an array. |
| Skill validator requires nothing | `STANDARD_REQUIRED = set()` on line 65. Enterprise tier only warns. |
| Shell validator disagrees | Requires `version`, `description`, `author` in plugin.json as ERRORS. Anthropic only requires `name`. |
| No plugin-level validation | Nobody validates a plugin as a unit |
| Stub detection missing | No check for empty supporting files, generic descriptions, zero code blocks |
| 95% of skills have 7 fields | Most need more per our policy. 1,356 skills non-compliant. |
| Reference docs conflict | 3 reference docs say slightly different things |
| `reference.md` doesn't exist | Plan said require `reference.md` (singular). Zero files with that name exist. Pattern is `references/` directory. |
| 100-point rubric gaps | Rubric hardcodes 6 fields in `score_spec_compliance()` line 425. Doesn't score `tags`, `compatible-with`, `model`, `effort`. Metadata Quality (10 pts) only checks 5 fields. |
| No dates/timestamps on anything | Inventory has no created/modified timestamps. Compliance has no audit trail. |

## Architecture: One Universal Validator

### Design Principles
1. **Schema-driven** — field definitions in YAML files, not hardcoded Python sets
2. **Component-aware** — auto-detects skill vs agent vs plugin vs command
3. **Two tiers preserved** — Standard (Anthropic minimum) + Enterprise (our policy)
4. **Plugin-as-unit** — when pointed at a plugin dir, validates EVERYTHING inside
5. **Stub detection** — flags empty files, generic descriptions, missing substance
6. **JSON output** — machine-readable results for inventory integration

### File: `scripts/validate-skills-schema.py` (ENHANCE, not replace)

Rewrite the existing validator in place. Keep the 100-point rubric. Fix these:

#### A. Schema Registry (new, top of file)
```python
SKILL_FIELDS = {
    # Anthropic official (all required per our policy)
    'name': {'type': 'string', 'source': 'anthropic', 'tier': 'standard'},
    'description': {'type': 'string', 'source': 'anthropic', 'tier': 'standard'},
    'allowed-tools': {'type': 'string', 'source': 'anthropic', 'tier': 'standard'},
    'model': {'type': 'string', 'source': 'anthropic', 'tier': 'standard', 'valid': ['sonnet','haiku','opus','inherit']},
    'effort': {'type': 'string', 'source': 'anthropic', 'tier': 'standard', 'valid': ['low','medium','high','max']},
    'argument-hint': {'type': 'string', 'source': 'anthropic', 'tier': 'standard'},
    'context': {'type': 'string', 'source': 'anthropic', 'tier': 'standard', 'valid': ['fork']},
    'agent': {'type': 'string', 'source': 'anthropic', 'tier': 'standard'},
    'user-invocable': {'type': 'boolean', 'source': 'anthropic', 'tier': 'standard', 'default': True},
    'disable-model-invocation': {'type': 'boolean', 'source': 'anthropic', 'tier': 'standard', 'default': False},
    'hooks': {'type': 'object', 'source': 'anthropic', 'tier': 'standard'},
    # Enterprise additions
    'version': {'type': 'string', 'source': 'enterprise', 'tier': 'enterprise'},
    'author': {'type': 'string', 'source': 'enterprise', 'tier': 'enterprise'},
    'license': {'type': 'string', 'source': 'enterprise', 'tier': 'enterprise'},
    'compatible-with': {'type': 'string', 'source': 'enterprise', 'tier': 'enterprise'},
    'tags': {'type': 'array', 'source': 'enterprise', 'tier': 'enterprise'},
}

AGENT_FIELDS = {
    'name': {'type': 'string', 'source': 'anthropic', 'required': True},
    'description': {'type': 'string', 'source': 'anthropic', 'required': True},
    'model': {'type': 'string', 'source': 'anthropic', 'valid': ['sonnet','haiku','opus','inherit']},
    'effort': {'type': 'string', 'source': 'anthropic', 'valid': ['low','medium','high','max']},
    'maxTurns': {'type': 'integer', 'source': 'anthropic'},
    'tools': {'type': 'string', 'source': 'anthropic'},
    'disallowedTools': {'type': 'string', 'source': 'anthropic'},
    'skills': {'type': 'array', 'source': 'anthropic'},
    'mcpServers': {'type': 'object', 'source': 'anthropic'},
    'hooks': {'type': 'object', 'source': 'anthropic'},
    'memory': {'type': 'string', 'source': 'anthropic', 'valid': ['user','project','local']},
    'background': {'type': 'boolean', 'source': 'anthropic'},
    'isolation': {'type': 'string', 'source': 'anthropic', 'valid': ['worktree']},
    'permissionMode': {'type': 'string', 'source': 'anthropic', 'valid': ['default','acceptEdits','dontAsk','bypassPermissions','plan']},
}

PLUGIN_JSON_FIELDS = {
    'name': {'type': 'string', 'required': True},
    'version': {'type': 'string'},
    'description': {'type': 'string'},
    'author': {'type': 'object'},  # {name, email, url}
    'homepage': {'type': 'string'},
    'repository': {'type': 'string'},
    'license': {'type': 'string'},
    'keywords': {'type': 'array'},
    'commands': {'type': 'string|array'},
    'agents': {'type': 'string|array'},
    'skills': {'type': 'string|array'},
    'hooks': {'type': 'string|array|object'},
    'mcpServers': {'type': 'string|array|object'},
    'outputStyles': {'type': 'string|array'},
    'lspServers': {'type': 'string|array|object'},
}
```

#### B. Component Detection with Context (new)
```python
def detect_component(path: Path) -> tuple[str, str]:
    """Auto-detect component type AND context.

    Returns: (component_type, context)
    - component_type: 'skill', 'agent', 'command', 'plugin', 'unknown'
    - context: 'plugin', 'standalone', 'unknown'

    Context matters because:
    - Plugin agents CANNOT use: hooks, mcpServers, permissionMode (Anthropic restriction)
    - Standalone agents CAN use all 14 fields
    - Plugin skills need supporting files + plugin.json backing
    - Standalone skills (~/.claude/skills/) are self-contained
    """
    context = 'unknown'
    component = 'unknown'

    # Walk up to find if we're inside a plugin (has .claude-plugin/plugin.json ancestor)
    def find_plugin_root(p: Path) -> Optional[Path]:
        for parent in [p] + list(p.parents):
            if (parent / '.claude-plugin' / 'plugin.json').exists():
                return parent
        return None

    plugin_root = find_plugin_root(path)
    context = 'plugin' if plugin_root else 'standalone'

    if path.is_dir():
        if (path / '.claude-plugin' / 'plugin.json').exists():
            component = 'plugin'
        elif (path / 'SKILL.md').exists():
            component = 'skill'
    elif path.name == 'SKILL.md':
        component = 'skill'
    elif path.parent.name == 'agents':
        component = 'agent'
    elif path.parent.name == 'commands':
        component = 'command'

    return (component, context)
```

**Context-dependent rules:**

| Component | In Plugin | Standalone |
|-----------|-----------|------------|
| Skill | All 16 fields required. Supporting files required. Plugin.json must list it. | All 16 fields required. Supporting files required. No plugin.json check. |
| Agent | 14 fields minus 3 restricted (`hooks`, `mcpServers`, `permissionMode` ignored by runtime). Warn if present. | All 14 fields available. No restrictions. |
| Command | Legacy — warn to migrate to skills/ | Legacy — warn to migrate to skills/ |

#### C. Plugin-Level Validation (new)
When pointed at a plugin directory:
1. Validate plugin.json against `PLUGIN_JSON_FIELDS`
2. Walk `skills/*/SKILL.md` — validate each against `SKILL_FIELDS`
3. Walk `agents/*.md` — validate each against `AGENT_FIELDS`
4. Walk `commands/*.md` — validate each as command
5. Check `hooks/hooks.json` exists and is valid JSON with valid event names
6. Check `.mcp.json` exists and is valid JSON
7. Check `.lsp.json` exists and is valid JSON
8. Check supporting files per skill (reference.md, examples.md, scripts/)
9. Roll up: plugin score = weighted average of all component scores

#### D. Stub Detection (new)
A component is a "stub" if ANY of:
- SKILL.md body (after frontmatter) < 30 lines
- Zero code blocks AND zero markdown links to supporting files
- Supporting files exist but are empty (0 bytes)
- Description matches generic patterns: "A helpful tool", "Generates...", no "use when"/"trigger with"
- No `## Instructions` or `## Steps` section (skill has no actionable content)

#### E. Dependency-Aware Enterprise Enforcement (fix existing)

**Spec docs**: Show ALL 16 fields as available (source of truth for building new skills).
**Validator**: Only enforce fields that APPLY to this specific skill's configuration.
**Improvement flags**: If a skill could benefit from a field it doesn't have, flag as INFO ("facelift opportunity"), not error.

```python
# Core fields: ALWAYS required (every skill needs these)
ALWAYS_REQUIRED = {'name', 'description', 'allowed-tools', 'version', 'author', 'license', 'compatible-with', 'tags'}

# Conditional fields: required only when relevant
CONDITIONAL_FIELDS = {
    'context': lambda fm: fm.get('agent') is not None,      # required if agent is set
    'agent': lambda fm: fm.get('context') == 'fork',         # required if context=fork
    'argument-hint': lambda fm: fm.get('user-invocable', True) and not fm.get('disable-model-invocation', False),
    'user-invocable': lambda fm: True,                        # always validate if present, but default is fine
    'disable-model-invocation': lambda fm: True,              # always validate if present
    'model': lambda fm: True,                                 # recommend but don't error if missing
    'effort': lambda fm: True,                                # recommend but don't error if missing
    'hooks': lambda fm: False,                                # only required if skill actually uses hooks
}

# Facelift opportunities: fields that could improve the skill
FACELIFT_FIELDS = {
    'model': 'Setting an explicit model prevents unexpected behavior when session model changes',
    'effort': 'Setting effort level optimizes reasoning for this skill\'s complexity',
    'argument-hint': 'Adding argument-hint improves autocomplete UX for user-invocable skills',
}
```

#### F. Remove Invented Fields — ERROR on Everything Wrong
Delete from agent validation AND flag as ERROR if found:
- `capabilities` — ERROR: "Non-standard field. Not in Anthropic spec."
- `expertise_level` — ERROR
- `activation_priority` — ERROR
- `color`, `activation_triggers`, `type`, `category` — ERROR

No "tolerated" fields. No "transition period." Wrong is wrong. Fix it.

- `mode` — ERROR: "Deprecated. Use `disable-model-invocation: true` instead."
- `when_to_use` — ERROR: "Deprecated. Move content to `description` field."
- `compatibility` — ERROR: "AgentSkills.io field, not Anthropic. Remove or move to `metadata`."
- `metadata` — ERROR: "AgentSkills.io field, not Anthropic. Remove. Use top-level fields instead."

Every non-standard field is an error. We fix them all.

#### G. Fix `disallowedTools` Type
Schema registry must have `disallowedTools: {'type': 'array'}` not `'string'`. The existing validator (line 819) correctly checks `isinstance(fm['disallowedTools'], list)`.

#### H. Fix `effort` Validation
Delete hardcoded `VALID_EFFORT_LEVELS = ['low', 'medium', 'high']` (line 730). Add `'max'`. Use schema registry as single source.

#### I. Fix Supporting Files Requirement
NOT `reference.md` (singular) — that file doesn't exist anywhere. The actual pattern is:
- `references/` directory with `.md` files inside
- Check references/ directory exists and has content
- Check examples are present (either `## Examples` section OR `examples/` dir OR code blocks)
- Check scripts/ exists if skill uses `${CLAUDE_SKILL_DIR}/scripts/`

#### J. Kill ALL Old Validators — ONE Validator Only

**DELETE entirely:**
- `scripts/validate-all-plugins.sh` — shell validator with wrong requirements (version/description/author as errors in plugin.json)
- `packages/cli/src/lib/validator/frontmatter.ts` — ccpi frontmatter validator with invented agent fields
- `packages/cli/src/lib/validator/skills.ts` — ccpi skill validator with stale OPTIONAL_FIELDS

**The Python validator becomes the ONLY validator.** ccpi `validate` command delegates to it:
```typescript
// packages/cli/src/commands/validate.ts — rewrite to shell out to Python validator
import { execSync } from 'child_process';
const result = execSync(`python3 ${VALIDATOR_PATH} --json --enterprise ${targetPath}`);
```

**Update CI workflow** (`validate-plugins.yml`):
- Remove `validate-all-plugins.sh` call (line 400-402)
- Replace `ccpi validate --strict/--skills/--frontmatter` with direct Python validator calls
- Or keep ccpi as the CLI but make it delegate to Python

This eliminates 4 validators → 1 source of truth.

#### K. Dates and Timestamps on Everything

Every table in the inventory and compliance system must track when data was captured:

```python
# Add to ALL new and existing tables
'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
'validated_at TIMESTAMP'  # when last validated
'source_modified_at TIMESTAMP'  # file mtime from filesystem
```

Compliance tables get:
- `validated_at` — when the validator last ran on this component
- `source_modified_at` — file's actual mtime (detect stale validations)
- `validator_version` — version of the validator that produced this result

Inventory tables get:
- `discovered_at` — when the item was first seen
- `last_seen_at` — when the item was last confirmed to exist
- `file_mtime` — actual file modification time from `os.path.getmtime()`

This enables: "show me everything that changed since last Tuesday" and "show me stale validations"

#### L. Rubric Evaluation and Fixes

The current 100-point rubric has these allocation problems:

**Current rubric:**
| Pillar | Max | What it scores |
|--------|-----|----------------|
| Progressive Disclosure | 30 | Token economy, layered structure, reference depth, navigation |
| Ease of Use | 25 | Metadata (10), discoverability (6), terminology (4), workflow clarity (5) |
| Utility | 20 | Problem solving (8), degrees of freedom (5), feedback loops (4), examples (3) |
| Spec Compliance | 15 | Frontmatter validity (5), name conventions (4), description quality (4), optional fields (2) |
| Writing Style | 10 | Voice/tense (4), objectivity (3), conciseness (3) |
| Modifiers | ±15 | Bonuses/penalties |

**Problems found:**
1. **Spec Compliance (15 pts)** — `score_spec_compliance()` line 425 hardcodes `required = {'name', 'description', 'allowed-tools', 'version', 'author', 'license'}`. Doesn't score `tags`, `compatible-with`, `model`, `effort`, or any Anthropic extension fields.
2. **Metadata Quality (10 pts)** in Ease of Use — only checks 5 things: name (+2), description (+3), version (+2), allowed-tools (+2), author with email (+1). Doesn't check `tags`, `compatible-with`, `model`, `effort`.
3. **Optional Fields (2 pts)** in Spec Compliance — only validates `model` value. Should validate all Anthropic optional fields.
4. **No stub penalty** — a skill with 15 lines and zero code blocks scores the same on Progressive Disclosure as a well-structured skill if it has no references/ (both get "N/A").
5. **No supporting files score** — having references/ vs not having it doesn't directly affect the score unless the skill is >100 lines.

**Fixes:**
1. `score_spec_compliance()` — derive required set from `ALWAYS_REQUIRED` schema registry, not hardcoded set
2. Add new sub-score: **Field Coverage (3 pts)** — how many of the applicable fields are present (scales with dependency logic)
3. **Metadata Quality** — expand to score `tags` (+1), `compatible-with` (+1), replace the existing 10-point allocation
4. Add **Stub Penalty** as modifier: -3 for body <30 lines with no code blocks and no references
5. Add **Supporting Files Bonus** as modifier: +1 for having `references/` with real content (not empty)
6. Total rubric stays 100 points but with updated allocations

**Updated Spec Compliance (15 pts):**
| Sub-score | Points | What |
|-----------|--------|------|
| Frontmatter Validity | 5 | Valid YAML, no parse errors, all ALWAYS_REQUIRED fields present |
| Name Conventions | 3 | Kebab-case, proper length, matches directory |
| Description Quality | 4 | Proper length, no forbidden person, has "use when" |
| Field Coverage | 3 | Percentage of applicable fields present (conditional-aware) |

### CLI Interface (enhanced)
```bash
# Validate a single skill
python3 scripts/validate-skills-schema.py path/to/SKILL.md

# Validate a single agent
python3 scripts/validate-skills-schema.py path/to/agents/foo.md

# Validate an entire plugin (all components)
python3 scripts/validate-skills-schema.py path/to/plugin-dir/

# Validate everything
python3 scripts/validate-skills-schema.py plugins/

# Output JSON for inventory integration
python3 scripts/validate-skills-schema.py --json plugins/

# Flags
--enterprise          # Enterprise tier (default in CI)
--standard            # Standard tier (Anthropic minimum only)
--json                # JSON output for machine consumption
--stub-check          # Include stub detection
--fix                 # Auto-fix missing fields with defaults
```

## Reference Doc Updates

### File: `plugins/skill-enhancers/skill-creator/skills/skill-creator/references/frontmatter-spec.md`
- Update to show all 11 Anthropic fields as required
- Mark 5 enterprise fields as "marketplace required"
- Remove `compatibility`, `metadata` from the main spec (they're AgentSkills.io, not Anthropic)
- Add clear note: "Source: https://code.claude.com/docs/en/skills"

### File: `plugins/skill-enhancers/skill-creator/skills/skill-creator/references/validation-rules.md`
- Kill "Standard tier: only name and description required" language
- Enterprise tier: all 16 fields required as ERRORS
- Add agent validation rules (14 Anthropic fields)
- Add plugin-level validation rules
- Add stub detection rules
- Add supporting file requirements

### File: `plugins/skill-enhancers/skill-creator/skills/skill-creator/references/source-of-truth.md`
- Align with frontmatter-spec.md (they must say exactly the same thing)
- Add "Last synced with Anthropic docs: 2026-03-21" timestamp

### File: `plugins/skill-enhancers/validate-plugin/skills/validate-plugin/references/plugin-schema.md`
- Update to include all 15 plugin.json fields from Anthropic
- Add component path fields (commands, agents, skills, hooks, mcpServers, outputStyles, lspServers)
- Add directory structure requirements

## Inventory Enhancement (freshie/inventory.sqlite)

### New Tables

```sql
CREATE TABLE skill_compliance (
    id INTEGER PRIMARY KEY,
    skill_path TEXT UNIQUE,
    total_fields INTEGER,         -- how many of 16 fields present
    anthropic_fields INTEGER,     -- how many of 11 Anthropic fields
    enterprise_fields INTEGER,    -- how many of 5 enterprise fields
    missing_fields TEXT,          -- JSON array of missing field names
    has_reference_md INTEGER,
    has_examples_md INTEGER,
    has_scripts_dir INTEGER,
    is_stub INTEGER,              -- stub detection flag
    stub_reasons TEXT,            -- JSON array of why it's a stub
    score INTEGER,                -- 100-point rubric score
    grade TEXT,                   -- A/B/C/D/F
    validated_at TIMESTAMP
);

CREATE TABLE agent_compliance (
    id INTEGER PRIMARY KEY,
    agent_path TEXT UNIQUE,
    total_fields INTEGER,
    anthropic_fields INTEGER,
    missing_fields TEXT,
    has_invalid_fields INTEGER,   -- fields not in Anthropic spec
    invalid_fields TEXT,          -- JSON array
    is_plugin_agent INTEGER,      -- if in plugin, restricted fields apply
    validated_at TIMESTAMP
);

CREATE TABLE plugin_compliance (
    id INTEGER PRIMARY KEY,
    plugin_path TEXT UNIQUE,
    plugin_json_valid INTEGER,
    plugin_json_fields INTEGER,
    skill_count INTEGER,
    skill_avg_score REAL,
    agent_count INTEGER,
    agent_valid_count INTEGER,
    has_hooks_json INTEGER,
    has_mcp_json INTEGER,
    has_lsp_json INTEGER,
    has_settings_json INTEGER,
    has_license INTEGER,
    has_changelog INTEGER,
    overall_score REAL,
    validated_at TIMESTAMP
);
```

### Update Existing Tables
- `agent_files`: add columns for `tools`, `disallowedTools`, `maxTurns`, `skills`, `memory`, `background`, `isolation`, `permissionMode`. Remove `capabilities`, `expertise_level`, `activation_priority`.
- `plugin_companions`: add `has_hooks_dir`, `has_lsp_json`, `has_settings_json`, `has_license`, `has_changelog`

## Implementation Approach: Agent-Driven, No Throwaway Scripts

**No `/tmp/` scripts.** All work goes directly into source files.

**Subagents own individual components.** Each agent is responsible for designing, building, and testing one piece. They write directly into the real files, not disposable scripts. This ensures each component gets focused attention and quality work, rather than one monolithic script trying to do everything.

**Agent assignments during execution:**

| Agent | Responsibility | Output File(s) |
|-------|---------------|----------------|
| **Spec Agent** | Align all 4 reference docs to Anthropic. Write the canonical field definitions. | `frontmatter-spec.md`, `validation-rules.md`, `source-of-truth.md`, `plugin-schema.md` |
| **Skill Validator Agent** | Build schema registry + skill validation logic (11 Anthropic + 5 enterprise fields, supporting files, stub detection) | `validate-skills-schema.py` (skill sections) |
| **Agent Validator Agent** | Rewrite agent validation (14 Anthropic fields, plugin vs standalone context rules) | `validate-skills-schema.py` (agent sections) |
| **Plugin Validator Agent** | Build plugin-as-unit validation (walks all components, rolls up scores, checks directory structure) | `validate-skills-schema.py` (plugin sections) |
| **Compliance DB Agent** | Design and populate compliance tables, update inventory schema | `freshie/inventory.sqlite` |

Each agent reads the Anthropic spec data (provided in prompt), reads the existing code, and produces production-quality output. Main context stays clean — coordinates and reviews.

## Execution Plan

### Phase 1: Schema & Reference Doc Alignment (do first, before any code)
1. Update `frontmatter-spec.md` — align to Anthropic 11 + enterprise 5
2. Update `validation-rules.md` — align tiers, add agent/plugin/standalone rules
3. Update `source-of-truth.md` — sync with frontmatter-spec
4. Update `plugin-schema.md` — add all 15 plugin.json fields + directory structure

### Phase 2: Universal Validator Enhancement (directly in `validate-skills-schema.py`)

**Agent: Skill Validator Agent**
1. Add schema registry (SKILL_FIELDS, AGENT_FIELDS, PLUGIN_JSON_FIELDS) — single source of truth for field definitions
2. Add `detect_component()` with context awareness (plugin vs standalone)
3. Fix `VALID_EFFORT_LEVELS` — add `'max'`
4. Fix `disallowedTools` type in schema — array, not string
5. All non-standard fields = ERROR. No tolerance. `mode`, `when_to_use`, `compatibility`, `metadata`, `capabilities`, etc. all ERROR.
5b. Add body template validation — check for required sections: Overview, Prerequisites, Instructions, Output, Error Handling, Examples, Resources
6. Dependency-aware enforcement: ALWAYS_REQUIRED (8 core) + CONDITIONAL_FIELDS (contextual)
7. Add `--json` output mode (include agents/commands in output, not just skills)
8. Add `--populate-db <path>` flag — write results into SQLite with timestamps
9. `--fix` mode: only auto-fill safe defaults (name, version, author, license, user-invocable, disable-model-invocation, model). Emit "Cannot auto-fix: requires human judgment" for description, allowed-tools, tags, hooks, argument-hint, context, agent.

**Agent: Agent Validator Agent**
10. Rewrite `validate_agent()` — Anthropic 14 fields
11. Remove `capabilities`, `expertise_level`, `activation_priority`, `color`, `activation_triggers`, `type`, `category`
12. Add plugin context restriction — warn if hooks/mcpServers/permissionMode present in plugin agent

**Agent: Plugin Validator Agent**
13. Add `validate_plugin()` — walks plugin dir, validates all components, rolls up scores
14. Add `validate_supporting_files()` — checks references/ dir (NOT reference.md singular), examples presence, scripts
15. Add `detect_stub()` — flags body <30 lines with no code blocks and no references (configurable, context-aware for fork skills)
16. Plugin-level: validate what EXISTS, don't error on missing optional dirs (agents/, hooks/, .mcp.json)

**Agent: Rubric Agent**
17. Update `score_spec_compliance()` — derive required set from ALWAYS_REQUIRED, not hardcoded line 425
18. Add Field Coverage sub-score (3 pts) — percentage of applicable fields present
19. Expand Metadata Quality in `score_ease_of_use()` — add `tags` (+1), `compatible-with` (+1)
20. Add stub penalty modifier (-3) and supporting files bonus (+1)
21. Add timestamps to all scoring output

### Phase 2.5: Kill ALL Old Validators

**Agent: Cleanup Agent**
1. **DELETE** `scripts/validate-all-plugins.sh`
2. **DELETE** `packages/cli/src/lib/validator/frontmatter.ts`
3. **DELETE** `packages/cli/src/lib/validator/skills.ts`
4. **REWRITE** `packages/cli/src/commands/validate.ts` — delegate to Python validator via subprocess
5. **UPDATE** `.github/workflows/validate-plugins.yml` — replace all old validator calls with Python validator
6. **UPDATE** CLAUDE.md, README.md, any docs referencing old validators
7. Remove dead imports and references in ccpi CLI code

### Phase 3: Inventory Compliance Layer (via validator --populate-db)

**Agent: Compliance DB Agent**
1. Create `skill_compliance`, `agent_compliance`, `plugin_compliance` tables with full timestamps
2. All tables include: `validated_at`, `source_modified_at` (file mtime), `validator_version`
3. Run: `python3 validate-skills-schema.py --enterprise --populate-db freshie/inventory.sqlite plugins/`
4. Update `agent_files` schema — add Anthropic fields, remove invented ones
5. Update `plugin_companions` schema — add `has_hooks_dir`, `has_lsp_json`, `has_settings_json`, `has_license`, `has_changelog`
6. Add `file_mtime` column to `skills`, `plugins` tables for change tracking

### Phase 4: Verification
1. Run validator on all 1,426 skills — expect mass non-compliance (known, most have 7 of 8 ALWAYS_REQUIRED fields)
2. Run validator on all 153 agents — verify invented fields flagged, Anthropic fields checked
3. Run validator on all 349 plugins as units — verify plugin-level roll-up works
4. Verify compliance tables populated with correct counts and timestamps
5. Spot-check: Jeremy's high-quality skills should score 85+ on updated rubric
6. Spot-check: saas-pack skills should show missing fields + stub flags where appropriate
7. Run `--fix` on one test skill to verify safe defaults applied correctly
8. Verify CI still passes after validator swap (the new validator should pass what the old ones passed)

## Critical Files

| File | Action |
|------|--------|
| `scripts/validate-skills-schema.py` | **THE universal validator** — schema registry, context-aware detection, plugin-as-unit, stub detection, rubric fixes, dates, --json, --populate-db |
| `scripts/validate-all-plugins.sh` | **DELETE** — replaced by Python validator |
| `packages/cli/src/lib/validator/frontmatter.ts` | **DELETE** — replaced by Python validator |
| `packages/cli/src/lib/validator/skills.ts` | **DELETE** — replaced by Python validator |
| `packages/cli/src/commands/validate.ts` | **REWRITE** — delegate to Python validator via subprocess |
| `.github/workflows/validate-plugins.yml` | **UPDATE** — call Python validator directly, remove shell validator references |
| `plugins/skill-enhancers/skill-creator/references/frontmatter-spec.md` | Update to Anthropic 11 + enterprise 5 |
| `plugins/skill-enhancers/skill-creator/references/validation-rules.md` | Rewrite tiers, add agent/plugin/standalone rules |
| `plugins/skill-enhancers/skill-creator/references/source-of-truth.md` | Sync with frontmatter-spec |
| `plugins/skill-enhancers/validate-plugin/references/plugin-schema.md` | Add all 15 plugin.json fields + directory structure |
| `freshie/inventory.sqlite` | Add 3 compliance tables with timestamps, update 2 existing tables |

## Git Workflow

Feature branch: `feat/universal-validator` off `main`

Commits (one per completed phase, solid messages):
1. `docs: align reference docs to Anthropic 2026 spec` — Phase 1
2. `feat: universal validator with Anthropic schema registry` — Phase 2 (validator enhancement)
3. `refactor: remove legacy validators, single source of truth` — Phase 2.5 (kill old validators)
4. `feat: compliance tables with timestamps in inventory` — Phase 3
5. `test: verify universal validator against all plugins` — Phase 4

PR when all phases complete — single PR with full audit trail.

Autonomous: auto-commit after passing tests, auto-push, create PR when ready. Check PR review comments before merge.

## What This Does NOT Cover (deferred)
- Mass migration of 1,356 skills to add missing fields (separate task after validator is solid)
- Repo vs website drift detection (separate task)
- Refresh orchestrator script (separate task)
- GitHub Actions scheduling (separate task)
