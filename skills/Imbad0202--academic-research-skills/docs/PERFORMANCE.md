# ARS Performance Notes

> **Recommended model: Claude Opus 4.7** with **Max plan** (or equivalent configuration). Opus 4.7 uses adaptive thinking; you no longer set a fixed thinking budget.
>
> The full academic pipeline (10 stages) consumes a **large amount of tokens** — a single end-to-end run can exceed 200K input + 100K output tokens depending on paper length and revision rounds. Budget accordingly.
>
> Individual skills (e.g., `deep-research` alone, or `academic-paper-reviewer` alone) consume significantly less.

## Estimated token usage by mode

| Skill / Mode | Input Tokens | Output Tokens | Estimated Cost (Opus 4.7) |
|---|---|---|---|
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

## Recommended Claude Code settings

| Setting | What it does | How to enable | Docs |
|---|---|---|---|
| **Agent Team** (optional) | Enables `TeamCreate` / `SendMessage` tools for manual multi-agent coordination. **ARS's internal parallelization does not require this flag** — skills spawn subagents via the built-in `Agent` tool directly. Only useful if you want to manually orchestrate persistent team workflows across sessions. | Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (research preview) | Experimental feature — no stable docs yet |
| **Skip Permissions** | Bypasses per-tool confirmation prompts, enabling uninterrupted autonomous execution across all pipeline stages | Launch with `claude --dangerously-skip-permissions` | [Permissions](https://docs.anthropic.com/en/docs/claude-code/cli-reference) · [Advanced Usage](https://docs.anthropic.com/en/docs/claude-code/advanced) |

> **⚠️ Skip Permissions**: This flag disables all tool-use confirmation dialogs. Use at your own discretion — it is convenient for trusted, long-running pipelines but removes the safety net of manual approval. Only enable this in environments where you are comfortable with Claude executing file reads, writes, and shell commands without asking first.

## Long-running session management

The full academic pipeline is designed for human-in-the-loop execution, with mandatory user confirmation at every stage. In practice, a full run often spans hours to days — longer than Anthropic's prompt cache TTL (5 minutes). Two consequences:

1. **Cache misses between checkpoints are normal.** When a stage checkpoint pauses longer than 5 minutes, the next stage reads its context uncached. This is an unavoidable cost of human-paced pipelines.
2. **Cross-session resume relies on Material Passport.** ARS does not maintain its own orchestrator state between sessions. To resume in a new session, paste your Material Passport YAML back; the orchestrator reads `compliance_history[]` and stage completion markers to locate your breakpoint.

### v3.4.0 compliance agent cost

Adding the mode-aware `compliance_agent` to Stage 2.5 and Stage 4.5 increases full-pipeline SR tokens by approximately:

| Skill / Mode | Input Tokens | Output Tokens | Estimated Cost |
|---|---|---|---|
| `deep-research systematic-review` (2.5 only) | +~5–8K | +~3–5K | +~$0.15 |
| Full pipeline SR (2.5 + 4.5) | +~10–15K | +~5–8K | +~$0.30 |
| `academic-paper full` (pre-finalize) | +~3–5K | +~2–3K | +~$0.08 |

These are on top of the existing per-skill costs in the table above (same 15,000-word / 60-reference basis; see footnote on line 23). Cross-model verification costs (if enabled) are unchanged.
