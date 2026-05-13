# CLI UX Tester

A Claude Code plugin that provides expert UX evaluation for command-line interfaces, developer tools, and APIs.
Install via the Claude Code plugin system (`/plugin install cli-ux-tester@ali5ter`).

## Features

- 11-criteria UX framework with 1-5 scoring per dimension (8 core + 3 extended criteria)
- Active testing by executing real commands and capturing output
- Parallel evaluation agents for thorough, unbiased analysis
- Persistent memory across evaluations for cross-project pattern tracking
- Comprehensive output artifacts: evaluation report, remediation plan, metrics, and test scripts
- Language-agnostic: evaluates user-facing behavior regardless of implementation

## Repository structure

```text
agents/
  cli-ux-tester.md                 # Agent definition — synthesizes results into scored artifacts
skills/
  cli-ux-tester/
    SKILL.md                       # Skill — detects CLI, spawns evaluation agents, invokes synthesizer
    testing-checklist.md           # Comprehensive testing checklist (11 criteria)
    test-scenarios.md              # Common CLI testing scenarios
    scripts/
      example-test.sh              # Template for automated testing
.claude-plugin/
  plugin.json                      # Plugin manifest
migrate                            # Migration script for v1.x and v2.x users
README.md
LICENSE
```

## Install

Inside Claude Code, run:

```text
/plugin marketplace add ali5ter/claude-plugins
/plugin install cli-ux-tester@ali5ter
```

## Migrating from v1.x or v2.x

If you previously installed via `./install.sh` or an earlier version of this plugin, run the migration script:

```bash
./migrate
```

Then reinstall via the plugin commands above.

## Usage

After installation, ask Claude to evaluate any CLI in your session:

```text
Review this CLI for UX issues
Test the error messages in this tool
Check if this API is developer-friendly
Evaluate the help system
```

The skill detects which CLI to evaluate from the current directory or your message, then runs the evaluation
automatically.

### What gets evaluated

The plugin applies an 11-criteria framework, rating each dimension 1–5 with specific evidence:

**Core criteria (1–8):**

1. **Discovery & Discoverability** — Can users find features?
2. **Command & API Naming** — Are names intuitive and consistent?
3. **Error Handling & Messages** — Are errors clear and actionable?
4. **Help System & Documentation** — Is help comprehensive and accessible?
5. **Consistency & Patterns** — Do similar operations follow patterns?
6. **Visual Design & Output** — Is output readable and well-formatted?
7. **Performance & Responsiveness** — Does the CLI feel fast?
8. **Accessibility & Inclusivity** — Can diverse developers use it?

**Extended criteria (9–11):**

1. **Integration & Interoperability** — Does it compose with shell pipelines and standard tools?
2. **Security & Safety** — Are destructive operations guarded and credentials handled safely?
3. **User Guidance & Onboarding** — Does it guide new users toward their first success?

### Output artifacts

All results go into a timestamped directory in the evaluated project:

```text
CLI_UX_EVALUATION_<YYYYMMDD_HHMMSS>/
├── EVALUATION.md          # Full report with scores and evidence
├── REMEDIATION_PLAN.md    # Prioritized action items with effort estimates
├── metrics.json           # Machine-readable scores for tracking over time
└── test.sh                # Automated regression test script
```

Clean up with: `rm -rf CLI_UX_EVALUATION_*/`

### Scope

**In scope (UX/DX):**

- User-facing behavior: help text, error messages, output formatting
- Developer experience: discoverability, learnability, consistency
- Accessibility and inclusivity
- Exit codes and signal handling as they affect UX

**Out of scope (code quality):**

- Internal code architecture or style
- Language-specific best practices unrelated to UX
- Performance internals (though responsiveness is evaluated)

## How it works

The plugin provides two components:

- **Skill** (`cli-ux-tester`) — detects the target CLI, asks clarifying questions if needed, spawns three
  evaluation agents in parallel (an Explore agent for codebase mapping and two test agents for help/discovery
  and error handling), then passes all collected results to the synthesizer agent
- **Agent** (`cli-ux-tester:cli-ux-tester`) — receives pre-collected test data and synthesizes it into a
  scored 11-criteria evaluation, producing all four output artifacts

The skill handles parallel evaluation directly because the platform does not support sub-agents spawning
further sub-agents. The agent runs in `acceptEdits` permission mode to auto-approve artifact writes, and
uses persistent `user`-scoped memory to accumulate cross-evaluation patterns over time.

## Safety and quality notes

- The evaluation agents execute commands in the current directory to observe real behavior.
- All generated files use a timestamped directory for easy cleanup.
- The synthesizer agent uses `permissionMode: acceptEdits` — file writes are auto-approved, but `Bash`
  commands still prompt for permission.

## License

MIT License, Copyright (c) 2026 Alister Lewis-Bowen.
