# Agile Workflow

> End-to-end delivery pipeline from scope decomposition to quality gates

## Install

```bash
# Add the marketplace once
/plugin marketplace add levnikolaevich/claude-code-skills

# Install this plugin
/plugin install agile-workflow@levnikolaevich-skills-marketplace
```

## What it does

Automates the full Agile delivery cycle. Runtime-backed coordinators decompose scope into Epics, Stories, and 1-8 tasks, delegate to standalone workers that return machine-readable summaries, and drive execution through validation and 4-level quality gates. Integrates with Linear or works standalone with markdown files.

## Skills

| Skill | Description |
|-------|-------------|
| ln-200-scope-decomposer | Decompose scope into Epics, Stories, RICE |
| ln-201-opportunity-discoverer | Traffic-First KILL funnel for idea validation |
| ln-210-epic-coordinator | CREATE or REPLAN 3-7 Epics from scope |
| ln-220-story-coordinator | Runtime-backed Story planning coordinator |
| ln-221-story-creator | Create Story documents, validate INVEST |
| ln-222-story-replanner | Replan Stories when requirements change |
| ln-230-story-prioritizer | RICE prioritization with market research |
| ln-300-task-coordinator | Runtime-backed task planning coordinator (1-8 tasks) |
| ln-301-task-creator | Create implementation, refactoring, test tasks |
| ln-302-task-replanner | Update tasks when plan changes |
| ln-310-multi-agent-validator | Parallel review via Codex + Gemini agents |
| ln-400-story-executor | Orchestrate Story tasks to Done |
| ln-401-task-executor | Execute implementation tasks |
| ln-402-task-reviewer | Review completed tasks for quality |
| ln-403-task-rework | Fix tasks marked To Rework |
| ln-404-test-executor | Execute test tasks (E2E-first priority) |
| ln-500-story-quality-gate | 4-level gate (PASS/CONCERNS/FAIL/WAIVED) |
| ln-510-quality-coordinator | Code quality checks coordinator |
| ln-511-code-quality-checker | DRY/KISS/YAGNI scoring with MCP validation |
| ln-512-tech-debt-cleaner | Safe auto-fixes at >=90% confidence |
| ln-513-regression-checker | Run existing test suite for regressions |
| ln-514-test-log-analyzer | Classify errors, assess log quality |
| ln-520-test-planner | Test planning coordinator |
| ln-521-test-researcher | Research real-world problems before testing |
| ln-522-manual-tester | Manual testing via executable bash scripts |
| ln-523-auto-test-planner | Risk-based automated test planning |
| ln-1000-pipeline-orchestrator | Autonomous 4-stage pipeline orchestrator |

## How it works

```
ln-200 (scope) -> ln-300 (tasks) -> ln-310 (validate)
    -> ln-400 (execute: ln-401/402/403/404)
    -> ln-500 (quality gate)
```

`ln-220` and `ln-300` keep project-scoped runtime state for pause/resume and verification, while `ln-221/222/301/302` remain standalone workers that can also write run-scoped coordination artifacts when asked. `ln-1000` orchestrates all stages autonomously. Multi-agent validation (`ln-310`) runs Codex and Gemini in parallel for independent review before execution begins.

## Quick start

```bash
ln-200-scope-decomposer      # Scope -> Epics -> Stories
ln-400-story-executor         # Execute Story to Done
ln-1000-pipeline-orchestrator # Autonomous pipeline
```

## Related

- [All plugins](../../README.md)
- [Architecture guide](../architecture/SKILL_ARCHITECTURE_GUIDE.md)
