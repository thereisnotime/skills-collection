# AI Translation

Translate content with context-aware AI assistance and glossary support.

## Overview

Better i18n uses AI to provide intelligent translations that understand:
- Your product context and terminology
- Brand voice and tone
- Technical terms via glossary
- ICU MessageFormat syntax (plurals, dates, variables)

## AI Translation Workflow

```
[Source Text] → [Glossary Lookup] → [Context Analysis] → [AI Translation]
                                                              ↓
                                                    [Human Review]
                                                              ↓
                                                      [Approved]
```

## Using the AI Drawer

The AI Drawer is the primary interface for AI-assisted translation in Better i18n.

### Opening the Drawer

- Click the AI button in the header
- Or use keyboard shortcut

### Translation Commands

**Translate selected keys:**
```
Translate these keys to Turkish
```

**Translate with context:**
```
Translate to German. This is for a formal business app, use Sie form.
```

**Batch translation:**
```
Translate all untranslated keys in the auth namespace to French
```

**With specific instructions:**
```
Translate to Japanese. Keep technical terms in English.
Use polite form (です/ます).
```

### How Context Works

The AI considers:
- Key naming patterns (`auth.login.error` → knows it's an error message)
- Surrounding keys in the same namespace
- Previously approved translations for consistency
- Glossary terms that must be preserved
- ICU syntax that must remain intact

## Glossary

The glossary ensures consistent terminology across all translations.

### Adding Terms

```
Dashboard → Project Settings → Glossary → Add Term

Term: "workspace"
Translations:
  - tr: "çalışma alanı" (not "işyeri")
  - de: "Arbeitsbereich"
  - fr: "espace de travail"

Note: Product-specific term, always translate consistently
```

### Glossary Structure

```json
{
  "terms": [
    {
      "term": "workspace",
      "caseSensitive": false,
      "translations": {
        "tr": "çalışma alanı",
        "de": "Arbeitsbereich"
      },
      "notes": "Product-specific term"
    },
    {
      "term": "API",
      "caseSensitive": true,
      "doNotTranslate": true,
      "notes": "Keep as-is in all languages"
    }
  ]
}
```

### Do Not Translate List

Some terms should remain in English:

```
Brand names: "Better i18n", "GitHub", "Cloudflare"
Technical: "API", "JSON", "webhook", "CDN"
Acronyms: "SSO", "SAML", "OAuth"
```

## Handling ICU MessageFormat

AI preserves ICU syntax automatically:

### Variables

```
Source: "Welcome, {name}!"
AI Output (Turkish): "Hoş geldin, {name}!"
```

### Pluralization

```
Source: "{count, plural, one {# item} other {# items}}"
AI Output (Turkish): "{count, plural, one {# öğe} other {# öğe}}"
```

### Select (Gender)

```
Source: "{gender, select, male {He} female {She} other {They}} liked your post"
AI Output (German): "{gender, select, male {Er} female {Sie} other {Die Person}} hat deinen Beitrag geliked"
```

### Dates

```
Source: "Posted on {date, date, long}"
AI Output (German): "Veröffentlicht am {date, date, long}"
```

## Translation Quality

### Review Process

1. **AI generates draft** - Initial translation with glossary applied
2. **Status: Draft** - Needs human review
3. **Human reviews** - Check accuracy, tone, context
4. **Status: Reviewed** - Verified by translator
5. **Approve** - Ready for production
6. **Publish** - Deployed to CDN

### Quality Indicators

| Indicator | Meaning |
|-----------|---------|
| ✅ Glossary applied | Uses correct terminology |
| ⚠️ Length warning | Translation 50%+ longer/shorter |
| 🔄 Pattern match | Similar to approved translations |
| ❓ Review suggested | Complex content, needs human check |

## Batch Translation

### Via Dashboard

1. Filter keys (namespace, status, etc.)
2. Select multiple keys (checkbox)
3. Click "Translate with AI"
4. Choose target language(s)
5. Review and approve

### Via MCP

```
You: Translate all keys in the checkout namespace to Turkish and German

Claude: [Uses translateKeys tool with glossary context]
```

### Via AI Chat

```
Translate all untranslated keys to Spanish.
Use formal "usted" form.
Mark payment-related terms from glossary.
```

## Context Hints for Better Translations

### In Key Names

```
auth.login.button.submit        # Clear it's a button
email.welcome.subject           # Email subject line
error.validation.email.invalid  # Error message
toast.success.saved             # Success notification
```

### In AI Prompts

```
These are error messages shown when form validation fails.
Keep them friendly but clear.
Max 100 characters.
Target audience: enterprise software users.
```

## Tips for Better AI Translations

1. **Set up glossary first** - Before bulk translation
2. **Use descriptive key names** - AI uses them for context
3. **Provide context in prompts** - Explain the UI context
4. **Review samples first** - Check a few before batch approve
5. **Keep source text clear** - Grammatically correct, no idioms
6. **Use consistent patterns** - Same structure across similar content

## Language-Specific Notes

### German
- Formal (Sie) vs informal (du)
- Compound words may be longer
- Noun capitalization

### Turkish
- Vowel harmony in suffixes
- Formal (siz) vs informal (sen)
- Different plural rules

### Japanese
- Formal (です/ます) vs casual
- Honorifics and keigo
- No spaces between words

### Arabic/Hebrew
- Right-to-left text direction
- Different numeral systems
- Gender agreement
