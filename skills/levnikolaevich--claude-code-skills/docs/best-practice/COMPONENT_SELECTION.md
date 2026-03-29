# Component Selection Guide

<!-- SCOPE: When to use Command vs Agent vs Skill in Claude Code. Decision criteria, patterns, hierarchy mapping. -->

Source: [Claude Code Docs](https://code.claude.com/docs/en/) + [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice) (verified Mar 2026)

---

## At a Glance

| | Command | Agent | Skill |
|---|---------|-------|-------|
| **Location** | `.claude/commands/<name>.md` | `.claude/agents/<name>.md` | `.claude/skills/<name>/SKILL.md` |
| **Context** | Inline (main) | Separate (isolated) | Inline (main), or `context: fork` |
| **User-invocable** | Yes (`/name`) | No | Yes (`/name`), unless `user-invocable: false` |
| **Auto-invoked** | Never | Yes (via `description`) | Yes (via `description`) |
| **Accepts args** | `$ARGUMENTS`, `$0`, `$1` | Via `prompt` param | `$ARGUMENTS`, `$0`, `$1` |
| **Dynamic context** | Yes (`` !`cmd` ``) | No | Yes (`` !`cmd` ``) |
| **Tool restrictions** | `allowed-tools:` | `tools:` / `disallowedTools:` | `allowed-tools:` |
| **Hooks** | No | `hooks:` frontmatter | `hooks:` frontmatter |
| **Memory** | No | `memory:` (user/project/local) | No |
| **Preload skills** | No | `skills:` frontmatter | No |
| **MCP servers** | No | `mcpServers:` frontmatter | No |

---

## Decision Table

| Scenario | Use | Why |
|----------|-----|-----|
| User-initiated workflow, orchestrates agents/skills | **Command** | Entry point, keeps context lean until triggered |
| Autonomous multi-step task, needs isolation | **Agent** | Separate context, own tools, background-capable |
| Reusable procedure, auto-invoked by intent | **Skill** | Inline, lightweight, auto-discoverable |
| Heavy operation that shouldn't pollute main context | **Skill** with `context: fork` | Isolation without full agent overhead |
| Domain knowledge for a specific agent | **Skill** preloaded via `skills:` | Injected at agent startup |
| Background knowledge, never user-triggered | **Skill** with `user-invocable: false` | Hidden from `/` menu, available for preloading |
| Cross-session learning | **Agent** with `memory:` | Persistent memory across sessions |
| Destructive procedure (push, create issues, install) | **Skill** with `disable-model-invocation: true` | Prevents accidental auto-triggering |

---

## Patterns

### Command as Orchestrator

```
User -> /command -> AskUserQuestion -> Agent tool -> Skill tool -> Output
```

Commands handle user interaction and coordinate the workflow. They invoke agents for autonomous work and skills for inline operations.

### Agent with Preloaded Skills

```yaml
# agent frontmatter
skills:
  - domain-knowledge-skill
```

Full skill content injected at startup. Agent follows instructions from preloaded skills as domain knowledge. No dynamic invocation — skills are reference material.

### Skill Context Isolation

```yaml
# skill frontmatter
context: fork
agent: general-purpose
```

Runs skill in isolated subagent context. Use when:
- Skill performs heavy operations (many file reads/writes)
- Skill should not pollute main conversation context
- Skill output should be summarized before returning

### Agent Persistent Memory

```yaml
# agent frontmatter
memory: project
```

Agent remembers across sessions in project scope. Use for:
- Code reviewers that learn project patterns
- Validators that accumulate context
- Research agents that build knowledge base

---

## Orchestrator-Worker Hierarchy Mapping

| Level | Claude Code primitive | Example |
|-------|----------------------|---------|
| L0 Meta-orchestrator | Command + sequential `Skill()` stages | Pipeline coordinator driving a story through multiple stages |
| L1 Orchestrator | Command (coordinates agents) | Story executor, quality gate |
| L2 Coordinator | Agent (isolated context) | Quality coordinator, test planner |
| L3 Worker | Skill (inline) or Agent (heavy) | Task executor, code quality checker |

### When workers use Agent vs Skill

| Condition | Use |
|-----------|-----|
| Worker needs many tools, autonomous decisions | Agent |
| Worker is a simple procedure, loads reference data | Skill |
| Worker runs in parallel with other workers | Agent (separate context) |
| Worker output feeds directly into coordinator | Skill (inline, no context switch) |

---

## Anti-patterns

| Anti-pattern | Problem | Fix |
|--------------|---------|-----|
| Generic agents ("QA agent", "backend agent") | Too broad, no focused expertise | Feature-specific agents (code-quality-checker, npm-upgrader) |
| Skill without `description` | Cannot be auto-invoked | Add description matching user intent |
| Agent for one-liner tasks | Context overhead for simple operation | Use skill instead |
| Command that auto-invokes | Commands NEVER auto-invoke | Use skill if auto-invocation needed |
| Preloading too many skills into agent | Context bloat at startup | Preload only essential domain knowledge |
| Auto-invocable skill with side effects | Accidental git push, issue creation | Add `disable-model-invocation: true` |
