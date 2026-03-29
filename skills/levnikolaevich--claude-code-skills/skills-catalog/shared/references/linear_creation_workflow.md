# Issue Creation Workflow

<!-- SCOPE: Standard workflow for creating Epics, Stories, and Tasks with kanban updates. Supports both Linear Mode and File Mode per docs/tools_config.md. -->

## Pre-requisite

Read `docs/tools_config.md` → Task Management → Provider. All operations below branch on provider value.

## Epic Creation

```
IF provider == "linear":
  save_project({
    name: "Epic {N}: {Title}",
    description: epicDocument,
    team: teamId,
    state: "planned"
  })
  → Capture returned project ID/URL

ELSE (file):
  dir = "docs/tasks/epics/epic-{N}-{slug}/"
  mkdir -p {dir}/stories
  Write("{dir}/epic.md", epicDocument)
  → epicDocument includes: **Status:** Backlog, **Created:** {date}
```

## Story Creation

```
IF provider == "linear":
  save_issue({
    title: "US{NNN}: {Title}",
    description: storyDocument,
    project: epicId,
    team: teamId,
    labels: ["user-story"],
    state: "Backlog"
  })
  → Capture returned issue ID/URL

ELSE (file):
  dir = "docs/tasks/epics/epic-{epicN}-{epicSlug}/stories/us{NNN}-{slug}/"
  mkdir -p {dir}/tasks
  Write("{dir}/story.md", storyDocument)
  → storyDocument includes: **Status:** Backlog, **Epic:** Epic {N}, **Labels:** user-story
```

## Task Creation

```
IF provider == "linear":
  save_issue({
    title: "T{NNN}: {Title}",
    description: taskDocument,
    parentId: storyId,
    team: teamId,
    labels: ["implementation"|"tests"|"refactoring"],
    state: "Backlog"
  })

ELSE (file):
  Write("docs/tasks/.../tasks/T{NNN}-{slug}.md", taskDocument)
  → taskDocument includes: **Status:** Backlog, **Story:** US{NNN}, **Labels:** {type}
```

## Critical Rules

| Rule | Why |
|------|-----|
| **Always set initial status** | Linear: `state: "Backlog"` (defaults differ!). File: `**Status:** Backlog` |
| **Sequential creation** | Create one, verify success, then next (no bulk) |
| **Capture references** | Linear: store URL. File: store file path |
| **Update kanban after each** | Keep docs/tasks/kanban_board.md in sync |
| **Runtime error → fallback** | If Linear fails mid-creation, switch to file mode (per tools_config_guide.md) |

## Kanban Update Trigger

After each successful creation:
```
1. Update Next Number counter in kanban_board.md
2. Add item to appropriate section (Linear URL or file path as link)
3. Use correct indentation (see kanban_update_algorithm.md)
```

## Title Formats

| Type | Format | Example |
|------|--------|---------|
| Epic | `Epic {N}: {Domain}` | `Epic 7: OAuth Authentication` |
| Story | `US{NNN}: {Capability}` | `US004: Register OAuth client` |
| Task | `T{NNN}: {Goal}` | `T001: Create OAuth schema` |

## Labels Reference

| Label | Used For |
|-------|----------|
| `user-story` | Stories (required for queries) |
| `implementation` | Implementation tasks |
| `tests` | Test tasks |
| `refactoring` | Refactoring tasks |
| `bug` | Bug fix tasks |

## Error Handling

```
IF creation fails:
  1. Log error with item details
  2. IF Linear error → update tools_config.md, switch to file mode
  3. Retry failed item in file mode
  4. Continue with remaining items in file mode
  5. Report partial completion: "{N} in Linear, {M} in files"
```

---
**Version:** 2.0.0
**Last Updated:** 2026-03-04
