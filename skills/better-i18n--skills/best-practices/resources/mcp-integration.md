# MCP Integration

Use Better i18n tools directly in your AI coding assistant.

## Overview

The Better i18n MCP server enables AI assistants like Claude to:
- Query and search translation keys
- Create and update translations
- Delete obsolete keys
- Publish changes to CDN or GitHub
- Monitor sync job status

## Installation

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "better-i18n": {
      "command": "npx",
      "args": ["-y", "@better-i18n/mcp@latest"],
      "env": {
        "BETTER_I18N_API_KEY": "your-api-key",
        "BETTER_I18N_API_URL": "https://dash.better-i18n.com/api"
      }
    }
  }
}
```

### Getting API Key

1. Go to Better i18n Dashboard
2. Navigate to **Settings → API Keys**
3. Create a new key

## Project Identifier

All tools require `project` in the format `org-slug/project-slug`:

```
"project": "my-company/my-app"
```

Find your slugs in the Dashboard → Project Settings.

## Available Tools

### listProjects

List all projects you have access to. Call this first to find your project identifier.

```
No parameters required.
```

### getProject

Get project structure: namespaces, languages, coverage stats.

```
Parameters:
- project: "org-slug/project-slug" (required)
```

### getAllTranslations

Get translations with filtering. **Use this to get key UUIDs before calling updateKeys.**

```
Parameters:
- project: "org-slug/project-slug" (required)
- languages: ["tr", "de"] — filter by languages
- search: "login" — search in source text or translations
- status: "missing" | "draft" | "approved" | "all" (default: "all")
- limit: max keys to return (1–200, default: 100)
- namespaces: ["auth", "common"] — filter by namespace
- keys: ["auth.login.title"] — fetch specific keys by name
```

**Returns:** Keys with `id` (UUID), `key`, `namespace`, `sourceText`, `translations` map, plus pagination metadata:
- `returned`: keys in this response
- `total`: total keys in DB matching your filters
- `hasMore`: `true` when more keys exist — use narrower filters instead of increasing limit

> ⚠️ **Large projects:** If `hasMore: true`, do NOT retry with a higher limit. Instead, narrow your
> query using `namespaces`, `search`, `keys[]`, or `status: "missing"` to fetch specific subsets.

### listKeys

Browse keys with pagination. Use `getAllTranslations` when you need actual text.

```
Parameters:
- project: "org-slug/project-slug" (required)
- search: key name search
- missingLanguage: "tr" — find keys missing this language
- page: page number (default: 1)
- limit: per page (default: 20, max: 250)
```

### createKeys

Create new translation keys with source text and optional translations.

```
Parameters:
- project: "org-slug/project-slug" (required)
- k: array of keys to create
  - n: key name (e.g., "submit_button", "nav.home") [required]
  - ns: namespace (default: "default")
  - v: source language text
  - t: target translations as { "tr": "Turkish text", "de": "German text" }
```

**Example:**
```json
{
  "project": "my-company/my-app",
  "k": [
    {
      "n": "checkout.title",
      "ns": "common",
      "v": "Checkout",
      "t": { "tr": "Ödeme", "de": "Kasse" }
    }
  ]
}
```

### updateKeys

Update translations for existing keys.

> ⚠️ **IMPORTANT:** You must provide the key `id` (UUID) — not the key name.
> Always call `getAllTranslations` first to get the `id` values.

```
Parameters:
- project: "org-slug/project-slug" (required)
- t: array of translation updates
  - id: key UUID from getAllTranslations/listKeys response [required]
  - l: language code (e.g., "tr", "de") [required]
  - t: translation text [required]
  - s: true if updating source language text
  - st: status (e.g., "approved")
```

**Correct workflow:**
```
1. getAllTranslations → get keys with id field
2. updateKeys with those UUIDs
```

**Example:**
```json
{
  "project": "my-company/my-app",
  "t": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "l": "tr",
      "t": "Giriş Yap",
      "st": "approved"
    }
  ]
}
```

### deleteKeys

Soft-delete translation keys by UUID (recoverable until published).

```
Parameters:
- project: "org-slug/project-slug" (required)
- keyIds: array of key UUIDs to delete
```

### addLanguage

Add a new target language to the project.

```
Parameters:
- project: "org-slug/project-slug" (required)
- languageCode: ISO 639-1 code (e.g., "fr", "ja")
```

### getPendingChanges

Preview what will be deployed. **Always call before publishTranslations.**

```
Parameters:
- project: "org-slug/project-slug" (required)
```

**Returns:** Summary of pending translations, deleted keys, publish destination.

### publishTranslations

Deploy pending changes to CDN or GitHub.

```
Parameters:
- project: "org-slug/project-slug" (required)
- translations: optional array of specific {keyId, languageCode} to publish
  (omit to publish ALL pending changes)
```

**Returns:** `syncJobIds` — use with `getSync` to verify completion.

### getSyncs

List recent sync/publish jobs.

```
Parameters:
- project: "org-slug/project-slug" (required)
- limit: number of jobs (default: 10, max: 50)
- status: filter by status
- type: filter by type ("batch_publish", "source_sync", etc.)
```

### getSync

Get detailed status of a specific sync job.

```
Parameters:
- syncId: sync job ID from publishTranslations response
```

## Standard Workflow

```
1. READ:    getProject → understand project structure (languages, namespaces)
2. QUERY:   getAllTranslations → get current state + key UUIDs
3. WRITE:   createKeys/updateKeys → save changes (database only)
4. VERIFY:  getPendingChanges → confirm what will deploy
5. DEPLOY:  publishTranslations → push to production
6. CONFIRM: getSync(syncId) → verify deployment succeeded
```

## Usage Patterns

### Adding Keys While Coding

```
You: Create these keys for the checkout page:
- checkout.title: "Checkout"
- checkout.placeOrder: "Place Order"

Claude: [Uses createKeys to add all keys]
```

### Translating to a New Language

```
You: Translate all auth namespace keys to German

Claude:
1. getAllTranslations with namespaces: ["auth"], languages: ["de"]
2. updateKeys with translated text and key UUIDs
```

### Updating Existing Translations

```
You: The "Submit" button should say "Save Changes" in Turkish

Claude:
1. getAllTranslations with search: "Submit", languages: ["tr"]
2. updateKeys with the id from step 1
```

### Publishing Changes

```
You: Publish the pending changes

Claude:
1. getPendingChanges → review what will be deployed
2. publishTranslations → deploy to CDN/GitHub
3. getSync(syncId) → confirm success
```

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `UNAUTHORIZED` | Invalid or expired API key | Generate new key in dashboard |
| `NOT_FOUND` | Project/key not found | Check project slug and key UUID |
| `BAD_REQUEST: id Required` | updateKeys called without UUID | Call getAllTranslations first to get id |
| `BAD_REQUEST: limit too_small` | limit < 1 (e.g., limit: 0) | Use limit 1–200; do NOT use 0 |
| `FORBIDDEN` | No access to project | Check organization membership |

## Best Practices

1. **Get UUIDs first** — Always call `getAllTranslations` before `updateKeys`
2. **Batch operations** — Create/update multiple keys in one call
3. **Verify before publish** — Always call `getPendingChanges` first
4. **Set status explicitly** — Mark translations as `approved` when ready
5. **Use namespaces** — Organize keys logically (auth, common, checkout, etc.)
