# Audit Coordinator Aggregation

Shared aggregation pattern for coordinators that collect worker summaries, read worker report files, and assemble one consolidated audit report.

## Runtime Artifact Directories

Use one run-scoped artifact directory per run:

```text
.hex-skills/runtime-artifacts/runs/{run_id}/audit-report/
.hex-skills/runtime-artifacts/runs/{run_id}/audit-worker/
```

Rules:
- Create the run-scoped directories before delegating.
- Delete the run-scoped artifact directory after the consolidated report and results-log row are written (see Worker File Cleanup below).

## Parse Worker Summaries First

Prefer JSON worker summaries for numbers:

```json
{
  "summary_kind": "audit-worker",
  "identifier": "ln-621-global",
  "payload": {
    "report_path": ".hex-skills/runtime-artifacts/runs/{run_id}/audit-report/621-security.md",
    "score": 7.5,
    "issues_total": 5,
    "severity_counts": {"critical": 0, "high": 2, "medium": 2, "low": 1}
  }
}
```

Extract:
- worker identifier
- report file path
- score
- total issues
- severity counts
- optional diagnostic sub-scores

Use file reads later for detailed findings, not for numbers you already have.

## Standard Aggregation Steps

1. Parse JSON summaries from all completed workers.
2. Build score tables by category.
3. Roll up severity totals across workers.
4. Read worker report files for findings tables and optional machine-readable blocks.
5. Apply worker-specific or coordinator-specific post-filters.
6. Assemble the final consolidated report.
7. Append a results-log row (mandatory for all coordinators).
8. Delete the current run-scoped runtime artifact directory.

## Score Handling

- Use the worker's primary penalty-based score for category and overall scoring.
- Exclude `N/A` workers from averages.
- Keep diagnostic sub-scores informational only unless the coordinator explicitly reports them as diagnostics.
- If post-filtering downgrades findings to advisory, recalculate affected category scores without advisory-only findings.

## File Reads

Read worker report files only for:
- Findings tables
- `FINDINGS-EXTENDED`
- `DATA-EXTENDED`
- worker-specific evidence that must appear in the final report

Avoid rescanning the codebase in the coordinator when worker outputs already contain the needed evidence.

## Error Handling

If a worker fails:
- record the failure explicitly
- continue aggregating other workers
- mark the failed category as `error` or `skipped` with explicit reason
- never silently drop missing worker output

## Results Log

Append one row after the final score is known.

**MANDATORY READ:** Load `shared/references/results_log_pattern.md` when the coordinator writes results history.

## Worker File Cleanup

After the results-log row is appended, delete the current run's runtime artifact directory:

```bash
rm -rf .hex-skills/runtime-artifacts/runs/{run_id}
```

This removes run-scoped worker markdown reports and JSON summaries. Worker files are intermediate artifacts; the consolidated report and results log preserve all needed history.

Do NOT delete `docs/project/.audit/results_log.md` — it lives outside the dated directory.
