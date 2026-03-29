# Task Planning Runtime Contract

Runtime contract for `ln-300`.

## Identifier

- `story-{storyId}`

## Phases

- `PHASE_0_CONFIG`
- `PHASE_1_DISCOVERY`
- `PHASE_2_DECOMPOSE`
- `PHASE_3_READINESS_GATE`
- `PHASE_4_MODE_DETECTION`
- `PHASE_5_DELEGATE`
- `PHASE_6_VERIFY`
- `PHASE_7_SELF_CHECK`
- `DONE`
- `PAUSED`

## Required State

- `discovery_ready`
- `ideal_plan_summary`
- `readiness_score`
- `readiness_findings`
- `mode_detection`
- `plan_result`
- `verification_summary`
- `final_result`
- `self_check_passed`
- `pending_decision`

## Guard Rules

- No transition without current-phase checkpoint.
- `PHASE_2_DECOMPOSE` requires `discovery_ready`.
- `PHASE_3_READINESS_GATE` requires `ideal_plan_summary`.
- `PHASE_4_MODE_DETECTION` requires `readiness_score`.
- `readiness_score < 4` blocks the run.
- `readiness_score` `4-5` requires a resolved approval decision before mode detection.
- `PHASE_5_DELEGATE` requires `mode_detection`.
- `PHASE_6_VERIFY` requires task-plan worker summary.
- `PHASE_7_SELF_CHECK` requires `verification_summary`.
- `DONE` requires `self_check_passed` and `final_result`.

## Pending Decisions

Use shared `pending_decision` schema for:
- ambiguous `ADD` vs `REPLAN`
- readiness approval
- missing critical Story context

## Worker Summaries

Workers stay standalone-first and may optionally write `task-plan` summaries.
Every `task-plan` summary uses the shared envelope with mandatory `run_id`; standalone workers generate one when the caller does not pass `runId`.
