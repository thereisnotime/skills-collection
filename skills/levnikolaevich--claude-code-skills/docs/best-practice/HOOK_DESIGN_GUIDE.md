# Hook Design Guide

> **SCOPE:** Architecture guide for Claude Code / Gemini hooks. Event model, output protocol, patterns. Based on hex-line `hook.mjs` experience.

## 1. Event Types

| Event | When It Fires | What It Can Do | Exit 0 | Exit 2 |
|-------|---------------|----------------|--------|--------|
| `SessionStart` | Session begins | Inject preferences | `stdout` JSON `{systemMessage}` | N/A |
| `PreToolUse` | Before tool executes | Block/redirect | Silent = approve | `stderr` = block |
| `PostToolUse` | After tool returns | Filter/compress output | Silent = pass through | `stderr` = shown to Claude as feedback |
| `Stop` | Agent about to stop | Final validation | Silent = allow | `stderr` = continue |
| `UserPromptSubmit` | User sends message | Transform/validate | Silent = pass through | `stderr` = modified prompt |

## 2. PreToolUse vs PostToolUse

| Decision | PreToolUse | PostToolUse |
|----------|-----------|-------------|
| Block dangerous commands | Yes -- saves round-trip | No -- damage done |
| Redirect to better tool | Yes -- wrong tool never runs | No -- already ran |
| Compress verbose output | No -- no output yet | Yes -- output available |
| Validate tool inputs | Yes -- reject early | No -- too late |
| Add metadata to results | No -- no results | Yes -- annotate/filter |
| Token budget enforcement | No -- unknown cost | Yes -- measure and truncate |

Pre = gate (block/redirect). Post = filter (compress/annotate).

## 3. Output Protocol

| Scenario | Exit | Channel | Payload | Effect |
|----------|------|---------|---------|--------|
| Approve silently | 0 | (none) | (none) | Tool proceeds / output passes |
| Inject info | 0 | stdout | `{"systemMessage":"..."}` | Added to agent context |
| Block tool (Pre) | 2 | stderr | `{"decision":"block","reason":"..."}` | Call cancelled |
| Feedback (Post) | 2 | stderr | Filtered text | Shown to Claude as feedback |
| Hook error | 0 | (none) | (none) | Fail open -- never block on crash |

Hooks MUST fail open. Unhandled exception = `exit(0)`, not agent crash.

## 4. Matcher Patterns

| Pattern | Syntax | Matches | Use Case |
|---------|--------|---------|----------|
| Exact | `"Bash"` | Only Bash | Dangerous command blocker |
| OR list | `"Read\|Edit\|Write\|Grep"` | Any listed | Tool redirect |
| Wildcard | `"*"` | All tools | SessionStart injection |
| Regex | `"mcp__.*"` | All MCP tools | MCP-specific filtering |

Multiple entries with different matchers can point to the same hook file.

## 5. Settings Location

| Agent | Config Location | Format |
|-------|----------------|--------|
| Claude Code | `.claude/settings.local.json` -> `hooks` | `event -> [{matcher, hooks: [{type, command, timeout}]}]` |
| Claude (plugin) | Plugin's own hook declaration | Plugin-managed format |
| Gemini CLI | `settings.json` -> `hooks` | Similar, different event names |
| Codex | No hook support | `AGENTS.md` instructions only |

Do NOT use standalone `hooks/hooks.json` unless building a plugin that declares its own hooks.

```json
{"hooks":{"PreToolUse":[{"matcher":"Read|Edit|Write|Grep","hooks":[{"type":"command","command":"node hook.mjs","timeout":5}]}]}}
```

## 6. Cross-Agent Compatibility

| Feature | Claude Code | Gemini CLI | Codex |
|---------|-------------|------------|-------|
| Pre-tool hook | `PreToolUse` | `BeforeTool` | N/A |
| Post-tool hook | `PostToolUse` | `AfterTool` | N/A |
| Session start | `SessionStart` | `SessionStart` | N/A |
| Stop hook | `Stop` | N/A | N/A |
| Input format | JSON on stdin | JSON on stdin | N/A |
| No-hooks fallback | N/A | N/A | `AGENTS.md` |

Strategy: hooks for Claude/Gemini, `AGENTS.md` instructions for Codex.

## 7. One File Pattern — one `hook.mjs` routes all events

| Benefit | How |
|---------|-----|
| Single codebase | Route by `data.hook_event_name` |
| Shared constants | `DANGEROUS_PATTERNS`, `BINARY_EXT`, `TOOL_MAP` once |
| Shared helpers | `block()`, `detectCommandType()` reused |
| Atomic deployment | One file to install, update, debug |

`stdin JSON -> parse -> switch(hook_event_name) -> SessionStart|PreToolUse|PostToolUse`

## 8. Dangerous Command Blocker — PreToolUse for Bash

| Pattern | Reason |
|---------|--------|
| `rm -rf /` or `rm -rf ~` | Data destruction |
| `git push --force` | Overwrites remote history |
| `git reset --hard` | Discards uncommitted changes |
| `DROP TABLE\|DATABASE` | Permanent data loss |
| `chmod 777` | Security violation |
| `mkfs`, `dd if=/dev/zero` | Filesystem destruction |

Bypass: `# hex-confirmed` comment after explicit user confirmation via `AskUserQuestion`.
Flow: block -> agent sees reason -> asks user -> confirms -> retries with bypass.

## 9. RTK Output Filter — PostToolUse for Bash

| Stage | What It Does | Implementation |
|-------|-------------|----------------|
| Detect | Match command type (npm, test, build, pip, git) | Regex array -> type string |
| Threshold | Skip if output < N lines | `HOOK_OUTPUT_POLICY.lineThreshold = 50` |
| Deduplicate | Normalize UUIDs/IPs/timestamps, group identical | `deduplicateLines()` with `(xN)` |
| Truncate | First N + last N, gap indicator | `smartTruncate(text, 15, 15)` |
| Header | Type + compression ratio | `RTK FILTERED: npm-install (847 -> 30 lines)` |

Output to stderr + exit 2 = stderr is shown to Claude as feedback; output replacement is not guaranteed for Bash.

## 10. SessionStart Injection

| Layer | Role | Mechanism |
|-------|------|-----------|
| SessionStart (primary) | Tell agent tool preferences | `{systemMessage}` on stdout |
| PreToolUse (safety net) | Block wrong tool if injection ignored | Exit 2 with redirect |
| CLAUDE.md (docs) | Human-readable preference table | Reference for developers |

Two layers because LLMs sometimes ignore injections under heavy context. PreToolUse is the hard gate.

## 11. Three-Layer Enforcement

Hooks alone leave gaps. Combine all three layers:

| Layer | Role | Example | Weakness alone |
|-------|------|---------|----------------|
| CLAUDE.md | Declare rules | "Run tests before commit" | Agent often ignores |
| Skill | Instruct workflow | Test order, error interpretation, fix steps | Agent may skip steps |
| Hook | Hard gate | Block commit if tests fail | Can't handle nuanced judgments |

Without any one layer, coverage has holes. Together: significantly more stable.

## 12. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| >10 lines stdout per hook call | Context bloat | Cap output, stderr for verbose |
| Semantic judgments in hooks | Hooks are not reviewers | Mechanical gates only |
| Silent exit 0 on error | Agent unaware of failure | Fail open, but log to stderr |
| No output cap on PostToolUse | 10K-line logs pass through | Always `smartTruncate` |
| Block without recovery action | Agent stuck in retry loop | Every block says what to do next |
| Hook reads files at runtime | Slow, fragile | Embed constants, config at startup |
| Multiple hook files per server | Scattered logic | One File Pattern (Section 7) |
| Timeout too short | Killed mid-op, fails open silently | 5s Pre, 10s Post |

**Last Updated:** 2026-03-20
