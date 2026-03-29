# Parallel Workflows in DevOps-Skills

This document explains how to use parallel agent execution for efficient infrastructure and development tasks.

## Overview

DevOps-skills leverages Claude Code's Task tool to dispatch multiple agents simultaneously. This enables:
- Faster analysis of complex changes
- Multiple perspectives on risk assessment
- Efficient multi-environment operations

## Core Concept

Instead of sequential analysis:
```
Agent A completes → Agent B starts → Agent C starts
Total time = A + B + C
```

Use parallel dispatch:
```
Agent A ─┐
Agent B ─┼→ All complete → Aggregate results
Agent C ─┘
Total time = max(A, B, C)
```

## How to Dispatch Parallel Agents

### In Claude Code

Launch multiple agents in a **single message** with multiple Task tool calls:

```
Task(terraform-plan-analyzer, "Analyze plan.json for risks")
Task(security-reviewer, "Review plan.json for security issues")
Task(historical-pattern-analyzer, "Check git history for similar changes")
```

**Key:** All Task calls must be in the same message for true parallelism.

### Agent Requirements

For parallel execution, agents must be:
1. **Independent** - No shared state or dependencies
2. **Self-contained** - All needed context in the prompt
3. **Clear output** - Structured results for aggregation

## Parallel Workflow Patterns

### Pattern 1: Plan Analysis

```
/plan command
    │
    ├─→ terraform-plan-analyzer
    │   Analyzes: Risk levels, destruction, cascade effects
    │
    ├─→ security-reviewer
    │   Analyzes: IAM, network, encryption, compliance
    │
    └─→ historical-pattern-analyzer
        Analyzes: Past similar changes, incidents, patterns

    ↓ All complete

Orchestrator aggregates findings into unified report
    ↓
Present to user with approval gate
```

### Pattern 2: Multi-Environment Compare

```
/env-compare dev staging prod
    │
    ├─→ Task("Analyze dev environment")
    │   Returns: Resources, configs, versions
    │
    ├─→ Task("Analyze staging environment")
    │   Returns: Resources, configs, versions
    │
    └─→ Task("Analyze prod environment")
        Returns: Resources, configs, versions

    ↓ All complete

Compare configurations across all three
    ↓
Highlight discrepancies
```

### Pattern 3: Drift Analysis

```
/drift
    │
    ├─→ drift-detector
    │   Categorizes drift by severity and cause
    │
    └─→ historical-pattern-analyzer
        Checks if this drift matches past patterns

    ↓ All complete

Combined report with context
```

### Pattern 4: Development Tasks

```
Multiple test failures across different files
    │
    ├─→ Task("Fix tests in auth.test.ts")
    │
    ├─→ Task("Fix tests in api.test.ts")
    │
    └─→ Task("Fix tests in db.test.ts")

    ↓ All complete

Review all fixes, check for conflicts, run full suite
```

## Agent Prompt Structure

### Good Agent Prompts

```markdown
Analyze the following Terraform plan for security issues.

Context:
- Environment: production
- AWS Account: 123456789012
- Change type: Security group modification

Plan JSON:
[plan content]

Focus on:
1. IAM policy changes
2. Network exposure changes
3. Encryption modifications

Return your findings in this format:
- Risk Level: CRITICAL/HIGH/MEDIUM/LOW
- Summary: [brief summary]
- Findings: [detailed list]
- Recommendations: [what to do]
```

### Prompt Checklist

- [ ] Clear objective (what to analyze)
- [ ] All necessary context included
- [ ] Specific focus areas defined
- [ ] Expected output format specified
- [ ] Constraints stated (what NOT to do)

## Aggregating Results

After agents complete, the orchestrator:

1. **Collects** all agent outputs
2. **Validates** outputs are complete
3. **Reconciles** any conflicts
4. **Synthesizes** unified report
5. **Presents** to user

### Handling Conflicts

When agents disagree:

```
Agent A: "LOW risk - safe to proceed"
Agent B: "HIGH risk - needs review"
    │
    ↓

Dispatch conflict-arbiter with both positions
    │
    ↓

Either:
- Reconciled recommendation
- User choice with clear tradeoffs
```

## When NOT to Use Parallel Agents

### Sequential Dependencies

If Agent B needs Agent A's output:
```
Agent A completes → Output fed to Agent B → Agent B completes
```

### Shared State

If agents would modify the same files:
```
Don't parallelize - they'll conflict
```

### Exploratory Work

When you don't know what you're looking for:
```
Single agent explores → Identifies parallel opportunities → Then dispatch
```

## Best Practices

### 1. Right-size Agent Tasks

**Too broad:** "Review everything" → Agent gets lost
**Too narrow:** "Check line 42" → Too many agents
**Just right:** "Review security groups in this plan"

### 2. Include All Context

Agents don't share memory. Each needs:
- Full context of the task
- Relevant code/config
- Expected output format

### 3. Plan for Aggregation

Design agent outputs to be easily combined:
- Consistent structure
- Clear categorization
- Severity/priority levels

### 4. Verify Before Acting

After aggregation:
- Review combined findings
- Check for missed conflicts
- Validate recommendations make sense together

## Performance Considerations

### Parallel Limits

Claude Code manages concurrency. Typically:
- 3-5 agents work well in parallel
- More agents = more coordination overhead
- Balance parallelism with clarity

### Context Size

Each agent gets full context. Consider:
- Large plans may need summarization
- Split very large analyses into focused chunks
- Use targeted prompts to reduce noise

## Examples

### Example 1: Pre-deployment Review

```bash
# User runs /plan
# System dispatches in parallel:
# - terraform-plan-analyzer → Risk assessment
# - security-reviewer → Security check
# - historical-pattern-analyzer → Past patterns

# Results aggregated:
## Deployment Review Summary
Risk Level: MEDIUM

### Risk Analysis
- 2 resources modified, 0 destroyed
- No cascade effects identified

### Security Analysis
- No IAM changes
- Security group rule added (internal only)

### Historical Analysis
- Similar change made 2024-01-05, no issues

### Recommendation
Safe to proceed with standard approval.
```

### Example 2: Environment Comparison

```bash
# User runs /env-compare dev prod
# System dispatches in parallel:
# - Agent analyzes dev
# - Agent analyzes prod

# Results compared:
## Environment Comparison: dev vs prod

| Resource | dev | prod | Status |
|----------|-----|------|--------|
| Instance count | 2 | 8 | Expected |
| Instance type | t3.small | t3.large | Expected |
| Module version | 3.1.0 | 3.0.0 | ⚠️ Mismatch |

### Action Items
- Upgrade prod VPC module from 3.0.0 to 3.1.0
```
