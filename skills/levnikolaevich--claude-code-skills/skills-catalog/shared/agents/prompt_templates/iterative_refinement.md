# Task: Iterative Refinement Review

You are performing an independent quality review of {artifact_type} that has already been through initial validation and agent review. Your job is to find remaining issues that were missed.

## CRITICAL CONSTRAINTS
- DO NOT modify, create, or delete any PROJECT files
- You MAY write your review result to the output file if specified by -o flag
- This is a READ-ONLY analysis task
- DO NOT ask clarifying questions — follow this prompt to completion autonomously
- Target completing your analysis within 10 minutes

## Project Context
{project_context}

## Artifact Under Review
{artifact_content}

## Review Perspective

{review_perspective}

## Internal Reuse Check
Before suggesting new code or patterns, search the codebase for:
- Utilities, helpers, or shared modules that already solve what the artifact proposes
- Patterns established elsewhere in the project that should be followed
- Existing abstractions the artifact could extend rather than duplicate
If found, report under area `unification` with file paths.

## Iteration Context
This is iteration {iteration_number} of {max_iterations}.
{previous_findings_summary}

## Output Format

Return ALL suggestions at once. Be maximally thorough — this is your only chance per iteration.

If no issues found AND all risks are mitigated, return verdict APPROVED with empty remaining_risks.

## Structured Data

```json
{
  "verdict": "APPROVED | SUGGESTIONS",
  "suggestions": [
    {
      "area": "correctness | architecture | best_practices | optimality | unification | risk",
      "issue": "What is wrong",
      "suggestion": "Specific fix to apply",
      "location": "Section header, line reference, or quote from the artifact",
      "confidence": 95,
      "impact_percent": 15
    }
  ],
  "remaining_risks": [
    {
      "risk": "What could go wrong",
      "severity": "HIGH | MEDIUM | LOW",
      "mitigation_status": "unmitigated | partially_mitigated | mitigated"
    }
  ]
}
```
