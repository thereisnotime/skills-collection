#!/usr/bin/env bash
# SessionStart hook for devops-skills plugin

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Initialize memory directory structure if it doesn't exist
MEMORY_DIR="${PLUGIN_ROOT}/memory"
mkdir -p "${MEMORY_DIR}/projects" "${MEMORY_DIR}/global" 2>/dev/null || true

# Check if legacy skills directory exists and build warning
warning_message=""
legacy_skills_dir="${HOME}/.config/devops-skills/skills"
if [ -d "$legacy_skills_dir" ]; then
    warning_message="\n\n<important-reminder>IN YOUR FIRST REPLY AFTER SEEING THIS MESSAGE YOU MUST TELL THE USER:⚠️ **WARNING:** Legacy skills directory found. Custom skills in ~/.config/devops-skills/skills will not be read. Move custom skills to ~/.claude/skills instead. To make this message go away, remove ~/.config/devops-skills/skills</important-reminder>"
fi

# Read using-devops-skills content
using_devops-skills_content=$(cat "${PLUGIN_ROOT}/skills/using-devops-skills/SKILL.md" 2>&1 || echo "Error reading using-devops-skills skill")

# Escape outputs for JSON using pure bash
escape_for_json() {
    local input="$1"
    local output=""
    local i char
    for (( i=0; i<${#input}; i++ )); do
        char="${input:$i:1}"
        case "$char" in
            $'\\') output+='\\' ;;
            '"') output+='\"' ;;
            $'\n') output+='\n' ;;
            $'\r') output+='\r' ;;
            $'\t') output+='\t' ;;
            *) output+="$char" ;;
        esac
    done
    printf '%s' "$output"
}

using_devops-skills_escaped=$(escape_for_json "$using_devops-skills_content")
warning_escaped=$(escape_for_json "$warning_message")

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have devops-skills - a safety-first infrastructure management plugin.\n\n**Below is the full content of your 'devops-skills:using-devops-skills' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_devops-skills_escaped}\n\n${warning_escaped}\n</EXTREMELY_IMPORTANT>"
  }
}
EOF

exit 0
