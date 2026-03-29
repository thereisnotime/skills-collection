#!/usr/bin/env bash
# PreToolUse hook: Block terraform/tofu apply commands
# This hook intercepts Bash commands and blocks apply operations

set -euo pipefail

# Read the tool input from stdin (JSON format)
INPUT=$(cat)

# Extract the command being run
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")

# Check if this is a terraform/tofu apply command
if echo "$COMMAND" | grep -qE '(terraform|tofu)[[:space:]]+(apply)'; then
    # Block the command
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: terraform/tofu apply commands are not allowed directly.\n\nTo apply infrastructure changes safely:\n1. Use the /plan command to analyze changes first\n2. Review the plan output and risk analysis\n3. Get explicit approval before any apply\n\nThis safety measure exists because your #1 goal is fewer mistakes.\n\nIf you need to apply changes, use the devops-skills:terraform-plan-review skill which includes a proper approval workflow."
}
EOF
    exit 0
fi

# Allow the command to proceed
cat <<'EOF'
{
  "decision": "allow"
}
EOF
