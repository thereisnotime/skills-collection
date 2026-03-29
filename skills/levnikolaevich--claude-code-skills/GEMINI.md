# GEMINI.md

> **SCOPE:** Entry point with rules and navigation ONLY. Detailed guides in `docs/`. Skill workflows in individual `SKILL.md` files. Public documentation in `README.md`.

Skills collection for Gemini CLI with config-driven Agile task management (Linear or File Mode).

## Critical Rules

**Read this table BEFORE starting any work.**

| Rule | When to Apply | Details |
|------|---------------|---------|
| **Read Architecture Guide first** | Before working with skills | `cat docs/architecture/SKILL_ARCHITECTURE_GUIDE.md` — L0-L3 hierarchy, SRP, Token Efficiency, Red Flags |
| **MANDATORY READ pattern** | File references in SKILL.md | Use `**MANDATORY READ:** Load {file}`. Passive refs (`See`, `Per`, `Follows`) are NOT followed by agents. Group multiple into ONE block at section start |
| **Path Resolution** | File paths in SKILL.md | Relative to skills repo root, NOT target project. Every SKILL.md with file refs includes `> **Paths:**` note after frontmatter |
| **Sequential Numbering** | Phases/Sections/Steps | 1, 2, 3, 4 (NOT 1, 1.5, 2). Exception: 4a (CREATE), 4b (REPLAN) |
| **Docs in English** | All documentation | Stories/Tasks can be EN/RU regardless of provider |
| **No version auto-updates** | After any changes | Update versions ONLY when user explicitly requests. Default: change files, do NOT touch versions |
| **YAML description quoting** | SKILL.md frontmatter | If `description:` contains `:`, wrap in double quotes |
| **Research-to-Action Gate** | Before turning research into changes | "What specific defect in current skill output does this fix?" No defect = informational, not actionable |
| **No hardcoded counts** | Documentation files | Counts ONLY in README.md badge (`skills-NNN`). Everywhere else: no aggregate counts |
| **No Changes sections** | SKILL.md versioning | `**Version:** X.Y.Z` + `**Last Updated:** YYYY-MM-DD` at end. Git history tracks changes |
| **DoD with checkboxes** | All SKILL.md files | `## Definition of Done` section with `- [ ]` items |
| **Worker independence** | L3 Worker SKILL.md | No `**Parent:**`, no coordinator names, no peer cross-references. Workers are standalone-invocable |

## MCP Tool Preferences

**PREFER** hex-line MCP for code files — hash-annotated reads enable safe edits:

| Instead of | Use | When |
|-----------|-----|------|
| Built-in Read | `hex-line read_file` | Code files (hash-annotated, edit-ready) |
| Built-in Edit | `hex-line edit_file` | Always (hash-verified anchors) |
| Built-in Write | `hex-line write_file` | Always (consistent workflow) |
| Built-in Grep | `hex-line grep_search` | Before editing found code (grep→edit pipeline) |
| Large code file | `hex-line outline` then `read_file` with range | Unfamiliar files >100 lines |

**Built-in OK for:** images, PDFs, notebooks, Glob (always), `.claude/settings.json` and `.claude/settings.local.json`.

## Quick Understanding

| What | How |
|------|-----|
| Project overview + full tree | `cat README.md` |
| Skill count | `ls -d ln-*/SKILL.md \| wc -l` |
| Architecture patterns (L0-L3) | `cat docs/architecture/SKILL_ARCHITECTURE_GUIDE.md` |
| Tool configuration (Linear/File Mode) | `cat skills-catalog/shared/references/tools_config_guide.md` |
| Key workflow | `ln-700 → ln-100 → ln-200 → ln-1000` (or manually: `ln-400 → ln-500`) |
| Skill metadata | `head -20 {ln-NNN}/SKILL.md` (frontmatter + type/category) |

## Navigation

**DAG:** GEMINI.md → `docs/README.md` → topic docs. Read SCOPE tag first in each doc.

| Topic | File |
|-------|------|
| Writing Guidelines | `docs/architecture/SKILL_ARCHITECTURE_GUIDE.md` §Writing Guidelines |
| Tool Configuration (Phase 0) | `skills-catalog/shared/references/tools_config_guide.md` |
| Risk-Based Testing | `skills-catalog/shared/references/risk_based_testing_guide.md` |

## Maintenance

**Version update protocol** (ONLY when user explicitly requests):

1. Update `**Version:**` in `{skill}/SKILL.md`
2. Update version in README.md feature tables
3. Update CHANGELOG.md — one summary paragraph per date (`## YYYY-MM-DD`), no duplicate dates

## Compact Instructions

Preserve in priority order during context compression:
- Architecture decisions and rationale (NEVER summarize)
- Modified files and their key changes
- Current verification status (pass/fail)
- Open TODOs and rollback notes
- Tool outputs (can delete, keep summary only)

**Last Updated:** 2026-03-20
