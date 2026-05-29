---
name: svg-creator
description: create, edit, review, validate, and package high-quality svg graphics, icons, illustrations, diagrams, logos, charts, patterns, and inline svg code. use when the user asks to make a beautiful svg, generate an .svg file, fix or optimize svg markup, convert a visual concept into svg, design an icon system, or verify svg accessibility, safety, path data, viewbox, gradients, masks, filters, and browser-safe rendering.
allowed-tools: Write Read Bash(python3:*) Bash(python:*)
license: MIT
---

# SVG Creator

Produce SVGs that are spec-correct (W3C SVG 2), **CSS-independent**, accessible when meaningful, safe to render in untrusted contexts, optimized in size, and readable enough to edit.

## Core rules

### CSS independence (default)

The SVG must render identically in any compliant renderer — Chrome, Inkscape, librsvg, CairoSVG, native iOS/Android SVG support, COLR/SVG fonts, design tools, server-side rasterizers — without depending on a CSS engine, an HTML host, or external stylesheets. This means:

- **No `<style>` element.** Use presentation attributes (`fill="..."`, `stroke="..."`, `opacity="..."`) instead of CSS rules.
- **No `style="..."` attribute** on elements. Same reason.
- **No `currentColor`** unless the user explicitly asks for an icon themeable via CSS `color`. `currentColor` resolves through the CSS cascade; renderers without CSS fall back to black.
- **No CSS variables** (`var(--name)`).
- **No CSS animations** (`@keyframes`, `animation:` shorthand). For motion, use SMIL elements: `<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`.
- **No `:hover` / `:focus` rules.** Interactivity that requires CSS belongs in the host page, not in the SVG.
- **No external resources.** No `@import`, no external fonts, no remote `<image>` hrefs.

When the user explicitly opts in to web-only output ("for an HTML icon system", "themeable via parent color", "use Tailwind classes"), `currentColor` and a minimal `<style>` block are acceptable. Otherwise default to pure SVG.

### Root element

- Always include `xmlns="http://www.w3.org/2000/svg"` on the root `<svg>`. It is required for standalone SVG, `<img src>`, and copy-paste portability; only HTML5 inline-SVG tolerates its absence.
- Always include a `viewBox`. The attribute name is camelCase (`viewBox`, not `viewbox`). Format: `min-x min-y width height`, four finite numbers, width and height positive.
- Default `preserveAspectRatio` is `xMidYMid meet`. Set it explicitly only when you need cropping (`slice`) or non-uniform stretch (`none`).
- Never emit deprecated `version` or `baseProfile` attributes.
- Never emit `<!DOCTYPE>`, `<!ENTITY>`, or `<?xml-stylesheet?>`. Plain `<?xml ?>` declaration is allowed but unnecessary inside HTML.

### Coordinate system

- UI icon: `viewBox="0 0 24 24"`, stroke 1.5–2.
- Detailed icon: `viewBox="0 0 64 64"`.
- Illustration: `viewBox="0 0 512 512"` or `0 0 1200 800`.
- Diagram: grid-aligned (e.g. `0 0 800 500`).
- Pattern tile: design one tile and document repeat behavior.

Keep all rendered geometry inside the viewBox. Strokes that touch an edge will be clipped by half their stroke-width unless inset.

### Path data

- Start every visible path with `M` or `m`. After `M`, extra coordinate pairs are implicit `L`/`l` commands; after `m`, implicit `l`.
- Smooth curves (`S`/`s`, `T`/`t`) reflect the previous control point **only** if the previous command was the matching curve type (`C`/`c` for `S`; `Q`/`q` for `T`). Otherwise the inferred control point collapses to the current point and produces a degenerate curve. Never emit `S` after `L`.
- Arc command takes exactly seven values: `rx ry x-axis-rotation large-arc-flag sweep-flag x y`. Flags must be `0` or `1`. The path-data parser treats arc flags as a single digit each; do not write `10` thinking it means "1, 0".
- Avoid negative arc radii (the spec normalizes via absolute value but explicit positive values are clearer for tooling).
- Cap path-data decimals at 2–3 places for icons, 3–4 for illustrations. Extra precision wastes bytes without visible improvement.

### Color and paint

- `fill` defaults to **black**, `stroke` defaults to **none**. A bare `<path d="..."/>` renders solid black. For a stroke-only icon, set `fill="none"` and a stroke explicitly.
- Set explicit colors as presentation attributes: `fill="#3b82f6"`, `stroke="#0f172a"`. Avoid `currentColor` by default; reach for it only when the user explicitly asks for a CSS-themeable icon (and only on the targeted shape, not as a global default).
- Set `stroke-linecap="round"` and `stroke-linejoin="round"` for friendly UI icons and organic line art. Use `miter` only for sharp technical/geometric styles, and set `stroke-miterlimit` to avoid spikes at sharp joins.
- For diagrams that may be scaled non-uniformly, use `vector-effect="non-scaling-stroke"`.
- `paint-order` defaults to `fill stroke markers`. To outline text without eating into letterforms, set `paint-order="stroke"` on `<text>`.
- `fill-rule` defaults to `nonzero`. For shapes drawn as nested sub-paths where direction matters, consider `fill-rule="evenodd"`.

### Identifiers and references

- Every `id` must be unique. Prefix with the subject (`mountain-gradient-a`, `chart-clip`, `arrow-marker`).
- Every `url(#id)` and `href="#id"` must resolve. Sanitize both `href` and `xlink:href`; legacy `xlink:href` still resolves if `href` is absent.
- Avoid `xlink:href` in new output. SVG 2 supports plain `href` everywhere.

### Gradients

- `gradientUnits` default is `objectBoundingBox` (x1/y1/x2/y2 are 0–1 fractions of the filled element's bounding box). Use `userSpaceOnUse` when you want absolute placement.
- Default linearGradient vector is horizontal: `x1=0% y1=0% x2=100% y2=0%`. Set vectors explicitly when you want diagonal or vertical gradients.
- `spreadMethod` defaults to `pad`. Use `reflect` or `repeat` only intentionally.
- Stop offsets must be monotonically non-decreasing. Out-of-range values are clamped to `[0, 1]`.

### Masks vs clipPath

- `clipPath` is **binary** (in or out, no soft edge). `mask` is **alpha or luminance**, allowing soft edges and gradients.
- `clipPathUnits` defaults to `userSpaceOnUse`. **`maskUnits` defaults to `objectBoundingBox`.** They are opposite. Set explicitly when in doubt.
- `mask` defaults to `mask-type="luminance"`: white pixels show, black pixels hide. Naive masks drawn with default colors render as invisible. Either set `mask-type="alpha"` or use white fills.

### Filters

- Filter region defaults are `x="-10%" y="-10%" width="120%" height="120%"`. This expands the source bounds 10% on each side. **Effects extending further (drop shadows, glows, large blurs) get clipped.** For a shadow with `dy=8 stdDeviation=10`, expand to e.g. `x="-25%" y="-25%" width="150%" height="150%"`.
- `feDropShadow` is the safest way to draw a shadow. It consolidates blur + offset + flood + composite + merge into one element.
- `feMerge` stacks `<feMergeNode>` children bottom-to-top in document order.
- `color-interpolation-filters` defaults to `linearRGB` (not sRGB). For color-accurate blending against non-filtered content, set `color-interpolation-filters="sRGB"` on the `<filter>`.
- Avoid expensive primitives in animations: `feTurbulence`, `feMorphology`, `feDisplacementMap`, `feConvolveMatrix` rasterize per frame. Cache or pre-render.

### Markers

- `markerUnits` defaults to `strokeWidth`: marker dimensions scale with the host stroke. Use `userSpaceOnUse` to fix marker size regardless of stroke.
- `orient="auto"` rotates the marker to match path direction; `auto-start-reverse` lets one arrowhead serve both ends.
- Use `fill="context-stroke"` on the marker's geometry so the arrowhead inherits the line's color.

### Accessibility

For SVGs that carry meaning (illustrations, charts, diagrams, meaningful logos):

- Set `role="img"` on the root for atomic graphics. Use `role="graphics-document"` (subclass of `document`) for charts/maps/diagrams whose layout conveys meaning, with children navigable. Use `role="graphics-symbol"` (subclass of `img`) for atomic glyphs whose meaning matters more than visual detail.
- Place `<title>` and `<desc>` as the **first** direct children of the root. Spec allows them anywhere among children, but several screen readers historically required first-child placement.
- Reference them with `aria-labelledby="<title-id> <desc-id>"`. `aria-labelledby` and `aria-describedby` take precedence over `<title>`/`<desc>` for accessible name/description computation.
- Provide one `<title>` and at most one `<desc>` per element.

For purely decorative SVGs (next to visible text, button icons with labels, ambient marks):

- Set `aria-hidden="true"` and `focusable="false"`. The latter suppresses a legacy IE/Edge focus quirk.
- Do not include `role="img"` simultaneously with `aria-hidden="true"`.

### Security (always strip these in untrusted SVG)

- `<script>` element.
- Any attribute whose lowercased name starts with `on` (event handlers including `onclick`, `onload`, `onerror`, `onbegin`, `onend`, `onrepeat`, `onzoom`).
- `javascript:` URLs in `href`, `xlink:href`, or any URL-bearing attribute.
- `<foreignObject>` (full HTML inside SVG, the highest-risk element).
- External resource references in `<image>`, `<use>`, `<feImage>`, `<a>`, CSS `url(...)`, `@import`, `@font-face`. Allow only fragment refs (`#id`).
- `data:` URLs limited to `image/png`, `image/jpeg`, `image/gif`, `image/webp` in `<image href>`. **Never `data:image/svg+xml`** (equivalent to inline SVG).
- XML constructs: `<!DOCTYPE>`, `<!ENTITY>` (XXE), `<?xml-stylesheet?>` PI.
- SMIL animations whose `to`/`from`/`values` change `href`/`xlink:href` to `javascript:` or `data:image/svg+xml`.

For output that may end up in untrusted hands, recommend the consumer pass it through DOMPurify with `USE_PROFILES: { svg: true, svgFilters: true }`, and parse server-side with external entity resolution disabled (`defusedxml` in Python, `disallow-doctype-decl` feature in Java).

### Animation (SMIL only)

For CSS-independent SVG, animation is **always** SMIL — declarative animation elements baked into the SVG document. CSS animations require a CSS engine the renderer may not have.

- Use `<animate>` for scalar attributes (`cx`, `r`, `opacity`, `fill`, `stroke-width`, etc.).
- Use `<animateTransform>` for transform animation. The `type` attribute is required: `translate`, `scale`, `rotate`, `skewX`, `skewY`. **Never use `<animate attributeName="transform">`** — that doesn't work.
- Use `<animateMotion>` for path-following motion. Provide a `path` attribute or a child `<mpath href="#path-id"/>`. Optional `rotate="auto"` aligns the moved element to the path tangent.
- Use `<set>` for instantaneous attribute changes at a `begin` time (no interpolation).
- Required attributes for animations: `attributeName` (case-sensitive, kebab-case e.g. `stroke-width`), one of `from`+`to` / `by` / `values`, and `dur`.
- Default `repeatCount` is 1. Use `repeatCount="indefinite"` to loop. `fill="freeze"` keeps the end state at animation completion instead of reverting; `fill="remove"` (default) reverts.
- For multi-step animation, use `values="a;b;c;d"` with optional `keyTimes="0;0.25;0.5;1"` (lengths must match) and `calcMode="linear"` (default), `discrete`, `paced`, or `spline` (with `keySplines`).
- For complex sequencing, use `begin="otherAnim.end"` and `begin="elementId.click"` to chain animations declaratively.
- SMIL ignores `prefers-reduced-motion` automatically. For inclusive output, keep motion subtle, brief, looping, and never essential to comprehension. Always provide a static equivalent when motion isn't required by the brief.

Reference and full element list: [W3Schools SVG Animation](https://www.w3schools.com/graphics/svg_animation.asp), [MDN SMIL animation](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_animation_with_SMIL).

### Performance

- Element count: under 500 is fast everywhere; 500–5,000 is fine on desktop, slow on mobile zoom; over 10,000 needs reconsideration (canvas, tiling, simplification).
- One complex path is cheaper than many simple paths. Use SVGO-style `mergePaths` mentally when authoring.
- Filters force an offscreen rasterization pass. Combine effects in a single `<filter>` chain rather than nesting filters across groups.
- Gradient stop count: keep ≤ 8 in animated gradients.

## Workflow

1. Identify the output type: icon, logo, illustration, diagram, chart, pattern, animation, or markup repair.
2. Resolve missing brief details with sensible defaults (do not interrogate the user) unless brand colors, exact dimensions, or a sensitive logo recreation are involved.
3. Plan before drawing: pick `viewBox`, palette, accessibility mode, and target size.
4. Write the SVG as clean, indented standalone markup with stable IDs and meaningful group names.
5. Validate before returning, when code execution is available:

   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/validate_svg.py output.svg --strict
   ```

6. Fix every reported error and rerun until clean.
7. If code execution is unavailable, manually apply `references/svg-validation-checklist.md`.
8. Return either a complete `.svg` file or a complete inline `<svg>` element. For markup repair, return the full corrected SVG, not a patch.

## Reference loading

Read these on demand only:

- `references/svg-quality-standard.md` for detailed illustrations, logos, diagrams, patterns, or anything where aesthetics matter.
- `references/svg-templates.md` when starting from a blank prompt or producing a specific SVG type.
- `references/svg-path-guide.md` before writing or repairing complex `d` data, especially smooth curves and arcs.
- `references/svg-security.md` when output may be rendered in untrusted contexts, or when reviewing/sanitizing existing SVG.
- `references/svg-validation-checklist.md` when the validator script can't run.

## Output contract

For new SVGs, produce one of:

- A complete standalone `.svg` file with valid XML and resolved references.
- A complete inline `<svg>` element suitable for HTML.
- A short explanation plus the SVG, only when the user asks for explanation or the design has non-obvious choices.

For SVG repair, return the corrected complete SVG. For sets (icon families, multi-state graphics), use a consistent coordinate system, stroke language, ID prefix, and palette across all members.

## Gotchas (high-impact, easy to miss)

- **`<style>` and `style="..."` break portability.** A renderer without a CSS engine ignores them. Use presentation attributes.
- **`currentColor` defaults to black** in non-CSS renderers. Use explicit colors unless the user asks for CSS theming.
- `viewBox` is camelCase. `viewbox` silently fails in strict XML parsing.
- `fill` default is black. Forgetting `fill="none"` on a stroked outline produces a solid black blob.
- `mask-type` default is `luminance`. White-on-black masks reveal; alpha-style masks need `mask-type="alpha"`.
- Filter region defaults clip shadows. Expand explicitly.
- Arc flags are single-digit. Compact `A 25,25 0 016,3` parses as flags `0`, `1` then number `6`.
- `S`/`T` after a non-matching curve degenerate. Always pair `C`→`S` and `Q`→`T`.
- Both `href` and `xlink:href` must be sanitized; the deprecated form still resolves.
- `<animate attributeName="transform">` does not work; use `<animateTransform type="...">`.
- `data:image/svg+xml` URLs are equivalent to inline SVG and unsafe in `<image href>`.
