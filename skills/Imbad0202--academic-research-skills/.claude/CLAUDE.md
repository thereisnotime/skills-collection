# Academic Research Skills

A suite of Claude Code skills for rigorous academic research, paper writing, peer review, and pipeline orchestration.

## Skills Overview

| Skill | Purpose | Key Modes |
|-------|---------|-----------|
| `deep-research` v2.8.1 | 13-agent research team | full, quick, socratic, review, lit-review, fact-check, systematic-review |
| `academic-paper` v3.0.2 | 12-agent paper writing | full, plan, outline-only, revision, revision-coach, abstract-only, lit-review, format-convert, citation-check, disclosure |
| `academic-paper-reviewer` v1.8.1 | Multi-perspective paper review (5 reviewers + optional cross-model DA critique) | full, re-review, quick, methodology-focus, guided, calibration |
| `academic-pipeline` v3.2.2 | Full pipeline orchestrator | (coordinates all above) |

## v3.3 Key Additions

- **Semantic Scholar API Verification**: Tier 0 programmatic reference verification. See `deep-research/references/semantic_scholar_api_protocol.md`.
- **Anti-Leakage Protocol**: Knowledge isolation prioritizing session materials over LLM memory. See `academic-paper/references/anti_leakage_protocol.md`.
- **VLM Figure Verification**: Optional closed-loop figure verification via vision LLM. See `academic-paper/references/vlm_figure_verification.md`.
- **Score Trajectory Protocol**: Per-dimension rubric score delta tracking across revision rounds. See `academic-pipeline/references/score_trajectory_protocol.md`.
- **Stage 2 Parallelization**: Visualization and argument building can run in parallel after outline.

## v3.2 Key Additions

- **7-mode AI Research Failure Mode Checklist**: blocks pipeline at Stage 2.5/4.5 on suspected failures (Lu 2026). See `academic-pipeline/references/ai_research_failure_modes.md`.
- **Reviewer Calibration Mode**: opt-in FNR/FPR/balanced-accuracy measurement. See `academic-paper-reviewer/references/calibration_mode_protocol.md`.
- **Disclosure Mode**: venue-specific AI-usage statement (ICLR/NeurIPS/Nature/Science/ACL/EMNLP). See `academic-paper/references/disclosure_mode_protocol.md`.
- **Early-Stopping + Budget Transparency**: convergence check + token cost estimate at pipeline start.
- **Fidelity-Originality Mode Spectrum**: classifies all modes. See `shared/mode_spectrum.md`.

## v3.0 Key Additions

- **Anti-sycophancy protocols**: DA agents score rebuttals 1-5 before conceding. No concession below 4/5. Frame-lock detection.
- **Intent detection**: Socratic Mentor classifies user intent as exploratory vs. goal-oriented. Exploratory mode disables auto-convergence.
- **Cross-model verification** (optional): Set `ARS_CROSS_MODEL` env var to enable GPT-5.4 Pro or Gemini 3.1 Pro for integrity sample checks and independent Devil's Advocate critique. Peer-review sixth-reviewer support remains planned. See `shared/cross_model_verification.md`.
- **AI Self-Reflection Report**: Pipeline Stage 6 now includes AI behavioral self-assessment (concession rate, health alerts, sycophancy risk rating).

## Routing Rules

1. **academic-pipeline vs individual skills**: academic-pipeline = full pipeline orchestrator (research → write → integrity → review → revise → final integrity → finalize). If the user only needs a single function (just research, just write, just review), trigger the corresponding skill directly without the pipeline.

2. **deep-research vs academic-paper**: Complementary. deep-research = upstream research engine (investigation + fact-checking), academic-paper = downstream publication engine (paper writing + bilingual abstracts). Recommended flow: deep-research → academic-paper.

3. **deep-research socratic vs full**: socratic = guided Socratic dialogue to help users clarify their research question. full = direct production of research report. When the user's research question is unclear, suggest socratic mode.

4. **academic-paper plan vs full**: plan = chapter-by-chapter guided planning via Socratic dialogue. full = direct paper production. When the user wants to think through their paper structure, suggest plan mode.

5. **academic-paper-reviewer guided vs full**: guided = Socratic review that engages the author in dialogue about issues. full = standard multi-perspective review report. When the user wants to learn from the review, suggest guided mode.

## Key Rules

- All claims must have citations
- Evidence hierarchy respected (meta-analyses > RCTs > cohort > case reports > expert opinion)
- Contradictions disclosed with evidence quality comparison
- AI disclosure in all reports
- Default output language matches user input (Traditional Chinese or English)

## Full Academic Pipeline

```
deep-research (socratic/full)
  → academic-paper (plan/full)
    → integrity check (Stage 2.5)
      → academic-paper-reviewer (full/guided)
        → academic-paper (revision)
          → academic-paper-reviewer (re-review, max 2 loops)
            → final integrity check (Stage 4.5)
              → academic-paper (format-convert → final output)
                → Process Summary + AI Self-Reflection Report
```

## Handoff Protocol

### deep-research → academic-paper
Materials: RQ Brief, Methodology Blueprint, Annotated Bibliography, Synthesis Report, INSIGHT Collection

### academic-paper → academic-paper-reviewer
Materials: Complete paper text. field_analyst_agent auto-detects domain and configures reviewers.

### academic-paper-reviewer → academic-paper (revision)
Materials: Editorial Decision Letter, Revision Roadmap, Per-reviewer detailed comments

## Version Info
- **Suite version**: 3.3.6 (per CHANGELOG.md)
- **Last Updated**: 2026-04-15
- **Author**: Cheng-I Wu
- **License**: CC-BY-NC 4.0
