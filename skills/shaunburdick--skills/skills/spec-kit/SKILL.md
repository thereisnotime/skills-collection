---
name: spec-kit
description: "Practical guide for setting up and using the spec-kit CLI on a project. Covers installation, project initialization (--integration flag) for Claude, OpenCode, Copilot, Cursor, Codex and more, the specify slash commands (/speckit.constitution, /speckit.specify, /speckit.clarify, /speckit.plan, /speckit.tasks, /speckit.implement, /speckit.converge), plus workflow/bundle/extension management and detecting current workflow state. Load this skill when a user mentions spec-kit, the specify CLI, .specify/ directory, specs/ directory, speckit commands, or wants to initialize spec-driven development tooling on a project."
license: MIT
metadata:
  author: shaunburdick
  version: "2.2.0"
---

# Spec-Kit

Practical setup and usage guide for the [spec-kit CLI](https://github.com/github/spec-kit) — the tooling layer that scaffolds and drives the spec-driven development workflow.

> **Relationship to `spec-driven-development` skill**: This skill covers the *tooling* (CLI, commands, file structure, state detection). The `spec-driven-development` skill covers the *methodology* (what each phase means, how to write good specs, clarification process, etc.). Use both together for the full picture.

> **Version note**: This skill targets spec-kit **v1.0.0+**. Older guides reference a `--ai` flag and `.specify/features/` directories — both are gone. The agent flag is now `--integration`, and feature specs live in `specs/` at the repo root.

---

## Prerequisites

- Python 3.11+
- Git
- [uv](https://docs.astral.sh/uv/) package manager

---

## Running spec-kit

The preferred approach is to run spec-kit via `uvx` without installing it globally. This keeps your machine clean, makes version pinning explicit, and avoids PATH issues.

### Preferred: `uvx` (no install required)

```bash
# New project — replace vX.Y.Z with the latest release tag
uvx --from git+https://github.com/github/spec-kit.git@vX.Y.Z specify init <PROJECT_NAME> --integration <agent>

# Existing project
uvx --from git+https://github.com/github/spec-kit.git@vX.Y.Z specify init . --here --integration <agent>

# Run any other specify command the same way
uvx --from git+https://github.com/github/spec-kit.git@vX.Y.Z specify <command>
```

Check the [Releases page](https://github.com/github/spec-kit/releases) for the latest tag.

Templates are bundled inside the CLI package, so `init` does not need network access beyond fetching the package itself. A persistent `uv tool install` is documented in [references/cli.md](references/cli.md).

---

## Project Initialization

Run this once per project to scaffold the `.specify/` directory and agent integration files:

```bash
# New project (uvx — preferred)
uvx --from git+https://github.com/github/spec-kit.git specify init <project-name> --integration <agent>

# Existing project (use --force to skip the non-empty confirmation)
uvx --from git+https://github.com/github/spec-kit.git specify init . --here --integration <agent>

# Scripted / CI-friendly init — never prompts, fails instead of hanging
uvx --from git+https://github.com/github/spec-kit.git specify init . --here --force --non-interactive --integration claude
```

---

## Slash Commands

After `specify init`, these commands (or skills) are available in your agent:

| Command | Purpose |
| --- | --- |
| `/speckit.constitution` | Create or update the project constitution (Phase 1) |
| `/speckit.specify <description>` | Create a feature spec from a description (Phase 2) |
| `/speckit.clarify` | Resolve ambiguities before planning (Phase 3) |
| `/speckit.plan <tech notes>` | Generate implementation plan (Phase 4) |
| `/speckit.tasks` | Break plan into ordered tasks (Phase 5, same handoff as the plan) |
| `/speckit.converge` | Assess codebase against spec/plan/tasks; append unbuilt work as new tasks |
| `/speckit.taskstoissues` | Convert tasks into dependency-ordered GitHub issues |
| `/speckit.implement` | Execute tasks (Phase 6) |

`/speckit.checklist` and `/speckit.analyze` are retired here: the
`spec-challenger` agent covers both gates and returns a cut list instead of a
coverage table. `specify integration upgrade` may try to restore them; delete
them again.

### Example workflow

```
/speckit.constitution Focus on simplicity, TypeScript strict mode, no suppressions

/speckit.specify A dashboard showing real-time sensor readings with alerting thresholds

/speckit.clarify

/speckit.plan React + Vite frontend, Node.js WebSocket backend, SQLite for alert config

/speckit.tasks

/speckit.implement
```

---

## Detecting Project State

Before diving in, check where you are in the workflow. Note that feature specs live in `specs/` at the **repo root** (legacy projects may still use `.specify/features/`):

```bash
# Is spec-kit initialized?
[ -d ".specify" ] && echo "Initialized" || echo "Run: uvx --from git+https://github.com/github/spec-kit.git specify init . --here --integration opencode"

# Is there a constitution?
[ -f ".specify/memory/constitution.md" ] && echo "Constitution exists" || echo "Run: /speckit.constitution"

# What features exist?
ls specs/ 2>/dev/null || ls .specify/features/ 2>/dev/null || echo "No features yet"

# What's the latest feature's phase?
LATEST=$(ls -d specs/[0-9]* .specify/features/[0-9]* 2>/dev/null | sort -V | tail -1)
if [ -n "$LATEST" ]; then
  echo "Latest feature dir: $LATEST"
  [ -f "$LATEST/plan.md" ]  && echo "  ✅ plan.md"  || echo "  ❌ plan.md (run /speckit.plan)"
  [ -f "$LATEST/tasks.md" ] && echo "  ✅ tasks.md" || echo "  ❌ tasks.md (run /speckit.tasks)"
fi
```

---

Everything else about the CLI (init options and integration layouts, the
generated file tree, phase detection, helper scripts, integrations, workflows,
bundles, upgrading, extensions, troubleshooting):
[references/cli.md](references/cli.md).
