# SVG Quality Standard

Reference for detailed SVG creation. Use when the user asks for a beautiful, polished, premium, brand-ready, production-ready, or error-free SVG.

## Quality target

A finished SVG should satisfy seven checks:

1. It communicates the requested subject instantly.
2. It has a clear visual hierarchy: primary form, supporting details, restrained accents.
3. It is technically valid XML with a correct SVG root, namespace, viewBox, references, and path data.
4. It is accessible or intentionally decorative.
5. It is safe and self-contained for browser rendering.
6. It is small and editable. No bloat, no unused defs, no leftover editor metadata.
7. **It is CSS-independent.** Renders identically in any compliant SVG renderer.

## CSS independence

Default to pure SVG. Style with presentation attributes (`fill`, `stroke`, `opacity`, `stroke-width`, `stroke-linecap`, etc.), not with CSS.

- No `<style>` element.
- No `style="..."` attribute.
- No `currentColor`, no CSS variables (`var(...)`).
- No CSS animations (`@keyframes`, `animation:`). Use SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`).
- No `:hover` / `:focus` / media queries.
- No `@import` or external fonts.

The benefit: the same SVG renders correctly in browsers, Inkscape, librsvg, CairoSVG, native iOS/Android SVG support, COLR/SVG fonts, design tools, and server-side rasterizers. Adding CSS reduces the supported renderer set to "browsers and a few CSS-aware tools".

Use CSS only when the user opts in for a web-only output ("for an HTML icon system", "themeable via Tailwind").

## Canvas and geometry defaults

Choose a coordinate system before drawing.

- UI icon: `viewBox="0 0 24 24"`, stroke `1.5`, `1.75`, or `2`.
- Detailed app icon: `viewBox="0 0 64 64"`, mix filled shapes and consistent strokes.
- Square illustration: `viewBox="0 0 512 512"`, layer groups with gradients and soft shadows.
- Wide hero illustration: `viewBox="0 0 1200 800"`, leave generous negative space.
- Diagram: grid-aligned canvas (e.g. `0 0 800 500`), prioritize readable labels and connectors.
- Pattern: design one tile and document repeat behavior.

Keep all important geometry inside the viewBox. If a stroke reaches an edge, inset the shape by at least half the stroke width.

`preserveAspectRatio` defaults to `xMidYMid meet`. Override only when intentional:

- `xMidYMid slice` to crop content while filling the viewport (background images).
- `none` to non-uniformly stretch (rare, usually wrong for icons).

## Composition principles

- One dominant silhouette or focal area.
- Two to four secondary detail clusters; never many unrelated details.
- Repetition for polish: consistent radius, stroke width, spacing, angles.
- Asymmetry on purpose, not by accident.
- Optical balance over bounding-box centering. Visual mass should feel centered.
- Test mentally at the smallest target size. Drop details that collapse.
- Build illustrations with overlap, scale, atmospheric contrast, gradients, and shadows rather than excessive outlines.

## Color strategy

Use a compact palette unless the user provides brand colors. **Always use explicit colors** as presentation attributes (`fill="#3b82f6"`, `stroke="#0f172a"`). Avoid `currentColor` and CSS variables in CSS-independent SVG — they resolve only inside a CSS engine.

- Monochrome icons: pick a single explicit color (e.g. `stroke="#0f172a"`).
- UI accent icon: one neutral plus one accent, both explicit.
- Rich illustration: one background, one main hue, one secondary hue, one highlight, one shadow — all as explicit hex values.
- Gradients reinforce form or lighting; avoid many unrelated gradients.
- Verify contrast for thin strokes, foreground objects, and any text.

`currentColor` is acceptable **only** when the user explicitly asks for an icon themeable via CSS `color` and accepts that the SVG won't render correctly outside a CSS engine. CSS variables (`var(...)`) and `<style>` blocks fall under the same opt-in rule.

## Strokes and joins

- One primary stroke width per icon family.
- `stroke-linecap="round"` and `stroke-linejoin="round"` for friendly UI icons, organic illustrations, and most line art.
- `stroke-linejoin="miter"` only for sharp technical or geometric styles. Set `stroke-miterlimit` to avoid spikes at sharp joins (default `4`; reduce to clip earlier).
- `vector-effect="non-scaling-stroke"` for diagrams that may scale non-uniformly.
- Avoid hairline strokes under `1` user unit unless the viewBox and display size are known.

## Color and paint defaults to remember

- `fill` defaults to **black**, `stroke` defaults to **none**. A bare path renders solid black.
- `paint-order` defaults to `fill stroke markers`. Use `paint-order="stroke"` on `<text>` to keep a stroke from eating into the letterforms.
- `fill-rule` defaults to `nonzero`. For nested sub-paths where direction matters, `fill-rule="evenodd"` is direction-independent.

## Gradients

Use `<defs>` for reusable resources and keep IDs unique.

```svg
<defs>
  <linearGradient id="example-gradient" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8fd3ff"/>
    <stop offset="1" stop-color="#4c6fff"/>
  </linearGradient>
</defs>
```

Defaults to remember:

- `linearGradient` defaults: `gradientUnits="objectBoundingBox"`, `x1=0% y1=0% x2=100% y2=0%`, `spreadMethod="pad"`. The default vector is horizontal. Set `x1/y1/x2/y2` explicitly when you need diagonal or vertical gradients.
- `radialGradient` defaults: `cx=cy=r=50%`, `fx=cx`, `fy=cy`, `fr=0%`.
- `<stop>` defaults: `offset=0`, `stop-color=black`, `stop-opacity=1`. Out-of-range offsets are clamped to `[0, 1]` and must be monotonically non-decreasing.
- For absolute coordinates (e.g. positioning the gradient in user space), set `gradientUnits="userSpaceOnUse"`.

Keep animated gradients to ≤ 8 stops; many engines drop GPU acceleration above this.

## Masks vs clipPath

- `clipPath` is binary: a pixel is either inside (drawn) or outside (not drawn). No soft edges.
- `mask` is alpha or luminance: per-pixel modulation enables soft edges, gradients, and partial transparency.
- `clipPathUnits` defaults to `userSpaceOnUse`. `maskUnits` defaults to `objectBoundingBox`. They are opposite. Set explicitly when in doubt.
- `mask-type` defaults to `luminance`: white pixels reveal, black pixels hide. For alpha-style masks, set `mask-type="alpha"`.

## Filters

Use `<filter>` sparingly. Each filtered element triggers an offscreen rasterization pass.

Default filter region is `x="-10%" y="-10%" width="120%" height="120%"`. **Effects extending beyond this region get clipped.** For drop shadows or glows that travel beyond the source bounds, expand explicitly:

```svg
<filter id="card-shadow" x="-25%" y="-25%" width="150%" height="150%">
  <feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.18"/>
</filter>
```

Other filter rules:

- `feDropShadow` is the safest single-element shadow primitive (consolidates blur + offset + flood + composite + merge).
- `feMerge` stacks `<feMergeNode>` children bottom-to-top in document order.
- `color-interpolation-filters` defaults to `linearRGB` (not sRGB). For color-accurate blending against non-filtered content, set `color-interpolation-filters="sRGB"` on the `<filter>`.
- Avoid expensive primitives in animations: `feTurbulence`, `feMorphology`, `feDisplacementMap`, `feConvolveMatrix` rasterize per frame.

## Markers

- `markerUnits` defaults to `strokeWidth`: marker dimensions scale with the host stroke. Use `userSpaceOnUse` for fixed marker size.
- `orient="auto"` rotates with path direction; `auto-start-reverse` lets one arrowhead serve both ends.
- Use `fill="context-stroke"` so the marker inherits the line's color.

## Text

Use text only when the prompt requires it. SVG text renders differently across systems.

- For diagrams and charts, use common font families (`system-ui`, `Arial`, `sans-serif`).
- For logos and wordmarks, draw letters as paths when exact appearance matters, or state the font dependency clearly.
- Escape XML special characters in text content (`&amp;`, `&lt;`, `&gt;`).
- Keep text large enough for the intended display size.
- For outlined text, use `paint-order="stroke"` so the stroke renders behind the fill.

## Icons

- Prefer simple shapes and paths over detailed illustrations.
- Center the visual mass, not the bounding box.
- Use even spacing and consistent corner radii.
- Test mentally at 16 px, 24 px, and 48 px.
- Decorative icons: `aria-hidden="true"`, `focusable="false"`, no `<title>`/`<desc>`.

## Illustrations

- Stack background → main subject → details → highlights.
- Use groups with meaningful IDs: `background`, `subject`, `details`, `highlights`, `shadow`.
- Add depth through layered opacity and gradients.
- Limit filters and name them.
- Avoid photo-like complexity. SVG excels at stylized vector art.

## Diagrams and charts

- Favor clarity over decoration.
- Align nodes, labels, and connectors to a grid.
- Use arrowheads via `<marker>` definitions.
- Use `role="graphics-document"` (or `role="img"` for atomic) and provide `<title>` and `<desc>` summarizing the message.
- For data charts, calculate coordinates from the data; do not estimate.

## Logos

- Distinctive at small sizes.
- Avoid imitating protected brand marks unless the user owns them or asks for analysis rather than reproduction.
- Use geometric primitives and negative space.
- Provide a clean monochrome variant when practical.

## Performance budget

- Element count: under 500 is fast everywhere; 500–5,000 is fine on desktop, slow on mobile zoom; over 10,000 needs reconsideration.
- One complex path is cheaper than many simple paths.
- Filters force offscreen rasterization. Combine effects within one `<filter>` rather than nesting.
- Keep gradient stops to ≤ 8 in animated gradients.

## Production cleanup

Before finalizing:

- Remove unused defs.
- Remove comments unless they help editing.
- Remove hidden draft shapes.
- Ensure every `id` is referenced or intentionally available.
- Cap decimals at 2–3 for icons, 3–4 for illustrations.
- Drop editor namespace data (`xmlns:inkscape`, `xmlns:sodipodi`, `xmlns:sketch`) and editor-specific attributes.
- Drop `xmlns:xlink` and replace any `xlink:href` with `href`.
- Run `python3 scripts/validate_svg.py output.svg --strict`.
