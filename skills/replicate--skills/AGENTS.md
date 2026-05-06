# Replicate Skills: Agent Notes

## Purpose

This repo publishes Agent Skills for Replicate: focused guides for finding, comparing, running, building, publishing, and prompting AI models.

## Files that matter

- `skills/find-models/SKILL.md` — search, collections, schemas, picking the right model.
- `skills/compare-models/SKILL.md` — evaluating models by cost, speed, quality, and capabilities.
- `skills/run-models/SKILL.md` — predictions, polling, webhooks, streaming, file I/O, concurrency, multi-model workflows.
- `skills/build-models/SKILL.md` — packaging custom models with Cog: cog.yaml, predict.py, weights loading, cold-boot tricks.
- `skills/publish-models/SKILL.md` — pushing models to Replicate with cog push and cog-safe-push, and CI/CD for releases.
- `skills/prompt-images/SKILL.md` — prompting techniques for image generation and editing models.
- `skills/prompt-videos/SKILL.md` — prompting techniques for video generation models.
- `script/lint` — validates the skills.
- `.mcp.json` — points to the remote MCP server.
- `.claude-plugin/` — marketplace metadata for Claude Code.

## Editing guidelines

- Keep each `SKILL.md` concise and practical. Prefer bullet lists over long prose.
- Every code snippet must be runnable. The test runner executes them all.
- Treat `https://api.replicate.com/openapi.json` as the source of truth for API details.
- Do not add language-specific client guidance unless explicitly requested.

## Linting

```
script/lint skills/find-models
script/lint skills/compare-models
script/lint skills/run-models
script/lint skills/build-models
script/lint skills/publish-models
script/lint skills/prompt-images
script/lint skills/prompt-videos
```
