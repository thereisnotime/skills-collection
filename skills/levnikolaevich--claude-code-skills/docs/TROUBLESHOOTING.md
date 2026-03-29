# Troubleshooting

Known issues and solutions for ln-1000 pipeline orchestrator and skill execution.

| # | Problem | Area | Root Cause | Solution | Commit |
|---|---------|------|------------|----------|--------|
| 1 | Lead outputs "Improvising..." after long run, workers stuck in infinite idle (".", "ok", "Done") | ln-1000 / Stop hook | Context compression destroys SKILL.md + state variables. Phase 0 recovery only handles restart, not in-session compression | Stop hook stderr includes `---PIPELINE RECOVERY CONTEXT---` block during recovery checks with inline state + file paths for self-healing | `de3c601` |
| 2 | Worker in worktree writes checkpoint/done.flag to `.worktrees/story-{id}/.pipeline/` — lead never finds them | ln-1000 / worker_prompts | Worker prompts use relative `.pipeline/` paths. In worktree, CWD is worktree dir, not project root. Hooks run from project root | `pipeline_dir` set as absolute path in Phase 3.2 (`$(pwd)/.pipeline`), passed to all worker prompts via `{pipeline_dir}` template variable | Fixed |
