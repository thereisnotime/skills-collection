# B12 Website Generator

**Plugin:** `b12-claude-plugin` | **Skill:** `website-generator`

B12 Website Generator is a plugin by [B12.io](https://www.b12.io) that allows you to create a professional, engaging, and user-friendly website in seconds using AI. Provide a name for your project or business along with a brief description _(goals, structure, etc.)_ and Claude handles the rest.

## What It Does

The `b12-claude-plugin` ships a single auto-activating skill (`website-generator`). Claude uses this skill to gather a business name and description from the user, then generates a pre-populated B12 signup link that instantly drafts a production-ready website.

## Installation

### Claude.ai

1. Download the [website-generator.zip](https://github.com/b12io/b12-claude-plugin/raw/main/website-generator.zip) file
2. Go to **claude.ai** > **Settings** > **Skills**
3. Upload the zip file

### Claude Code

```bash
claude --plugin-dir /path/to/b12-claude-plugin
```

### Claude Cowork

Install through the plugin manager in Claude Desktop.

## Usage

```
"Create a website for my consulting firm"
"Create a website for a software development agency"
"Create a personal website"
"Create a website for a cat café"
```

Claude will automatically generate a link to a production-ready website. Click it to sign up and publish for free.

## Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `website-generator` | Auto-activating | Collects a business name and description, then generates a B12 signup link for an instant website draft |

## Source

Maintained by [B12.io](https://www.b12.io). Source: https://github.com/b12io/b12-claude-plugin

## License

Apache-2.0
