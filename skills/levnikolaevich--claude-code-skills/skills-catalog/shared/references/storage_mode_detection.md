# Storage Mode Operations

<!-- SCOPE: Operation lookup tables for Linear Mode vs File Mode. Provider selection comes from docs/tools_config.md (NOT detected here). This file defines WHAT to call, not WHICH mode to use. -->

## Mode Selection

Read `docs/tools_config.md` → Task Management → Provider:
- `linear` → use Linear Mode column
- `file` → use File Mode column

If tools_config.md missing → bootstrap per `shared/references/tools_config_guide.md`.

## Mode Comparison

| Aspect | Linear Mode | File Mode |
|--------|-------------|-----------|
| **Source of truth** | Linear API | Markdown files + kanban_board.md |
| **ID format** | Linear issue ID (PROJ-123) / UUID | File-based (Epic 1, US001, T001) |
| **Status storage** | Linear `state` field | `**Status:** {value}` in file |
| **Comments** | Linear comments API | `comments/{timestamp}.md` files |

## Epic Operations

| Operation | Linear Mode | File Mode |
|-----------|-------------|-----------|
| **List Epics** | `list_projects(team=teamId)` | `Glob("docs/tasks/epics/*/epic.md")` |
| **Get Epic** | `get_project(query="Epic N")` | `Read("docs/tasks/epics/epic-{N}-{slug}/epic.md")` |
| **Create Epic** | `save_project({name, description, team, state: "planned"})` | `mkdir -p docs/tasks/epics/epic-{N}-{slug}/stories/` + `Write epic.md` |
| **Update Epic** | `save_project({id, description})` | `Edit epic.md` |

## Story Operations

| Operation | Linear Mode | File Mode |
|-----------|-------------|-----------|
| **List Stories in Epic** | `list_issues(project=Epic.id, label="user-story")` | `Glob("docs/tasks/epics/epic-{N}-*/stories/*/story.md")` |
| **Get Story** | `get_issue(story_id)` | `Read("docs/tasks/epics/.../stories/us{NNN}-{slug}/story.md")` |
| **Create Story** | `save_issue({title, description, project, team, labels: ["user-story"], state: "Backlog"})` | `mkdir -p .../stories/us{NNN}-{slug}/tasks/` + `Write story.md` |
| **Update Story** | `save_issue({id, description})` | `Edit story.md` |
| **Update Status** | `save_issue({id, state: "Todo"})` | `Edit` `**Status:**` line |
| **Cancel Story** | `save_issue({id, state: "Canceled"})` | `Edit` status to `**Status:** Canceled` |

## Task Operations

| Operation | Linear Mode | File Mode |
|-----------|-------------|-----------|
| **Check existing** | `list_issues(parentId=Story.id)` | `Glob("docs/tasks/epics/*/stories/{slug}/tasks/*.md")` |
| **Load task** | `get_issue(task_id)` | `Read("docs/tasks/epics/.../tasks/T{NNN}-*.md")` |
| **Create task** | `save_issue({title, description, parentId, team, labels, state: "Backlog"})` | `Write("docs/tasks/.../T{NNN}-{slug}.md")` |
| **Update task** | `save_issue({id, description})` | `Edit` task file content |
| **Update status** | `save_issue({id, state: "In Progress"})` | `Edit` `**Status:**` line |
| **Cancel task** | `save_issue({id, state: "Canceled"})` | `Edit` status to Canceled |

## Comment Operations

| Operation | Linear Mode | File Mode |
|-----------|-------------|-----------|
| **Add comment** | `create_comment({issueId, body})` | `Write(".../comments/{ISO-timestamp}.md")` with body |
| **List comments** | `list_comments(issueId)` | `Glob(".../comments/*.md")` sorted by filename |

## File Mode Structure

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

## File Mode ID Resolution

```
"Epic {N}"  → Glob("docs/tasks/epics/epic-{N}-*/epic.md")
"US{NNN}"   → Glob("docs/tasks/epics/*/stories/us{NNN}-*/story.md")
"T{NNN}"    → Story context: tasks/T{NNN}-*.md
```

## File Mode Numbering

```
Next Epic Number:  kanban_board.md → "Next Epic Number" field
Next Story Number: kanban_board.md → "Next Story" in Epic Story Counters
Next Task Number:  Count existing T*.md files in Story's tasks/ folder + 1
```

## File Mode Document Headers

Epic: `**Status:** Backlog` + `**Created:** {date}`
Story: `**Status:** Backlog` + `**Epic:** Epic {N}` + `**Labels:** user-story` + `**Created:** {date}`
Task: `**Status:** Backlog` + `**Story:** US{NNN}` + `**Labels:** {type}` + `**Created:** {date}`

## Status Values

| Abstract | Linear State | File Mode |
|----------|-------------|-----------|
| New | `Backlog` | `**Status:** Backlog` |
| Ready | `Todo` | `**Status:** Todo` |
| Working | `In Progress` | `**Status:** In Progress` |
| Review | `To Review` | `**Status:** To Review` |
| Rework | `To Rework` | `**Status:** To Rework` |
| Complete | `Done` | `**Status:** Done` |
| Removed | `Canceled` | `**Status:** Canceled` |

## File Mode Init

```
IF tools_config says Provider=file AND docs/tasks/epics/ does not exist:
  mkdir -p docs/tasks/epics/
```

## Usage in SKILL.md

```markdown
**MANDATORY READ:** Load `shared/references/storage_mode_detection.md`
```

---
**Version:** 2.0.0
**Last Updated:** 2026-03-04
