# AGENTS.md

Agent context for working in this repository.

## Purpose

This repo is a personal collection of [Agent Skills](https://agentskills.io/) installable via the [`skills` CLI](https://github.com/vercel-labs/skills). Skills are reusable instruction sets that extend AI coding agent capabilities across tools like Claude Code, OpenCode, Cursor, Codex, and others.

## Repository Structure

```
skills/
├── AGENTS.md                  # This file
├── README.md                  # Human-facing docs and install instructions
└── skills/
    └── <skill-name>/
        ├── SKILL.md           # Required: YAML frontmatter + agent instructions
        ├── scripts/           # Optional: helper scripts the agent can run
        ├── references/        # Optional: supplementary documentation
        └── assets/            # Optional: templates, schemas, static resources
```

All skills live under `skills/` — this is the canonical directory the `skills` CLI searches first.

## Adding a New Skill

> **Tip**: Use the `skill-creator` skill when creating or improving skills in this repo. Load it with your agent to get guided workflows for authoring, testing, and optimizing `SKILL.md` files — including description tuning, eval runs, and variance analysis.

1. Create a directory: `skills/<skill-name>/`
   - Name must be lowercase letters, numbers, and hyphens only
   - No leading/trailing hyphens, no consecutive hyphens (`--`)
   - The directory name must exactly match the `name` field in `SKILL.md`

2. Create `skills/<skill-name>/SKILL.md` with this structure:

```markdown
---
name: skill-name
description: What this skill does and when to use it. Be specific — agents use this to decide when to activate the skill.
license: MIT
metadata:
  author: shaunburdick
  version: "1.0.0"
---

# Skill Title

Instructions for the agent...
```

3. Add the skill to the **Available Skills** section of `README.md` as a `###` subheading with a short description paragraph.

## SKILL.md Authoring Guidelines

- **`description`** is the most important field — agents use it to decide when to activate the skill. Be specific about both *what* it does and *when* to use it. Max 1024 characters.
- **Keep `SKILL.md` focused and concise** (under 500 lines). Move detailed reference material to `references/` files — agents load those on demand.
- **Prefer live sources over duplicated content.** If install instructions live in an external repo or URL, instruct the agent to fetch them at runtime rather than copying them here. This keeps the skill evergreen without maintenance overhead.
- **`allowed-tools`** can pre-approve specific tools (e.g. `Bash(git:*) Read`) — use sparingly and only when the skill has a well-defined, safe set of operations.
- **`compatibility`** is optional — only include it if the skill has genuine environment requirements (e.g. needs Python 3.14+, requires internet access).

## README Conventions

- Available skills are listed as `###` subheadings (not a table) — descriptions can be prose without layout constraints.
- Install examples in the README use `shaunburdick/skills` as the GitHub shorthand source.
- Update the install example `--skill` flag to reference a real skill name when adding new ones.

## Spec Reference

- Full format spec: https://agentskills.io/specification
- `skills` CLI docs: https://github.com/vercel-labs/skills
- Example skills repo: https://github.com/vercel-labs/agent-skills
