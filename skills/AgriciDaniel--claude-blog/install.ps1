#!/usr/bin/env pwsh
# claude-blog installer for Windows
# Installs the blog skill ecosystem to ~/.claude/skills/ and ~/.claude/agents/
#
# One-command install:
#   irm https://raw.githubusercontent.com/AgriciDaniel/claude-blog/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

function Write-Color($Color, $Text) {
    Write-Host $Text -ForegroundColor $Color
}

function Main {
    Write-Color Cyan @"

   ╔══════════════════════════════════════╗
   ║         claude-blog Installer        ║
   ║  Blog Content Engine for Claude Code ║
   ╚══════════════════════════════════════╝

"@

    $SkillDir = Join-Path $env:USERPROFILE ".claude" "skills"
    $AgentDir = Join-Path $env:USERPROFILE ".claude" "agents"
    $TempDir = $null

    # Determine source directory (local clone or piped from irm)
    if ($MyInvocation.MyCommand.Path -and (Test-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "skills" "blog"))) {
        $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    } else {
        Write-Color White "Cloning claude-blog..."
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "claude-blog-install-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
        git clone --depth 1 https://github.com/AgriciDaniel/claude-blog.git $TempDir 2>$null
        $ScriptDir = $TempDir
    }

    # Check prerequisites
    try {
        $null = Get-Command python3 -ErrorAction Stop
    } catch {
        try {
            $null = Get-Command python -ErrorAction Stop
        } catch {
            Write-Color Yellow "WARNING: Python not found. The analyze_blog.py script requires Python 3.12+."
        }
    }

    # Create directories
    Write-Color White "Creating directories..."
    New-Item -ItemType Directory -Force -Path (Join-Path $SkillDir "blog" "references") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $SkillDir "blog" "templates") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $SkillDir "blog" "scripts") | Out-Null
    New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null

    # Copy main skill
    Write-Color White "Installing main skill: blog..."
    Copy-Item (Join-Path $ScriptDir "skills" "blog" "SKILL.md") (Join-Path $SkillDir "blog" "SKILL.md") -Force

    # Copy references
    Write-Color White "Installing reference files..."
    Copy-Item (Join-Path $ScriptDir "skills" "blog" "references" "*.md") (Join-Path $SkillDir "blog" "references") -Force

    # Copy templates
    if (Test-Path (Join-Path $ScriptDir "skills" "blog" "templates")) {
        Write-Color White "Installing content templates..."
        Copy-Item (Join-Path $ScriptDir "skills" "blog" "templates" "*.md") (Join-Path $SkillDir "blog" "templates") -Force
    }

    # Copy sub-skills (auto-discovers all skill directories)
    Write-Color White "Installing sub-skills..."
    Get-ChildItem -Directory (Join-Path $ScriptDir "skills") | ForEach-Object {
        $skillName = $_.Name
        if ($skillName -eq "blog") { return }
        $skillDst = Join-Path $SkillDir $skillName
        New-Item -ItemType Directory -Force -Path $skillDst | Out-Null

        # Copy SKILL.md
        $src = Join-Path $_.FullName "SKILL.md"
        if (Test-Path $src) {
            Copy-Item $src (Join-Path $skillDst "SKILL.md") -Force
            Write-Color Green "  + $skillName"
        }

        # Copy references/ if present
        $refSrc = Join-Path $_.FullName "references"
        if (Test-Path $refSrc) {
            $refDst = Join-Path $skillDst "references"
            New-Item -ItemType Directory -Force -Path $refDst | Out-Null
            Get-ChildItem -File $refSrc | ForEach-Object {
                Copy-Item $_.FullName (Join-Path $refDst $_.Name) -Force
            }
        }

        # Copy scripts/ if present
        $scriptSrc = Join-Path $_.FullName "scripts"
        if (Test-Path $scriptSrc) {
            $scriptDst = Join-Path $skillDst "scripts"
            New-Item -ItemType Directory -Force -Path $scriptDst | Out-Null
            Get-ChildItem -File $scriptSrc | ForEach-Object {
                Copy-Item $_.FullName (Join-Path $scriptDst $_.Name) -Force
            }
        }
    }

    # Create personas directory for blog-persona
    New-Item -ItemType Directory -Force -Path (Join-Path $SkillDir "blog" "references" "personas") | Out-Null

    # Copy agents
    Write-Color White "Installing agents..."
    Get-ChildItem -File (Join-Path $ScriptDir "agents" "*.md") | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $AgentDir $_.Name) -Force
        Write-Color Green "  + $($_.BaseName)"
    }

    # Copy scripts
    Write-Color White "Installing scripts..."
    Copy-Item (Join-Path $ScriptDir "scripts" "analyze_blog.py") (Join-Path $SkillDir "blog" "scripts" "analyze_blog.py") -Force

    # Install Python dependencies
    Write-Color White "Installing Python dependencies..."
    $reqFile = Join-Path $ScriptDir "requirements.txt"
    if (Test-Path $reqFile) {
        try {
            & python3 -m pip install --quiet -r $reqFile 2>$null
            Write-Color Green "  Python dependencies installed."
        } catch {
            try {
                & python -m pip install --quiet -r $reqFile 2>$null
                Write-Color Green "  Python dependencies installed."
            } catch {
                Write-Color Yellow "  Skipped: Install manually with 'pip install -r requirements.txt'"
            }
        }
    }

    # Cleanup temp directory if used
    if ($TempDir -and (Test-Path $TempDir)) {
        Remove-Item -Recurse -Force $TempDir
    }

    # Summary
    Write-Color Cyan @"

   ╔══════════════════════════════════════╗
   ║       Installation Complete!         ║
   ╚══════════════════════════════════════╝

"@

    Write-Color White "Installed:"
    Write-Color Green "  Main skill:   blog/ (orchestrator + 12 references + 12 templates)"
    Write-Color Green "  Sub-skills:   20 (19 commands + 1 internal)"
    Write-Color Green "  Agents:       4 specialists"
    Write-Color Green "  Scripts:      analyze_blog.py"
    Write-Color White ""
    Write-Color White "Commands available:"
    Write-Color Cyan  "  /blog write <topic>        Write a new blog post"
    Write-Color Cyan  "  /blog rewrite <file>       Optimize an existing blog post"
    Write-Color Cyan  "  /blog analyze <file>       Audit blog quality (0-100 score)"
    Write-Color Cyan  "  /blog brief <topic>        Generate a content brief"
    Write-Color Cyan  "  /blog calendar             Generate an editorial calendar"
    Write-Color Cyan  "  /blog strategy <niche>     Blog strategy and topic ideation"
    Write-Color Cyan  "  /blog outline <topic>      Generate a SERP-informed outline"
    Write-Color Cyan  "  /blog seo-check <file>     Post-writing SEO validation"
    Write-Color Cyan  "  /blog schema <file>        Generate JSON-LD schema markup"
    Write-Color Cyan  "  /blog repurpose <file>     Repurpose content for other platforms"
    Write-Color Cyan  "  /blog geo <file>           AI citation optimization audit"
    Write-Color Cyan  "  /blog image <idea>         AI image generation via Gemini"
    Write-Color Cyan  "  /blog audit [directory]    Full-site blog health assessment"
    Write-Color Cyan  "  /blog cannibalization      Detect keyword overlap across posts"
    Write-Color Cyan  "  /blog factcheck            Verify statistics against sources"
    Write-Color Cyan  "  /blog persona              Manage writing personas"
    Write-Color Cyan  "  /blog taxonomy             Tag/category CMS management"
    Write-Color Cyan  "  /blog notebooklm <query>   Query NotebookLM for research"
    Write-Color Cyan  "  /blog audio <file>         Generate audio narration via Gemini TTS"
    Write-Color White ""
    Write-Color White "Optional: AI Features (same API key for both)"
    Write-Color Cyan  "  /blog image setup             Configure Gemini image generation"
    Write-Color Cyan  "  /blog audio setup             Configure Gemini TTS audio narration"
    Write-Color White "  Requires: Google AI API key (free at https://aistudio.google.com/apikey)"
    Write-Color White ""
    Write-Color Yellow "Restart Claude Code to activate the new skill."
}

Main
