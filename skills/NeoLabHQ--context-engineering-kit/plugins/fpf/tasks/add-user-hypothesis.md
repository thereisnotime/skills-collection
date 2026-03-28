# Task: Add User Hypothesis

## Context

You are executing **Step 4** of the `propose-hypotheses` workflow. The user has reviewed the generated L0 hypotheses and wants to add their own hypothesis to the evaluation set. Your role is to formalize the user's idea into a properly structured hypothesis file that conforms to FPF standards.

This task is part of the **Abduction** phase of the ADI (Abduction-Deduction-Induction) cycle. User-proposed hypotheses are valuable because they bring domain expertise and alternative perspectives that automated generation may miss.

## Goal

Transform the user's hypothesis description into a well-structured L0 hypothesis file in `.fpf/knowledge/L0/` that:

1. Follows the exact FPF hypothesis file format
2. Captures the user's intent accurately
3. Is ready for verification in subsequent workflow steps
4. Integrates seamlessly with auto-generated hypotheses

## Input

You will receive:

1. **User's hypothesis description**: A natural language description of their proposed solution or approach
2. **Decision context**: The problem being evaluated (found in `.fpf/context.md`)
3. **Existing hypotheses**: Reference to other L0 files to ensure uniqueness and proper scoping

## Instructions

### Step 1: Read Context

1. Read `.fpf/context.md` to understand:
   - The bounded context and problem domain
   - Key vocabulary and invariants
   - Constraints that apply to all hypotheses

2. List existing L0 files in `.fpf/knowledge/L0/` to:
   - Avoid duplicate hypotheses
   - Understand the scope of existing options
   - Extract the `decision_context` value for consistency

### Step 2: Analyze User Input

Parse the user's hypothesis description to extract:

| Element | Description | How to Extract |
|---------|-------------|----------------|
| **Core idea** | What the user proposes | Main action/solution described |
| **Method** | How it would work | Steps or approach mentioned |
| **Expected outcome** | What success looks like | Benefits or goals stated |
| **Scope** | Where it applies | Constraints or contexts mentioned |
| **Kind** | Type of hypothesis | `system` (code/architecture) or `episteme` (process/docs) |

If any element is unclear, make a reasonable inference based on context, but document your inference in the Rationale section.

### Step 3: Generate Hypothesis ID

Create a kebab-case ID that:

- Is unique among existing L0 hypotheses
- Summarizes the core idea in 3-5 words
- Uses lowercase letters and hyphens only
- Matches the filename (without `.md`)

**Examples:**

- "Use Redis for caching" -> `use-redis-for-caching`
- "Implement event sourcing" -> `implement-event-sourcing`
- "Add user-proposed prefix for clarity" -> `user-proposed-caching-layer`

### Step 4: Create Hypothesis File

Create a file in `.fpf/knowledge/L0/` with this exact structure:

```markdown
---
id: <generated-id>
title: <User's Solution Title>
kind: <system|episteme>
scope: <Where this applies, constraints, requirements>
decision_context: <same as other hypotheses>
depends_on: []
created: <ISO 8601 timestamp>
layer: L0
---

# <User's Solution Title>

## Method (The Recipe)

<Detailed description of HOW this hypothesis works>

1. <Step one>
2. <Step two>
3. <Additional steps as needed>

## Expected Outcome

<What success looks like when this hypothesis is implemented>

## Rationale

- **Source**: User input
- **Problem**: <The specific problem this addresses>
- **Note**: Manually injected hypothesis for evaluation against alternatives
- **Inferences**: <Any assumptions made if user input was ambiguous>
```

### Step 5: Validate File

Before completing, verify:

- [ ] File created in `.fpf/knowledge/L0/`
- [ ] Filename matches `id` field (with `.md` extension)
- [ ] All required frontmatter fields present
- [ ] `layer` field set to `L0`
- [ ] `decision_context` matches other hypotheses
- [ ] ISO 8601 timestamp is valid
- [ ] Kebab-case used for ID and filename
- [ ] No duplicate hypothesis exists

## Constraints

- **MUST** create the file in `.fpf/knowledge/L0/` - mentioning it in prose is NOT sufficient
- **MUST NOT** modify existing hypothesis files
- **MUST NOT** skip any required frontmatter fields
- **MUST** use `kind: system` for code/architecture solutions or `kind: episteme` for process/documentation solutions
- **MUST** preserve the user's intent - do not transform their idea into something different
- **SHOULD** keep the Method section actionable with numbered steps
- **MAY** expand on terse user input to create complete documentation

## Expected Output

Return a structured result to the orchestrator:

```markdown
## Task Result

**Status**: SUCCESS | FAILURE
**Files Created**: [path to created hypothesis file]

## Hypothesis Summary

| Field | Value |
|-------|-------|
| ID | <hypothesis-id> |
| Title | <title> |
| Kind | <system/episteme> |
| Scope | <brief scope> |
| File | `.fpf/knowledge/L0/<id>.md` |

## User Intent Captured

<1-2 sentence confirmation of what was formalized>

## Ready for Verification

This hypothesis is now queued for L0 -> L1 verification in subsequent workflow steps.
```

## Success Criteria

- [ ] Hypothesis file created with valid frontmatter (all required fields present)
- [ ] File location is `.fpf/knowledge/L0/<id>.md`
- [ ] User's core idea accurately captured in Method section
- [ ] Expected Outcome reflects user's stated or implied goals
- [ ] Rationale documents this as user-proposed hypothesis
- [ ] ID is unique among existing L0 hypotheses
- [ ] File is ready for verification workflow (no schema errors)

## Error Handling

| Error Condition | Action |
|-----------------|--------|
| `.fpf/` directory doesn't exist | Return FAILURE, instruct orchestrator to run init-context first |
| User input is too vague | Make reasonable inferences, document them in Rationale |
| Duplicate hypothesis exists | Return FAILURE with existing file path, ask user to clarify difference |
| Invalid kind determination | Default to `system`, note uncertainty in Rationale |
