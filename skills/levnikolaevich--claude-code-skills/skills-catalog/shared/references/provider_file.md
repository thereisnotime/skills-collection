# File Mode Provider Operations

<!-- SCOPE: Full operation pseudocode for File Mode. Loaded only when environment_state.json task_management.provider=file. -->

## Prerequisites

- No external tools required
- Directory `docs/tasks/epics/` must exist (auto-created on init)

## Init

```
IF Provider=file AND docs/tasks/epics/ does not exist:
  mkdir -p docs/tasks/epics/
```

## Epic Operations

| Operation | Command |
|-----------|---------|
| **List Epics** | `Glob("docs/tasks/epics/*/epic.md")` |
| **Get Epic** | `Read("docs/tasks/epics/epic-{N}-{slug}/epic.md")` |
| **Create Epic** | `mkdir -p docs/tasks/epics/epic-{N}-{slug}/stories/` + `Write epic.md` |
| **Update Epic** | `Edit epic.md` |

## Story Operations

| Operation | Command |
|-----------|---------|
| **List Stories in Epic** | `Glob("docs/tasks/epics/epic-{N}-*/stories/*/story.md")` |
| **Get Story** | `Read("docs/tasks/epics/.../stories/us{NNN}-{slug}/story.md")` |
| **Create Story** | `mkdir -p .../stories/us{NNN}-{slug}/tasks/` + `Write story.md` |
| **Update Story** | `Edit story.md` |
| **Update Status** | `Edit` `**Status:**` line |
| **Cancel Story** | `Edit` status to `**Status:** Canceled` |

## Task Operations

| Operation | Command |
|-----------|---------|
| **Check existing** | `Glob("docs/tasks/epics/*/stories/{slug}/tasks/*.md")` |
| **Load task** | `Read("docs/tasks/epics/.../tasks/T{NNN}-*.md")` |
| **Create task** | `Write("docs/tasks/.../T{NNN}-{slug}.md")` |
| **Update task** | `Edit` task file content |
| **Update status** | `Edit` `**Status:**` line |
| **Cancel task** | `Edit` status to `**Status:** Canceled` |

## Comment Operations

| Operation | Command |
|-----------|---------|
| **Add comment** | `Write(".../comments/{ISO-timestamp}.md")` with body |
| **List comments** | `Glob(".../comments/*.md")` sorted by filename |

## Directory Structure

```
docs/tasks/epics/
├── epic-1-infrastructure/
│   ├── epic.md
│   └── stories/
│       └── us001-setup-cicd/
│           ├── story.md
│           ├── comments/
│           │   └── 2026-03-04T10-30-00.md
│           └── tasks/
│               ├── T001-create-dockerfile.md
│               └── T002-setup-github-actions.md
└── epic-2-user-management/
    ├── epic.md
    └── stories/
        └── us004-user-registration/
            ├── story.md
            └── tasks/
                └── T001-create-users-table.md
```

## ID Resolution

```
"Epic {N}"  → Glob("docs/tasks/epics/epic-{N}-*/epic.md")
"US{NNN}"   → Glob("docs/tasks/epics/*/stories/us{NNN}-*/story.md")
"T{NNN}"    → Story context: tasks/T{NNN}-*.md
```

## Numbering

```
Next Epic Number:  kanban_board.md → "Next Epic Number" field
Next Story Number: kanban_board.md → "Next Story" in Epic Story Counters
Next Task Number:  Count existing T*.md files in Story's tasks/ folder + 1
```

## Document Headers

Epic: `**Status:** Backlog` + `**Created:** {date}`
Story: `**Status:** Backlog` + `**Epic:** Epic {N}` + `**Labels:** user-story` + `**Created:** {date}`
Task: `**Status:** Backlog` + `**Story:** US{NNN}` + `**Labels:** {type}` + `**Created:** {date}`

## Status Values

| Abstract | File Mode |
|----------|-----------|
| New | `**Status:** Backlog` |
| Ready | `**Status:** Todo` |
| Working | `**Status:** In Progress` |
| Review | `**Status:** To Review` |
| Rework | `**Status:** To Rework` |
| Complete | `**Status:** Done` |
| Removed | `**Status:** Canceled` |

## Error Handling

File mode is the universal fallback — it has no external dependencies. If file operations fail (disk full, permissions), report the error directly to the user.

---
**Version:** 1.0.0
**Last Updated:** 2026-04-05
