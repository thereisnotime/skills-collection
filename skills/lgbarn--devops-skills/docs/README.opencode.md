# DevOps Skills for OpenCode

Complete guide for using DevOps Skills with [OpenCode.ai](https://opencode.ai).

## Quick Install

Tell OpenCode:

```
Clone https://github.com/lgbarn/devops-skills to ~/.config/opencode/devops-skills, then create directory ~/.config/opencode/plugin, then symlink ~/.config/opencode/devops-skills/.opencode/plugin/devops-skills.js to ~/.config/opencode/plugin/devops-skills.js, then symlink ~/.config/opencode/devops-skills/skills to ~/.config/opencode/skills/devops-skills, then restart opencode.
```

## Manual Installation

### Prerequisites

- [OpenCode.ai](https://opencode.ai) installed
- Git installed

### macOS / Linux

```bash
# 1. Install DevOps Skills (or update existing)
if [ -d ~/.config/opencode/devops-skills ]; then
  cd ~/.config/opencode/devops-skills && git pull
else
  git clone https://github.com/lgbarn/devops-skills.git ~/.config/opencode/devops-skills
fi

# 2. Create directories
mkdir -p ~/.config/opencode/plugin ~/.config/opencode/skills

# 3. Create symlinks (safe for reinstalls - ln -sf overwrites)
ln -sf ~/.config/opencode/devops-skills/.opencode/plugin/devops-skills.js ~/.config/opencode/plugin/devops-skills.js
ln -sf ~/.config/opencode/devops-skills/skills ~/.config/opencode/skills/devops-skills

# 4. Restart OpenCode
```

#### Verify Installation

```bash
ls -l ~/.config/opencode/plugin/devops-skills.js
ls -l ~/.config/opencode/skills/devops-skills
```

Both should show symlinks pointing to the devops-skills directory.

### Windows

**Prerequisites:**
- Git installed
- Either **Developer Mode** enabled OR **Administrator privileges**
  - Windows 10: Settings → Update & Security → For developers
  - Windows 11: Settings → System → For developers

Pick your shell below: [Command Prompt](#command-prompt) | [PowerShell](#powershell) | [Git Bash](#git-bash)

#### Command Prompt

Run as Administrator, or with Developer Mode enabled:

```cmd
:: 1. Install DevOps Skills
git clone https://github.com/lgbarn/devops-skills.git "%USERPROFILE%\.config\opencode\devops-skills"

:: 2. Create directories
mkdir "%USERPROFILE%\.config\opencode\plugin" 2>nul
mkdir "%USERPROFILE%\.config\opencode\skills" 2>nul

:: 3. Remove existing links (safe for reinstalls)
del "%USERPROFILE%\.config\opencode\plugin\devops-skills.js" 2>nul
rmdir "%USERPROFILE%\.config\opencode\skills\devops-skills" 2>nul

:: 4. Create plugin symlink (requires Developer Mode or Admin)
mklink "%USERPROFILE%\.config\opencode\plugin\devops-skills.js" "%USERPROFILE%\.config\opencode\devops-skills\.opencode\plugin\devops-skills.js"

:: 5. Create skills junction (works without special privileges)
mklink /J "%USERPROFILE%\.config\opencode\skills\devops-skills" "%USERPROFILE%\.config\opencode\devops-skills\skills"

:: 6. Restart OpenCode
```

#### PowerShell

Run as Administrator, or with Developer Mode enabled:

```powershell
# 1. Install DevOps Skills
git clone https://github.com/lgbarn/devops-skills.git "$env:USERPROFILE\.config\opencode\devops-skills"

# 2. Create directories
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\plugin"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skills"

# 3. Remove existing links (safe for reinstalls)
Remove-Item "$env:USERPROFILE\.config\opencode\plugin\devops-skills.js" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.config\opencode\skills\devops-skills" -Force -ErrorAction SilentlyContinue

# 4. Create plugin symlink (requires Developer Mode or Admin)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.config\opencode\plugin\devops-skills.js" -Target "$env:USERPROFILE\.config\opencode\devops-skills\.opencode\plugin\devops-skills.js"

# 5. Create skills junction (works without special privileges)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.config\opencode\skills\devops-skills" -Target "$env:USERPROFILE\.config\opencode\devops-skills\skills"

# 6. Restart OpenCode
```

#### Git Bash

Note: Git Bash's native `ln` command copies files instead of creating symlinks. Use `cmd //c mklink` instead (the `//c` is Git Bash syntax for `/c`).

```bash
# 1. Install DevOps Skills
git clone https://github.com/lgbarn/devops-skills.git ~/.config/opencode/devops-skills

# 2. Create directories
mkdir -p ~/.config/opencode/plugin ~/.config/opencode/skills

# 3. Remove existing links (safe for reinstalls)
rm -f ~/.config/opencode/plugin/devops-skills.js 2>/dev/null
rm -rf ~/.config/opencode/skills/devops-skills 2>/dev/null

# 4. Create plugin symlink (requires Developer Mode or Admin)
cmd //c "mklink \"$(cygpath -w ~/.config/opencode/plugin/devops-skills.js)\" \"$(cygpath -w ~/.config/opencode/devops-skills/.opencode/plugin/devops-skills.js)\""

# 5. Create skills junction (works without special privileges)
cmd //c "mklink /J \"$(cygpath -w ~/.config/opencode/skills/devops-skills)\" \"$(cygpath -w ~/.config/opencode/devops-skills/skills)\""

# 6. Restart OpenCode
```

#### WSL Users

If running OpenCode inside WSL, use the [macOS / Linux](#macos--linux) instructions instead.

#### Verify Installation

**Command Prompt:**
```cmd
dir /AL "%USERPROFILE%\.config\opencode\plugin"
dir /AL "%USERPROFILE%\.config\opencode\skills"
```

**PowerShell:**
```powershell
Get-ChildItem "$env:USERPROFILE\.config\opencode\plugin" | Where-Object { $_.LinkType }
Get-ChildItem "$env:USERPROFILE\.config\opencode\skills" | Where-Object { $_.LinkType }
```

Look for `<SYMLINK>` or `<JUNCTION>` in the output.

#### Troubleshooting Windows

**"You do not have sufficient privilege" error:**
- Enable Developer Mode in Windows Settings, OR
- Right-click your terminal → "Run as Administrator"

**"Cannot create a file when that file already exists":**
- Run the removal commands (step 3) first, then retry

**Symlinks not working after git clone:**
- Run `git config --global core.symlinks true` and re-clone

## Usage

### Finding Skills

Use OpenCode's native `skill` tool to list all available skills:

```
use skill tool to list skills
```

### Loading a Skill

Use OpenCode's native `skill` tool to load a specific skill:

```
use skill tool to load devops-skills/brainstorming
```

### Personal Skills

Create your own skills in `~/.config/opencode/skills/`:

```bash
mkdir -p ~/.config/opencode/skills/my-skill
```

Create `~/.config/opencode/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: Use when [condition] - [what it does]
---

# My Skill

[Your skill content here]
```

### Project Skills

Create project-specific skills in your OpenCode project:

```bash
# In your OpenCode project
mkdir -p .opencode/skills/my-project-skill
```

Create `.opencode/skills/my-project-skill/SKILL.md`:

```markdown
---
name: my-project-skill
description: Use when [condition] - [what it does]
---

# My Project Skill

[Your skill content here]
```

## Skill Locations

OpenCode discovers skills from these locations:

1. **Project skills** (`.opencode/skills/`) - Highest priority
2. **Personal skills** (`~/.config/opencode/skills/`)
3. **DevOps Skills skills** (`~/.config/opencode/skills/devops-skills/`) - via symlink

## Features

### Automatic Context Injection

The plugin automatically injects devops-skills context via the `experimental.chat.system.transform` hook. This adds the "using-devops-skills" skill content to the system prompt on every request.

### Native Skills Integration

DevOps Skills uses OpenCode's native `skill` tool for skill discovery and loading. Skills are symlinked into `~/.config/opencode/skills/devops-skills/` so they appear alongside your personal and project skills.

### Tool Mapping

Skills written for Claude Code are automatically adapted for OpenCode. The bootstrap provides mapping instructions:

- `TodoWrite` → `update_plan`
- `Task` with subagents → OpenCode's `@mention` system
- `Skill` tool → OpenCode's native `skill` tool
- File operations → Native OpenCode tools

## Architecture

### Plugin Structure

**Location:** `~/.config/opencode/devops-skills/.opencode/plugin/devops-skills.js`

**Components:**
- `experimental.chat.system.transform` hook for bootstrap injection
- Reads and injects the "using-devops-skills" skill content

### Skills

**Location:** `~/.config/opencode/skills/devops-skills/` (symlink to `~/.config/opencode/devops-skills/skills/`)

Skills are discovered by OpenCode's native skill system. Each skill has a `SKILL.md` file with YAML frontmatter.

## Updating

```bash
cd ~/.config/opencode/devops-skills
git pull
```

Restart OpenCode to load the updates.

## Troubleshooting

### Plugin not loading

1. Check plugin exists: `ls ~/.config/opencode/devops-skills/.opencode/plugin/devops-skills.js`
2. Check symlink/junction: `ls -l ~/.config/opencode/plugin/` (macOS/Linux) or `dir /AL %USERPROFILE%\.config\opencode\plugin` (Windows)
3. Check OpenCode logs: `opencode run "test" --print-logs --log-level DEBUG`
4. Look for plugin loading message in logs

### Skills not found

1. Verify skills symlink: `ls -l ~/.config/opencode/skills/devops-skills` (should point to devops-skills/skills/)
2. Use OpenCode's `skill` tool to list available skills
3. Check skill structure: each skill needs a `SKILL.md` file with valid frontmatter

### Windows: Module not found error

If you see `Cannot find module` errors on Windows:
- **Cause:** Git Bash `ln -sf` copies files instead of creating symlinks
- **Fix:** Use `mklink /J` directory junctions instead (see Windows installation steps)

### Bootstrap not appearing

1. Verify using-devops-skills skill exists: `ls ~/.config/opencode/devops-skills/skills/using-devops-skills/SKILL.md`
2. Check OpenCode version supports `experimental.chat.system.transform` hook
3. Restart OpenCode after plugin changes

## Getting Help

- Report issues: https://github.com/lgbarn/devops-skills/issues
- Main documentation: https://github.com/lgbarn/devops-skills
- OpenCode docs: https://opencode.ai/docs/

## Testing

Verify your installation:

```bash
# Check plugin loads
opencode run --print-logs "hello" 2>&1 | grep -i devops-skills

# Check skills are discoverable
opencode run "use skill tool to list all skills" 2>&1 | grep -i devops-skills

# Check bootstrap injection
opencode run "what devops-skills do you have?"
```

The agent should mention having devops-skills and be able to list skills from `devops-skills/`.
