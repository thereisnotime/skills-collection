# Community Engagement

> Automated GitHub community management with strategy-driven engagement

## Install

```bash
# Add the marketplace once
/plugin marketplace add levnikolaevich/claude-code-skills

# Install this plugin
/plugin install community-engagement@levnikolaevich-skills-marketplace
```

## What it does

Analyzes repository community health (issues, PRs, discussions), then takes action: triages open items, composes announcements, launches RFC debates, and responds to discussions. Portable across repositories with dynamic GitHub discovery.

## Skills

| Skill | Description |
|-------|-------------|
| ln-910-community-engagement | Coordinator: analyze health, delegate to workers |
| ln-911-github-triager | Scan issues, PRs, discussions; produce triage report |
| ln-912-community-announcer | Compose and publish GitHub Discussion announcements |
| ln-913-community-debater | Launch RFC/debate discussions with structured format |
| ln-914-community-responder | Respond to discussions and issues with context |

## How it works

ln-910 analyzes repository community health metrics and determines which actions to take. It delegates to specialized workers: ln-911 triages open issues, PRs, and discussions into a prioritized report. ln-912 composes and publishes announcements. ln-913 launches structured RFC or debate discussions. ln-914 drafts contextual responses to community interactions.

## Quick start

```bash
ln-910-community-engagement  # Full community analysis and engagement
ln-911-github-triager        # Triage only
```

## Related

- [All plugins](../../README.md)
- [Architecture guide](../architecture/SKILL_ARCHITECTURE_GUIDE.md)
