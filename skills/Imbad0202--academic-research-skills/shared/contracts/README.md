# ARS Sprint Contracts

Sprint contract templates for ARS v3.6.2+ reviewer hard-gate orchestration.

Schema: `shared/sprint_contract.schema.json` (Schema 13).
Validator: `scripts/check_sprint_contract.py`.
Spec: `docs/design/2026-04-23-ars-v3.6.2-sprint-contract-design.md`.
Protocol: `academic-paper-reviewer/references/sprint_contract_protocol.md`.

## Shipped templates (v3.6.2)

- `reviewer/full.json` — panel 5, 5 dimensions, 4 failure conditions
- `reviewer/methodology_focus.json` — panel 2, 2 dimensions, 3 failure conditions

## Reserved reviewer modes without shipped templates

`reviewer_re_review`, `reviewer_calibration`, `reviewer_guided` are in the schema enum
but ship without templates in v3.6.2. Those modes continue to operate in their existing
form (no contract, no hard-gate) until a follow-up patch release adds their templates.

## How to add a new template

1. Add the file under `shared/contracts/<domain>/<mode>.json`.
2. Run `python scripts/check_sprint_contract.py <path> --ars-version vX.Y.Z`; expect
   zero errors and zero soft warnings.
3. If `expression` strings use new phrasing, update `sprint_contract_protocol.md`
   and the synthesizer prompt's recognised-pattern list in the same PR.
