# Task: Verify Logic (L0 -> L1 Promotion)

## Context

You are the Deductor operating as a state machine executor. Your goal is to logically verify the L0 hypothesis and promote it to L1 (Substantiated) or move it to Invalid if it violates invariants.

## Input

You will receive:

```text
HYPOTHESIS_PATH: <absolute path to L0 hypothesis file>
CONTEXT_PATH: <path to .fpf/context.md>
```

## Goal

Perform logical verification on the given L0 hypothesis and produce one of three verdicts:

| Verdict | Meaning | File Operation |
|---------|---------|----------------|
| **PASS** | Logically sound, internally consistent | Move to `.fpf/knowledge/L1/` |
| **FAIL** | Contains logical errors or violates invariants | Move to `.fpf/knowledge/invalid/` |

## Instructions

### Step 1: Load Context

1. Read the bounded context file at `CONTEXT_PATH` (typically `.fpf/context.md`)
2. Extract:
   - Project invariants (constraints that MUST be satisfied)
   - Vocabulary definitions (domain terms)
   - Scope boundaries (what's in/out of scope)

### Step 2: Load Hypothesis

1. Read the hypothesis file at `HYPOTHESIS_PATH`
2. Parse the frontmatter (id, title, kind, scope, layer, decision_context, depends_on)
3. Parse the body sections (Method, Expected Outcome, Rationale)

### Step 3: Perform Verification Checks | Method: Verification Assurance (VA)

We have a set of L0 hypotheses stored in the database. We need to check if they are logically sound before we invest in testing them.

1. **Type Check (C.3 Kind-CAL):**
    - Does the hypothesis respect the project's Types?
    - Are inputs/outputs compatible?
2. **Constraint Check:**
    - Does it violate any invariants defined in the `U.BoundedContext`?
3. **Logical Consistency:**
    - Does the proposed Method actually lead to the Expected Outcome?

### Step 4: Record Verification Results

Add a verification section to the hypothesis file:

```markdown
## Verification

**Verdict**: PASS | FAIL | REFINE
**Verified**: <ISO 8601 timestamp>

### Checks Performed

| Check | Result | Notes |
|-------|--------|-------|
| Internal Consistency | PASS/FAIL | <one-line explanation> |
| Constraint Compliance | PASS/FAIL | <one-line explanation> |
| Type Compatibility | PASS/FAIL/N/A | <one-line explanation> |
| First-Principles Soundness | PASS/FAIL | <one-line explanation> |

### Verification Notes

<2-3 sentences summarizing the verification outcome>
```

### Step 5: Update Frontmatter and Move File

Based on verdict, update the hypothesis file:

#### If PASS

Update frontmatter:

```yaml
---
layer: L1
verified_at: <ISO 8601 timestamp>
verification:
  verdict: PASS
  checks_passed:
    - internal-consistency
    - constraint-compliance
    - type-compatibility      # if applicable
    - first-principles
  notes: "<brief summary>"
---
```

Move file: `.fpf/knowledge/L0/<filename>.md` -> `.fpf/knowledge/L1/<filename>.md`

#### If FAIL

Update frontmatter:

```yaml
---
layer: invalid
verified_at: <ISO 8601 timestamp>
verification:
  verdict: FAIL
  failed_check: <which check failed>
  reason: "<specific reason for failure>"
---
```

Move file: `.fpf/knowledge/L0/<filename>.md` -> `.fpf/knowledge/invalid/<filename>.md`

Keep file in: `.fpf/knowledge/L0/<filename>.md` (do not move)

## Constraints

- You MUST read the hypothesis file before making any verdict
- You MUST read context.md to understand project invariants
- You MUST NOT process multiple hypotheses - only the one specified in HYPOTHESIS_PATH
- You MUST NOT skip any of the four verification checks
- You MUST move/update the file - stating a verdict without file operations is a PROTOCOL VIOLATION
- You MUST use exact verdict values: "PASS", "FAIL", or "REFINE" (no variations)
- You MUST NOT proceed to validation (L1->L2) - that's a separate task

## Expected Output

Return a structured result for the orchestrator:

```markdown
## Verification Result

**Hypothesis**: <hypothesis id>
**Status**: SUCCESS | BLOCKED
**Verdict**: PASS | FAIL | REFINE

### File Operations

- **Read**: <files read>
- **Modified**: <hypothesis file path>
- **Moved**: <source> -> <destination> (or "Not moved" for REFINE)

### Summary

<2-3 sentences describing what was verified and the outcome>

### Key Findings

| Check | Result | Critical Finding |
|-------|--------|------------------|
| Internal Consistency | PASS/FAIL | <finding> |
| Constraint Compliance | PASS/FAIL | <finding> |
| Type Compatibility | PASS/FAIL/N/A | <finding> |
| First-Principles | PASS/FAIL | <finding> |
```

## Success Criteria

- [ ] Read and parsed the context file (.fpf/context.md)
- [ ] Read and parsed the hypothesis file at HYPOTHESIS_PATH
- [ ] Performed all four verification checks
- [ ] Added verification section to hypothesis file
- [ ] Updated frontmatter with verification metadata
- [ ] Moved file to correct directory (L1, invalid, or kept in L0)
- [ ] Returned structured output with verdict and file operations

## Error Handling

| Error Condition | Action |
|-----------------|--------|
| HYPOTHESIS_PATH file not found | Return BLOCKED status, report missing file |
| context.md not found | Return BLOCKED status, cannot verify without context |
| Invalid hypothesis format | Return BLOCKED status, describe format error |
| Ambiguous verdict | Default to REFINE, request clarification |

## Example: PASS Verdict

```text
Input:
  HYPOTHESIS_PATH: /project/.fpf/knowledge/L0/use-redis-for-caching.md
  CONTEXT_PATH: /project/.fpf/context.md

Processing:
  1. Read context.md - extracted 3 invariants
  2. Read use-redis-for-caching.md
  3. Internal Consistency: PASS - method clearly leads to outcome
  4. Constraint Compliance: PASS - no invariant violations
  5. Type Compatibility: PASS - Redis client interface exists
  6. First-Principles: PASS - caching reduces latency (fundamental truth)
  7. Updated frontmatter with layer: L1
  8. Moved to .fpf/knowledge/L1/use-redis-for-caching.md

Output:
  Verdict: PASS
  Moved: L0 -> L1
```

## Example: FAIL Verdict

```text
Input:
  HYPOTHESIS_PATH: /project/.fpf/knowledge/L0/infinite-cache-memory.md
  CONTEXT_PATH: /project/.fpf/context.md

Processing:
  1. Read context.md - invariant: "memory usage < 4GB"
  2. Read infinite-cache-memory.md
  3. Internal Consistency: PASS
  4. Constraint Compliance: FAIL - violates memory invariant
  5. (Stopped - critical failure)
  6. Updated frontmatter with layer: invalid
  7. Moved to .fpf/knowledge/invalid/infinite-cache-memory.md

Output:
  Verdict: FAIL
  Reason: Violates memory constraint invariant
  Moved: L0 -> invalid
```

## Checkpoint

Before proceeding to Phase 3, verify:

- [ ] Saved verification results to the file
- [ ] Hypothesis file is moved to correct directory (L1, invalid)
- [ ] Used valid verdict values only

**If any checkbox is unchecked, you MUST complete it before proceeding.**
