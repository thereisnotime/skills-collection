# agent-skills

[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)

Portable agent skills for Claude Code and OpenAI Codex, packaged in the awesome-agent-skills plugin layout.

## Skills

| Skill | Description |
| --- | --- |
| [`elastic-search-logs`](./elastic-search-logs/skills/elastic-search-logs) | Query and analyze logs in Elasticsearch. |
| [`german-elster-tax-filing`](./german-elster-tax-filing/skills/german-elster-tax-filing) | Gather all required details to prepare a German ELSTER personal income tax return. |
| [`prompt-template-wizard`](./prompt-template-wizard/skills/prompt-template-wizard) | Collect and validate all required fields for a complete implementation prompt template. |
| [`read-only-gh-pr-review`](./read-only-gh-pr-review/skills/read-only-gh-pr-review) | Review GitHub pull requests with strict read-only CLI constraints. |
| [`read-only-postgres`](./read-only-postgres/skills/read-only-postgres) | Execute read-only SQL queries against PostgreSQL databases. |
| [`supabase`](./supabase/skills/supabase) | Run Supabase Management API SQL and operational database tasks. |
| [`svg-creator`](./svg-creator/skills/svg-creator) | Create, edit, validate, and package high-quality SVGs: icons, logos, illustrations, diagrams, charts, patterns, and inline SVG code. |
| [`trello`](./trello/skills/trello) | Manage Trello boards, lists, and cards via the Trello REST API. |

## Install

### Claude Code

```text
/plugin marketplace add jawwadfirdousi/agent-skills
/plugin install elastic-search-logs@agent-skills
/plugin install german-elster-tax-filing@agent-skills
/plugin install prompt-template-wizard@agent-skills
/plugin install read-only-gh-pr-review@agent-skills
/plugin install read-only-postgres@agent-skills
/plugin install supabase@agent-skills
/plugin install svg-creator@agent-skills
/plugin install trello@agent-skills
```

### Codex

```text
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/elastic-search-logs/skills/elastic-search-logs
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/german-elster-tax-filing/skills/german-elster-tax-filing
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/prompt-template-wizard/skills/prompt-template-wizard
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/read-only-gh-pr-review/skills/read-only-gh-pr-review
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/read-only-postgres/skills/read-only-postgres
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/supabase/skills/supabase
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/svg-creator/skills/svg-creator
$skill-installer install https://github.com/jawwadfirdousi/agent-skills/tree/main/trello/skills/trello
```

Restart Codex after install.

## Uninstall

### Claude Code

```text
/plugin uninstall elastic-search-logs@agent-skills
/plugin uninstall german-elster-tax-filing@agent-skills
/plugin uninstall prompt-template-wizard@agent-skills
/plugin uninstall read-only-gh-pr-review@agent-skills
/plugin uninstall read-only-postgres@agent-skills
/plugin uninstall supabase@agent-skills
/plugin uninstall svg-creator@agent-skills
/plugin uninstall trello@agent-skills
/plugin marketplace remove agent-skills
```

### Codex

```bash
rm -rf ~/.codex/skills/elastic-search-logs
rm -rf ~/.codex/skills/german-elster-tax-filing
rm -rf ~/.codex/skills/prompt-template-wizard
rm -rf ~/.codex/skills/read-only-gh-pr-review
rm -rf ~/.codex/skills/read-only-postgres
rm -rf ~/.codex/skills/supabase
rm -rf ~/.codex/skills/svg-creator
rm -rf ~/.codex/skills/trello
```

Restart Codex after uninstall.
