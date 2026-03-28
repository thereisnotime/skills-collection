---
date: 2026-03-24
topic: todo-path-consolidation
---

# Consolidate Todo Storage Under `.context/compound-engineering/todos/`

## Problem Frame

The file-based todo system currently stores todos in a top-level `todos/` directory. The plugin has standardized on `.context/compound-engineering/` as the consolidated namespace for CE workflow artifacts (scratch space, run artifacts, etc.). Todos should live there too for consistent organization. PR #345 is already adding the `.gitignore` check for `.context/`.

## Requirements

- R1. All skills that **create** todos must write to `.context/compound-engineering/todos/` instead of `todos/`.
- R2. All skills that **read** todos must check both `.context/compound-engineering/todos/` and legacy `todos/` to support natural drain of existing items.
- R3. All skills that **modify or delete** todos must operate on files in-place (wherever the file currently lives).
- R4. No active migration logic -- existing `todos/` files are resolved and cleaned up through normal workflow usage.
- R5. Skills that create or manage todos should reference the `file-todos` skill as the authority rather than encoding todo paths/conventions inline. This reduces scattered implementations and makes the path change a single-point update.

## Affected Skills

| Skill | Changes needed |
|-------|---------------|
| `file-todos` | Update canonical path, template copy target, all example commands. Add legacy read path. |
| `resolve-todo-parallel` | Read from both paths, resolve/delete in-place. |
| `triage` | Read from both paths, delete in-place. |
| `ce-review` | Replace inline `todos/` paths with delegation to `file-todos` skill. |
| `ce-review-beta` | Replace inline `todos/` paths with delegation to `file-todos` skill. |
| `test-browser` | Replace inline `todos/` path with delegation to `file-todos` skill. |
| `test-xcode` | Replace inline `todos/` path with delegation to `file-todos` skill. |

## Scope Boundaries

- No active file migration (move/copy) of existing todos.
- No changes to todo file format, naming conventions, or template structure.
- No removal of legacy `todos/` read support in this change -- that can be cleaned up later once confirmed drained.

## Key Decisions

- **Drain naturally over active migration**: Avoids migration logic, dead code, and conflicts with in-flight branches. Old todos resolve through normal usage.

## Success Criteria

- New todos created by any skill land in `.context/compound-engineering/todos/`.
- Existing todos in `todos/` are still found and resolvable.
- No skill references only the old `todos/` path for reads.
- Skills that create todos delegate to `file-todos` rather than encoding paths inline.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Determine the cleanest way to express dual-path reads in `file-todos` example commands (glob both paths vs. a helper pattern).
- [Affects R2][Needs research] Decide whether to add a follow-up task to remove legacy `todos/` read support after a grace period.

## Next Steps

-> `/ce:plan` for structured implementation planning
