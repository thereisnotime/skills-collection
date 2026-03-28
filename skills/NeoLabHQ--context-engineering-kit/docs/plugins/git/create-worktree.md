# /git:create-worktree - Create Worktrees

Create and setup git worktrees for parallel development with automatic dependency installation.

- Purpose - Enable parallel branch development without stashing or context switching
- Output - New worktree with dependencies installed

```bash
/git:create-worktree <name> | --list
```

## Arguments

- `<name>` - Descriptive name for the worktree (e.g., "refactor auth system", "fix login bug")
- `--list` - Show existing worktrees

## How It Works

1. **Type Detection**: Auto-detects branch type from name (feature, fix, hotfix, refactor, etc.)
2. **Branch Resolution**: Creates or tracks existing local/remote branch
3. **Worktree Creation**: Creates sibling directory with pattern `../<project>-<name>`
4. **Dependency Installation**: Detects project type and runs appropriate install command

**Supported Project Types**: Node.js (npm/yarn/pnpm/bun), Python (pip/poetry), Rust (cargo), Go, Ruby, PHP

## Usage Examples

```bash
# Create feature worktree (default type)
> /git:create-worktree auth system
# Branch: feature/auth-system → ../myproject-auth-system

# Create fix worktree
> /git:create-worktree fix login error
# Branch: fix/login-error → ../myproject-login-error

# Create hotfix while feature work continues
> /git:create-worktree hotfix critical bug

# List existing worktrees
> /git:create-worktree --list
```
