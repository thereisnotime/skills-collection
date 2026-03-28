# Contributing to claude-blog

Thank you for your interest in contributing to claude-blog!

## Getting Started

1. Fork and clone the repository
2. Install dev dependencies: `pip install -e ".[dev]"`
3. Run tests: `python -m pytest tests/ -v`

## Development

### Project Structure

```
claude-blog/
├── .claude-plugin/          # Plugin metadata
│   └── plugin.json
├── skills/
│   ├── blog/                # Main orchestrator + references + templates
│   ├── blog-write/          # Sub-skills (12 user-facing + 1 internal)
│   ├── blog-rewrite/
│   └── ...
├── agents/                  # 4 specialized agents
├── scripts/                 # Python analysis script
├── tests/                   # pytest test suite
├── docs/                    # Documentation
└── .github/workflows/       # CI pipeline
```

### Making Changes

- **SKILL.md files** must have `name` and `description` in YAML frontmatter
- **Reference paths** in sub-skills use `references/` (relative to installed location)
- **Template paths** in sub-skills use `templates/` (relative to installed location)
- Run `python -m pytest tests/ -v` before submitting

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Ensure all tests pass
4. Submit a PR with a description of what changed and why

## Reporting Issues

Open an issue at https://github.com/AgriciDaniel/claude-blog/issues
