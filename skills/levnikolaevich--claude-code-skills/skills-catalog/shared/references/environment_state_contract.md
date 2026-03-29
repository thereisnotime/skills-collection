# Environment State Contract

Shared project-scoped contract for `.hex-skills/environment_state.json`.

Use this contract when a skill:
- checks disabled agents
- decides whether Codex or Gemini should be probed
- needs environment setup health or sync metadata

## Location

```text
{project_root}/.hex-skills/environment_state.json
```

Environment state is project-scoped. Skills must never read or write environment state outside the current project root.

Schema SSOT:
- `shared/references/environment_state_schema.json`

## Rules

- Missing file means default-enabled environment.
- Malformed file is a deterministic contract error, not a soft fallback.
- `agents.{name}.disabled=true` means the agent must not be probed or launched.
- Readers should use `shared/scripts/coordinator-runtime/lib/environment-state.mjs`.

## Required Shape

- `scanned_at`
- `agents.codex.available`
- `agents.gemini.available`
