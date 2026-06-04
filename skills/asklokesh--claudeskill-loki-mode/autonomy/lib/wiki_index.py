"""wiki_index.py -- dependency-free codebase index for the R5 auto-wiki.

Builds a line-anchored chunk index over a project's source files and provides
deterministic token-overlap retrieval. This is the grounding substrate for
cited answers: every chunk carries the REAL repo-relative file path and the
REAL start/end line numbers it came from, so a citation can always be checked
against the filesystem.

Reuse note: the token-overlap scoring (`_tokenize` + overlap weighting) is
ported from memory/knowledge_graph.py (OrganizationKnowledgeGraph), which scores
memory patterns the same way. knowledge_graph.py is NOT a code index (it
aggregates .loki/memory/semantic patterns), so the code scanning/chunking here
is new. retrieval.py is a memory retriever, not a code indexer, so it is not
reused for code retrieval.

No third-party dependencies. CI-safe (no Docker, no network, no provider).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

# Source extensions we index. Kept broad but excludes lockfiles/binaries.
SOURCE_EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
    ".rs", ".go", ".rb", ".java", ".kt", ".kts", ".c", ".cc", ".cpp",
    ".h", ".hpp", ".cs", ".php", ".swift", ".sh", ".bash", ".sql",
    ".vue", ".svelte", ".scala", ".clj", ".ex", ".exs", ".lua", ".r",
}

# Directories never worth indexing.
SKIP_DIRS = {
    "node_modules", ".git", "vendor", "__pycache__", "dist", "build",
    ".next", "target", ".venv", "venv", "coverage", ".loki", ".cache",
    "out", ".turbo", ".pytest_cache", ".mypy_cache",
}

CHUNK_LINES = 60  # lines per chunk; overlap-free, line-anchored.
MAX_FILES = 800   # safety cap so huge repos stay cheap.
MAX_FILE_BYTES = 400_000  # skip very large generated/minified files.

# Tokenizer ported from memory/knowledge_graph.py:_tokenize / _STOPWORDS.
_STOPWORDS = {
    "the", "a", "an", "to", "for", "of", "and", "or", "with", "without",
    "is", "are", "be", "up", "on", "in", "by", "not", "this", "that",
    "from", "as", "at", "it", "if", "do", "we", "my", "our", "how",
    "def", "self", "return", "import", "const", "let", "var", "function",
}


def _tokenize(text):
    """Lowercase, split on non-alphanumerics, drop stopwords + short tokens.

    Ported from knowledge_graph.OrganizationKnowledgeGraph._tokenize so wiki
    retrieval scores text the same way memory-pattern retrieval does.
    """
    toks = re.split(r"[^a-z0-9_]+", str(text or "").lower())
    return {t for t in toks if len(t) > 2 and t not in _STOPWORDS}


def _git_tracked_files(root):
    """Return git-tracked file paths (repo-relative), or None if not a repo."""
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return None
        files = [line.strip() for line in out.stdout.splitlines() if line.strip()]
        return files or None
    except (OSError, subprocess.SubprocessError):
        return None


def _walk_files(root):
    """Filtered filesystem walk fallback (when not a git repo)."""
    root = Path(root)
    results = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), root)
            results.append(rel)
    return results


def list_source_files(root):
    """Return a sorted list of repo-relative source files under root.

    Prefers git ls-files (respects .gitignore), falls back to a filtered walk.
    """
    root = Path(root)
    candidates = _git_tracked_files(root)
    if candidates is None:
        candidates = _walk_files(root)

    sources = []
    for rel in candidates:
        # Skip anything inside a skip dir (git tracked files can include them
        # if they were committed; we still exclude noise dirs).
        parts = set(Path(rel).parts)
        if parts & SKIP_DIRS:
            continue
        ext = os.path.splitext(rel)[1].lower()
        if ext not in SOURCE_EXTS:
            continue
        abs_path = root / rel
        try:
            if not abs_path.is_file():
                continue
            if abs_path.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        sources.append(rel)
    sources.sort()
    return sources[:MAX_FILES]


def _read_lines(abs_path):
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()
    except OSError:
        return []


def build_index(root):
    """Build a line-anchored chunk index over the project's source files.

    Returns a dict:
      {
        "root": <abs root>,
        "files": [<repo-relative paths>],
        "chunks": [
          {"id": int, "file": <rel>, "start_line": int, "end_line": int,
           "text": <chunk text>},
          ...
        ],
      }
    Paths are ALWAYS repo-relative (no PII, no absolute paths leak).
    Line numbers are 1-based and inclusive.
    """
    root = Path(root).resolve()
    files = list_source_files(root)
    chunks = []
    cid = 0
    for rel in files:
        lines = _read_lines(root / rel)
        if not lines:
            continue
        for start in range(0, len(lines), CHUNK_LINES):
            block = lines[start:start + CHUNK_LINES]
            if not any(line.strip() for line in block):
                continue  # skip all-blank chunks
            chunks.append({
                "id": cid,
                "file": rel,
                "start_line": start + 1,
                "end_line": start + len(block),
                "text": "\n".join(block),
            })
            cid += 1
    return {"root": str(root), "files": files, "chunks": chunks}


def retrieve(index, query, k=6):
    """Deterministic top-K chunk retrieval by token overlap.

    Scoring mirrors knowledge_graph.query_patterns: token overlap between the
    query and the chunk text, plus a small bonus when the query substring
    appears verbatim and when query tokens appear in the file path (so
    "how does the cli dispatch" surfaces cli.* files). No LLM, no network.
    Ties broken by chunk id for stable, reproducible ordering.
    """
    qtokens = _tokenize(query)
    qlower = str(query or "").lower()
    scored = []
    for ch in index.get("chunks", []):
        text = ch.get("text", "")
        score = 0
        overlap = qtokens & _tokenize(text)
        score += 3 * len(overlap)
        # Path tokens (file/dir names are strong signals).
        path_overlap = qtokens & _tokenize(ch.get("file", ""))
        score += 2 * len(path_overlap)
        # Verbatim substring bonus.
        if qlower and len(qlower) > 3 and qlower in text.lower():
            score += 4
        if score > 0:
            scored.append((score, ch["id"], ch))
    # Highest score first; stable tiebreak on id.
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [ch for _, _, ch in scored[:k]]


def compute_signature(root):
    """Cheap-incremental signature over git HEAD + per-file content hashes.

    Same idea as the proof/docs manifest: a deterministic hash that changes
    iff the indexed source set changes. Used to skip regeneration when the
    codebase is unchanged.
    """
    root = Path(root).resolve()
    h = hashlib.sha256()
    # git HEAD (if available) makes the signature cheap to invalidate on commit.
    try:
        head = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=15,
        )
        if head.returncode == 0:
            h.update(b"head:" + head.stdout.strip().encode())
    except (OSError, subprocess.SubprocessError):
        pass
    for rel in list_source_files(root):
        try:
            data = (root / rel).read_bytes()
        except OSError:
            continue
        h.update(rel.encode("utf-8"))
        h.update(hashlib.sha256(data).digest())
    return h.hexdigest()


def extract_definitions(root, rel, limit=12):
    """Return real def/class/function lines for a file, for code-derived citations.

    Returns a list of {"name": str, "line": int} where line is 1-based and
    points at a real definition in the file. Language-agnostic via a small set
    of regexes; only emits matches that actually exist in the file.
    """
    lines = _read_lines(Path(root) / rel)
    patterns = [
        re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)"),
        re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)"),
        re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
        re.compile(r"^\s*(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)"),
        re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)"),
        re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{"),  # bash funcs
    ]
    defs = []
    for i, line in enumerate(lines, start=1):
        for pat in patterns:
            m = pat.match(line)
            if m:
                defs.append({"name": m.group(1), "line": i})
                break
        if len(defs) >= limit:
            break
    return defs
