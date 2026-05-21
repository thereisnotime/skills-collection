#!/usr/bin/env bash
set -euo pipefail

# claude-blog installer
# Installs the blog skill ecosystem to ~/.claude/skills/ and ~/.claude/agents/
#
# One-command install:
#   curl -sL https://raw.githubusercontent.com/AgriciDaniel/claude-blog/main/install.sh | bash

# Declared outside main() so the EXIT trap can access it after main() returns
TEMP_DIR=""

main() {
    local SKILL_DIR="${HOME}/.claude/skills"
    local AGENT_DIR="${HOME}/.claude/agents"
    local SCRIPT_DIR

    echo ""
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║         claude-blog Installer        ║"
    echo "  ║  Blog Content Engine for Claude Code ║"
    echo "  ╚══════════════════════════════════════╝"
    echo ""

    # Determine source directory (local clone or piped from curl)
    if [ -f "${BASH_SOURCE[0]:-}" ] && [ -d "$(dirname "${BASH_SOURCE[0]}")/skills/blog" ]; then
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    else
        echo "→ Cloning claude-blog..."
        TEMP_DIR="$(mktemp -d)"
        trap 'rm -rf "${TEMP_DIR}"' EXIT
        git clone --depth 1 https://github.com/AgriciDaniel/claude-blog.git "${TEMP_DIR}/claude-blog" 2>/dev/null
        SCRIPT_DIR="${TEMP_DIR}/claude-blog"
    fi

    # Check prerequisites
    if ! command -v python3 &>/dev/null; then
        echo "WARNING: python3 not found. The scripts require Python 3.11+."
        echo "         Install with: sudo apt install python3"
        echo ""
    fi

    # Create directories
    echo "→ Creating directories..."
    mkdir -p "${SKILL_DIR}/blog/references"
    mkdir -p "${SKILL_DIR}/blog/templates"
    mkdir -p "${SKILL_DIR}/blog/scripts"
    mkdir -p "${AGENT_DIR}"

    # Copy main skill
    echo "→ Installing main skill: blog..."
    cp "${SCRIPT_DIR}/skills/blog/SKILL.md" "${SKILL_DIR}/blog/SKILL.md"

    # Copy references
    echo "→ Installing reference files..."
    if ls "${SCRIPT_DIR}/skills/blog/references/"*.md &>/dev/null; then
        cp "${SCRIPT_DIR}/skills/blog/references/"*.md "${SKILL_DIR}/blog/references/"
    fi

    # Copy templates
    if ls "${SCRIPT_DIR}/skills/blog/templates/"*.md &>/dev/null; then
        echo "→ Installing content templates..."
        cp "${SCRIPT_DIR}/skills/blog/templates/"*.md "${SKILL_DIR}/blog/templates/"
    fi

    # Copy sub-skills (auto-discovers all skill directories)
    echo "→ Installing sub-skills..."
    for skill_dir in "${SCRIPT_DIR}/skills/"*/; do
        skill_name="$(basename "${skill_dir}")"
        [ "$skill_name" = "blog" ] && continue
        # VULN-IAC-003 (v1.9.1): defense-in-depth name validation. The
        # repo is single-owner and a clean clone cannot produce odd names,
        # but a tampered repo with a symlink like `skills/../../etc` would
        # hand us '..' here. Refuse anything outside the expected charset
        # rather than mkdir + cp into the parent.
        if ! printf '%s' "$skill_name" | grep -Eq '^[a-z0-9-]+$'; then
            echo "  ! refusing skill with unexpected name: ${skill_name}" >&2
            continue
        fi
        mkdir -p "${SKILL_DIR}/${skill_name}"
        if [ -f "${skill_dir}SKILL.md" ]; then
            cp "${skill_dir}SKILL.md" "${SKILL_DIR}/${skill_name}/SKILL.md"
            echo "  + ${skill_name}"
        fi
        # Copy references/ if present
        if [ -d "${skill_dir}references" ]; then
            mkdir -p "${SKILL_DIR}/${skill_name}/references"
            cp "${skill_dir}references/"* "${SKILL_DIR}/${skill_name}/references/" 2>/dev/null || true
        fi
        # Copy scripts/ if present
        if [ -d "${skill_dir}scripts" ]; then
            mkdir -p "${SKILL_DIR}/${skill_name}/scripts"
            cp "${skill_dir}scripts/"* "${SKILL_DIR}/${skill_name}/scripts/" 2>/dev/null || true
            chmod +x "${SKILL_DIR}/${skill_name}/scripts/"*.py 2>/dev/null || true
        fi
    done

    # Create personas directory for blog-persona
    mkdir -p "${SKILL_DIR}/blog/references/personas"

    # Copy agents
    echo "→ Installing agents..."
    for agent_file in "${SCRIPT_DIR}/agents/"*.md; do
        if [ -f "${agent_file}" ]; then
            agent_name="$(basename "${agent_file}")"
            cp "${agent_file}" "${AGENT_DIR}/${agent_name}"
            echo "  + ${agent_name%.md}"
        fi
    done

    # Copy scripts (v1.8.6: ALL root-level scripts, not just analyze_blog.py).
    # Before v1.8.6 the installer only copied analyze_blog.py, leaving the
    # v1.8.0+ helpers (cognitive_load, discourse_research, load_untrusted_root,
    # lint_prose, sync_flow) absent on the user's machine. This broke the
    # v1.8.3 "code-enforced" untrusted-data contract for every marketplace
    # / curl-pipe install (closes 7TH-AUDIT-001).
    echo "→ Installing scripts..."
    mkdir -p "${SKILL_DIR}/blog/scripts"
    mkdir -p "${HOME}/.claude/scripts"
    local script_name
    for script_path in "${SCRIPT_DIR}/scripts/"*.py; do
        [ -f "${script_path}" ] || continue
        script_name="$(basename "${script_path}")"
        # Copy to ~/.claude/scripts/ (canonical install location) AND to the
        # blog-skill scripts dir (legacy callers of analyze_blog.py).
        cp "${script_path}" "${HOME}/.claude/scripts/${script_name}"
        chmod +x "${HOME}/.claude/scripts/${script_name}"
        if [ "${script_name}" = "analyze_blog.py" ]; then
            cp "${script_path}" "${SKILL_DIR}/blog/scripts/${script_name}"
            chmod +x "${SKILL_DIR}/blog/scripts/${script_name}"
        fi
        echo "  + scripts/${script_name}"
    done

    # Install Python dependencies (closes audit VULN-507/804: capture stderr
    # to a logfile instead of swallowing it. Operator can diagnose failures.)
    if [ -f "${SCRIPT_DIR}/requirements.txt" ] && command -v pip3 &>/dev/null; then
        echo "→ Installing Python dependencies..."
        local pip_log
        pip_log="$(mktemp -t claude-blog-pip-XXXXXX.log)"
        if pip3 install --quiet -r "${SCRIPT_DIR}/requirements.txt" 2>"${pip_log}"; then
            rm -f "${pip_log}"
        else
            echo "  WARNING: pip install failed."
            echo "  See log: ${pip_log}"
            echo "  First error: $(head -n1 "${pip_log}" 2>/dev/null || echo '(empty)')"
            echo "  Manual install: pip3 install -r requirements.txt"
        fi
        echo "  Tip: Consider using a virtual environment: python3 -m venv .venv && source .venv/bin/activate"
    fi

    echo ""
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║       Installation Complete!         ║"
    echo "  ╚══════════════════════════════════════╝"
    echo ""
    echo "  Installed:"
    echo "    Main skill:   blog/ (orchestrator + 20 references + 12 templates)"
    echo "    Sub-skills:   30 (29 user-invokable + 1 internal blog-chart)"
    echo "    Agents:       5 specialists"
    echo "    Scripts:      9 root-level (analyze_blog, blog_preflight, blog_render,"
    echo "                  cognitive_load, discourse_research, generate_hero,"
    echo "                  load_untrusted_root, lint_prose, sync_flow) + per-skill scripts"
    echo ""
    echo "  Commands available:"
    echo "    /blog write <topic>        Write a new blog post"
    echo "    /blog rewrite <file>       Optimize an existing blog post"
    echo "    /blog analyze <file>       Audit blog quality (0-100 score)"
    echo "    /blog brief <topic>        Generate a content brief"
    echo "    /blog calendar             Generate an editorial calendar"
    echo "    /blog strategy <niche>     Blog strategy and topic ideation"
    echo "    /blog outline <topic>      SERP-informed outline generation"
    echo "    /blog seo-check <file>     Post-writing SEO validation"
    echo "    /blog schema <file>        Generate JSON-LD schema markup"
    echo "    /blog repurpose <file>     Repurpose for other platforms"
    echo "    /blog geo <file>           AI citation optimization audit"
    echo "    /blog image <idea>         AI image generation via Gemini"
    echo "    /blog audit [directory]    Full-site blog health assessment"
    echo "    /blog cannibalization      Detect keyword overlap across posts"
    echo "    /blog factcheck            Verify statistics against sources"
    echo "    /blog persona              Manage writing personas"
    echo "    /blog taxonomy             Tag/category CMS management"
    echo "    /blog notebooklm <query>   Query NotebookLM for research"
    echo "    /blog audio <file>         Generate audio narration via Gemini TTS"
    echo ""
    echo "  Optional: AI Features (same API key for both)"
    echo "    /blog image setup             Configure Gemini image generation"
    echo "    /blog audio setup             Configure Gemini TTS audio narration"
    echo "    Requires: Google AI API key (free at https://aistudio.google.com/apikey)"
    echo ""
    echo "  Restart Claude Code to activate the new skill."
}

main "$@"
