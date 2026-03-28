---
title: "Persistent GitHub authentication for agent-browser using named sessions"
category: integrations
date: 2026-03-22
tags:
  - agent-browser
  - github
  - authentication
  - chrome
  - session-persistence
  - lightpanda
related_to:
  - plugins/compound-engineering/skills/feature-video/SKILL.md
  - plugins/compound-engineering/skills/agent-browser/SKILL.md
  - plugins/compound-engineering/skills/agent-browser/references/authentication.md
  - plugins/compound-engineering/skills/agent-browser/references/session-management.md
---

# agent-browser Chrome Authentication for GitHub

## Problem

agent-browser needs authenticated access to GitHub for workflows like the native video
upload in the feature-video skill. Multiple authentication approaches were evaluated
before finding one that works reliably with 2FA, SSO, and OAuth.

## Investigation

| Approach | Result |
|---|---|
| `--profile` flag | Lightpanda (default engine on some installs) throws "Profiles are not supported with Lightpanda". Must use `--engine chrome`. |
| Fresh Chrome profile | No GitHub cookies. Shows "Sign up for free" instead of comment form. |
| `--auto-connect` | Requires Chrome pre-launched with `--remote-debugging-port`. Error: "No running Chrome instance found" in normal use. Impractical. |
| Auth vault (`auth save`/`auth login`) | Cannot handle 2FA, SSO, or OAuth redirects. Only works for simple username/password forms. |
| `--session-name` with Chrome engine | Cookies auto-save/restore. One-time headed login handles any auth method. **This works.** |

## Working Solution

### One-time setup (headed, user logs in manually)

```bash
# Close any running daemon (ignores engine/option changes when reused)
agent-browser close

# Open GitHub login in headed Chrome with a named session
agent-browser --engine chrome --headed --session-name github open https://github.com/login
# User logs in manually -- handles 2FA, SSO, OAuth, any method

# Verify auth
agent-browser open https://github.com/settings/profile
# If profile page loads, auth is confirmed
```

### Session validity check (before each workflow)

```bash
agent-browser close
agent-browser --engine chrome --session-name github open https://github.com/settings/profile
agent-browser get title
# Title contains username or "Profile" -> session valid, proceed
# Title contains "Sign in" or URL is github.com/login -> session expired, re-auth
```

### All subsequent runs (headless, cookies persist)

```bash
agent-browser --engine chrome --session-name github open https://github.com/...
```

## Key Findings

### Engine requirement

MUST use `--engine chrome`. Lightpanda does not support profiles, session persistence,
or state files. Any workflow that uses `--session-name`, `--profile`, `--state`, or
`state save/load` requires the Chrome engine.

Include `--engine chrome` explicitly in every command that uses an authenticated session.
Do not rely on environment defaults -- `AGENT_BROWSER_ENGINE` may be set to `lightpanda`
in some environments.

### Daemon restart

Must run `agent-browser close` before switching engine or session options. A running
daemon ignores new flags like `--engine`, `--headed`, or `--session-name`.

### Session lifetime

Cookies expire when GitHub invalidates them (typically weeks). Periodic re-authentication
is required. The feature-video skill handles this by checking session validity before
the upload step and prompting for re-auth only when needed.

### Auth vault limitations

The auth vault (`agent-browser auth save`/`auth login`) can only handle login forms with
visible username and password fields. It cannot handle:

- 2FA (TOTP, SMS, push notification)
- SSO with identity provider redirect
- OAuth consent flows
- CAPTCHA
- Device verification prompts

For GitHub and most modern services, use the one-time headed login approach instead.

### `--auto-connect` viability

Impractical for automated workflows. Requires Chrome to be pre-launched with
`--remote-debugging-port=9222`, which is not how users normally run Chrome.

## Prevention

### Skills requiring auth must declare engine

State the engine requirement in the Prerequisites section of any skill that needs
browser auth. Include `--engine chrome` in every `agent-browser` command that touches
an authenticated session.

### Session check timing

Perform the session check immediately before the step that needs auth, not at skill
start. A session valid at start may expire during a long workflow (video encoding can
take minutes).

### Recovery without restart

When expiry is detected at upload time, the video file is already encoded. Recovery:
re-authenticate, then retry only the upload step. Do not restart from the beginning.

### Concurrent sessions

Use `--session-name` with a semantically descriptive name (e.g., `github`) when multiple
skills or agents may run concurrently. Two concurrent runs sharing the default session
will interfere with each other.

### State file security

Session state files in `~/.agent-browser/sessions/` contain cookies in plaintext.
Do not commit to repositories. Add to `.gitignore` if the session directory is inside
a repo tree.

## Integration Points

This pattern is used by:
- `feature-video` skill (GitHub native video upload)
- Any future skill requiring authenticated GitHub browser access
- Potential use for other OAuth-protected services (same pattern, different session name)
