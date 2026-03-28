# /git:merge-worktree - Merge from Worktrees

Merge changes from worktrees into current branch with selective file checkout, cherry-picking, interactive patch selection, or manual merge.

- Purpose - Selectively merge changes without full branch merges
- Output - Merged files with optional cleanup

```bash
/git:merge-worktree [path|commit] [--from <worktree>] [--patch] [--interactive]
```

## Arguments

- `<path>` - File or directory to merge
- `<commit>` - Commit name to cherry-pick
- `--from <worktree>` - Source worktree path
- `--patch` / `-p` - Interactive patch selection mode
- `--interactive` - Guided mode

## Merge Strategies

| Strategy | Use When | Command Pattern |
|----------|----------|-----------------|
| **Selective File** | Need complete file(s) from another branch | `git checkout <branch> -- <path>` |
| **Interactive Patch** | Need specific changes within a file | `git checkout -p <branch> -- <path>` |
| **Cherry-Pick Selective** | Need a commit but not all its changes | `git cherry-pick --no-commit` + selective staging |
| **Manual Merge** | Full branch merge with control | `git merge --no-commit` + selective staging |
| **Multi-Source** | Combining files from multiple branches | Multiple `git checkout <branch> -- <path>` |

## Usage Examples

```bash
# Merge single file
> /git:merge-worktree src/app.js --from ../project-feature

# Interactive patch selection (select specific hunks)
> /git:merge-worktree src/utils.js --patch

# Cherry-pick specific commit
> /git:merge-worktree abc1234

# Full guided mode
> /git:merge-worktree --interactive
```
