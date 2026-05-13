# Over-50s Health Advisor

A Claude Code Agent definition for evidence-based, age-appropriate health, fitness, nutrition, and longevity guidance
for adults 50+. The agent works with local context files only and always recommends confirming advice with a healthcare
professional.

## Features

- Evidence-based guidance with citations and a Sources section
- Safety boundaries and red-flag referral policy
- Local context management via Markdown files
- Install via Claude Code plugin system (`/plugin install over-50s-health@ali5ter`)
- Automatic context file creation on first run

## Repository structure

This repository contains the agent definition and context templates for distribution. When installed via the plugin
system, the agent is managed by Claude Code and your personal context files are stored in your home directory.

```text
agents/
  advisor.md                       # Agent definition (source)
context/
  templates/                       # Reference context templates
    INITIAL_USER_INFORMATION.md
    CLIENT_HEALTH_CONTEXT.md
    CLIENT_PREFERENCES.md
    SESSION_NOTES.md
    SOURCES.md
  README.md
.claude-plugin/
  plugin.json                      # Plugin manifest
hooks/
  hooks.json                       # SessionStart hook (template sync)
hooks-handlers/
  sync-templates.sh                # Copies templates from plugin cache to ~/.claude/over-50s-health-advisor/templates/
migrate                            # Migration script for v2.x users
README.md
LICENSE
```

After installation, your personal context files are stored at:

```text
~/.claude/over-50s-health-advisor/
    context/                       # Your personal context files (auto-created on first run)
        ├── INITIAL_USER_INFORMATION.md
        ├── CLIENT_HEALTH_CONTEXT.md
        ├── CLIENT_PREFERENCES.md
        ├── SESSION_NOTES.md
        └── SOURCES.md
```

## Requirements

- Claude Code CLI v2.0.73 or later
- Uses Claude Opus 4.6 by default for highest reasoning quality; override with `/model` if preferred

## Install

Inside Claude Code, run:

```text
/plugin marketplace add ali5ter/claude-plugins
/plugin install over-50s-health@ali5ter
```

The first time you start a health conversation, the agent automatically creates your context files at
`~/.claude/over-50s-health-advisor/context/`.

## Uninstall

Inside Claude Code, run:

```text
/plugin uninstall over-50s-health@ali5ter
```

This removes the plugin and agent. Your personal context files are **not** removed. To delete them:

```bash
rm -rf ~/.claude/over-50s-health-advisor
```

## Migrating from v2.x

If you previously installed via `./install.sh`, run the migration script from this repo:

```bash
./migrate
```

This removes the old manually-installed agent file. Your context files are preserved. Then install via the plugin
commands above.

## Usage

After installation, context files are automatically created at `~/.claude/over-50s-health-advisor/context/` on your
first conversation.

1. Fill in `~/.claude/over-50s-health-advisor/context/INITIAL_USER_INFORMATION.md` and `CLIENT_PREFERENCES.md`
   with your information.
2. Keep `CLIENT_HEALTH_CONTEXT.md` and `SESSION_NOTES.md` current as new information is shared with the agent.
3. Maintain `SOURCES.md` as a curated reference list (the agent will add sources; you can remove low-quality ones
   and add high-quality evidence).
4. Use the agent from any directory in Claude Code. The agent will read and update these context files automatically.
5. Keep the "Last updated" dates accurate in each file.

## Invoking the Agent

The health advisor agent is invoked automatically when you ask a health-related question in Claude Code. You can
also target it directly using the `--agent` flag:

```bash
claude --agent over-50s-health:advisor
```

This sets the agent as the preferred delegate for the session. Claude Code routes health and wellness queries to it
automatically; for anything else, the default assistant responds.

Alternatively, just start Claude Code normally and ask a health question — the agent will activate based on your
query.

## Starting a Conversation

When you send your first message (even just "Hi"), the agent reads your context files and greets you with a brief
summary of your current health focus. If context files are missing, it will create them and prompt you to fill in
your initial information.

Once you've filled in your initial context files, you can begin interacting with the agent. Here are some ways to start:

**Initial Engagement:**

- "Where do you see the context files?" — the agent will analyze your context and provide a summary of your health
  profile, helping establish rapport.
- "Can you review my health information and suggest areas to focus on?"
- "What do you know about me so far?"

**Direct Queries:**

- "What strength training program would you recommend for me?"
- "Can you suggest a weekly meal plan that supports my goals?"
- "How can I improve my metabolic health based on my recent labs?"
- "What mobility exercises should I prioritize?"

**Specific Requests:**

- "Review my recent blood panel and explain what the trends mean"
- "Create a 4-week progressive workout plan for me"
- "Suggest supplements appropriate for my age and health status"

The agent will read your context files, provide evidence-based guidance with citations, and update your context files
as you share new information.

## Mobile and voice access

The agent can be used hands-free from a phone or tablet using two Claude Code features:

**Remote Control** — continues a local Claude Code session on any device:

1. Start a session on your Mac with the advisor agent active.
2. Run `/remote-control` to generate a session URL and QR code.
3. Scan the QR code in the Claude app or open the URL in a browser on your phone.
4. Your phone controls the local session with full access to your context files.

Your computer must stay on and the session must remain open. See the
[Claude Code Remote Control docs](https://code.claude.com/docs/en/remote-control) for details.

**Voice input** — speak your queries instead of typing:

Run `/voice` in your Claude Code session to enable voice input. Hold the spacebar to speak,
release to send. Transcription is free and does not count against rate limits. Responses are
text-only; voice output is not yet available.

Combined, `/remote-control` and `/voice` let you speak health queries from your phone while
the agent reads and updates your context files on your computer in the background.

> Available on Pro, Max, Team, and Enterprise plans.

## Safety and medical boundaries

- Educational guidance only, not diagnosis.
- Immediate referral for emergency symptoms.
- Always include a reminder to confirm with a healthcare professional.

## Evidence and citations

- Use credible, evidence-based sources.
- Provide citations with links in every response that includes recommendations.
- End responses with a **Sources** section.

## License

MIT License, Copyright (c) 2026 Alister Lewis-Bowen.
