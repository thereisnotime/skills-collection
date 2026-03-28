# claude-blog - AI Blog Creation Skill for Claude Code

![Claude Blog - AI-Powered Blog Creation](assets/header.jpeg)

[![CI](https://github.com/AgriciDaniel/claude-blog/actions/workflows/ci.yml/badge.svg)](https://github.com/AgriciDaniel/claude-blog/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/AgriciDaniel/claude-blog)](https://github.com/AgriciDaniel/claude-blog/releases/latest)
![Claude Code Skill](https://img.shields.io/badge/Claude_Code-Skill-blueviolet)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue)
![Sub-Skills](https://img.shields.io/badge/Sub--Skills-22-orange)

claude-blog is a Claude Code skill ecosystem for creating, optimizing, and managing blog content at scale. It generates complete articles, briefs, calendars, and schemas, dual-optimized for Google rankings and AI citation platforms (ChatGPT, Perplexity, AI Overviews).

## Table of Contents

- [Demo](#demo)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Uninstall](#uninstall)
- [Integration](#integration)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Demo

[Watch the Demo on YouTube](https://www.youtube.com/watch?v=AeLC4iutG8w)

![Blog commands demo](assets/blog-command-demo.gif)

---

## Quick Start

**One-command install (Unix/macOS):**

```bash
curl -fsSL https://raw.githubusercontent.com/AgriciDaniel/claude-blog/main/install.sh | bash
```

**Or clone and install manually:**

```bash
git clone https://github.com/AgriciDaniel/claude-blog.git
cd claude-blog
chmod +x install.sh && ./install.sh
```

**Windows (PowerShell):**
```powershell
.\install.ps1
```

Restart Claude Code after installation to activate.

## Commands
![Blog write command demo](assets/blog-write-demo.gif)
| Command | Description |
|---------|-------------|
| `/blog write <topic>` | Write a new blog post from scratch |
| `/blog rewrite <file>` | Optimize an existing blog post |
| `/blog analyze <file>` | Quality audit with 0-100 score |
| `/blog brief <topic>` | Generate a detailed content brief |
| `/blog calendar` | Generate an editorial calendar |
| `/blog strategy <niche>` | Blog strategy and topic ideation |
| `/blog outline <topic>` | SERP-informed content outline |
| `/blog seo-check <file>` | Post-writing SEO validation |
| `/blog schema <file>` | Generate JSON-LD schema markup |
| `/blog repurpose <file>` | Repurpose for social, email, YouTube |
| `/blog geo <file>` | AI citation readiness audit |
| `/blog image [generate\|edit\|setup]` | AI image generation via Gemini |
| `/blog audit [directory]` | Full-site blog health assessment |
| `/blog cannibalization [directory]` | Detect keyword overlap across posts |
| `/blog factcheck <file>` | Verify statistics against cited sources |
| `/blog persona [create\|list\|apply]` | Manage writing personas and voice profiles |
| `/blog taxonomy [sync\|audit\|suggest]` | Tag/category CMS management |
| `/blog notebooklm <question>` | Query NotebookLM for source-grounded research |
| `/blog audio [generate\|voices\|setup]` | Generate audio narration via Gemini TTS |
| `/blog google [command] [args]` | Google API data: PSI, CrUX, GSC, GA4, NLP, YouTube, Keywords |

> **22 sub-skills total**: 20 user-facing commands above + `blog-chart` (internal SVG generation) + `blog-image` (also callable internally by write/rewrite).

## Features

### 12 Content Templates
Auto-selected based on topic and intent: how-to guide, listicle, case study, comparison, pillar page, product review, thought leadership, roundup, tutorial, news analysis, data research, FAQ knowledge base.

### 5-Category Quality Scoring (100 Points)
| Category | Points | Focus |
|----------|--------|-------|
| Content Quality | 30 | Depth, readability, originality, engagement |
| SEO Optimization | 25 | Headings, title, keywords, links, meta |
| E-E-A-T Signals | 15 | Author, citations, trust, experience |
| Technical Elements | 15 | Schema, images, speed, mobile, OG tags |
| AI Citation Readiness | 15 | Citability, Q&A format, entity clarity |

Scoring bands: Exceptional (90-100), Strong (80-89), Acceptable (70-79), Below Standard (60-69), Rewrite (<60).

### AI Content Detection
Burstiness scoring, known AI phrase detection (17 phrases), vocabulary diversity analysis (TTR). Flags content that reads as AI-generated.

### Persona-Driven Writing
Configurable writing personas with NNGroup 4-dimension tone framework. Manage voice profiles per blog or author, with readability bands (Consumer/Professional/Technical) and style enforcement.

### Fact-Checking Pipeline
Statistics verification that fetches cited source URLs and scores claim confidence (exact match, paraphrase, not found). Ensures every data point in your content is accurate and traceable.

### Keyword Cannibalization Detection
Identifies keyword overlap across blog posts using local grep analysis or DataForSEO API. Severity scoring with merge/differentiate recommendations to prevent posts from competing against each other.

### CMS Taxonomy Management
Tag and category management supporting WordPress REST, Shopify GraphQL, Ghost, Strapi, and Sanity. Includes tag suggestion, sync, and audit workflows.

### Dual Optimization
Every article targets both Google rankings and AI citation platforms:
- **Google**: December 2025 Core Update compliance, E-E-A-T, schema markup, internal linking
- **AI Citations**: Answer-first formatting (+340% citations), citation capsules, passage-level citability, FAQ schema (+28% citations)

### Visual Media
- Pixabay/Unsplash/Pexels image sourcing with alt text
- AI image generation via Gemini (hero images, inline illustrations, social cards), optional, requires free Google AI API key
- Built-in SVG chart generation (bar, grouped bar, lollipop, donut, line, area, radar)
- YouTube video embedding with srcdoc lazy loading, noscript AI crawler fallback, and quality scoring
- Image density targets by content type
- Image URL verification (HTTP 200 check before embedding)

### Google API Integration (NEW in v1.6.5)
13 commands across 4 credential tiers, all free at normal usage:
- **Tier 0** (API key): PageSpeed Insights, CrUX Core Web Vitals (25-week history), YouTube video search, NLP entity analysis
- **Tier 1** (OAuth): Search Console performance, URL Inspection, Indexing API
- **Tier 2** (GA4): Organic traffic reports
- **Tier 3** (Ads): Google Ads Keyword Planner

### NotebookLM Research
Query Google NotebookLM for source-grounded research from user-uploaded documents. Tier 1 data quality with zero hallucination risk.

### Audio Narration
Generate audio narration via Gemini TTS. Three modes: summary (200-300 words), full article, and two-speaker dialogue. 30 voices, 80+ languages.

### Platform Support
Next.js/MDX, Astro, Hugo, Jekyll, WordPress, Ghost, 11ty, Gatsby, and static HTML.

## Architecture

```
claude-blog/
├── .claude-plugin/
│   └── plugin.json                     # Plugin metadata (name, description, author)
├── skills/
│   ├── blog/                           # Main orchestrator
│   │   ├── SKILL.md                    # Routes all 21 commands
│   │   ├── references/                 # 13 on-demand reference docs
│   │   └── templates/                  # 12 content type templates
│   ├── blog-write/SKILL.md            # Sub-skills (21 user-facing + 1 internal)
│   ├── blog-rewrite/SKILL.md
│   ├── blog-analyze/SKILL.md
│   ├── blog-brief/SKILL.md
│   ├── blog-calendar/SKILL.md
│   ├── blog-strategy/SKILL.md
│   ├── blog-outline/SKILL.md
│   ├── blog-seo-check/SKILL.md
│   ├── blog-schema/SKILL.md
│   ├── blog-repurpose/SKILL.md
│   ├── blog-geo/SKILL.md
│   ├── blog-audit/SKILL.md
│   ├── blog-chart/SKILL.md            # Internal: SVG chart generation
│   ├── blog-image/                    # AI image generation via Gemini
│   │   ├── SKILL.md
│   │   ├── references/                # 3 reference docs (models, tools, prompts)
│   │   └── scripts/                   # MCP setup and validation scripts
│   ├── blog-cannibalization/SKILL.md  # Keyword overlap detection
│   ├── blog-factcheck/SKILL.md        # Statistics verification
│   ├── blog-persona/SKILL.md          # Writing persona management
│   ├── blog-taxonomy/SKILL.md         # CMS taxonomy management
│   ├── blog-notebooklm/              # NotebookLM source-grounded research
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── scripts/                   # 10 Python scripts + venv wrapper
│   ├── blog-audio/                    # Audio narration via Gemini TTS
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── scripts/                   # 5 Python scripts + venv wrapper
│   └── blog-google/                   # Google API integration (NEW v1.6.5)
│       ├── SKILL.md                   # 13 commands, 4 credential tiers
│       ├── references/                # 3 reference docs (auth, API, quotas)
│       ├── scripts/                   # 11 Google API scripts + venv wrapper
│       └── assets/templates/          # 3 report templates
├── agents/                             # 4 specialized agents
│   ├── blog-researcher.md
│   ├── blog-writer.md
│   ├── blog-seo.md
│   └── blog-reviewer.md
├── scripts/
│   └── analyze_blog.py                 # Python quality analysis (5-category scoring)
├── tests/                              # pytest test suite
│   ├── conftest.py
│   └── test_analyze_blog.py
├── docs/                               # 6 documentation files
├── .github/workflows/ci.yml           # CI pipeline
├── install.sh                          # Unix/macOS installer (fallback)
├── install.ps1                         # Windows PowerShell installer
├── pyproject.toml                      # Python project config
├── requirements.txt                    # Python dependencies
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and configured
- Python 3.11+ (for `analyze_blog.py` quality scoring script)
- Optional: `pip install -r requirements.txt` for advanced analysis (readability scoring, schema detection)

## Uninstall

Unix/macOS:
```bash
chmod +x uninstall.sh && ./uninstall.sh
```

Windows (PowerShell):
```powershell
.\uninstall.ps1
```

## Integration

Chart generation and YouTube video embedding are built-in. Google API data requires a free API key (see `/blog google setup`).

**Optional companion skills** (for deeper analysis of published pages):

| Skill | Integration |
|-------|-------------|
| `/seo` | Deep SEO analysis of published blog pages |
| `/seo-schema` | Schema markup validation and generation |
| `/seo-geo` | AI citation optimization audit |
| `/seo-google` | Google API data (shared config with blog-google) |

## Documentation

Detailed documentation is available in [docs/](docs/):

- [Installation Guide](docs/INSTALLATION.md): Unix, macOS, Windows, manual install
- [Command Reference](docs/COMMANDS.md): Full command reference with examples
- [Architecture](docs/ARCHITECTURE.md): System design and component overview
- [Templates](docs/TEMPLATES.md): Template reference and customization
- [Troubleshooting](docs/TROUBLESHOOTING.md): Common issues and fixes
- [MCP Integration](docs/MCP-INTEGRATION.md): Optional MCP server setup

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built by [AgriciDaniel](https://github.com/AgriciDaniel) with Claude Code.
