# Linear Provider Operations

<!-- SCOPE: Full operation pseudocode for Linear Mode. Loaded only when environment_state.json task_management.provider=linear. -->

## Prerequisites

- Linear MCP server configured and authenticated
- Team ID known (from `environment_state.json` or `kanban_board.md`)

## Epic Operations

| Operation | Command |
|-----------|---------|
| **List Epics** | `list_projects(team=teamId)` |
| **Get Epic** | `get_project(query="Epic N")` |
| **Create Epic** | `save_project({name: "Epic {N}: {Title}", description, team, state: "planned"})` |
| **Update Epic** | `save_project({id, description})` |

## Story Operations

| Operation | Command |
|-----------|---------|
| **List Stories in Epic** | `list_issues(project=Epic.id, label="user-story")` |
| **Get Story** | `get_issue(story_id)` |
| **Create Story** | `save_issue({title: "US{NNN}: {Title}", description, project: epicId, team, labels: ["user-story"], state: "Backlog"})` |
| **Update Story** | `save_issue({id, description})` |
| **Update Status** | `save_issue({id, state: "Todo"})` |
| **Cancel Story** | `save_issue({id, state: "Canceled"})` |

## Task Operations

| Operation | Command |
|-----------|---------|
| **Check existing** | `list_issues(parentId=Story.id)` |
| **Load task** | `get_issue(task_id)` |
| **Create task** | `save_issue({title: "T{NNN}: {Title}", description, parentId: storyId, team, labels, state: "Backlog"})` |
| **Update task** | `save_issue({id, description})` |
| **Update status** | `save_issue({id, state: "In Progress"})` |
| **Cancel task** | `save_issue({id, state: "Canceled"})` |

## Comment Operations

| Operation | Command |
|-----------|---------|
| **Add comment** | `create_comment({issueId, body})` |
| **List comments** | `list_comments(issueId)` |

## ID Format

- Epic: Linear project ID (returned by `save_project`)
- Story: Linear issue ID (PROJ-123) / UUID
- Task: Linear issue ID (PROJ-456) / UUID

**Critical:** `list_issues(parentId=...)` requires UUID, not short ID. Get UUID via `get_issue(id="PROJ-123")` → `issue["id"]`.

## Status Values

| Abstract | Linear State |
|----------|-------------|
| New | `Backlog` |
| Ready | `Todo` |
| Working | `In Progress` |
| Review | `To Review` |
| Rework | `To Rework` |
| Complete | `Done` |
| Removed | `Canceled` |

## Error Handling

```
IF Linear API fails (401/403/429/500/timeout):
  1. WARN user (ONE TIME per session)
  2. UPDATE environment_state.json: task_management.provider → file, task_management.status → "unavailable ({error}, {date})"
  3. EXECUTE via file mode fallback
```

---
**Version:** 1.0.0
**Last Updated:** 2026-04-05
