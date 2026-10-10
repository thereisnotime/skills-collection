#!/usr/bin/env python3
"""project_health.py - quantify repository composition and documentation drag.

Reports how much of a repository is product code, comments on it, test code,
documentation/spec prose, and agent-facing instruction text, then derives the
ratios that show where maintenance effort actually goes.

This measures churn-relevant composition, not code quality. Nothing here is a
score. A ratio that reads like a grade gets optimised instead of understood,
which is why the ratchet pairs every "must not grow" metric with a "must not
shrink" one: deleting comments improves the ratio while shrinking the absolute
count, and only the conjunction fails.

Portable by construction: standard library only, no third-party imports, no
path assumed to exist. Anything absent is reported as unavailable rather than
guessed at or silently zeroed.

Usage:
  project_health.py                  print the stat block
  project_health.py --json           machine-readable
  project_health.py --check          compare against baseline.json; exit 1 on
                                     any ratchet violation
  project_health.py --update         rewrite baseline.json with current values
  project_health.py --explain        print metric definitions and limits
"""

import argparse
import json
import os
import re
import sys

# ---------------------------------------------------------------------------
# Language table
#
# line_tokens  - a stripped line starting with one of these is a comment
# block_pairs  - (opener, closer) tracked across lines; a stripped line
#                starting with an opener begins a comment region
# doc_pairs    - (opener, closer) for docstrings that behave like block
#                comments but only when the line *starts* with them
#
# Deliberately conservative: a comment is a line whose first non-whitespace
# characters open a comment. Trailing comments (`foo(); // note`) are counted
# as code, so the comment figures undercount rather than overcount and the
# tool does not cry wolf.
# ---------------------------------------------------------------------------
LANGUAGES = {
    ".py":   {"line": ("#",), "block": (), "doc": (('"""', '"""'), ("'''", "'''"))},
    ".pyi":  {"line": ("#",), "block": (), "doc": (('"""', '"""'), ("'''", "'''"))},
    ".js":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".jsx":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".mjs":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".cjs":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".ts":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".tsx":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".go":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".rs":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".java": {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".kt":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".swift":{"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".scala":{"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".cs":   {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".c":    {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".h":    {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".cpp":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".hpp":  {"line": ("//",), "block": (("/*", "*/"),), "doc": ()},
    ".rb":   {"line": ("#",), "block": (), "doc": (('=begin', '=end'),)},
    ".php":  {"line": ("//", "#"), "block": (("/*", "*/"),), "doc": ()},
    ".sh":   {"line": ("#",), "block": (), "doc": ()},
    ".bash": {"line": ("#",), "block": (), "doc": ()},
    ".zsh":  {"line": ("#",), "block": (), "doc": ()},
    ".lua":  {"line": ("--",), "block": (("--[[", "]]"),), "doc": ()},
    ".hs":   {"line": ("--",), "block": (("{-", "-}"),), "doc": ()},
    ".sql":  {"line": ("--",), "block": (("/*", "*/"),), "doc": ()},
    ".ex":   {"line": ("#",), "block": (), "doc": ()},
    ".exs":  {"line": ("#",), "block": (), "doc": ()},
    ".nim":  {"line": ("#",), "block": (), "doc": ()},
}

DOC_SUFFIXES = (".md", ".mdx", ".rst", ".adoc", ".txt")
FENCE_RE = re.compile(r"^\s*(```+|~~~+)")

# Extensionless files that are nonetheless product source. Without this a
# dotfiles or infrastructure repo - where `.zshrc`, `Makefile` and `Dockerfile`
# are the code - reports almost no product lines at all, because splitext()
# returns an empty suffix for them.
#
# `.gitignore`, `.gitattributes` and `.dockerignore` are deliberately absent:
# they are repository metadata, never the thing a repo is "made of", and
# counting them would pad the denominator of every comment ratio.
SHELL_LANG = {"line": ("#",), "block": (), "doc": ()}
HASH_LANG = {"line": ("#",), "block": (), "doc": ()}
VIM_LANG = {"line": ('"',), "block": (('"', '"'),), "doc": ()}
LANGUAGES_BY_NAME = {
    ".zshrc": SHELL_LANG, ".zshenv": SHELL_LANG, ".zprofile": SHELL_LANG,
    ".bashrc": SHELL_LANG, ".bash_profile": SHELL_LANG, ".profile": SHELL_LANG,
    ".bash_logout": SHELL_LANG, ".bash_aliases": SHELL_LANG,
    ".vimrc": VIM_LANG, ".gvimrc": VIM_LANG, "_vimrc": VIM_LANG,
    ".gitconfig": HASH_LANG,
    ".editorconfig": HASH_LANG, ".env": HASH_LANG,
    "Makefile": HASH_LANG, "makefile": HASH_LANG, "GNUmakefile": HASH_LANG,
    "Dockerfile": HASH_LANG, "Containerfile": HASH_LANG,
    "justfile": HASH_LANG, "Justfile": HASH_LANG,
    "Gemfile": HASH_LANG, "Rakefile": HASH_LANG, "Podfile": HASH_LANG,
    "Brewfile": HASH_LANG, "Vagrantfile": HASH_LANG,
}
MARKUP_COMMENT_RE = re.compile(r"^\s*<!--")

# Test detection: path convention plus name convention. Discovery, not
# configuration - a project that names tests differently reports fewer test
# metrics rather than misclassifying product code as test code.
#
# "spec"/"specs" are deliberately absent as directory names: spec-kit owns
# `specs/` for feature documents, and classifying that as a test directory
# silently swallows every spec as test code. RSpec is still covered by the
# `*_spec.rb` / `*.spec.ts` filename patterns below.
TEST_DIR_NAMES = {"test", "tests", "__tests__", "e2e", "integration", "testdata", "fixtures"}
TEST_FILE_RES = (
    re.compile(r"(^|/)(test_[^/]+|[^/]+_test|[^/]+Test)\.[A-Za-z]+$"),
    re.compile(r"\.(test|spec)\.[jt]sx?$"),
    re.compile(r"_spec\.rb$"),
)
# Per-language test-case declarations. Every entry here is live; a pattern that
# matched nothing was removed rather than kept alongside a working equivalent.
#
# Two entries were deleted at review rather than activated. One matched
# `describe(`, which is a suite rather than a case, and would have double-counted
# `it(`. The other was redundant with the inline JS/TS pattern in
# count_test_signals. Switching them on inflated a sample suite from 2 detected
# cases to 5, three of them false positives.
TEST_CASE_RES = (
    re.compile(r"^\s*(?:async\s+)?def\s+test_\w+", re.M),
    re.compile(r"^\s*func\s+Test\w+", re.M),
    re.compile(r"@(?:Test|ParameterizedTest|PyTest)\b"),
    re.compile(r"#\[(?:tokio::)?test\]"),
)
ASSERT_RES = (
    re.compile(r"\bassert(?:Equal|NotEqual|True|False|Throws|DeepEqual|_eq)\b"),
    re.compile(r"\bassert[A-Z]\w*\s*\("),
    re.compile(r"^\s*assert\b", re.M),
    re.compile(r"\bexpect\s*\("),
    re.compile(r"\bshould\s*\("),
    re.compile(r"\bassert_eq!|\bassert_ne!|\bassert!\s*\("),
)

AGENT_DIR_CANDIDATES = (
    os.path.join(".opencode", "agents"),
    os.path.join(".config", "opencode", "agents"),
    os.path.join(".claude", "agents"),
    os.path.join(".gemini", "agents"),
    os.path.join(".codex", "agents"),
)
INSTRUCTION_FILE_NAMES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md")
SKILL_DIR_CANDIDATES = (
    os.path.join(".agents", "skills"),
    os.path.join(".opencode", "skills"),
    os.path.join(".claude", "skills"),
    "skills",
)
DOC_DIR_CANDIDATES = ("docs", "doc", "specs", os.path.join(".specify", "features"))
IGNORE_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", "target", ".venv", "venv",
    "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".next",
    ".tox", "coverage", "htmlcov", ".gradle", ".idea", ".vscode", "tmp",
}


def read(path):
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def walk_up(start):
    current = os.path.abspath(start)
    while True:
        yield current
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent


def display_path(path, start):
    """Relative to the repo when inside it, `~/...` when it climbs out.

    Walking up deliberately reaches harness config above the repo, and a raw
    relpath renders that as an unreadable `../../..` chain.
    """
    home = os.path.expanduser("~")
    for prefix in (start, home):
        if prefix and path.startswith(prefix + os.sep):
            trimmed = os.path.relpath(path, prefix)
            return trimmed if prefix == start else os.path.join("~", trimmed)
    return path


def source_files(start):
    """Every non-ignored file under the repo."""
    out = []
    for root, dirs, names in os.walk(start):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for name in names:
            out.append(os.path.join(root, name))
    return out


def is_test_path(path, start):
    relative = os.path.relpath(path, start)
    parts = relative.split(os.sep)
    if any(part in TEST_DIR_NAMES for part in parts[:-1]):
        return True
    return any(pattern.search(relative) for pattern in TEST_FILE_RES)


# Generated output that gets committed. Counting it as hand-written source
# inflates the denominator of every ratio -- a compiled bundle carries almost no
# comments, so it drags commentRatio down and understates real bloat.
#
# Detection is structural (extension, or a sibling source file that a bundler
# would have compiled from) plus an explicit marker scan. Marker scanning is
# restricted to the file head and tail because phrases like "generated by" also
# appear in prose inside hand-written files, and a false positive here silently
# deletes a real file from the measurement.
GENERATED_SUFFIXES = (
    ".d.ts", ".d.mts", ".d.cts", ".min.js", ".min.mjs", ".min.cjs",
    ".js.map", ".mjs.map", ".cjs.map", ".css.map",
)
# Bundle outputs, and the sources a bundler compiles from.
BUNDLE_SUFFIXES = (".js", ".mjs", ".cjs")
BUNDLE_SOURCE_SUFFIXES = (".ts", ".tsx", ".jsx", ".mts", ".cts")
GENERATED_HEAD_MARKERS = ("@generated", "@auto-generated", "autogenerated by",
                          "auto-generated by", "automatically generated")
GENERATED_TAIL_MARKERS = ("sourceMappingURL=",)


def is_generated_artifact(path):
    """True when the file is build output rather than hand-written source.

    `path` must exist. Three independent signals, because no single one is
    sufficient: extensions cover declarations and minified output, the sibling
    check covers committed bundles, and the marker scan catches output that
    carries no naming convention at all.
    """
    name = os.path.basename(path)
    if name.endswith(GENERATED_SUFFIXES):
        return "extension"
    stem = os.path.splitext(name)[0]
    if name.endswith(BUNDLE_SUFFIXES):
        parent = os.path.dirname(path)
        for suffix in BUNDLE_SOURCE_SUFFIXES:
            if os.path.isfile(os.path.join(parent, stem + suffix)):
                return "bundle-with-source"
    try:
        lines = read(path).splitlines()
    except OSError:
        return None
    head = "\n".join(lines[:10]).lower()
    if any(marker in head for marker in GENERATED_HEAD_MARKERS):
        return "header-marker"
    tail = "\n".join(lines[-5:])
    if any(marker in tail for marker in GENERATED_TAIL_MARKERS):
        return "sourcemap-comment"
    return None


def classify_lines(path, spec):
    """Split a source file into (code, comment) non-blank line counts.

    A line counts as a comment when its first non-whitespace characters open a
    comment region. Known blind spots, documented rather than hidden: a
    trailing comment after code is counted as code, and a comment token
    appearing at the start of a heredoc or multi-line string continuation is
    counted as a comment.
    """
    code = comment = 0
    in_block = None
    try:
        lines = read(path).splitlines()
    except OSError:
        return 0, 0
    for raw in lines:
        stripped = raw.strip()
        if in_block is not None:
            if in_block in raw:
                after = raw.split(in_block, 1)[1].strip()
                if after:
                    code += 1
                else:
                    comment += 1
                in_block = None
            else:
                comment += 1
            continue
        if not stripped:
            continue
        opened = False
        for opener, closer in spec["doc"] + spec["block"]:
            if stripped.startswith(opener):
                rest = stripped[len(opener):]
                if closer in rest:
                    tail = rest.split(closer, 1)[1].strip()
                    if tail:
                        code += 1
                    else:
                        comment += 1
                else:
                    in_block = closer
                    comment += 1
                opened = True
                break
        if opened:
            continue
        if stripped.startswith(spec["line"]):
            comment += 1
            continue
        code += 1
    return code, comment


def count_test_signals(path):
    try:
        text = read(path)
    except OSError:
        return 0, 0
    cases = sum(len(p.findall(text)) for p in TEST_CASE_RES)
    # JS/TS suites. `describe(` is counted as a container, not a case: a suite
    # with three `it(` blocks is three cases, and counting both would double
    # them. Requiring a quoted first argument keeps this from matching ordinary
    # function calls named test or it.
    cases += len(re.findall(r"\b(?:it|test|specify)\s*\(\s*['\"`]", text))
    asserts = sum(len(p.findall(text)) for p in ASSERT_RES)
    return cases, asserts


def prose_lines(path):
    """Non-blank, non-fence, non-markup-comment lines of a doc file."""
    count = 0
    in_fence = False
    for raw in read(path).splitlines():
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        stripped = raw.strip()
        if not stripped or MARKUP_COMMENT_RE.match(raw):
            continue
        count += 1
    return count


def in_doc_dir(path, start):
    relative = os.path.relpath(path, start).split(os.sep)
    return any(part.lower() in DOC_DIR_CANDIDATES for part in relative[:-1])


def agent_context_files(start):
    """AGENTS/CLAUDE files, harness agent definitions, and skill manifests."""
    found, seen = [], set()

    def add(path):
        key = os.path.realpath(path)
        if key not in seen and os.path.isfile(path):
            seen.add(key)
            found.append(path)

    for directory in walk_up(start):
        for name in INSTRUCTION_FILE_NAMES:
            add(os.path.join(directory, name))
        for candidate in AGENT_DIR_CANDIDATES:
            base = os.path.join(directory, candidate)
            if os.path.isdir(base):
                for name in sorted(os.listdir(base)):
                    if name.endswith(".md"):
                        add(os.path.join(base, name))
        for candidate in SKILL_DIR_CANDIDATES:
            base = os.path.join(directory, candidate)
            if os.path.isdir(base):
                for name in sorted(os.listdir(base)):
                    manifest = os.path.join(base, name, "SKILL.md")
                    if os.path.isfile(manifest):
                        add(manifest)
    return found


def measure(start, config=None):
    config = config if config is not None else DEFAULT_CONFIG
    metrics, notes = {}, []

    product_code = product_comment = product_files = 0
    test_lines = test_cases = test_asserts = 0
    all_doc_prose = doc_dir_prose = 0
    generated_files = generated_lines = 0
    ignored_files = ignored_lines = 0
    ignored_patterns_used = set()
    compiled_ignores = compile_ignore_patterns(config.get("ignorePaths"))

    for path in source_files(start):
        # Authored ignores are evaluated first and counted. Ignoring is how a
        # repository improves its own numbers without fixing anything, so the
        # excluded volume is reported rather than quietly dropped.
        matched = is_ignored(path, start, compiled_ignores)
        if matched:
            ignored_patterns_used.add(matched)
            ignored_files += 1
            try:
                ignored_lines += len(read(path).splitlines())
            except OSError:
                pass
            continue
        basename = os.path.basename(path)
        suffix = os.path.splitext(path)[1].lower()
        # Extensionless product source (.zshrc, Makefile, Dockerfile) resolves
        # by name before the suffix table, or a config repo reads as empty.
        language = LANGUAGES_BY_NAME.get(basename) or LANGUAGES.get(suffix)
        # Docs are resolved before test detection. A markdown file is
        # documentation wherever it lives, including under a directory a test
        # convention would otherwise claim.
        if suffix in DOC_SUFFIXES:
            count = prose_lines(path)
            all_doc_prose += count
            if in_doc_dir(path, start):
                doc_dir_prose += count
            continue
        # Generated output is excluded before any classification, so a committed
        # bundle never inflates the denominator of a ratio built on hand-written
        # source. Excluded files are counted, not discarded silently.
        if language and is_generated_artifact(path):
            generated_files += 1
            try:
                generated_lines += len(read(path).splitlines())
            except OSError:
                pass
            continue
        if is_test_path(path, start):
            try:
                body = read(path)
            except OSError:
                continue
            test_lines += sum(1 for line in body.splitlines() if line.strip())
            cases, asserts = count_test_signals(path)
            test_cases += cases
            test_asserts += asserts
            continue
        if language:
            code, comment = classify_lines(path, language)
            product_code += code
            product_comment += comment
            product_files += 1

    metrics["productCodeLines"] = product_code
    metrics["productCommentLines"] = product_comment
    metrics["files"] = product_files
    metrics["testLines"] = test_lines
    metrics["testCases"] = test_cases
    metrics["testAsserts"] = test_asserts
    metrics["specProseLines"] = doc_dir_prose
    metrics["allDocProseLines"] = all_doc_prose
    metrics["generatedFiles"] = generated_files
    metrics["generatedLines"] = generated_lines
    metrics["ignoredFiles"] = ignored_files
    metrics["ignoredLines"] = ignored_lines

    context_local = context_global = 0
    local_files = []
    for path in agent_context_files(start):
        try:
            count = len(read(path).splitlines())
        except OSError:
            continue
        # Repo-local instruction is the actionable part - it is this repo's own
        # text and this repo can change it. Globally installed skills and the
        # user's harness agent definitions are reported separately, because a
        # repo cannot ratchet what it does not own, and folding them in makes
        # the number read ~40x larger than the thing anyone is responsible for.
        if path.startswith(start + os.sep) or os.path.dirname(path) == start:
            context_local += count
            local_files.append(path)
        else:
            context_global += count
    metrics["agentContextLines"] = context_local
    metrics["globalAgentContextLines"] = context_global
    metrics["agentContextFiles"] = len(local_files)

    product_total = product_code + product_comment
    metrics["commentRatio"] = round(product_comment / product_total, 4) if product_total else None
    metrics["linesPerTestCase"] = round(test_lines / test_cases, 1) if test_cases else None
    metrics["assertsPerTestCase"] = round(test_asserts / test_cases, 1) if test_cases else None
    metrics["docProseToCode"] = round(all_doc_prose / product_code, 2) if product_code else None
    metrics["testRatio"] = round(test_lines / product_code, 2) if product_code else None
    metrics["scatteredDocShare"] = (
        round((all_doc_prose - doc_dir_prose) / all_doc_prose, 4) if all_doc_prose else None
    )

    if not product_code:
        notes.append("no product source lines found - commentRatio and docProseToCode "
                     "are undefined. This may be a docs-only or config-only repo.")
    elif product_code < 2000 and (all_doc_prose > product_code * 3
                                  or context_local > product_code * 3):
        notes.append("product source is small relative to prose and agent context - "
                     "this reads like a docs, config, or skills repository. The "
                     "composition ratios are correct but not meaningful as a health "
                     "signal; judge it on a code repository instead.")
    if not test_cases:
        notes.append("no test cases recognised - test-file discovery is by path and "
                     "name convention; a project that names tests differently will "
                     "under-report here.")
    return metrics, notes, local_files, sorted(ignored_patterns_used)


# One metric per line, grouped. A two-column table is denser, but it forces
# the eye to track rows across a gap, and these numbers get read one at a time
# in review - "did commentRatio move?" is a single-value question.
GROUPS = (
    ("composition", (
        ("productCodeLines", "product code lines"),
        ("productCommentLines", "comment lines on product code"),
        ("commentRatio", "comment share of product source"),
        ("files", "product source files"),
        ("generatedFiles", "generated files excluded"),
        ("generatedLines", "generated lines excluded"),
        ("ignoredFiles", "files ignored by repo config"),
        ("ignoredLines", "lines ignored by repo config"),
    )),
    ("tests", (
        ("testLines", "test lines"),
        ("testCases", "test cases"),
        ("testAsserts", "assertions"),
        ("linesPerTestCase", "test lines per case"),
        ("assertsPerTestCase", "assertions per case"),
        ("testRatio", "test lines per product line"),
    )),
    ("documentation", (
        ("specProseLines", "prose in docs/ and specs/"),
        ("allDocProseLines", "prose in every doc file"),
        ("docProseToCode", "all doc prose per code line"),
        ("scatteredDocShare", "prose outside docs/ and specs/"),
    )),
    ("agent context", (
        ("agentContextLines", "repo-local instruction lines"),
        ("agentContextFiles", "repo-local instruction files"),
        ("globalAgentContextLines", "global skills and harness agent defs"),
    )),
)
LABEL_WIDTH = 46


def fmt(value):
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return "%.4f" % value if value < 10 else "%.2f" % value
    if isinstance(value, int):
        return "{:,}".format(value)
    return str(value)


def render_stat_block(metrics):
    """One metric per line under a group heading."""
    out = []
    for title, rows in GROUPS:
        out.append(title)
        for key, description in rows:
            out.append("  %-*s %12s" % (LABEL_WIDTH, description, fmt(metrics.get(key))))
        out.append("")
    return "\n".join(out).rstrip()


# (direction, tolerance, tolerance_mode)
#
#   up_bad  - violation when current > baseline. Bloat direction.
#   up_good - violation when current < baseline. Coverage/knowledge direction.
#   band    - violation when current moves more than `tolerance` in EITHER
#             direction. This is the one that matters most, and it is not
#             decoration: a single up_bad rule on comment volume is satisfied
#             by deleting every comment, which improves the ratio it was meant
#             to police. Forcing movement in both directions to be a conscious
#             baseline change is what closes that.
#
# `tolerance_mode` is "rel" (fraction of baseline) for counts and "abs" for
# ratios, where a fraction of a ratio is hard to reason about.
DIRECTIONS = {
    "commentRatio": ("band", 0.05, "abs"),
    "productCommentLines": ("band", 0.10, "rel"),
    "allDocProseLines": ("band", 0.10, "rel"),
    "agentContextLines": ("band", 0.10, "rel"),
    "testLines": ("band", 0.10, "rel"),
    "docProseToCode": ("up_bad", None, None),
    "testCases": ("up_good", None, None),
    "testAsserts": ("up_good", None, None),
}
FLAT_METRICS = ("files", "linesPerTestCase", "assertsPerTestCase",
                "specProseLines", "scatteredDocShare", "agentContextFiles",
                "productCodeLines", "globalAgentContextLines")


def side_file(name):
    return os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         os.pardir, name))


# A baseline is a measurement of ONE repository, so it lives in that repository
# and is committed with it. It used to ship inside the skill, which is installed
# globally and shared: every `--update` in every repo overwrote the same file,
# and a later `--check` compared against whichever repo ran last. That is worse
# than having no ratchet, because a green check reads as "healthy against a
# baseline" when nothing was ever compared.
#
# Committed, not gitignored, because the mechanism is "raising a baseline shows
# up as a visible diff". An uncommitted baseline has no diff, so `--check` would
# compare current against current and always pass.
BASELINE_RELPATH = os.path.join(".project-health", "baseline.json")
CONFIG_RELPATH = os.path.join(".project-health", "config.json")


def baseline_path(start, override=None):
    if override:
        return os.path.abspath(override)
    return os.path.join(start, BASELINE_RELPATH)

# Repo-authored ignore patterns, for files that are neither generated output nor
# recognisable source: scraped data fixtures, vendored snapshots, archived
# material. Deliberately NOT .gitignore -- that expresses "untracked", whereas
# the problem here is generated files that are committed and therefore tracked,
# so .gitignore structurally cannot express it.
#
# Patterns are gitignore-flavoured rather than shell globs: `*` and `?` stay
# within one path segment, `**` crosses directories, and a pattern with no slash
# matches at any depth.
DEFAULT_CONFIG = {"ignorePaths": []}


def glob_to_regex(pattern):
    """Translate a gitignore-flavoured pattern to a regex.

    `fnmatch` is not usable here: its `*` crosses `/`, so `src/*` would match
    `src/a/b/c.ts`. Subtle path-matching bugs are exactly the failure mode this
    tool cannot afford -- a pattern that matches too much silently deletes real
    files from the measurement.
    """
    out, i, n = [], 0, len(pattern)
    while i < n:
        char = pattern[i]
        if char == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                i += 2
                if i < n and pattern[i] == "/":
                    i += 1
                    out.append("(?:.*/)?")
                else:
                    out.append(".*")
                continue
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(char))
        i += 1
    return "".join(out)


def compile_ignore_patterns(patterns):
    """Compile patterns once.

    Two rules, chosen so the surprising case is the explicit one:

    - A pattern containing a slash is anchored to the repository root.
      `src/*` means src's direct children, not its subtree.
    - A pattern containing no slash matches at any depth, gitignore-style.
    - A pattern with no glob metacharacter also matches everything *under* it,
      so naming a directory is enough: `fixtures` covers `fixtures/a.json`.
      A pattern that does contain a metacharacter matches only what it spells
      out -- `**/snapshots` matches the directory entry, and you want
      `**/snapshots/**` for its contents. Silently descending for globs would
      make `src/*` swallow whole subtrees, which is the kind of over-broad
      match that silently deletes real files from the measurement.
    """
    compiled = []
    for pattern in patterns or []:
        if not isinstance(pattern, str) or not pattern.strip():
            continue
        pattern = pattern.strip()
        body = glob_to_regex(pattern)
        has_meta = any(ch in pattern for ch in "*?[")
        prefix = "" if "/" in pattern else "(?:.*/)?"
        suffix = "" if has_meta else "(?:/.*)?"
        compiled.append((pattern, re.compile("^" + prefix + body + suffix + "$")))
    return compiled


def is_ignored(path, start, compiled):
    if not compiled:
        return None
    relative = os.path.relpath(path, start).replace(os.sep, "/")
    for original, regex in compiled:
        if regex.match(relative):
            return original
    return None


def load_config(start, override=None):
    """Read authored config. A malformed file must never silently ignore nothing,
    because that would flatter every ratio while looking like a clean run."""
    path = os.path.abspath(override) if override else os.path.join(start, CONFIG_RELPATH)
    if not os.path.isfile(path):
        return DEFAULT_CONFIG, None
    try:
        data = json.loads(read(path))
    except ValueError as error:
        return DEFAULT_CONFIG, "config at %s is not valid JSON (%s); NO ignore patterns were applied" % (path, error)
    if not isinstance(data, dict):
        return DEFAULT_CONFIG, "config at %s is not a JSON object; NO ignore patterns were applied" % path
    patterns = data.get("ignorePaths", [])
    if not isinstance(patterns, list):
        return DEFAULT_CONFIG, "config at %s has a non-list ignorePaths; NO ignore patterns were applied" % path
    return {"ignorePaths": patterns}, None


def config_path(start, override=None):
    if override:
        return os.path.abspath(override)
    return os.path.join(start, CONFIG_RELPATH)


def load_json(path):
    if not os.path.isfile(path):
        return None
    try:
        return json.loads(read(path))
    except ValueError:
        return None


def evaluate_thresholds(metrics, limits):
    """Warn when a metric crosses a calibrated limit. Informational only."""
    warnings = []
    for key, rule in (limits or {}).items():
        if key.startswith("_"):
            continue
        value = metrics.get(key)
        if value is None:
            continue
        ceiling, floor = rule.get("max"), rule.get("min")
        if ceiling is not None and value > ceiling:
            warnings.append("%s = %s exceeds ceiling %s" % (key, fmt(value), fmt(ceiling)))
        if floor is not None and value < floor:
            warnings.append("%s = %s below floor %s" % (key, fmt(value), fmt(floor)))
    return warnings


def check(metrics, baseline):
    """Conjunction: every measurable metric must satisfy its own direction.

    A baseline recorded as zero is treated as adoption rather than as a limit.
    Growing from nothing is not bloat and is not a regression -- a repo whose
    first baseline predates its test suite should not fail every check because
    `testLines` now has a nonzero band around zero. It reports `new`, and
    `--update` makes it a real limit.
    """
    results, violations = [], []
    for key, (direction, tolerance, mode) in DIRECTIONS.items():
        current = metrics.get(key)
        if current is None:
            results.append({"metric": key, "direction": direction, "status": "skipped",
                            "reason": "not measurable in this repo"})
            continue
        if key not in baseline:
            results.append({"metric": key, "direction": direction, "status": "new",
                            "current": current, "note": "absent from baseline; run --update"})
            continue
        limit = baseline[key]
        if limit == 0 and current > 0:
            results.append({"metric": key, "direction": direction, "status": "new",
                            "baseline": 0, "current": current,
                            "note": "was absent at baseline; run --update to adopt"})
            continue
        if direction == "up_bad":
            ok, bound = current <= limit, limit
        elif direction == "up_good":
            ok, bound = current >= limit, limit
        else:
            slack = tolerance * abs(limit) if mode == "rel" else tolerance
            ok = (limit - slack) <= current <= (limit + slack)
            bound = (round(limit - slack, 4), round(limit + slack, 4))
        row = {"metric": key, "direction": direction, "baseline": limit,
               "current": current, "bound": bound}
        if ok:
            row["status"] = "ok"
        else:
            row["status"] = "FAIL"
            violations.append(row)
        results.append(row)
    return results, violations


def render(metrics, notes, context_files, thresholds=None, results=None,
           patterns_used=()):
    out = [render_stat_block(metrics), ""]

    if patterns_used:
        out.append("Ignored by repo config: %s" % ", ".join(patterns_used))
        out.append("  These files count toward nothing. If a ratio improved, this is why.")
        out.append("")

    if thresholds is not None:
        warnings = evaluate_thresholds(metrics, thresholds)
        out.append("Thresholds" + (" - %d warning(s)" % len(warnings) if warnings else " - all clear"))
        for warning in warnings:
            out.append("  warn  " + warning)
        out.append("")

    if notes:
        out.append("Unreliable in this repo (degraded, not zero)")
        for note in notes:
            out.append("  " + note)
        out.append("")
    out.append("Repo-local instruction surface: %d files" % len(context_files))
    for path in context_files[:12]:
        out.append("  " + display_path(path, os.getcwd()))
    if len(context_files) > 12:
        out.append("  ... and %d more" % (len(context_files) - 12))

    if results is not None:
        out.append("")
        out.append("Ratchet - conjunction over opposing directions")
        for row in results:
            if row["status"] == "ok":
                out.append("  ok      %-22s %-8s current=%-9s bound=%s"
                           % (row["metric"], row["direction"], fmt(row["current"]),
                              fmt(row["bound"])))
            elif row["status"] == "FAIL":
                out.append("  FAIL    %-22s %-8s current=%-9s bound=%s"
                           % (row["metric"], row["direction"], fmt(row["current"]),
                              fmt(row["bound"])))
            elif row["status"] == "new":
                out.append("  new     %-22s current=%s (run --update to adopt)"
                           % (row["metric"], fmt(row["current"])))
            else:
                out.append("  skipped %-22s %s" % (row["metric"],
                                                   row.get("reason", "not measurable")))
    return "\n".join(out)


EXPLAIN = """Metric definitions
------------------
productCommentLines  Comment lines in non-test source, counted where a line's
                     first non-whitespace characters open a comment region.
                     Trailing comments (`foo(); // note`) count as CODE, so
                     this undercounts rather than overcounts.
productCodeLines     Non-blank, non-comment lines in non-test source.
testLines            Non-blank lines in files detected as tests.
testCases            Test declarations recognised by per-language patterns.
testAsserts          Assertion calls recognised by per-language patterns.
specProseLines       Prose (non-blank, outside fenced code) in doc files that
                     live under docs/, specs/, or .specify/features/.
allDocProseLines     The same count across every doc file in the repo. The gap
                     against specProseLines is diagnostic: a high
                     scatteredDocShare means docs are scattered next to the
                     code rather than gathered in one place.
agentContextLines    Lines in AGENTS.md / CLAUDE.md, harness agent
                     definitions, and SKILL.md manifests - instruction text an
                     agent loads, which is why this repo's own skills count.
commentRatio         productCommentLines / (productCommentLines + productCodeLines)
linesPerTestCase     testLines / testCases
docProseToCode       allDocProseLines / productCodeLines
testRatio            testLines / productCodeLines (inherits test-discovery's
                     naming limits; unconventionally-named suites under-report)

Deliberately not measured
-------------------------
Comment *quality*, doc accuracy, or coverage adequacy. Every number here is
composition. A metric that reads like a grade gets optimised rather than
understood, which is why nothing here is a target on its own.

Accuracy limits
---------------
- Comment detection is a state machine over block/line tokens. A comment token
  at the start of a heredoc or string continuation is counted as a comment.
- Test discovery is by path and name convention. Unconventional naming
  under-reports test metrics rather than misclassifying product code.
- Test-case and assertion counting is regex-based and will differ from a real
  test runner's numbers. It is a guard against silent deletion, not a coverage
  report.
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--repo", default=".", help="repository root (default: cwd)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--check", action="store_true", help="ratchet; exit 1 on violation")
    parser.add_argument("--update", action="store_true", help="rewrite baseline.json")
    parser.add_argument("--baseline", default=None,
                        help="baseline file to read/write (default: the shipped one). "
                             "Use a per-repo path so one repository's numbers never "
                             "become another's baseline.")
    parser.add_argument("--thresholds", default=None,
                        help="thresholds file (default: the shipped one)")
    parser.add_argument("--config", default=None,
                        help="authored config with ignorePaths "
                             "(default: <repo>/.project-health/config.json)")
    parser.add_argument("--explain", action="store_true", help="print metric definitions")
    args = parser.parse_args()

    if args.explain:
        print(EXPLAIN)
        return 0

    start = os.path.abspath(args.repo)
    if not os.path.isdir(start):
        print("not a directory: %s" % start, file=sys.stderr)
        return 2

    config, config_error = load_config(start, args.config)
    metrics, notes, context_files, patterns_used = measure(start, config)
    if config_error:
        notes.insert(0, config_error)
    thresholds = load_json(args.thresholds or side_file("thresholds.json"))

    if args.update:
        path = baseline_path(start, args.baseline)
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
        baseline = load_json(path) or {}
        baseline["_note"] = ("Baseline for this repository. Raising a value is allowed and "
                             "shows up as a visible diff; that visibility is the mechanism. "
                             "Do not lower productCommentLines or testCases to make a ratio "
                             "look better - the ratchet bands exist to catch exactly that.")
        baseline.update({k: v for k, v in metrics.items() if v is not None})
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(baseline, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print("baseline updated: %s" % path)
        return 0

    results = violations = None
    if args.check:
        path = baseline_path(start, args.baseline)
        baseline = load_json(path)
        if baseline is None:
            # Explicit, and deliberately not exit 0. Nothing was compared, so a
            # zero here would read as a pass. Exit 2 says "not set up", which is
            # distinct from exit 1 saying "regressed".
            print("unbaselined: no baseline at %s" % path, file=sys.stderr)
            print("Nothing was compared. Run --update to record this repo's numbers,"
                  " and commit the result so future changes have something to measure"
                  " against.", file=sys.stderr)
            return 2
        results, violations = check(metrics, baseline)

    if args.json:
        payload = {"repo": start, "metrics": metrics, "notes": notes,
                   "ignorePatternsApplied": patterns_used,
                   "warnings": evaluate_thresholds(metrics, thresholds)}
        if results is not None:
            payload["ratchet"] = {"results": results, "violations": violations}
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(render(metrics, notes, context_files, thresholds, results, patterns_used))

    if args.check and violations:
        print("\n%d ratchet violation(s)." % len(violations), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())