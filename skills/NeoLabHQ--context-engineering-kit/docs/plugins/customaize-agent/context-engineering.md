# context-engineering

Use when writing, editing, or optimizing commands, skills, or sub-agent prompts. Provides deep understanding of context mechanics in agent systems.

**The Anatomy of Context:**

| Component | Role | Key Insight |
|-----------|------|-------------|
| **System Prompts** | Core identity and constraints | Balance specificity vs flexibility ("right altitude") |
| **Tool Definitions** | Available actions | Poor descriptions force guessing; optimize with examples |
| **Retrieved Documents** | Domain knowledge | Use just-in-time loading, not pre-loading |
| **Message History** | Conversation state | Can dominate context in long tasks |
| **Tool Outputs** | Action results | Up to 83.9% of total context usage |

**Key Principles:**

- **Attention Budget** - Context is finite; every token depletes the budget
- **Progressive Disclosure** - Load information only when needed
- **Quality over Quantity** - Smallest high-signal token set wins
- **Lost-in-Middle Effect** - Critical info at start/end, not middle

**Practical Patterns:**

- File-system based access for progressive disclosure
- Hybrid strategies (pre-load some, load rest on-demand)
- Explicit context budgeting with compaction triggers
