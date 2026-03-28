# Key Management

Organize translation keys for maintainability and scalability.

## Key Naming Conventions

### Use Dot Notation

Structure keys hierarchically:

```
✅ Good
common.buttons.submit
auth.login.title
auth.login.errors.invalidEmail
dashboard.widgets.revenue.title

❌ Bad
submitButton
loginTitle
invalid_email_error
revenue-widget-title
```

### Be Descriptive

```
✅ Good
checkout.payment.cardNumber.label
checkout.payment.cardNumber.placeholder
checkout.payment.cardNumber.error.invalid

❌ Bad
label1
input_placeholder
error_message
```

### Use Context Prefixes

```
page.home.hero.title          # Page-specific
component.navbar.links.about  # Component-specific
common.actions.save           # Shared across app
email.welcome.subject         # Email templates
error.network.timeout         # Error messages
toast.success.saved           # Notifications
```

## Namespaces

Namespaces group related keys and enable code-splitting.

### Common Namespace Patterns

| Namespace | Purpose |
|-----------|---------|
| `common` | Shared UI: buttons, labels, generic text |
| `auth` | Login, signup, password reset |
| `dashboard` | Dashboard-specific content |
| `settings` | User and app settings |
| `checkout` | E-commerce checkout flow |
| `emails` | Email templates |
| `errors` | Error messages |
| `validation` | Form validation messages |

### File Structure Examples

**Flat (Single File)**
```
locales/
├── en.json
└── tr.json
```

**Namespaced (Multiple Files)**
```
locales/
├── en/
│   ├── common.json
│   ├── auth.json
│   └── dashboard.json
└── tr/
    ├── common.json
    ├── auth.json
    └── dashboard.json
```

**Nested (Namespaces as Root Keys)**
```json
// locales/en.json
{
  "common": {
    "buttons": { "submit": "Submit", "cancel": "Cancel" }
  },
  "auth": {
    "login": { "title": "Sign In" }
  }
}
```

## Translation Statuses

Each translation progresses through statuses:

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `draft` | AI-generated or initial | Review required |
| `reviewed` | Human verified | Ready for approval |
| `approved` | Production ready | Can be published |

### Status Workflow

```
[New Key] → draft → reviewed → approved → [Published to CDN]
                ↓
            needs work → draft (revised)
```

### Status Rules

- **Draft**: Auto-set when AI translates or value changes
- **Reviewed**: Set by translator after verification
- **Approved**: Set by reviewer/admin, allows publishing

## Working with Keys

### Creating Keys

Via MCP:
```json
{
  "keys": [
    { "key": "nav.home", "namespace": "common", "sourceText": "Home" },
    { "key": "nav.about", "namespace": "common", "sourceText": "About" }
  ]
}
```

Via CLI:
```bash
# Scan codebase and create discovered keys
bunx better-i18n scan --create
```

### Searching Keys

Search patterns in dashboard and API:

```
# By prefix
auth.*                    # All auth keys
dashboard.widgets.*       # All widget keys

# By status
status:draft              # Untranslated keys
status:approved           # Production-ready

# By language completion
missing:tr                # Missing Turkish
missing:de,fr             # Missing German OR French

# Combined
auth.* status:draft       # Draft auth keys
```

### Updating Keys

Via MCP:
```json
{
  "translations": [
    {
      "key": "nav.home",
      "namespace": "common",
      "language": "tr",
      "value": "Ana Sayfa",
      "status": "reviewed"
    }
  ]
}
```

### Deleting Keys

Keys are soft-deleted (recoverable):

```json
{
  "keys": [
    { "key": "deprecated.oldFeature", "namespace": "common" }
  ]
}
```

## Best Practices

### DO

- ✅ Use consistent naming patterns
- ✅ Group related keys in namespaces
- ✅ Keep keys short but descriptive
- ✅ Use lowercase with dots as separators
- ✅ Document patterns in CONTRIBUTING.md
- ✅ Use CLI `scan` to discover keys automatically

### DON'T

- ❌ Use spaces or special characters
- ❌ Create deeply nested keys (max 4 levels)
- ❌ Duplicate keys across namespaces
- ❌ Use sequential names (`item1`, `item2`)
- ❌ Mix naming conventions

## Key Depth Guidelines

```
✅ Recommended (2-4 levels)
common.buttons.submit
auth.login.form.email.label

❌ Too deep (5+ levels)
auth.login.form.fields.email.validation.errors.required

✅ Better alternative
auth.login.emailRequired
```

## Namespace Size Guidelines

- **Optimal**: 50-150 keys per namespace
- **Maximum**: 300 keys (consider splitting)
- **Load strategy**: One namespace per page/feature

```typescript
// Load only needed namespace
const t = useTranslations('checkout'); // Loads checkout.json only
```

## Migration Tips

If restructuring existing keys:

1. Export current translations
2. Create mapping (old → new)
3. Update code references
4. Import with new structure
5. Verify with `better-i18n check`

```javascript
const keyMigration = {
  'submitBtn': 'common.buttons.submit',
  'loginTitle': 'auth.login.title',
  'errorMsg': 'common.errors.generic'
};
```
