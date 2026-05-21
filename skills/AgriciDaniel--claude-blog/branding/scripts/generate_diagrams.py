#!/usr/bin/env python3
"""
claude-blog brand-kit generator.

Same brand system as claude-ads + claude-seo v2.x: OS-window-framed dark CRT
terminal with BRAND-ORANGE accent palette. Applies all layout fixes proven in
the sibling repos:
  · 01-B clean L-routed connectors (no overlap at scoring node)
  · 02-A linear pipeline (5-gate Blog Delivery Contract)
  · 03-B HUB + 8 category clusters (auto-sized panels for variable item counts)
  · 04-B FLOW radial wheel (4 phases · 10 representative prompts)
  · 05-A horizontal timeline with v1.9.0 as the focal/current milestone
  · OS title bar with traffic lights (dark, matching canvas family)

Emits 15 variants (5 diagrams × 3 each) into assets/diagrams/.
The 5 locked picks referenced by branding/final.html are:
  · 01-architecture-B.svg
  · 02-pipeline-A.svg
  · 03-sub-skill-map-B.svg
  · 04-framework-B.svg
  · 05-roadmap-A.svg

Usage:
    python3 generate_diagrams.py
"""

import math
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parent.parent.parent
ASSETS = ROOT / "assets"
DIAG_DIR = ASSETS / "diagrams"
ASSETS.mkdir(parents=True, exist_ok=True)
DIAG_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# BRAND-ORANGE PALETTE — unified across claude-ads + claude-seo + claude-blog
# ============================================================================
ACCENT          = "#D97757"
ACCENT_BRIGHT   = "#F5B095"
ACCENT_MID      = "#E89270"
ACCENT_DEEP     = "#7A3A1F"
ACCENT_DARKER   = "#5C2A14"
ACCENT_LIGHT    = "#F0A283"
ACCENT_FAINT    = "#6F3922"
CANVAS          = "#1F1B16"

# ============================================================================
# SHARED STYLE
# ============================================================================
STYLE = dedent(f"""
<defs>
  <style type="text/css"><![CDATA[
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
    .bg            {{ fill: {CANVAS}; }}
    .bg-soft       {{ fill: {CANVAS}; }}
    .box           {{ fill: #26221C; stroke: #4A3D32; stroke-width: 1; }}
    .box-focal     {{ fill: #2D2218; stroke: {ACCENT}; stroke-width: 1.4; }}
    .box-future    {{ fill: #221E18; stroke: #3A312A; stroke-width: 1; stroke-dasharray: 4 3; }}
    .box-soft      {{ fill: #232019; stroke: #3A312A; stroke-width: 1; }}
    .label-h       {{ font-family: 'JetBrains Mono', monospace; fill: #F5F4ED; font-size: 16px; font-weight: 700; letter-spacing: 0.3px; }}
    .label         {{ font-family: 'JetBrains Mono', monospace; fill: #F5F4ED; font-size: 14px; font-weight: 600; }}
    .label-sub     {{ font-family: 'JetBrains Mono', monospace; fill: #9C8B7E; font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; }}
    .label-tiny    {{ font-family: 'JetBrains Mono', monospace; fill: #6F5F54; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }}
    .label-radial  {{ font-family: 'JetBrains Mono', monospace; fill: #E0D2C4; font-size: 13px; font-weight: 600; letter-spacing: 0.6px; }}
    .label-accent  {{ font-family: 'JetBrains Mono', monospace; fill: {ACCENT}; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }}
    .conn          {{ stroke: #6F5F54; stroke-width: 1; fill: none; }}
    .conn-soft     {{ stroke: #4A3D32; stroke-width: 1; fill: none; }}
    .conn-dashed   {{ stroke: #4A3D32; stroke-width: 1; fill: none; stroke-dasharray: 4 3; }}
    .accent-fill   {{ fill: {ACCENT}; }}
    .accent-bright {{ fill: {ACCENT_BRIGHT}; }}
    .corner-mark   {{ font-family: 'JetBrains Mono', monospace; fill: #5A5750; font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; }}
  ]]></style>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#6F5F54"/>
  </marker>
</defs>
""").strip()


# ---- OS window chrome (DARK title bar) ----
TITLE_H = 48
WIN_RADIUS = 10
WIN_BORDER = "#3A312A"
WIN_BAR_BG = "#2A2520"
WIN_BAR_FG = "#E0D2C4"
TL_YELLOW = "#fbbf24"
TL_GREEN  = "#10b981"
TL_RED    = "#ef4444"
TL_RADIUS = 9
TL_SPACING = 28


def window_chrome(w, title):
    cy = TITLE_H / 2
    tl_x_close = w - 28
    tl_x_max   = tl_x_close - TL_SPACING
    tl_x_min   = tl_x_max - TL_SPACING
    return f'''
  <path d="M 0 {WIN_RADIUS} Q 0 0 {WIN_RADIUS} 0 L {w-WIN_RADIUS} 0 Q {w} 0 {w} {WIN_RADIUS} L {w} {TITLE_H} L 0 {TITLE_H} Z" fill="{WIN_BAR_BG}"/>
  <line x1="0" y1="{TITLE_H}" x2="{w}" y2="{TITLE_H}" stroke="{WIN_BORDER}" stroke-width="1"/>
  <text x="20" y="{cy + 5}" font-family="JetBrains Mono, monospace" font-size="15" fill="{WIN_BAR_FG}" font-weight="600">{title}</text>
  <circle cx="{tl_x_min}"   cy="{cy}" r="{TL_RADIUS}" fill="{TL_YELLOW}" stroke="{WIN_BORDER}" stroke-width="0.7"/>
  <circle cx="{tl_x_max}"   cy="{cy}" r="{TL_RADIUS}" fill="{TL_GREEN}"  stroke="{WIN_BORDER}" stroke-width="0.7"/>
  <circle cx="{tl_x_close}" cy="{cy}" r="{TL_RADIUS}" fill="{TL_RED}"    stroke="{WIN_BORDER}" stroke-width="0.7"/>
'''


def svg(viewbox_w, viewbox_h, body, corner="claude-blog · v1.9.0", win_title=None):
    if win_title is None:
        win_title = f"claude-blog.app — {corner}"
    total_h = viewbox_h + TITLE_H
    chrome = window_chrome(viewbox_w, win_title)
    inner_corner = f'<text x="{viewbox_w-20}" y="{viewbox_h-12}" class="corner-mark" text-anchor="end">{corner}</text>'
    return dedent(f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {viewbox_w} {total_h}"
     preserveAspectRatio="xMidYMid meet" width="100%" font-family="JetBrains Mono, monospace">
{STYLE}
<rect x="0.5" y="0.5" width="{viewbox_w-1}" height="{total_h-1}" rx="{WIN_RADIUS}" fill="{WIN_BAR_BG}" stroke="{WIN_BORDER}" stroke-width="1"/>
{chrome}
<g transform="translate(0, {TITLE_H})">
  <rect class="bg" width="{viewbox_w}" height="{viewbox_h}"/>
  {body}
  {inner_corner}
</g>
</svg>
""")


# ---- helpers ----
def box(x, y, w, h, klass="box", rx=4, animate=False):
    anim = '<animate attributeName="opacity" values="0.85;1;0.85" dur="4.2s" repeatCount="indefinite"/>' if animate else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{klass}">{anim}</rect>'


def text(x, y, content, klass="label", anchor="middle"):
    return f'<text x="{x}" y="{y}" class="{klass}" text-anchor="{anchor}">{content}</text>'


def label_box(cx, cy, w, h, lines, klass="box", focal=False):
    if focal:
        klass = "box-focal"
    x = cx - w / 2
    y = cy - h / 2
    line_h = 20
    total_h = (len(lines) - 1) * line_h
    start_y = cy - total_h / 2 + 5
    out = [box(x, y, w, h, klass, animate=focal)]
    for i, ln in enumerate(lines):
        cls = "label-accent" if (i == 0 and len(lines) > 1) else "label"
        out.append(text(cx, start_y + i * line_h, ln, cls))
    return "\n".join(out)


def conn(x1, y1, x2, y2, klass="conn", arrow="arrow"):
    return f'<path d="M {x1} {y1} L {x2} {y2}" class="{klass}" marker-end="url(#{arrow})"/>'


def line_only(x1, y1, x2, y2, klass="conn-soft"):
    return f'<path d="M {x1} {y1} L {x2} {y2}" class="{klass}"/>'


# ============================================================================
# CLAUDE-BLOG CONTENT
# ============================================================================
# 29 sub-skills grouped into 8 categories. (The orchestrator at skills/blog/
# is the hub — total surface = 30 skills as advertised in plugin.json.)
SUB_SKILLS = {
    "writing":      ["blog-write", "blog-rewrite", "blog-outline", "blog-brief"],
    "strategy":     ["blog-strategy", "blog-calendar", "blog-cluster", "blog-persona", "blog-brand"],
    "quality":      ["blog-seo-check", "blog-analyze", "blog-audit", "blog-cannibalization", "blog-factcheck"],
    "ai · search":  ["blog-geo", "blog-schema", "blog-flow"],
    "multilingual": ["blog-multilingual", "blog-translate", "blog-localize", "blog-locale-audit"],
    "research":     ["blog-discourse", "blog-notebooklm", "blog-google"],
    "media":        ["blog-image", "blog-audio", "blog-chart"],
    "distribution": ["blog-repurpose", "blog-taxonomy"],
}

# FLOW framework — 4 phases, 30 evidence-led prompts.
# Outer ring shows 10 representative prompt names to keep the wheel legible.
FRAMEWORK = [
    ("find",     "discover topics",  ["topic-discovery", "intent-mapping", "gap-analysis"]),
    ("leverage", "amplify assets",   ["asset-audit", "repurpose-map"]),
    ("optimize", "improve content",  ["serp-realignment", "freshness-pass", "internal-loop"]),
    ("win",      "convert readers",  ["bofu-cta", "dual-surface-score"]),
]

WAVES = [
    ("v1.6.0", "mar 2026", "foundation",              "30 sub-skills · 5 agents\nrouting + scoring",     False),
    ("v1.7.0", "apr 2026", "FLOW framework",          "find · leverage · optimize · win\n30 prompts",     False),
    ("v1.8.0", "may 2026", "impeccable methodology",  "discourse · synthesis\nresearch quality rubric",  False),
    ("v1.9.0", "may 2026", "delivery contract",       "5-gate pre-publish gate\nbrand + voice context",  True),
    ("v2.0.0", "q3 2026",  "multi-CMS publishing",    "wordpress · ghost · webflow\nstrapi · sanity",    False),
    ("v3.0.0", "q1 2027",  "blog-as-code",            "CI integration\nrolling SERP baselines",          False),
]


# ============================================================================
# DIAGRAM 01 — SYSTEM ARCHITECTURE (3 variants)
# ============================================================================
def diag_01_a():
    """A: Top-down hierarchical flow."""
    body = []
    W, H = 1200, 950
    cx = W / 2
    body.append(label_box(cx, 100, 360, 80, ["entry", "/blog write"], focal=True))
    body.append(label_box(cx, 240, 360, 80, ["orchestrator", "blog/SKILL.md"]))
    body.append(label_box(280,  430, 280, 130, ["sub-skills", "30 modules", "8 categories"]))
    body.append(label_box(cx,   430, 280, 130, ["agents", "5 specialists", "research · write", "quality · localize"]))
    body.append(label_box(920,  430, 280, 130, ["context", "BRAND.md · VOICE.md", "persona · cluster"]))
    body.append(label_box(cx, 660, 480, 100, ["delivery contract", "5-gate pre-publish gate"]))
    body.append(label_box(cx, 830, 480, 100, ["post + assets", "md · schema · hreflang · audio"]))

    body.append(conn(cx, 140, cx, 200))
    body.append(line_only(cx, 280, cx, 350))
    body.append(line_only(280, 350, 920, 350))
    body.append(conn(280, 350, 280, 365))
    body.append(conn(cx,  350, cx,  365))
    body.append(conn(920, 350, 920, 365))
    body.append(line_only(280, 495, 280, 590))
    body.append(line_only(cx,  495, cx,  590))
    body.append(line_only(920, 495, 920, 590))
    body.append(line_only(280, 590, 920, 590))
    body.append(conn(cx, 590, cx, 610))
    body.append(conn(cx, 710, cx, 780))
    return svg(W, H, "\n".join(body), corner="01 · system architecture · A")


def diag_01_b():
    """B: Left-to-right horizontal (clean L-routed connectors, no overlap)."""
    body = []
    W, H = 1600, 700
    cy = H / 2
    x_entry  = 150;  x_orch  = 430;  x_branch = 800
    x_join   = 1080; x_score = 1200; x_report = 1430

    body.append(label_box(x_entry,  cy,  220, 100, ["entry", "/blog write"], focal=True))
    body.append(label_box(x_orch,   cy,  220, 100, ["orchestrator", "blog/SKILL.md"]))
    body.append(label_box(x_branch, 200, 240, 90,  ["sub-skills", "30 modules"]))
    body.append(label_box(x_branch, cy,  240, 90,  ["agents", "5 specialists"]))
    body.append(label_box(x_branch, 500, 240, 90,  ["context", "BRAND · VOICE"]))
    body.append(label_box(x_score,  cy,  220, 100, ["5-gate contract", "pre-publish gate"]))
    body.append(label_box(x_report, cy,  220, 100, ["post", "md · schema · assets"]))

    body.append(conn(x_entry + 110, cy, x_orch - 110, cy))
    body.append(line_only(x_orch + 110, cy, x_orch + 165, cy))
    body.append(line_only(x_orch + 165, 200, x_orch + 165, 500))
    body.append(conn(x_orch + 165, 200, x_branch - 120, 200))
    body.append(conn(x_orch + 165, cy,  x_branch - 120, cy))
    body.append(conn(x_orch + 165, 500, x_branch - 120, 500))
    body.append(line_only(x_branch + 120, 200, x_join - 60, 200))
    body.append(line_only(x_branch + 120, cy,  x_join - 60, cy))
    body.append(line_only(x_branch + 120, 500, x_join - 60, 500))
    body.append(line_only(x_join - 60, 200, x_join - 60, 500))
    body.append(conn(x_join - 60, cy, x_score - 110, cy))
    body.append(conn(x_score + 110, cy, x_report - 110, cy))
    return svg(W, H, "\n".join(body), corner="01 · system architecture · B")


def diag_01_c():
    """C: Radial hub-and-spoke."""
    body = []
    W, H = 1200, 1000
    cx, cy = W / 2, H / 2
    body.append(label_box(cx, cy, 280, 100, ["orchestrator", "blog/SKILL.md"], focal=True))
    angles = [-90, -30, 30, 90, 150, 210]
    labels = [
        (["post + assets", "md · schema"], False),
        (["sub-skills", "30 modules"], False),
        (["agents", "5 specialists"], False),
        (["5-gate contract", "pre-publish"], False),
        (["context", "BRAND · VOICE"], False),
        (["entry", "/blog write"], True),
    ]
    R = 340
    for ang_deg, (lns, focal) in zip(angles, labels):
        ang = math.radians(ang_deg)
        nx = cx + R * math.cos(ang)
        ny = cy + R * math.sin(ang)
        body.append(f'<path d="M {cx + 140*math.cos(ang)} {cy + 50*math.sin(ang)} L {nx - 120*math.cos(ang)} {ny - 40*math.sin(ang)}" class="conn-soft"/>')
        body.append(label_box(nx, ny, 240, 80, lns, focal=focal))
    return svg(W, H, "\n".join(body), corner="01 · system architecture · C")


# ============================================================================
# DIAGRAM 02 — DELIVERY PIPELINE (3 variants, 5-gate Blog Delivery Contract)
# ============================================================================
def diag_02_a():
    """A: Linear horizontal flow — 5-gate Blog Delivery Contract."""
    body = []
    W, H = 1600, 480
    cy = H / 2
    stages = [
        ("brief", "topic · persona\n· intent", True),
        ("research", "discourse · facts\n· competitors", False),
        ("outline", "SERP-informed\nhub-and-spoke", False),
        ("draft", "BRAND.md +\nVOICE.md", False),
        ("delivery", "5 gates · GEO\n· schema · publish", False),
    ]
    box_w = 220; box_h = 130
    gap = (W - 5 * box_w) / 6
    for i, (eyebrow, body_text, focal) in enumerate(stages):
        x = gap + i * (box_w + gap) + box_w / 2
        lines = [eyebrow] + body_text.split("\n")
        body.append(label_box(x, cy, box_w, box_h, lines, focal=focal))
        if i < len(stages) - 1:
            x_next = gap + (i + 1) * (box_w + gap) + box_w / 2
            body.append(conn(x + box_w / 2 + 4, cy, x_next - box_w / 2 - 4, cy))
    return svg(W, H, "\n".join(body), corner="02 · delivery pipeline · A")


def diag_02_b():
    """B: Swimlane parallel tracks."""
    body = []
    W, H = 1600, 720
    body.append(label_box(150, 100, 220, 80, ["input", "/blog write"], focal=True))
    lanes = [
        ("write lane",     220, ["brief", "outline", "draft", "rewrite", "factcheck"]),
        ("optimize lane",  400, ["seo-check", "geo", "schema", "internal"]),
        ("distribute",     560, ["multilingual", "repurpose", "audio", "image"]),
    ]
    for label, y, items in lanes:
        body.append(text(80, y + 30, label, "label-sub", anchor="start"))
        for i, it in enumerate(items):
            x = 320 + i * 160
            body.append(label_box(x + 70, y + 25, 140, 50, [it]))
    body.append(label_box(W - 180, H / 2, 280, 100, ["delivery", "5-gate contract"]))
    body.append(line_only(280, 100, 280, H / 2))
    body.append(conn(280, H / 2, W - 320, H / 2))
    return svg(W, H, "\n".join(body), corner="02 · delivery pipeline · B")


def diag_02_c():
    """C: Vertical compact — 5-gate Blog Delivery Contract as numbered checklist."""
    body = []
    W, H = 900, 1100
    cx = W / 2
    stages = [
        ("brief locked",        "topic · persona · search-intent",   True),
        ("research evidenced",  "discourse · stats · competitors",   False),
        ("outline approved",    "SERP + cluster fit",                False),
        ("draft on-brand",      "BRAND.md + VOICE.md applied",       False),
        ("AI slop checked",     "two-tier detection · rubric ≥3",    False),
        ("delivery ready",      "schema · GEO · hreflang · audio",   False),
    ]
    for i, (label, annot, focal) in enumerate(stages):
        y = 100 + i * 160
        body.append(label_box(cx, y, 480, 90, [label]))
        body.append(text(cx + 280, y - 5, annot, "label-tiny", anchor="start"))
        body.append(text(cx + 280, y + 15, f"gate {i+1:02d}", "label-accent", anchor="start"))
        if i < len(stages) - 1:
            body.append(conn(cx, y + 45, cx, y + 115))
    return svg(W, H, "\n".join(body), corner="02 · delivery pipeline · C")


# ============================================================================
# DIAGRAM 03 — SUB-SKILL ECOSYSTEM (3 variants, 30 sub-skills, 8 categories)
# ============================================================================
def _panel_height(items, base=220, per_item=44):
    """Auto-size a cluster panel so 2/3/4/5 item categories all look balanced."""
    needed = 70 + len(items) * per_item + 6
    return max(base, needed)


def diag_03_a():
    """A: 4-column grid grouped by domain."""
    body = []
    W, H = 1600, 1200
    body.append(text(W/2, 80, "30 sub-skills · 8 categories", "label-sub"))
    cats = list(SUB_SKILLS.items())
    cols = 4
    col_w = (W - 100) / cols
    row_y = [130, 130 + 480]
    for idx, (title, items) in enumerate(cats):
        col = idx % cols
        row = idx // cols
        gx = 50 + col * col_w
        gy = row_y[row]
        body.append(text(gx + 20, gy + 28, title.upper(), "label-accent", anchor="start"))
        body.append(text(gx + col_w - 30, gy + 28, f"{len(items):02d}", "label-tiny", anchor="end"))
        body.append(box(gx + 10, gy + 45, col_w - 30, len(items) * 52 + 14, "box-soft", rx=6))
        for j, item in enumerate(items):
            yy = gy + 60 + j * 52
            body.append(label_box(gx + col_w/2 - 5, yy + 22, col_w - 70, 42, [item]))
    return svg(W, H, "\n".join(body), corner="03 · sub-skill ecosystem · A")


def diag_03_b():
    """B: Hub + 8 category clusters (auto-sized panels, no overlap)."""
    body = []
    W, H = 1600, 1200
    cx, cy = W / 2, H / 2

    panel_w = 360
    top_y = 160
    btm_y = H - 160

    # Auto-size per panel based on item count
    clusters_data = [
        # (title, items, cx, cy, w, h, side)
        ("writing",      SUB_SKILLS["writing"],      80 + panel_w/2,                  top_y, panel_w, _panel_height(SUB_SKILLS["writing"]),      "top"),
        ("strategy",     SUB_SKILLS["strategy"],     80 + panel_w + 30 + panel_w/2,   top_y, panel_w, _panel_height(SUB_SKILLS["strategy"]),     "top"),
        ("research",     SUB_SKILLS["research"],     W - 80 - panel_w - 30 - panel_w/2, top_y, panel_w, _panel_height(SUB_SKILLS["research"]),  "top"),
        ("media",        SUB_SKILLS["media"],        W - 80 - panel_w/2,              top_y, panel_w, _panel_height(SUB_SKILLS["media"]),        "top"),

        ("quality",      SUB_SKILLS["quality"],      80 + panel_w/2,                  btm_y, panel_w, _panel_height(SUB_SKILLS["quality"]),      "bottom"),
        ("ai · search",  SUB_SKILLS["ai · search"],  80 + panel_w + 30 + panel_w/2,   btm_y, panel_w, _panel_height(SUB_SKILLS["ai · search"]),  "bottom"),
        ("multilingual", SUB_SKILLS["multilingual"], W - 80 - panel_w - 30 - panel_w/2, btm_y, panel_w, _panel_height(SUB_SKILLS["multilingual"]), "bottom"),
        ("distribution", SUB_SKILLS["distribution"], W - 80 - panel_w/2,              btm_y, panel_w, _panel_height(SUB_SKILLS["distribution"]), "bottom"),
    ]

    # Connectors FIRST (underneath everything)
    for title, items, gcx, gcy, gw, gh, side in clusters_data:
        if side == "top":
            body.append(line_only(gcx, gcy + gh/2, gcx, cy - 55))
        else:
            body.append(line_only(gcx, gcy - gh/2, gcx, cy + 55))

    # Horizontal rail lines at orchestrator level
    body.append(line_only(80 + panel_w/2,             cy - 55, W - 80 - panel_w/2, cy - 55))
    body.append(line_only(80 + panel_w/2,             cy + 55, W - 80 - panel_w/2, cy + 55))

    # Cluster panels
    for title, items, gcx, gcy, gw, gh, side in clusters_data:
        gx = gcx - gw/2
        gy = gcy - gh/2
        body.append(box(gx, gy, gw, gh, "box-soft", rx=8))
        body.append(text(gx + 18, gy + 26, title.upper(), "label-accent", anchor="start"))
        body.append(text(gx + gw - 18, gy + 26, f"{len(items):02d}", "label-tiny", anchor="end"))

        item_w = gw - 40
        item_h = 38
        for i, item in enumerate(items):
            iy = gy + 50 + i * (item_h + 6)
            body.append(label_box(gx + gw/2, iy + item_h/2, item_w, item_h, [item]))

    # Orchestrator drawn LAST (on top)
    body.append(label_box(cx, cy, 320, 110, ["orchestrator", "blog/SKILL.md"], focal=True))
    return svg(W, H, "\n".join(body), corner="03 · sub-skill ecosystem · B")


def diag_03_c():
    """C: Cluster cards — 8 grouped panels in clean 4×2 grid."""
    body = []
    W, H = 1600, 1300
    body.append(text(W/2, 60, "30 sub-skills · 8 domain clusters", "label-sub"))
    groups = list(SUB_SKILLS.items())
    cols = 4
    col_w = (W - 100) / cols
    row_h_top = 290
    row_h_btm = 400
    for idx, (title, items) in enumerate(groups):
        col = idx % cols
        row = idx // cols
        gx = 50 + col * col_w + 10
        gy = 110 + row * (row_h_top + 30)
        gw = col_w - 20
        gh = row_h_btm if len(items) >= 5 else row_h_top
        body.append(box(gx, gy, gw, gh, "box-soft", rx=8))
        body.append(text(gx + 18, gy + 28, title.upper(), "label-accent", anchor="start"))
        body.append(text(gx + gw - 18, gy + 28, f"{len(items):02d}", "label-tiny", anchor="end"))
        item_w = gw - 40
        item_h = 42
        for i, item in enumerate(items):
            iy = gy + 50 + i * (item_h + 8)
            body.append(label_box(gx + gw/2, iy + item_h/2, item_w, item_h, [item]))
    return svg(W, H, "\n".join(body), corner="03 · sub-skill ecosystem · C")


# ============================================================================
# DIAGRAM 04 — FLOW FRAMEWORK (3 variants, 4 phases · 10 representative prompts)
# ============================================================================
def diag_04_a():
    """A: Horizontal flow — 4 phase columns, prompts stacked below each."""
    body = []
    W, H = 1700, 720
    body.append(text(W/2, 60, "FLOW framework · 4 phases · 30 evidence-led prompts", "label-sub"))
    stage_w = (W - 200) / 4
    cy = 200
    for i, (stage, subtitle, prompts) in enumerate(FRAMEWORK):
        cx = 100 + stage_w * i + stage_w / 2
        focal = (i == 0)
        body.append(label_box(cx, cy, stage_w - 60, 110, [f"phase {i+1:02d}", stage, subtitle], focal=focal))
        if i < 3:
            nx = 100 + stage_w * (i + 1) + stage_w / 2
            body.append(conn(cx + (stage_w - 60)/2 + 4, cy, nx - (stage_w - 60)/2 - 4, cy))
        for j, p in enumerate(prompts):
            py = cy + 130 + j * 70
            body.append(label_box(cx, py, stage_w - 90, 56, [p]))
    return svg(W, H, "\n".join(body), corner="04 · FLOW framework · A")


def diag_04_b():
    """B: Radial wheel — central hub, 4 stage satellites, 10 representative prompts on outer ring.
    PROPER SPACING + EXPLICIT LINKING: each prompt has a clean connector to its
    parent stage card, lines never cross the central card or other stage cards."""
    body = []
    W, H = 1500, 1500
    cx, cy = W / 2, H / 2

    HUB_W, HUB_H = 360, 110
    STAGE_W, STAGE_H = 220, 80
    PRINCIPLE_W, PRINCIPLE_H = 230, 52
    R_STAGE = 340
    R_PRINCIPLE = 580

    body.append(f'<circle cx="{cx}" cy="{cy}" r="{R_PRINCIPLE}" fill="none" stroke="{ACCENT_FAINT}" stroke-width="1" stroke-dasharray="3 3" opacity="0.25"/>')
    body.append(f'<circle cx="{cx}" cy="{cy}" r="{R_STAGE}" fill="none" stroke="{ACCENT_FAINT}" stroke-width="1" stroke-dasharray="3 3" opacity="0.30"/>')

    for ang_deg in [-135, -45, 45, 135]:
        a = math.radians(ang_deg)
        x1 = cx + (R_STAGE - 40) * math.cos(a)
        y1 = cy + (R_STAGE - 40) * math.sin(a)
        x2 = cx + (R_PRINCIPLE + 50) * math.cos(a)
        y2 = cy + (R_PRINCIPLE + 50) * math.sin(a)
        body.append(f'<path d="M {x1} {y1} L {x2} {y2}" class="conn-dashed" opacity="0.25"/>')

    quadrant_angles = [-90, 0, 90, 180]   # find top, leverage right, optimize bottom, win left

    stage_centres = []
    for ang_deg in quadrant_angles:
        ang = math.radians(ang_deg)
        sx = cx + R_STAGE * math.cos(ang)
        sy = cy + R_STAGE * math.sin(ang)
        stage_centres.append((sx, sy, ang_deg))

    principle_layout = []
    for stage_i, (_, _, prompts) in enumerate(FRAMEWORK):
        stage_centre_deg = quadrant_angles[stage_i]
        n = len(prompts)
        spread = 28
        if n == 1:
            local_offsets = [0]
        else:
            local_offsets = [-spread + i * (2 * spread / (n - 1)) for i in range(n)]
        for k, (p, off) in enumerate(zip(prompts, local_offsets)):
            p_ang_deg = stage_centre_deg + off
            p_ang = math.radians(p_ang_deg)
            px = cx + R_PRINCIPLE * math.cos(p_ang)
            py = cy + R_PRINCIPLE * math.sin(p_ang)
            principle_layout.append((stage_i, p, px, py, p_ang_deg))

    # Connectors FIRST
    for stage_i, pname, px, py, p_ang_deg in principle_layout:
        sx_centre, sy_centre, stage_ang_deg = stage_centres[stage_i]
        dx = px - sx_centre
        dy = py - sy_centre
        d = math.hypot(dx, dy)
        if d == 0:
            continue
        ux, uy = dx / d, dy / d
        edge_dist_stage = min(
            abs((STAGE_W / 2) / ux) if abs(ux) > 0.01 else 1e9,
            abs((STAGE_H / 2) / uy) if abs(uy) > 0.01 else 1e9
        )
        x1 = sx_centre + ux * edge_dist_stage
        y1 = sy_centre + uy * edge_dist_stage
        edge_dist_pri = min(
            abs((PRINCIPLE_W / 2) / ux) if abs(ux) > 0.01 else 1e9,
            abs((PRINCIPLE_H / 2) / uy) if abs(uy) > 0.01 else 1e9
        )
        x2 = px - ux * edge_dist_pri
        y2 = py - uy * edge_dist_pri
        body.append(f'<path d="M {x1:.1f} {y1:.1f} L {x2:.1f} {y2:.1f}" class="conn-soft" opacity="0.6"/>')

    # Stage cards
    for (stage, subtitle, _), (sx, sy, _) in zip(FRAMEWORK, stage_centres):
        body.append(label_box(sx, sy, STAGE_W, STAGE_H, [stage, subtitle]))

    # Prompt boxes
    for stage_i, pname, px, py, _ in principle_layout:
        body.append(label_box(px, py, PRINCIPLE_W, PRINCIPLE_H, [pname]))

    # Central hub drawn LAST (on top, never overlapped)
    body.append(label_box(cx, cy, HUB_W, HUB_H, ["FLOW framework", "4 phases · 30 prompts"], focal=True))

    return svg(W, H, "\n".join(body), corner="04 · FLOW framework · B")


def diag_04_c():
    """C: Swim-lane — 4 horizontal lanes, one per phase."""
    body = []
    W, H = 1500, 820
    body.append(text(W/2, 60, "FLOW framework · 4 phases · 30 evidence-led prompts", "label-sub"))
    lane_h = 150
    lane_gap = 20
    start_y = 110
    label_x = 30
    content_x = 240
    for i, (stage, subtitle, prompts) in enumerate(FRAMEWORK):
        ly = start_y + i * (lane_h + lane_gap)
        focal = (i == 0)
        klass = "box-focal" if focal else "box-soft"
        body.append(box(label_x, ly, W - 60, lane_h, klass, rx=8))
        body.append(text(label_x + 30, ly + 50, f"phase {i+1:02d}", "label-accent", anchor="start"))
        body.append(text(label_x + 30, ly + 78, stage, "label", anchor="start"))
        body.append(text(label_x + 30, ly + 105, subtitle, "label-tiny", anchor="start"))
        n = len(prompts)
        avail = W - content_x - 60
        pill_w = min(280, (avail - (n - 1) * 24) / max(n, 1))
        for j, p in enumerate(prompts):
            px = content_x + j * (pill_w + 24) + pill_w / 2
            body.append(label_box(px, ly + lane_h / 2, pill_w, 70, [p]))
    return svg(W, H, "\n".join(body), corner="04 · FLOW framework · C")


# ============================================================================
# DIAGRAM 05 — WAVE ROADMAP (3 variants)
# ============================================================================
def diag_05_a():
    """A: Horizontal timeline with alternating cards."""
    body = []
    W, H = 1800, 600
    cy = 310
    n = len(WAVES)
    x_start, x_end = 120, W - 120
    step = (x_end - x_start) / (n - 1)
    body.append(f'<line x1="{x_start}" y1="{cy}" x2="{x_end}" y2="{cy}" class="conn-soft" stroke-width="2"/>')
    for i, (v, dt, title, items, focal) in enumerate(WAVES):
        x = x_start + i * step
        r = 14 if focal else 10
        fill = ACCENT_BRIGHT if focal else ACCENT
        body.append(f'<circle cx="{x}" cy="{cy}" r="{r}" fill="{fill}" stroke="#0A0807" stroke-width="2"/>')
        above = (i % 2 == 0)
        by = cy - 160 if above else cy + 30
        body.append(label_box(x, by + 60, 260, 130, [v + " · " + dt, title, ""], focal=focal))
        for k, ln in enumerate(items.split("\n")):
            body.append(text(x, by + 90 + k * 16, ln, "label-tiny"))
        if above:
            body.append(line_only(x, cy - r, x, by + 60 + 65))
        else:
            body.append(line_only(x, cy + r, x, by + 60 - 65))
    return svg(W, H, "\n".join(body), corner="05 · roadmap · A")


def diag_05_b():
    """B: Vertical timeline."""
    body = []
    W, H = 900, 1300
    cx = W / 2
    n = len(WAVES)
    y_start, y_end = 100, H - 100
    step = (y_end - y_start) / (n - 1)
    body.append(f'<line x1="{cx}" y1="{y_start}" x2="{cx}" y2="{y_end}" class="conn-soft" stroke-width="2"/>')
    for i, (v, dt, title, items, focal) in enumerate(WAVES):
        y = y_start + i * step
        r = 16 if focal else 12
        fill = ACCENT_BRIGHT if focal else ACCENT
        body.append(f'<circle cx="{cx}" cy="{y}" r="{r}" fill="{fill}" stroke="#0A0807" stroke-width="2"/>')
        left = (i % 2 == 0)
        side = -1 if left else 1
        bx = cx + side * 260
        body.append(label_box(bx, y, 360, 110, [v + " · " + dt, title], focal=focal))
        for k, ln in enumerate(items.split("\n")):
            body.append(text(bx, y + 70 + k * 14, ln, "label-tiny"))
        body.append(line_only(cx + side * r, y, bx - side * 180, y))
    return svg(W, H, "\n".join(body), corner="05 · roadmap · B")


def diag_05_c():
    """C: Kanban columns."""
    body = []
    W, H = 1400, 850
    cols = [
        ("shipped", ["v1.6.0", "v1.7.0", "v1.8.0", "v1.9.0"], True),
        ("next",    ["v2.0.0"], False),
        ("future",  ["v3.0.0"], False),
    ]
    col_w = 400
    col_gap = 40
    start_x = (W - 3 * col_w - 2 * col_gap) / 2
    for ci, (cname, versions, focal) in enumerate(cols):
        cx = start_x + ci * (col_w + col_gap)
        body.append(box(cx, 100, col_w, H - 180, "box-soft", rx=8))
        body.append(text(cx + 20, 130, cname.upper(), "label-accent", anchor="start"))
        body.append(text(cx + col_w - 20, 130, f"{len(versions):02d}", "label-tiny", anchor="end"))
        for vi, v in enumerate(versions):
            wave = next((w for w in WAVES if w[0] == v), None)
            if not wave:
                continue
            _, dt, title, items, fc = wave
            wy = 170 + vi * 140
            body.append(label_box(cx + col_w/2, wy + 50, col_w - 40, 100, [v + " · " + dt, title], focal=fc))
            for k, ln in enumerate(items.split("\n")):
                body.append(text(cx + col_w/2, wy + 90 + k * 14, ln, "label-tiny"))
    return svg(W, H, "\n".join(body), corner="05 · roadmap · C")


# ============================================================================
# MAIN
# ============================================================================
DIAGRAMS = {
    "01-architecture-A.svg":   diag_01_a,
    "01-architecture-B.svg":   diag_01_b,
    "01-architecture-C.svg":   diag_01_c,
    "02-pipeline-A.svg":       diag_02_a,
    "02-pipeline-B.svg":       diag_02_b,
    "02-pipeline-C.svg":       diag_02_c,
    "03-sub-skill-map-A.svg":  diag_03_a,
    "03-sub-skill-map-B.svg":  diag_03_b,
    "03-sub-skill-map-C.svg":  diag_03_c,
    "04-framework-A.svg":      diag_04_a,
    "04-framework-B.svg":      diag_04_b,
    "04-framework-C.svg":      diag_04_c,
    "05-roadmap-A.svg":        diag_05_a,
    "05-roadmap-B.svg":        diag_05_b,
    "05-roadmap-C.svg":        diag_05_c,
}


def main():
    for fname, fn in DIAGRAMS.items():
        out = DIAG_DIR / fname
        out.write_text(fn())
        print(f"  ✓ {fname}")
    print(f"\n{len(DIAGRAMS)} diagrams emitted to {DIAG_DIR}")


if __name__ == "__main__":
    main()
