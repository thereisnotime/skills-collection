# Prompt Caching Guide

> **SCOPE:** How Claude Code prompt caching works and how to keep cache hit rates high. Based on Tw93 architecture analysis.

## How Prompt Cache Works

Prefix-matching from start of request to each `cache_control` breakpoint. Order is fixed:

```
System Prompt -> Tool Definitions -> Chat History -> Current Input
```

Cache is **model-specific** -- switching models mid-session rebuilds entire cache from scratch.

## Cache-Friendly Prompt Structure

| Layer | Content | Cacheability |
|-------|---------|-------------|
| System Prompt | CLAUDE.md, static instructions | Always cached |
| Tool Definitions | Built-in tools, MCP schemas | Cached if stable |
| Chat History | Conversation turns | Incrementally cached |
| Current Input | User message + `<system-reminder>` | Never cached |

## What Breaks Cache

| Anti-pattern | Why it breaks | Fix |
|-------------|--------------|-----|
| Timestamps in system prompt | Different every call | Pass via `<system-reminder>` in user message |
| Shuffling tool definition order | Prefix mismatch after first change | Keep tool order deterministic |
| Adding/removing tools mid-session | Schema array changes | Use `defer_loading` stubs |
| Switching models mid-session | Cache is model-bound | Use Subagent for different model |
| Dynamic content in CLAUDE.md | Changes system prompt layer | Keep CLAUDE.md stable; pass dynamic data via user message |

## defer_loading Pattern

| Aspect | Detail |
|--------|--------|
| Stub | Lightweight entry: tool name only, `defer_loading: true` |
| Discovery | Agent calls `ToolSearch` tool to find deferred tools |
| Activation | Full JSON schema loaded only when agent selects the tool |
| Cache effect | Stubs are static -- cache prefix stays stable |

## Compaction (Context Compression)

| Step | What happens |
|------|-------------|
| Trigger | Near context window limit |
| Fork call | Full history sent to model with "Summarize this conversation" |
| Cache hit | Same prefix -> costs ~1/10 price |
| Result | Dozens of rounds compressed to ~20K token summary |
| Preserved | System prompt + Tool definitions stay intact, file references reattached |
| **Risk** | Architecture decisions lost unless `## Compact Instructions` section configured in CLAUDE.md |

## Plan Mode Cache Trick

Plan Mode does NOT swap to a read-only toolset (that would invalidate tool definition cache). Instead, `EnterPlanMode` is a regular tool the model calls. Tool set unchanged, cache untouched.

## Budget Reality

| Component | Tokens | % of 200K |
|-----------|--------|-----------|
| System instructions | ~2K | 1% |
| Skill descriptors | ~1-5K | 1-2.5% |
| MCP tool definitions | ~10-20K | 5-10% |
| LSP state | ~2-5K | 1-2.5% |
| CLAUDE.md | ~2-5K | 1-2.5% |
| Memory | ~1-2K | 0.5-1% |
| **Fixed overhead** | **~15-30K** | **7.5-15%** |
| **Available for work** | **~170-185K** | **85-92.5%** |

Rule of thumb: 5 MCP servers x ~5K each = 25K tokens (12.5% of budget).

## Implications for Our Setup

| Source | Tokens | Notes |
|--------|--------|-------|
| hex-line MCP | ~1.5K | 9 tools x ~170 tokens each |
| hex-ssh MCP | ~1.6K | 8 tools x ~200 tokens each |
| context7 + Ref + linear | ~5K | 3 external servers |
| **Total MCP overhead** | **~8.1K** | All 5 servers combined |
| SessionStart hook | ~200 | One-time, not repeated |

**Last Updated:** 2026-03-20
