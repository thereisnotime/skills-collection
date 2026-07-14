# Agents Reference

Complete alphabetical index of all specialized agents available across Context Engineering Kit plugins.

## Agents by Plugin

### Code Review

Specialized agents for comprehensive code quality analysis. [More info](../plugins/review/README.md).

- `bug-hunter` - Identifies potential bugs, edge cases, and error-prone patterns.
- `code-quality-reviewer` - Evaluates code structure, readability, and maintainability.
- `contracts-reviewer` - Reviews interfaces, API contracts, and data models.
- `historical-context-reviewer` - Analyzes changes in relation to codebase history and patterns.
- `security-auditor` - Identifies security vulnerabilities and potential attack vectors.
- `test-coverage-reviewer` - Evaluates test coverage and suggests missing test cases.
- `change-story-agent` - Builds the change "story" (intent, architecture, design decisions, risks, solutions) plus key facts for triage review.
- `change-impact-agent` - Rates changed files by blast radius, impact, exposure, and uncertainty.
- `change-failure-agent` - Rates changed files by failure severity and detectability.
- `change-expectation-agent` - Flags files sensitive to misunderstood requirements or side effects and lists declarative files.

### Spec-Driven Development (SDD)

Specialized agents for effective context management and quality review throughout the SDD workflow. [More info](../plugins/sdd/README.md).

- `business-analyst` - Requirements discovery, stakeholder analysis, specification writing.
- `code-explorer` - Codebase analysis, pattern identification, architecture mapping.
- `code-reviewer` - Verifies implementation against the per-step verification spec and evaluates code quality (duplication, naming, architecture, control flow, error handling, size limits, Muda waste).
- `developer` - Code implementation, TDD execution, quality review, verification.
- `qa-engineer` - Verification rubrics, quality gates, per-step test strategy, LLM-as-Judge definitions.
- `researcher` - Technology research, dependency analysis, best practices.
- `software-architect` - Architecture design, component design, implementation planning.
- `team-lead` - Step parallelization, agent assignment, execution planning.
- `tech-lead` - Task decomposition, dependency mapping, risk analysis.
- `tech-writer` - Technical documentation, API guides, architecture updates, and lessons learned.

