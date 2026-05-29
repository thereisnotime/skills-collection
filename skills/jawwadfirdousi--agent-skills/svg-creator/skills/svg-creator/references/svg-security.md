# SVG Security Reference

Use this when generating SVG that may be rendered in untrusted contexts (user uploads, embedded inline into other origins, copy-pasted into rich text editors), or when reviewing/sanitizing an existing SVG.

Sources: [W3C SVG Security wiki](https://www.w3.org/wiki/SVG_Security), [OWASP AASVS 5.2.7](https://owasp-aasvs4.readthedocs.io/en/latest/5.2.7.html), [DOMPurify](https://github.com/cure53/DOMPurify), [W3C SVG 2 Scripting](https://www.w3.org/TR/SVG2/interact.html).

## Threat model

SVG is XML, parsed by a full HTML/XML stack. Inline SVG executes scripts, runs event handlers, fetches external resources, and embeds HTML via `<foreignObject>`. SVG rendered as `<img src>` has these capabilities **disabled by spec** — but the file is still parsed for XML constructs (DTD, entities) by any server-side tool that touches it.

If the SVG might ever be inlined into a page, every attack surface is reachable. Sanitize before storage and again at render time when the rendering DOM context differs from the sanitization context.

## Always strip

### Scripting

- `<script>` elements (any content, any language attribute).
- Every attribute whose lowercased name starts with `on` (event handlers). Examples: `onload`, `onclick`, `onerror`, `onmouseover`, `onmouseenter`, `onfocus`, `onkeydown`, `onsubmit`, `onpageshow`. SVG-specific entries that pure-HTML allowlists miss: `onbegin`, `onend`, `onrepeat` (SMIL timing), `onzoom`. Drop the entire on-prefixed family by rule, not by enumeration.

### Dangerous URL schemes

In any URL-bearing attribute (`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `poster`, `<image href>`, `<use href>`, `<feImage href>`, `<a href>`, CSS `url(...)`):

- `javascript:`
- `vbscript:`
- `livescript:`
- `mocha:`
- `data:image/svg+xml` (equivalent to inline SVG; runs scripts)
- `data:text/html`
- `data:application/xhtml+xml`
- `blob:`
- `filesystem:`

Allow only `https:`, `http:`, `mailto:`, `tel:`, fragment-only (`#id`), and (if needed) `data:image/png`, `data:image/jpeg`, `data:image/gif`, `data:image/webp` in raster contexts.

Match URL schemes case-insensitively, after trimming whitespace and decoding HTML entities (`&#x6A;avascript:` → `javascript:`).

### `<foreignObject>`

Embeds arbitrary XML — typically XHTML — inside SVG. Carries the full HTML XSS surface (iframes, form posts, scripts via mutation, CSS expressions). Strip the element and its entire subtree. Do not attempt to sanitize HTML inside; namespace boundaries break naive sanitizers.

### XML constructs

These attack the XML parser before any rendering happens. Any backend that ingests SVG must defend at the parser level.

- `<!DOCTYPE>` declarations.
- `<!ENTITY>` declarations (XXE: `<!ENTITY xxe SYSTEM "file:///etc/passwd">` exfiltrates files; real CVEs in svglib, cairosvg, svg_optimizer).
- External DTD subsets.
- `<?xml-stylesheet href="...">` processing instructions.
- CDATA sections used to smuggle script through naive regex sanitizers (parse-based sanitizers handle these correctly).

### SMIL animation hijack

`<animate>` and `<set>` can mutate any attribute, including `href` and `xlink:href`. An attacker can render a benign-looking SVG that switches a link target to `javascript:...` after a delay:

```xml
<a><text>click</text>
  <animate attributeName="href" to="javascript:alert(1)"/>
</a>
```

If you allow SMIL: also constrain which `attributeName` values are animatable, and reject any animation whose `to`, `from`, `by`, or `values` resolves to a forbidden URL scheme.

### Legacy / vendor-specific CSS

- `expression(...)` (IE-only JS evaluator).
- `behavior: url(...)` (IE HTC bindings).
- `-moz-binding: url(...)` (old Firefox XBL).
- CSS `@import` from external origins.
- CSS `@font-face` with non-data URLs.

## Sanitize both `href` and `xlink:href`

SVG 2 prefers plain `href`; SVG 1.1 used `xlink:href`. Both still resolve in modern browsers. When `href` is present it wins, but a sanitizer that checks only `href` lets a malicious `xlink:href` survive on elements without `href`. Always run the URL-scheme check on **both** attribute names.

When emitting new SVG, use `href` only and omit `xmlns:xlink`.

## DOMPurify defaults (for context)

DOMPurify is the de-facto JavaScript sanitizer. With `USE_PROFILES: { svg: true, svgFilters: true }`:

- 47 SVG elements allowed (path, rect, circle, ellipse, line, polygon, polyline, g, defs, mask, clipPath, marker, pattern, linearGradient, radialGradient, stop, symbol, use, text, tspan, textPath, title, desc, metadata, view, ...).
- 24 filter primitives allowed (feBlend, feColorMatrix, feComposite, feGaussianBlur, feDropShadow, feMerge, feMergeNode, feOffset, feFlood, feTurbulence, feMorphology, feDisplacementMap, feConvolveMatrix, feImage, feTile, feDiffuseLighting, feSpecularLighting, feDistantLight, fePointLight, feSpotLight, feComponentTransfer, feFuncR/G/B/A).
- Always stripped in SVG mode: `script`, `foreignobject`, `animate`, `set`, `use` (yes, `<use>` is in the default disallow list — explicitly add it to `ADD_TAGS` if needed).
- All `on*` event handler attributes stripped.
- `xmlns` mismatches blocked (mXSS).
- Custom-element name patterns reserved by HTML are blocked.

If your sanitization pipeline allows `<use>` or SMIL animations, do so explicitly:

```javascript
DOMPurify.sanitize(dirty, {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  ADD_ATTR: ['href'],
  // and validate href values via uponSanitizeAttribute hook
});
```

## Server-side parser hardening

Independent of any HTML/SVG sanitizer, the XML parser that ingests the file must have:

- External entity resolution **disabled**.
- DTD loading **disabled**.
- Network access **disabled** in the XML stack.
- Entity expansion limits set (billion-laughs DoS defense).

Concrete:

- Python: `defusedxml` for the standard library, or `lxml.etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, load_dtd=False)`.
- Node: `libxmljs2` with `noent: false, dtdload: false, dtdvalid: false`, and a recent version that doesn't share the `libxml2` XXE bug class.
- Java: `DocumentBuilderFactory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)`, plus `XMLInputFactory.setProperty("javax.xml.stream.isSupportingExternalEntities", false)`.
- PHP: `libxml_set_external_entity_loader(...)` with a no-op callback, or `LIBXML_NONET` flag.

## Recommended deny list (regardless of sanitizer)

A minimum self-check before treating any SVG as safe to render inline:

- Element names: no `script`, no `foreignobject`.
- Attribute names: no name matching `/^on/i`.
- URL attribute values: scheme not in `{https, http, mailto, tel, "#"}`; for `data:` allow only `image/(png|jpeg|gif|webp)`.
- XML pre-content: no `<!DOCTYPE>`, no `<!ENTITY>`, no `<?xml-stylesheet?>`.
- SMIL: no `<animate>`/`<set>` with `attributeName="href"` or `attributeName="xlink:href"` and a forbidden `to`/`values`.
- CSS in `<style>` and `style=""`: no `expression(`, `behavior:`, `-moz-binding:`, `@import`, `@font-face` with non-data url, `url(javascript:...)`.

`scripts/validate_svg.py --strict` enforces most of these checks.

## Output framing recommendations

- Serve standalone `.svg` files with `Content-Type: image/svg+xml`.
- Add `Content-Security-Policy: default-src 'none'; sandbox` to standalone SVG responses.
- Prefer image-mode rendering (for example, using an `<img>` element) over inline SVG. Image-mode disables scripts and external fetching by spec.
- If the consumer must inline, run sanitization in the same parser context as the final render to avoid mXSS at the boundary.
