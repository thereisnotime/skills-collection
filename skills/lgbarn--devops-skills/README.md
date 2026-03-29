# devops-skills

> A fork of [superpowers](https://github.com/obra/superpowers) by [Jesse Vincent](https://github.com/obra)

DevOps skills for Claude Code: Terraform/OpenTofu workflows, AWS infrastructure management, safety-first IaC practices, and parallel agent orchestration.

## What's Different from Superpowers

This fork adds infrastructure/DevOps capabilities while keeping all the original development skills (TDD, debugging, code review, etc.):

### Added: Operations Skills
- **terraform-plan-review** - Parallel agent analysis before any apply
- **terraform-drift-detection** - Detect out-of-band changes
- **terraform-state-operations** - Safe state surgery workflows
- **aws-profile-management** - Credential verification

### Added: Safety Hooks
- Blocks `terraform apply`, `destroy`, `state rm`, `-auto-approve`
- Requires explicit approval workflow for all infrastructure changes

### Added: Specialized Agents
- terraform-plan-analyzer, security-reviewer, drift-detector
- historical-pattern-analyzer, conflict-arbiter

### Added: Commands
- `/plan`, `/drift`, `/review-infra`, `/upgrade-check`, `/env-compare`

## Core Principles

1. **Never Auto-Apply** - All changes require explicit approval
2. **Fewer Mistakes** - Safety over speed
3. **Full DevOps Lifecycle** - Development AND Operations

---

## Original Superpowers Documentation

The sections below are from the original superpowers plugin:

### How it works

It starts from the moment you fire up your coding agent. As soon as it sees that you're building something, it *doesn't* just jump into trying to write code. Instead, it steps back and asks you what you're really trying to do.

Once it's teased a spec out of the conversation, it shows it to you in chunks short enough to actually read and digest.

After you've signed off on the design, your agent puts together an implementation plan that's clear enough for an enthusiastic junior engineer with poor taste, no judgement, no project context, and an aversion to testing to follow. It emphasizes true red/green TDD, YAGNI (You Aren't Gonna Need It), and DRY.

Next up, once you say "go", it launches a *subagent-driven-development* process, having agents work through each engineering task, inspecting and reviewing their work, and continuing forward. It's not uncommon for Claude to be able to work autonomously for a couple hours at a time without deviating from the plan you put together.

There's a bunch more to it, but that's the core of the system. And because the skills trigger automatically, you don't need to do anything special.

## Installation

### Claude Code (Manual)

Clone this repository and register it as a plugin:

```bash
git clone https://github.com/lgbarn/devops-skills.git ~/.claude/plugins/devops-skills

# In Claude Code:
/plugin add ~/.claude/plugins/devops-skills
```

### Verify Installation

Check that commands appear:

```bash
/help
```

```
# Should see:
# /devops-skills:brainstorm - Interactive design refinement
# /devops-skills:write-plan - Create implementation plan
# /devops-skills:execute-plan - Execute plan in batches
# /plan - Run terraform plan with analysis
# /drift - Detect infrastructure drift
```

## The Basic Workflow

### Development Workflow (from Superpowers)

1. **brainstorming** - Activates before writing code. Refines rough ideas through questions, explores alternatives, presents design in sections for validation. Saves design document.

2. **using-git-worktrees** - Activates after design approval. Creates isolated workspace on new branch, runs project setup, verifies clean test baseline.

3. **writing-plans** - Activates with approved design. Breaks work into bite-sized tasks (2-5 minutes each). Every task has exact file paths, complete code, verification steps.

4. **subagent-driven-development** or **executing-plans** - Activates with plan. Dispatches fresh subagent per task with two-stage review (spec compliance, then code quality), or executes in batches with human checkpoints.

5. **test-driven-development** - Activates during implementation. Enforces RED-GREEN-REFACTOR: write failing test, watch it fail, write minimal code, watch it pass, commit. Deletes code written before tests.

6. **requesting-code-review** - Activates between tasks. Reviews against plan, reports issues by severity. Critical issues block progress.

7. **finishing-a-development-branch** - Activates when tasks complete. Verifies tests, presents options (merge/PR/keep/discard), cleans up worktree.

### Infrastructure Workflow (DevOps Skills)

1. **terraform-plan-review** - Activates before any apply. Dispatches parallel agents to analyze risks, security, and historical patterns.

2. **terraform-drift-detection** - Detect infrastructure drift between state and actual resources.

3. **terraform-state-operations** - Safe workflows for state surgery (import, mv, rm).

4. **aws-profile-management** - Verify credentials match the target environment.

**The agent checks for relevant skills before any task.** Mandatory workflows, not suggestions.

## What's Inside

### Skills Library

**Infrastructure (DevOps)**
- **terraform-plan-review** - Multi-agent plan analysis
- **terraform-drift-detection** - Drift detection and categorization
- **terraform-state-operations** - Safe state surgery
- **aws-profile-management** - Credential verification

**Testing**
- **test-driven-development** - RED-GREEN-REFACTOR cycle (includes testing anti-patterns reference)

**Debugging**
- **systematic-debugging** - 4-phase root cause process (includes root-cause-tracing, defense-in-depth, condition-based-waiting techniques)
- **verification-before-completion** - Ensure it's actually fixed

**Collaboration**
- **brainstorming** - Socratic design refinement
- **writing-plans** - Detailed implementation plans
- **executing-plans** - Batch execution with checkpoints
- **dispatching-parallel-agents** - Concurrent subagent workflows
- **requesting-code-review** - Pre-review checklist
- **receiving-code-review** - Responding to feedback
- **using-git-worktrees** - Parallel development branches
- **finishing-a-development-branch** - Merge/PR decision workflow
- **subagent-driven-development** - Fast iteration with two-stage review (spec compliance, then code quality)

**Meta**
- **writing-skills** - Create new skills following best practices (includes testing methodology)
- **using-devops-skills** - Introduction to the skills system

## Philosophy

- **Test-Driven Development** - Write tests first, always
- **Systematic over ad-hoc** - Process over guessing
- **Complexity reduction** - Simplicity as primary goal
- **Evidence over claims** - Verify before declaring success
- **Never auto-apply** - All infrastructure changes require approval

Read more: [Superpowers for Claude Code](https://blog.fsck.com/2025/10/09/superpowers/)

## Contributing

Skills live directly in this repository. To contribute:

1. Fork the repository
2. Create a branch for your skill
3. Follow the `writing-skills` skill for creating and testing new skills
4. Submit a PR

See `skills/writing-skills/SKILL.md` for the complete guide.

## License

MIT License - see LICENSE file for details

## Attribution

Original superpowers plugin by [Jesse Vincent](https://github.com/obra).

This is a fork that adds DevOps/Infrastructure capabilities. The original project is available at https://github.com/obra/superpowers.

## Support

- **Issues**: https://github.com/lgbarn/devops-skills/issues
- **Original Project**: https://github.com/obra/superpowers
