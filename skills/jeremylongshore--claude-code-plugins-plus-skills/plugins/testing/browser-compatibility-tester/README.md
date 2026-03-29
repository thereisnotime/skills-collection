# Browser Compatibility Tester

Cross-browser and cross-device testing powered by Playwright locally and four major cloud platforms (BrowserStack, Sauce Labs, LambdaTest, Kobiton) for real-device validation. Tests CSS rendering, JavaScript API support, layout consistency, and interactive behavior across Chrome, Firefox, Safari, and Edge on desktop and mobile.

## Installation

```bash
/plugin install browser-compatibility-tester@claude-code-plugins-plus
```

## Usage

```bash
/browser-test
# or shortcut
/bt
```

## Supported Providers

| Provider | Strength | Best For |
|----------|----------|----------|
| **Playwright** (local) | Zero setup, fast feedback | Development, CI gating |
| **BrowserStack** | Broadest browser/OS matrix (3,000+ combos) | Full regression sweeps |
| **Sauce Labs** | Deep CI/CD integrations, Sauce Connect tunnel | Enterprise pipelines |
| **LambdaTest** | Smart testing, auto-healing selectors | Teams scaling fast |
| **Kobiton** | Real physical devices, scriptless automation | Mobile-first validation |

## Features

- **Multi-browser matrix** -- Chrome, Firefox, Safari, Edge across desktop and mobile viewports
- **Local-first workflow** -- Playwright projects with parallel execution; no cloud account needed to start
- **Cloud real-device testing** -- Connect to BrowserStack, Sauce Labs, LambdaTest, or Kobiton when emulation is not enough
- **Screenshot comparison** -- Capture per-browser screenshots and flag visual regressions
- **Compatibility scanning** -- Grep for modern CSS/JS APIs and cross-reference against caniuse data
- **CI/CD integration** -- GitHub Actions and CircleCI workflow examples for every provider
- **Accessibility checks** -- Run axe-core audits per browser to catch engine-specific a11y gaps

## Files

- `commands/browser-test.md` -- `/browser-test` slash command
- `skills/testing-browser-compatibility/SKILL.md` -- Auto-activating skill
- `skills/testing-browser-compatibility/references/cloud-providers.md` -- Provider auth, API, and capabilities reference
- `skills/testing-browser-compatibility/references/device-matrix.md` -- Browser/device/OS matrix patterns
- `skills/testing-browser-compatibility/references/ci-cd-integration.md` -- CI/CD workflow examples for all providers

## License

MIT
