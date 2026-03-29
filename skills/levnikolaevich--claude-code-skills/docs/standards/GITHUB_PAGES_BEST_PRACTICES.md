# GitHub Pages Best Practices (2026)

<!-- SCOPE: GitHub Pages site design and deployment guidelines ONLY. Covers site structure, performance, SEO, dark mode, responsive design, accessibility, deployment workflows. -->
<!-- DO NOT add here: README writing guidelines → GITHUB_README_BEST_PRACTICES.md, npm package publishing → NPM_PACKAGE_BEST_PRACTICES.md -->

Best practices for building performant, accessible, and well-structured GitHub Pages sites based on web standards research and production experience (2024-2026).

## Table of Contents

- [Site Structure](#site-structure)
- [Performance](#performance)
- [SEO and Meta](#seo-and-meta)
- [Navigation](#navigation)
- [Dark Mode Design](#dark-mode-design)
- [Responsive Design](#responsive-design)
- [Deployment](#deployment)
- [Content Organization](#content-organization)
- [Accessibility](#accessibility)
- [Copy-to-Clipboard](#copy-to-clipboard)
- [Anti-Patterns](#anti-patterns)
- [Quality Checklist](#quality-checklist)

---

## Site Structure

| Path | Purpose | Notes |
|------|---------|-------|
| `index.html` | Landing page | Single-page or multi-page entry |
| `assets/css/` | Stylesheets | One file preferred; inline critical CSS |
| `assets/img/` | Images | WebP format, optimized |
| `assets/js/` | Scripts | Minimal; avoid frameworks |
| `CNAME` | Custom domain | Only for branch-based publishing |
| `robots.txt` | Crawler directives | At publishing root |
| `sitemap.xml` | Page index for search engines | At publishing root |
| `404.html` | Custom error page | Served automatically by GitHub Pages |

**Naming:** lowercase, hyphenated (`getting-started.html`, not `MyPage.html`). Prefer flat structure for sites under 10 pages. Use subdirectories only for natural groupings (`/blog/`, `/docs/`).

---

## Performance

### CSS Strategy

| Approach | When | Impact |
|----------|------|--------|
| Inline critical CSS in `<head>` | Above-the-fold styles (<14KB) | Eliminates render-blocking request |
| Single external stylesheet | Full site styles | Cached across pages |
| No CSS frameworks | Always | Bootstrap/Tailwind adds 20-50KB unused |

**Budget:** Total CSS under 30KB minified. Total JS under 20KB.

### Images

| Format | Use Case | Savings vs PNG |
|--------|----------|---------------|
| **WebP** | Photos, complex graphics | 25-35% smaller |
| **SVG** | Icons, logos, diagrams | Scalable, tiny |
| **PNG** | Screenshots with text | Only when WebP quality is worse |

| Rule | Details |
|------|---------|
| Always set `width` + `height` | Prevents layout shift (CLS) |
| `loading="lazy"` on below-fold images | Defers offscreen loading |
| `loading="eager"` on hero image | First Contentful Paint priority |
| Max width: 1200px | Sufficient for all screens |

### Fonts

| Approach | Recommendation |
|----------|---------------|
| **System font stack** | Best performance, zero network cost |
| **Self-hosted WOFF2** | If brand font required; subset characters |
| **Google Fonts CDN** | Avoid -- extra DNS lookup, render-blocking |

```css
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
```

### JavaScript

No frameworks for static content. Use `defer` on all `<script>` tags. Inline scripts under 1KB.

---

## SEO and Meta

### Required Tags (every page)

```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page Title - Site Name</title>
<meta name="description" content="150-160 char description with keywords.">
<link rel="canonical" href="https://yourdomain.com/page">
<meta property="og:title" content="Page Title">
<meta property="og:description" content="Same or slightly longer than meta description.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://yourdomain.com/page">
<meta property="og:image" content="https://yourdomain.com/assets/img/og-image.png">
<meta property="og:site_name" content="Site Name">
<meta name="twitter:card" content="summary_large_image">
```

### OG Image: 1200x630px, PNG or JPG (not WebP -- poor OG support), under 1MB.

### robots.txt and sitemap.xml

Place both at publishing root. `robots.txt` should reference sitemap URL. For sites with 5+ pages, generate sitemap in CI rather than maintaining manually.

---

## Navigation

| Pattern | When |
|---------|------|
| **Sticky top nav** | All multi-section sites |
| **Anchor links + `scroll-behavior: smooth`** | Single-page sites (SPA-like feel) |
| **Breadcrumbs** | Multi-page sites with hierarchy |
| **Hamburger menu** | Mobile (<768px) |

```css
nav { position: sticky; top: 0; z-index: 100; backdrop-filter: blur(8px); background: var(--nav-bg); }
html { scroll-behavior: smooth; }
:target { scroll-margin-top: 4rem; } /* Account for sticky nav */
```

Mobile nav toggle: use a `<button>` with `aria-expanded` and `aria-controls`, toggling a class via inline `onclick`. Keep script under 500 bytes.

---

## Dark Mode Design

### CSS Variables

```css
:root {
  --bg-primary: #ffffff;    --bg-secondary: #f6f8fa;   --bg-tertiary: #e8eaed;
  --text-primary: #1a1a2e;  --text-secondary: #4a4a6a; --text-muted: #6b7280;
  --accent: #2563eb;        --accent-hover: #1d4ed8;   --border: #d1d5db;
  --code-bg: #f1f3f5;       --nav-bg: rgba(255,255,255,0.85);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0d1117;    --bg-secondary: #161b22;   --bg-tertiary: #21262d;
    --text-primary: #e6edf3;  --text-secondary: #b1bac4; --text-muted: #8b949e;
    --accent: #58a6ff;        --accent-hover: #79c0ff;   --border: #30363d;
    --code-bg: #1c2128;       --nav-bg: rgba(13,17,23,0.85);
  }
}
```

### WCAG Contrast

| Element | Min Ratio | Standard |
|---------|----------|----------|
| Body text | 4.5:1 | WCAG AA |
| Large text (18px+ bold, 24px+) | 3:1 | WCAG AA |
| UI components (borders, icons) | 3:1 | WCAG AA |

### Color Rules

| Rule | Bad | Good |
|------|-----|------|
| No pure black bg | `#000000` | `#0d1117` |
| No pure white text on dark | `#ffffff` on `#000` | `#e6edf3` on `#0d1117` |
| Desaturate accents for dark | Same blue in both themes | Lighter, less saturated variant |

### Manual Toggle

Store preference in `localStorage`. Use `[data-theme="dark"]` selector (higher specificity than media query). Restore on page load before first paint to avoid flash.

---

## Responsive Design

### Breakpoints (mobile-first)

```css
/* Base = mobile. Then: */
@media (min-width: 768px)  { .container { max-width: 720px; } }  /* Tablet */
@media (min-width: 1024px) { .container { max-width: 960px; } }  /* Desktop */
@media (min-width: 1280px) { .container { max-width: 1140px; } } /* Wide */
```

### Layout

| Technique | Use Case |
|-----------|----------|
| **CSS Grid** | Page layout, card grids |
| **Flexbox** | Nav items, component alignment |
| **`clamp()`** | Fluid typography: `font-size: clamp(1rem, 2.5vw, 1.25rem)` |
| **`min()`** | Content width: `width: min(90%, 1140px)` |

### Touch Targets

Minimum 44x44px (Apple HIG / WCAG 2.2). Google recommends 48x48px. Add padding if visual element is smaller.

---

## Deployment

### GitHub Actions Workflow

```yaml
name: Deploy Pages
on:
  push:
    branches: [master]
    paths: ['docs/site/**', '.github/workflows/deploy-pages.yml']
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/site
      - id: deployment
        uses: actions/deploy-pages@v4
```

| Rule | Details |
|------|---------|
| `paths` filter | Deploy only when site files change |
| `concurrency` | Prevent parallel deploy conflicts |
| Native Actions | Use `actions/deploy-pages@v4`, not third-party |
| CNAME | Place in publishing root for custom domains |
| HTTPS | Enforce in Settings > Pages |

### Custom Domain: Add `CNAME` file with domain, configure DNS (CNAME record to `<user>.github.io`), enable HTTPS. Certificate provisioning takes up to 24h.

---

## Content Organization

| Criterion | Single Page | Multiple Pages |
|-----------|-------------|----------------|
| Content length | <2000 words | >2000 words |
| Distinct topics | 1-3 sections | 4+ unrelated sections |
| SEO targets | 1-2 keywords | Different keywords per page |

**DRY without templating:** For sites under 5 pages, accept minor HTML duplication (copy `<head>`, `<nav>`, `<footer>`). For 5+ pages, use a static site generator (11ty, Hugo) in CI.

**Links:** Always use `rel="noopener"` on external `target="_blank"` links.

---

## Accessibility

### Semantic HTML

Use `<nav>`, `<header>`, `<main>`, `<footer>`, `<section>` instead of generic `<div>`. Use `<button>` instead of `<span onclick>`.

### Requirements

| Requirement | Implementation |
|-------------|---------------|
| Skip-to-content | `<a href="#main" class="skip-link">` as first body element |
| Focus styles | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` |
| No global outline:none | Style `:focus-visible`, hide with `:focus:not(:focus-visible)` |
| ARIA labels | On icon-only buttons: `aria-label="Toggle menu"` |
| ARIA expanded | On collapsible sections: `aria-expanded="true/false"` |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; } }` |
| Image alt text | Descriptive for content; `alt=""` for decorative |
| Tab order | Logical, matches visual order; never `tabindex > 0` |

---

## Copy-to-Clipboard

### Pattern

```javascript
async function copyCode(btn) {
  const code = btn.previousElementSibling.textContent;
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  } catch {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }
}
```

| Rule | Details |
|------|---------|
| API | `navigator.clipboard.writeText()` -- no libraries needed |
| Feedback duration | 2 seconds |
| Error handling | Always catch, show failure state |
| Screen readers | `aria-live="polite"` region for copy announcements |

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| JS framework for static content | 30-100KB+ for zero interactivity | Plain HTML + vanilla JS |
| External CDN dependencies | CDN down = site broken | Self-host or inline |
| Google Fonts CDN | DNS lookup + render-blocking | System fonts or self-hosted WOFF2 |
| Missing `viewport` meta | Broken mobile rendering | Add viewport meta tag |
| No fallback fonts | Layout shift on font load | System fallbacks in `font-family` |
| Heavy uncompressed images | Slow first paint, high CLS | WebP, set dimensions, compress |
| `outline: none` globally | Keyboard users lose focus | Style `:focus-visible` |
| Deploying on every push | Wastes CI minutes | `paths` filter in workflow |
| No `robots.txt` | Search engines guess crawl rules | Explicit rules + sitemap ref |
| Pure black/white dark mode | Harsh contrast, eye strain | `#0d1117` bg, `#e6edf3` text |
| No `<main>` landmark | Screen readers lost | Wrap content in `<main>` |

---

## Quality Checklist

### Structure

- [ ] `index.html` with semantic HTML (`<header>`, `<nav>`, `<main>`, `<footer>`)
- [ ] Custom `404.html`
- [ ] `robots.txt` and `sitemap.xml` at publishing root
- [ ] All links verified, no broken hrefs

### Performance

- [ ] CSS < 30KB, JS < 20KB minified
- [ ] Images: WebP with fallback, dimensions set, `loading="lazy"` below fold
- [ ] System font stack or self-hosted WOFF2
- [ ] No JS frameworks, no CDN font dependencies
- [ ] Lighthouse Performance >= 95

### SEO

- [ ] `<title>` + `<meta description>` on every page
- [ ] Open Graph tags (title, description, image, url)
- [ ] Twitter Card tags
- [ ] Canonical URL, OG image 1200x630px PNG/JPG

### Accessibility

- [ ] WCAG AA contrast (4.5:1 text, 3:1 UI) in both themes
- [ ] Skip-to-content link, `:focus-visible` styles
- [ ] All images have `alt`, icon buttons have `aria-label`
- [ ] `prefers-reduced-motion` respected
- [ ] Keyboard nav works for all interactive elements

### Dark Mode

- [ ] All colors via CSS custom properties
- [ ] `prefers-color-scheme: dark` media query
- [ ] Contrast verified in both light and dark
- [ ] No pure black bg, accents adjusted for dark

### Responsive

- [ ] Viewport meta present
- [ ] Mobile-first breakpoints (min-width)
- [ ] Touch targets >= 44x44px
- [ ] No horizontal scroll at 320px-1280px

### Deployment

- [ ] GitHub Actions with `paths` filter and `concurrency`
- [ ] CNAME in publishing root (if custom domain)
- [ ] HTTPS enforced

---

**Version:** 1.0.0
**Last Updated:** 2026-03-22
