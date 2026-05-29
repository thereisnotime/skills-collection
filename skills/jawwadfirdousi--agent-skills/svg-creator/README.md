# svg-creator

Creates, edits, validates, and packages high-quality SVGs: icons, logos, illustrations, diagrams, charts, patterns, and inline SVG code.

## When it triggers

Auto-invokes on prompts like *"make me an SVG of …"*, *"design a 24×24 icon for …"*, *"give me a logo"*, *"create a diagram showing …"*, or *"fix this SVG markup"*. Or invoke explicitly:

```text
/svg-creator:svg-creator   # Claude Code
$svg-creator               # Codex
```

## What it does

1. Identifies the output type (icon, logo, illustration, diagram, chart, pattern, or markup repair).
2. Picks sensible defaults for `viewBox`, palette, and accessibility mode rather than asking when it doesn't have to.
3. Writes clean, standalone SVG markup with valid XML, stable ID prefixes, and proper accessibility (`role="img"` + `<title>`/`<desc>` for meaningful graphics, `aria-hidden` for decorative ones).
4. Validates with the bundled `skills/svg-creator/scripts/validate_svg.py` when code execution is available; falls back to the manual checklist in `skills/svg-creator/references/svg-validation-checklist.md` otherwise.
5. Returns either a complete `.svg` file or a complete inline `<svg>` element, depending on the request.

## Example prompts

A reusable template you can fill in:

```
Create a [static or animated] SVG [icon or illustration] of [subject].

Style: [modern, minimal, playful, elegant, polished].
Composition: [pose, layout, key elements].
Color: [palette].
Shape: [smooth curves, geometric, bold silhouette, simple details].
Animation: [only if animated: pulse, float, rotate, shimmer, wave, bounce].
Motion: [slow, subtle, smooth, seamless loop].
```

A few worked examples:

**Search icon (static, UI)**

```
Create a clean search icon.

Style: modern UI icon, simple and professional.
Composition: circular lens with angled handle.
Color: single-color.
Shape: consistent line weight, balanced spacing, crisp geometry.
```

**Spinning loader (animated, UI)**

```
Create a clean animated loading spinner.

Style: modern, minimal, professional UI icon.
Composition: circular spinner with one emphasized segment.
Animation: smooth continuous rotation.
Motion: steady, seamless, lightweight.
Color: single-color.
```

**Heartbeat icon (animated, decorative)**

```
Create a simple animated heart icon.

Style: smooth, modern, friendly, polished.
Composition: centered heart.
Animation: make the heart gently beat with a subtle scale pulse.
Motion: soft, rhythmic, smooth loop.
Color: warm red or pink.
```

## Examples

<table>
  <tr>
    <td align="center"><img src="skills/svg-creator/examples/sun.svg" width="96" height="96" alt="Sun"><br><sub>sun</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/heart.svg" width="96" height="96" alt="Heart"><br><sub>heart</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/star.svg" width="96" height="96" alt="Star"><br><sub>star</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="skills/svg-creator/examples/spinner.svg" width="96" height="96" alt="Spinner"><br><sub>spinner</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/paper-plane.svg" width="96" height="96" alt="Paper plane"><br><sub>paper-plane</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/wave.svg" width="96" height="96" alt="Wave"><br><sub>wave</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="skills/svg-creator/examples/document-scanner.svg" width="96" height="96" alt="Document scanner"><br><sub>document-scanner</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/search.svg" width="96" height="96" alt="Search"><br><sub>search</sub></td>
    <td align="center"><img src="skills/svg-creator/examples/waving-beach.svg" width="144" height="96" alt="Beach"><br><sub>waving-beach</sub></td>
  </tr>
</table>

## Bundled resources

| Path | Purpose |
| --- | --- |
| `skills/svg-creator/scripts/validate_svg.py` | Strict SVG validator — XML well-formedness, ID resolution, path-data sanity, viewBox, safety checks |
| `skills/svg-creator/references/svg-quality-standard.md` | Aesthetic and structural quality bar (used for detailed illustrations, logos, diagrams) |
| `skills/svg-creator/references/svg-templates.md` | Starter templates by SVG type — meaningful, decorative, accessible, illustration, diagram, plus SMIL animation patterns |
| `skills/svg-creator/references/svg-path-guide.md` | Path data BNF, smooth-curve reflection rules, implicit lineto, arc parsing |
| `skills/svg-creator/references/svg-security.md` | W3C / OWASP / DOMPurify-grounded security deny list (XSS surfaces, XXE, SMIL hijack) |
| `skills/svg-creator/references/svg-validation-checklist.md` | Manual checklist when the validator script can't run |
| `skills/svg-creator/examples/` | Nine production-grade SVGs (animated and static) you can study or pattern-match against |
| `skills/svg-creator/agents/openai.yaml` | Codex agent metadata (display name, default prompt, etc.) |

The skill loads each reference on demand — they don't add to context until needed.

## Won't do

- No `<script>` tags, event handlers, `javascript:` URLs, external CSS, external fonts, embedded raster data, or `foreignObject`.
- No CSS in the markup. Output is styled with presentation attributes and animated with SMIL, so it renders the same in any compliant SVG viewer, not just browsers.

## Install / uninstall

See the [top-level README](../README.md).
