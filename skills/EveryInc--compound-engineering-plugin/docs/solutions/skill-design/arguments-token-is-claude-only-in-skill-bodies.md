---
title: "$ARGUMENTS is reliably substituted inside SKILL.md only on Claude Code — reason over the user's prompt instead"
date: 2026-06-26
category: skill-design
module: "skills (argument handling across harnesses)"
problem_type: convention
component: tooling
severity: medium
applies_when:
  - Authoring or reviewing a skill that needs the user's invocation arguments inside SKILL.md
  - A skill must work on more than one harness (Claude Code, Codex, Cursor, Gemini, Kiro)
  - "Scanning the prompt for a flag token (output:, mode:, delegate:) rather than only injecting a description"
  - Deciding whether to depend on the $ARGUMENTS substitution token in skill body prose
tags:
  - skill-authoring
  - cross-harness
  - arguments
  - claude-arguments
  - prompt-reasoning
  - portability
  - flag-parsing
related_components:
  - development_workflow
  - documentation
---

# $ARGUMENTS is reliably substituted inside SKILL.md only on Claude Code — reason over the user's prompt instead

## Context

Skills routinely need the user's invocation input — both as free-form description and as flag tokens like `output:html`, `mode:headless`, `delegate:codex`. The established mechanism is the Claude Code `$ARGUMENTS` substitution: the harness replaces `$ARGUMENTS` in the skill body with the user's argument string before the model sees it. This plugin is authored once and converted to Codex, Cursor, Gemini, and Kiro, so the question is whether `$ARGUMENTS` ports.

It is a sibling of the bundled-script path problem (see `bundled-script-path-resolution-across-harnesses.md`): a Claude-Code-specific construct that looks portable in source but isn't guaranteed off Claude. It surfaced while reframing the output-format precedence in `ce-plan`/`ce-brainstorm`/`ce-ideate`: the resolution prose said "scan `$ARGUMENTS` for a token starting with `output:`," which is Claude-only phrasing for what is really "the user typed a format request in their prompt."

## Guidance

**`$ARGUMENTS` substitution inside a SKILL.md body is only confirmed on Claude Code.** Per the target specs in `docs/specs/`: Codex documents `$1`–`$9`, `$ARGUMENTS`, and named placeholders for **prompts** (skill-body behavior is not documented); Cursor documents only `$1`/`$2` for commands; Kiro lists `$ARGUMENTS` interpolation as **"Lost."** The converter rewrites the `argument-hint` frontmatter into an `## Arguments` section but does **not** rewrite inline body `$ARGUMENTS` (the OpenCode writer even emits it deliberately). So inline `$ARGUMENTS` in skill prose is a portability risk off Claude.

Separate the two uses — they take different fixes:

- **Reasoning / flag detection** ("scan `$ARGUMENTS` for `output:`/`mode:`"). The agent does not need the token here — the user's request is already in its context on every harness. Phrase it harness-neutrally: **reason over the user's prompt** for the intent, honoring both the shorthand token (`output:html`) and plain language ("make this a webpage"). Add the discriminating guard: a format/flag named as **subject matter** ("add an HTML export feature", "plan the CSV importer") is the work, not a flag — do not act on it.
- **Input injection** (`<feature_description> #$ARGUMENTS </feature_description>`). This is load-bearing on Claude — it is *how* the description reaches the agent inline. Keep the token, but pair it with a fallback so non-Claude harnesses degrade gracefully: *"if this shows a literal `$ARGUMENTS`, the harness did not substitute it — use the user's actual request from the conversation."* This mirrors the pre-resolution-with-fallback pattern AGENTS.md already prescribes for `${CLAUDE_PLUGIN_ROOT}`.

## Why This Matters

The failure is **recoverable and loud**, which is why this is `medium`, not `high`. Because the user's input is redundantly present in the conversation, a capable agent on Cursor/Kiro that meets a literal `$ARGUMENTS` routes around it and uses the real request; and if it does misfire, the output is visibly wrong (`$ARGUMENTS` echoed, or "planning $ARGUMENTS") and the user re-prompts. Contrast the silent-failure class — bundled-script `exit 127`, an empty `${CLAUDE_PLUGIN_ROOT}` — where nothing announces the break.

The quieter, higher-value risk is **flag-scanning**: an unsubstituted token means the scan finds no flag and falls to defaults — harmless for `output:` (defaults to `md`), but a missed `mode:` could skip an intended mode without any visible signal. Reasoning over the prompt removes that failure mode entirely.

Dominant harnesses (Claude native, Codex documented for prompts) are fine; the genuinely-exposed slice is Cursor/Kiro users invoking a flag-scanning skill on a weaker model. Worth fixing for robustness, not worth treating as a blocker.

## When to Apply

- Any skill that reads invocation arguments inside SKILL.md — especially one that **scans for flag tokens** rather than only injecting a description.
- When generalizing a Claude-only mechanism for cross-harness use: prefer describing the **capability** ("the user's prompt for this run") over naming the **token** (`$ARGUMENTS`), consistent with AGENTS.md "Platform-Specific Variables in Skills."

## Examples

Flag detection — before (Claude-only) vs after (harness-neutral), from the output-format resolution tier:

```text
# Before
1. CLI arg. Scan $ARGUMENTS for a token starting with the literal prefix
   output:. If found, strip it from arguments before treating the remainder
   as the feature description.

# After
1. In-prompt request. Reason over the user's prompt for this run for a request
   about this document's output format, expressed either as the output:
   shorthand or in plain language ("make the plan a webpage"). Ignore the
   output: token when reading the rest of the prompt as the feature
   description. Distinguish a request about the document's format from a format
   named as subject matter: "add an HTML export feature" is the work, not a
   doc-format request — do not switch on it.
```

Injection point — keep the token, add the fallback:

```text
<feature_description> #$ARGUMENTS </feature_description>

(If the block above shows a literal "$ARGUMENTS", your harness did not
substitute it — use the user's actual request from the conversation.)
```

**Status / scope note:** at capture time the harness-neutral fix was applied only to the output-format resolution tier in `ce-plan`/`ce-brainstorm`/`ce-ideate`. The broader sweep — adding the injection-point fallback across all ~13 skills that use `$ARGUMENTS`, plus a portability note in AGENTS.md's "Platform-Specific Variables in Skills" section (it is not documented there today) — was deliberately deferred as low-risk. The empirical question (does Codex/Cursor substitute `$ARGUMENTS` inside a *skill body*) was reasoned from specs, not probed; a 2-harness orchestration probe would settle it definitively. See `bundled-script-path-resolution-across-harnesses.md` and `codex-skill-prompt-entrypoints.md` for adjacent cross-harness skill-portability findings.
