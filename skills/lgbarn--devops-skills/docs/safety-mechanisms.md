# Safety Mechanisms in DevOps-Skills

This document describes the safety mechanisms built into devops-skills to prevent infrastructure mistakes.

## Philosophy

**The #1 goal is fewer mistakes.**

Infrastructure mistakes are:
- Often costly (both time and money)
- Sometimes irreversible (data loss, service outages)
- Preventable with proper workflows

DevOps-skills implements multiple layers of safety to catch mistakes before they happen.

## Safety Layers

### Layer 1: Command Blocking (Hooks)

Dangerous commands are blocked at the shell level before execution.

#### Blocked Commands

| Command | Why Blocked |
|---------|-------------|
| `terraform apply` | Must use /plan workflow for approval |
| `tofu apply` | Must use /plan workflow for approval |
| `terraform destroy` | Destructive, requires explicit workflow |
| `tofu destroy` | Destructive, requires explicit workflow |
| `terraform state rm` | Can orphan resources |
| `terraform state push` | Can overwrite state |
| `terraform force-unlock` | Can corrupt state if lock is legitimate |
| `-auto-approve` flag | Bypasses review process |

#### How Blocking Works

```
User/Claude attempts: terraform apply
    ↓
PreToolUse hook intercepts Bash command
    ↓
Hook checks for dangerous patterns
    ↓
If matched: BLOCK with explanation
If safe: ALLOW to proceed
```

#### Block Messages

When a command is blocked, the user sees:
- What was blocked and why
- What to do instead
- Link to proper workflow

Example:
```
SAFETY BLOCK: terraform apply commands are not allowed directly.

To apply infrastructure changes safely:
1. Use the /plan command to analyze changes first
2. Review the plan output and risk analysis
3. Get explicit approval before any apply

This safety measure exists because your #1 goal is fewer mistakes.
```

### Layer 2: Credential Verification

Before any AWS/Terraform operation, verify credentials match the target environment.

#### Verification Process

```
1. aws sts get-caller-identity
2. Compare account ID to expected environment
3. Verify role/user is appropriate
4. Check for credential expiry
```

#### Mismatches

If credentials don't match environment:
- **STOP** immediately
- Alert user to the mismatch
- Do not proceed until corrected

### Layer 3: Parallel Analysis

Multiple agents analyze changes from different perspectives.

#### Agents Involved

| Agent | Focus |
|-------|-------|
| terraform-plan-analyzer | Risk and impact |
| security-reviewer | Security implications |
| historical-pattern-analyzer | Past patterns and incidents |

#### How It Helps

- Single perspective may miss issues
- Different expertise catches different problems
- Aggregated view provides confidence

### Layer 4: Explicit Approval Gates

**Never auto-apply.** All changes require explicit user approval.

#### Approval Flow

```
1. Analysis complete
2. Present findings to user
3. Wait for explicit "approve"
4. Only then execute
```

#### What User Sees

```markdown
## Plan Analysis Summary

### Risk Level: MEDIUM

### Changes
- 3 resources to modify
- 0 resources to destroy

### Findings
[Detailed analysis from all agents]

### Approval Required
Do you want to proceed with terraform apply?
Type "approve" to continue.
```

### Layer 5: State Operation Protection

State operations (mv, rm, import) have additional safeguards.

#### Required Steps

1. **Backup First**
   ```bash
   terraform state pull > backup-$(date +%Y%m%d).tfstate
   ```

2. **Document Operation**
   - What operation
   - Why needed
   - Rollback plan

3. **Get Approval**
   - Explain impact
   - Confirm understanding
   - Explicit approval

4. **Verify After**
   - Run terraform plan
   - Confirm expected state

### Layer 6: Memory and Learning

Learn from past incidents to prevent repeats.

#### Stored Information

- Past incidents and resolutions
- Patterns that led to problems
- User preferences

#### How It's Used

Before major operations:
- Query for similar past changes
- Surface relevant incidents
- Apply lessons learned

## Safety Checklist

### Before Any Infrastructure Change

- [ ] Correct AWS profile active
- [ ] Account ID matches environment
- [ ] Changes reviewed by /plan
- [ ] Security analysis complete
- [ ] Historical patterns checked
- [ ] User explicitly approved

### Before State Operations

- [ ] State backup created
- [ ] Operation documented
- [ ] Impact understood
- [ ] Rollback plan ready
- [ ] User explicitly approved

### Before Destroy Operations

- [ ] Destruction absolutely necessary
- [ ] Data backup confirmed
- [ ] Dependencies checked
- [ ] Stakeholders notified
- [ ] User explicitly approved (multiple times)

## Overriding Safety Mechanisms

Safety mechanisms can be overridden, but should only be done:
- In genuine emergencies
- With full understanding of risks
- With explicit user direction
- With documentation of why

### How to Override

The user must explicitly:
1. Acknowledge the safety block
2. Explain why override is needed
3. Accept responsibility for outcome

### When Override is Appropriate

- Emergency incident response
- Recovery operations
- Specific user-directed testing

### When Override is NOT Appropriate

- "I'm in a hurry"
- "I know what I'm doing"
- "It's just dev environment"
- "It's a simple change"

## Incident Response

If a safety mechanism prevented an incident:
1. Document what was caught
2. Analyze how it would have been prevented
3. Consider if additional safety needed

If an incident occurred despite safety:
1. Document what happened
2. Analyze which layer failed
3. Improve that layer
4. Store in memory for future prevention

## Configuration

### Viewing Safety Configuration

```bash
# Check hooks configuration
cat .claude-plugin/hooks/hooks.json

# Verify hooks are executable
ls -la hooks/*.sh
```

### Customizing (Advanced)

Safety mechanisms can be customized in `hooks/hooks.json`, but consider carefully:
- Loosening safety increases risk
- Document any customizations
- Test thoroughly before relying on changes

## FAQ

### Q: Why can't I just run terraform apply?

A: Direct apply bypasses the review process that catches mistakes. Use `/plan` to get analysis and approval workflow.

### Q: The safety block is slowing me down

A: Safety takes time, but mistakes take more time. The few minutes for review prevents hours or days of incident response.

### Q: I'm an expert, I don't need these guardrails

A: Experts make mistakes too, especially when tired or rushed. The mechanisms protect everyone.

### Q: Can I disable safety for dev environments?

A: We recommend treating all environments with similar rigor. Dev mistakes can still waste time and create bad habits.

### Q: What if I have a genuine emergency?

A: Safety mechanisms can be overridden with explicit user direction. Document the emergency and the override.
