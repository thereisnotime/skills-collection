# Audit Summary Contract

Machine-readable summary contract for 6XX audit workers.

Audit coordinators consume JSON summaries first and read markdown worker reports only for detailed evidence.

## Envelope

Audit workers use the shared coordinator envelope:

```json
{
  "schema_version": "1.0.0",
  "summary_kind": "audit-worker",
  "run_id": "ln-620-global-...",
  "identifier": "ln-621-global",
  "producer_skill": "ln-621",
  "produced_at": "2026-03-27T10:00:00Z",
  "payload": {}
}
```

Rules:
- `summary_kind` for 6XX workers is `audit-worker`.
- `run_id` is mandatory for every audit summary envelope.
- If the caller does not pass `runId`, the worker generates a standalone `run_id` before emitting the summary.
- `identifier` must be stable inside the run.
- Use domain or target suffixes when one worker runs multiple times in the same coordinator.

Examples:
- `ln-612-docs-readme`
- `ln-623-users`
- `ln-641-job-processing`

## Payload

Required payload fields:

```json
{
  "status": "completed",
  "category": "Security",
  "report_path": ".hex-skills/runtime-artifacts/runs/<run_id>/audit-report/621-security.md",
  "score": 8.5,
  "issues_total": 3,
  "severity_counts": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 0
  },
  "warnings": []
}
```

Allowed `status` values:
- `completed` - worker finished normally and produced a usable report
- `skipped` - worker was intentionally skipped for scope or applicability reasons
- `error` - worker could not finish normally; report may contain partial evidence

`complete` is invalid. Use `completed`.

Optional payload fields:
- `diagnostic_scores`
- `domain_name`
- `scan_scope`
- `metadata`

## `summaryArtifactPath`

When the coordinator passes `summaryArtifactPath`:
- write the JSON summary to that exact path
- return the same summary in structured output when possible

When `summaryArtifactPath` is absent:
- return the summary in structured output
- compact text output is allowed only as compatibility fallback

## Relationship to Worker Markdown Reports

Every audit worker still writes its markdown report.

The JSON summary is not a replacement for the report. It is the transport contract for:
- scores
- severity totals
- category labels
- report location

The markdown report remains the evidence artifact for findings tables and extended data blocks.
