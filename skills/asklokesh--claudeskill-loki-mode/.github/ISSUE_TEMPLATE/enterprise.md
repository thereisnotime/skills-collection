---
name: Enterprise Issue
about: Report issues with enterprise features (OTEL, OIDC, RBAC, audit, policies, integrations)
title: "[Enterprise] "
labels: enterprise
assignees: ''
---

## Enterprise Feature

Which enterprise feature is affected?

- [ ] TLS / Certificates
- [ ] OIDC / SSO Authentication
- [ ] RBAC / Authorization
- [ ] OTEL / Observability
- [ ] Policy Engine
- [ ] Audit Trail
- [ ] Jira Integration
- [ ] Linear Integration
- [ ] Slack Integration
- [ ] Teams Integration
- [ ] GitHub Actions Integration
- [ ] Dashboard API v2
- [ ] MCP Server
- [ ] A2A Protocol
- [ ] Python SDK (`loki-mode-sdk`)
- [ ] TypeScript SDK (`loki-mode-sdk`)
- [ ] Other: ___

## Description

Describe the issue. Include error messages, unexpected behavior, or missing functionality.

## Configuration

Which environment variables are set? (redact secrets)

```bash
LOKI_TLS_ENABLED=
LOKI_OIDC_PROVIDER=
LOKI_AUDIT_ENABLED=
LOKI_METRICS_ENABLED=
LOKI_OTEL_ENDPOINT=
LOKI_JIRA_URL=
LOKI_SLACK_BOT_TOKEN=(set/unset)
LOKI_TEAMS_WEBHOOK_URL=(set/unset)
```

## Steps to Reproduce

1. Set environment variables: `...`
2. Run: `...`
3. Observe: `...`

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include relevant log output.

## Environment

- **OS:** (e.g., macOS 15.3, Ubuntu 24.04)
- **Loki Mode version:** (`loki version`)
- **Node.js version:** (`node --version`)
- **Python version:** (`python3 --version`)
- **Installation method:** (npm, Docker, Homebrew, manual)
- **Dashboard running:** (yes/no, port)

## Logs

Include relevant logs from `.loki/logs/` or dashboard output:

```
Paste log output here
```
