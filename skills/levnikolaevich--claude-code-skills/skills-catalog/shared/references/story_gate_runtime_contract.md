# Story Gate Runtime Contract

Deterministic runtime for `ln-500-story-quality-gate`.

Canonical phase/status names: `shared/references/runtime_status_catalog.md`

## Runtime Location

```text
.hex-skills/story-gate/runtime/
  active/ln-500/{story_id}.json
  runs/{run_id}/manifest.json
  runs/{run_id}/state.json
  runs/{run_id}/checkpoints.json
  runs/{run_id}/history.jsonl
```

## Commands

```bash
node shared/scripts/story-gate-runtime/cli.mjs start --story PROJ-123 --manifest-file <file>
node shared/scripts/story-gate-runtime/cli.mjs status --story PROJ-123
node shared/scripts/story-gate-runtime/cli.mjs record-quality --payload '{...}'
node shared/scripts/story-gate-runtime/cli.mjs record-test-status --payload '{...}'
node shared/scripts/story-gate-runtime/cli.mjs checkpoint --phase PHASE_6_VERDICT --payload '{...}'
node shared/scripts/story-gate-runtime/cli.mjs advance --to PHASE_7_FINALIZATION
node shared/scripts/story-gate-runtime/cli.mjs pause --reason "..."
node shared/scripts/story-gate-runtime/cli.mjs complete
```

## Phase Graph

- `PHASE_0_CONFIG`
- `PHASE_1_DISCOVERY`
- `PHASE_2_FAST_TRACK`
- `PHASE_3_QUALITY_CHECKS`
- `PHASE_4_TEST_PLANNING`
- `PHASE_5_TEST_VERIFICATION`
- `PHASE_6_VERDICT`
- `PHASE_7_FINALIZATION`
- `PHASE_8_SELF_CHECK`
- `DONE`
- `PAUSED`

## Required State Fields

- `fast_track`
- `quality_summary`
- `test_task_id`
- `test_task_status`
- `test_planner_invoked`
- `quality_score`
- `nfr_validation`
- `fix_tasks_created`
- `branch_finalized`
- `story_final_status`

## Guard Rules

- no transition past `PHASE_3_QUALITY_CHECKS` without `ln-510` summary
- no transition past `PHASE_5_TEST_VERIFICATION` while test task is still pending
- `PHASE_6_VERDICT` must record terminal gate result before finalization
- FAIL still passes through `PHASE_7_FINALIZATION`, but as `skipped_by_verdict`
- `DONE` requires `PHASE_8_SELF_CHECK` with `pass=true` and final story state recorded

## Canonical Status Sets

- gate verdicts: `PASS`, `CONCERNS`, `WAIVED`, `FAIL`
- completed test-task statuses: `Done`, `SKIPPED`, `VERIFIED`
- finalization shortcut status: `skipped_by_verdict`

These names are canonical for the runtime. Do not replace them with free-form alternatives in checkpoints or examples.

## Downstream Summary Contract

`ln-510` and `ln-520` must write summaries per `shared/references/coordinator_summary_contract.md`.
