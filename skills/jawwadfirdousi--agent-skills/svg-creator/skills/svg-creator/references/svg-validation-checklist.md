# SVG Validation Checklist

Use this when reviewing SVG output manually or when `scripts/validate_svg.py` cannot be executed.

## XML and SVG root

- The SVG is complete XML or a complete inline `<svg>` element.
- Root element is `<svg>`.
- Root has `xmlns="http://www.w3.org/2000/svg"`.
- Root has `viewBox` (camelCase) with four finite numbers, width and height positive.
- Root has either `width`/`height` or relies on `viewBox` for intrinsic ratio.
- Tags are properly closed (self-closing for void-style elements: `<rect ... />`).
- XML special characters escaped in text and attributes (`&amp;`, `&lt;`, `&gt;`, `&quot;`).
- No `<!DOCTYPE>`, no `<!ENTITY>`, no `<?xml-stylesheet?>` processing instruction.
- No deprecated `version` or `baseProfile` attributes.

## CSS independence (default mode)

For SVGs intended to render in any compliant renderer (Inkscape, librsvg, CairoSVG, native mobile, design tools), confirm:

- No `<style>` element anywhere in the document.
- No `style="..."` attribute on any element.
- No `class="..."` attribute (CSS hook with no effect without a CSS engine).
- No `currentColor` value in `fill`, `stroke`, `flood-color`, `stop-color`, etc.
- No CSS variables (`var(...)`).
- No `@keyframes`, `@import`, `@media`, `@font-face`.
- Animation uses SMIL elements (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`), not CSS.
- All visual properties expressed as presentation attributes.

Skip these checks only when the user explicitly opted in to CSS-themed output (a web-only icon system, etc.).

## Accessibility

For meaningful SVGs (illustrations, charts, diagrams, meaningful logos):

- Root has `role="img"` (atomic), or `role="graphics-document"` (chart/map/diagram with navigable children), or `role="graphics-symbol"` (atomic glyph).
- Root has `aria-labelledby` pointing to existing IDs.
- `<title>` is present and descriptive (short, label-like).
- `<desc>` is present for non-obvious diagrams, charts, illustrations.
- `<title>` and `<desc>` appear as **direct children** of the root, ideally as the first two children.
- One `<title>` per parent. Multiple titles cause undefined behavior.

For decorative SVGs (icons next to visible labels, ambient marks):

- Root has `aria-hidden="true"`.
- Root has `focusable="false"`.
- No `role="img"` together with `aria-hidden="true"`.
- No `<title>` unless intentionally rendered as tooltip.

## Safety

### Elements

- No `<script>`.
- No `<foreignObject>`.
- No `<iframe>`, `<object>`, `<embed>`, `<audio>`, `<video>`, `<canvas>`.

### Attributes

- No attribute whose lowercased name starts with `on` (event handlers — covers `onclick`, `onload`, `onbegin`, `onend`, `onrepeat`, `onzoom`, etc.).
- No attribute value containing `javascript:`, `vbscript:`, `livescript:`, `mocha:`.

### URLs

- All `href` values match the allow list: `https:`, `http:`, `mailto:`, `tel:`, fragment `#id`, or raster `data:image/(png|jpeg|gif|webp)`.
- Same checks applied to `xlink:href` (deprecated but still resolves).
- No `data:image/svg+xml` URLs anywhere.
- No external URLs in `<image>`, `<use>`, `<feImage>`, `<a>`, CSS `url(...)`.

### CSS

- No `@import`.
- No `@font-face` with non-data url.
- No `expression(`, `behavior:`, `-moz-binding:`.
- `url(...)` references resolve only to in-document fragment IDs.

### Animation

- If SMIL is present: `<animate>` and `<set>` do not target `attributeName="href"` or `attributeName="xlink:href"` with a `to`/`values` containing `javascript:` or `data:image/svg+xml`.

## References

- Every `url(#id)` resolves to an existing ID.
- Every `href="#id"` resolves to an existing ID.
- Every ARIA reference (`aria-labelledby`, `aria-describedby`) resolves.
- IDs are unique across the document.
- IDs are stable, prefixed with the subject.
- Gradients, masks, clips, filters, markers, patterns, and symbols have unique IDs.

## Geometry and rendering

- Main shapes are inside the viewBox.
- Strokes near edges are inset enough to avoid clipping.
- Filled shapes have intended closure (`Z` only when meant to close).
- Filter regions are large enough for shadows and glows (default `x=-10% y=-10% width=120% height=120%` clips most non-trivial effects; expand to `-25% / 150%` for typical drop shadows).
- Gradients use the intended coordinate mode (`gradientUnits="objectBoundingBox"` default = 0–1 fractions).
- Masks have correct `mask-type` (default `luminance`; for alpha-style use `mask-type="alpha"`).
- `clipPathUnits` (default `userSpaceOnUse`) and `maskUnits` (default `objectBoundingBox`) — verify intent matches default.
- Text is readable at the target size.
- Icons remain legible at small sizes.

## Paint and color

- A bare `<path>` without `fill="none"` will render solid black; verify intent.
- Stroke-only outlines have `fill="none"` plus a stroke color.
- Colors are explicit hex values (e.g. `fill="#3b82f6"`), not `currentColor`, unless the user opted into CSS theming.
- Paint-order is the default (`fill stroke markers`) unless `paint-order="stroke"` is intentional (typically for outlined text).

## Path data

- Every visible path starts with `M` or `m`.
- Every command has the correct number of numeric values: `C`(6), `S`(4), `Q`(4), `T`(2), `A`(7), `M`/`L`(2 per pair), `H`/`V`(1).
- Arc commands have seven values per segment.
- Arc flags are `0` or `1`, single-digit, properly separated from the next coordinate.
- Smooth curves (`S`, `T`) follow a matching curve type (`C` before `S`; `Q` before `T`). Otherwise the inferred control point coincides with the current point and produces a degenerate curve.
- `Z` used only when the path should be closed.
- No invalid characters, unbalanced signs, or missing values.

## Performance

- Element count is appropriate for the use case (under 500 ideal, under 5,000 acceptable, more requires justification).
- Filters are not nested unnecessarily; one `<filter>` chain rather than multiple wrapping groups.
- Gradient stops kept to ≤ 8 in animated contexts.
- Expensive filter primitives (`feTurbulence`, `feMorphology`, `feDisplacementMap`, `feConvolveMatrix`) only used when justified, ideally not animated.

## Aesthetic quality

- One clear focal point.
- Coherent, restrained palette.
- Consistent stroke widths, corner radii, spacing.
- Subtle, purposeful gradients and shadows.
- Detail level matches the intended display size.
- Groups and IDs make the file understandable for future edits.

## Cleanup

- No editor namespace data (`xmlns:inkscape`, `xmlns:sodipodi`, `xmlns:sketch`).
- No `xmlns:xlink` if no `xlink:` attributes remain.
- No leftover comments unless they aid editing.
- No hidden or unreferenced defs.
- Decimal precision capped (2–3 for icons, 3–4 for illustrations).

## Final step

If tools are available, save the SVG and run:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/validate_svg.py output.svg --strict
```

Fix every error. For production work, fix warnings too unless a warning is intentionally accepted for the target environment.
