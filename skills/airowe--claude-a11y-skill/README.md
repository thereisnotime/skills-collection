# claude-a11y-skill

A Claude Code skill for running comprehensive accessibility audits on web projects.

## Installation

Add to your Claude Code skills configuration:

```json
{
  "skills": {
    "accessibility": {
      "source": "~/Projects/claude-a11y-skill/skill.md",
      "triggers": ["accessibility", "a11y"]
    }
  }
}
```

Or reference it in your `.claude/settings.json`:

```json
{
  "skills": ["~/Projects/claude-a11y-skill/skill.md"]
}
```

## Usage

Invoke the skill with any of these triggers:
- `/accessibility` or `/a11y`
- "Run an accessibility scan"
- "Check WCAG compliance"
- "Audit accessibility"

## Scan Modes

| Mode | Method | Best For |
|------|--------|----------|
| `runtime` | axe-core via browser | Full WCAG compliance testing with real DOM |
| `static` | eslint-plugin-jsx-a11y | Fast CI/build-time checks for React/Next.js |
| `full` | Both combined | Most comprehensive coverage |

## What It Checks

- **WCAG 2.1 Level A** — Basic accessibility requirements
- **WCAG 2.1 Level AA** — Standard compliance target
- **Best Practices** — Additional recommendations beyond WCAG

### Common Issues Detected

- Missing alt text on images
- Insufficient color contrast
- Incorrect heading hierarchy
- Missing form labels
- Content outside landmark regions
- Invalid ARIA attributes
- Missing keyboard accessibility
- Focus management issues

## Requirements

- **Runtime mode**: Browser automation tools (Claude in Chrome MCP) + dev server
- **Static mode**: `eslint-plugin-jsx-a11y` (auto-installed if missing)
- **Full mode**: Both of the above

## Standards Reference

- [WCAG 2.1 Guidelines](https://www.w3.org/TR/WCAG21/)
- [axe-core Rules](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
- [jsx-a11y Rules](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#supported-rules)
