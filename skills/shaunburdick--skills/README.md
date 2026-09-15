# Agent Skills

A personal collection of [Agent Skills](https://agentskills.io/) for AI coding agents.

## Install

```bash
# Install all skills
npx skills add shaunburdick/skills

# List available skills without installing
npx skills add shaunburdick/skills --list

# Install a specific skill
npx skills add shaunburdick/skills --skill spec-driven-development

# Install globally (available across all projects)
npx skills add shaunburdick/skills -g

# Install to specific agents only
npx skills add shaunburdick/skills -a claude-code -a opencode
```

## Available Skills

### [spec-driven-development](skills/spec-driven-development/)

Structured spec-driven development workflow: clarify requirements, write specs, plan architecture, break into tasks, then implement. Use when starting a new feature, building from scratch, or when requirements are unclear.

### [spec-kit](skills/spec-kit/)

Practical setup and usage guide for the spec-kit CLI — covers installation, project initialization for Claude Code and OpenCode, the `/speckit.*` slash commands, helper scripts, and detecting current workflow state. Pairs with the `spec-driven-development` skill: this one covers the tooling, that one covers the methodology.

### [git-safety](skills/git-safety/)

Enforces safe git practices for AI coding agents. Defines branch protection rules (never commit to main/master/develop), commit policies, amend rules, and recommended agent permissions. Use when configuring any agent that writes code and commits to git repositories.

### [code-quality](skills/code-quality/)

Enforces non-negotiable code quality standards: zero lint suppressions (`eslint-disable`, `@ts-ignore`, etc.), strict TypeScript type safety (no `any`), and a mandatory pre-commit verification protocol. Use when any agent writes, edits, or reviews code.

### [style](skills/style/)

Install @shaunburdick's personal style configuration: shared `.editorconfig` for any project, plus `eslint-config-shaunburdick` for JavaScript/TypeScript projects.

### [github-actions](skills/github-actions/)

Author secure, maintainable GitHub Actions workflows with security-first defaults. Every third-party action is pinned to a full commit SHA (never a mutable tag), permissions are least-privilege, and dependencies stay current with Dependabot. Covers supply-chain hardening, reusable workflows vs. composite actions, OIDC auth, and the OpenSSF Scorecard. Use for any CI/CD or workflow automation task.

### [web-component-design](skills/web-component-design/)

Design, build, test, and integrate standards-based custom elements and framework-agnostic Web Components. Covers lifecycle timing, Light DOM and Shadow DOM composition, accessibility, registration, SSR boundaries, CSS integration, React interoperability, Vitest/Playwright testing, and package design. Use when building web components, custom elements, or any work involving `customElements.define`, `HTMLElement`, slots, or `attachShadow`.

## Skill Structure

Each skill lives in `skills/<skill-name>/` and contains:

```
skills/
└── skill-name/
    ├── SKILL.md          # Required: YAML frontmatter + agent instructions
    ├── scripts/          # Optional: helper scripts the agent can run
    ├── references/       # Optional: supplementary documentation
    └── assets/           # Optional: templates, schemas, static resources
```

### `SKILL.md` Format

```markdown
---
name: skill-name
description: What this skill does and when to use it. Be specific — agents use this to decide when to activate the skill.
license: MIT
metadata:
  author: shaunburdick
  version: "1.0.0"
---

# Skill Title

Instructions for the agent...
```

See the [Agent Skills specification](https://agentskills.io/specification) for the full format reference.

## Contributing / Forking

Feel free to fork this repo and add your own skills. The `skills/` directory is the canonical location the `skills` CLI searches.

## License

MIT
