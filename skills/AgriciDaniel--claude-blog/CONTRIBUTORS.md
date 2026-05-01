# Contributors

Claude Blog is built by [@AgriciDaniel](https://github.com/AgriciDaniel) with contributions from the AI Marketing Hub community.

## v1.7.0: Pro Hub Challenge Community Release (2026-04-27)

In March 2026, the AI Marketing Hub Pro community ran the first Pro Hub Challenge: members built skills and extensions for the claude-blog and claude-seo ecosystems. Six submissions were independently audited (security, functionality, code quality, documentation, dependencies, SKILL.md discoverability, innovation). Five scored Proficient or above. After security review and clean-room re-implementation in the claude-blog voice and security posture, two submissions were integrated as core skills in v1.7.0.

### Integrated as core skills

| Contributor | Original submission | Integrated as | Score |
|---|---|---|---|
| **Lutfiya Miller** (winner) | [semantic-cluster-engine](https://github.com/Drfiya/semantic-cluster-engine) | `blog-cluster` (semantic topic-cluster planning + execution engine) | 95 / 100 Exemplary |
| **Chris Mueller** | [claude-blog-multilingual](https://github.com/Chriss54/multilingual-int) | `blog-multilingual`, `blog-translate`, `blog-localize`, `blog-locale-audit` + `blog-translator` agent | 85 / 100 Proficient |

The cluster engine was the highest-scoring submission of the entire challenge. Lutfiya's design (Plan + Execute architecture with cluster-context injection into per-post writes) is preserved verbatim; we removed brand-specific styling and image prompts, hardened the HTML output against XSS, and routed through claude-blog's existing sub-skills.

Chris's multilingual suite was the most blog-native submission: four user-facing skills explicitly designed for claude-blog. The audit flagged a `curl | bash` installer and credential handling; both are removed in this port. The shared `cultural-adaptation.md` reference is referenced (not duplicated) by `blog-localize`. The `blog-translator` agent ships without `Bash` access (per the v1.9.6 lesson from claude-seo: prompt-injection blast radius).

### Acknowledged (not integrated in claude-blog v1.7.0)

| Contributor | Original submission | Status |
|---|---|---|
| **Florian Schmitz** | [claude-sxo-skill](https://github.com/tools-enerix/claude-sxo-skill) | 91.7 Exemplary. Integrated into [claude-seo v1.9.0](https://github.com/AgriciDaniel/claude-seo/releases/tag/v1.9.0) as `seo-sxo`. Blog adaptation deferred until the analyzer can be cleanly separated from page-builder and DataForSEO dependencies. |
| **Dan Colta** | [seo-drift-monitor](https://github.com/dancolta/seo-drift-monitor) | 49 Inadequate. Rejected in audit (hardcoded Google API key). The concept (baseline + diff over time) is interesting; a clean-room blog-side implementation is on the roadmap. |
| **Matej Marjanovic** | [omnichannel-seo](https://github.com/matej-marjanovic/claude-seo) | 78.3 Proficient. E-commerce SEO + DataForSEO Merchant. Integrated into claude-seo v1.9.0; not blog-native. |
| **Benjamin Samar** | seo-dungeon | 78.3 Proficient. SEO gamification. Reviewed; not integrated. |

## v1.7.0: FLOW framework integration

Released **2026-04-27**.

- **Source project:** [FLOW](https://github.com/AgriciDaniel/flow) by Daniel Agrici, v1.0.0 (2026-04-25)
- **License:** CC BY 4.0 (prompt content) + MIT (skill code)
- **What it adds:** 30 blog-applicable AI prompts (find: 5, leverage: 1, optimize: 21, win: 3) plus the FLOW framework doc and bibliography
- **Skill:** `blog-flow`
- **Commands:** `/blog flow [find|optimize|win|prompts|sync]`
- **Sync mechanism:** `scripts/sync_flow.py` pulls from GitHub. Stdlib only. HTTPS only. Host-allowlisted to `api.github.com`. 5 MB cap. Atomic writes. Path-traversal guard. Anonymous-first GitHub API. Supports `--dry-run` and `--ref <sha>` pinning. SHA-256 lockfile drift detection.
- **License headers:** Every synced markdown file (and the auto-generated index README) carries an HTML comment crediting Daniel Agrici / FLOW / CC BY 4.0.

Local-stage prompts (Google Business Profile, citations, local audits) are intentionally excluded; they target brick-and-mortar work, not blogs. Use `claude-seo`'s `seo-flow` for the local stage.

## v1.7.0: Mechanical security guardrails

Released **2026-04-27**.

A new pytest module (`tests/test_security_guardrails.py`) enforces four invariants on every test run:

1. No agent grants the `Bash` tool in its frontmatter (prompt-injection blast radius).
2. No `SKILL.md` includes the invalid `allowed-tools` field.
3. Skill names are unique across the entire repository (no duplicate routing).
4. The FLOW sync script preserves all six security invariants (host allowlist, size cap, dry-run flag, ref pinning, lockfile, license-header injection, path-traversal guard).

Pre-existing finding closed: `agents/blog-reviewer.md` had `Bash` in its tools list (used only for word counts and pattern matches that `Grep` already covers). Removed.

## How to credit a contributor in a blog post

When writing about a contributor, link to:

- Their **original submission repo** (the GitHub URL in the table above)
- The integrated skill in this repo: `https://github.com/AgriciDaniel/claude-blog/tree/main/skills/<skill-name>/`
- This `CONTRIBUTORS.md` file as the canonical attribution source

## Community

- **Free community:** https://www.skool.com/ai-marketing-hub
- **Pro community:** https://www.skool.com/ai-marketing-hub-pro
