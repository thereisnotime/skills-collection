<p align="center">
  <a href="https://better-i18n.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://better-i18n.com/logo-dark.svg">
      <img src="https://better-i18n.com/logo.svg" alt="Better i18n" width="240">
    </picture>
  </a>
</p>

<h3 align="center">AI Agent Skills for Better i18n</h3>

<p align="center">
  Comprehensive localization knowledge for AI coding assistants — Claude, Cursor, Windsurf, and more.
  <br />
  <a href="https://docs.better-i18n.com"><strong>Documentation</strong></a> · <a href="https://better-i18n.com"><strong>Dashboard</strong></a> · <a href="https://help.better-i18n.com"><strong>Help Center</strong></a>
</p>

---

## Installation

```bash
# Claude Code, Cursor, Windsurf, Codex — any agent
npx skills add better-i18n/skills

# Install to a specific agent only
npx skills add better-i18n/skills -a claude-code
npx skills add better-i18n/skills -a cursor
```

## What are Agent Skills?

Agent skills are structured knowledge files that give AI assistants deep, opinionated expertise in a specific domain. When installed, your AI assistant knows exactly how to use better-i18n — no copy-pasting docs, no guessing API shapes.

## What's covered

The `best-practices` skill routes every localization question to the right reference:

| Topic | Reference |
|---|---|
| **Next.js SDK** — App Router, ISR, ISR stale timing, locale switcher | `sdk-next.md` |
| **React / Core / Hono / Remix** — factory, TanStack Router, SSR, TtlCache, staticData shape | `sdk-react.md` |
| **Mobile** — Expo, Swift SPM, Flutter | `sdk-mobile.md` |
| **CLI** — scan, sync, check, doctor, CI gates | `cli.md` |
| **MCP tools** — all 13 translation tools, pagination, scope errors, workflow order | `mcp.md` |
| **Content CMS** — SDK query builder, 19 MCP content tools | `content.md` |
| **CDN** — URL structure, cache layers, `{ fallback: true }` debugging, locale mismatch | `cdn.md` |
| **GitHub sync** — pipeline, job types, 422 recovery, file pattern diagnosis | `github-sync.md` |
| **File formats** — JSON flat / nested / namespaced | `file-formats.md` |
| **Key naming** — conventions, namespaces, anti-patterns | `key-naming.md` |
| **Publish & Analytics** — publish lifecycle, quality checks, 0% coverage danger, CDN analytics | `publish-and-analytics.md` |

## Quick example

After installing, your AI assistant knows:

```
You: Set up better-i18n in my Next.js App Router project.
AI:  [reads sdk-next.md] Creates i18n.ts singleton, i18n/request.ts, and middleware.ts
     with correct ISR revalidate settings and locale prefix config.

You: Check my translation coverage in CI.
AI:  [reads cli.md] Adds `better-i18n doctor --ci --threshold 75` to workflow.

You: Translate all missing Turkish keys using MCP.
AI:  [reads mcp.md] Calls getTranslations(status:"missing"), paginates if >200 keys,
     updateKeys, getPendingChanges, then publishTranslations — in correct order.

You: Translations look empty in production.
AI:  [reads cdn.md] Checks for { fallback: true } in CDN response, verifies locale
     code case (pt-BR → pt-br), confirms language is active and published.

You: GitHub sync ran but no keys were imported.
AI:  [reads github-sync.md] Diagnoses invalid file pattern, shows common patterns
     table, suggests re-running initial import after fixing the config.
```

## Packages

| Package | Description |
|---|---|
| [`@better-i18n/next`](https://www.npmjs.com/package/@better-i18n/next) | Next.js + next-intl adapter with ISR |
| [`@better-i18n/use-intl`](https://www.npmjs.com/package/@better-i18n/use-intl) | React + use-intl + TanStack Router |
| [`@better-i18n/expo`](https://www.npmjs.com/package/@better-i18n/expo) | React Native / Expo adapter |
| [`@better-i18n/server`](https://www.npmjs.com/package/@better-i18n/server) | Hono / Node.js middleware |
| [`@better-i18n/remix`](https://www.npmjs.com/package/@better-i18n/remix) | Remix / Shopify Hydrogen |
| [`@better-i18n/core`](https://www.npmjs.com/package/@better-i18n/core) | Headless foundation |
| [`@better-i18n/sdk`](https://www.npmjs.com/package/@better-i18n/sdk) | Content CMS SDK |
| [`@better-i18n/cli`](https://www.npmjs.com/package/@better-i18n/cli) | CLI: scan, sync, check, doctor |
| [`@better-i18n/mcp`](https://www.npmjs.com/package/@better-i18n/mcp) | MCP server for AI agents |
| [`@better-i18n/mcp-content`](https://www.npmjs.com/package/@better-i18n/mcp-content) | MCP server for Content CMS |
| `BetterI18n` (Swift) | iOS / macOS / visionOS (SPM) |
| `better_i18n` (Flutter) | Flutter / Dart (pub.dev) |

## Links

- [Dashboard](https://better-i18n.com) — create projects, manage translations
- [Documentation](https://docs.better-i18n.com) — full SDK and API reference
- [Help Center](https://help.better-i18n.com) — guides and tutorials
- [Status](https://status.better-i18n.com) — service status
- [OSS packages](https://github.com/better-i18n/oss) — open-source SDKs

## License

[MIT](./LICENSE) — Better i18n
