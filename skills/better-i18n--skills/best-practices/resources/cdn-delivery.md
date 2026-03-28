# CDN Delivery

Serve translations globally with edge caching via Cloudflare.

## Overview

Better i18n CDN provides:
- Global edge distribution via Cloudflare
- Automatic caching and invalidation on publish
- Multiple output formats (flat, nested, namespaced)
- Version pinning for deployments

## CDN URL Structure

```
https://cdn.better-i18n.com/v1/{org}/{project}/{locale}.json
```

### Examples

```bash
# All translations for English
https://cdn.better-i18n.com/v1/acme/dashboard/en.json

# Specific namespace
https://cdn.better-i18n.com/v1/acme/dashboard/en/common.json

# Project manifest (available locales)
https://cdn.better-i18n.com/v1/acme/dashboard/manifest.json
```

## Manifest File

The manifest contains project metadata and available locales:

```json
{
  "project": "acme/dashboard",
  "locales": [
    { "code": "en", "name": "English", "isSource": true },
    { "code": "tr", "name": "Turkish", "isSource": false },
    { "code": "de", "name": "German", "isSource": false }
  ],
  "updatedAt": "2026-01-31T12:00:00Z"
}
```

Use this for dynamic language discovery in your app.

## Publishing Workflow

```
[Draft] → [Reviewed] → [Approved] → [Publish] → [CDN Updated]
```

### Manual Publish

```
Dashboard → Project → Publish → Select languages → Publish
```

### Auto-Publish

Configure automatic publishing when translations are approved:

```
Project Settings → Publishing → Auto-publish approved: On
```

## Output Formats

### Flat JSON (Default)

All keys at root level with dot notation:

```json
{
  "common.title": "Dashboard",
  "common.buttons.save": "Save",
  "auth.login.title": "Sign In"
}
```

### Nested JSON

Hierarchical structure matching key paths:

```json
{
  "common": {
    "title": "Dashboard",
    "buttons": {
      "save": "Save"
    }
  },
  "auth": {
    "login": {
      "title": "Sign In"
    }
  }
}
```

### Namespaced (Separate Files)

Each namespace as a separate file:

```
/en/common.json
/en/auth.json
/tr/common.json
/tr/auth.json
```

Configure format in Project Settings → CDN → Output Format.

## Fetching Translations

### Browser (Fetch API)

```javascript
async function loadTranslations(locale, namespace = 'common') {
  const response = await fetch(
    `https://cdn.better-i18n.com/v1/acme/dashboard/${locale}/${namespace}.json`
  );
  return response.json();
}

const messages = await loadTranslations('tr', 'common');
```

### With Fallback

```javascript
async function loadWithFallback(locale, namespace) {
  try {
    const response = await fetch(
      `https://cdn.better-i18n.com/v1/acme/dashboard/${locale}/${namespace}.json`
    );
    if (!response.ok) throw new Error('Not found');
    return response.json();
  } catch {
    // Fallback to English
    const fallback = await fetch(
      `https://cdn.better-i18n.com/v1/acme/dashboard/en/${namespace}.json`
    );
    return fallback.json();
  }
}
```

### Using the SDK

```typescript
import { getMessages } from '@better-i18n/next';

// Automatically fetches from CDN with caching
const messages = await getMessages(locale);
```

## Caching Strategy

### CDN Edge Cache

- **Cache-Control:** `public, max-age=300, stale-while-revalidate=3600`
- **TTL:** 5 minutes (configurable)
- **Stale-while-revalidate:** 1 hour
- **Cache invalidation:** Automatic on publish

### Recommended Client Strategy

```typescript
// In Next.js layout with ISR
export const revalidate = 300; // Revalidate every 5 minutes

// Messages are cached at build time and revalidated
const messages = await getMessages(locale);
```

### Service Worker (Offline Support)

```javascript
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('cdn.better-i18n.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open('i18n').then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
  }
});
```

## Response Headers

```
Cache-Control: public, max-age=300, stale-while-revalidate=3600
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
X-Better-i18n-Version: 1.0
```

## Monitoring

### CDN Analytics

```
Dashboard → Project → Analytics

Metrics:
- Requests per locale
- Cache hit rate
- Bandwidth usage
- Error rate
```

### Health Check

```bash
curl -I https://cdn.better-i18n.com/v1/acme/dashboard/en.json

HTTP/2 200
cache-status: HIT
content-type: application/json
```

## Troubleshooting

### "404 Not Found"

1. Check org/project slug is correct
2. Verify locale code exists in project
3. Ensure translations are published (not just approved)

### "Stale Content"

1. Check if publish completed in dashboard
2. Wait for cache TTL (5 min default)
3. Force refresh: `?_bust=timestamp`

### "CORS Errors"

CDN includes permissive CORS headers by default:
```
Access-Control-Allow-Origin: *
```

If using a custom domain, ensure CORS is configured.

## Best Practices

1. **Use the manifest** - Dynamically discover available locales
2. **Implement fallbacks** - Handle missing locales gracefully
3. **Use ISR in Next.js** - Combine edge caching with server revalidation
4. **Preload critical translations** - Use `<link rel="preload">` for above-fold content
5. **Monitor cache hits** - Optimize TTL based on update frequency
