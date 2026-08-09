# ARS Shared Contracts

Schema files for cross-skill contracts: reviewer sprint contracts, Material Passport
ports, and (v3.6.7+) cross-model audit artifact pipelines.

## Sprint contracts (v3.6.2+)

Sprint contract templates for reviewer hard-gate orchestration.

Schema: `shared/sprint_contract.schema.json` (Schema 13).
Validator: `scripts/check_sprint_contract.py`.
Spec: `docs/design/2026-04-23-ars-v3.6.2-sprint-contract-design.md`.
Protocol: `academic-paper-reviewer/references/sprint_contract_protocol.md`.

### Shipped templates

**v3.6.2 (reviewer family)**:

- `reviewer/full.json` — panel 5, 5 dimensions, 4 failure conditions
- `reviewer/methodology_focus.json` — panel 2, 2 dimensions, 3 failure conditions

**v3.6.6 / suite v3.6.8 (generator-evaluator family)**:

- `writer/full.json` — single-agent writer, 7 dimensions (D1 section_completeness / D2 citation_density / D3 argument_blueprint_fidelity / D4 total_word_count / D5 per_section_word_count / D6 acknowledged_limitations / D7 register_consistency), 5 failure conditions (F1 / F4 / F2 / F3 / F0). No `scoring_plan` field.
- `evaluator/full.json` — single-agent evaluator, 5 dimensions (D1 originality / D2 methodological_rigor / D3 evidence_sufficiency / D4 argument_coherence / D5 writing_quality), 7 failure conditions (F1 / F2 / F3 / F6 / F4 / F5 / F0). Carries full `scoring_plan` + `disagreement_handling`.

Both writer + evaluator templates ship under Schema 13.1 (allOf branches 11/12 require `pre_commitment_artifacts` for `writer_full` and `disagreement_handling` for `evaluator_full`; branches 5/6 pin `failure_conditions[].action` to mode-specific enums; branches 8/9 pin F0 contains to the mode's accept variant). Orchestration block lives in `academic-paper/SKILL.md` § "v3.6.6 Generator-Evaluator Contract Protocol" + the writer/evaluator agent files.

### Reserved reviewer modes without shipped templates

`reviewer_calibration` and `reviewer_guided` are in the schema enum but ship without
templates. Those modes continue to operate in their existing form (no contract, no
hard-gate) until a follow-up patch release adds their templates. `reviewer_re_review`
left the Schema 13 enum with #576 Spec B: re-review is governed by the dedicated
contract family under `re_review/` (four schemas + `scripts/check_re_review_synthesis.py`),
not by a Schema 13 template — a contract claiming `mode: reviewer_re_review` no longer
validates.

### How to add a new template

1. Add the file under `shared/contracts/<domain>/<mode>.json`.
2. Run `python scripts/check_sprint_contract.py <path> --ars-version vX.Y.Z`; expect
   zero errors and zero soft warnings.
3. If `expression` strings use new phrasing, update `sprint_contract_protocol.md`
   and the synthesizer prompt's recognised-pattern list in the same PR.

## Passport contracts (v3.6.4+)

Schemas for Material Passport input ports.

- `passport/literature_corpus_entry.schema.json` (v3.6.4) — Schema 9 `literature_corpus[]`
  entries produced by user-written adapters.
- `passport/bibliographic_integrity_signal.schema.json` (#678/#651) — v1.0
  additive signal carrier plus v1.1 authoritative retraction-status rows,
  including resolver disagreement/reinstatement, judgment context, freshness,
  and opt-in finalizer policy eligibility. The separate
  `retraction_status_cache_v1` namespace and pure resolver live in
  `scripts/retraction_status.py`.
- `passport/rejection_log.schema.json` (v3.6.4) — adapter output companion logging
  entries that could not be included in the corpus.
- `passport/reset_ledger_entry.schema.json` (v3.6.3) — `reset_boundary[]` ledger entries
  for the opt-in passport reset boundary protocol.
- `passport/audit_artifact_entry.schema.json` (v3.6.7 Step 6) — `audit_artifact[]` entries
  recording one cross-model audit run per downstream-agent deliverable. Two lifecycle
  states (proposal / persisted) share the schema via `oneOf`. Cross-artifact invariants
  are enforced by `scripts/check_audit_artifact_consistency.py`. Spec:
  `docs/design/2026-04-30-ars-v3.6.7-step-6-orchestrator-hooks-spec.md` §3.1-§3.2.
- `passport/version_records.schema.json` (Kong #258) — optional
  `phase2_investigation/version_records.yaml` sidecar for academic citation version
  families (preprint -> proceedings -> journal extension). This is deliberately a
  sidecar: `literature_corpus_entry.schema.json` stays adapter-owned and unmodified.
- `passport/human_read_log.schema.json` (#513) — the user-owned human-read ledger
  (`<passport-stem>_human_read_log.yaml`, written by `scripts/ars_mark_read.py`),
  including the optional #513 `read_scope` honest-coverage attestation
  (`level`/`locators`/`note`, declaration-only). Deliberately a sidecar for the same
  reason as above: corpus entries MUST NOT carry human-read state (v3.6.8 firm rule 3).
  Audit/test-time validation only — the CLI stays dependency-light at runtime.

## Shared evidence rows (#656)

`shared/contracts/evidence/evidence_row.schema.json` defines the closed
`evidence-row/1.0` carrier for evidence shown at human-adjudication checkpoints.
V1 has one consumer discriminator, `surface: phase_e_claim_verification`: the
Stage 2.5/4.5 Phase E Claim Verification Report persists
one row per `(claim_id, ref_slug, anchor)` at Integrity Report
`phases.E_claims.evidence_rows[]`. The array is additive: a positively identified
pre-#656 report may omit it and, only with `--allow-legacy-absence`, renders
exactly `LEGACY — EVIDENCE ROWS UNAVAILABLE`; missing shape alone is not legacy
proof and never means that evidence was checked. The opt-in Stage 4→5
`claim_audit_results[]` contract is a separate lifecycle and is unchanged.

The one evidence-state vocabulary is:

- `verified_exact_match` — a once-decoded writer `quote` anchor matched the
  exact session-held source string;
- `agent_extracted` — a `page`/`section` passage selected by the auditing agent,
  also exact-substring checked, but labeled non-authoritative because passage
  selection is agent judgment;
- `unconfirmed_anchor` — session source was present but the writer's decoded
  quote did not match it;
- `not_checked`, `source_missing`, `access_failed`, `retrieval_failed`, and
  `anchorless` — explicit empty states. V1 maps `paragraph` to `not_checked` and
  `none`/a missing marker to `anchorless`.

These states describe excerpt provenance/availability only. They never compute
or change the independent Phase E `verdict`, issue severity/count, or PASS/FAIL
decision. Viewing a row is not reading the source: the runtime never reads or
writes `human_read_log`, never invokes `/ars-mark-read`, and never affects
LOW-WARN/read-scope promotion.

`scripts/evidence_rows.py` is the standard-library-only normative runtime:

```python
strict_percent_decode(value)
build(row, session_source_or_none, *, extracted_text=None,
      failure_state=None, cached_row=None)
validate(row, session_source_or_none=None)
paginate(rows, page=1, page_size=25)
render_markdown(rows, page=1, page_size=25, *, session_sources=None)
render_html(rows, page=1, page_size=25, *, session_sources=None)
```

The decoder is strict UTF-8 and runs exactly once (`+` is not a space;
`%2520` becomes the literal `%20`). Positive excerpts must be an exact
contiguous substring of the explicitly supplied session source. Quote anchors
and excerpts are each capped at 25 words by whitespace split and 1000 Unicode
code points. `source_content_sha256` hashes the exact session source encoded as
UTF-8 with no Unicode, whitespace, or newline normalization;
`source_artifact_sha256` hashes optional raw artifact bytes and never substitutes
for the content hash. UTF-8 byte offsets bind an excerpt to the content hash.
`row_sha256` covers canonical JSON for the complete row except the digest field
itself. It is an unkeyed integrity checksum, not a signature or independent
proof of provenance. Source-bound trust is established by replaying the row
against explicitly supplied session source text. Direct Python
`validate(row)` without its optional source argument checks only closed shape,
cross-fields, and self-contained integrity; it does not prove source provenance.

Cache keys bind schema/surface, claim and citation identity, source-content
hash, decoded anchor, resulting state, and (for `page`/`section`) the candidate
excerpt hash. A key match is replay-validated against the current session
source before reuse. Hits preserve the original excerpt and `captured_at`, then
set `cache.status: hit` and recompute `row_sha256`. Claim/source/content/candidate
drift is a miss. A corrupt candidate is ignored and rebuilt from current explicit
inputs; it is never returned as a hit. Current explicit failure states win without
reading cached evidence; failure/empty states are never cached.

Renderers are pure functions over persisted rows plus the explicit in-memory
`session_sources` mapping supplied by their caller. Every source-bound row must
have a matching `ref_slug → exact source text` entry and is replay-validated
before anything is displayed; missing or drifting text fails closed. Empty-state
rows need no source map. The renderer does not accept or follow a source pointer,
URL, DOI, retrieval client, model, cache, or read ledger. Integrity validation
checks the stored encoded/decoded-anchor relationship; display does not decode or
alter the stored anchor again. Markdown and HTML external strings are rendered
inert, including percent-decoded markup, table delimiters, bare URLs/email,
newlines, all Unicode `Cc`/`Cf` controls, and U+2028/U+2029. A render page contains
at most 25 rows, preserves document order, reports total/page bounds and
deterministic previous/next/explicit-page navigation, and never silently
truncates. There is intentionally no `--all`; any number of persisted rows
remains accessible by page.

For any Integrity Report wrapper with `evidence_rows` present, the adapter
requires integer `E_claims.checked` and `E_claims.verified`; it checks that unique
evidence `claim_id` count equals `checked`, unique `VERIFIED` claim count equals
`verified`, and every row sharing a claim ID carries the same claim object and
claim-level verdict. Thus `checked > 0` with an empty present array fails. Raw
single-row and row-array inputs remain valid standalone runtime inputs. Only an
absent `evidence_rows` field is legacy-compatible. Exact omission
of a selected `(claim_id, ref_slug, anchor)` tuple cannot be proved from this
wrapper alone because the E1 selected-tuple registry is not machine-carried here;
the current producer must enforce that completeness before handoff.

Rows containing an excerpt or decoded quote anchor default to
`session_only`/`not_assessed`. Only an explicit user declaration may set the
paired `user_confirmed_shareable`/`user_declared_authorized` values. The length
limit is data minimization, not a licence, copyright exception, or publication
right; exported reports must retain the row handling label/caveat or strip the
external text.

Validate persisted rows or render exactly one page. On both CLI commands, any
source-bound row requires replay from an explicit `ref_slug → source text` JSON
map:

```bash
python scripts/evidence_rows.py validate evidence-rows.json \
  --source-map session-sources.json

python scripts/evidence_rows.py render evidence-rows.json \
  --format markdown --page 1 --page-size 25 \
  --source-map session-sources.json
```

`--source-map` is required whenever either CLI command receives a document with
a source-bound state; it is the only extra file the command opens. Missing
`evidence_rows` is a render failure by default. A positively identified pre-#656
Integrity Report renders the exact fixed legacy label with exit 0 only when the
caller adds `--allow-legacy-absence`; `validate` always rejects the absence.
Current producers may never use the compatibility flag.

## Human-subjects correspondence contract (#668)

`human_subjects/committee_correspondence.schema.json` defines the standalone
`academic-paper revision-coach` committee-correspondence variant. It binds every
confirmed source comment to one concern record while preserving the entire UTF-8
letter byte-for-byte, including non-comment material. The contract carries
multi-label actions, explicit authority/provenance, optional profile enrichment,
fixed unresolved placeholders, the #665 administrative boundary, and no model
priority or severity.

Validate a bundle with:

```bash
python scripts/check_committee_correspondence.py \
  committee_correspondence/<source-sha12>/concern_tracker.json
```

The checker recomputes file/segment hashes, contiguous byte coverage, exact
comment-to-concern accounting, source order, full-permutation working views, and
response-skeleton coverage. Spec:
`docs/design/2026-08-08-668-committee-correspondence-spec.md`.

## Human-subjects authority context (#666)

The `human_subjects/` authority family keeps selection explicit and separates three
closed artifacts:

- `irb_context_record.schema.json` — the author-confirmed facts plus exact,
  axis-qualified profile and overlay pins;
- `authority_profile_registry.schema.json` — curator-owned, versioned, bounded
  profiles and row-local source anchors;
- `resolved_authority_context.schema.json` — a pointer-only, deterministic
  three-valued applicability trace and downstream gate.

V1 has exactly two axes: `review_ethics` and `data_protection`. Institutional and
funder rules are additive overlays, never a third axis; display precedence cannot
remove, merge, or satisfy a requirement. The shipped registry demonstrates the
same contract with bounded US 45 CFR 46, Taiwan Human Subjects Research Act, and
GDPR research subsets. It is not a completeness, compliance, pathway, exemption,
or authorization claim.

Resolve an explicit context offline, lint the registry alone, or replay-check a
serialized result before consuming it:

```bash
python scripts/resolve_human_subjects_authority.py \
  --context context.json \
  --registry shared/human_subjects_authority_registry.json \
  --output resolved-authority-context.json

python scripts/resolve_human_subjects_authority.py \
  --registry shared/human_subjects_authority_registry.json \
  --check-registry

python scripts/resolve_human_subjects_authority.py \
  --context context.json \
  --registry shared/human_subjects_authority_registry.json \
  --check-resolved resolved-authority-context.json
```

The resolver is standard-library-only, opens only named files, evaluates a closed
Strong-Kleene predicate AST, never infers a jurisdiction, and rejects duplicate
JSON keys and non-finite numbers. Protocol:
`shared/references/human_subjects_authority_protocol.md`. Spec:
`docs/design/2026-08-09-666-human-subjects-authority-contract-spec.md`.

## Audit artifact contracts (v3.6.7 Step 6)

The `audit/` directory carries the three wrapper-emitted artifact schemas that pair
with the passport-side `audit_artifact_entry.schema.json` above. Together they form
the four-schema contract that `scripts/run_codex_audit.sh` (Phase 6.1) writes and the
orchestrator agent reads at every per-agent audit gate.

- `audit/audit_jsonl.schema.json` — Layer 2 evidence: per-row schema for the codex CLI
  0.125+ `--json` event stream (`thread.started` / `turn.started` / `item.completed` /
  `turn.completed` / `error`). One JSONL line per event row.
- `audit/audit_sidecar.schema.json` — Layer 3 evidence: runner / timing / process /
  stream / prompt metadata. Cross-file rules linking sidecar fields to JSONL events,
  on-disk files, and passport entries (B1-B7 in spec §3.7 family B) are enforced by
  `scripts/check_audit_artifact_consistency.py` (Phase 6.3), not by this schema alone.
- `audit/audit_verdict.schema.json` — verdict file shape (PASS / MINOR / MATERIAL /
  AUDIT_FAILED). The artifact orchestrator parses for ship/block decisions; cross-field
  consistency with `finding_counts` and `failure_reason` is lint-enforced per
  spec §3.7 A1 / A2 / A5 / A6.

Spec: `docs/design/2026-04-30-ars-v3.6.7-step-6-orchestrator-hooks-spec.md` §3.

## Review target contracts (#683)

The `review_target/` family keeps target selection author-owned and separates it
from deterministic criterion resolution:

- `review_target_declaration.schema.json` — the closed author-confirmed discipline,
  exact venue/track/contribution-type (or explicit no-venue fallback), overlay,
  selection, precedence, and as-of input;
- `criteria_registry.schema.json` — the versioned four-part authority registry with
  criterion provenance, applicability/exclusions, freshness, and blocking policy;
- `review_target_context.schema.json` — the pointer-only resolved profile, three
  independent outcome dimensions, parallel conflicts, fallback state, and stable
  digests.

`shared/review_criteria_registry.json` intentionally ships only a field-general
baseline. It does not present remembered or synthetic journal rules as official
venue guidance. Exact venue × track × contribution-type behavior is covered by
synthetic fixtures.

Resolve a declaration and optionally emit the Phase 0/1 Target Criteria Brief:

```bash
python scripts/resolve_review_target_context.py \
  --context declaration.json \
  --output review-target-context.json \
  --brief target-criteria-brief.md
```

The resolver is standard-library-only and opens only the named context and registry
inputs. It never reads manuscript content, infers a venue, averages interdisciplinary
criteria, or applies adaptive numeric weights. Spec:
`docs/design/2026-08-08-683-review-target-context-spec.md`.
