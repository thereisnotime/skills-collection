#!/usr/bin/env python3
"""Validate SVG files for well-formedness, safety, accessibility, and common SVG mistakes.

This script is intentionally dependency-free so it can run in constrained agent
environments. It is not a full browser renderer, but it catches the most common
issues that cause SVGs to fail, render unsafely, or behave unpredictably.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

NUMBER_RE = re.compile(r"[-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][-+]?\d+)?")
LENGTH_RE = re.compile(
    r"^\s*([-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][-+]?\d+)?)(px|pt|pc|mm|cm|in|em|rem|ex|ch|vw|vh|vmin|vmax|%)?\s*$"
)
ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.:-]*$")
URL_REF_RE = re.compile(r"url\(\s*['\"]?#([^)'\"\s]+)['\"]?\s*\)")
ANY_URL_RE = re.compile(r"url\(\s*['\"]?([^)'\"\s]+)", re.IGNORECASE)
CSS_IMPORT_RE = re.compile(r"@import\b", re.IGNORECASE)

GRAPHIC_TAGS = {
    "a",
    "circle",
    "ellipse",
    "g",
    "image",
    "line",
    "path",
    "polygon",
    "polyline",
    "rect",
    "svg",
    "symbol",
    "text",
    "textPath",
    "tspan",
    "use",
}

ALLOWED_TAGS = {
    "svg",
    "a",
    "animate",
    "animateMotion",
    "animateTransform",
    "circle",
    "clipPath",
    "defs",
    "desc",
    "ellipse",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "filter",
    "g",
    "image",
    "line",
    "linearGradient",
    "marker",
    "mask",
    "metadata",
    "mpath",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "set",
    "stop",
    "style",
    "symbol",
    "text",
    "textPath",
    "title",
    "tspan",
    "use",
}

FORBIDDEN_TAGS = {
    "script",
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "canvas",
}

ANIMATION_TAGS = {
    "animate",
    "animateTransform",
    "animateMotion",
    "set",
}

SMIL_HREF_ATTR_NAMES = {"href", "xlink:href"}

DANGEROUS_URL_SCHEMES = (
    "javascript:",
    "vbscript:",
    "livescript:",
    "mocha:",
    "data:image/svg+xml",
    "data:text/html",
    "data:application/xhtml+xml",
)

NON_NEGATIVE_LENGTH_ATTRS = {
    "width",
    "height",
    "r",
    "rx",
    "ry",
    "stroke-width",
    "markerWidth",
    "markerHeight",
    "stdDeviation",
}

NUMBER_ATTRS = {
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "fx",
    "fy",
    "fr",
    "dx",
    "dy",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "stop-opacity",
    "flood-opacity",
    "stroke-miterlimit",
    "stroke-dashoffset",
    "offset",
    "refX",
    "refY",
}

REFERENCE_ATTRS = {
    "clip-path",
    "filter",
    "fill",
    "marker-end",
    "marker-mid",
    "marker-start",
    "mask",
    "stroke",
}

HREF_ATTRS = {"href", "xlink:href"}
TRANSFORM_ATTRS = {"transform", "gradientTransform", "patternTransform"}

PATH_ARG_COUNTS = {
    "M": 2,
    "L": 2,
    "H": 1,
    "V": 1,
    "C": 6,
    "S": 4,
    "Q": 4,
    "T": 2,
    "A": 7,
    "Z": 0,
}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def as_dict(self) -> dict[str, list[str]]:
        return {"errors": self.errors, "warnings": self.warnings}


def local_name(name: str) -> str:
    if name.startswith("{") and "}" in name:
        return name.split("}", 1)[1]
    if ":" in name:
        return name.rsplit(":", 1)[1]
    return name


def namespace_uri(name: str) -> str:
    if name.startswith("{") and "}" in name:
        return name[1:].split("}", 1)[0]
    return ""


def attr_name(name: str) -> str:
    if name == f"{{{XLINK_NS}}}href":
        return "xlink:href"
    return local_name(name)


def element_path(elem: ET.Element, counts: dict[str, int]) -> str:
    tag = local_name(elem.tag)
    counts[tag] = counts.get(tag, 0) + 1
    elem_id = elem.attrib.get("id")
    if elem_id:
        return f"<{tag} id='{elem_id}'>"
    return f"<{tag} #{counts[tag]}>"


def strip_svg_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def parse_number_sequence(value: str) -> tuple[list[float], str | None]:
    numbers: list[float] = []
    index = 0
    length = len(value)
    while index < length:
        while index < length and value[index] in " \t\r\n,":
            index += 1
        if index >= length:
            break
        match = NUMBER_RE.match(value, index)
        if not match:
            return numbers, f"invalid number near '{value[index:index + 20]}'"
        raw = match.group(0)
        try:
            number = float(raw)
        except ValueError:
            return numbers, f"invalid number '{raw}'"
        if not math.isfinite(number):
            return numbers, f"non-finite number '{raw}'"
        numbers.append(number)
        index = match.end()
    return numbers, None


def parse_length(value: str) -> tuple[float | None, str | None]:
    if value.strip().startswith("var(") or value.strip().startswith("calc("):
        return None, None
    match = LENGTH_RE.match(value)
    if not match:
        return None, f"invalid length '{value}'"
    number = float(match.group(1))
    if not math.isfinite(number):
        return None, f"non-finite length '{value}'"
    return number, None


def tokenize_path(d: str) -> tuple[list[str], str | None]:
    tokens: list[str] = []
    index = 0
    length = len(d)
    commands = set("MmZzLlHhVvCcSsQqTtAa")
    while index < length:
        char = d[index]
        if char in " \t\r\n,":
            index += 1
            continue
        if char in commands:
            tokens.append(char)
            index += 1
            continue
        match = NUMBER_RE.match(d, index)
        if match:
            tokens.append(match.group(0))
            index = match.end()
            continue
        return tokens, f"invalid path token near '{d[index:index + 30]}'"
    return tokens, None


def is_number_token(token: str) -> bool:
    return bool(NUMBER_RE.fullmatch(token))


def validate_path_data(d: str) -> list[str]:
    issues: list[str] = []
    tokens, token_error = tokenize_path(d)
    if token_error:
        issues.append(token_error)
        return issues
    if not tokens:
        issues.append("path data is empty")
        return issues
    if tokens[0] not in "Mm":
        issues.append("path data must start with M or m")

    index = 0
    current_command: str | None = None
    previous_letter: str | None = None
    seen_move = False

    while index < len(tokens):
        token = tokens[index]
        if token in "MmZzLlHhVvCcSsQqTtAa":
            # Smooth-curve reflection rule: S/s must follow C/c/S/s and
            # T/t must follow Q/q/T/t. Otherwise the inferred control
            # point coincides with the current point and the curve
            # collapses into a degenerate shape.
            if token in "Ss" and previous_letter not in {"C", "c", "S", "s"}:
                issues.append(
                    f"smooth curve {token} must follow C/c/S/s; otherwise the first control point collapses to the current point"
                )
            if token in "Tt" and previous_letter not in {"Q", "q", "T", "t"}:
                issues.append(
                    f"smooth curve {token} must follow Q/q/T/t; otherwise the control point collapses to the current point"
                )
            previous_letter = token
            current_command = token
            index += 1
        elif current_command is None:
            issues.append(f"number '{token}' appears before a command")
            break

        if current_command is None:
            continue

        upper = current_command.upper()
        if upper == "Z":
            current_command = None
            continue

        arg_count = PATH_ARG_COUNTS[upper]
        consumed_for_command = 0

        while index < len(tokens):
            if tokens[index] in "MmZzLlHhVvCcSsQqTtAa":
                break
            if index + arg_count > len(tokens):
                issues.append(f"command {current_command} is missing values")
                return issues
            raw_args = tokens[index:index + arg_count]
            if any(not is_number_token(arg) for arg in raw_args):
                issues.append(f"command {current_command} has a non-numeric argument")
                return issues
            args = [float(arg) for arg in raw_args]
            if any(not math.isfinite(arg) for arg in args):
                issues.append(f"command {current_command} has a non-finite argument")
                return issues
            if upper == "A":
                if args[0] < 0 or args[1] < 0:
                    issues.append(f"arc command {current_command} should use non-negative radii")
                if args[3] not in (0.0, 1.0) or args[4] not in (0.0, 1.0):
                    issues.append(f"arc command {current_command} flags must be 0 or 1")
            if upper == "M":
                seen_move = True
                current_command = "L" if current_command == "M" else "l"
                upper = current_command.upper()
                arg_count = PATH_ARG_COUNTS[upper]
            index += arg_count
            consumed_for_command += 1

        if consumed_for_command == 0:
            issues.append(f"command {token} has no values")
            return issues

    if not seen_move:
        issues.append("path data has no move command")
    return issues


def validate_points(value: str) -> str | None:
    numbers, error = parse_number_sequence(value)
    if error:
        return error
    if len(numbers) < 4:
        return "points must contain at least two coordinate pairs"
    if len(numbers) % 2 != 0:
        return "points must contain an even number of coordinates"
    return None


def validate_transform(value: str) -> str | None:
    text = value.strip()
    if not text:
        return "empty transform"
    index = 0
    function_re = re.compile(r"([A-Za-z]+)\s*\(([^()]*)\)")
    expected_counts = {
        "matrix": {6},
        "translate": {1, 2},
        "scale": {1, 2},
        "rotate": {1, 3},
        "skewX": {1},
        "skewY": {1},
    }
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            break
        match = function_re.match(text, index)
        if not match:
            return f"invalid transform near '{text[index:index + 30]}'"
        name, args_text = match.groups()
        if name not in expected_counts:
            return f"unsupported transform function '{name}'"
        numbers, error = parse_number_sequence(args_text)
        if error:
            return f"invalid transform {name}: {error}"
        if len(numbers) not in expected_counts[name]:
            allowed = ", ".join(str(count) for count in sorted(expected_counts[name]))
            return f"transform {name} expects {allowed} value(s), got {len(numbers)}"
        index = match.end()
    return None


def collect_url_refs(value: str) -> list[str]:
    return [match.group(1) for match in URL_REF_RE.finditer(value)]


def looks_external_url(value: str) -> bool:
    lower = value.strip().lower()
    return lower.startswith(("http:", "https:", "//", "data:", "javascript:", "file:"))


def scan_css_for_danger(value: str) -> list[str]:
    issues: list[str] = []
    if CSS_IMPORT_RE.search(value):
        issues.append("css @import is not allowed")
    lower = value.lower()
    if "javascript:" in lower:
        issues.append("css contains javascript URL")
    if "expression(" in lower:
        issues.append("css contains IE expression() — runs JavaScript")
    if "behavior:" in lower:
        issues.append("css contains IE behavior: binding")
    if "-moz-binding:" in lower:
        issues.append("css contains -moz-binding")
    if "@font-face" in lower and "url(" in lower:
        # Allow @font-face only with data: URLs; otherwise it fetches external fonts.
        for match in ANY_URL_RE.finditer(value):
            target = match.group(1).strip("'\"").lower()
            if not target.startswith("data:") and not target.startswith("#"):
                issues.append(f"css @font-face references external font '{target}'")
                break
    for match in ANY_URL_RE.finditer(value):
        target = match.group(1).strip("'\"")
        if looks_external_url(target):
            issues.append(f"css contains external or unsafe url '{target}'")
    return issues


def read_svg(path: Path, report: Report) -> ET.Element | None:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        report.error("file is not valid UTF-8")
        return None
    except OSError as exc:
        report.error(f"could not read file: {exc}")
        return None

    stripped = strip_svg_comments(text)
    lower = stripped.lower()
    if "<!doctype" in lower:
        report.error("doctype declarations are not allowed in safe SVG output")
    if "<!entity" in lower:
        report.error("entity declarations are not allowed in safe SVG output")
    if "<?xml-stylesheet" in lower:
        report.error("xml-stylesheet processing instructions are not allowed")

    try:
        return ET.fromstring(text)
    except ET.ParseError as exc:
        report.error(f"xml parse error: {exc}")
        return None


def child_tags(root: ET.Element) -> list[str]:
    return [local_name(child.tag) for child in list(root) if isinstance(child.tag, str)]


def validate_svg(path: Path, strict: bool = False) -> Report:
    report = Report()
    root = read_svg(path, report)
    if root is None:
        return report

    if local_name(root.tag) != "svg":
        report.error("root element must be <svg>")
        return report

    if namespace_uri(root.tag) != SVG_NS:
        report.error('root <svg> must declare xmlns="http://www.w3.org/2000/svg"')

    attrs = {attr_name(k): v for k, v in root.attrib.items()}
    if "viewbox" in attrs and "viewBox" not in attrs:
        report.error("viewBox is case-sensitive; found viewbox instead of viewBox")
    viewbox = attrs.get("viewBox")
    if not viewbox:
        report.error("root <svg> must include a viewBox")
    else:
        values, error = parse_number_sequence(viewbox)
        if error:
            report.error(f"invalid viewBox: {error}")
        elif len(values) != 4:
            report.error(f"viewBox must contain four numbers, got {len(values)}")
        elif values[2] <= 0 or values[3] <= 0:
            report.error("viewBox width and height must be positive")

    ids: dict[str, str] = {}
    references: list[tuple[str, str, str]] = []
    aria_refs: list[tuple[str, str]] = []
    visible_elements = 0
    elem_counts: dict[str, int] = {}
    all_elements = list(root.iter())

    if len(all_elements) > 1000:
        report.warn(f"svg contains {len(all_elements)} elements; consider simplifying for performance")

    for elem in all_elements:
        if not isinstance(elem.tag, str):
            continue
        tag = local_name(elem.tag)
        location = element_path(elem, elem_counts)

        if namespace_uri(elem.tag) not in (SVG_NS, ""):
            report.warn(f"{location}: element is outside the SVG namespace")

        if tag in FORBIDDEN_TAGS:
            report.error(f"{location}: <{tag}> is not allowed in safe SVG output")
        elif tag not in ALLOWED_TAGS:
            report.warn(f"{location}: uncommon SVG element <{tag}>; verify target support")

        # CSS independence: <style> renders only in CSS-aware viewers.
        if tag == "style":
            report.warn(
                f"{location}: <style> element is CSS-dependent; many non-browser renderers ignore it. Prefer presentation attributes."
            )

        if tag in GRAPHIC_TAGS and tag not in {"svg", "g", "a", "symbol"}:
            visible_elements += 1

        normalized_attrs = {attr_name(k): v for k, v in elem.attrib.items()}

        elem_id = normalized_attrs.get("id")
        if elem_id:
            if elem_id in ids:
                report.error(f"duplicate id '{elem_id}' used by {ids[elem_id]} and {location}")
            else:
                ids[elem_id] = location
            if not ID_RE.match(elem_id):
                report.warn(f"{location}: id '{elem_id}' may be hard to reference safely")

        for raw_name, raw_value in elem.attrib.items():
            name = attr_name(raw_name)
            value = str(raw_value)
            lower_value = value.strip().lower()

            if name.lower().startswith("on") and len(name) > 2:
                report.error(f"{location}: event handler attribute '{name}' is not allowed")

            if "javascript:" in lower_value:
                report.error(f"{location}: javascript URL is not allowed in attribute '{name}'")

            if name in HREF_ATTRS:
                if value.startswith("#"):
                    references.append((location, name, value[1:]))
                elif looks_external_url(value) or value.strip():
                    report.error(f"{location}: external href '{value}' is not allowed")

            if name in REFERENCE_ATTRS:
                for ref in collect_url_refs(value):
                    references.append((location, name, ref))
                for match in ANY_URL_RE.finditer(value):
                    target = match.group(1).strip("'\"")
                    if looks_external_url(target):
                        report.error(f"{location}: external url '{target}' is not allowed in '{name}'")

            if name == "style":
                for issue in scan_css_for_danger(value):
                    report.error(f"{location}: {issue}")
                # CSS independence: style="..." is CSS, not SVG presentation.
                report.warn(
                    f"{location}: style=\"...\" attribute is CSS-dependent; prefer presentation attributes (fill, stroke, etc.)"
                )

            # CSS independence: class is a CSS hook with no effect outside a CSS engine.
            if name == "class":
                report.warn(
                    f"{location}: class=\"...\" attribute is a CSS hook; useless in renderers without a CSS engine"
                )

            # CSS independence: currentColor and var() resolve only in CSS contexts.
            if "currentcolor" in lower_value:
                report.warn(
                    f"{location}: '{name}' uses currentColor, which depends on CSS color cascade and falls back to black in non-CSS renderers"
                )
            if value.strip().lower().startswith("var(") or " var(" in lower_value:
                report.warn(
                    f"{location}: '{name}' uses CSS var(); not portable to non-CSS renderers"
                )

            if name in {"aria-labelledby", "aria-describedby"}:
                for ref_id in value.split():
                    aria_refs.append((location, ref_id))

            if name in TRANSFORM_ATTRS:
                issue = validate_transform(value)
                if issue:
                    report.error(f"{location}: invalid {name}: {issue}")

            if name in NUMBER_ATTRS or name in NON_NEGATIVE_LENGTH_ATTRS:
                if value.strip().startswith(("var(", "calc(")):
                    continue
                number, error = parse_length(value)
                if error:
                    report.warn(f"{location}: {name} has {error}")
                elif name in NON_NEGATIVE_LENGTH_ATTRS and number is not None and number < 0:
                    report.error(f"{location}: {name} must be non-negative")

        if tag == "style" and elem.text:
            for issue in scan_css_for_danger(elem.text):
                report.error(f"{location}: {issue}")
            # CSS independence: detect CSS animations.
            text_lower = elem.text.lower()
            if "@keyframes" in text_lower or " animation:" in text_lower or "animation-name" in text_lower:
                report.warn(
                    f"{location}: <style> contains CSS animations; use SMIL (<animate>, <animateTransform>, <animateMotion>) instead for renderer-independent animation"
                )

        if tag in ANIMATION_TAGS:
            target_attr = normalized_attrs.get("attributeName", "")
            if target_attr in SMIL_HREF_ATTR_NAMES:
                # Animation that mutates href is a known XSS vector — values
                # like "javascript:alert(1)" run on activation. Verify every
                # supplied target value.
                animation_values: list[str] = []
                for src in ("to", "from", "by"):
                    if src in normalized_attrs:
                        animation_values.append(normalized_attrs[src])
                if "values" in normalized_attrs:
                    animation_values.extend(
                        v.strip() for v in normalized_attrs["values"].split(";")
                    )
                for candidate in animation_values:
                    lower = candidate.strip().lower()
                    if any(lower.startswith(scheme) for scheme in DANGEROUS_URL_SCHEMES):
                        report.error(
                            f"{location}: SMIL animation targets {target_attr} with dangerous URL '{candidate}'"
                        )

        if tag == "path":
            d = normalized_attrs.get("d")
            if d is None or not d.strip():
                report.error(f"{location}: path must include non-empty d attribute")
            else:
                for issue in validate_path_data(d):
                    report.error(f"{location}: {issue}")

        if tag in {"polygon", "polyline"}:
            points = normalized_attrs.get("points")
            if points is None or not points.strip():
                report.error(f"{location}: {tag} must include non-empty points attribute")
            else:
                issue = validate_points(points)
                if issue:
                    report.error(f"{location}: invalid points: {issue}")

        if tag == "rect":
            for dim in ("width", "height"):
                value = normalized_attrs.get(dim)
                if value is not None:
                    number, error = parse_length(value)
                    if error:
                        report.warn(f"{location}: {dim} has {error}")
                    elif number is not None and number < 0:
                        report.error(f"{location}: rect {dim} must be non-negative")

        if tag == "circle":
            value = normalized_attrs.get("r")
            if value is not None:
                number, error = parse_length(value)
                if error:
                    report.warn(f"{location}: r has {error}")
                elif number is not None and number < 0:
                    report.error(f"{location}: circle radius must be non-negative")

        if tag == "ellipse":
            for radius in ("rx", "ry"):
                value = normalized_attrs.get(radius)
                if value is not None:
                    number, error = parse_length(value)
                    if error:
                        report.warn(f"{location}: {radius} has {error}")
                    elif number is not None and number < 0:
                        report.error(f"{location}: ellipse {radius} must be non-negative")

    for location, name, ref_id in references:
        if ref_id not in ids:
            report.error(f"{location}: {name} references missing id '#{ref_id}'")

    for location, ref_id in aria_refs:
        if ref_id not in ids:
            report.error(f"{location}: aria reference '{ref_id}' does not match any id")

    root_attrs = {attr_name(k): v for k, v in root.attrib.items()}
    aria_hidden = root_attrs.get("aria-hidden", "").strip().lower() == "true"
    role = root_attrs.get("role", "").strip().lower()
    tags = child_tags(root)
    has_title = "title" in tags
    has_desc = "desc" in tags

    if aria_hidden:
        if root_attrs.get("focusable") != "false":
            report.warn("decorative SVGs should set focusable='false'")
        if role == "img":
            report.warn("SVG is aria-hidden but also has role='img'; choose one accessibility mode")
    else:
        if role != "img":
            report.warn("meaningful SVGs should set role='img', or set aria-hidden='true' if decorative")
        if not has_title:
            report.warn("meaningful SVGs should include a <title> child")
        if role == "img" and not root_attrs.get("aria-labelledby"):
            report.warn("role='img' SVGs should use aria-labelledby with title and desc IDs")
        if has_title and tags and tags[0] != "title":
            report.warn("place <title> before drawing elements for compatibility")
        if has_desc:
            title_index = tags.index("title") if "title" in tags else -1
            desc_index = tags.index("desc")
            if title_index != -1 and desc_index < title_index:
                report.warn("place <desc> after <title>")
        elif role == "img":
            report.warn("consider adding <desc> for non-obvious icons, diagrams, charts, and illustrations")

    if visible_elements == 0:
        report.warn("no visible graphic elements found")

    if strict and report.warnings:
        report.errors.extend(f"strict warning: {warning}" for warning in report.warnings)
        report.warnings = []

    return report


def print_report(path: Path, report: Report, as_json: bool) -> None:
    if as_json:
        payload = {"file": str(path), **report.as_dict(), "ok": not report.errors}
        print(json.dumps(payload, indent=2))
        return

    if not report.errors and not report.warnings:
        print(f"PASS: {path}")
        return

    if report.errors:
        print(f"ERRORS in {path}:")
        for issue in report.errors:
            print(f"  - {issue}")
    if report.warnings:
        print(f"WARNINGS in {path}:")
        for issue in report.warnings:
            print(f"  - {issue}")
    if not report.errors:
        print(f"PASS with warnings: {path}")


def iter_svg_files(paths: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(sorted(path.rglob("*.svg")))
        else:
            files.append(path)
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate SVG files for common correctness, safety, and accessibility issues.")
    parser.add_argument("paths", nargs="+", help="SVG files or directories containing SVG files")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args(argv)

    input_paths = [Path(raw) for raw in args.paths]
    files = iter_svg_files(input_paths)
    if not files:
        print("No SVG files found.", file=sys.stderr)
        return 2

    exit_code = 0
    combined: list[dict[str, object]] = []
    for file_path in files:
        if not file_path.exists():
            report = Report(errors=[f"file not found: {file_path}"])
        else:
            report = validate_svg(file_path, strict=args.strict)
        if report.errors:
            exit_code = 1
        if args.json:
            combined.append({"file": str(file_path), **report.as_dict(), "ok": not report.errors})
        else:
            print_report(file_path, report, as_json=False)

    if args.json:
        print(json.dumps({"ok": exit_code == 0, "results": combined}, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
