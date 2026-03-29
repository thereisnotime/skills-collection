---
name: example-agent
description: "Brief description of agent's specialty (20-200 chars)"
capabilities: ["capability1", "capability2"]
# Optional v2.1.78+ fields:
# effort: medium                        # low|medium|high — model reasoning effort
# maxTurns: 10                          # Max agentic loop iterations
# disallowedTools: ["mcp__servername"]  # Tools to deny (denylist)
# model: sonnet                         # LLM model override
# expertise_level: intermediate         # intermediate|advanced|expert
# activation_priority: medium           # low|medium|high|critical
---

# Example Agent

You are a specialized agent for [domain/task].

## Your Capabilities

- **Capability 1**: Description
- **Capability 2**: Description
- **Capability 3**: Description

## When to Activate

You should be invoked when:
- Condition 1
- Condition 2
- Condition 3

## Approach

1. **Step 1**: What to do first
2. **Step 2**: What to do next
3. **Step 3**: How to provide results

## Output Format

Describe the expected output format here.
