# Scope Decomposition Runtime Contract

Runtime contract for `ln-200`.

Canonical phase/status names: `shared/references/runtime_status_catalog.md`

## Identifier

- scope identifier

## Phases

- `PHASE_0_CONFIG`
- `PHASE_1_DISCOVERY`
- `PHASE_2_EPIC_DECOMPOSITION`
- `PHASE_3_STORY_LOOP`
- `PHASE_4_PRIORITIZATION_LOOP`
- `PHASE_5_FINALIZE`
- `PHASE_6_SELF_CHECK`
- `DONE`
- `PAUSED`

## Required State

- `discovery_summary`
- `epic_summary`
- `story_summaries`
- `prioritization_summary`
- `self_check_passed`

## Guard Rules

- no transition without current-phase checkpoint
- `PHASE_2_EPIC_DECOMPOSITION` requires discovery summary
- `PHASE_3_STORY_LOOP` requires epic summary
- `PHASE_4_PRIORITIZATION_LOOP` requires at least one Story-planning summary
- `DONE` requires `self_check_passed` and `final_result`
