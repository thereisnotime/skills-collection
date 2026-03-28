# Contributing to Loki Mode

Thank you for your interest in contributing to Loki Mode. This guide covers everything you need to get started.

## Development Environment

### Prerequisites

- **Bash 4+** (macOS ships with 3.x; install via `brew install bash`)
- **Node.js 16+** (for dashboard frontend)
- **Python 3.10+** (for dashboard backend and memory system)
- **jq** (`brew install jq` or `apt-get install jq`)
- **Git**

### Setup

```bash
git clone https://github.com/asklokesh/loki-mode.git
cd loki-mode

# Install dashboard frontend dependencies
cd dashboard-ui && npm install && cd ..

# Install dashboard backend dependencies (optional, for API development)
pip install -r dashboard/requirements.txt
```

## Running Tests

### Shell Syntax Validation

```bash
bash -n autonomy/run.sh
bash -n autonomy/loki
```

All shell scripts must pass `bash -n` before submission.

### Shell Unit Tests

```bash
# Run provider loader tests
bash tests/test-provider-loader.sh
```

### Dashboard E2E Tests (Playwright)

Requires the dashboard running on port 57374:

```bash
cd dashboard-ui
npx playwright test
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Make your changes** following the code style guidelines below.
3. **Run all tests** -- shell syntax validation, unit tests, and E2E tests where applicable.
4. **Submit a PR** against `main` with a clear description of your changes.

PRs are reviewed for correctness, code style, and test coverage. Please keep PRs focused on a single concern when possible.

## Code Style

- **No emojis.** Not in code, comments, commit messages, documentation, or UI text. This is a hard rule with zero exceptions.
- **Follow existing patterns.** Look at surrounding code and match the style.
- **Shell scripts** must pass `bash -n` syntax validation.
- **Comments** should be minimal and meaningful -- explain *why*, not *what*.
- **Commit messages** should be concise and use conventional prefixes: `fix:`, `update:`, `release:`, `refactor:`, `docs:`, `test:`.

## Project Structure

```
SKILL.md              # Core skill definition
autonomy/             # Runtime and CLI (run.sh, loki)
providers/            # Multi-provider support (Claude, Codex, Gemini)
skills/               # On-demand skill modules
references/           # Detailed documentation
memory/               # Memory system (Python)
dashboard/            # Dashboard backend (FastAPI)
dashboard-ui/         # Dashboard frontend (web components)
events/               # Event bus (Python, TypeScript, Bash)
tests/                # Test suites
benchmarks/           # SWE-bench and HumanEval benchmarks
```

For full architectural details, see [CLAUDE.md](CLAUDE.md).

## Reporting Issues

Use the [issue templates](https://github.com/asklokesh/loki-mode/issues/new/choose) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
