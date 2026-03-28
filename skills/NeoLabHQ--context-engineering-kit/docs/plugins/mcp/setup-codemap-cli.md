# /mcp:setup-codemap-cli - Codebase Visualization

Set up Codemap CLI for intelligent codebase visualization and navigation, providing tree views, dependency analysis, and change tracking.

- Purpose - Enable comprehensive codebase understanding and navigation
- Output - Working Codemap installation with CLAUDE.md configuration

```bash
/mcp:setup-codemap-cli [OS type or configuration preferences]
```

## What is Codemap?

Codemap is a CLI tool that provides intelligent codebase visualization and navigation. It generates tree views, tracks changes, analyzes dependencies, and integrates with Claude Code through hooks.

Benefits:
- Visualize project structure with smart filtering
- Track changes vs main branch at a glance
- Analyze file dependencies and import relationships
- Integrate with Claude Code through session hooks
- Generate city skyline visualizations of codebase

## Arguments

Optional OS type or configuration preferences. The command auto-detects your operating system and provides appropriate installation instructions.

Examples:
- (no arguments) - Auto-detect OS and install
- `macos` - macOS-specific instructions
- `windows` - Windows-specific instructions

## How It Works

1. **Installation Check**: Verifies if Codemap is already installed via `codemap --version`
2. **Documentation Loading**: Fetches latest Codemap documentation from GitHub
3. **Installation Guidance**: Provides OS-specific installation commands (Homebrew for macOS/Linux, Scoop for Windows)
4. **Verification**: Tests installation with basic commands
5. **CLAUDE.md Update**: Adds Codemap usage instructions and hook configuration
6. **.gitignore Update**: Adds `.codemap/` directory to ignore list

## Usage Examples

```bash
# Standard setup with auto-detection
> /mcp:setup-codemap-cli

# Specify your OS
> /mcp:setup-codemap-cli macos
> /mcp:setup-codemap-cli windows
```

After setup, your CLAUDE.md will include:

```markdown
## Use Codemap CLI for Codebase Navigation

Codemap CLI is available for intelligent codebase visualization and navigation.

**Required Usage** - You MUST use `codemap --diff --ref master` to research changes different from default branch, and `git diff` + `git status` to research current working state.

### Quick Start

codemap .                    # Project tree
codemap --only md .          # Just Markdown files
codemap --diff --ref master  # What changed vs master
codemap --deps .             # Dependency flow
```

The command also configures Claude Code hooks in `.claude/settings.json` for automatic session context.

## Best Practices

- Run at project start to establish codebase understanding
- Use hooks to maintain context during long coding sessions
- Combine `--diff` with `--ref` to compare against your main branch
- Use `--deps` to understand module relationships before refactoring
- Exclude generated files and assets with `--exclude` for cleaner output
