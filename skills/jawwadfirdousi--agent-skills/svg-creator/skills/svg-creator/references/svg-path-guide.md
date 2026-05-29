# SVG Path Guide

Reference for writing or repairing the `d` attribute. Grounded in [W3C SVG 2 Paths](https://www.w3.org/TR/SVG2/paths.html) and the [path data BNF](https://www.w3.org/TR/SVG2/paths.html#PathDataBNF).

## How the path-data parser tokenizes

These rules govern what counts as one number versus two:

- **Whitespace and commas are optional separators.** `M10 20` and `M 10,20` and `M10,20` all parse identically.
- **Sign change implicitly separates.** `M 100-200` parses as `M 100 -200`. The `-` can't follow a digit inside a coordinate.
- **A second decimal point implicitly separates.** `M 0.6.5` parses as `M 0.6 .5`. A coordinate has at most one decimal point.
- **Scientific notation is accepted.** `1e3`, `1.5E-2`, `.5e+1` are all numbers.
- **Arc flags are single digits.** `A 25,25 0 016,3` is `A 25 25 0 (flag 0) (flag 1) 6 3`. The parser stops after one digit; do not write `10` for "1 then 0".
- The parser is greedy and stops at the first character that doesn't continue the current production. Compact path data can hide bugs; favor whitespace separation while authoring, then optimize.

## Commands

Uppercase = absolute, lowercase = relative. All commands accept multiple parameter sets per command letter; the letter does not need to be repeated.

| Cmd | Params per use | Meaning |
| --- | --- | --- |
| `M` / `m` | `x y` | Move to. Subsequent pairs are implicit `L`/`l` (lineto). |
| `L` / `l` | `x y` | Line to point. |
| `H` / `h` | `x` | Horizontal line. Equivalent to `L x current-y`. |
| `V` / `v` | `y` | Vertical line. Equivalent to `L current-x y`. |
| `C` / `c` | `x1 y1 x2 y2 x y` | Cubic Bézier. |
| `S` / `s` | `x2 y2 x y` | Smooth cubic. First control point is reflected. |
| `Q` / `q` | `x1 y1 x y` | Quadratic Bézier. |
| `T` / `t` | `x y` | Smooth quadratic. Control point is reflected. |
| `A` / `a` | `rx ry rot large sweep x y` | Elliptical arc. |
| `Z` / `z` | none | Close path. |

## Move (`M` / `m`)

- Every visible path must start with `M` or `m`.
- A relative `m` at the start of a path is treated as absolute (no current point exists yet to be relative to). Subsequent pairs are still relative.
- `M 10 30 50 30 90 30` is shorthand for `M 10 30 L 50 30 L 90 30`.

## Lineto (`L`, `H`, `V`)

- `H`/`V` are pure shorthand and produce the same rendering as `L` with one coordinate substituted.
- Long polylines should use `L` once with many coordinate pairs rather than repeating the command letter.

## Smooth curves (`S` / `s`, `T` / `t`)

The reflection rule has a critical caveat:

> The first control point of S is the reflection of the second control point of the previous command, **only if the previous command was C, c, S, or s**. Otherwise the inferred control point coincides with the current point.

> The control point of T is the reflection of the previous Q/q/T/t control point, **only if the previous command was Q, q, T, or t**. Otherwise it coincides with the current point.

Implications:

- `M 0 0 L 10 0 S 20 0 30 0` collapses the smooth curve into a straight line — the previous command was `L`, not `C`.
- Always pair `C` → `S` and `Q` → `T`. Mixing them produces visually broken curves.
- After a `Z`, the "previous command" effectively resets; do not rely on reflection across closepath.

## Arc (`A` / `a`)

The seven values per arc segment, in order:

1. `rx` — x radius (treated as absolute value if negative).
2. `ry` — y radius (treated as absolute value if negative).
3. `x-axis-rotation` — degrees of rotation applied to the ellipse's x-axis.
4. `large-arc-flag` — `0` for the smaller of the two possible arcs, `1` for the larger.
5. `sweep-flag` — `0` to draw the arc in negative-angle direction (counter-clockwise in default coordinate system), `1` for positive (clockwise).
6. `x` — destination x.
7. `y` — destination y.

Common mistakes:

- Six or eight values per segment instead of seven.
- Boolean strings (`true`/`false`) instead of `0`/`1` for flags.
- Failing to space-separate flags from the next coordinate, hitting the single-digit parsing rule (`A 25,25 0 0,1,6,3` is safer than `A 25,25 0 016,3`).
- Setting `rx` or `ry` to zero, which silently degenerates the arc into a straight line.
- Endpoint identical to current point (`A` segment is omitted entirely).
- Radii too small to reach the endpoint. The spec scales them up uniformly until exactly one ellipse fits, but it is clearer to compute correct radii.

Self-closing circle as a single arc:

```svg
d="M 12 4 A 8 8 0 1 1 11.99 4"
```

The endpoint is offset by 0.01 to avoid the "endpoint identical to current point" omission.

## Closepath (`Z`)

- `Z` and `z` are identical (no parameters).
- Always use closepath for filled shapes that should look closed; without `Z`, the start and end of the stroke are joined with two `stroke-linecap` ends rather than one `stroke-linejoin`.
- After `Z`, if the next command is a `M`, the new subpath starts at that move's coordinates. If the next command is anything else, the new subpath starts at the same initial point as the just-closed subpath.

## Authoring practices

- Prefer several named paths over one giant path when the SVG will be edited later.
- Use cubic curves (`C`) for organic shapes and expressive silhouettes.
- Use quadratic curves (`Q`) for simpler rounded corners and symmetric forms.
- Calculate mirrored coordinates rather than estimating them. For symmetric shapes, the time saved during repair is greater than the time spent on arithmetic.
- Keep handle lengths consistent for symmetric forms.
- Limit decimals to 2–3 for icons (16–48 px viewBox) and 3–4 for illustrations. More precision wastes bytes without visible benefit.

## Repair workflow

When a path fails validation:

1. Replace compact syntax with whitespace-separated form. The parser's implicit-separation rules hide bugs.
2. Tokenize mentally: command letter, then N values per command's parameter count.
3. Verify each command has the correct number of values. Common offenders: `C` (6), `S` (4), `Q` (4), `T` (2), `A` (7).
4. Verify arc flags are single digits and separated from the next number.
5. If a smooth curve looks degenerate, check that the previous command was the matching curve type.
6. If the path is unmanageable, split it into multiple `<path>` elements (one per subpath).
7. Run `python3 scripts/validate_svg.py file.svg --strict`.

## Quick conversion table

To convert a coordinate sequence between absolute and relative forms:

- Uppercase command, all coordinates absolute (origin at viewBox `min-x, min-y`).
- Lowercase command, all coordinates are deltas from the current point.
- Convert: `relative_x = absolute_x - prev_x`, `relative_y = absolute_y - prev_y`. For `H`/`h` and `V`/`v`, only the single coordinate changes.

When in doubt, write absolute and let SVGO convert during optimization.
