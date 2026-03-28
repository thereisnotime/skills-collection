# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.5] - 2026-03-28

### Added
- **blog-google sub-skill**: Google API integration with 13 commands across 4 credential tiers. Includes PageSpeed Insights, CrUX Core Web Vitals (25-week history), Search Console performance, URL Inspection, Indexing API, GA4 organic traffic, NLP entity analysis, YouTube video search, Google Ads Keyword Planner, and PDF/HTML report generation. Contains 11 Python scripts in isolated venv. Shares config with claude-seo at `~/.config/claude-seo/google-api.json`.
- **YouTube video embedding**: Blog posts now discover and embed 2-3 relevant YouTube videos using srcdoc lazy-loading pattern (~5KB vs ~500KB per embed). Integrated into blog-write (Phase 2 research + Phase 5 embedding), blog-rewrite (audit + inject), and blog-schema (VideoObject generation). Supports MDX, HTML, Markdown, and Hugo embed formats with noscript fallback for AI crawlers.
- **VideoObject JSON-LD schema**: blog-schema now generates VideoObject for embedded videos (up to 7 schema types per page, from 6). Added to schema-stack.md reference with @id pattern `#video-{N}`.
- **video-embeds.md reference**: New reference file with quality criteria (0-100 scoring), embed placement strategy, platform-specific code patterns, and graceful degradation.
- **Google API integrations in existing workflows**: blog-seo-check (optional PSI/CrUX), blog-rewrite (NLP entity analysis), blog-geo (GSC performance), blog-researcher (YouTube video discovery).

### Fixed
- **Plugin compliance**: Removed non-standard `allowed-tools` frontmatter field from all 22 SKILL.md files per Claude Code plugin specification. Only valid fields remain: name, description, user-invokable, argument-hint, compatibility, license, metadata.
- **CLAUDE.md development rules**: Clarified SKILL.md frontmatter field requirements and reference file size guidelines.

## [1.6.2] - 2026-03-27

### Fixed
- **plugin.json**: Removed invalid `skills` array of objects that failed `claude plugin validate` (skills auto-discovered from `skills/` directory)
- **Agent frontmatter**: Removed unsupported `context: fork` field from all 4 agents (blog-researcher, blog-writer, blog-seo, blog-reviewer) per plugin agent spec
- **Version alignment**: Synced pyproject.toml version with plugin.json (was 1.5.0, now 1.6.2)

### Added
- **Marketplace support**: Created `.claude-plugin/marketplace.json` for self-hosted marketplace distribution (`/plugin marketplace add AgriciDaniel/claude-blog`)
- **plugin.json `repository` field**: Source code URL for marketplace discoverability
- **plugin.json `keywords` field**: 14 tags for marketplace search (blog, seo, content, writing, ai-citations, geo, aeo, eeat, etc.)

## [1.6.0] - 2026-03-25

### Added
- **blog-notebooklm sub-skill**: Query NotebookLM for source-grounded research with 10 Python scripts and 2 reference docs
- **blog-audio sub-skill**: Generate audio narration via Gemini TTS with 30 voice options, summary/full/dialogue modes, and 5 Python scripts

### Fixed
- Dynamic skill discovery in installers (fixes #8, fixes missing blog-notebooklm/blog-audio)
- Replaced remaining em dashes in .gitattributes and requirements.txt
- Updated "Claude Banana" reference to "Banana Claude" after upstream repo rename

## [1.5.0] - 2026-03-18

### Added
- **blog-persona sub-skill**: Writing persona management with NNGroup 4-dimension tone framework, configurable readability bands (Consumer/Professional/Technical), and style enforcement
- **blog-cannibalization sub-skill**: Keyword overlap detection across blog posts with local-only (grep) and DataForSEO API modes, severity scoring, and merge/differentiate recommendations
- **blog-factcheck sub-skill**: Statistics verification pipeline that fetches cited source URLs and scores claim confidence (exact match, paraphrase, not found)
- **blog-taxonomy sub-skill**: CMS taxonomy management supporting WordPress REST, Shopify GraphQL, Ghost, Strapi, and Sanity. Tag suggestion, sync, and audit workflows
- **CTA placement reference**: Content-type-specific CTA positioning rules with HubSpot statistics (202% better contextual CTAs, 266% more conversions with single CTA)
- **Visual rhythm enforcement**: Mandatory visual element (image/chart/callout) every 300-500 words in blog-write and blog-writer agent
- **Link deduplication check**: Step 5.5 in blog-seo-check flags duplicate URLs in body content
- **Creative Director prompting**: 4-dimension professional image prompting (Lighting, Camera, Film Stock, Material) in blog-image prompt engineering reference

### Changed
- **TL;DR replaced with Key Takeaways**: Default summary box label changed to "Key Takeaways" with 3-5 bullet format. Configurable per persona. Backward compatible (accepts TL;DR, Key Takeaways, The Bottom Line, What You'll Learn, At a Glance, In Brief)
- **Readability bands by audience**: Consumer (Grade 6-8), Professional (Grade 8-10), Technical (Grade 10-12) with default at Grade 7-8
- **analyze_blog.py**: Updated summary box detection to recognize all 6 label variants
- **blog-image models**: Added Imagen 4 pricing, legacy model deprecation note (June 1, 2026), blog image post-processing pipeline spec
- Updated install scripts to handle 4 new sub-skills and personas directory
- Updated orchestrator routing table, Quick Reference, and Sub-Skills table (19 sub-skills, 17 commands)

## [1.4.0] - 2026-03-14

### Added
- **blog-image sub-skill**: AI image generation and editing for blog content via Gemini MCP (`@ycse/nanobanana-mcp`)
  - 6-component Reasoning Brief system (Subject, Action, Context, Composition, Lighting, Style)
  - 6 blog-optimized domain modes (Editorial, Product, Landscape, UI/Web, Infographic, Abstract)
  - Commands: `/blog image generate`, `/blog image edit`, `/blog image setup`
  - 3 reference files: gemini-models.md, mcp-tools.md, prompt-engineering-blog.md
  - 2 setup scripts: setup_image_mcp.py, validate_image_setup.py
- **MCP integration**: nanobanana-mcp server config in `.mcp.json` for Gemini image generation
- **blog-write**: AI image generation as alternative/supplement to stock photos in Phase 2 Research
- **blog-rewrite**: AI image generation for missing/insufficient images in Phase 2 and Phase 4g
- **blog-researcher**: AI image recommendation output when stock photos are insufficient
- **visual-media.md**: Option 3 - AI-Generated Cover documentation with domain mode guidance

### Changed
- Updated install scripts (install.sh, install.ps1) to handle blog-image references and scripts
- Updated orchestrator routing table, Quick Reference, and Sub-Skills table for blog-image
- Updated docs: COMMANDS.md, MCP-INTEGRATION.md, INSTALLATION.md with image generation docs
- Updated README.md: commands table, architecture diagram, feature descriptions, badge count (13→15)
- Sub-skill count: 14 → 15 (13 user-facing + 1 internal chart + 1 image generation)

---

## [1.3.1] - 2026-03-06

### Added
- **SKILL.md**: `license`, `compatibility`, and `metadata` fields per Agent Skills spec (agentskills.io)
- **plugin.json**: `version`, `homepage`, `license` fields; `skills` array declaring all 14 skills (marketplace readiness); `blog-chart` marked `user-invocable: false`
- GitHub issue template and PR template (community health files)

### Changed
- **README.md**: Removed broken `/plugin install claude-blog@AgriciDaniel` (not yet registered in marketplace); corrected Python badge `3.12+` → `3.11+`; added inline note clarifying `blog-chart` is internal
- **docs/INSTALLATION.md**: Removed "Plugin Install (Recommended)" section with broken command; corrected Python `3.12+` → `3.11+` (aligns with `pyproject.toml >=3.11` and CI matrix)
- **docs/INSTALLATION.md**: Added `blog-chart` to manual `mkdir` brace expansion (was missing from 13-skill list)
- **CLAUDE.md**: Corrected Python version reference `3.12+` → `3.11+`

### Fixed
- **install.ps1**: Removed dead `$dirs` variable block (declared but never used); updated paths for `skills/blog/` restructure; added `blog` skip in sub-skill loop to prevent double-copy
- **skills/blog/SKILL.md**: Corrected `compatibility` field Python version `3.12+` → `3.11+`; corrected `user-invocable` → `user-invokable` (correct Agent Skills spec spelling)
- **skills/blog-chart/SKILL.md**: Added `user-invokable: false` to match plugin.json declaration; corrected attribute spelling

### Security
- Deleted `firebase-debug.log` (gitignored debug artifact); deleted stale remote branch `claude/review-plugin-testing-practices-eVVOU`

---

## [1.3.0] - 2026-03-06

### Added
- **Plugin ecosystem support**: `.claude-plugin/plugin.json` for `/plugin install` compatibility
- **44 pytest unit tests** for `analyze_blog.py`, covers frontmatter, headings, paragraphs, images, AI detection, citations, FAQ, freshness, readability, links, schema, and integration tests
- **GitHub Actions CI**: 3 jobs - Python tests (3.11 + 3.12), SKILL.md frontmatter validation, plugin.json validation
- **DataForSEO MCP integration** documentation, recommended primary MCP server for live SEO data (SERP, keywords, backlinks, on-page, domain analytics, content analysis, AI optimization)
- `pyproject.toml` with dependency groups (core, advanced, dev)
- `CONTRIBUTING.md` with development guidelines
- `.mcp.json` for optional MCP server configuration
- Skill evaluation scenarios (7 trigger test cases)

### Changed
- **Directory restructure**: `blog/` → `skills/blog/` (official Anthropic plugin layout)
- Updated all internal path references across skills, docs, and install scripts
- README updated with plugin install as primary method
- MCP-INTEGRATION.md updated with DataForSEO as recommended integration

### Fixed
- **install.sh**: Restored `TEMP_DIR` global scope fix (lost during restructure)
- **install.sh**: Removed `--break-system-packages` pip flag (security concern)
- **install.sh**: Removed redundant `mkdir` and double-copy of `skills/blog/`
- **CI**: Fixed lint-markdown grep matching legitimate `skills/blog/references/` paths
- **Docs**: Fixed 11 instances of double `skills/skills/` paths in INSTALLATION.md and TROUBLESHOOTING.md

### Removed
- `--break-system-packages` pip install flag

## [1.2.1] - 2026-03-06

### Fixed
- **install.sh**: Move `TEMP_DIR` declaration to global scope so the `EXIT` trap can access it after `main()` returns (fixes "unbound variable" error with `set -u` when installing via `curl | bash`)

## [1.2.0] - 2026-02-18

### Changed
- **Readability layer upgrade** with research-backed thresholds (120+ sources):
  - Flesch target: 45-60 → 60-70 (aligns with Yoast, GEO, WCAG, Raptive data)
  - Paragraph hard limit: 100 → 150 words (200 = Yoast red)
  - Ideal paragraph range: 40-55 → 40-80 words
  - H2 heading frequency: 150-200 → 200-300 words
  - Content Quality redistribution: Depth 8→7, Readability 6→7
- New automated checks in `analyze_blog.py`: passive voice estimation, transition word percentage, AI trigger word detection (26 words), sentence length distribution
- New reference sections in `google-landscape-2026.md` and `geo-optimization.md` for readability signals
- 16 files updated across references, script, skills, agents, and docs

### Added
- YouTube demo video link in README
- Header image and demo GIFs (`assets/`)

### Removed
- Placeholder `screenshots/` directory

## [1.1.0] - 2026-02-18

### Added
- **Built-in SVG chart generation** (`blog-chart` sub-skill), eliminates external `/svg` dependency
  - Supports 7 chart types: horizontal bar, grouped bar, donut, line, lollipop, area, radar
  - Dark-mode compatible, accessible (WCAG), platform-aware (HTML/JSX auto-detection)
- **Image URL verification** in researcher agent, validates HTTP 200 before embedding
- **Mid-writing readability check** in writer agent, self-checks Flesch targets before returning
- **Image density guidelines** by content type in visual-media.md

### Changed
- claude-blog is now fully self-contained, no external skill dependencies required
- Integration section updated to list companion skills as optional
- Installer scripts updated for 13 sub-skills

### Removed
- External `/svg` / `/svg-chart` skill dependency

## [1.0.0] - 2026-02-18

### Added
- **12 slash commands**: write, rewrite, analyze, brief, calendar, strategy, outline, seo-check, schema, repurpose, geo, audit
- **12 reference documents** loaded on-demand (RAG pattern):
  - google-landscape-2026, geo-optimization, content-rules, visual-media, quality-scoring
  - eeat-signals, content-templates, ai-crawler-guide, schema-stack, platform-guides, distribution-playbook, internal-linking
- **12 content type templates**: how-to, listicle, case study, comparison, pillar page, product review, thought leadership, roundup, tutorial, news analysis, data research, FAQ/knowledge base
- **4 specialized subagents**: blog-researcher, blog-writer, blog-seo, blog-reviewer
- **Python quality analysis script** (`analyze_blog.py`):
  - 5-category, 100-point scoring system (Content 30, SEO 25, E-E-A-T 15, Technical 15, AI Citation 15)
  - Readability analysis via textstat (Flesch, Gunning Fog, SMOG, Coleman-Liau)
  - AI content detection signals (burstiness, known AI phrases, vocabulary diversity)
  - Schema detection via BeautifulSoup
  - Batch mode with directory scanning
  - Multiple output formats (JSON, markdown, table)
  - Graceful degradation without optional dependencies
- **Unix + Windows installers** (install.sh, install.ps1) with one-command curl install
- **Uninstaller** (uninstall.sh) for clean removal
- **Full documentation suite** (docs/): Installation, Commands, Architecture, Templates, Troubleshooting, MCP Integration

### Architecture
- Main orchestrator: `skills/blog/SKILL.md` (routes all 12 commands)
- 12 sub-skills in `skills/blog-*/SKILL.md`
- 4 subagents in `agents/blog-*.md`
- 12 reference docs in `skills/blog/references/` (loaded on-demand)
- 12 content templates in `skills/blog/templates/`

### Fixed
- Corrected phantom "January 2026 Authenticity Update" references to verified **December 2025 Core Update** (Dec 11-29, 2025)
