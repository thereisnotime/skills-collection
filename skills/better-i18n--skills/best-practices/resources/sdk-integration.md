# SDK Integration

Integrate Better i18n with your React, Next.js, or TanStack Start application.

## Available SDKs

| Package | Framework | Features |
|---------|-----------|----------|
| `@better-i18n/next` | Next.js | App Router, ISR, middleware, next-intl integration |
| `@better-i18n/use-intl` | React/Vite | Hooks, formatters, TanStack Router |
| `@better-i18n/cli` | Any | Key extraction, sync, validation |

## Next.js Integration

The `@better-i18n/next` SDK integrates seamlessly with `next-intl`.

### Installation

```bash
npm install @better-i18n/next
# or
bun add @better-i18n/next
```

### Setup

**1. Create unified config**

```typescript
// i18n.config.ts
import { createI18n } from '@better-i18n/next';

export const i18n = createI18n({
  project: "your-org/your-project",
  defaultLocale: "en",
  localePrefix: "as-needed"  // Clean URLs for default locale
});
```

**2. Add middleware**

Supports Clerk-style callback pattern for auth integration:

```typescript
// middleware.ts
import { i18n } from './i18n.config';

export default i18n.middleware({
  // Optional: Auth callback
  beforeLocaleDetection: (request) => {
    // Check auth, redirect if needed
    return null; // or NextResponse.redirect()
  }
});

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
```

**3. Create layout with ISR support**

```typescript
// app/[locale]/layout.tsx
import { getMessages } from '@better-i18n/next';
import { NextIntlClientProvider } from 'next-intl';

// ISR: Revalidate translations every 5 minutes
export const revalidate = 300;

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // Fetches from CDN with automatic caching
  const messages = await getMessages(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

// Dynamic languages from CDN manifest
export async function generateStaticParams() {
  const { locales } = await i18n.getManifest();
  return locales.map((locale) => ({ locale }));
}
```

**4. Use in Client Components**

```typescript
// app/[locale]/page.tsx
'use client';

import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('common');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <p>{t('description')}</p>
    </div>
  );
}
```

**5. Use in Server Components**

```typescript
// No 'use client' - runs on server
import { getTranslations } from 'next-intl/server';

export default async function ServerPage() {
  const t = await getTranslations('common');

  return <h1>{t('welcome')}</h1>;
}
```

### URL Strategy

Default locale without prefix for clean SEO:

```
/about          → English (default)
/tr/about       → Turkish
/de/about       → German
```

Automatic `hreflang` tags and canonical URLs.

## React/Vite Integration

### Installation

```bash
npm install @better-i18n/use-intl
```

### Setup

```typescript
// App.tsx
import { IntlProvider } from '@better-i18n/use-intl';

function App() {
  return (
    <IntlProvider
      project="your-org/your-project"
      defaultLocale="en"
    >
      <Router />
    </IntlProvider>
  );
}
```

Messages are fetched automatically from CDN.

### Available Hooks

#### `useTranslations(namespace)`

Namespace-scoped translation access:

```typescript
import { useTranslations } from '@better-i18n/use-intl';

function MyComponent() {
  const t = useTranslations('common');

  return (
    <div>
      <h1>{t('title')}</h1>
      <button>{t('buttons.submit')}</button>
    </div>
  );
}
```

#### `useLocale()`

Locale state management:

```typescript
import { useLocale } from '@better-i18n/use-intl';

function LanguageSwitcher() {
  const { locale, setLocale, locales } = useLocale();

  return (
    <select value={locale} onChange={(e) => setLocale(e.target.value)}>
      {locales.map((l) => (
        <option key={l.code} value={l.code}>{l.name}</option>
      ))}
    </select>
  );
}
```

#### `useFormatter()`

Date, number, and list formatting:

```typescript
import { useFormatter } from '@better-i18n/use-intl';

function PriceDisplay({ amount, date }) {
  const format = useFormatter();

  return (
    <div>
      <p>Price: {format.number(amount, { style: 'currency', currency: 'USD' })}</p>
      <p>Date: {format.dateTime(date, { dateStyle: 'long' })}</p>
      <p>Relative: {format.relativeTime(date)}</p>
    </div>
  );
}
```

#### `useLanguages()`

Dynamic language discovery from CDN manifest:

```typescript
import { useLanguages } from '@better-i18n/use-intl';

function LanguageList() {
  const { languages, isLoading } = useLanguages();

  if (isLoading) return <Spinner />;

  return (
    <ul>
      {languages.map((lang) => (
        <li key={lang.code}>
          <img src={lang.flag} alt="" />
          {lang.name}
        </li>
      ))}
    </ul>
  );
}
```

#### `useLocaleRouter()`

TanStack Router integration with path-based routing:

```typescript
import { useLocaleRouter } from '@better-i18n/use-intl';

function Navigation() {
  const { navigate, locale } = useLocaleRouter();

  return (
    <button onClick={() => navigate('/about')}>
      {/* Navigates to /tr/about if locale is 'tr' */}
      About
    </button>
  );
}
```

## TanStack Start Integration

Full SSR support with hydration-safe rendering.

### Setup

```typescript
// app/routes/__root.tsx
import { createRootRoute } from '@tanstack/react-router';
import { getMessages, IntlProvider } from '@better-i18n/use-intl/server';

export const Route = createRootRoute({
  loader: async ({ context }) => {
    const locale = context.locale || 'en';
    const messages = await getMessages('your-org/your-project', locale);
    return { locale, messages };
  },
  component: RootComponent,
});

function RootComponent() {
  const { locale, messages } = Route.useLoaderData();

  return (
    <IntlProvider locale={locale} messages={messages} timeZone="UTC">
      <Outlet />
    </IntlProvider>
  );
}
```

### Middleware

```typescript
// app/middleware.ts
import { createI18nMiddleware } from '@better-i18n/use-intl/server';

export const i18nMiddleware = createI18nMiddleware({
  defaultLocale: 'en',
  localeDetection: ['url', 'cookie', 'header'],  // Priority order
});
```

### Hydration Pattern

```
Server: Loads messages in loader
         ↓
Client: Hydrates with same messages
         ↓
User: Instant page, no flash
```

## Formatting Reference

### ICU MessageFormat

Better i18n supports full ICU MessageFormat syntax:

#### Basic Interpolation

```json
{ "greeting": "Hello, {name}!" }
```

```typescript
t('greeting', { name: 'John' }); // "Hello, John!"
```

#### Pluralization

```json
{
  "items": "{count, plural, one {# item} other {# items}}"
}
```

```typescript
t('items', { count: 1 }); // "1 item"
t('items', { count: 5 }); // "5 items"
```

#### Select (Gender/Category)

```json
{
  "status": "{status, select, active {Active} inactive {Inactive} other {Unknown}}"
}
```

```typescript
t('status', { status: 'active' }); // "Active"
```

#### Select Ordinal

```json
{
  "position": "{pos, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"
}
```

```typescript
t('position', { pos: 1 }); // "1st"
t('position', { pos: 2 }); // "2nd"
t('position', { pos: 3 }); // "3rd"
t('position', { pos: 4 }); // "4th"
```

### Rich Text

```json
{
  "terms": "By signing up, you agree to our <link>Terms of Service</link>"
}
```

```typescript
t.rich('terms', {
  link: (chunks) => <a href="/terms">{chunks}</a>,
});
```

### Date Formatting

```json
{ "posted": "Posted on {date, date, long}" }
```

| Style | Example (en) | Example (de) |
|-------|--------------|--------------|
| short | 1/31/26 | 31.01.26 |
| medium | Jan 31, 2026 | 31.01.2026 |
| long | January 31, 2026 | 31. Januar 2026 |
| full | Friday, January 31, 2026 | Freitag, 31. Januar 2026 |

### Number Formatting

```json
{ "price": "{amount, number, ::currency/USD}" }
```

Options: `currency`, `percent`, `compact`, `unit`

### List Formatting

```json
{ "authors": "{names, list, conjunction}" }
```

- `conjunction`: "A, B, and C"
- `disjunction`: "A, B, or C"
- `unit`: "A, B, C"

## TypeScript Support

Full autocomplete via `IntlMessages` interface:

```typescript
// global.d.ts
import en from './locales/en.json';

declare global {
  interface IntlMessages extends typeof en {}
}
```

Now TypeScript catches typos:

```typescript
t('welcom');  // ❌ Error: 'welcom' not in IntlMessages
t('welcome'); // ✅ Valid
```

## Suspense Support

```typescript
import { Suspense } from 'react';
import { useTranslations } from '@better-i18n/use-intl';

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <TranslatedContent />
    </Suspense>
  );
}
```

## Troubleshooting

### Hydration mismatch

Ensure consistent locale between server and client:

```typescript
// ❌ Bad - varies between server/client
const locale = typeof window !== 'undefined'
  ? navigator.language
  : 'en';

// ✅ Good - consistent
const locale = cookies().get('locale')?.value || 'en';
```

### Flash of untranslated content

Pre-load messages in layout/root:

```typescript
// Next.js: Use generateStaticParams + getMessages in layout
// TanStack: Use loader to fetch messages server-side
```

### Bundle size

Load only needed namespaces:

```typescript
// Instead of loading all messages
const messages = await getMessages(locale);

// Load specific namespace
const messages = await getMessages(locale, 'checkout');
```
