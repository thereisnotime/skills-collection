# /git:compare-worktrees - Compare Worktrees

Compare files and directories between git worktrees or worktree and current branch.

- Purpose - Understand differences across branches/worktrees before merging
- Output - Diff output with clear headers and statistics

```bash
/git:compare-worktrees [paths...] [--stat]
```

## Arguments

- `<paths>` - File(s) or directory(ies) to compare
- `<worktree>` - Worktree path or branch name to compare
- `--stat` - Show summary statistics only

## Usage Examples

```bash
# Compare specific file
> /git:compare-worktrees src/app.js

# Compare multiple paths
> /git:compare-worktrees src/app.js src/utils/ package.json

# Compare entire directory
> /git:compare-worktrees src/

# Get summary statistics
> /git:compare-worktrees --stat

# Interactive mode (lists worktrees)
> /git:compare-worktrees
```
