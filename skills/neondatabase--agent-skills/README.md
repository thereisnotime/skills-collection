<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://neon.com/brand/neon-logo-dark-color.svg?new">
  <source media="(prefers-color-scheme: light)" srcset="https://neon.com/brand/neon-logo-light-color.svg?new">
  <img width="250px" alt="Neon Logo fallback" src="https://neon.com/brand/neon-logo-dark-color.svg?new">
</picture>

# Agent Skills

A collection of [Agent Skills](https://agentskills.io/) and agent integrations for Neon Serverless Postgres.

## What are Agent Skills?

Skills are folders of instructions, scripts, and resources that agents can discover and use to do things more accurately and efficiently. Once installed, skills are automatically invoked by the agent upon detection of relevant tasks.

It all starts with the `SKILL.md` file in the skill's directory. It's the entry point and allows agents to progressively discover information as needed.

## Available Skills

### Neon Postgres

[skills/neon-postgres](skills/neon-postgres/SKILL.md)

A comprehensive index of Neon Serverless Postgres documentation and best practices to set your agents up for success.

### Neon Postgres Branches

[skills/neon-postgres-branches](skills/neon-postgres-branches/SKILL.md)

Choose and create the right Neon branch type for migration testing and isolated development workflows, including schema-only branches for sensitive data and reset-from-parent workflows to quickly realign child branches.

### Claimable Postgres

[skills/claimable-postgres](skills/claimable-postgres/SKILL.md)

Provision instant temporary Postgres databases via Claimable Postgres by Neon ([neon.new](https://neon.new)) with no login, signup, or credit card. Supports REST API, CLI, and SDK.

### Neon Postgres Egress Optimizer

[skills/neon-postgres-egress-optimizer](skills/neon-postgres-egress-optimizer/SKILL.md)

Diagnose and fix excessive Postgres egress (network data transfer) in a codebase. Use when investigating high database bills, unexpected data transfer costs, or query overfetching.

## Installation

```bash
npx skills add neondatabase/agent-skills
```

### Claude Code Plugin

You can also install the skills as a Claude Code plugin, which bundles both the neon-postgres agent skill and the [Neon MCP Server](https://mcp.neon.tech) for natural language database management:

```
/plugin marketplace add neondatabase/agent-skills
/plugin install neon-postgres@neon
```

After installation, you'll be prompted to authenticate with Neon via OAuth when you first use MCP tools.

The top-level `skills/` directory remains the source of truth. Plugin folders symlink only the skill directories they expose.

### Cursor Plugin

This repository also includes Cursor plugin packaging with the same scope as the Claude plugin (neon-postgres agent skill and Neon MCP Server)

Run this command in chat:

```text
/add-plugin neon-postgres
```

## Usage

Example prompts:

```
Get started with Neon
```

```
Recommend a connection method for this project
```

```
Set up Drizzle ORM with Neon
```

```
Set up Neon Auth for my Next.js app
```

```
Query the database using neon-js
```

```
Create a new Neon branch using the API
```

```
Use the serverless driver for edge functions
```

```
Give me a quick temporary Postgres database
```

```
Why is my Neon bill so high?
```
