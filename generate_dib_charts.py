#!/usr/bin/env python3
"""Generate polished charts for /r/dataisbeautiful from the skills-collection data."""
import json
import shutil
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

ROOT = Path(__file__).parent
CHARTS = ROOT / "charts"
CHARTS.mkdir(exist_ok=True)

# ---- Theme ----
BG = "#0d1117"
PANEL = "#0d1117"
TEXT = "#e6edf3"
MUTED = "#8b949e"
GRID = "#21262d"
ACCENT = "#6366f1"
ACCENT2 = "#10b981"
ACCENT3 = "#f59e0b"

# Prefer Roboto if installed
for fp in ["/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Regular.ttf",
           "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Medium.ttf",
           "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf"]:
    if Path(fp).exists():
        fm.fontManager.addfont(fp)
try:
    plt.rcParams["font.family"] = "Roboto"
except Exception:
    pass
plt.rcParams["font.size"] = 11

# Populated by generate_all() so the module is import-safe (no I/O at import time).
a = {}
SOURCE = ""
N_REPOS = 0
N_LANGS = 0


def display(name):
    return name.replace("--", "/")


def footer(fig):
    fig.text(0.5, 0.035, SOURCE, ha="center", va="bottom",
             color=MUTED, fontsize=8.5)


def style_ax(ax):
    ax.set_facecolor(PANEL)
    for sp in ["top", "right"]:
        ax.spines[sp].set_visible(False)
    for sp in ["bottom", "left"]:
        ax.spines[sp].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=10)


# =====================================================================
# CHART 1 — Verbosity landscape: avg lines vs avg words per skill
# =====================================================================
def chart_verbosity():
    repos = [(k, v) for k, v in a.items() if v.get("skill_count", 0) > 0]
    x = np.array([v["skill_lines_avg"] for _, v in repos], dtype=float)
    y = np.array([v["skill_words_avg"] for _, v in repos], dtype=float)
    cnt = np.array([v["skill_count"] for _, v in repos], dtype=float)

    fig, ax = plt.subplots(figsize=(11, 7.5), facecolor=BG)
    style_ax(ax)
    ax.set_xscale("log")
    ax.set_yscale("log")

    cmap = LinearSegmentedColormap.from_list(
        "indigoteal", ["#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f59e0b"])
    sizes = 40 + (cnt / cnt.max()) * 1400
    sc = ax.scatter(x, y, s=sizes, c=cnt, cmap=cmap, norm=matplotlib.colors.LogNorm(),
                    alpha=0.82, edgecolors="#0d1117", linewidths=0.8, zorder=3)

    # Expand limits to leave headroom so outlier labels don't clip the frame
    ax.set_xlim(x.min() / 1.45, x.max() * 1.9)
    ax.set_ylim(y.min() / 1.45, y.max() * 1.7)

    # collection-wide reference lines: mean of per-repo averages
    # (same definition as the README headline figures and the distribution chart's mean)
    avg_lines = float(x.mean())
    avg_words = float(y.mean())
    ax.axvline(avg_lines, color=MUTED, ls="--", lw=1, alpha=0.5, zorder=1)
    ax.axhline(avg_words, color=MUTED, ls="--", lw=1, alpha=0.5, zorder=1)
    ax.text(avg_lines, ax.get_ylim()[1], f" collection avg {avg_lines:.0f} lines", color=MUTED,
            fontsize=8.5, va="top", ha="left", rotation=0)
    ax.text(ax.get_xlim()[1], avg_words, f"avg {avg_words:,.0f} words ", color=MUTED,
            fontsize=8.5, va="bottom", ha="right")

    # annotate notable / extreme repos
    interesting = {}
    for k, v in repos:
        interesting[k] = v
    # pick a few: largest skill_count, longest, shortest, most words
    by = lambda key, rev=True: sorted(repos, key=lambda kv: kv[1][key], reverse=rev)
    picks = set()
    for kv in by("skill_count")[:3]:
        picks.add(kv[0])
    for kv in by("skill_lines_avg")[:2]:
        picks.add(kv[0])
    for kv in by("skill_words_avg")[:1]:
        picks.add(kv[0])
    # Place each label toward the interior based on which quadrant the point sits in,
    # so boxes never run off the (now expanded) frame.
    xlo, xhi = ax.get_xlim()
    ylo, yhi = ax.get_ylim()
    xmid = np.sqrt(xlo * xhi)          # geometric midpoint on the log x-axis
    ytop = yhi / 2.2                   # anything above this is "near the top"
    for k, v in repos:
        if k in picks:
            px, py = v["skill_lines_avg"], v["skill_words_avg"]
            dx, ha = ((-9, "right") if px > xmid else (9, "left"))
            dy, va = ((-11, "top") if py > ytop else (9, "bottom"))
            ax.annotate(display(k), (px, py),
                        textcoords="offset points", xytext=(dx, dy), ha=ha, va=va,
                        color=TEXT, fontsize=8.5, fontweight="medium", zorder=5,
                        bbox=dict(boxstyle="round,pad=0.25", fc="#161b22", ec=GRID, alpha=0.92))

    cbar = fig.colorbar(sc, ax=ax, pad=0.02, fraction=0.046)
    cbar.set_label("skills in repo", color=MUTED, fontsize=10)
    cbar.ax.yaxis.set_tick_params(color=MUTED)
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color=MUTED)
    cbar.outline.set_edgecolor(GRID)

    ax.set_xlabel("Average lines per skill  (log scale)", color=TEXT, fontsize=12)
    ax.set_ylabel("Average words per skill  (log scale)", color=TEXT, fontsize=12)
    ax.grid(True, which="both", color=GRID, lw=0.5, alpha=0.6)

    fig.text(0.5, 0.955, "Average lines vs. average words per skill, by repo", ha="center",
             color=TEXT, fontsize=18, fontweight="bold")
    fig.text(0.5, 0.918,
             "Each bubble is one repo  •  position = typical skill length  •  size & colour = number of skills",
             ha="center", color=MUTED, fontsize=11)
    footer(fig)
    fig.subplots_adjust(top=0.88, bottom=0.13, left=0.08, right=0.99)
    fig.savefig(CHARTS / "dib-verbosity.png", dpi=200, facecolor=BG)
    plt.close(fig)
    print("wrote dib-verbosity.png")


# =====================================================================
# CHART 2 — Distribution of skill length (avg lines per skill)
# =====================================================================
def chart_distribution():
    vals = np.array([v["skill_lines_avg"] for v in a.values()
                     if v.get("skill_count", 0) > 0], dtype=float)
    fig, ax = plt.subplots(figsize=(11, 7), facecolor=BG)
    style_ax(ax)

    bins = np.arange(0, vals.max() + 60, 60)
    n, edges, patches = ax.hist(vals, bins=bins, color=ACCENT, alpha=0.9,
                                edgecolor=BG, linewidth=1.2, zorder=3)
    # gradient fade across bars
    cmap = LinearSegmentedColormap.from_list("g", ["#6366f1", "#a855f7", "#ec4899"])
    for i, p in enumerate(patches):
        p.set_facecolor(cmap(i / max(1, len(patches) - 1)))

    median = float(np.median(vals))
    mean = float(np.mean(vals))
    ax.axvline(median, color=ACCENT2, lw=2, zorder=4)
    ax.axvline(mean, color=ACCENT3, lw=2, ls="--", zorder=4)
    top = ax.get_ylim()[1]
    ax.text(median, top * 0.97, f"  median {median:.0f}", color=ACCENT2,
            fontsize=11, fontweight="bold", va="top")
    ax.text(mean, top * 0.88, f"  mean {mean:.0f}", color=ACCENT3,
            fontsize=11, fontweight="bold", va="top")

    ax.set_xlabel("Average lines per skill (per repo)", color=TEXT, fontsize=12)
    ax.set_ylabel("Number of repos", color=TEXT, fontsize=12)
    ax.grid(axis="y", color=GRID, lw=0.5, alpha=0.6)
    ax.set_xlim(0, vals.max() + 60)

    fig.text(0.5, 0.955, f"Distribution of average skill length across {N_REPOS} repos", ha="center",
             color=TEXT, fontsize=18, fontweight="bold")
    fig.text(0.5, 0.918,
             "Each repo's mean SKILL.md length, in lines  •  bin width = 60 lines",
             ha="center", color=MUTED, fontsize=11)
    footer(fig)
    fig.subplots_adjust(top=0.88, bottom=0.13, left=0.08, right=0.97)
    fig.savefig(CHARTS / "dib-skill-length.png", dpi=200, facecolor=BG)
    plt.close(fig)
    print("wrote dib-skill-length.png")


# =====================================================================
# CHART 3 — Top languages found in skill code blocks
# =====================================================================
def chart_languages():
    langc = Counter()
    for v in a.values():
        for l in v.get("code_languages", []):
            langc[l] += 1
    top = langc.most_common(15)
    names = [t[0] for t in top][::-1]
    counts = [t[1] for t in top][::-1]

    fig, ax = plt.subplots(figsize=(11, 7), facecolor=BG)
    style_ax(ax)
    cmap = LinearSegmentedColormap.from_list("g", ["#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f59e0b"])
    colors = [cmap(i / (len(names) - 1)) for i in range(len(names))]
    bars = ax.barh(names, counts, color=colors, height=0.72, zorder=3,
                   edgecolor=BG, linewidth=0.8)
    for b, c in zip(bars, counts):
        ax.text(b.get_width() + 0.7, b.get_y() + b.get_height() / 2,
                f"{c}", va="center", ha="left", color=TEXT, fontsize=10.5,
                fontweight="medium")

    ax.set_xlabel(f"Repos containing code blocks in this language  (out of {N_REPOS})",
                  color=TEXT, fontsize=12)
    ax.tick_params(axis="y", labelsize=12)
    plt.setp(ax.get_yticklabels(), color=TEXT, fontweight="medium")
    ax.grid(axis="x", color=GRID, lw=0.5, alpha=0.6)
    ax.set_xlim(0, max(counts) * 1.12)

    fig.text(0.5, 0.955, "Most common languages in skill code blocks", ha="center",
             color=TEXT, fontsize=18, fontweight="bold")
    fig.text(0.5, 0.918,
             f"Number of repos (of {N_REPOS}) whose skills contain a code block in each language  •  {N_LANGS} languages appear in total",
             ha="center", color=MUTED, fontsize=10.5)
    footer(fig)
    fig.subplots_adjust(top=0.88, bottom=0.13, left=0.13, right=0.97)
    fig.savefig(CHARTS / "dib-languages.png", dpi=200, facecolor=BG)
    plt.close(fig)
    print("wrote dib-languages.png")


# =====================================================================
# CHART 4 — Repo popularity vs. age (stars vs. days since creation)
# =====================================================================
META_PATH = ROOT / "repos-meta.json"


def fetch_repo_meta():
    """Return {dir: {created_at, stars, ...}}, fetching any missing repos via gh.

    Self-healing: keeps repos-meta.json in sync as repos are added/removed, but
    falls back to whatever is cached when gh is unavailable (e.g. offline runs)."""
    meta = {}
    if META_PATH.exists():
        meta = json.loads(META_PATH.read_text())
    inv = []
    inv_path = ROOT / "inventory.json"
    if inv_path.exists():
        inv = json.loads(inv_path.read_text())
    missing = [r for r in inv if r["dir"] not in meta]
    if missing and shutil.which("gh"):
        def fetch(item):
            repo = item["url"].replace("https://github.com/", "").strip("/")
            try:
                out = subprocess.run(
                    ["gh", "api", f"repos/{repo}", "--jq",
                     "{created_at:.created_at,pushed_at:.pushed_at,stars:.stargazers_count}"],
                    capture_output=True, text=True, timeout=30)
                return item["dir"], (json.loads(out.stdout) if out.returncode == 0 else None)
            except Exception:
                return item["dir"], None
        with ThreadPoolExecutor(max_workers=10) as ex:
            for d, r in ex.map(fetch, missing):
                if r:
                    meta[d] = r
        META_PATH.write_text(json.dumps(meta, indent=1))
    return meta


def chart_stars_vs_age(date):
    meta = fetch_repo_meta()
    s = json.loads((ROOT / "stats.json").read_text())
    today = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    pts = []
    for k, m in meta.items():
        try:
            created = datetime.fromisoformat(m["created_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        age = (today - created).days
        stars = s.get(k, {}).get("stars", m.get("stars"))
        if not isinstance(stars, int) or stars < 1 or age < 1:
            continue
        pts.append((k, age, stars, stars / age))
    if len(pts) < 5:
        print("skip dib-stars-age (insufficient meta)")
        return

    names = [p[0] for p in pts]
    age = np.array([p[1] for p in pts], dtype=float)
    stars = np.array([p[2] for p in pts], dtype=float)
    vel = np.array([p[3] for p in pts], dtype=float)

    fig, ax = plt.subplots(figsize=(11, 7.5), facecolor=BG)
    style_ax(ax)
    ax.set_yscale("log")

    cmap = LinearSegmentedColormap.from_list(
        "vel", ["#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f59e0b"])
    sc = ax.scatter(age, stars, s=70, c=vel, cmap=cmap,
                    norm=matplotlib.colors.LogNorm(),
                    alpha=0.85, edgecolors="#0d1117", linewidths=0.8, zorder=3)
    ax.set_xlim(0, age.max() * 1.08)
    ax.set_ylim(stars.min() / 1.6, stars.max() * 2.2)

    # diagonal iso-velocity guide lines: stars = rate * age
    xline = np.array([1, age.max() * 1.08])
    for rate, lbl in [(10, "10/day"), (100, "100/day"), (1000, "1,000 stars/day")]:
        ax.plot(xline, rate * xline, color=MUTED, ls="--", lw=0.9, alpha=0.4, zorder=1)
        yend = rate * xline[1]
        if stars.min() / 1.6 < yend < stars.max() * 2.2:
            ax.text(xline[1], yend, f" {lbl}", color=MUTED, fontsize=8,
                    va="center", ha="left", alpha=0.7)

    # annotate the most-starred, fastest-growing, and oldest repos, each with a
    # distinct offset direction so labels don't collide when the points are close.
    roles = [(int(stars.argmax()), (10, 16), "left", "bottom"),    # most stars  -> up-right
             (int(vel.argmax()), (-10, -16), "right", "top"),      # fastest     -> down-left
             (int(age.argmax()), (-10, 12), "right", "bottom")]    # oldest      -> up-left
    seen = set()
    for idx, off, ha, va in roles:
        if idx in seen:
            continue
        seen.add(idx)
        ax.annotate(display(names[idx]), (age[idx], stars[idx]),
                    textcoords="offset points", xytext=off, ha=ha, va=va,
                    color=TEXT, fontsize=8.5, fontweight="medium", zorder=5,
                    bbox=dict(boxstyle="round,pad=0.25", fc="#161b22", ec=GRID, alpha=0.92))

    cbar = fig.colorbar(sc, ax=ax, pad=0.02, fraction=0.046)
    cbar.set_label("stars gained per day", color=MUTED, fontsize=10)
    cbar.ax.yaxis.set_tick_params(color=MUTED)
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color=MUTED)
    cbar.outline.set_edgecolor(GRID)

    ax.set_xlabel("Repo age in days (since creation on GitHub)", color=TEXT, fontsize=12)
    ax.set_ylabel("Stars  (log scale)", color=TEXT, fontsize=12)
    ax.grid(True, which="both", color=GRID, lw=0.5, alpha=0.6)

    fig.text(0.5, 0.955, "Repo popularity vs. age", ha="center",
             color=TEXT, fontsize=18, fontweight="bold")
    fig.text(0.5, 0.918,
             "Each bubble is one repo  •  colour = stars gained per day  •  dashed lines mark constant growth rates",
             ha="center", color=MUTED, fontsize=11)
    footer(fig)
    fig.subplots_adjust(top=0.88, bottom=0.13, left=0.09, right=0.99)
    fig.savefig(CHARTS / "dib-stars-age.png", dpi=200, facecolor=BG)
    plt.close(fig)
    print("wrote dib-stars-age.png")


def generate_all(analysis_path=None, date=None):
    """Load data and write all /r/dataisbeautiful charts into charts/.

    Called both standalone and from generate_readme.py's sync pipeline."""
    global a, SOURCE, N_REPOS, N_LANGS
    analysis_path = Path(analysis_path) if analysis_path else (ROOT / "analysis.json")
    a = json.loads(analysis_path.read_text())
    date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    N_REPOS = len(a)
    N_LANGS = len({l for v in a.values() for l in v.get("code_languages", [])})
    SOURCE = (f"Data: github.com/thereisnotime/skills-collection "
              f"({N_REPOS} Claude Code skill repos, {date})   •   "
              f"Tool: Python + Matplotlib   •   [OC]")
    chart_verbosity()
    chart_distribution()
    chart_languages()
    chart_stars_vs_age(date)


if __name__ == "__main__":
    generate_all()
