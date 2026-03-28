---
title: "refactor: Consolidate todo storage under .context/compound-engineering/todos/"
type: refactor
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-todo-path-consolidation-requirements.md
---

# Consolidate Todo Storage Under `.context/compound-engineering/todos/`

## Overview

Move the file-based todo system's canonical storage path from `todos/` to `.context/compound-engineering/todos/`, consolidating all compound-engineering workflow artifacts under one namespace. Use a "drain naturally" migration strategy: new todos write to the new path, reads check both paths, legacy files resolve through normal usage.

## Problem Statement / Motivation

The compound-engineering plugin standardized on `.context/compound-engineering/<workflow>/` for workflow artifacts. Multiple skills already use this pattern (`ce-review-beta`, `resolve-todo-parallel`, `feature-video`, `deepen-plan-beta`). The todo system is the last major workflow artifact stored at a different top-level path (`todos/`). Consolidation improves discoverability and organization. PR #345 is adding the `.gitignore` check for `.context/`. (see origin: `docs/brainstorms/2026-03-24-todo-path-consolidation-requirements.md`)

## Proposed Solution

Update 7 skills to use `.context/compound-engineering/todos/` as the canonical write path while reading from both locations during the legacy drain period. Consolidate inline todo path references in consumer skills to delegate to the `file-todos` skill as the single authority.

## Technical Considerations

### Multi-Session Lifecycle vs. Per-Run Scratch

Todos are gitignored and transient -- they don't survive clones or branch switches. But unlike per-run scratch directories (e.g., `ce-review-beta/<run-id>/`), a todo's lifecycle spans multiple sessions (pending -> triage -> ready -> work -> complete). The `file-todos` skill should note that `.context/compound-engineering/todos/` should not be cleaned up as part of any skill's post-run scratch cleanup. In practice the risk is low since each skill only cleans up its own namespaced subdirectory, but the note prevents misunderstanding.

### ID Sequencing Across Two Directories

During the drain period, issue ID generation must scan BOTH `todos/` and `.context/compound-engineering/todos/` to avoid collisions. Two todos with the same numeric ID would break the dependency system (`dependencies: ["005"]` becomes ambiguous). The `file-todos` skill's "next ID" logic must take the global max across both paths.

### Directory Creation

The new path is 3 levels deep (`.context/compound-engineering/todos/`). Unlike the old single-level `todos/`, this needs an explicit `mkdir -p` before first write. Add this to the "Creating a New Todo" workflow in `file-todos`.

### Git Tracking

Both `todos/` and `.context/` are gitignored. The `git add todos/` command in `ce-review` (line 448) is dead code -- todos in a gitignored directory were never committed through this path. Remove it.

## Acceptance Criteria

- [ ] New todos created by any skill land in `.context/compound-engineering/todos/`
- [ ] Existing todos in `todos/` are still found and resolvable by `triage` and `resolve-todo-parallel`
- [ ] Issue ID generation scans both directories to prevent collisions
- [ ] Consumer skills (`ce-review`, `ce-review-beta`, `test-browser`, `test-xcode`) delegate to `file-todos` rather than encoding paths inline
- [ ] `ce-review-beta` report-only prohibition uses path-agnostic language
- [ ] Stale template paths in `ce-review` (`.claude/skills/...`) fixed to use correct relative path
- [ ] `bun run release:validate` passes

## Implementation Phases

### Phase 1: Update `file-todos` (Foundation)

**File:** `plugins/compound-engineering/skills/file-todos/SKILL.md`

This is the authoritative skill -- all other changes depend on getting this right first.

Changes:
1. **YAML frontmatter description** (line 3): Update `todos/ directory` to `.context/compound-engineering/todos/`
2. **Overview section** (lines 10-11): Update canonical path reference
3. **Directory Structure section**: Update path references
4. **Creating a New Todo workflow** (line 76-77):
   - Add `mkdir -p .context/compound-engineering/todos/` as first step
   - Update `ls todos/` for next-ID to scan both directories: `ls .context/compound-engineering/todos/ todos/ 2>/dev/null | grep -o '^[0-9]\+' | sort -n | tail -1`
   - Update template copy target to `.context/compound-engineering/todos/`
5. **Reading/Listing commands** (line 106+): Update `ls` and `grep` commands to scan both paths. Pattern: `ls .context/compound-engineering/todos/*-pending-*.md todos/*-pending-*.md 2>/dev/null`
6. **Dependency checking** (lines 131-142): Update `[ -f ]` checks and `grep -l` to scan both directories
7. **Quick Reference Commands** (lines 197-232): Update all commands to use new canonical path for writes, dual-path for reads
8. **Key Distinctions** (lines 237-253): Update "Markdown files in `todos/` directory" to new path
9. **Add a Legacy Support note** near the top: "During the transition period, always check both `.context/compound-engineering/todos/` (canonical) and `todos/` (legacy) when reading. Write only to the canonical path. Unlike per-run scratch directories, `.context/compound-engineering/todos/` has a multi-session lifecycle -- do not clean it up as part of post-run scratch cleanup."

### Phase 2: Update Consumer Skills (Parallel -- Independent)

These 4 skills only **create** todos. They should delegate to `file-todos` rather than encoding paths inline (R5).

#### 2a. `ce-review` skill

**File:** `plugins/compound-engineering/skills/ce-review/SKILL.md`

Changes:
1. **Line 244** (`<critical_requirement>`): Replace `todos/ directory` with `the todo directory defined by the file-todos skill`
2. **Lines 275, 323, 343**: Fix stale template path `.claude/skills/file-todos/assets/todo-template.md` to correct relative reference (or delegate to "load the `file-todos` skill for the template location")
3. **Line 435** (`ls todos/*-pending-*.md`): Update to reference file-todos conventions
4. **Line 448** (`git add todos/`): Remove this dead code (both paths are gitignored)

#### 2b. `ce-review-beta` skill

**File:** `plugins/compound-engineering/skills/ce-review-beta/SKILL.md`

Changes:
1. **Line 35**: Change `todos/` items to reference file-todos skill conventions
2. **Line 41** (report-only prohibition): Change `do not create todos/` to `do not create todo files` (path-agnostic -- closes loophole where agent could write to new path thinking old prohibition doesn't apply)
3. **Line 479**: Update `todos/` reference to delegate to file-todos skill

#### 2c. `test-browser` skill

**File:** `plugins/compound-engineering/skills/test-browser/SKILL.md`

Changes:
1. **Line 228**: Change `Add to todos/ for later` to `Create a todo using the file-todos skill conventions`
2. **Line 233**: Update `{id}-pending-p1-browser-test-{description}.md` creation path or delegate to file-todos

#### 2d. `test-xcode` skill

**File:** `plugins/compound-engineering/skills/test-xcode/SKILL.md`

Changes:
1. **Line 142**: Change `Add to todos/ for later` to `Create a todo using the file-todos skill conventions`
2. **Line 147**: Update todo creation path or delegate to file-todos

### Phase 3: Update Reader Skills (Sequential after Phase 1)

These skills **read and operate on** existing todos. They need dual-path support.

#### 3a. `triage` skill

**File:** `plugins/compound-engineering/skills/triage/SKILL.md`

Changes:
1. **Line 9**: Update `todos/ directory` to reference both paths
2. **Lines 152, 275**: Change "Remove it from todos/ directory" to path-agnostic language ("Remove the todo file from its current location")
3. **Lines 185-186**: Update summary template from `Removed from todos/` to `Removed`
4. **Line 193**: Update `Deleted: Todo files for skipped findings removed from todos/ directory`
5. **Line 200**: Update `ls todos/*-ready-*.md` to scan both directories

#### 3b. `resolve-todo-parallel` skill

**File:** `plugins/compound-engineering/skills/resolve-todo-parallel/SKILL.md`

Changes:
1. **Line 13**: Change `Get all unresolved TODOs from the /todos/*.md directory` to scan both `.context/compound-engineering/todos/*.md` and `todos/*.md`

## Dependencies & Risks

- **Dependency on PR #345**: That PR adds the `.gitignore` check for `.context/`. This change works regardless (`.context/` is already gitignored at repo root), but #345 adds the validation that consuming projects have it gitignored too.
- **Risk: Agent literal-copying**: Agents often copy shell commands verbatim from skill files. If dual-path commands are unclear, agents may only check one path. Mitigation: Use explicit dual-path examples in the most critical commands (list, create, ID generation) and add a prominent note about legacy path.
- **Risk: Other branches with in-flight todo work**: The drain strategy avoids this -- no files are moved, no paths break immediately.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-todo-path-consolidation-requirements.md](docs/brainstorms/2026-03-24-todo-path-consolidation-requirements.md) -- Key decisions: drain naturally (no active migration), delegate to file-todos as authority (R5), update all 7 affected skills.

### Internal References

- `plugins/compound-engineering/skills/file-todos/SKILL.md` -- canonical todo system definition
- `plugins/compound-engineering/skills/file-todos/assets/todo-template.md` -- todo file template
- `AGENTS.md:27` -- `.context/compound-engineering/` scratch space convention
- `.gitignore` -- confirms both `todos/` and `.context/` are already ignored
