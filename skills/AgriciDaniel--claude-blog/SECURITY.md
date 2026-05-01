# Security Policy

`claude-blog` is a Claude Code skill plugin. This document covers how to
report vulnerabilities, what is in scope, the trust boundaries the project
acknowledges, and the design decisions behind dual-use technology choices.

## Reporting a Vulnerability

If you find a security issue, please **do not open a public GitHub issue**.
Instead:

1. Open a [GitHub Security Advisory](https://github.com/AgriciDaniel/claude-blog/security/advisories/new)
   on this repo (preferred), OR contact the maintainer directly via the
   email shown in the GitHub profile linked from `.claude-plugin/plugin.json`
   `author.url`.
2. Include: a minimal reproducer, the file path + line number you believe is
   affected, and your suggested severity per
   [OWASP risk rating](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology).
3. Allow at minimum 14 days before public disclosure to give time for a
   coordinated fix. Critical findings (active exploitation, default-credential
   leak) are addressed faster.

You will receive an acknowledgement within 7 days. If the report is in scope,
a fix and credit (if you want it) will land in a public commit referencing
your report.

## Supported Versions

Only the latest version receives security updates. Pin to a published
release tag (`git checkout v1.7.0`) for reproducible installs; do not
track `main` for production usage.

## In Scope

- Code in `scripts/`, `skills/*/scripts/`, `agents/*.md`, `install.sh`,
  `install.ps1`, `uninstall.sh`, `uninstall.ps1`.
- Configuration files: `.mcp.example.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, `.github/workflows/*.yml`,
  `.github/dependabot.yml`.
- The `scripts/sync_flow.py` upstream fetch + lockfile gate.
- Plugin metadata (`SKILL.md` files), with focus on prompt-injection
  surfaces in the LLM-instruction context.

## Out of Scope

- Vulnerabilities in upstream dependencies (`patchright`, `google-genai`,
  `weasyprint`, etc.) — please report those upstream first; we will
  monitor and pin once a fix is published. Dependabot tracks all four
  pip manifests + GitHub Actions.
- Vulnerabilities in the `@ycse/nanobanana-mcp` npm package — report to
  that package's maintainer at
  `https://www.npmjs.com/package/@ycse/nanobanana-mcp`. We pin the
  version in `.mcp.example.json` and `setup_image_mcp.py`; report
  pinning bumps as PR.
- Vulnerabilities in Claude Code itself, the Claude Agent SDK, or the
  Anthropic API — report to Anthropic per their security policy.
- The inherent LLM tool-use risk of letting fetched web content enter
  Claude's instruction context (see "Dual-use Technology Notes" below).
  This is acknowledged and documented; novel concrete tool-abuse paths
  are in scope, generic restatement is not.

## Trust Boundaries

The 2026-04-27 cybersecurity audit identified 11 trust boundaries this
plugin straddles. Findings against any of these are in scope:

| ID | Boundary | Threats |
|---|---|---|
| T1 | CLI args / skill invocation prompts → Python scripts | shell injection, path traversal, DoS |
| T2 | External API responses (Google APIs) → JSON parse → reports | response forgery, secret cache leak |
| T3 | NotebookLM browser session state → fs | session pickle tampering, credential leak |
| T4 | Env vars (`GOOGLE_AI_API_KEY` etc.) → MCP subprocess (npx) | env leak in subprocess, MCP impersonation |
| T5 | `SKILL.md` / `agents/*.md` → loaded by Claude as instructions | prompt injection, tool abuse |
| T6 | Public package registries (npm via npx, pip) → install.sh + .mcp runtime | typosquat, slopsquat, malicious lifecycle |
| T7 | Installer/uninstaller fs mutation under `~/.claude/skills/` | rm -rf wildcard escape, dir-bomb |
| T8 | Local credential stores (`~/.config/claude-seo/`, browser_state) | token theft, scope creep |
| T9 | WebFetch/WebSearch results entering Claude instruction context | indirect prompt injection |
| T10 | Package-manager runtime (`pip`, `npx -y`, `patchright install`) | binary substitution, runtime CVE |
| T11 | `sync_flow.py` upstream FLOW corpus (instruction surface) | upstream tamper, indirect prompt injection |

## Dual-use Technology Notes

The project deliberately uses some technologies that have legitimate AND
malicious applications. We document the design intent so reviewers can
distinguish defended-by-design from accidental risk.

### `patchright` (stealth-fork of Playwright)

**Where**: `skills/blog-notebooklm/scripts/{auth_manager,browser_session,
browser_utils,ask_question,notebook_manager}.py`. Pinned at
`patchright==1.55.2` with hash verification via `requirements.lock`.

**Why a stealth fork rather than upstream Playwright**: NotebookLM is a
Google product without a public API. To query NotebookLM programmatically,
the skill must drive a real browser logged into the user's own Google
account. Standard Playwright is detected by Google's anti-bot heuristics
(`navigator.webdriver`, automated-driver fingerprints) and either silently
returns degraded responses or blocks the session. Patchright patches these
detectability surfaces.

**Threat model**: The skill drives ONLY the user's own NotebookLM session
against their own notebooks via their own Google account. There is no
credential capture, no third-party-account scraping, no exfiltration of
session state outside the plugin-owned data dir
(`~/.claude/skills/blog-notebooklm/data/`). Cookies are written with mode
0600 (closed VULN-004 in 2026-04-27 audit).

**Same technology in another context** (auto-creating accounts, scraping
without consent, session theft) would be malicious. The legitimate use
case here is: "respond to my own questions about my own notebooks where
no API exists." If you have a security concern about how this is used,
please report it.

### WebFetch / WebSearch in `blog-researcher` agent

**Where**: only `agents/blog-researcher.md` declares the WebSearch and
WebFetch tools. The other 4 agents (`blog-writer`, `blog-seo`,
`blog-reviewer`, `blog-translator`) have only `Read, Write, Edit, Glob,
Grep` — least-privilege.

**Inherent risk** (VULN-039 in audit, accepted): when an LLM agent
fetches a URL, the response body enters the agent's context as text. If
that text contains "Ignore prior instructions, do X" patterns, modern
LLMs CAN be steered. This is true of every agent platform that allows
tool-driven retrieval.

**Mitigations in this plugin**:
1. Only `blog-researcher` has WebFetch/WebSearch grants; one agent of
   five.
2. The orchestrator pattern routes: researcher returns research data,
   then a separate agent (`blog-writer`) generates content from that
   data. The fetched URL body does NOT directly drive tool calls in
   another agent.
3. The skill instructions for `blog-researcher` (in `agents/blog-researcher.md`)
   frame retrieved content as DATA to summarize, not INSTRUCTIONS to
   execute.

**Residual risk**: Claude itself may still be steered by sufficiently
clever indirect prompt injection. This is an active research problem.
If you find a concrete tool-abuse path (e.g. researcher fetching a
crafted page leads to credential exfiltration), that is in scope — please
report.

### `sync_flow.py` upstream fetch (FLOW prompts)

**Where**: `scripts/sync_flow.py` pulls Markdown from
`github.com/AgriciDaniel/flow` (CC BY 4.0) and writes into
`skills/blog-flow/references/`. The synced files are loaded by Claude
as instructions at runtime (T11).

**Defenses**:
- HTTPS only, host allowlist (`api.github.com` only).
- 5 MB size cap per file.
- Path-traversal guard via `_assert_inside_references` (verified sound
  in audit).
- Atomic write via `tempfile + os.replace`.
- License-header injection on every synced file (CC BY 4.0).
- SHA-256 lockfile (`flow-prompts.lock`). **Drift now blocks**: if the
  upstream content hashes differ from the lockfile, `sync_flow.py` exits
  with code 2 unless `--allow-drift` is explicitly passed (closed
  VULN-018 in audit).

**Residual risk**: a maintainer who legitimately bumps the lockfile
could merge a poisoned upstream change. Mitigation: human review of
the diff before lockfile bump. The blocking behavior means this requires
intent, not negligence.

## Security Practices

- No credentials or API keys are stored in this repository.
- Install scripts write only to user-level directories (`~/.claude/`).
- Python dependencies install in isolated virtual environments.
- Credential files (OAuth tokens, NotebookLM cookies, MCP API keys)
  are written with mode 0600 (owner read/write only).
- `.mcp.json` is gitignored; the tracked template is `.mcp.example.json`
  with environment-expansion placeholders only.
- All four pip manifests have lock files with sha256 hashes for every
  transitive dep (`requirements.lock` files alongside each
  `requirements.txt`).
- GitHub Actions are SHA-pinned (mutable tag risk closed).
- OAuth flow uses CSRF state token validation.

## Audit History

Public audit notes for this project:

- 2026-04-27 cybersecurity audit (`/cybersecurity` skill): 1 CRITICAL
  + 5 HIGH + 14 MEDIUM + 11 LOW + 8 INFO. Auto-CRITICAL gate triggered.
  Final score 67/100 grade C.
- 2026-04-27 audit-fix execution: all CRITICAL + all HIGH closed across
  multiple commits. Default-commit-secret in `.mcp.json` setup fixed
  (the auto-CRITICAL). chmod 600 added to all credential writes.
  Lock files generated for all 4 pip manifests. Behavioral test gates
  added.
- 2026-03 v1.6.5 audit grade A+ (per project memory) — that earlier
  audit covered credential handling at the time; the 2026-04 audit
  found regressions and structural gaps the earlier one missed (notably
  the setup-script default and the missing `.mcp.json` gitignore).

The repo's `CHANGELOG.md` references the security commits.

## Hardening Checklist (for users running this plugin)

1. **Use the lock file**: `pip install --require-hashes -r
   skills/<skill>/scripts/requirements.lock`. The `setup_environment.py`
   wrapper does this automatically when a `.lock` file is present.
2. **Pin the MCP server**: `.mcp.example.json` already pins
   `@ycse/nanobanana-mcp@1.1.1`. Do not remove the version pin when
   copying to your own `.mcp.json`.
3. **Use `--global` for `setup_image_mcp.py`** (the default since
   commit f48a719). This writes to `~/.claude/settings.json` (mode 0600,
   user-private) instead of the project-tracked `.mcp.json`.
4. **Export credentials in your shell, do not commit them**:
   `export GOOGLE_AI_API_KEY=...` in `~/.bashrc` (or your shell rc).
   Project-mode setup writes only `${GOOGLE_AI_API_KEY}` env-expansion.
5. **Prefer git clone + checkout-tag over curl-pipe-bash**:
   ```
   git clone https://github.com/AgriciDaniel/claude-blog.git
   cd claude-blog && git checkout v1.7.0
   ./install.sh
   ```
   This lets you inspect the install script before it runs.
6. **Review `sync_flow.py` lockfile drift** before passing
   `--allow-drift`. The blocking gate is the integrity check.
7. **OAuth scope minimization**: pass `--scopes gsc_readonly,ga4` to
   `google_auth.py --auth` to grant only read-only access. Default
   already excludes write capabilities.
