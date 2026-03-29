# GitHub README Best Practices (2026)

<!-- SCOPE: GitHub README writing guidelines ONLY. Contains optimal length, standard structure, anti-patterns, section guidelines, quality checklist. -->
<!-- DO NOT add here: repository-specific README content → README.md, documentation standards → DOCUMENTATION_STANDARDS.md -->

This document outlines modern best practices for writing effective README files based on industry standards and research from leading open-source projects (2024-2026).

## Table of Contents

- [Optimal Length](#optimal-length)
- [Standard Structure](#standard-structure)
- [Core Principle: Link, Don't Duplicate](#core-principle-link-dont-duplicate)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
- [Section Guidelines](#section-guidelines)
- [Examples from Industry Leaders](#examples-from-industry-leaders)
- [Quality Checklist](#quality-checklist)

---

## Optimal Length

| Project Type | Recommended Length | Maximum Length | Notes |
|--------------|-------------------|----------------|-------|
| **Simple Library** | 100-200 lines | 300 lines | Focus on quick start |
| **Framework/Tool** | 200-350 lines | 450 lines | Balance detail with links |
| **Platform/Suite** | 250-400 lines | 500 lines | Requires TOC |
| **Enterprise** | 300-450 lines | 600 lines | Heavy modularization needed |

**Critical Thresholds:**
- ✅ **< 350 lines** - Optimal for most projects
- ⚠️ **350-500 lines** - Acceptable with Table of Contents
- 🔴 **> 500 lines** - Too long, split into separate docs

**Why Length Matters:**
- **Performance** - Browsers may lag on low-end devices with 1000+ line READMEs
- **Cognitive Load** - Users scan, not read; shorter = better retention
- **Maintenance** - Longer docs = higher chance of outdated information

---

## Standard Structure

### Required Sections (in order)

| # | Section | Purpose | Lines | Priority |
|---|---------|---------|-------|----------|
| 1 | **Title + Badges** | Project identity, status | 5-10 | REQUIRED |
| 2 | **Description** | What it is, why it exists | 10-20 | REQUIRED |
| 3 | **Table of Contents** | Navigation (if >400 lines) | 5-15 | CONDITIONAL |
| 4 | **Features** | Key capabilities | 20-40 | RECOMMENDED |
| 5 | **Installation** | How to get started | 30-60 | REQUIRED |
| 6 | **Usage/Quick Start** | Basic examples | 30-50 | REQUIRED |
| 7 | **Documentation** | Links to detailed docs | 10-20 | RECOMMENDED |
| 8 | **Contributing** | How to contribute | 5-10 | RECOMMENDED |
| 9 | **License** | Legal terms | 5-10 | REQUIRED |
| 10 | **Author/Support** | Contact info | 10-20 | RECOMMENDED |

### Optional Sections

- **API Reference** - Link to separate doc (NOT full API in README)
- **FAQ** - Link to wiki or docs/ (max 3-5 items in README)
- **Roadmap** - Link to GitHub Projects or ROADMAP.md
- **Changelog** - Link to CHANGELOG.md (NOT inline)
- **Screenshots** - 1-3 images max (more → docs/screenshots/)

---

## Core Principle: Link, Don't Duplicate

**The Problem:**
Duplication between README and docs/ leads to:
- Information drift (updates in one place, not the other)
- Increased maintenance burden
- Confusion about "source of truth"

**The Solution:**
README = **Gateway Document**
- Concise overview
- Quick start examples
- Links to detailed documentation

### Before (Anti-Pattern)

```markdown
## Configuration

Our project supports 15 configuration options:

1. **database.host** (string) - Database hostname
   - Default: localhost
   - Example: db.example.com

2. **database.port** (number) - Database port
   - Default: 5432
   - Range: 1-65535

[... 13 more detailed options with examples ...]

## API Reference

### authenticate(username, password)
Authenticates a user with credentials.

**Parameters:**
- username (string, required) - User's username
- password (string, required) - User's password

**Returns:** Promise<User>

**Throws:**
- InvalidCredentialsError - If credentials are wrong
- NetworkError - If connection fails

[... 20 more API methods with full signatures ...]
```

**Lines:** ~300 just for config + API

### After (Best Practice)

```markdown
## Configuration

Configure via environment variables or config file. Key options:
- Database connection (host, port, credentials)
- Authentication settings (JWT secret, expiry)
- Logging level and output

**Full configuration reference:** [docs/configuration.md](docs/configuration.md)

## API Reference

```javascript
// Quick example
const user = await auth.authenticate(username, password);
const data = await api.getData(userId);
```

**Full API documentation:** [docs/api-reference.md](docs/api-reference.md)
```

**Lines:** ~15-20 (saves 280 lines!)

---

## Anti-Patterns to Avoid

### 1. Excessive Length (> 500 lines)

**Example:** core-js README (1000+ lines)
- **Problem:** Browsers lag, poor mobile experience
- **Solution:** Separate docs/ with links

### 2. Duplication with Wiki/Docs

**Example:** Projects copying full tutorials from wiki
- **Problem:** Information drift, double maintenance
- **Solution:** Single source of truth in docs/, link from README

### 3. Wall of Text

**Bad:**
```markdown
This project is a comprehensive framework for building scalable web applications
using modern technologies and best practices that have been refined over years of
production use in enterprise environments and it provides extensive tooling for...
```

**Good:**
```markdown
**Modern web framework** with:
- Built-in scalability patterns
- Enterprise-grade tooling
- Production-tested best practices
```

### 4. Missing Table of Contents

**Rule:** If README > 400 lines, TOC is MANDATORY
- Without TOC, users can't navigate
- GitHub auto-generates anchors, use them

### 5. Deep Header Nesting

**Bad:** h1 → h2 → h3 → h4 → h5 → h6
**Good:** h1 → h2 → h3 (rarely h4)

**Why:** Deep nesting confuses hierarchy and breaks scanability

### 6. No Code Examples

**Problem:** Users can't visualize usage
**Solution:** 2-3 minimal code examples in Quick Start

### 7. Installation Without Prerequisites

**Bad:**
```markdown
npm install my-package
```

**Good:**
```markdown
**Prerequisites:** Node.js 18+, npm 9+

npm install my-package
```

---

## Section Guidelines

### Title + Badges

**Format:**
```markdown
# Project Name

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Build](https://img.shields.io/github/workflow/status/user/repo/CI)
```

**Recommended Badges:**
- Version
- License
- Build status
- Test coverage
- Downloads/Stars

**Avoid:** Too many badges (>10 = visual clutter)

### Description

**Formula:** [What] + [Why] + [Key Benefits]

**Example:**
```markdown
## About

**Project Name** is a [what it is] that helps [target audience] to [solve problem].

**Why?** Traditional solutions [problem statement].

**Key Benefits:**
- ✅ Benefit 1
- ✅ Benefit 2
- ✅ Benefit 3
```

**Length:** 10-20 lines max

### Features

**Format:** Bullets or table

**Good:**
```markdown
## Features

- **Feature 1** - Brief description
- **Feature 2** - Brief description
- **Feature 3** - Brief description
```

**Avoid:** Paragraphs (poor scanability)

### Installation

**Structure:**
1. Prerequisites (versions, dependencies)
2. Installation command(s)
3. Verification step

**Example:**
```markdown
## Installation

**Prerequisites:**
- Node.js 18+ ([install](https://nodejs.org))
- Git

**Install:**
```bash
npm install -g my-tool
```

**Verify:**
```bash
my-tool --version
```

### Usage/Quick Start

**Formula:**
1. Simplest example (1-5 lines)
2. Common use case (10-20 lines)
3. Link to tutorials

**Example:**
```markdown
## Quick Start

**Hello World:**
```javascript
const lib = require('my-lib');
lib.hello('world');
```

**Common Pattern:**
```javascript
const lib = require('my-lib');
const result = await lib.process({
  input: 'data',
  options: { format: 'json' }
});
```

**More examples:** [docs/tutorials/](docs/tutorials/)
```

### Contributing

**Option 1: Brief (if simple):**
```markdown
## Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Submit a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
```

**Option 2: Link Only (if complex):**
```markdown
## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
```

**Never:** Full contributing guide in README (50+ lines)

---

## Examples from Industry Leaders

### GitHub (Official Docs)

**Strategy:** Minimal README, full docs at docs.github.com
- README: ~150 lines (quick start + links)
- Detailed docs: Separate website

### TensorFlow

**Strategy:** Quick start in README, tutorials externally
- README: ~300 lines
- Installation (30 lines) + Quick example (20 lines) + Links to tutorials

### AWS SDK (JavaScript)

**Strategy:** README as index, wiki for details
- README: ~200 lines
- API reference: Separate wiki
- Examples: Separate repository

### React

**Strategy:** Ultra-minimal README
- README: ~100 lines
- Full docs: react.dev

**Key Insight:** Bigger projects = shorter README (more docs elsewhere)

---

## Quality Checklist

### Length & Structure

- [ ] README is 150-400 lines (optimal range)
- [ ] Table of Contents present if > 400 lines
- [ ] No header nesting beyond h3 (rarely h4)
- [ ] Clear visual hierarchy with spacing

### Content Quality

- [ ] Description answers "What? Why? Key Benefits?"
- [ ] Installation includes prerequisites + verification
- [ ] Quick Start has 1-3 working code examples
- [ ] No duplication with docs/ (link instead)
- [ ] Contributing is brief or links to CONTRIBUTING.md

### Completeness

- [ ] All required sections present (Title, Description, Installation, Usage, License)
- [ ] Links to detailed docs are working
- [ ] Code examples are tested and work
- [ ] Badges are current and relevant

### Maintenance

- [ ] Last updated date visible
- [ ] Version number matches latest release
- [ ] No outdated screenshots or examples
- [ ] No broken links

### Accessibility

- [ ] Images have alt text
- [ ] Code blocks have language tags
- [ ] Links have descriptive text (not "click here")
- [ ] Emoji used sparingly (not excessive)

---

## Summary: Golden Rules

1. **Keep it under 350 lines** - Link to docs/ for details
2. **Link, don't duplicate** - Single source of truth
3. **Show, don't tell** - Code examples over paragraphs
4. **Scannable structure** - Bullets, tables, spacing
5. **Required sections** - Title, About, Installation, Usage, License
6. **CONTRIBUTING.md separate** - If more than 20 lines
7. **Table of Contents** - If README > 400 lines
8. **No deep nesting** - Max h3, rarely h4

**Remember:** README is a gateway, not a manual. Quick start → Links → Detailed docs.

---

**Version:** 1.0.0
**Last Updated:** 2025-11-17
**Based on:** GitHub best practices research (2024-2026), industry leader analysis
