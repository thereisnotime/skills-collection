# Task: Validate Evidence (L1 -> L2)

## Context

You are the Inductor operating as a state machine executor. Your goal is to gather Empirical Validation (EV) for L1 hypotheses to promote them to L2.

Also serves as the REFRESH action in the Evidence Freshness governance loop.

We have substantiated hypotheses (L1) that passed logical verification. We need evidence that they work in reality.

## Goal

Gather empirical evidence for the assigned L1 hypothesis and determine whether it can be promoted to L2 (corroborated) or should be moved to invalid (falsified).

## Input

You will receive:
- **hypothesis_id**: The ID of the L1 hypothesis to validate (e.g., `use-redis-for-caching`)
- **hypothesis_path**: Full path to the hypothesis file in `.fpf/knowledge/L1/`

## Instructions

### 1. Read the Hypothesis

Read the L1 hypothesis file from `.fpf/knowledge/L1/<hypothesis_id>.md`:
- Extract the hypothesis title, method, expected outcome, and rationale
- Identify what evidence would validate or falsify this hypothesis
- Note any `depends_on` relationships that affect validation

### 2. Choose Agentic Validation Strategy

Choose the best validation strategy:

1.  **Strategy A: Internal Test (Preferred - Highest R)**
    * *Action:* Write and run a reproduction script, benchmark, or prototype.
    * *Why:* Direct evidence in the target context has Congruence Level (CL) = 3 (Max).
    * *Use when:* Code is executable, environment is available.

2.  **Strategy B: External Research (Fallback)**
    * *Action:* Use available MCP tools (search, docs, knowledge bases).
    * *Why:* Evidence from other contexts has lower CL (1 or 2). Applies penalty to R.
    * *Use when:* Running code is impossible or too costly.

### 3. Gather Evidence

Execute the chosen strategy:

**For Internal Test (CL3):**
1. Write and execute a test script, benchmark, or prototype
2. Document the test methodology and results
3. Record quantitative metrics where possible

**For Codebase Analysis (CL3):**
1. Search codebase for existing implementations or patterns
2. Analyze how similar problems are solved
3. Document findings with file paths and line numbers

**For External Research (CL1-CL2):**
1. Search documentation, papers, or external benchmarks
2. Find authoritative sources that support or refute the hypothesis
3. Note the source context and how it differs from target context

### 4. Calculate Reliability Score

Compute the reliability score (R) based on evidence quality:

| Evidence Quality | Base R Score |
|-----------------|--------------|
| Direct test with passing results | 0.90-0.95 |
| Direct test with mixed results | 0.70-0.85 |
| Codebase pattern match | 0.80-0.90 |
| Similar project evidence | 0.60-0.75 |
| External documentation | 0.50-0.70 |
| External opinion/benchmark | 0.40-0.60 |

**Apply CL Penalty:**
- CL3: No penalty (R unchanged)
- CL2: R = R * 0.9
- CL1: R = R * 0.75

### 5. Determine Verdict

Based on gathered evidence, assign a verdict:

| Verdict | Meaning | Action |
|---------|---------|--------|
| **PASS** | Evidence supports hypothesis | Promote to L2 |
| **FAIL** | Evidence contradicts hypothesis | Move to invalid |
| **REFINE** | Partial support, needs adjustment | Keep in L1 with feedback |

### 6. Create Evidence File

Create evidence file in `.fpf/evidence/` with naming format:
`ev-{type}-{hypothesis-id}-{YYYY-MM-DD}.md`

**Evidence File Format:**

```markdown
---
id: ev-{type}-{hypothesis-id}-{YYYY-MM-DD}
hypothesis_id: {hypothesis_id}
source: {internal-test|codebase-analysis|external-docs|external-benchmark}
CL: {1|2|3}
R: {0.00-1.00}
created: {ISO 8601 timestamp}
expires: {ISO 8601 timestamp - typically 6 months from created}
---

# Evidence: {Descriptive Title}

## Methodology

How the evidence was gathered:
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Results

Specific findings:
- Finding 1: [detail]
- Finding 2: [detail]
- Metrics (if applicable): [values]

## Interpretation

What these results mean for the hypothesis:
- [Key insight 1]
- [Key insight 2]

## Source References

- [Source 1]: [file path / URL / description]
- [Source 2]: [file path / URL / description]
```

### 7. Update Hypothesis File

Add validation section to the hypothesis file frontmatter and body:

**Frontmatter additions:**

```yaml
layer: L2
validated_at: {ISO 8601 timestamp}
validation:
  verdict: {PASS|FAIL|REFINE}
  evidence_count: {number of evidence files}
  R_eff: {minimum R across all evidence}
  weakest_link: "{description of lowest-R evidence}"
evidence:
  - id: {evidence-id}
    source: {source type}
    CL: {1|2|3}
    R: {0.00-1.00}
```

**Body addition:**

```markdown
## Validation

**Verdict**: {PASS|FAIL|REFINE}
**Validated**: {ISO 8601 timestamp}
**Evidence**: {list of evidence IDs}

### Summary

Brief summary of validation process and key findings.
```

### 8. Move Hypothesis File

Based on verdict:
- **PASS**: Move from `.fpf/knowledge/L1/` to `.fpf/knowledge/L2/`
- **FAIL**: Move from `.fpf/knowledge/L1/` to `.fpf/knowledge/invalid/`
- **REFINE**: Keep in `.fpf/knowledge/L1/`, add refinement notes

## Constraints

- You MUST NOT validate L0 hypotheses - only L1 hypotheses can be validated
- You MUST create an evidence file before promoting/demoting a hypothesis
- You MUST NOT proceed if the hypothesis file doesn't exist
- You SHALL NOT invent evidence - all findings must be verifiable
- You MUST use the exact file naming conventions specified
- Evidence files MUST have an expiration date (default: 6 months from creation)

## Expected Output

Return a structured validation report:

```markdown
## Validation Result

**Status**: SUCCESS | FAILURE | BLOCKED
**Hypothesis**: {hypothesis_id}
**Original Layer**: L1
**New Layer**: {L2|invalid|L1 (if REFINE)}
**Verdict**: {PASS|FAIL|REFINE}

### Evidence Summary

| Evidence ID | Type | CL | R Score | Key Finding |
|-------------|------|----|---------| ------------|
| {ev-id-1} | {type} | {CL} | {R} | {one-line summary} |

**R_eff (Effective Reliability)**: {minimum R across evidence}
**Weakest Link**: {description of lowest-scoring evidence}

### Files Created

- `.fpf/evidence/{evidence-filename}.md`

### Files Modified

- `.fpf/knowledge/{L2|invalid}/{hypothesis-id}.md` (moved from L1)

### Validation Notes

{Any important observations, caveats, or recommendations for the orchestrator}
```

## Success Criteria

- [ ] Read and understood the L1 hypothesis
- [ ] Selected appropriate validation strategy
- [ ] Gathered at least one piece of evidence
- [ ] Created evidence file with correct format and naming
- [ ] Calculated R score with CL penalty applied
- [ ] Updated hypothesis file with validation section
- [ ] Moved hypothesis to correct destination (L2/invalid) or kept in L1 with REFINE notes
- [ ] Returned structured validation report

## Error Handling

| Error Condition | Action |
|----------------|--------|
| Hypothesis file not found | Return BLOCKED status, specify missing file |
| Hypothesis is L0 (not L1) | Return BLOCKED status, hypothesis needs verification first |
| Cannot gather any evidence | Return BLOCKED status, explain what was attempted |
| Evidence is contradictory | Issue REFINE verdict, document conflicts |
| Dependencies not validated | Return BLOCKED status if dependent hypothesis not in L2 |
