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
  Best practices and workflow automation for internationalization with AI assistants.
  <br />
  <a href="https://docs.better-i18n.com"><strong>Documentation</strong></a> · <a href="https://better-i18n.com"><strong>Website</strong></a>
</p>

---

## What are Agent Skills?

Agent skills are structured knowledge files that teach AI assistants like [Claude](https://claude.ai), [Cursor](https://cursor.com), and [Windsurf](https://windsurf.com) how to perform specialized tasks. When installed, they give your AI assistant deep expertise in internationalization workflows.

## Available Skills

| Skill | Description |
|-------|-------------|
| [best-practices](./best-practices) | Comprehensive guide for i18n implementation with Better i18n |

### best-practices

A comprehensive skill covering:

- **Project setup** — `i18n.config.ts` configuration, locale routing, middleware
- **Key naming** — conventions, namespaces, and organizing translation files
- **AI translation** — using the [Gemini](https://deepmind.google/technologies/gemini/)-powered translation with glossary support
- **GitHub sync** — automatic PR creation, review workflows, branch strategies
- **CDN delivery** — [Cloudflare](https://cloudflare.com) edge caching, cache invalidation, fallback chains
- **MCP integration** — [Model Context Protocol](https://modelcontextprotocol.io/) tools for AI agents
- **SDK usage** — [Next.js](https://nextjs.org), [React](https://react.dev), [TanStack Start](https://tanstack.com/start) integration patterns
- **ICU MessageFormat** — plurals, dates, numbers, select statements
- **RTL support** — right-to-left language handling for Arabic, Hebrew, etc.

## Installation

```bash
# Via Claude Code skills
npx skills add better-i18n/skills
```

Or add directly to your AI assistant's project configuration.

## Usage

Once installed, your AI assistant will automatically apply these best practices when helping with internationalization tasks — from setting up locale routing to writing translation-safe components.

## Links

- [Better i18n Platform](https://better-i18n.com) — translation management dashboard
- [Documentation](https://docs.better-i18n.com) — full SDK and API docs
- [CLI](https://www.npmjs.com/package/@better-i18n/cli) — command-line interface on npm
- [MCP Server](https://www.npmjs.com/package/@better-i18n/mcp) — AI agent integration on npm
- [Open-source SDKs](https://github.com/better-i18n/oss) — Next.js, React, Expo packages

## Related

- [better-i18n/oss](https://github.com/better-i18n/oss) — TypeScript SDKs, CLI, MCP server
- [next-intl](https://next-intl-docs.vercel.app) — Next.js internationalization library
- [use-intl](https://www.npmjs.com/package/use-intl) — React internationalization hooks
- [FormatJS](https://formatjs.io) — ICU MessageFormat implementation for JavaScript

## License

[MIT](./LICENSE) — Better i18n
