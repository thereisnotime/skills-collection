#!/usr/bin/env bash
set -euo pipefail

# claude-blog uninstaller
# Cleanly removes all blog skills, agents, templates, and scripts

main() {
    local SKILL_DIR="${HOME}/.claude/skills"
    local AGENT_DIR="${HOME}/.claude/agents"

    echo "=== Uninstalling claude-blog ==="
    echo ""

    # Remove main skill (includes references, templates, scripts)
    if [ -d "${SKILL_DIR}/blog" ]; then
        rm -rf "${SKILL_DIR}/blog"
        echo "  Removed: ${SKILL_DIR}/blog/"
    fi

    # Remove sub-skills (auto-discovers all blog-* directories)
    for skill_dir in "${SKILL_DIR}"/blog-*; do
        if [ -d "${skill_dir}" ]; then
            rm -rf "${skill_dir}"
            echo "  Removed: ${skill_dir}/"
        fi
    done

    # Remove agents
    for agent in blog-researcher blog-writer blog-seo blog-reviewer; do
        if [ -f "${AGENT_DIR}/${agent}.md" ]; then
            rm -f "${AGENT_DIR}/${agent}.md"
            echo "  Removed: ${AGENT_DIR}/${agent}.md"
        fi
    done

    echo ""
    echo "=== claude-blog uninstalled ==="
    echo ""
    echo "Restart Claude Code to complete removal."
}

main "$@"
