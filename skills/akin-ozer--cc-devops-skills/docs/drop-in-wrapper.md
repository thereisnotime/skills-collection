# Drop-In Wrapper for `anthropics/claude-code-action@v1`

This repository now publishes a public GitHub Action wrapper so you can swap:

- `uses: anthropics/claude-code-action@v1`
- `uses: akin-ozer/cc-devops-skills@v1`

The wrapper keeps the upstream input/output surface and behavior, while adding optional DevOps skill injection.

## What stays compatible

- All current `anthropics/claude-code-action@v1` inputs are mirrored in [`action.yml`](../action.yml).
- All upstream outputs are mirrored:
  - `execution_file`
  - `branch_name`
  - `github_token`
  - `structured_output`
  - `session_id`
- The wrapper calls `anthropics/claude-code-action@v1` (tag), not a pinned SHA.

## Extension inputs

These are additive and optional:

- `inject_devops_skills` (default: `"true"`)
- `devops_marketplace_url` (default: `https://github.com/akin-ozer/cc-devops-skills.git`)
- `devops_plugin_name` (default: `devops-skills@akin-ozer`)

## Merge semantics

When `inject_devops_skills: "true"`:

- `plugin_marketplaces` becomes:
  1. `devops_marketplace_url`
  2. user-provided `plugin_marketplaces` (if any)
- `plugins` becomes:
  1. `devops_plugin_name`
  2. user-provided `plugins` (if any)

When `inject_devops_skills: "false"`:

- `plugin_marketplaces` and `plugins` are passed through exactly as provided by the caller.

## Minimal usage

```yaml
- uses: akin-ozer/cc-devops-skills@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    prompt: |
      REPO: ${{ github.repository }}
      PR NUMBER: ${{ github.event.pull_request.number }}
      Review this PR.
```

## Pure passthrough mode

```yaml
- uses: akin-ozer/cc-devops-skills@v1
  with:
    inject_devops_skills: "false"
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    prompt: "Review this PR"
```

## Drift control

Use the compatibility script to ensure wrapper parity with upstream:

```bash
./scripts/check_upstream_action_surface.sh
```

It compares upstream and local action surfaces for:

- input names
- input `required` values
- input `default` values
- output names

Allowed local-only input additions are limited to the three extension inputs listed above.

The repository also runs a scheduled compatibility workflow:

- [`.github/workflows/compat-check.yml`](../.github/workflows/compat-check.yml)

## Release strategy

- Publish immutable semantic tags (for example, `v1.0.0`, `v1.0.1`).
- Move major tag `v1` to the newest `v1.x.y` wrapper release.
- The wrapper itself calls `anthropics/claude-code-action@v1`, so consumers on `akin-ozer/cc-devops-skills@v1` follow upstream `v1` pace while still getting wrapper updates.

## Verification checklist

Use these checks before releasing:

1. Compatibility smoke: replace only `uses:` with `akin-ozer/cc-devops-skills@v1` in a known-good upstream workflow and confirm behavior remains unchanged.
2. Skill injection smoke: run with defaults and verify `plugin_marketplaces/plugins` are populated with DevOps defaults.
3. Opt-out smoke: set `inject_devops_skills: "false"` and confirm passthrough behavior.
4. Merge behavior smoke: set custom `plugin_marketplaces/plugins` and confirm DevOps defaults are prepended.
5. IaC example linting: run `bash devops-skills-plugin/skills/github-actions-validator/scripts/validate_workflow.sh --lint-only examples/github-actions/iac-pr-review.yml`.
