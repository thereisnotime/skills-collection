# agentsys

> A modular runtime and orchestration system for AI agents - works with Claude Code, OpenCode, and Codex CLI

## Critical Rules

1. **Plain text output** - No emojis, no ASCII art. Use `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]` for status markers.
2. **No unnecessary files** - Don't create summary files, plan files, audit files, or temp docs.
3. **Task is not done until tests pass** - Every feature/fix must have quality tests.
4. **Create PRs for non-trivial changes** - No direct pushes to main.
5. **Always run git hooks** - Never bypass pre-commit or pre-push hooks.
6. **Use single dash for em-dashes** - In prose, use ` - ` (single dash with spaces), never ` -- `.
7. **Report script failures before manual fallback** - Never silently bypass broken tooling.
8. **Token efficiency** - Save tokens over decorations.

## Model Selection

| Model | When to Use |
|-------|-------------|
| **Opus** | Complex reasoning, analysis, planning |
| **Sonnet** | Validation, pattern matching, most agents |
| **Haiku** | Mechanical execution, no judgment needed |

## Core Priorities

1. User DX (plugin users first)
2. Worry-free automation
3. Token efficiency
4. Quality output
5. Simplicity

## Website (site/)

The website at `site/index.html` is **hardcoded HTML** - not generated from content.json or any template. When plugins, commands, agents, or skills are added/removed/renamed, the site must be manually updated:

- `site/index.html` - all counts (meta tags, hero stats, section headers), command tabs + panels, agent tier cards, skills grid
- `site/content.json` - commands array, stats, meta description, research section, recent_releases
- `site/ux-spec.md` - design spec counts

**Checklist when adding a new command:**
1. Add tab button to the commands tablist (with correct index)
2. Add tab panel with tagline, 4 features, code block (copy the SVG from an existing panel)
3. Update "N Commands. One Toolkit." heading count
4. Update all meta tag counts (description, og:description, twitter:description)
5. Update hero badge counts
6. Update stats bar data-target attributes
7. Add entry to content.json commands array
8. If new agent: add to agent tier cards + update tier counts
9. If new skill: add to skills grid + update skills count

**How It Works sections** for new commands must also be created manually in the HTML.

## Dev Commands

```bash
npm test          # Run tests
npm run validate  # All validators
```

## References

- Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem
- https://agentskills.io
