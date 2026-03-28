# Task: Create Decision Readiness Report (DRR)

## Context

You are the Decider operating as a state machine executor. Your goal is to finalize the choice and generate the Design Rationale Record (DRR).

The reasoning cycle is complete. You have:
- `.fpf/context.md` - The bounded context defining the problem
- `.fpf/knowledge/L2/*.md` - Validated and audited hypotheses with R_eff scores
- `.fpf/evidence/*.md` - Evidence files supporting each hypothesis

Your role is to aggregate all audited hypotheses, rank them by R_eff, and create the **Decision Readiness Report (DRR)** that presents the recommended action to the user.

## Goal

Create a comprehensive Decision Readiness Report (DRR) that:
1. Aggregates all L2 hypothesis audit results
2. Ranks hypotheses by R_eff score (highest first)
3. Identifies the recommended hypothesis with supporting rationale
4. Documents trade-offs, risks, and dissenting evidence
5. Provides actionable next steps

## Input

- **Problem Statement**: The original problem from the user
- **L2 Hypotheses Directory**: `.fpf/knowledge/L2/` containing audited hypothesis files
- **Evidence Directory**: `.fpf/evidence/` containing evidence and audit report files
- **Context File**: `.fpf/context.md` containing the bounded context

## Instructions | Method (E.9 DRR)

### 1. Read and Aggregate Data

1. Read `.fpf/context.md` to understand the original problem and constraints
2. Read ALL files in `.fpf/knowledge/L2/` to get audited hypotheses
3. For each hypothesis, extract:
   - `id` - Hypothesis identifier
   - `title` - Human-readable title
   - `R_eff` from the audit section (MUST be present)
   - Weakest link identifier
   - Key supporting evidence
   - Dependencies (if any)

### 2. Rank Hypotheses

1. Sort all L2 hypotheses by R_eff score in **descending order**
2. Apply **Weakest Link Network (WLNK)** principle: R_eff = min(evidence_scores)
3. For hypotheses with dependencies:
   - `A.R_eff <= min(A.R_eff, B.R_eff)` for all dependencies B
4. Identify the **top-ranked hypothesis** as the recommended option

### 3. Generate Comparison Table

Create a comparison table with all candidates:

| Rank | Hypothesis | R_eff | Weakest Link | Status |
|------|------------|-------|--------------|--------|
| 1 | <top hypothesis> | <score> | <weakest link> | Recommended |
| 2 | <next hypothesis> | <score> | <weakest link> | Alternative |
| ... | ... | ... | ... | ... |

### 4. Analyze Trade-offs

For the recommended hypothesis:
- List **positive consequences** (benefits if selected)
- List **negative consequences** (costs/risks if selected)
- Document **trade-offs accepted** (what we're giving up)

For rejected hypotheses:
- Document **why rejected** (lower R_eff, constraint violations, etc.)
- Note any **dissenting evidence** that supported them

Provide comparision table and trade-offs analysis to user. Pick the winner and create DRR file for it.

### 5. Create DRR File

Create the DRR file in `.fpf/decisions/` with the naming format:
`DRR-{YYYY-MM-DD}-{hypothesis-slug}.md`

Example: `DRR-2025-01-15-use-redis-for-caching.md`

Use the following structure:

```markdown
---
id: DRR-{date}-{slug}
decision_context: {from context.md}
recommended: {hypothesis-id}
candidates:
  - {hypothesis-1-id}
  - {hypothesis-2-id}
created: {ISO 8601 timestamp}
status: pending_approval
---

# Decision Readiness Report: {Problem Title}

## Context

{Summary of the problem being decided, from .fpf/context.md}

## Candidates Evaluated

| Rank | Hypothesis | R_eff | Weakest Link | Status |
|------|------------|-------|--------------|--------|
| 1 | {hypothesis} | {R_eff} | {weakest} | Recommended |
| 2 | {hypothesis} | {R_eff} | {weakest} | Alternative |

## Recommendation

**Recommended Hypothesis**: {title}

**R_eff Score**: {score}

### Rationale

Why this hypothesis is recommended:
1. {Primary reason with evidence citation}
2. {Secondary reason with evidence citation}
3. {Additional supporting factors}

### Why Alternatives Were Not Recommended

For each alternative:
- **{Hypothesis Title}**: {Reason not recommended - lower R_eff, higher risk, etc.}

## Consequences

### Positive

- {Benefit 1 if recommendation is accepted}
- {Benefit 2}

### Negative

- {Risk or cost 1}
- {Risk or cost 2}

### Trade-offs Accepted

- {What we're giving up by choosing this option}

## Dissenting Evidence

{Any evidence that contradicts the recommended hypothesis}

- {Evidence ID}: {Summary of dissenting point}

## Validity

This decision should be revisited if:
- {Condition 1 that would invalidate this decision}
- {Condition 2}

**Review Date**: {6 months from now}

## Next Steps

1. {First implementation action}
2. {Second implementation action}
3. {Validation or monitoring action}

## References

- Context: .fpf/context.md
- {List of hypothesis files}
- {List of evidence files}
- {List of audit files}
```

### 6. Return Summary

After creating the DRR, return a structured summary to the orchestrator.

## Constraints

- You MUST have at least one audited L2 hypothesis with computed R_eff to proceed
- You MUST NOT proceed if no L2 hypotheses exist - report BLOCKED status
- You MUST use calculated R_eff values, NOT estimates
- You SHALL follow the DRR file format exactly
- You SHALL include ALL L2 hypotheses in the comparison table
- You MUST set `status: pending_approval` - final approval comes from the user
- The DRR recommends; the HUMAN decides (Transformer Mandate)

## Expected Output

Return a structured result to the orchestrator:

```markdown
## Task Result

**Status**: SUCCESS | FAILURE | BLOCKED
**Files Created**: [list of created files]

## Decision Readiness Report Summary

**DRR File**: .fpf/decisions/DRR-{date}-{slug}.md

### Recommendation

| Hypothesis | R_eff | Status |
|------------|-------|--------|
| {recommended} | {score} | Recommended |
| {alternative} | {score} | Alternative |

### Recommended Action

**{Hypothesis Title}**

Rationale: {Brief 1-2 sentence rationale}

### Key Risks

- {Primary risk to monitor}

## Next Steps

Present this DRR to the user for final approval before implementation.
```

## Success Criteria

- [ ] Read all L2 hypothesis files from `.fpf/knowledge/L2/`
- [ ] Extracted R_eff from audit section of each hypothesis
- [ ] Ranked hypotheses by R_eff (descending order)
- [ ] Created comparison table with all candidates
- [ ] Identified recommended hypothesis with rationale
- [ ] Documented consequences (positive, negative, trade-offs)
- [ ] Noted any dissenting evidence
- [ ] Created DRR file in `.fpf/decisions/` with correct format
- [ ] Set validity/review date for the decision
- [ ] Included references to all source files
- [ ] Returned structured summary to orchestrator

## Failure Conditions

If any of these occur, return BLOCKED status:

- No files exist in `.fpf/knowledge/L2/` - no audited hypotheses
- L2 hypotheses exist but lack R_eff values - audit not completed
- `.fpf/context.md` does not exist - context not initialized

Report the specific blocker so the orchestrator can take corrective action.

## Example: Success Path

```
Input:
- Problem Statement: "What caching strategy should we use?"
- L2 Hypotheses: redis-caching.md (R_eff: 0.85), cdn-edge.md (R_eff: 0.72)

Process:
1. Read .fpf/context.md - caching-strategy-decision context
2. Read redis-caching.md - R_eff: 0.85, weakest: internal-benchmark
3. Read cdn-edge.md - R_eff: 0.72, weakest: external-docs
4. Rank: redis-caching (1st), cdn-edge (2nd)
5. Create DRR with recommendation for redis-caching

Output:
- Status: SUCCESS
- Files Created: .fpf/decisions/DRR-2025-01-15-use-redis-for-caching.md
- Recommended: redis-caching (R_eff: 0.85)
```

## Example: Blocked Path

```
Input:
- L2 Hypotheses Directory: .fpf/knowledge/L2/ (empty)

Output:
- Status: BLOCKED
- Reason: No L2 hypotheses found. Audit phase (Step 7) must complete first.
- Action: Return to Step 6 (validate-evidence) or Step 7 (audit-trust)
```
