# Changelog

All notable changes to this project will be documented in this file.

## [3.3.6] - 2026-04-15

### Added
- `docs/ARCHITECTURE.md` — single source of truth for pipeline structure (flow, stage × dimension matrix, data-access flow, skill dependency graph, quality gates, modes). Merged into main via PR #18.
- `docs/SETUP.md` + `docs/SETUP.zh-TW.md` — prerequisites, API keys, Pandoc / tectonic setup, cross-model verification (`ARS_CROSS_MODEL`), and four installation methods.
- `docs/PERFORMANCE.md` + `docs/PERFORMANCE.zh-TW.md` — per-mode token budgets, full-pipeline cost estimate, and recommended Claude Code settings (Agent Team, Ralph Loop, Skip Permissions).

### Changed
- `README.md` and `README.zh-TW.md` streamlined: removed the ASCII pipeline diagram and the 16-point key-feature list (superseded by `docs/ARCHITECTURE.md`). Setup, performance, and installation sections relocated to `docs/`. Skill Details now anchors version numbers and routes readers to ARCHITECTURE.md §3 for per-agent rosters.
- `scripts/check_spec_consistency.py` — bumped README version expectations to `v3.3.6`; DOCX contract expectations (both EN and zh-TW) moved from READMEs to the new `docs/SETUP.*` docs; added `check_setup_docs()` step.
- Suite version bumped to `3.3.6` across `README.md`, `README.zh-TW.md`, `.claude/CLAUDE.md`, and `MODE_REGISTRY.md`.

### Notes
- No functional change to any skill. Pure documentation reorganization.

## [3.3.5] - 2026-04-15

### Added
- `shared/benchmark_report.schema.json` — JSON Schema (draft-2020-12) defining required fields for ARS benchmark reports. Catches the "n=2 author-conducted baseline" failure mode from Anthropic's automated-w2s-researcher paper.
- `shared/benchmark_report_pattern.md` — narrative hub doc explaining the schema.
- `scripts/check_benchmark_report.py` + tests — validator with self-scored and small-sample warnings.
- `examples/benchmark_report_template.json` — fillable template.
- `repro_lock` optional sub-block added to Material Passport (Schema 9 in `shared/handoff_schemas.md`). Configuration lockfile; NOT a deterministic replay guarantee.
- `shared/artifact_reproducibility_pattern.md` — hub doc with mandatory "not a replay guarantee" disclaimer section and required `stochasticity_declaration` field.
- `scripts/check_repro_lock.py` + tests — passport validator.
- `examples/passport_with_repro_lock.yaml` — example.
- `requirements-dev.txt` — formal Python dev dep manifest (pyyaml + jsonschema).

### Changed
- `.github/workflows/spec-consistency.yml` installs via `pip install -r requirements-dev.txt` instead of ad-hoc `pip install`.
- `academic-pipeline/references/reproducibility_audit.md` cross-links to new artifact-reproducibility pattern.

## [3.3.4] - 2026-04-15

### Fixed
- Embedded changelog sections in `README.md` and `README.zh-TW.md` now include the missing `v3.3.3` and `v3.3.2` summaries, so the README history matches the published releases.
- `scripts/check_spec_consistency.py` now verifies that the README changelog summaries include the latest release entries, so future drift fails CI.

### Changed
- Suite version bumped to `3.3.4` across release-facing docs after the README changelog sync patch release.

## [3.3.3] - 2026-04-15

### Fixed
- `scripts/_skill_lint.py` now rejects SKILL frontmatter that is missing a closing `---` fence instead of silently treating the rest of the file as YAML.
- `scripts/_skill_lint.py` now reports a readable error when frontmatter parses as valid YAML but not as a mapping object, instead of crashing with `AttributeError`.
- Broken showcase link for the post-publication audit report corrected in both `README.md` and `README.zh-TW.md`.
- `scripts/check_spec_consistency.py` now validates README relative Markdown links so future dead links fail CI.

### Changed
- DOCX generation contract aligned across README, `academic-paper/SKILL.md`, `academic-paper/agents/formatter_agent.md`, `academic-pipeline/SKILL.md`, and `academic-pipeline/agents/pipeline_orchestrator_agent.md`: direct `.docx` output is Pandoc-dependent, with Markdown + conversion instructions as the fallback.
- Added regression tests covering missing closing fences and non-mapping YAML frontmatter in both lint test suites.
- Suite version bumped to `3.3.3` across release-facing docs; `academic-paper` patch-bumped to `3.0.2` and `academic-pipeline` patch-bumped to `3.2.2`.

## [3.3.2] - 2026-04-15

### Added
- `metadata.data_access_level` field on every top-level SKILL.md. Three-tier vocabulary (`raw` | `redacted` | `verified_only`) declaring what kind of data each skill may consume. Inspired by the three-tier isolation pattern in Anthropic's automated-w2s-researcher (2026).
  - `deep-research` = `raw`
  - `academic-paper` = `redacted`
  - `academic-paper-reviewer` = `verified_only`
  - `academic-pipeline` = `verified_only`
- `scripts/check_data_access_level.py` lint script with unit tests; wired into `.github/workflows/spec-consistency.yml`.
- Pointer section in `shared/handoff_schemas.md` documenting the vocabulary for future skill authors.
- `metadata.task_type` field on every top-level SKILL.md. Two-value vocabulary (`open-ended` | `outcome-gradable`) declaring whether the task has a scalar ground-truth metric. All current ARS skills are `open-ended` — the field is a truth-in-advertising signal that ARS targets domain-judgment work, not benchmark tasks.
- `scripts/check_task_type.py` lint script with 4 unit tests; wired into the same CI workflow.
- Pointer section in `shared/handoff_schemas.md` for the `task_type` vocabulary.
- `shared/ground_truth_isolation_pattern.md` — narrative pattern doc explaining the three-layer model behind `data_access_level` and `task_type`. Cross-references existing protocols (S2 verification, anti-leakage, integrity gates, calibration mode). Linked from `handoff_schemas.md` and `CONTRIBUTING.md`.

### Changed
- Per-skill `metadata.version` patch-bumped on all 4 SKILL.md files; `last_updated` refreshed to 2026-04-15.
- Suite version bumped to 3.3.2 across `README.md`, `README.zh-TW.md`, and `.claude/CLAUDE.md`.

## [3.3.1] - 2026-04-14

### Fixed
- Public contract drift across `README.md`, `README.zh-TW.md`, `.claude/CLAUDE.md`, `MODE_REGISTRY.md`, and the affected `SKILL.md` files
- Cross-model wording now matches the implemented scope: integrity sample verification and independent DA critique are shipped; sixth-reviewer peer review remains planned
- `academic-pipeline` checkpoint docs now state that SLIM checkpoints still wait for explicit user confirmation
- `academic-pipeline` integrity gate docs now consistently state that Stage 2.5 and Stage 4.5 cannot be skipped
- `academic-paper/SKILL.md` mode-count heading and `academic-paper-reviewer/SKILL.md` Version Info block

### Added
- `scripts/check_spec_consistency.py` to catch mode-count, version-block, and forbidden-claim drift
- `.github/workflows/spec-consistency.yml` to run the consistency check on pushes and pull requests

## [3.3] - 2026-04-09

### Added — PaperOrchestra-inspired enhancements
Integrates techniques from Song et al. (2026, *arXiv:2604.05018*) "PaperOrchestra: A Multi-Agent Framework for Automated AI Research Paper Writing."

- **Semantic Scholar API Verification** (deep-research, academic-pipeline): Tier 0 programmatic reference verification via S2 API. Title search with Levenshtein >= 0.70 matching. DOI mismatch detection for Compound Deception Pattern #5. Bibliography deduplication via S2 IDs. Graceful degradation if API unavailable.
  - New file: `deep-research/references/semantic_scholar_api_protocol.md`
  - Modified: `source_verification_agent`, `bibliography_agent`, `integrity_verification_agent`
- **Anti-Leakage Protocol** (academic-paper, deep-research): Knowledge Isolation Directive prioritizes session materials over LLM parametric memory for factual content. Flags `[MATERIAL GAP]` for missing content instead of silently filling from memory. Reduces Mode 5/6 failure risk.
  - New file: `academic-paper/references/anti_leakage_protocol.md`
  - Modified: `draft_writer_agent`, `report_compiler_agent`
- **VLM Figure Verification** (academic-paper): Optional closed-loop verification of rendered figures using vision-capable LLM. 10-point checklist covering data accuracy, APA 7.0 compliance, and visual quality. Max 2 refinement iterations.
  - New file: `academic-paper/references/vlm_figure_verification.md`
  - Modified: `visualization_agent`
- **Score Trajectory Protocol** (academic-pipeline): Per-dimension rubric score delta tracking across revision rounds. Detects regressions (delta < -3) and triggers mandatory checkpoint. Extends v3.2 early-stopping with dimension-level granularity.
  - New file: `academic-pipeline/references/score_trajectory_protocol.md`
  - Modified: `integrity_review_protocol.md`, `handoff_schemas.md` (Schema 5)
- **Stage 2 Parallelization Directive** (academic-pipeline): Visualization and argument building can run in parallel after outline completion.
- **Handoff Schema Updates** (shared): `semantic_scholar_id` field added to Bibliography source object. `score_trajectory` structure added to Integrity Report schema.

**Version bumps**: deep-research v2.8, academic-paper v3.0, academic-pipeline v3.2

## [3.2] - 2026-04-09

### Added — Lu 2026 integration
Integrates insights from Lu et al. (2026, *Nature* 651:914-919) — the first end-to-end autonomous AI research system to pass blind peer review.

- **AI Research Failure Mode Checklist** (academic-pipeline): 7-mode taxonomy extending the existing 5-type citation hallucination taxonomy. Covers implementation-bug blindness, hallucinated experimental results, shortcut reliance, bug-as-insight, methodology fabrication, and pipeline-level frame-lock. Runs at Stage 2.5 and 4.5 with mandatory blocking behaviour. Reported at Stage 6 in the Failure Mode Audit Log subsection of the AI Self-Reflection Report.
  - New file: `academic-pipeline/references/ai_research_failure_modes.md`
- **Reviewer Calibration Mode** (academic-paper-reviewer v1.8): opt-in mode that measures FNR / FPR / balanced accuracy / AUC against a user-supplied gold-standard set of 5-20 papers. Uses 5x ensembling with fresh context per run. Cross-model verification default-on. Session-scoped confidence disclosure.
  - New file: `academic-paper-reviewer/references/calibration_mode_protocol.md`
- **Disclosure Mode** (academic-paper v2.9): venue-specific AI-usage disclosure statement generator. v1 database covers ICLR, NeurIPS, Nature, Science, ACL, EMNLP. Unknown venues halt and prompt user to paste policy.
  - New files: `academic-paper/references/disclosure_mode_protocol.md`, `academic-paper/references/venue_disclosure_policies.md`
- **Fidelity-Originality Mode Spectrum** (all skills): classifies all modes on a fidelity–originality axis per Lu 2026 Fig 1c. Quick Mode Selection Guides updated with Spectrum column.
  - New file: `shared/mode_spectrum.md`
- **Early-Stopping Criterion** (academic-pipeline v3.1): convergence check (delta < 3 points + no P0) suggests stopping revision loop. Budget transparency estimate at pipeline start.
- **README Positioning Update**: "Why human-in-the-loop, not full automation?" section citing Lu 2026 as external evidence for ARS's design thesis. Both EN and zh-TW updated.

### Changed
- `.claude/CLAUDE.md`: synced all skill versions and mode lists to reality (deep-research v2.7, academic-paper v2.9, academic-paper-reviewer v1.8, academic-pipeline v3.1)
- `quality_rubrics.md`: added "Known error profile" preamble explaining rubric scores are ordinally but not cardinally interpretable without calibration

**Version bumps**: academic-paper v2.9, academic-paper-reviewer v1.8, academic-pipeline v3.1

## [3.1.1] - 2026-04-09

### Added
- **Information Systems — Senior Scholars' Basket of 11** (extending the *Basket of 8* added in v2.9): *Decision Support Systems*, *Information & Management*, *Information and Organization* — completing the AIS College of Senior Scholars' official list of premier IS journals
- Section heading updated from "Information Systems (Basket of 8)" to "Information Systems (Senior Scholars' Basket of 11)" in `academic-paper-reviewer/references/top_journals_by_field.md`
- Original IS Basket of 8 proposed and drafted by [@mchesbro1](https://github.com/mchesbro1) — [Issue #5](https://github.com/Imbad0202/academic-research-skills/issues/5). Extended to Basket of 11 by [@cloudenochcsis](https://github.com/cloudenochcsis) — [Issue #7](https://github.com/Imbad0202/academic-research-skills/issues/7), [PR #8](https://github.com/Imbad0202/academic-research-skills/pull/8). Source: [AIS Senior Scholars' List of Premier Journals](https://aisnet.org/page/SeniorScholarListofPremierJournals)

## [2.9.1] - 2026-04-03

### Added
- `status` and `related_skills` metadata to all 4 SKILL.md frontmatters
  - Enables skill discovery tools and cross-skill navigation for users with multiple skills installed
  - `deep-research` ↔ `academic-paper` ↔ `academic-paper-reviewer` ↔ `academic-pipeline`

## [2.9] - 2026-03-27

### Added
- **Style Calibration** — learn the author's writing voice from past papers (optional, intake Step 10)
- **Writing Quality Check** — checklist catching overused AI-typical patterns (renamed from AI Writing Lint)
- Information Systems Basket of 8 journals added to academic-paper reference list
- Copilot philosophy tagline to README EN + zh-TW
- Substack guide articles to both READMEs

### Fixed
- Skill Details section version numbers and agent descriptions updated
- /simplify review — stale refs, lint sweep efficiency, schema fields
- Removed last v4.0 reference in CHANGELOG

## [2.8] - 2026-03-22

### Added
- **SCR Loop Phase 1** — State-Challenge-Reflect mechanism integrated into Socratic Mentor Agent
  - Commitment gates at layer/chapter transitions (collect user predictions before presenting evidence)
  - Certainty-triggered contradiction (probes high-confidence statements with counterpoints)
  - Adaptive intensity (tracks commitment accuracy, adjusts challenge frequency)
  - Self-calibration signal (S5) for convergence detection
  - SCR Switch — users can disable/re-enable predictions mid-dialogue
- `deep-research/agents/socratic_mentor_agent.md` — SCR Protocol section with commitment gates, divergence reveal, and adaptive intensity
- `deep-research/references/socratic_questioning_framework.md` — SCR Overlay Protocol mapping SCR phases to Socratic functions
- `academic-paper/agents/socratic_mentor_agent.md` — Chapter-level SCR Protocol with per-chapter commitment questions and cross-chapter pattern tracking

## [2.7.3] - 2026-03-10

### Fixed
- Version badge corrected in both EN and zh-TW READMEs

## [2.7.2] - 2026-03-10

### Added
- Version, license, and sponsor badges to README
- zh-TW README badges

## [2.7.1] - 2026-03-10

### Fixed
- Buy Me a Coffee username corrected

## [2.7] - 2026-03-09

### Added
- Integrity Verification v2.0: Anti-Hallucination Overhaul
- Full academic research skills suite (4 skills, 116 files)
- Deep Research v2.3 — 13-agent research team with 7 modes
- Academic Paper v2.4 — 12-agent paper writing with LaTeX hardening
- Academic Paper Reviewer v1.4 — Multi-perspective peer review with quality rubrics
- Academic Pipeline v2.6 — 10-stage orchestrator with integrity verification
