# DevOps-Skills Memory System

This directory stores persistent memory across Claude Code sessions for infrastructure management.

## Directory Structure

```
memory/
├── projects/
│   └── <project-hash>/
│       ├── patterns.json       # Learned patterns from past changes
│       ├── incidents.json      # Past issues and resolutions
│       └── preferences.json    # User preferences for this project
└── global/
    └── provider-issues.json    # Known provider problems across all projects
```

## Memory Types

### Project Memory (`projects/<hash>/`)

Each project gets a unique hash based on its path. Project memory includes:

- **patterns.json**: Recurring change patterns, common resource combinations, typical change sequences
- **incidents.json**: Past failures, rollbacks, and their resolutions
- **preferences.json**: User-specific settings like preferred output format, approval workflow preferences

### Global Memory (`global/`)

Cross-project knowledge:

- **provider-issues.json**: Known AWS provider bugs, version-specific issues, upgrade gotchas

## Usage

Memory is automatically:
1. **Queried** before plan reviews to find similar past changes
2. **Updated** after incidents to store learnings
3. **Referenced** during upgrade checks for known provider issues

## Privacy Note

Memory files may contain project-specific information. This directory should be:
- Included in `.gitignore` if you don't want to share memory
- Committed if you want to share learnings across team members
