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

    # Remove agents via glob (closes meta-audit follow-up: prior static list
    # missed blog-translator added in v1.7.0; mirror the install.ps1 pattern).
    if [ -d "${AGENT_DIR}" ]; then
        for agent_file in "${AGENT_DIR}"/blog-*.md; do
            if [ -f "${agent_file}" ]; then
                rm -f "${agent_file}"
                echo "  Removed: ${agent_file}"
            fi
        done
    fi

    # Purge credential artifacts (mirrors uninstall.ps1 audit fix VULN-805
    # follow-up: cookies/tokens left behind post-uninstall is a meaningful
    # exposure window).
    for cred_path in \
        "${HOME}/.config/claude-seo/oauth-token.json" \
        "${HOME}/.config/claude-seo/google-api.json"
    do
        if [ -f "${cred_path}" ]; then
            rm -f "${cred_path}"
            echo "  Removed credential: ${cred_path}"
        fi
    done

    echo ""
    echo "=== claude-blog uninstalled ==="
    echo ""
    echo "Restart Claude Code to complete removal."
}

main "$@"
