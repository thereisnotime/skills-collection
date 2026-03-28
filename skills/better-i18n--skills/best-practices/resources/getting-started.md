# Getting Started with Better i18n

Set up internationalization for your application in minutes.

## Overview

Better i18n is a **GitHub-first localization platform** that:
- Automatically discovers translation keys via AST parsing
- Provides AI translation with human approval workflow
- Delivers translations via global CDN
- Integrates with your existing GitHub workflow

## Prerequisites

- A Better i18n account (sign up at [better-i18n.com](https://better-i18n.com))
- Your application codebase (React, Next.js, Vite, or any JavaScript framework)
- (Optional) GitHub repository for sync integration

## Quick Start

### 1. Create an Organization

Organizations are workspaces that contain your projects and team members.

```
Dashboard → Create Organization → Enter name → Create
```

### 2. Create a Project

Each project represents one application or product.

```
Organization → New Project → Configure:
  - Name: "My App"
  - Source Language: English (en)
  - Target Languages: Turkish (tr), German (de), etc.
```

### 3. Configure Your Project

Create `i18n.config.ts` in your project root:

```typescript
// i18n.config.ts
export const project = "your-org/your-project";
export const defaultLocale = "en";

export const i18nWorkspaceConfig = {
  lint: {
    include: ["src/**/*.tsx", "src/**/*.ts"],
    exclude: ["**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "jsx-text": "warning"
    }
  }
};
```

This file is the **single source of truth** for:
- CLI commands
- SDK configuration
- MCP server

### 4. Scan Your Codebase

Find hardcoded strings that need translation:

```bash
npx @better-i18n/cli scan
```

The CLI uses AST parsing to detect UI text vs developer symbols automatically.

### 5. Choose Your Workflow

**CDN-First (Recommended for new projects)**
- Upload JSON files directly
- Edit in dashboard
- Publish to CDN instantly
- No GitHub required

**GitHub-Connected**
- Sync with your repository
- Changes create PRs
- Version-controlled translations
- Team code review workflow

## File Structure

Better i18n automatically detects your translation file structure:

| Format | Example Path | Structure |
|--------|-------------|-----------|
| Flat JSON | `/locales/en.json` | `{"key": "value"}` |
| Namespaced | `/locales/en/common.json` | Filename = namespace |
| Nested | `/locales/en.json` | `{"namespace": {"key": "value"}}` |

### Recommended Structure (Namespaced)

```
locales/
├── en/
│   ├── common.json      # Shared UI elements
│   ├── auth.json        # Authentication
│   └── dashboard.json   # Dashboard-specific
└── tr/
    ├── common.json
    ├── auth.json
    └── dashboard.json
```

## Adding Translations

### Via Dashboard

1. Navigate to your project
2. Click "Add Key"
3. Enter key name: `common.welcome`
4. Enter source text: "Welcome to our app"
5. Save

### Via CLI

```bash
# Push keys from your codebase
npx @better-i18n/cli push
```

### Via MCP Tools

If using Claude, Cursor, or another AI assistant:

```json
{
  "tool": "createKeys",
  "project": "my-org/my-app",
  "keys": [
    {
      "key": "welcome.title",
      "namespace": "common",
      "sourceText": "Welcome to our app"
    }
  ]
}
```

## Install SDK

### Next.js

```bash
npm install @better-i18n/next
```

```typescript
// i18n.config.ts
import { createI18n } from '@better-i18n/next';

export const i18n = createI18n({
  project: "your-org/your-project",
  defaultLocale: "en",
  localePrefix: "as-needed"  // /about (en), /tr/about (tr)
});
```

### React/Vite

```bash
npm install @better-i18n/use-intl
```

```typescript
import { IntlProvider } from '@better-i18n/use-intl';

function App() {
  return (
    <IntlProvider project="your-org/your-project" locale="en">
      <YourApp />
    </IntlProvider>
  );
}
```

## CDN URLs

Once published, translations are available at:

```
https://cdn.better-i18n.com/{org}/{project}/manifest.json
https://cdn.better-i18n.com/{org}/{project}/{locale}.json
https://cdn.better-i18n.com/{org}/{project}/{locale}/{namespace}.json
```

## Next Steps

- [CLI Usage](./cli-usage.md) - Master scan, check, sync commands
- [Key Management](./key-management.md) - Organize your translation structure
- [AI Translation](./ai-translation.md) - Translate content with AI
- [SDK Integration](./sdk-integration.md) - Connect your React/Next.js app

## Common Issues

### "Project not found"

Ensure you're using the correct project identifier format: `organization-slug/project-slug`

### "Unauthorized"

Check your API key has the correct scopes. Generate a new key from Dashboard → Settings → API Keys.

### "Invalid file format"

Better i18n expects valid JSON. Validate your files:

```bash
cat locales/en.json | jq .
```

### Hardcoded strings not detected

Make sure your file patterns are correct in `i18n.config.ts`:

```typescript
lint: {
  include: ["src/**/*.tsx"],  // Check this matches your structure
}
```
