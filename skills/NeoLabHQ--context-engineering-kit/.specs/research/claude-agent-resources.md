# Claude Code Agent Development Resources

Comprehensive collection of Claude Code documentation resources for creating and managing agents. All links reference Context7 documentation library `/anthropics/claude-code`.

## Overview

**Main Reference**: [Agent Development Guide](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/README.md)
- Complete guide to creating autonomous agents
- File structure combining YAML frontmatter with system prompt
- Frontmatter fields: `name`, `description`, `model`, `color`, `tools`
- System prompt design patterns for analysis, generation, validation, orchestration
- AI-assisted agent generation with proven prompts
- Validation rules, best practices, production-ready examples

## Agent File Structure

### Complete Template

**Source**: [Agent File Structure - Complete Markdown Format](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

```markdown
---
name: agent-identifier
description: Use this agent when [triggering conditions]. Examples:

<example>
Context: [Situation description]
user: "[User request]"
assistant: "[How assistant should respond and use this agent]"
<commentary>
[Why this agent should be triggered]
</commentary>
</example>

<example>
[Additional example...]
</example>

model: inherit
color: blue
tools: ["Read", "Write", "Grep"]
---

You are [agent role description]...

**Your Core Responsibilities:**
1. [Responsibility 1]
2. [Responsibility 2]

**Analysis Process:**
[Step-by-step workflow]

**Output Format:**
[What to return]
```

### Minimal Template

**Source**: [Minimal Agent Configuration Template](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

Quick template with essential frontmatter fields and simple system prompt structure.

## Frontmatter Fields

### Required Fields

#### name
**Format**: Lowercase with hyphens, 3-50 characters, must start/end with alphanumeric
**Examples**:
- ✅ `code-reviewer`, `test-generator`, `api-docs-writer`, `security-analyzer`
- ❌ `helper` (too generic), `-agent-` (starts/ends with hyphen), `my_agent` (underscores), `ag` (too short)

**Source**: [Agent Identifier Validation Examples](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

#### description
**Critical field** - Defines when Claude should trigger the agent
**Requirements**:
- Length: 10-5,000 characters (ideal: 200-1,000 with 2-4 examples)
- Must start with "Use this agent when..."
- Must include `<example>` blocks showing usage patterns
- Each example needs: context, user request, assistant response, commentary

**Source**: [Agent Description Field with Examples Format](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

**Best Practices**:
- Include 2-4 concrete examples
- Show both proactive and reactive triggering scenarios
- Cover different phrasings of the same intent
- Explain reasoning in commentary
- Be specific about when NOT to use the agent

#### model
**Values**: `inherit`, `sonnet`, `opus`, `haiku`
**Default**: `inherit` (recommended - uses parent conversation model)
**Options**:
- `inherit` - Use same model as parent (recommended default)
- `sonnet` - Claude Sonnet for balanced performance
- `opus` - Claude Opus for maximum capability (expensive)
- `haiku` - Claude Haiku for speed and cost-efficiency

**Source**: [Agent Frontmatter Fields - model](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

#### color
**Purpose**: Visual indicator in UI
**Values**: `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`
**Best Practice**: Use different colors for different agents to distinguish them visually

### Optional Fields

#### tools
**Purpose**: Restrict tools available to agent (principle of least privilege)
**Format**: Array of tool names
**Example**: `tools: ["Read", "Write", "Grep", "Bash"]`
**Source**: [Agent Frontmatter YAML Configuration](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

## Description Field & Triggering

### Standard Example Block Format

**Source**: [Standard Example Block Format for Agent Triggering](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/triggering-examples.md)

```markdown
<example>
Context: [Describe the situation - what led to this interaction]
user: "[Exact user message or request]"
assistant: "[How Claude should respond before triggering]"
<commentary>
[Explanation of why this agent should be triggered in this scenario]
</commentary>
assistant: "[How Claude triggers the agent - usually 'I'll use the [agent-name] agent...']"
</example>
```

### Triggering Pattern Types

**Source**: [Triggering Examples Reference](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/triggering-examples.md)

1. **Explicit Request**: User directly asks for agent's function
2. **Implicit Need**: Agent needed based on context
3. **Proactive Trigger**: After completing task that needs review
4. **Tool Usage Pattern**: Based on prior tool usage

**Example - Proactive Tool Usage Trigger**:
```markdown
<example>
Context: User made multiple edits to test files
user: "I've updated all the tests"
assistant: "Great! Let me verify test quality."
<commentary>
Multiple Edit tools used on test files. Proactively trigger test-quality-analyzer
to ensure tests follow best practices.
</commentary>
assistant: "I'll use the test-quality-analyzer agent to review the tests."
</example>
```

### Standard Invocation Responses

**Source**: [Standard Agent Invocation Response Patterns](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/triggering-examples.md)

```markdown
assistant: "I'll use the [agent-name] agent to [what it will do]."

# Examples:
assistant: "I'll use the code-reviewer agent to analyze the changes."
assistant: "Let me use the test-generator agent to create comprehensive tests."
assistant: "I'll use the security-analyzer agent to check for vulnerabilities."
```

## System Prompt Design

### System Prompt Template

**Source**: [Agent System Prompt Design Template](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

```markdown
You are [role] specializing in [domain].

**Your Core Responsibilities:**
1. [Primary responsibility]
2. [Secondary responsibility]
3. [Additional responsibilities...]

**Analysis Process:**
1. [Step one]
2. [Step two]
3. [Step three]
[...]

**Quality Standards:**
- [Standard 1]
- [Standard 2]

**Output Format:**
Provide results in this format:
- [What to include]
- [How to structure]

**Edge Cases:**
Handle these situations:
- [Edge case 1]: [How to handle]
- [Edge case 2]: [How to handle]
```

### AI-Assisted Agent Generation

**Source**: [Agent Creation System Prompt](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/agent-creation-system-prompt.md)

Elite AI agent architect system prompt for translating requirements into agent specifications.

**Process**:
1. **Extract Core Intent**: Identify purpose, responsibilities, success criteria
2. **Design Expert Persona**: Create compelling expert identity with domain knowledge
3. **Architect Comprehensive Instructions**: Behavioral boundaries, methodologies, edge cases, output formats
4. **Optimize for Performance**: Decision frameworks, quality control, workflow patterns, fallback strategies
5. **Create Identifier**: Concise, descriptive, 2-4 words with hyphens
6. **Generate Examples**: Include triggering scenarios with context, user/assistant dialogue, commentary

**Output Format**: JSON with `identifier`, `whenToUse` (with examples), `systemPrompt` fields

**Advantages**:
- Comprehensive (includes edge cases and quality checks)
- Consistent (adheres to proven patterns)
- Fast (seconds vs manual writing)
- Auto-generates useful triggering examples
- Complete system prompt structure

**Source**: [Advantages of AI-Assisted Generation](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/examples/agent-creation-prompt.md)

## Validation & Testing

### Validation Rules

**Source**: [Validation Process - Agents Validation](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/agents/plugin-validator.md)

**Checks**:
- Proper frontmatter with required fields: `name`, `description`, `model`, `color`
- Name format: lowercase with hyphens, 3-50 characters
- Description includes `<example>` blocks
- Model: one of `inherit`, `sonnet`, `opus`, `haiku`
- Color: one of `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`
- System prompt exists with >20 characters

### Validation Process

**Source**: [Validation After Generation](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/examples/agent-creation-prompt.md)

1. **Structural Validation**: Use validation scripts
   ```bash
   ./scripts/validate-agent.sh agents/your-agent.md
   ```

2. **Triggering Tests**: Test with various scenarios from examples
   - Verify agent activates correctly
   - Test different contexts from examples
   - Ensure appropriate responses

### Quality Checklist

**Source**: [Validation & Quality Check](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/commands/create-plugin.md)

- [ ] Plugin-validator agent validates manifest, structure, naming, components, security
- [ ] Agent validate-agent.sh script checks structure
- [ ] Example blocks are clear and specific
- [ ] Triggering conditions are unambiguous
- [ ] Proper `${CLAUDE_PLUGIN_ROOT}` usage for portability

## Best Practices

### Quick Reference

**Source**: [Best Practices Quick Reference](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/SKILL.md)

**DO**:
- ✅ Include 2-4 concrete examples in agent descriptions
- ✅ Write specific, unambiguous triggering conditions
- ✅ Use "inherit" model setting unless specific need
- ✅ Apply principle of least privilege for tools
- ✅ Write clear, structured system prompts with explicit steps
- ✅ Test agent triggering thoroughly before deployment

**DON'T**:
- ❌ Generic descriptions without examples
- ❌ Omit triggering conditions
- ❌ Use same color for multiple agents
- ❌ Grant unnecessary tool access
- ❌ Write vague system prompts
- ❌ Skip testing phases

### System Prompt Principles

**Source**: [Agent Creation System Prompt - Key Principles](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/agent-creation-system-prompt.md)

- Be specific rather than generic - avoid vague instructions
- Include concrete examples when they clarify behavior
- Balance comprehensiveness with clarity - every instruction should add value
- Ensure agent has enough context to handle variations of core task
- Make agent proactive in seeking clarification when needed
- Build in quality assurance and self-correction mechanisms

## Production Examples

### Code Quality Reviewer Agent

**Source**: [Code Quality Reviewer Agent Configuration](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/examples/agent-creation-prompt.md)

**Triggers**:
- User written code needing quality review
- Explicit request to review code changes

**Core Responsibilities**:
1. Analyze code changes for quality issues (readability, maintainability, performance)
2. Identify security vulnerabilities (injection, XSS, authentication)
3. Check adherence to project best practices and coding standards
4. Provide actionable, specific feedback with line numbers

**Tools**: `["Read", "Grep", "Glob"]`

**Review Process**:
1. Read code changes
2. Analyze for: code quality, security, best practices, project-specific standards
3. Identify issues with severity (critical/major/minor)
4. Provide specific recommendations with examples

**Output Format**:
1. Summary (2-3 sentences)
2. Critical Issues (must fix)
3. Major Issues (should fix)
4. Minor Issues (nice to fix)
5. Positive observations
6. Overall assessment

### Test Generator Agent

**Source**: [Test Generator Agent Overview](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/examples/complete-agent-examples.md)

**Triggers**:
- User written code without tests
- Explicit test generation request
- Need for test coverage improvement

**Expertise Areas**:
- **Unit testing**: Individual function/method tests
- **Integration testing**: Module interaction tests
- **Edge cases**: Boundary conditions, error paths
- **Test organization**: Proper structure and naming
- **Mocking**: Appropriate use of mocks and stubs

**Process**:
1. Read target code
2. Identify testable units
3. Design test cases (happy paths + edge cases)
4. Generate tests following project patterns
5. Add assertions and error cases

**Output**:
- Complete test files with proper suite structure
- Setup/teardown if needed
- Descriptive test names
- Comprehensive assertions

## Integration with Workflows

### Phase 5: Component Implementation

**Source**: [Phase 5 Component Implementation - Agents](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/commands/create-plugin.md)

Agent development leverages an agent-creator agent to standardize generation:

1. Provide detailed description of intended behavior
2. Agent-creator generates:
   - Unique identifier
   - whenToUse section with concrete examples
   - Appropriate system prompt
3. Resulting markdown file includes frontmatter + system prompt
4. Configure model settings, color, tools
5. Validate with validate-agent.sh script

## Query Context7 for More

Use Context7 MCP to fetch additional documentation:

```bash
# Main agent development guide
mcp__context7__query-docs libraryId: "/anthropics/claude-code" query: "agent development complete guide"

# System prompt patterns
mcp__context7__query-docs libraryId: "/anthropics/claude-code" query: "agent system prompt design patterns"

# Validation and testing
mcp__context7__query-docs libraryId: "/anthropics/claude-code" query: "agent validation testing best practices"

# Triggering examples
mcp__context7__query-docs libraryId: "/anthropics/claude-code" query: "agent triggering conditions examples"

# Production examples
mcp__context7__query-docs libraryId: "/anthropics/claude-code" query: "agent complete examples code-reviewer test-generator"
```

## Related Resources

- [Plugin Development Guide](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/README.md)
- [Command Development](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/command-development/SKILL.md)
- [Skill Development](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/skill-development/SKILL.md)
- [Plugin Structure Examples](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/examples/standard-plugin.md)
