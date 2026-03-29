# Coordinator Summary Contract

Machine-readable worker outputs for standalone workers and coordinator runtimes.

## General Rules

- Every worker summary uses the same envelope.
- Workers remain standalone-capable.
- `summaryArtifactPath` is optional.
- If `summaryArtifactPath` is provided, write the summary JSON to that exact path.
- If `summaryArtifactPath` is not provided, return the same summary in structured output.
- Coordinators consume summaries, not prose chat output.
- Runtime artifacts are always run-scoped:
  - `.hex-skills/runtime-artifacts/runs/{run_id}/{summary_kind}/{identifier}.json`

## Shared Envelope

Required fields for every worker summary:

```json
{
  "schema_version": "1.0.0",
  "summary_kind": "story-plan",
  "run_id": "run-ln-220-20260326-abc123",
  "identifier": "epic-7",
  "producer_skill": "ln-221",
  "produced_at": "2026-03-26T10:00:00Z",
  "payload": {}
}
```

Rules:
- `summary_kind` describes the operation, not the coordinator.
- `run_id` is mandatory for every summary envelope.
- If the caller does not pass `runId`, the worker generates a standalone `run_id` before emitting the summary.
- `identifier` is domain-specific and stable inside the run.
- `payload` shape is domain-specific and validated by schema.
- the envelope itself is validated by the shared coordinator-runtime schema layer

## Environment Worker Summaries

Status names follow `shared/references/runtime_status_catalog.md`.

Allowed `summary_kind` values:
- `env-agent-install`
- `env-mcp-config`
- `env-config-sync`
- `env-instructions`

Payload fields:
- `status` (`completed`, `skipped`, `error`)
- `targets`
- `changes`
- `warnings`
- `detail`

## Story Plan Worker Summary

`summary_kind`:
- `story-plan`

Payload fields:
- `mode`
- `epic_id`
- `stories_planned`
- `stories_created`
- `stories_updated`
- `stories_canceled`
- `story_urls`
- `warnings`
- `kanban_updated`
- `research_path_used`

## Task Plan Worker Summary

`summary_kind`:
- `task-plan`

Payload fields:
- `mode`
- `story_id`
- `task_type`
- `tasks_created`
- `tasks_updated`
- `tasks_canceled`
- `task_urls`
- `kanban_updated`
- `dry_warnings_count`
- `warnings`

## Existing Coordinator Families

Older stateful families use the same run-scoped policy even when their payload differs.

Examples:
- task execution summaries
- story quality summaries
- story test summaries
- optimization summaries

## Quality Worker Summary

`summary_kind`:
- `quality-worker`

Payload fields:
- `worker`
- `status`
- `verdict`
- `score`
- `issues`
- `warnings`
- `artifact_path`
- `metadata`

## Test Planning Worker Summary

`summary_kind`:
- `test-planning-worker`

Payload fields:
- `worker`
- `status`
- `warnings`
- `research_comment_path`
- `manual_result_path`
- `test_task_id`
- `test_task_url`
- `coverage_summary`
- `planned_scenarios`
- `metadata`

## Docs Generation Summary

`summary_kind`:
- `docs-generation`

Payload fields:
- `worker`
- `status`
- `created_files`
- `skipped_files`
- `quality_inputs`
- `validation_status`
- `warnings`
- `metadata`

## Epic Planning Summary

`summary_kind`:
- `epic-plan`

Payload fields:
- `mode`
- `scope_identifier`
- `epics_created`
- `epics_updated`
- `epics_canceled`
- `epic_urls`
- `warnings`
- `kanban_updated`
- `infrastructure_epic_included`

## Scope Decomposition Summary

`summary_kind`:
- `scope-decomposition`

Payload fields:
- `scope_identifier`
- `epic_runs_completed`
- `story_runs_completed`
- `prioritization_runs_completed`
- `warnings`
- `final_result`

The envelope remains the same. Only `summary_kind` and `payload` change.
