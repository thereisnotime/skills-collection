# Freshie — Ecosystem Inventory & Compliance System

Configuration Management Database (CMDB) for the claude-code-plugins ecosystem.

## What This Is

A versioned inventory system that tracks every plugin, skill, agent, command, and file in the repository. Each scan creates a "discovery run" — old data stays, new data appends. Compare runs to see what changed.

## Structure

```
freshie/
├── inventory.sqlite          # Active DB — all runs, all history
├── scripts/
│   └── rebuild-inventory.py  # Full repo scan → new discovery run
├── archives/
│   └── inventory-v1-*.sqlite # Read-only snapshots at major milestones
├── exports/
│   └── run-N/                # CSV/JSON exports per run
├── reports/
│   ├── 00-data-dictionary.md # Schema reference (50 tables)
│   ├── methodology.md        # How scans work
│   └── baseline-*.md         # CTO status reports
└── plans/
    └── *.md                  # Design docs and implementation plans
```

## Quick Start

```bash
# Run a new discovery scan (creates run_id=N+1)
python3 freshie/scripts/rebuild-inventory.py

# Run compliance validation (fills skill/agent/plugin_compliance tables)
python3 scripts/validate-skills-schema.py --enterprise --populate-db freshie/inventory.sqlite

# Export current run to CSV
python3 freshie/scripts/rebuild-inventory.py --export

# Compare runs (what changed?)
python3 freshie/scripts/rebuild-inventory.py --diff

# Dry run (see what would be scanned, no DB writes)
python3 freshie/scripts/rebuild-inventory.py --dry-run
```

## Database Design

**50 tables** organized in groups:

| Group | Tables | What |
|-------|--------|------|
| Core entities | packs, plugins, skills | The ecosystem topology |
| Metadata | frontmatter_*, plugin_* | YAML/JSON field analysis |
| File analysis | skill_files, content_signals, duplicates | Deep file scanning |
| Components | command_files, agent_files | Slash commands & agents |
| Compliance | skill/agent/plugin_compliance | Validator scores & grades |
| Infrastructure | scripts, validators, ci_workflows | Build system catalog |
| Dependencies | npm_* | npm registry intelligence |
| Documentation | docs | All .md files cataloged |

**Versioned runs:** Every table has a `run_id` column. Query by run to see point-in-time snapshots. Compare runs to track changes.

## History

| Run | Date | Plugins | Skills | Notes |
|-----|------|---------|--------|-------|
| 1 | 2026-03-21 | 349 | 1,426 | Genesis baseline |
