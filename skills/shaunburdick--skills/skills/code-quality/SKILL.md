---
name: code-quality
description: "Enforces non-negotiable code quality standards for AI coding agents. Covers linting rules (no suppressions — ever), type safety (no `any` in TypeScript, no `# type: ignore` in Python), tooling discipline (choosing edit tools, reading tool errors), and a mandatory pre-commit verification protocol. Load this skill proactively whenever writing, editing, or reviewing code — don't wait to be asked. Ensures consistent quality gates across all languages and coding agents."
license: MIT
metadata:
  author: shaunburdick
  version: "1.5.0"
---

# Code Quality Standards

Non-negotiable rules for writing and committing code. These standards exist to keep codebases maintainable, type-safe, and free from technical debt introduced by suppressed warnings.

## Linting — Zero Tolerance for Suppressions

This applies to **all languages**, not just TypeScript. The principle is the same everywhere: fix the code, don't silence the tool.

| Language   | Never use                                              |
| ---------- | ------------------------------------------------------ |
| TypeScript | `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` |
| JavaScript | `eslint-disable`, `eslint-disable-next-line`           |
| Python     | `# noqa`, `# type: ignore`, `# pylint: disable`       |
| Rust       | `#[allow(...)]` (except in generated code)             |
| Go         | `//nolint`                                             |

- ❌ **NEVER** suppress a lint or type warning inline in code
- ✅ **ALWAYS** refactor code to comply with the rule's intent
- ✅ If a rule seems genuinely wrong for the project, discuss modifying the **lint config file** with the user — don't suppress it in code

**When you encounter a lint error:**
1. Read and understand what the rule is trying to prevent
2. Refactor your code to comply with the rule's intent
3. If you believe the rule is genuinely incorrect for the project, ask the user about modifying the lint configuration file
4. Document why the pattern you're using is correct and safe

**Wrong vs. Right (TypeScript example):**

```typescript
// ❌ WRONG — suppressing the rule
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function process(data: any) { ... }

// ✅ RIGHT — proper typing
interface ProcessData {
  id: string;
  value: number;
}
function process(data: ProcessData) { ... }
```

**Wrong vs. Right (Python example):**

```python
# ❌ WRONG — suppressing the type checker
def process(data) -> None:  # type: ignore
    ...

# ✅ RIGHT — proper typing
from typing import TypedDict

class ProcessData(TypedDict):
    id: str
    value: int

def process(data: ProcessData) -> None:
    ...
```

## Type Safety

Weak types are deferred bugs. Use the type system fully in whatever language you're working in.

**TypeScript:**
- ❌ No `any` — use proper interfaces, generics, or `unknown` with type guards
- ✅ Create interfaces or type aliases for all data shapes
- ✅ Use generics when the type varies but the structure is consistent
- ✅ Use `unknown` + type narrowing instead of `any` when the type is genuinely unknown

**Python:**
- ❌ No untyped function signatures — annotate all parameters and return types
- ✅ Use `TypedDict`, `dataclass`, or `pydantic` models for structured data
- ✅ Use `Any` from `typing` only as a last resort with a comment explaining why

## Tooling Discipline

Match the tool to the size and certainty of the change: whole-file write for
most of a file, targeted edit for a small region, patch only for a diff you did
not author. Re-read the exact target lines in the turn before you edit; never
re-send an identical edit; read the error message, not the echoed payload.
Tool names are versioned (`task` → `subagent`, `bash` → `shell` in OpenCode v2);
confirm a name exists before writing it into a directive. Reasoning, measured
failure rates and the current tool table:
[references/tooling-discipline.md](references/tooling-discipline.md).

## Tests — the one rule

This is the only testing rule in the harness. Other skills and agent
definitions point here; none of them add to it.

A test earns its place by **failing when behaviour regresses and passing when
only structure changes**. Add one when this project's own logic would
otherwise be unprotected, and name the regression it catches. A new test must
fail without the source change; if you cannot show that, it is not testing
your change, so do not add it.

Do not add tests for library, framework, or language behaviour. Do not add
tests for paths the suite already exercises. Do not enumerate edge cases
(empty, null, boundary, error) mechanically; test the ones the spec names or
that would plausibly break. Do not treat coverage percentages or test counts
as goals.

Remove or consolidate a test only when a remaining test demonstrably protects
the same behaviour. Deleting a redundant test is a delivered improvement, not
a loss.

When writing or reviewing a test, what a good one looks like (assert stated
values, not recomputed ones; outcomes, not mock calls; isolated; named by
behaviour): [references/test-review.md](references/test-review.md).

## Task Complete & Pre-Commit Checklist

A task isn't done until it's ready to commit. Run through this once before every commit:

**Code correctness:**
- [ ] Comments explain **why**, never **what**. A comment that restates the
      next line of code is deletion-worthy; delete it. Document the non-obvious
      invariant, the rejected alternative, the reasoning a reader would
      otherwise have to re-derive — not the signature.
- [ ] Any new test fails without the source change (see *Tests — the one rule*)
- [ ] Code passes all linting rules — **zero suppressions in any language**
- [ ] Type safety fully enforced — **no `any` / untyped signatures**
- [ ] All acceptance criteria from spec are met

**Verification:**
- [ ] The project's existing checks are green: tests, lint, type check, build
- [ ] The specific change was manually verified end-to-end
- [ ] No failed tool call was retried without first re-reading the target file

**Diff review:**
- [ ] No debug code, `console.log`, or `print` statements left behind
- [ ] No commented-out code
- [ ] Every changed line contributes to the task; anything else is removed
- [ ] Nothing was added that no task asked for: no dependency bumps, no
      drive-by refactors, no comments or tests beyond the rule above
- [ ] Can clearly explain what changed, what was removed, and why

> 🚫 If any item above is unchecked — don't commit. Fix it first.
