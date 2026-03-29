# Contributing to Claude Code Skills

<!-- SCOPE: Contribution guidelines and PR process ONLY. Contains fork/clone instructions, skill creation guide, PR checklist, code style rules. -->
<!-- DO NOT add here: skill implementations → individual SKILL.md files, architecture patterns → docs/SKILL_ARCHITECTURE_GUIDE.md -->

**We warmly welcome contributions from the community!** 🎉

Whether you're fixing bugs, improving documentation, adding new features, or creating new skills - your contributions help make this project better for everyone.

## How to Contribute

### 1. Fork the Repository

```bash
# Click "Fork" button on GitHub
```

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/claude-code-skills.git
cd claude-code-skills
```

### 3. Create a Feature Branch

```bash
git checkout -b feature/amazing-feature
```

### 4. Make Your Changes

Follow these guidelines when making changes:

- **Follow CLAUDE.md standards** - All skills follow unified structure
- **Update CLAUDE.md** - If adding new skills or changing architecture
- **Include version and last updated date** - At the end of modified files
- **Test thoroughly** - Verify your skill works end-to-end

### 5. Commit Your Changes

```bash
git commit -m "Add amazing feature"
```

**Commit message guidelines:**
- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep first line under 72 characters
- Reference issues and PRs when applicable

### 6. Push to Your Fork

```bash
git push origin feature/amazing-feature
```

### 7. Open a Pull Request

- Go to the original repository on GitHub
- Click "New Pull Request"
- Select your branch and describe your changes
- Link related issues if applicable

## What to Contribute

### 🐛 Bug Fixes

Found a bug? Please:
1. Check if an issue already exists
2. If not, create a new issue describing the bug
3. Submit a PR with the fix

### 📖 Documentation

Improve explanations, add examples, fix typos:
- Update SKILL.md files for skill changes
- Update README.md for user-facing changes
- Update CLAUDE.md for developer-facing changes

### ✨ New Skills

Creating a new skill? Follow this structure:

```
ln-XXX-skill-name/
├── SKILL.md              # Metadata and full description
└── references/           # Templates and guides
    ├── template.md       # Document templates
    └── guide.md          # Reference guides
```

**Requirements:**
- Follow naming convention: `ln-XXX-skill-name/`
- Include SKILL.md with YAML frontmatter
- Add version and last updated date
- Test end-to-end before submitting

### 🎨 Improvements

Enhance existing skills, optimize workflows:
- Performance improvements
- Better error handling
- Code refactoring
- UX improvements

### 🌐 Translations

Help translate documentation:
- **Documentation** - All docs should be in English
- **Stories/Tasks in Linear** - Can be in any language (English/Russian/etc.)

### 💡 Ideas

Share suggestions and use cases:
- Open a Discussion on GitHub
- Describe the problem and proposed solution
- Provide examples and use cases

## Development Guidelines

### Code Style

- **Use English** - All documentation and code comments in English
- **Follow existing patterns** - Look at similar skills for consistency
- **Keep it simple** - KISS/YAGNI/DRY principles apply

### Documentation Standards

All skills must include:
- Clear description in SKILL.md
- Version number and last updated date
- Examples of usage

### Testing

Before submitting:
- Test your skill in a real project
- Verify all file paths work correctly
- Check that all dependencies are documented

## Updating Your Fork

To keep your fork up to date:

```bash
# Navigate to skills directory
cd ~/.claude/skills                    # macOS/Linux
cd %USERPROFILE%\.claude\skills       # Windows CMD
cd $env:USERPROFILE\.claude\skills    # Windows PowerShell

# Add upstream remote (first time only)
git remote add upstream https://github.com/levnikolaevich/claude-code-skills.git

# Fetch latest changes
git fetch upstream

# Merge changes from master
git checkout master
git merge upstream/master

# Push to your fork
git push origin master
```

## Pull Request Process

1. **Ensure your PR:**
   - Follows the coding standards
   - Includes appropriate tests
   - Updates documentation
   - Doesn't break existing functionality

2. **PR will be reviewed for:**
   - Code quality and consistency
   - Documentation completeness
   - Test coverage
   - Breaking changes

3. **After approval:**
   - Maintainers will merge your PR
   - Your contribution will be included in the next release

## Questions?

- 💬 **Discussions** - Ask questions in [GitHub Discussions](https://github.com/levnikolaevich/claude-code-skills/discussions)
- 🐛 **Issues** - Report bugs via [GitHub Issues](https://github.com/levnikolaevich/claude-code-skills/issues)

## Code of Conduct

Be respectful and constructive:
- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what is best for the community

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Claude Code Skills!** 🙏

Your contributions help developers worldwide build better software with AI assistance.
