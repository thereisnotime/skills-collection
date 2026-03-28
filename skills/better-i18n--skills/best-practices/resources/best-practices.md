# i18n Best Practices

Guidelines for building maintainable, scalable internationalization.

## Content Guidelines

### Write for Translation

**DO:**
- Use complete sentences
- Be explicit, avoid ambiguity
- Use standard punctuation
- Keep sentences short (under 20 words)

**DON'T:**
- Use idioms or slang
- Concatenate strings
- Use text in images
- Assume cultural context

### Examples

```
❌ Bad: "Hey! What's up?"
✅ Good: "Hello! How are you today?"

❌ Bad: "Click here"
✅ Good: "View your order details"

❌ Bad: "{name} added" + count + "items"
✅ Good: "{name} added {count, plural, one {# item} other {# items}}"
```

## String Concatenation

Never concatenate strings. Word order varies by language.

```typescript
// ❌ Bad
const message = t('hello') + ' ' + name + '!';

// ✅ Good
t('greeting', { name }); // "Hello, {name}!"
```

### German Example

```
English: "5 new messages"
German: "5 neue Nachrichten"

English: "Show all" + count + "items"
German: "Alle " + count + " Artikel anzeigen" // Word order differs!
```

## Pluralization

Use ICU MessageFormat for plurals.

### Basic Plural

```json
{
  "items": "{count, plural, one {# item} other {# items}}"
}
```

### With Zero

```json
{
  "items": "{count, plural, =0 {No items} one {# item} other {# items}}"
}
```

### Complex Example

```json
{
  "cartSummary": "{count, plural, =0 {Your cart is empty} one {You have # item in your cart} other {You have # items in your cart}}"
}
```

### Language-Specific Plurals

Some languages have more plural forms:

```json
// Russian has: one, few, many, other
{
  "items": "{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}"
}
```

## Gender and Select

Handle grammatical gender:

```json
{
  "welcome": "{gender, select, male {Welcome, Mr. {name}} female {Welcome, Ms. {name}} other {Welcome, {name}}}"
}
```

### Combined Select and Plural

```json
{
  "action": "{gender, select, male {{count, plural, one {He added # item} other {He added # items}}} female {{count, plural, one {She added # item} other {She added # items}}} other {{count, plural, one {They added # item} other {They added # items}}}}"
}
```

## Numbers and Currency

### Number Formatting

```typescript
t('price', { amount: 1234.56 });
// English: "1,234.56"
// German: "1.234,56"
// French: "1 234,56"
```

Translation:
```json
{
  "price": "{amount, number}"
}
```

### Currency

```typescript
t('total', { amount: 99.99, currency: 'USD' });
// English: "$99.99"
// German: "99,99 $"
// Japanese: "US$99.99"
```

Translation:
```json
{
  "total": "{amount, number, ::currency/USD}"
}
```

### Percentages

```json
{
  "discount": "{percent, number, percent}"
}
```

## Dates and Times

### Date Formatting

```typescript
t('posted', { date: new Date() });
```

```json
{
  "posted": "Posted on {date, date, long}"
}
```

| Style | English | German |
|-------|---------|--------|
| short | 1/31/26 | 31.01.26 |
| medium | Jan 31, 2026 | 31.01.2026 |
| long | January 31, 2026 | 31. Januar 2026 |
| full | Friday, January 31, 2026 | Freitag, 31. Januar 2026 |

### Relative Time

```json
{
  "lastSeen": "{time, relative}"
}
```

Outputs: "2 hours ago", "in 3 days", etc.

## Lists

### Conjunction (and)

```json
{
  "authors": "{names, list, conjunction}"
}
```

- English: "Alice, Bob, and Charlie"
- German: "Alice, Bob und Charlie"

### Disjunction (or)

```json
{
  "options": "{items, list, disjunction}"
}
```

- English: "red, blue, or green"

## Context and Disambiguation

Same word, different translations:

```json
{
  "post.verb": "Post",     // As in "Post a comment"
  "post.noun": "Post",     // As in "Read this post"
  "post.mail": "Post"      // As in "Send by post"
}
```

In German:
```json
{
  "post.verb": "Veröffentlichen",
  "post.noun": "Beitrag",
  "post.mail": "Post"
}
```

## Text Expansion

Translated text is often longer. Plan for expansion:

| Language | Expansion |
|----------|-----------|
| German | +30% |
| French | +20% |
| Russian | +30% |
| Japanese | -10% |
| Chinese | -30% |

### UI Considerations

```css
/* Allow text to wrap */
.button {
  white-space: normal;
  min-width: 100px;
}

/* Use flexible layouts */
.nav {
  display: flex;
  flex-wrap: wrap;
}
```

## Right-to-Left (RTL)

For Arabic, Hebrew, Persian:

### CSS Logical Properties

```css
/* ❌ Physical */
margin-left: 1rem;
text-align: left;

/* ✅ Logical */
margin-inline-start: 1rem;
text-align: start;
```

### Direction Attribute

```html
<html lang="ar" dir="rtl">
```

### Bidirectional Text

```json
{
  "greeting": "مرحبا {name}!"
}
```

Use `<bdi>` for embedded LTR in RTL:
```html
<p>مرحبا <bdi>{name}</bdi>!</p>
```

## Accessibility

### Screen Readers

Provide language hints:

```html
<p lang="de">Willkommen</p>
```

### Alt Text

Translate alt text:

```json
{
  "logo.alt": "Company Logo",
  "hero.alt": "Team collaborating in modern office"
}
```

## Testing

### Pseudo-Localization

Test UI without real translations:

```
"Welcome" → "[Ẃéļċőmé !!!]"
```

Reveals:
- Hardcoded strings
- Truncation issues
- Character encoding problems

### Length Testing

```
"OK" → "XXXXXXXXXX" (10 chars)
"Submit" → "XXXXXXXXXXXXXXXXXXXXXX" (20 chars)
```

### RTL Testing

Even without Arabic content, test with `dir="rtl"` to catch layout issues.

## File Organization

### Recommended Structure

```
locales/
├── en/
│   ├── common.json      # Shared UI
│   ├── auth.json        # Authentication
│   ├── dashboard.json   # Dashboard
│   └── emails.json      # Email templates
├── tr/
│   └── ... (same structure)
└── de/
    └── ... (same structure)
```

### Namespace Size

- Keep under 200 keys per namespace
- Load only what's needed per page
- Group by feature, not by component

## Performance

### Load Strategy

```typescript
// Critical: Load immediately
const common = await import(`./locales/${locale}/common.json`);

// Lazy: Load when needed
const checkout = lazy(() => import(`./locales/${locale}/checkout.json`));
```

### Caching

```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getMessages(locale) {
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }
  const data = await fetch(`/locales/${locale}.json`);
  cache.set(locale, { data, time: Date.now() });
  return data;
}
```

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Hardcoded strings | Can't translate | Extract to keys |
| String concatenation | Word order issues | Use placeholders |
| Assuming date format | "01/02" is ambiguous | Use formatters |
| Ignoring plurals | "1 items" | Use ICU plural |
| Fixed-width UI | German overflow | Flexible layouts |
| Text in images | Can't translate | Use CSS/SVG |
| Gendered pronouns | Not all languages | Use neutral or select |
