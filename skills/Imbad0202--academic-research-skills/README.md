# Academic Research Skills for Claude Code

[![Version](https://img.shields.io/badge/version-v3.3.2-blue)](https://github.com/Imbad0202/academic-research-skills/releases/tag/v3.3.2)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Sponsor](https://img.shields.io/badge/sponsor-Buy%20Me%20a%20Coffee-orange?logo=buy-me-a-coffee)](https://buymeacoffee.com/crucify020v)

[繁體中文版](README.zh-TW.md)

A comprehensive suite of Claude Code skills for academic research, covering the full pipeline from research to publication.

> **AI is your copilot, not the pilot.** This tool won't write your paper for you. It handles the grunt work — hunting down references, formatting citations, verifying data, checking logical consistency — so you can focus on the parts that actually require your brain: defining the question, choosing the method, interpreting what the data means, and writing the sentence after "I argue that."
>
> Unlike a humanizer, this tool doesn't help you hide the fact that you used AI. It helps you write better. Style Calibration learns your voice from past work. Writing Quality Check catches the patterns that make prose feel machine-generated. The goal is quality, not cheating.

### Why human-in-the-loop, not full automation?

Lu et al. (2026, *Nature* 651:914-919) built **The AI Scientist** — the first fully autonomous AI research system to publish a paper through blind peer review at a top-tier ML venue (ICLR 2025 workshop, score 6.33/10 vs workshop average 4.87). It is the strongest published benchmark of what end-to-end autonomous AI research can do as of 2026.

Their own Limitations section enumerates the failure modes that any fully-autonomous AI research pipeline inherits:
- Implementation bugs that pass AI self-review but poison the results
- Hallucinated experimental results that look plausible
- Shortcut reliance (models exploiting spurious features and writing papers about "solving" the task)
- Implementation bugs reframed as novel insights
- Methodology fabrication (Methods section drifting from what was actually run)
- Frame-lock at early stages (wrong hyperparameter direction the pipeline cannot back out of)
- Citation hallucinations

ARS is built on the premise that **a human researcher augmented by AI avoids these failure modes better than either alone**. v3.2 directly operationalizes the Lu 2026 failure-mode taxonomy: the pipeline's Stage 2.5 and Stage 4.5 integrity gates now run a 7-mode blocking checklist (see `academic-pipeline/references/ai_research_failure_modes.md`), and the reviewer offers an opt-in calibration mode that measures its own FNR/FPR against a user-supplied gold set (see `academic-paper-reviewer/references/calibration_mode_protocol.md`).

The AI Scientist shows that autonomous AI research is now possible. ARS is designed to give you the leverage of that capability without inheriting its failure modes.

v3.3 was inspired by [**PaperOrchestra**](https://arxiv.org/abs/2604.05018) (Song, Song, Pfister & Yoon, 2026, Google), a multi-agent framework that autonomously authors LaTeX manuscripts from raw research materials. We integrated several of their techniques: **Semantic Scholar API verification** for programmatic citation checking, an **anti-leakage protocol** that prevents the LLM from silently filling gaps with parametric memory, **VLM figure verification** for closed-loop visual quality checks, and **score trajectory tracking** that detects when revisions inadvertently degrade specific quality dimensions.

---

## Guides & Articles

- [Academic Writing Shouldn't Be a Solo Act](https://open.substack.com/pub/edwardwu223235/p/academic-writing-shouldnt-be-a-solo?r=4dczl&utm_medium=ios) — A detailed walkthrough of the full pipeline workflow (English)
- [學術寫作不該是一個人的事：一套開源 AI 協作工具如何改變研究者的工作流](https://open.substack.com/pub/edwardwu223235/p/ai?r=4dczl&utm_medium=ios) — 完整使用指南（繁體中文）

---

## Features

- **Deep Research** — 13-agent research team with Socratic guided mode + systematic review / PRISMA + SCR Loop + **intent detection** + **dialogue health monitoring** + **optional cross-model DA** + **argumentation & reasoning cognitive framework** + **Semantic Scholar API verification**
- **Academic Paper** — 12-agent paper writing with Style Calibration, Writing Quality Check, LaTeX output hardening, visualization, revision coaching, citation conversion, **writing judgment framework**, **anti-leakage protocol**, and **VLM figure verification**
- **Academic Paper Reviewer** — Multi-perspective peer review with 0-100 quality rubrics (EIC + 3 dynamic reviewers + Devil's Advocate with **concession threshold protocol** + **attack intensity preservation** + **optional cross-model DA critique / calibration**) + **R&R traceability matrix** + **read-only constraint** + **review quality thinking framework**
- **Academic Pipeline** — Full 10-stage pipeline orchestrator with adaptive checkpoints, claim verification, material passport, **optional cross-model integrity verification**, **mid-conversation reinforcement**, **self-check questions**, and **score trajectory tracking**
- **Data Access Level Metadata** (v3.3.2+) — Every skill declares a `data_access_level` (`raw`, `redacted`, or `verified_only`) so pipelines and CI can reason about isolation boundaries. Enforced by `scripts/check_data_access_level.py`. Pattern adapted from Anthropic's automated-w2s-researcher (2026).
- **Task Type Annotation** (v3.3.2+) — Every skill declares a `task_type` (`open-ended` or `outcome-gradable`). All current ARS skills are `open-ended`: a truth-in-advertising signal that ARS targets domain-judgment work, not benchmark tasks. Enforced by `scripts/check_task_type.py`.

### Skill posture (v3.3.2+)

Each SKILL.md declares `data_access_level` and `task_type` in its frontmatter. See [`shared/handoff_schemas.md`](shared/handoff_schemas.md) for the vocabulary and [`shared/ground_truth_isolation_pattern.md`](shared/ground_truth_isolation_pattern.md) for the rationale.

### Full Pipeline

```
Research → Write → Integrity Check → Review (5-person) → Socratic Coaching
  → Revise → Re-Review → Re-Revise → Final Integrity Check → Finalize
  → Process Summary (with Collaboration Quality Evaluation)
```

**Key Features:**
1. Adaptive checkpoints (FULL / SLIM / MANDATORY) after every stage
2. Pre-review integrity verification — 100% reference, data, and claim validation (Phase A-E)
3. Two-stage review with Devil's Advocate + 0-100 quality rubrics
4. Socratic revision coaching with SCR Loop (State-Challenge-Reflect, user-togglable) between review and revision stages
5. Final integrity verification before publication
6. Output: MD + DOCX + LaTeX (APA 7.0 `apa7` class / IEEE / Chicago) → PDF via tectonic
7. Post-pipeline process summary with 6-dimension collaboration quality scoring (1–100)
8. Material passport for mid-entry provenance tracking
9. Cross-skill mode advisor (14 scenarios + user archetypes)
10. Style Calibration — learn the author's writing voice from past papers (optional, intake Step 10)
11. Writing Quality Check — writing quality checklist catching overused AI-typical patterns
12. **Cross-model verification (optional)** — use GPT-5.4 Pro or Gemini 3.1 Pro for integrity sample checks and independent DA challenges; sixth-reviewer peer review remains planned, not yet implemented
13. **Semantic Scholar API verification** — programmatic Tier 0 reference existence check with Levenshtein title matching and DOI mismatch detection
14. **Anti-leakage protocol** — Knowledge Isolation Directive prioritizes session materials over LLM memory; flags `[MATERIAL GAP]` for missing content
15. **VLM figure verification (optional)** — closed-loop visual quality check using a vision-capable LLM with 10-point checklist
16. **Score trajectory tracking** — per-dimension rubric score delta tracking across revision rounds with regression detection

---

## Cross-Model Verification (Optional)

ARS works with Claude Opus 4.6 alone. For higher confidence, you can optionally enable a second AI model to independently verify integrity checks and challenge the devil's advocate.

### Quick Setup

```bash
# Step 1: Set your API key (choose one or both)
export OPENAI_API_KEY="sk-your-key-here"        # For GPT-5.4 Pro
export GOOGLE_AI_API_KEY="AIza-your-key-here"    # For Gemini 3.1 Pro

# Step 2: Choose your cross-verification model
export ARS_CROSS_MODEL="gpt-5.4-pro"            # Best reasoning
# or: export ARS_CROSS_MODEL="gemini-3.1-pro-preview"  # Strong at factual verification

# Step 3: Run Claude Code as normal — cross-verification activates automatically
claude
```

### What Changes When Enabled

| Feature | Without Cross-Model | With Cross-Model |
|---------|-------------------|------------------|
| Integrity verification | Single-model 100% check | + 30% sample independently verified by 2nd model |
| Devil's Advocate | Single-model DA | + Cross-model generates independent critique, novel findings added |
| Peer Review | 5 reviewers (same model) | Same 5 reviewers + cross-model DA critique/calibration support |

### Cost

Full pipeline adds ~$0.60-1.10 in cross-model API costs (GPT-5.4 Pro pricing). See `shared/cross_model_verification.md` for detailed breakdown.

### No API Key? No Problem

Without `ARS_CROSS_MODEL` set, everything works exactly as before. The cross-model features are invisible and add zero overhead.

---

## Showcase: Real Pipeline Output

See the complete artifacts from a real 10-stage pipeline run — including **peer review reports, integrity verification reports, and the final paper**:

**[Browse all pipeline artifacts →](examples/showcase/)**

| Artifact | Description |
|----------|-------------|
| [Final Paper (EN)](examples/showcase/full_paper_apa7.pdf) | APA 7.0 formatted, LaTeX-compiled |
| [Final Paper (ZH)](examples/showcase/full_paper_zh_apa7.pdf) | Chinese version, APA 7.0 |
| [Integrity Report — Pre-Review](examples/showcase/integrity_report_stage2.5.pdf) | Stage 2.5: caught 15 fabricated refs + 3 statistical errors |
| [Integrity Report — Final](examples/showcase/integrity_report_stage4.5.pdf) | Stage 4.5: zero regressions confirmed |
| [Peer Review Round 1](examples/showcase/stage3_review_report.pdf) | EIC + 3 Reviewers + Devil's Advocate |
| [Re-Review](examples/showcase/stage3prime_rereview_report.pdf) | Verification after revisions |
| [Peer Review Round 2](examples/showcase/stage3_review_report_r2.pdf) | Follow-up review |
| [Response to Reviewers](examples/showcase/response_to_reviewers_r2.pdf) | Point-by-point author response |
| [Post-Publication Audit Report](examples/showcase/post_publication_audit_2026-03-09.md) | Independent full-reference audit: found 21/68 issues missed by 3 rounds of integrity checks |

---

## Performance Notes

> **Recommended model: Claude Opus 4.6** with **Max plan** (or equivalent extended-thinking configuration).
>
> The full academic pipeline (10 stages) consumes a **large amount of tokens** — a single end-to-end run can exceed 200K input + 100K output tokens depending on paper length and revision rounds. Budget accordingly.
>
> Individual skills (e.g., `deep-research` alone, or `academic-paper-reviewer` alone) consume significantly less.

### Estimated Token Usage by Mode

| Skill / Mode | Input Tokens | Output Tokens | Estimated Cost (Opus 4.6) |
|-------------|-------------|--------------|--------------------------|
| `deep-research` socratic | ~30K | ~15K | ~$0.60 |
| `deep-research` full | ~60K | ~30K | ~$1.20 |
| `deep-research` systematic-review | ~100K | ~50K | ~$2.00 |
| `academic-paper` plan | ~40K | ~20K | ~$0.80 |
| `academic-paper` full | ~80K | ~50K | ~$1.80 |
| `academic-paper-reviewer` full | ~50K | ~30K | ~$1.10 |
| `academic-paper-reviewer` quick | ~15K | ~8K | ~$0.30 |
| **Full pipeline (10 stages)** | **~200K+** | **~100K+** | **~$4-6** |
| + Cross-model verification | +~10K (external) | +~5K (external) | +~$0.60-1.10 |

*Estimates based on a ~15,000-word paper with ~60 references. Actual usage varies with paper length, revision rounds, and dialogue depth. Costs at Anthropic API pricing as of April 2026.*

### Recommended Settings

For the best experience with these skills, enable the following Claude Code features:

| Setting | What it does | How to enable | Docs |
|---------|-------------|---------------|------|
| **Agent Team** | Spawns subagents for parallel research, writing, and review — critical for multi-agent pipelines | Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (research preview) | Experimental feature — no stable docs yet |
| **Ralph Loop** | Keeps the session alive during long-running pipeline stages so Claude can work autonomously without timing out | Use `/ralph-loop` to activate | Community plugin — experimental |
| **Skip Permissions** | Bypasses per-tool confirmation prompts, enabling uninterrupted autonomous execution across all pipeline stages | Launch with `claude --dangerously-skip-permissions` | [Permissions](https://docs.anthropic.com/en/docs/claude-code/cli-reference) · [Advanced Usage](https://docs.anthropic.com/en/docs/claude-code/advanced) |

> **⚠️ Skip Permissions**: This flag disables all tool-use confirmation dialogs. Use at your own discretion — it is convenient for trusted, long-running pipelines but removes the safety net of manual approval. Only enable this in environments where you are comfortable with Claude executing file reads, writes, and shell commands without asking first.

---

## Prerequisites

### Install Claude Code

**Recommended: Native installer** (no Node.js required, auto-updates):

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

<details>
<summary>Alternative: npm install (deprecated)</summary>

Requires Node.js 18+.

```bash
npm install -g @anthropic-ai/claude-code
```

</details>

### Set Up API Key

You need an Anthropic API key. Get one at https://console.anthropic.com/

```bash
# Claude Code will prompt for your API key on first run
claude
```

Or set it as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### LaTeX / PDF Output (Optional)

PDF output requires [tectonic](https://tectonic-typesetting.github.io/) and specific fonts. **This is optional** — MD and DOCX output work without any of this.

```bash
# macOS
brew install tectonic

# Linux (Debian/Ubuntu)
curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh

# Windows
# Download from https://tectonic-typesetting.github.io/en-US/install.html
```

**Required fonts** (for APA 7.0 CJK output):
- **Times New Roman** — usually pre-installed on macOS/Windows; on Linux install `ttf-mscorefonts-installer`
- **Source Han Serif TC VF** (思源宋體) — download from [Google Fonts](https://fonts.google.com/specimen/Noto+Serif+TC) or [Adobe GitHub](https://github.com/adobe-fonts/source-han-serif)
- **Courier New** — usually pre-installed

> If you only need MD/DOCX output, skip this entirely. The pipeline will ask before attempting LaTeX compilation.

---

## Companion: Experiment Agent

If your research involves running experiments (code or human studies) before writing, the [Experiment Agent](https://github.com/Imbad0202/experiment-agent) skill fills the gap between ARS Stage 1 (RESEARCH) and Stage 2 (WRITE).

```
ARS Stage 1 RESEARCH  →  RQ Brief + Methodology Blueprint
        ↓
  experiment-agent     →  run/manage experiments → validate results
        ↓
ARS Stage 2 WRITE     →  write paper with verified experiment results
```

**What it does**: executes code experiments (Python, R, etc.) with real-time monitoring, manages human study protocols with IRB ethics checklist, interprets statistics with 11-type fallacy detection, and verifies reproducibility.

**How to use together**: pause the ARS pipeline after Stage 1, run experiments in a separate experiment-agent session, then bring the results (with Material Passport) back to ARS Stage 2. ARS requires zero modification. See the [experiment-agent README](https://github.com/Imbad0202/experiment-agent) for setup instructions.

---

## Installation

### Method 1: As Project Skills (Recommended)

Clone this repo into your project's `.claude/skills/` directory:

```bash
# Navigate to your project root
cd /path/to/your/project

# Create skills directory if it doesn't exist
mkdir -p .claude/skills

# Clone the skills
git clone https://github.com/Imbad0202/academic-research-skills.git .claude/skills/academic-research-skills
```

Then copy the `.claude/CLAUDE.md` content into your project's `.claude/CLAUDE.md` (merge with existing if you have one).

> **Global installation:** To make skills available across all your projects, install to `~/.claude/skills/` instead:
> ```bash
> mkdir -p ~/.claude/skills
> git clone https://github.com/Imbad0202/academic-research-skills.git ~/.claude/skills/academic-research-skills
> ```

### Method 2: As a Standalone Project

```bash
# Clone the repo
git clone https://github.com/Imbad0202/academic-research-skills.git

# Navigate to the project
cd academic-research-skills

# Start Claude Code
claude
```

<details>
<summary><strong>Don't have Git?</strong> Download as ZIP instead</summary>

1. Go to https://github.com/Imbad0202/academic-research-skills
2. Click the green **Code** button → **Download ZIP**
3. Extract the ZIP to your desired location
4. For Method 1: move the extracted folder to `.claude/skills/academic-research-skills` inside your project
5. For standalone use: open a terminal in the extracted folder and run `claude`

</details>

### Method 3: Claude Cowork (Desktop)

Use these skills in [Claude Cowork](https://claude.com/product/cowork) — Claude Desktop's agentic workspace for knowledge work.

**Option A: Folder Access (Quickest)**

1. Clone this repo to a local folder:
   ```bash
   git clone https://github.com/Imbad0202/academic-research-skills.git ~/academic-research-skills
   ```
2. Open Claude Desktop → click **Cowork** tab (top bar)
3. Select the cloned `academic-research-skills` folder as the working directory
4. Claude will auto-detect the skills from `SKILL.md` files and load them as needed

**Option B: As Project Skills**

If you already have a project folder in Cowork:
```bash
cd /path/to/your/project
mkdir -p .claude/skills
git clone https://github.com/Imbad0202/academic-research-skills.git .claude/skills/academic-research-skills
```

Skills will auto-load when relevant to your conversation — e.g., saying "help me write a paper" triggers `academic-paper`.

**Requirements:**
- Claude Desktop (latest version) with Cowork enabled
- Paid plan (Pro, Max, Team, or Enterprise)

### Method 4: Use with claude.ai (Web)

You can use these skills on [claude.ai](https://claude.ai) via the **Project** feature with GitHub integration — no Claude Code installation needed.

**Steps:**

1. Sign in to [claude.ai](https://claude.ai) (requires a paid plan)

2. Create a new Project:
   - Click **Projects** → **Create Project** in the sidebar
   - Name it "Academic Research" (or any name you prefer)

3. Import from GitHub:
   - In the Project, click **Files** (right panel) → **+** → **GitHub**
   - Select `Imbad0202/academic-research-skills`
   - **Recommended selections** (to stay within capacity):

     | Select | Directory | Why |
     |--------|-----------|-----|
     | ✅ | `.claude/` | Routing rules |
     | ✅ | `deep-research/` | Core skill |
     | ✅ | `academic-paper/` | Core skill |
     | ✅ | `academic-paper-reviewer/` | Core skill |
     | ✅ | `academic-pipeline/` | Core skill |
     | ✅ | `shared/` | Cross-model verification, handoff schemas |
     | ✅ | `MODE_REGISTRY.md` | Mode definitions |
     | ❌ | `examples/` | Takes ~39% capacity — skip unless you have room |
     | ❌ | `.github/`, READMEs, LICENSE, etc. | Not needed for functionality |

4. (Optional) Set **Instructions** in the Project to the content of `.claude/CLAUDE.md` for better routing

5. Start chatting: "Guide my research on X" or "Help me write a paper about Y"

**claude.ai vs Claude Code:**
- claude.ai does not support parallel multi-agent execution or shell commands; results may be less comprehensive than Claude Code
- Cross-model verification (`ARS_CROSS_MODEL`) requires Claude Code with API keys
- LaTeX/PDF output requires Claude Code with `tectonic` installed; claude.ai can produce Markdown and DOCX

---

## Usage

### Quick Start

```
# Start a full research pipeline
You: "I want to write a research paper on AI's impact on higher education QA"

# Start with Socratic guidance
You: "Guide my research on AI in educational evaluation"

# Write a paper with guided planning
You: "Guide me through writing a paper on demographic decline"

# Review an existing paper
You: "Review this paper" (then provide the paper)

# Check pipeline status
You: "status"
```

### Individual Skills

#### Deep Research (7 modes)
```
"Research the impact of AI on higher education"       → full mode
"Give me a quick brief on X"                          → quick mode
"Do a systematic review on X with PRISMA"             → systematic-review mode (new)
"Guide my research on X"                              → socratic mode (guided)
"Fact-check these claims"                             → fact-check mode
"Do a literature review on X"                         → lit-review mode
"Review this paper's research quality"                → review mode
```

#### Academic Paper (10 modes)
```
"Write a paper on X"                                  → full mode
"Guide me through writing a paper"                    → plan mode (guided)
"Build a paper outline"                               → outline-only mode
"I have a draft, here are reviewer comments"          → revision mode
"Parse these reviewer comments into a roadmap"        → revision-coach mode (new)
"Write an abstract for this paper"                    → abstract-only mode
"Turn this into a literature review paper"            → lit-review mode
"Convert to LaTeX" / "Convert citations to IEEE"      → format-convert mode
"Check citations"                                     → citation-check mode
"Generate an AI disclosure statement for NeurIPS"     → disclosure mode
```

#### Academic Paper Reviewer (6 modes)
```
"Review this paper"                                   → full mode (EIC + R1/R2/R3 + Devil's Advocate)
"Quick assessment of this paper"                      → quick mode
"Guide me to improve this paper"                      → guided mode
"Check the methodology"                               → methodology-focus mode
"Verify the revisions"                                → re-review mode
"Calibrate this reviewer against my gold set"         → calibration mode
```

#### Academic Pipeline (Orchestrator)
```
"I want to write a complete research paper"           → full pipeline from Stage 1
"I already have a paper, review it"                   → mid-entry at Stage 2.5 (integrity first)
"I received reviewer comments"                        → mid-entry at Stage 4
```
> Pipeline ends with **Stage 6: Process Summary** — auto-generates a paper creation process record with 6-dimension Collaboration Quality Evaluation (1–100 scoring).

### Supported Languages

- **Traditional Chinese** (繁體中文) — default when user writes in Chinese
- **English** — default when user writes in English
- Bilingual abstracts (Chinese + English) for academic papers

> **Using a different language?** Socratic mode (deep-research) and Plan mode (academic-paper) use **intent-based activation** — they detect the meaning of your request, not specific keywords. This means they work in **any language** without modification.
>
> However, the general `Trigger Keywords` section (which determines whether the skill is activated at all) still lists English and Traditional Chinese keywords. If you find the skill isn't activating reliably in your language, you can add your language's keywords to the `### Trigger Keywords` section in each `SKILL.md` file to improve matching confidence.

### Supported Citation Formats

- APA 7.0 (default, including Chinese citation rules)
- Chicago (Notes & Author-Date)
- MLA
- IEEE
- Vancouver

### Supported Paper Structures

- IMRaD (empirical research)
- Thematic Literature Review
- Theoretical Analysis
- Case Study
- Policy Brief
- Conference Paper

---

## Skill Details

### Deep Research (v2.8)

13-agent pipeline for rigorous academic research:

| Agent | Role |
|-------|------|
| Research Question Agent | FINER-scored RQ formulation |
| Research Architect | Methodology design |
| Bibliography Agent | Systematic literature search |
| Source Verification Agent | Evidence grading, predatory journal detection |
| Synthesis Agent | Cross-source integration |
| Report Compiler | APA 7.0 report drafting + optional Style Profile + Writing Quality Check |
| Editor-in-Chief | Q1 journal editorial review |
| Devil's Advocate | Assumption challenging (3 checkpoints) |
| Ethics Review Agent | AI disclosure, attribution integrity |
| Socratic Mentor | Guided research dialogue with convergence criteria + SCR reflection (togglable) |
| Risk of Bias Agent | RoB 2 + ROBINS-I assessment, traffic-light output |
| Meta-Analysis Agent | Effect sizes, heterogeneity, forest plot data, GRADE |
| Monitoring Agent | Post-pipeline literature monitoring alerts |

**Modes:** full, quick, review, lit-review, fact-check, socratic, **systematic-review** (new)

### Academic Paper (v3.0)

12-agent pipeline for academic paper writing:

| Agent | Role |
|-------|------|
| Intake Agent | Configuration interview + handoff detection + Style Calibration (optional) |
| Literature Strategist | Search strategy + annotated bibliography |
| Structure Architect | Paper outline + word allocation |
| Argument Builder | Thesis + claim-evidence chains |
| Draft Writer | Section-by-section writing + Writing Quality Check sweep + Style Profile application |
| Citation Compliance | Multi-format citation audit + APA↔Chicago↔MLA↔IEEE↔Vancouver conversion |
| Abstract Bilingual | EN + Chinese abstracts |
| Peer Reviewer | 5-dimension review (max 2 rounds) |
| Formatter | LaTeX/DOCX/PDF output — mandatory `apa7` class, XeCJK bilingual, `ragged2e` justification fix, tectonic compilation |
| Socratic Mentor | Chapter-by-chapter guided planning with convergence criteria + SCR reflection (togglable) |
| Visualization Agent | 9 chart types, matplotlib/ggplot2, APA 7.0 standards |
| Revision Coach Agent | Parses unstructured reviewer comments → Revision Roadmap |

**Modes:** full, plan, outline-only, revision, revision-coach, abstract-only, lit-review, format-convert, citation-check, **disclosure**

### Academic Paper Reviewer (v1.8)

7-agent multi-perspective review with **0-100 quality rubrics**:

| Agent | Role |
|-------|------|
| Field Analyst | Identifies domain, configures reviewer personas |
| Editor-in-Chief | Journal fit, novelty, significance |
| Methodology Reviewer | Research design, statistics, reproducibility |
| Domain Reviewer | Literature coverage, theoretical framework |
| Perspective Reviewer | Cross-disciplinary, practical impact |
| Devil's Advocate Reviewer | Core thesis challenge, logical fallacy detection, strongest counter-argument |
| Editorial Synthesizer | Consensus analysis, revision roadmap, **rubric-based scoring** |

**Modes:** full, re-review (verification), quick, methodology-focus, guided, **calibration**

**Decision mapping:** ≥80 Accept, 65-79 Minor Revision, 50-64 Major Revision, <50 Reject

### Academic Pipeline (v3.2)

10-stage orchestrator with integrity verification, two-stage review, Socratic coaching, and collaboration evaluation:

| Stage | Skill | Purpose |
|-------|-------|---------|
| 1. RESEARCH | deep-research | Clarify RQ, find literature |
| 2. WRITE | academic-paper | Draft the paper |
| **2.5. INTEGRITY** | **integrity_verification_agent** | **100% reference & data verification (v2.0: anti-hallucination mandate)** |
| 3. REVIEW | academic-paper-reviewer | 5-person review (EIC + R1/R2/R3 + Devil's Advocate) |
| → | *Socratic Revision Coaching* | *Guide user through review feedback* |
| 4. REVISE | academic-paper | Address review comments |
| 3'. RE-REVIEW | academic-paper-reviewer | Verification review of revisions |
| → | *Socratic Residual Coaching* | *Guide user through remaining issues (if Major)* |
| 4'. RE-REVISE | academic-paper | Final revision (if needed) |
| **4.5. FINAL INTEGRITY** | **integrity_verification_agent** | **100% final verification (zero issues required)** |
| 5. FINALIZE | academic-paper | Ask format style → MD + DOCX + LaTeX → tectonic → PDF |
| **6. PROCESS SUMMARY** | **pipeline** | **Paper creation process record + Collaboration Quality Evaluation (1–100)** |

**Pipeline guarantees:**
- Every stage requires user confirmation checkpoint
- Integrity verification (Stage 2.5 + 4.5) cannot be skipped
- Reproducible — standardized process with full audit trail
- Post-pipeline collaboration evaluation with honest, evidence-based scoring
- Mid-conversation reinforcement at every stage transition (IRON RULE + Anti-Pattern reminders)
- R&R Traceability Matrix (Schema 11) independently verifies author revision claims

---

## v3.0 Optimizations: What We Discovered About AI's Structural Limits

### What happened

While using ARS to write a reflection article about AI in higher education, I ran into three structural problems that no amount of prompt engineering could fix:

1. **Frame-lock**: I asked the AI to run a devil's advocate debate against its own thesis. It did — four rounds, each more refined than the last. But every round stayed inside the frame I'd set. The DA attacked arguments, never premises. It never asked "are we even discussing the right question?" This is the same pattern that caused the 31% citation error rate in v2.7's stress test: the verifying AI and the generating AI share the same cognitive frame.

2. **Sycophancy under pushback**: Every time I challenged the DA's attacks, it conceded too quickly. It retracted findings faster than it launched them. The model's training rewards conversational harmony — so "the user pushed back" was treated as evidence that the attack was wrong, when often it just meant the user was persistent.

3. **Intent misdetection**: The Socratic Mentor kept trying to converge and produce deliverables ("Want me to write this up?") when I was still exploring. It couldn't distinguish "the user wants a deep philosophical discussion" from "the user wants an RQ brief." Both look like engagement, but they need opposite AI behaviors.

### What we changed (v3.0)

**Devil's Advocate — Concession Threshold Protocol** (`deep-research` + `academic-paper-reviewer`)
- DA must now score every rebuttal on a 1-5 scale before responding
- Concession only allowed at score ≥4 (rebuttal directly addresses core attack with evidence)
- Score ≤3: hold position and restate the original attack
- Anti-sycophancy rules: no consecutive concessions, concession rate tracking, frame-lock detection after each checkpoint

**Socratic Mentor — Intent Detection Layer** (`deep-research`)
- Classifies user intent as exploratory vs. goal-oriented at dialogue start and every 3 turns
- Exploratory mode: disables auto-convergence, raises max rounds to 60, prohibits "want me to summarize?" prompts
- Goal-oriented mode: standard convergence behavior
- Anti-premature-closure rules: in exploratory mode, the user decides when to stop

**Socratic Mentor — Dialogue Health Indicator** (`deep-research`)
- Silent self-assessment every 5 turns on three dimensions: persistent agreement, conflict avoidance, premature convergence
- Auto-injects challenging questions when agreement pattern detected
- Invisible to user (to prevent gaming), but log available for post-session review

### Why this matters

These optimizations don't solve AI's structural limits — they make the limits visible and manageable. The DA will still eventually concede if pushed hard enough. The Socratic Mentor will still have some convergence bias. But now there are explicit checkpoints that slow down the sycophancy, force the DA to justify concessions, and prevent the Mentor from wrapping up before the user is ready.

The deeper lesson: AI literacy isn't about learning to use AI as a tool, following ethics rules, or fearing AI risks. It's about engaging AI deeply enough to discover its structural limits yourself — and your own thinking limits in the process.

---

## License

This work is licensed under [CC-BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

**You are free to:**
- Share — copy and redistribute the material
- Adapt — remix, transform, and build upon the material

**Under the following terms:**
- **Attribution** — You must give appropriate credit
- **NonCommercial** — You may not use the material for commercial purposes

**Attribution format:**
```
Based on Academic Research Skills by Cheng-I Wu
https://github.com/Imbad0202/academic-research-skills
```

---

## Contributors

**Cheng-I Wu** (吳政宜) — Author and maintainer

**[aspi6246](https://github.com/aspi6246)** — Contributor. The v3.1 optimization was inspired by patterns from [Claude-Code-Skills-for-Academics](https://github.com/aspi6246/Claude-Code-Skills-for-Academics): read-only constraint pattern, anti-pattern codification as first-class design, cognitive framework approach (teaching "how to think" not just procedures), and lean skill size philosophy.

**[mchesbro1](https://github.com/mchesbro1)** — Contributor. Originally proposed and drafted the IS Basket of 8 journals for `academic-paper-reviewer/references/top_journals_by_field.md` ([Issue #5](https://github.com/Imbad0202/academic-research-skills/issues/5)).

**[cloudenochcsis](https://github.com/cloudenochcsis)** — Contributor. Extended the IS section from the *Basket of 8* to the full *Senior Scholars' Basket of 11* — adding *Decision Support Systems*, *Information & Management*, and *Information and Organization* ([Issue #7](https://github.com/Imbad0202/academic-research-skills/issues/7), [PR #8](https://github.com/Imbad0202/academic-research-skills/pull/8)). Sourced from the [AIS Senior Scholars' List of Premier Journals](https://aisnet.org/page/SeniorScholarListofPremierJournals).

---

## Changelog

### v3.3.1 (2026-04-14) — Spec Consistency Patch

- Synced README, `.claude/CLAUDE.md`, `MODE_REGISTRY.md`, and `SKILL.md` files to the current mode counts and published skill versions.
- Corrected cross-model wording: integrity sample checks and independent DA critique are implemented today; sixth-reviewer peer review remains planned.
- Clarified adaptive checkpoint semantics so SLIM checkpoints still wait for explicit user confirmation.
- Reaffirmed that Stage 2.5 and Stage 4.5 integrity gates cannot be skipped.
- Added a lightweight spec consistency check and GitHub Actions workflow to catch future drift.

### v3.3 (2026-04-09) — PaperOrchestra-Inspired Enhancements

Integrates techniques from [PaperOrchestra](https://arxiv.org/abs/2604.05018) (Song, Song, Pfister & Yoon, 2026, Google).

- **Semantic Scholar API Verification** — Tier 0 programmatic reference existence check via S2 API. Levenshtein >= 0.70 title matching, DOI mismatch detection, bibliography deduplication via S2 IDs. Graceful degradation if API unavailable.
- **Anti-Leakage Protocol** — Knowledge Isolation Directive prioritizes session materials over LLM parametric memory. Flags `[MATERIAL GAP]` for missing content instead of filling from memory. Reduces Mode 5/6 failure risk.
- **VLM Figure Verification** (optional) — Closed-loop verification of rendered figures using vision-capable LLM. 10-point checklist, max 2 refinement iterations.
- **Score Trajectory Protocol** — Per-dimension rubric score delta tracking across revision rounds (7 dimensions). Detects regressions (delta < -3) and triggers mandatory checkpoint.
- **Stage 2 Parallelization** — Visualization and argument building can run in parallel after outline completion.
- New versions: deep-research v2.8, academic-paper v3.0, academic-pipeline v3.2

### v3.2 (2026-04-09) — Lu 2026 Nature Integration

Integrates insights from Lu et al. (2026, *Nature* 651:914-919) — the first end-to-end autonomous AI research system to pass blind peer review.

- **7-mode AI Research Failure Mode Checklist** — blocks pipeline at Stage 2.5/4.5 on suspected implementation bugs, hallucinated results, shortcut reliance, bug-as-insight, methodology fabrication, frame-lock. Extends existing 5-type citation hallucination taxonomy.
- **Reviewer Calibration Mode** (academic-paper-reviewer v1.8) — opt-in FNR/FPR/balanced-accuracy measurement against user-supplied gold set. 5× ensembling, cross-model default-on, session-scoped confidence disclosure.
- **Disclosure Mode** (academic-paper v2.9) — venue-specific AI-usage statement generator. v1 covers ICLR, NeurIPS, Nature, Science, ACL, EMNLP.
- **Early-Stopping Criterion** (academic-pipeline v3.1) — convergence check + budget transparency at pipeline start.
- **Fidelity-Originality Mode Spectrum** — classifies all modes across 3 skills per Lu 2026 Fig 1c.
- New versions: academic-paper v2.9, academic-paper-reviewer v1.8, academic-pipeline v3.1

### v3.1.1 (2026-04-09) — IS Senior Scholars' Basket of 11

External contributions: [@mchesbro1](https://github.com/mchesbro1) originally proposed and drafted the IS Basket of 8 journals ([Issue #5](https://github.com/Imbad0202/academic-research-skills/issues/5)); [@cloudenochcsis](https://github.com/cloudenochcsis) extended it to the full Senior Scholars' Basket of 11 ([Issue #7](https://github.com/Imbad0202/academic-research-skills/issues/7), [PR #8](https://github.com/Imbad0202/academic-research-skills/pull/8)). Updated `academic-paper-reviewer/references/top_journals_by_field.md` Section 7, adding *Decision Support Systems*, *Information & Management*, and *Information and Organization*. Source: [AIS Senior Scholars' List of Premier Journals](https://aisnet.org/page/SeniorScholarListofPremierJournals).

### v3.1 (2026-04-06) — Anti-Context-Rot + Cognitive Frameworks + Lean Size

Inspired by patterns from [aspi6246/Claude-Code-Skills-for-Academics](https://github.com/aspi6246/Claude-Code-Skills-for-Academics).

**Wave 1: Anti-Context-Rot Anchors**
- 29 explicit Anti-Patterns across all 4 skills (7-8 per skill, tabular format with "Why It Fails" + "Correct Behavior")
- 22 IRON RULE markers on critical rules that must not be violated even in long conversations
- Read-only constraint on academic-paper-reviewer (reviewers cannot modify the manuscript)

**Wave 2: Traceability + Cognitive Frameworks + Reinforcement**
- R&R Traceability Matrix (Schema 11): adds "Author's Claim" and "Verified?" columns to re-review output, enabling independent verification of revision claims
- 3 cognitive framework reference files teaching agents "how to think" not just "what to do":
  - `argumentation_reasoning_framework.md` — Toulmin model, Bradford Hill causal reasoning, inference to best explanation, epistemic status classification
  - `review_quality_thinking.md` — three lenses (internal validity, external validity, contribution), common reviewer traps, calibration questions
  - `writing_judgment_framework.md` — clarity test, reader's journey, discipline-specific voice, revision decision matrix
- Mid-conversation reinforcement protocol: stage-specific IRON RULE + Anti-Pattern reminders at every pipeline transition
- Self-check questions at every FULL checkpoint (citation integrity, sycophantic concession, quality trajectory, scope discipline, completeness)

**Wave 3: Lean Skill Size**
- SKILL.md total size reduced from 142KB to 85KB (−40%) by extracting detailed protocols to `references/` files
- ~15 new reference files created (re-review protocol, guided mode, systematic review, process summary, external review, etc.)
- All IRON RULE markers preserved in SKILL.md; detailed content loaded on demand
- New versions: deep-research v2.7, academic-paper v2.8, academic-paper-reviewer v1.7, academic-pipeline v3.0

### v3.0 (2026-04-03) — Anti-Sycophancy + Intent Detection + Dialogue Health
- **Devil's Advocate Concession Threshold** (deep-research + academic-paper-reviewer): DA must score rebuttals 1-5 before responding. Concession only at ≥4. No consecutive concessions. Concession rate tracking. Frame-lock detection after each checkpoint.
- **Attack Intensity Preservation** (academic-paper-reviewer): DA does not soften under pushback. Rebuttal assessment protocol with explicit deflection detection. Anti-sycophancy rules prevent persistent pushback from being treated as valid evidence.
- **Intent Detection Layer** (deep-research socratic): Classifies user intent as exploratory vs. goal-oriented. Exploratory mode disables auto-convergence, raises max rounds, prohibits premature closure. Re-assesses every 3 turns.
- **Dialogue Health Indicator** (deep-research socratic): Silent self-check every 5 turns for persistent agreement, conflict avoidance, premature convergence. Auto-injects challenges when agreement pattern detected.
- **Cross-Model Verification Protocol** (shared, optional): Use GPT-5.4 Pro or Gemini 3.1 Pro for integrity verification sample cross-checks and independent DA critique. Sixth-reviewer peer review remains planned, not yet implemented. Activated by setting `ARS_CROSS_MODEL` env var — without it, everything works as before. See `shared/cross_model_verification.md` for full setup guide, API patterns, and cost estimates.
- **AI Self-Reflection Report** (academic-pipeline Stage 6): Post-pipeline self-assessment of AI behavioral patterns — DA concession rate, checkpoint skip rate, health alerts, sycophancy risk rating (LOW/MEDIUM/HIGH), frame-lock incidents, convergence pattern analysis. Includes irony caveat: "this self-reflection is itself produced by the same AI that may have been sycophantic."
- Origin: Discovered through a 4-round dialectic experiment where the DA conceded too quickly, the Socratic Mentor tried to converge prematurely, and the entire debate stayed locked in a frame the human set.
- Versions: deep-research v2.5, academic-paper-reviewer v1.5, academic-pipeline v2.8

### v2.9 (2026-03-27) — Style Calibration + Writing Quality Check
- **Style Calibration** (academic-paper intake Step 10, optional): Provide 3+ past papers and the pipeline learns your writing voice — sentence rhythm, vocabulary preferences, citation integration style. Applied as a soft guide during drafting; discipline conventions always take priority. Priority system: discipline norms (hard) > journal conventions (strong) > personal style (soft). See `shared/style_calibration_protocol.md`
- **Writing Quality Check** (`academic-paper/references/writing_quality_check.md`): Writing quality checklist applied during draft self-review. 5 categories: AI high-frequency term warnings (25 terms), punctuation pattern control (em dash ≤3), throat-clearing opener detection, structural pattern warnings (Rule of Three, uniform paragraphs, synonym cycling), and burstiness checks (sentence length variation). These are good writing rules — not detection evasion
- **Style Profile** carried through academic-pipeline Material Passport (Schema 10 in `shared/handoff_schemas.md`)
- **deep-research** report compiler also consumes both features optionally
- Versions: academic-paper v2.5, deep-research v2.4, academic-pipeline v2.7

### v2.8 (2026-03-22) — SCR Loop Phase 1: State-Challenge-Reflect
- **Socratic Mentor Agent** (deep-research + academic-paper): SCR (State-Challenge-Reflect) protocol integration
  - **Commitment Gates**: Collect user predictions before presenting evidence at each layer/chapter transition
  - **Certainty-Triggered Contradiction**: Detect high-confidence language ("obviously", "clearly") and introduce counterpoints
  - **Adaptive Intensity**: Track commitment accuracy, dynamically adjust challenge frequency
  - **Self-Calibration Signal (S5)**: New convergence signal tracking user's self-calibration growth across dialogue
  - **SCR Switch**: Users can say "skip the predictions" to disable or "turn predictions back on" to re-enable mid-dialogue; Socratic questioning continues normally
- `deep-research/references/socratic_questioning_framework.md`: SCR Overlay Protocol mapping SCR phases to Socratic functions
- Added `CHANGELOG.md`

### v2.7 (2026-03-09) — Integrity Verification v2.0: Anti-Hallucination Overhaul
- **integrity_verification_agent v2.0**: Anti-Hallucination Mandate (no AI memory verification), eliminated gray-zone classifications (VERIFIED/NOT_FOUND/MISMATCH only), mandatory WebSearch audit trail for every reference, Stage 4.5 fresh independent verification, Gray-Zone Prevention Rule
- **Known Hallucination Patterns**: 5-type taxonomy (TF/PAC/IH/PH/SH) from GPTZero × NeurIPS 2025 study, 5 compound deception patterns, real-world case study, literature statistics
- **Post-publication audit**: Full WebSearch verification of all 68 references found 21 issues (31% error rate) that passed 3 rounds of integrity checks — proving the necessity of external verification
- **Paper corrections**: Removed 4 fabricated references, fixed 6 author errors, corrected 7 metadata errors, fixed 2 format issues

### v2.6.2 (2026-03-09) — Intent-Based Mode Activation
- **deep-research**: Socratic mode now uses **intent-based activation** instead of keyword matching. Works in any language — detects meaning (e.g., "user wants guided thinking") rather than matching specific strings.
- **academic-paper**: Plan mode now uses **intent-based activation**. Detects intent signals like "user is uncertain how to start" or "user wants step-by-step guidance" in any language.
- Both modes now have a **default rule**: when intent is ambiguous, prefer `socratic`/`plan` over `full` — safer to guide first.
- Two-layer architecture: Layer 1 (skill activation) uses bilingual keywords for matching confidence; Layer 2 (mode routing) uses language-agnostic intent signals.

### v2.6.1 (2026-03-09) — Bilingual Trigger Keywords
- **deep-research**: Added Traditional Chinese trigger keywords for general activation and Socratic mode.
- **academic-paper**: Added Traditional Chinese trigger keywords and Plan Mode trigger section.
- Both mode selection guides now include bilingual examples and Chinese-specific misselection scenarios.

### v2.6 / v2.4 / v1.4 (2026-03-08) — 15+ Improvements
- **deep-research v2.3**: New systematic-review / PRISMA mode (7th); 3 new agents (risk_of_bias, meta_analysis, monitoring); PRISMA protocol/report templates; Socratic convergence criteria (4 signals + auto-end); Quick Mode Selection Guide
- **academic-paper v2.4**: 2 new agents (visualization, revision_coach); revision tracking template with 4 status types; citation format conversion (APA↔Chicago↔MLA↔IEEE↔Vancouver); statistical visualization standards; Socratic convergence criteria; revision recovery example; **LaTeX output hardening** — mandatory `apa7` document class, text justification fix (`ragged2e` + `etoolbox`), table column width formula, bilingual abstract centering, standardized font stack (Times New Roman + Source Han Serif TC VF + Courier New), PDF via tectonic only
- **academic-paper-reviewer v1.4**: Quality rubrics with 0-100 scoring and behavioral indicators; decision mapping (≥80 Accept, 65-79 Minor, 50-64 Major, <50 Reject); Quick Mode Selection Guide
- **academic-pipeline v2.6**: Adaptive checkpoint system (FULL/SLIM/MANDATORY); Phase E Claim Verification in integrity checks; Material Passport for mid-entry provenance; cross-skill mode advisor (14 scenarios); team collaboration protocol; enhanced handoff schemas (9 schemas); integrity failure recovery example

### v2.4 / v1.3 (2026-03-08)
- **academic-pipeline v2.4**: New Stage 6 PROCESS SUMMARY — auto-generates structured paper creation process record (MD → LaTeX → PDF, bilingual); mandatory final chapter: **Collaboration Quality Evaluation** with 6 dimensions scored 1–100 (Direction Setting, Intellectual Contribution, Quality Gatekeeping, Iteration Discipline, Delegation Efficiency, Meta-Learning), honest feedback, and improvement recommendations; pipeline expanded from 9 to 10 stages

### v2.3 / v1.3 (2026-03-08)
- **academic-pipeline v2.3**: Stage 5 FINALIZE now prompts for formatting style (APA 7.0 / Chicago / IEEE); PDF must compile from LaTeX via `tectonic` (no HTML-to-PDF); APA 7.0 uses `apa7` document class (`man` mode) with XeCJK for bilingual CJK support; font stack: Times New Roman + Source Han Serif TC VF + Courier New

### v2.2 / v1.3 (2025-03-05)
- **Cross-Agent Quality Alignment**: unified definitions (peer-reviewed, currency rule, CRITICAL severity, source tier) across all agents
- **deep-research v2.2**: synthesis anti-patterns, Socratic auto-end conditions, DOI+WebSearch verification, enhanced ethics integrity check, mode transition matrix
- **academic-paper v2.2**: 4-level argument scoring, plagiarism screening, 2 new failure paths (F11 Desk-Reject Recovery, F12 Conference-to-Journal), Plan→Full mode conversion
- **academic-paper-reviewer v1.3**: DA vs R3 role boundaries, CRITICAL finding criteria, consensus classification (4/3/SPLIT/DA-CRITICAL), confidence score weighting, Asian & Regional Journals reference
- **academic-pipeline v2.2**: checkpoint confirmation semantics, mode switching matrix, failure fallback matrix, state ownership protocol, material version control

### v2.0.1 (2026-03)
- **Simplify 4 SKILL.md** (-371 lines, -16.5%): remove cross-skill duplication, inline templates → file references, redundant routing tables, duplicate mode selection sections
- Fix revision loop cap contradiction between academic-paper and academic-pipeline

### v2.0 (2026-02)
- **academic-pipeline v2.0**: 5→9 stages, mandatory integrity verification, two-stage review, Socratic revision coaching, reproducibility guarantees
- **academic-paper-reviewer v1.1**: +Devil's Advocate Reviewer (7th agent), +re-review mode (verification), +post-review Socratic coaching
- New agent: `integrity_verification_agent` — 100% reference/data verification with audit trail
- New agent: `devils_advocate_reviewer_agent` — 8-dimension thesis challenger
- Output order: MD + DOCX → ask LaTeX → confirm → PDF

### v1.0 (2026-02)
- Initial release
- deep-research v2.0 (10 agents, 6 modes including socratic)
- academic-paper v2.0 (10 agents, 8 modes including plan)
- academic-paper-reviewer v1.0 (6 agents, 4 modes including guided)
- academic-pipeline v1.0 (orchestrator)
