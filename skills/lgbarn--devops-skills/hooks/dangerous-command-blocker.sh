#!/usr/bin/env bash
# PreToolUse hook: Block dangerous terraform/tofu commands
# Blocks: destroy, state rm, force-unlock, -auto-approve flag

set -euo pipefail

# Read the tool input from stdin (JSON format)
INPUT=$(cat)

# Extract the command being run
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")

# Check for -auto-approve flag anywhere
if echo "$COMMAND" | grep -qE '\-auto-approve'; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: The -auto-approve flag is not allowed.\n\nAuto-approve bypasses the safety review process that exists to prevent mistakes.\n\nInfrastructure changes must always be reviewed before execution.\n\nUse the /plan command for a proper review workflow."
}
EOF
    exit 0
fi

# Check for terraform/tofu destroy
if echo "$COMMAND" | grep -qE '(terraform|tofu)[[:space:]]+(destroy)'; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: terraform/tofu destroy commands are blocked.\n\nDestroy operations can cause irreversible data loss and service outages.\n\nIf you genuinely need to destroy infrastructure:\n1. First run: terraform plan -destroy\n2. Review the destruction plan carefully\n3. Discuss with the user before proceeding\n4. User must explicitly approve destroy operations\n\nThis is a safety measure because destroy operations cannot be undone."
}
EOF
    exit 0
fi

# Check for terraform state rm
if echo "$COMMAND" | grep -qE '(terraform|tofu)[[:space:]]+state[[:space:]]+rm'; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: terraform state rm commands are blocked.\n\nRemoving resources from state can orphan real infrastructure and cause drift.\n\nIf you need to perform state surgery:\n1. Use the devops-skills:terraform-state-operations skill\n2. Create a state backup first\n3. Document the reason for state modification\n4. Get explicit user approval\n\nState operations are dangerous and require careful planning."
}
EOF
    exit 0
fi

# Check for terraform force-unlock
if echo "$COMMAND" | grep -qE '(terraform|tofu)[[:space:]]+force-unlock'; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: terraform force-unlock commands are blocked.\n\nForce-unlocking state can cause corruption if another process is genuinely using the lock.\n\nBefore force-unlocking:\n1. Verify no other terraform processes are running\n2. Check if a CI/CD pipeline might be holding the lock\n3. Identify why the lock wasn't released properly\n4. Get explicit user approval\n\nUse the devops-skills:terraform-state-operations skill for guided state lock management."
}
EOF
    exit 0
fi

# Check for terraform state push (can overwrite state)
if echo "$COMMAND" | grep -qE '(terraform|tofu)[[:space:]]+state[[:space:]]+push'; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "SAFETY BLOCK: terraform state push commands are blocked.\n\nPushing state can overwrite the current state and cause data loss.\n\nIf you need to restore or modify state:\n1. Use the devops-skills:terraform-state-operations skill\n2. Create a backup of current state first\n3. Verify the state file you're pushing is correct\n4. Get explicit user approval\n\nState push operations require careful validation."
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
