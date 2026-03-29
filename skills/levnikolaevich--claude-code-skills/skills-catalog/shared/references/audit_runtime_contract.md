# Audit Runtime Contract

Deterministic runtime contract for 6XX audit coordinators.

Use this contract for:
- `ln-610-docs-auditor`
- `ln-620-codebase-auditor`
- `ln-630-test-auditor`
- `ln-640-pattern-evolution-auditor`
- `ln-650-persistence-performance-auditor`

## Runtime Location

```text
.hex-skills/audits/runtime/
  active/{skill}/{identifier}.json
  runs/{run_id}/manifest.json
  runs/{run_id}/state.json
  runs/{run_id}/checkpoints.json
  runs/{run_id}/history.jsonl
```

Run-scoped worker artifacts live outside the runtime store:

```text
.hex-skills/runtime-artifacts/runs/{run_id}/audit-report/{worker-id}.md
.hex-skills/runtime-artifacts/runs/{run_id}/audit-worker/{worker-id}.json
```

## Commands

```bash
node shared/scripts/audit-runtime/cli.mjs start --skill ln-620 --identifier global --manifest-file <file>
node shared/scripts/audit-runtime/cli.mjs status --skill ln-620 --identifier global
node shared/scripts/audit-runtime/cli.mjs checkpoint --skill ln-620 --phase PHASE_3_AGGREGATE --payload '{...}'
node shared/scripts/audit-runtime/cli.mjs record-worker-result --skill ln-620 --payload '{...}'
node shared/scripts/audit-runtime/cli.mjs advance --skill ln-620 --to PHASE_4_REPORT
node shared/scripts/audit-runtime/cli.mjs pause --skill ln-620 --reason "..."
node shared/scripts/audit-runtime/cli.mjs set-decision --skill ln-620 --payload '{...}'
node shared/scripts/audit-runtime/cli.mjs complete --skill ln-620
```

## Manifest Contract

Required manifest fields:
- `skill`
- `identifier`
- `phase_order`
- `phase_policy`
- `report_path`

Optional fields:
- `mode`
- `results_log_path`

`phase_order` is the canonical source of phase names and ordering. Do not duplicate alternative spellings in guards or scripts.

`phase_policy` may define:
- `delegate_phases`
- `aggregate_phase`
- `report_phase`
- `results_log_phase`
- `cleanup_phase`
- `self_check_phase`

## State Schema

Required audit-family fields in `state.json`:
- `phase_order`
- `phase_data`
- `worker_plan`
- `worker_results`
- `aggregation_summary`
- `report_written`
- `report_path`
- `results_log_appended`
- `results_log_path`
- `cleanup_completed`
- `self_check_passed`

Rules:
- `phase_data` stores the latest checkpoint payload per phase.
- `worker_results` stores validated audit worker summaries keyed by summary identifier.
- `report_path` points to the public durable report, not a run-scoped artifact.

## Guard Rules

- No transition without a checkpoint for the current phase.
- Transitions follow `phase_order` exactly; runtime must not accept ad hoc aliases.
- Every phase listed in `delegate_phases` requires at least one recorded worker summary unless the phase checkpoint explicitly marks `skipped_by_mode=true`.
- The configured `aggregate_phase` requires `aggregation_summary`.
- The configured `report_phase` requires `report_written=true`.
- If configured, `results_log_phase` requires `results_log_appended=true`.
- If configured, `cleanup_phase` requires `cleanup_completed=true`.
- `DONE` requires `self_check_passed=true`, `report_written=true`, and all configured post-report phases complete.

## Public Outputs vs Runtime Artifacts

Public outputs remain durable project files:
- consolidated audit report
- `docs/project/.audit/results_log.md`

Runtime artifacts are temporary per-run worker materials:
- worker markdown reports
- machine-readable worker summaries

Do not use `docs/project/.audit/{skill}/{date}` as an intermediate transport layer once migrated to this runtime.
