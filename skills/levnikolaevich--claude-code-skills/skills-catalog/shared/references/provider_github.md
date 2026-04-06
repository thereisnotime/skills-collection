# GitHub Issues Provider Operations

<!-- SCOPE: Full operation pseudocode for GitHub Mode. Loaded only when environment_state.json task_management.provider=github. Uses gh CLI + GitHub REST API for sub-issues and Projects v2 for status tracking. -->

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- Repository detected (`gh repo view --json owner,name`)
- GitHub Project with Status field created (see Init)

## Init

```
IF Provider=github AND first use:
  1. Verify: gh auth status
  2. Detect repo: REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
  3. Create GitHub Project (if not exists):
     gh project create --owner {OWNER} --title "Task Board"
     → Store returned project number in environment_state.json → task_management.project_number
  4. Add Status field to project:
     gh project field-create {PROJECT_NUM} --owner {OWNER} \
       --name "Status" --data-type SINGLE_SELECT \
       --single-select-options "Backlog,Todo,In Progress,To Review,To Rework,Done,Canceled"
  5. Create required labels (skip if already exist):
     gh label create "epic" -R {REPO} --color "7057FF" --force
     gh label create "user-story" -R {REPO} --color "0E8A16" --force
     gh label create "task" -R {REPO} --color "1D76DB" --force
     gh label create "implementation" -R {REPO} --color "BFD4F2" --force
     gh label create "tests" -R {REPO} --color "D4C5F9" --force
     gh label create "refactoring" -R {REPO} --color "C2E0C6" --force
     gh label create "bug" -R {REPO} --color "FC2929" --force
```

## Config in environment_state.json

```markdown
## Task Management

| Setting | Value |
|---------|-------|
| **Provider** | github |
| **Status** | active |
| **Repository** | {owner}/{repo} |
| **Project Number** | {N} |
| **Fallback** | file (`docs/tasks/epics/`) |
```

## Epic Operations (Top-Level Issues)

| Operation | Command |
|-----------|---------|
| **List Epics** | `gh issue list -R {REPO} --label "epic" --state all --json number,title,body,state` |
| **Get Epic** | `gh issue view {number} -R {REPO} --json number,title,body,state,labels` |
| **Create Epic** | `gh issue create -R {REPO} --title "Epic {N}: {Title}" --body "{doc}" --label "epic"` → add to project → set status Backlog |
| **Update Epic** | `gh issue edit {number} -R {REPO} --body "{doc}"` |

## Story Operations (Sub-Issues of Epic)

| Operation | Command |
|-----------|---------|
| **List Stories in Epic** | `gh api /repos/{O}/{R}/issues/{epic_num}/sub_issues --jq '.[].number'` → filter by label `user-story` |
| **Get Story** | `gh issue view {number} -R {REPO} --json number,title,body,state,labels` |
| **Create Story** | See Creation Workflow below |
| **Update Story** | `gh issue edit {number} -R {REPO} --body "{doc}"` |
| **Update Status** | See Status Update below |
| **Cancel Story** | Set status to Canceled + `gh issue close {number} -R {REPO}` |

### Story Creation Workflow

```
1. Create issue:
   gh issue create -R {REPO} \
     --title "US{NNN}: {Title}" \
     --body "{doc}" \
     --label "user-story"
   → Capture returned issue number

2. Get internal ID (required for sub-issue API):
   SUB_ID=$(gh api /repos/{O}/{R}/issues/{story_num} --jq '.id')

3. Add as sub-issue of Epic:
   gh api /repos/{O}/{R}/issues/{epic_num}/sub_issues \
     -X POST -F sub_issue_id="$SUB_ID"

4. Add to project and set status:
   → See "Add to Project" helper below
```

## Task Operations (Sub-Issues of Story)

| Operation | Command |
|-----------|---------|
| **Check existing** | `gh api /repos/{O}/{R}/issues/{story_num}/sub_issues --jq '.[].number'` |
| **Load task** | `gh issue view {number} -R {REPO} --json number,title,body,state,labels` |
| **Create task** | See Creation Workflow below |
| **Update task** | `gh issue edit {number} -R {REPO} --body "{doc}"` |
| **Update status** | See Status Update below |
| **Cancel task** | Set status to Canceled + `gh issue close {number} -R {REPO}` |

### Task Creation Workflow

```
1. Create issue:
   gh issue create -R {REPO} \
     --title "T{NNN}: {Title}" \
     --body "{doc}" \
     --label "task" --label "{type}"
   → Capture returned issue number

2. Get internal ID:
   SUB_ID=$(gh api /repos/{O}/{R}/issues/{task_num} --jq '.id')

3. Add as sub-issue of Story:
   gh api /repos/{O}/{R}/issues/{story_num}/sub_issues \
     -X POST -F sub_issue_id="$SUB_ID"

4. Add to project and set status:
   → See "Add to Project" helper below
```

## Comment Operations

| Operation | Command |
|-----------|---------|
| **Add comment** | `gh issue comment {number} -R {REPO} --body "{text}"` |
| **List comments** | `gh issue view {number} -R {REPO} --json comments` |

## Add to Project (Helper)

```
1. Add issue to project:
   gh project item-add {PROJECT_NUM} --owner {OWNER} \
     --url https://github.com/{REPO}/issues/{number}

2. Get project IDs (cache these per session):
   PROJECT_ID=$(gh project view {PROJECT_NUM} --owner {OWNER} --format json | jq -r '.id')
   FIELDS=$(gh project field-list {PROJECT_NUM} --owner {OWNER} --format json)
   STATUS_FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Status") | .id')

3. Get option ID for target status:
   OPTION_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name == "{status}") | .id')

4. Get item ID:
   ITEMS=$(gh project item-list {PROJECT_NUM} --owner {OWNER} --format json --limit 500)
   ITEM_ID=$(echo "$ITEMS" | jq -r --arg N "{number}" '.items[] | select(.content.number == ($N | tonumber)) | .id')

5. Set status:
   gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
     --field-id "$STATUS_FIELD_ID" --single-select-option-id "$OPTION_ID"
```

**Performance note:** Cache PROJECT_ID, STATUS_FIELD_ID, and option IDs per session. Only ITEM_ID changes per issue.

## Status Update

```
1. Resolve cached IDs (see "Add to Project" helper)
2. Get ITEM_ID for target issue
3. Get OPTION_ID for target status
4. gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
     --field-id "$STATUS_FIELD_ID" --single-select-option-id "$OPTION_ID"
5. IF status is Done or Canceled:
     gh issue close {number} -R {REPO}
6. IF status changed FROM Done/Canceled to active:
     gh issue reopen {number} -R {REPO}
```

## ID Format

- Epic: Issue number `#{N}` (top-level, label `epic`)
- Story: Issue number `#{NNN}` (sub-issue of Epic, label `user-story`)
- Task: Issue number `#{NNN}` (sub-issue of Story, label `task`)
- All share the GitHub issue number namespace (globally unique within repo)
- Internal ID (for sub-issue API): numeric `.id` field, NOT the issue number

## Numbering

```
Next Epic Number:  kanban_board.md → "Next Epic Number" field
Next Story Number: kanban_board.md → "Next Story" in Epic Story Counters
Next Task Number:  Count existing sub-issues of Story with label "task" + 1
Issue numbers:     Auto-assigned by GitHub (not controllable)
```

## Status Values

| Abstract | Projects v2 Status | Issue State |
|----------|-------------------|-------------|
| New | `Backlog` | open |
| Ready | `Todo` | open |
| Working | `In Progress` | open |
| Review | `To Review` | open |
| Rework | `To Rework` | open |
| Complete | `Done` | closed |
| Removed | `Canceled` | closed |

## Error Handling

```
IF gh command fails (auth, rate limit, network):
  1. WARN user (ONE TIME per session):
     "⚠️ GitHub CLI unavailable: {error}. Using file mode fallback."
  2. UPDATE environment_state.json:
     task_management.provider → file
     task_management.status → "unavailable ({error}, {date})"
  3. EXECUTE via file mode fallback
  4. Report: "Switched to file mode due to GitHub error"
```

## API Version Note

Sub-issues REST API requires header `X-GitHub-Api-Version: 2026-03-10` or later. Without it, requests default to `2022-11-28` and sub-issue endpoints return 404.

The `gh api` command sends the latest version by default. If using `gh api` with explicit `-H` flags, add:
```
-H "X-GitHub-Api-Version: 2026-03-10"
```

## Sub-Issues Limits

| Limit | Value |
|-------|-------|
| Max sub-issues per parent | 100 |
| Max nesting depth | 8 levels |
| Cross-repo sub-issues | Yes (same owner required) |

## Sub-Issues API Gotchas

| Gotcha | Detail |
|--------|--------|
| `sub_issue_id` is NOT issue `number` | Must resolve via `gh api /repos/{O}/{R}/issues/{num} --jq '.id'` first |
| DELETE uses singular path | `DELETE /issues/{N}/sub_issue` (NOT `/sub_issues`) |
| Reprioritize endpoint | `PATCH /issues/{N}/sub_issues/priority` with `sub_issue_id` + `after_id` or `before_id` |
| `gh` CLI has no native sub-issue support | cli/cli#10298 still open — must use `gh api` |

## Projects v2 Notes

- Status is a built-in SINGLE_SELECT field with defaults: Todo, In Progress, Done
- Custom values (Backlog, To Review, etc.) must be added via `field-create` or project UI
- Max 50 options per single-select field
- Built-in automations: "Item closed" auto-sets Done, "PR merged" auto-sets Done
- Up to 19 `gh project` CLI subcommands available (see GitHub CLI manual)

---
**Version:** 1.1.0
**Last Updated:** 2026-04-05
