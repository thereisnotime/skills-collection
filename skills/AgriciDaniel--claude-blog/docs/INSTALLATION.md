# Installation Guide

This guide covers all installation methods for `claude-blog`, a Claude Code skill
ecosystem for blog content creation, optimization, and management.

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) | Latest | Runtime for all `/blog` commands |
| Python | 3.11+ | Quality analysis script (`analyze_blog.py`) |
| pip | Latest | Python dependency management |

Claude Code must be installed and configured before installing `claude-blog`.
Python is only required for the `analyze_blog.py` quality scoring script; all
other commands work without it.

---

## Quick Install (One Command)

### Linux / macOS

```bash
curl -sL https://raw.githubusercontent.com/AgriciDaniel/claude-blog/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/AgriciDaniel/claude-blog/main/install.ps1 | iex
```

Both installers automatically copy all skills, agents, references, templates,
and scripts to the correct Claude Code configuration directories.

---

## Standard Install (Git Clone)

```bash
git clone https://github.com/AgriciDaniel/claude-blog.git
cd claude-blog
chmod +x install.sh
./install.sh
```

### Install Python Dependencies

The installer on Linux/macOS does not auto-install Python packages. Run this
after the main install:

```bash
pip install -r requirements.txt
```

**Core dependencies:**

| Package | Version | Purpose |
|---------|---------|---------|
| textstat | >=0.7.3 | Readability scoring (Flesch, Gunning Fog, SMOG) |
| beautifulsoup4 | >=4.12.0 | HTML and schema parsing |
| lxml | >=5.0.0 | XML/HTML parser backend |
| jsonschema | >=4.20.0 | JSON-LD schema validation |

**Optional dependencies** (unlock advanced features in `analyze_blog.py`):

```bash
pip install spacy                  # NER, advanced NLP
python -m spacy download en_core_web_sm
pip install sentence-transformers  # Semantic similarity / duplicate detection
pip install scikit-learn           # Topic cannibalization clustering
pip install language-tool-python   # Grammar and style checking (requires Java)
```

The analysis script works without optional dependencies by falling back to
basic mode automatically.

---

## Manual Install (File by File)

If you prefer not to run the installer, copy files to these paths manually.
`~` refers to your home directory (`$HOME` on Unix, `%USERPROFILE%` on Windows).

### Directory Structure

```
~/.claude/
├── skills/
│   ├── blog/
│   │   ├── SKILL.md                          # Main orchestrator
│   │   ├── references/
│   │   │   ├── content-rules.md
│   │   │   ├── geo-optimization.md
│   │   │   ├── google-landscape-2026.md
│   │   │   ├── quality-scoring.md
│   │   │   └── visual-media.md
│   │   ├── templates/                        # 12 content type templates
│   │   │   └── *.md
│   │   └── scripts/
│   │       └── analyze_blog.py
│   ├── blog-write/SKILL.md
│   ├── blog-rewrite/SKILL.md
│   ├── blog-analyze/SKILL.md
│   ├── blog-brief/SKILL.md
│   ├── blog-calendar/SKILL.md
│   ├── blog-strategy/SKILL.md
│   ├── blog-outline/SKILL.md
│   ├── blog-seo-check/SKILL.md
│   ├── blog-schema/SKILL.md
│   ├── blog-repurpose/SKILL.md
│   ├── blog-geo/SKILL.md
│   ├── blog-audit/SKILL.md
│   ├── blog-chart/SKILL.md
│   └── blog-image/
│       ├── SKILL.md
│       ├── references/
│       │   ├── gemini-models.md
│       │   ├── mcp-tools.md
│       │   └── prompt-engineering-blog.md
│       └── scripts/
│           ├── setup_image_mcp.py
│           └── validate_image_setup.py
└── agents/
    ├── blog-researcher.md
    ├── blog-writer.md
    ├── blog-seo.md
    └── blog-reviewer.md
```

### Copy Commands (Unix)

```bash
# Create directories
mkdir -p ~/.claude/skills/blog/{references,templates,scripts}
mkdir -p ~/.claude/skills/blog-{write,rewrite,analyze,brief,calendar,strategy,outline,seo-check,schema,repurpose,geo,audit,chart,image}
mkdir -p ~/.claude/skills/blog-image/{references,scripts}
mkdir -p ~/.claude/agents

# Main skill
cp skills/blog/SKILL.md ~/.claude/skills/blog/SKILL.md

# References
cp skills/blog/references/*.md ~/.claude/skills/blog/references/

# Templates
cp skills/blog/templates/*.md ~/.claude/skills/blog/templates/

# Sub-skills
for d in skills/blog-*/; do
    name=$(basename "$d")
    cp "$d/SKILL.md" ~/.claude/skills/$name/SKILL.md
done

# Agents
cp agents/*.md ~/.claude/agents/

# Scripts
cp scripts/analyze_blog.py ~/.claude/skills/blog/scripts/
chmod +x ~/.claude/skills/blog/scripts/analyze_blog.py

# Blog-image references and scripts
cp skills/blog-image/references/*.md ~/.claude/skills/blog-image/references/
cp skills/blog-image/scripts/*.py ~/.claude/skills/blog-image/scripts/
chmod +x ~/.claude/skills/blog-image/scripts/*.py
```

---

## Optional: AI Image Generation

`claude-blog` can generate custom blog images via Gemini AI (hero images, inline
illustrations, social cards). This requires the nanobanana-mcp server and a free
Google AI API key.

### Setup

```bash
# Get your free API key at: https://aistudio.google.com/apikey
python3 skills/blog-image/scripts/setup_image_mcp.py --key YOUR_KEY

# Verify setup
python3 skills/blog-image/scripts/validate_image_setup.py
```

### Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ | Runs `npx @ycse/nanobanana-mcp` |
| Google AI API key | Free tier | Image generation via Gemini |

Without this setup, all `/blog` commands work normally using stock photos from
Pixabay/Unsplash/Pexels. AI image generation is an optional enhancement.

---

## Verification

After installation, verify everything is in place:

### 1. Check installed files

```bash
# Main skill
ls ~/.claude/skills/blog/SKILL.md

# Sub-skills (should list 14)
ls ~/.claude/skills/blog-*/SKILL.md | wc -l

# Agents (should list 4)
ls ~/.claude/agents/blog-*.md | wc -l

# References (should list 5+)
ls ~/.claude/skills/blog/references/*.md | wc -l

# Python script
ls ~/.claude/skills/blog/scripts/analyze_blog.py
```

### 2. Restart Claude Code

Close and reopen Claude Code (or restart the CLI) to load the new skills:

```bash
# If running in terminal, exit and relaunch
claude
```

### 3. Test a command

```bash
# Inside Claude Code, run:
/blog strategy "home automation"
```

You should see the orchestrator route to the `blog-strategy` sub-skill and
begin gathering context about the niche.

### 4. Test the Python analysis script

```bash
python3 ~/.claude/skills/blog/scripts/analyze_blog.py --help
```

Expected output:

```
usage: analyze_blog.py [-h] [--output OUTPUT] [--batch] input

Analyze blog post quality

positional arguments:
  input                 Blog file path or directory (with --batch)

options:
  -h, --help            show this help message and exit
  --output OUTPUT, -o OUTPUT
                        Output file path (JSON)
  --batch               Analyze all blog files in directory
```

---

## Updating

Pull the latest changes and re-run the installer:

```bash
cd claude-blog
git pull
./install.sh
```

The installer overwrites existing files, so updates are safe to run
at any time. Restart Claude Code after updating.

---

## Uninstall

### Automated Uninstall (Unix)

```bash
# From the claude-blog repository
chmod +x uninstall.sh
./uninstall.sh
```

This removes:

- `~/.claude/skills/blog/` (main skill, references, templates, scripts)
- `~/.claude/skills/blog-*/` (all 14 sub-skills including blog-chart and blog-image)
- `~/.claude/agents/blog-*.md` (all 4 agents)

### Manual Uninstall

```bash
rm -rf ~/.claude/skills/blog
rm -rf ~/.claude/skills/blog-{write,rewrite,analyze,brief,calendar,strategy,outline,seo-check,schema,repurpose,geo,audit,chart,image}
rm -f ~/.claude/agents/blog-{researcher,writer,seo,reviewer}.md
```

### Clean Up Python Dependencies (Optional)

```bash
pip uninstall textstat beautifulsoup4 lxml jsonschema
```

Restart Claude Code after uninstalling to complete removal.

---

## Troubleshooting Installation

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/blog` command not found | Claude Code not restarted | Close and reopen Claude Code |
| `python3: command not found` | Python not installed or not in PATH | Install Python 3.11+ via your package manager |
| `pip install` fails | Missing pip or wrong Python version | Run `python3 -m ensurepip --upgrade` |
| Permission denied on `install.sh` | Script not executable | Run `chmod +x install.sh` |
| Files not in `~/.claude/` | Wrong install location | Verify `$HOME` points to your home directory |

For additional issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
