# Git Scope Detection

Algorithm for building `changed_files[]` — the set of files to analyze for code quality.

## Base Branch Detection (run once, first match wins)

```
1. git reflog --format="%gs" | grep "moving from" | head -1  → extract source branch name
2. git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'
3. Check local branches: develop → main → master (first that exists locally)
4. Fallback: "main"
```

## Committed Changes

- **If on `feature/*` branch:**
  ```
  git diff --name-only {base_branch}...HEAD
  ```
  (three-dot uses merge-base automatically)
  → if fails: `git diff --name-only origin/{base_branch}...HEAD`
  → if both fail: `[]`

- **Else (main/master/develop/detached HEAD):** committed = `[]`

## Uncommitted Changes

```
git diff --name-only          # unstaged
git diff --name-only --cached # staged
```

## Build `changed_files[]`

```
changed_files[] = union(committed, uncommitted)  # deduplicated
```

## Enrich from Task Metadata

Add file paths from task Affected Components / Existing Code Impact not already in `changed_files[]`.

> Metadata **expands** scope only — never restricts. All files in `changed_files[]` are analyzed.

## Error Handling

If all git commands fail → WARN "git scope unavailable", fall back to task metadata only.
