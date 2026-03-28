# Task: Audit Trust (Compute R_eff)

## Context

You are the Auditor operating as a state machine executor. Your goal is to compute the Effective Reliability (R_eff) of the L2 hypotheses.

The hypothesis has already passed:
- L0 (Conjecture): Generated via abduction
- L1 (Substantiated): Verified against logical constraints
- L2 (Corroborated): Validated with empirical evidence

We have L2 hypotheses backed by evidence. We must ensure we aren't overconfident.

## Goal

Compute R_eff for the specified L2 hypothesis by:
1. Analyzing all associated evidence files
2. Applying congruence level penalties and freshness decay
3. Identifying the weakest link
4. Checking for cognitive biases
5. Creating an audit report file
6. Calculating confidence interval bounds

## Input

You will receive:
- **HYPOTHESIS_FILE**: Path to the L2 hypothesis file (e.g., `.fpf/knowledge/L2/use-redis-for-caching.md`)

## Instructions | Method (B.3 Trust Calculus)

### Step 1: Read Hypothesis and Evidence Files

1. Read the specified hypothesis file at `HYPOTHESIS_FILE`
2. Extract the `evidence` section from frontmatter (list of evidence IDs)
3. Read each evidence file from `.fpf/evidence/{evidence-id}.md`
4. Note the `depends_on` field if present (for dependency propagation)

### Step 2: Calculate Base Evidence Scores

For each evidence file, calculate the base score based on Congruence Level (CL):

| Congruence Level | Context Match | Base Score | Penalty |
|------------------|---------------|------------|---------|
| CL3 | Same (internal test in this project) | 1.00 | None |
| CL2 | Similar (related project/system) | 0.90 | 10% |
| CL1 | Different (external docs/benchmarks) | 0.70 | 30% |

Extract CL from the evidence file frontmatter field `CL`.

### Step 3: Apply Freshness Decay

Calculate evidence age from `created` timestamp to current date and apply decay:

| Age Range | Decay Factor | Multiplier |
|-----------|--------------|------------|
| Fresh (< 30 days) | 0% | 1.00 |
| Aging (30-90 days) | 5% | 0.95 |
| Stale (90-180 days) | 15% | 0.85 |
| Expired (> 180 days) | 30% | 0.70 |

**Adjusted Score = Base Score * Decay Multiplier**

### Step 4: Apply WLNK Principle

The Weakest Link (WLNK) principle states that the effective reliability is the MINIMUM of all evidence scores, NOT the average:

```
R_eff = min(adjusted_score_1, adjusted_score_2, ..., adjusted_score_n)
```

**CRITICAL**: R_eff is COMPUTED, never estimated. "I think it's about 0.8" is a PROTOCOL VIOLATION.

### Step 5: Dependency Propagation

If the hypothesis has a `depends_on` field:
1. Look up R_eff for each dependency (from their audit reports)
2. Apply dependency constraint:
   ```
   Final_R_eff = min(self_R_eff, dependency_1_R_eff, dependency_2_R_eff, ...)
   ```

If dependency audit reports don't exist, note this as a blocker.

### Step 6: Calculate Confidence Interval

Compute confidence bounds based on evidence quantity and diversity:

```
Lower Bound = R_eff - (0.1 / sqrt(evidence_count))
Upper Bound = min(R_eff + (0.05 / sqrt(evidence_count)), 1.0)
```

Clamp lower bound to 0.0 minimum.

### Step 7: Bias Check

Evaluate for cognitive biases (mark with rationale):

- [ ] **Pet Idea Bias**: Is there excessive attachment to this hypothesis without evidence?
- [ ] **NIH Bias (Not Invented Here)**: Were external alternatives fairly considered?
- [ ] **Confirmation Bias**: Does evidence include failure scenarios and counterarguments?

### Step 8: Create Audit Report File

Create file at `.fpf/evidence/audit-{hypothesis-id}-{YYYY-MM-DD}.md`:

```markdown
---
id: audit-{hypothesis-id}-{date}
hypothesis_id: {hypothesis-id}
r_eff: {computed_r_eff}
confidence_interval:
  lower: {lower_bound}
  upper: {upper_bound}
weakest_link: {evidence-id-of-weakest}
created: {ISO-8601-timestamp}
---

# Audit Report: {Hypothesis Title}

## R_eff Calculation

**Final R_eff: {r_eff}**
**Confidence Interval: [{lower_bound}, {upper_bound}]**

### Evidence Analysis

| Evidence ID | Type | CL | Base | Age | Decay | Final Score |
|-------------|------|----|----|-----|-------|-------------|
| {ev-id-1} | {source} | {CL} | {base} | {days}d | {decay}% | {score} |
| {ev-id-2} | {source} | {CL} | {base} | {days}d | {decay}% | {score} |

### Weakest Link Analysis

- **Weakest Evidence**: {evidence-id}
- **Score**: {score}
- **Reason**: {explanation of why this is the weakest}
- **Mitigation**: {how to improve this score if desired}

### Dependency Tree

```
[{hypothesis-id} R:{r_eff}]
  └── depends_on: {dependency-id} R:{dep_r_eff}
      └── ...
```

(Or "No dependencies" if none)

### Bias Assessment

- [x/] Pet Idea bias: {assessment}
- [x/] NIH bias: {assessment}
- [x/] Confirmation bias: {assessment}

### Risk Summary

{2-3 sentences summarizing key reliability risks and recommendations}
```

### Step 9: Update Hypothesis File

Add or update the `## Audit` section in the hypothesis file:

```markdown
## Audit

**R_eff**: {computed_value}
**Confidence Interval**: [{lower}, {upper}]
**Audited**: {ISO-8601-timestamp}
**Report**: audit-{hypothesis-id}-{date}
**Weakest Link**: {evidence-id} ({score})

### Summary

{One paragraph explaining the reliability assessment and any recommendations for improving confidence}
```

## Constraints

- You MUST NOT estimate R_eff - it must be calculated from evidence
- You MUST apply WLNK (minimum), never average scores
- You MUST create the audit report file before reporting completion
- You MUST NOT audit hypotheses that are not at L2 layer
- You MUST update the hypothesis file with audit results
- You SHALL document the weakest link with mitigation recommendations
- If dependencies exist but their audits don't, report BLOCKED status

## Expected Output

Return structured output to the orchestrator:

```markdown
## Task Result

**Status**: SUCCESS | BLOCKED
**Hypothesis**: {hypothesis-id}
**R_eff**: {computed_value}
**Confidence Interval**: [{lower}, {upper}]
**Weakest Link**: {evidence-id} (score: {score})

### Files Created
- `.fpf/evidence/audit-{hypothesis-id}-{date}.md`

### Files Modified
- `.fpf/knowledge/L2/{hypothesis-id}.md` (added Audit section)

### Summary

{Brief description of the reliability assessment}

### Risk Flags

- {Any significant risks or bias concerns identified}
```

## Success Criteria

- [ ] Read hypothesis file and extracted all evidence references
- [ ] Calculated base scores using CL penalties for each evidence
- [ ] Applied freshness decay factors based on evidence age
- [ ] Computed R_eff using WLNK (minimum) principle
- [ ] Handled dependency propagation if `depends_on` exists
- [ ] Calculated confidence interval bounds
- [ ] Completed bias assessment with rationale
- [ ] Created audit report file with all required sections
- [ ] Updated hypothesis file with Audit section
- [ ] Returned structured output with R_eff and weakest link

## Error Handling

| Condition | Action |
|-----------|--------|
| Hypothesis file not found | Return FAILURE with path |
| Hypothesis not at L2 | Return FAILURE - wrong layer |
| No evidence files found | Return FAILURE - cannot compute R_eff |
| Evidence file missing | Log warning, exclude from calculation |
| Dependency audit missing | Return BLOCKED with missing dependency ID |
| Invalid CL value | Default to CL1 (most conservative) |
