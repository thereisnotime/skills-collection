# Changelog

All notable changes to this project will be documented in this file.

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
