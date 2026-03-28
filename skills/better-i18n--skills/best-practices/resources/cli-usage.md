# CLI Usage

The Better i18n CLI provides a "Senior Tooling" experience for managing translations.

## Installation

```bash
npm install -g @better-i18n/cli
# or
npx @better-i18n/cli <command>
```

## Configuration

Create `i18n.config.ts` in your project root:

```typescript
export const project = "your-org/your-project";
export const defaultLocale = "en";

export const i18nWorkspaceConfig = {
  lint: {
    include: ["src/**/*.tsx", "src/**/*.ts"],
    exclude: ["**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "jsx-text": "warning",      // Hardcoded JSX text
      "template-literal": "error" // Template literals with text
    }
  }
};
```

## Commands

### `scan` - Detect Hardcoded Strings

Scans your codebase using AST parsing to find strings that need translation.

```bash
better-i18n scan
```

**Features:**
- Lexical scope tracking - Detects both `useTranslations()` (client) and `getTranslations()` (server)
- Smart detection - Differentiates UI text from developer symbols automatically
- CI/CD ready - Exit codes for pipeline integration
- Pre-commit hooks - Can block commits with untranslated strings

**Output:**
```
Scanning src/**/*.tsx...

Found 12 hardcoded strings:

  src/components/Header.tsx:15
    "Welcome back" → Wrap with t('header.welcome')

  src/pages/checkout.tsx:42
    "Complete your order" → Wrap with t('checkout.title')

Summary: 12 strings in 5 files need attention
```

**Options:**
```bash
better-i18n scan --verbose        # Show detailed scope analysis
better-i18n scan --json           # Output as JSON for automation
better-i18n scan --fix            # Auto-wrap strings (interactive)
```

### `check` - Audit Translation Coverage

Interactive audit tool with three modes:

```bash
better-i18n check              # Full comparison
better-i18n check:missing      # Keys in code but not remote
better-i18n check:unused       # Keys in remote but not code
```

**Check Missing (CI/CD recommended):**
```bash
better-i18n check:missing

Missing keys (used in code but not in Better i18n):
  ✗ checkout.shipping.title
  ✗ checkout.shipping.description
  ✗ checkout.payment.cardNumber

3 missing keys found
Exit code: 1
```

**Check Unused:**
```bash
better-i18n check:unused

Unused keys (in Better i18n but not in code):
  ? legacy.oldFeature.title
  ? legacy.oldFeature.description

2 potentially unused keys
Consider removing or verify dynamic usage
```

### `sync` - Compare Local vs Remote

Comprehensive comparison between local `t()` calls and cloud storage.

```bash
better-i18n sync
```

**Output:**
```
Syncing with better-i18n.com...

Local keys:     156
Remote keys:    152
Missing:        4
Unused:         0

Missing keys:
├── checkout/
│   ├── shipping.title
│   └── shipping.description
└── common/
    ├── errors.network
    └── errors.timeout

Run 'better-i18n push' to add missing keys
```

**Options:**
```bash
better-i18n sync --json          # JSON output for automation
better-i18n sync --verbose       # Include key values
```

### `push` - Upload Keys to Platform

Push new keys from your codebase to Better i18n.

```bash
better-i18n push
```

**Options:**
```bash
better-i18n push --dry-run       # Preview without uploading
better-i18n push --locale=en     # Push specific locale only
```

### `pull` - Download Translations

Pull translations from Better i18n to local files.

```bash
better-i18n pull
```

**Options:**
```bash
better-i18n pull --locale=all    # All locales
better-i18n pull --locale=tr,de  # Specific locales
better-i18n pull --namespace=common  # Specific namespace
```

## CI/CD Integration

### GitHub Actions

```yaml
name: i18n Check

on: [push, pull_request]

jobs:
  check-translations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Check missing translations
        run: bunx @better-i18n/cli check:missing
        env:
          BETTER_I18N_API_KEY: ${{ secrets.BETTER_I18N_API_KEY }}
```

### Pre-commit Hook

```bash
# .husky/pre-commit
bunx @better-i18n/cli scan --quiet
```

Exit codes:
- `0` - All good
- `1` - Issues found (missing keys, hardcoded strings)

## Verbose Mode

For debugging, use `--verbose` to see detailed analysis:

```bash
better-i18n scan --verbose

[Scope Analysis]
  src/components/Header.tsx
    Line 5: useTranslations('header') → namespace: header
    Line 12: t('title') → key: header.title ✓
    Line 15: "Welcome" → HARDCODED ✗

[Summary]
  Files scanned: 45
  Namespaces found: 8
  Keys probed: 156
  Hardcoded strings: 12
```

## Terminal Tips

**Cmd+Click** on any file path in terminal output to jump directly to the code in VS Code!

```
src/components/Header.tsx:15    ← Cmd+Click to open
```

## Workflow Example

1. **Scan** - Find hardcoded strings
   ```bash
   better-i18n scan
   ```

2. **Wrap** - Replace with `t()` calls
   ```typescript
   // Before
   <h1>Welcome back</h1>

   // After
   <h1>{t('header.welcome')}</h1>
   ```

3. **Check** - Verify keys exist remotely
   ```bash
   better-i18n check:missing
   ```

4. **Push** - Upload new keys
   ```bash
   better-i18n push
   ```

5. **Translate** - Use dashboard or AI

6. **Pull** - Download translations
   ```bash
   better-i18n pull
   ```

## Dynamic Keys

The CLI detects dynamic patterns like template literals:

```typescript
// Detected as dynamic - won't flag as missing
const key = `products.${category}.title`;
t(key);

// Also detected
t(`errors.${errorCode}`);
```

These are tracked but not flagged as missing since they resolve at runtime.
