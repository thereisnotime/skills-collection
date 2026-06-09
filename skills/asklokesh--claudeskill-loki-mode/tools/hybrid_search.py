#!/opt/homebrew/bin/python3.12
"""
Loki Mode Hybrid Codebase Search

Combines lexical (ripgrep / grep) and semantic (ChromaDB) retrieval over the
same files the indexer covers, then fuses the two ranked lists with reciprocal
rank fusion (RRF). Results are deduped by file:line and truncated to a token
budget (greedy, highest fused score first).

Design notes:
    - Pure logic (RRF, dedup, budget truncation) is separated from I/O so it can
      be unit tested without a live ChromaDB or ripgrep.
    - chromadb is imported lazily inside the semantic path so this module loads
      and the grep-only fallback works even when chromadb is not installed.
    - When ChromaDB / docker is unreachable, search degrades to grep-only so it
      still returns results instead of erroring.

Usage:
    python tools/hybrid_search.py "rate limit detection"
    python tools/hybrid_search.py "council vote" --grep-only
    python tools/hybrid_search.py "memory retrieval" --semantic-only
    python tools/hybrid_search.py "build prompt" --budget 4000 --top 15
"""

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Project root (tools/hybrid_search.py -> repo root).
PROJECT_ROOT = Path(__file__).parent.parent.resolve()

CHROMA_HOST = os.environ.get("LOKI_CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("LOKI_CHROMA_PORT", "8100"))
COLLECTION_NAME = os.environ.get("LOKI_CHROMA_COLLECTION", "loki-codebase")

# Conservative default token budget for the merged result set. Embeddings and
# large dumps cost context, so we keep this small and let callers override.
DEFAULT_TOKEN_BUDGET = 3000
RRF_K = 60


# -----------------------------------------------------------------------------
# Token estimation (reuse memory.token_economics; fall back if unavailable)
# -----------------------------------------------------------------------------

def _load_estimate_tokens():
    try:
        if str(PROJECT_ROOT) not in sys.path:
            sys.path.insert(0, str(PROJECT_ROOT))
        from memory.token_economics import estimate_tokens as _et
        return _et
    except Exception:
        def _fallback(text: str) -> int:
            if not text:
                return 0
            return max(1, len(text) // 4)
        return _fallback


estimate_tokens = _load_estimate_tokens()


# -----------------------------------------------------------------------------
# Pure logic: reciprocal rank fusion, dedup, budget truncation
# -----------------------------------------------------------------------------

def _result_key(item: dict) -> str:
    """Dedup key: a result is identified by its file:line location."""
    return f"{item.get('file', '')}:{item.get('line', 0)}"


def reciprocal_rank_fusion(grep_ranked: list, semantic_ranked: list,
                           k: int = RRF_K) -> list:
    """Fuse two ranked result lists with reciprocal rank fusion.

    RRF score for an item = sum over each list it appears in of 1 / (k + rank),
    where rank is 1-based position in that list. Items are deduped by file:line;
    when the same location appears in both lists the scores add (so locations
    found by both retrievers rank higher). Output is sorted descending by fused
    score with a deterministic tiebreak on (file, line).

    Args:
        grep_ranked: lexical results, best first. Each is a dict with at least
            "file" and "line"; may carry "snippet", "name", etc.
        semantic_ranked: semantic results, best first, same shape.
        k: RRF constant (default 60, the standard value).

    Returns:
        A list of merged dicts, each annotated with "_fused_score" and
        "_sources" (sorted list of which retrievers found it).
    """
    merged: dict = {}

    def _absorb(ranked: list, source: str):
        for rank, item in enumerate(ranked, start=1):
            key = _result_key(item)
            contribution = 1.0 / (k + rank)
            if key not in merged:
                entry = dict(item)
                entry["_fused_score"] = 0.0
                entry["_sources"] = set()
                merged[key] = entry
            merged[key]["_fused_score"] += contribution
            merged[key]["_sources"].add(source)
            # Prefer a snippet if this list has one and we do not yet.
            if not merged[key].get("snippet") and item.get("snippet"):
                merged[key]["snippet"] = item["snippet"]

    _absorb(grep_ranked, "grep")
    _absorb(semantic_ranked, "semantic")

    results = list(merged.values())
    for entry in results:
        entry["_sources"] = sorted(entry["_sources"])
    # Deterministic order: highest fused score, then file, then line.
    results.sort(key=lambda e: (-e["_fused_score"],
                                str(e.get("file", "")),
                                int(e.get("line", 0))))
    return results


def truncate_to_budget(results: list, budget: int) -> list:
    """Greedily keep highest-scored results until the token budget is reached.

    The token cost of a result is estimated from its snippet plus a small fixed
    overhead for the file:line header line. If a single result is larger than
    the whole budget it is skipped and smaller later results are still packed
    (skip-and-continue), so the budget is never exceeded and the function does
    not get stuck on one oversized hit. Assumes results are already sorted by
    desired priority (RRF output is).

    Returns the kept subset (a new list), preserving input order.
    """
    if budget <= 0:
        return []
    kept: list = []
    used = 0
    for item in results:
        header = f"{item.get('file', '')}:{item.get('line', 0)} "
        snippet = item.get("snippet", "") or ""
        cost = estimate_tokens(header) + estimate_tokens(snippet)
        if used + cost > budget:
            # Skip this one; a smaller later result may still fit.
            continue
        kept.append(item)
        used += cost
    return kept


# -----------------------------------------------------------------------------
# I/O: file scope, lexical search, semantic search
# -----------------------------------------------------------------------------

def _indexer_files() -> list:
    """The set of files the indexer covers, as absolute paths.

    Imports the indexer's collect_files() when possible (single source of truth);
    falls back to a directory glob if the indexer cannot be imported (e.g.
    chromadb missing). The fallback keeps grep-only search working.
    """
    try:
        if str(PROJECT_ROOT / "tools") not in sys.path:
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
        import importlib
        spec = importlib.util.spec_from_file_location(
            "loki_index_codebase", str(PROJECT_ROOT / "tools" / "index-codebase.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return [str(fp) for fp, _ in mod.collect_files()]
    except Exception:
        # Fallback: scan common code dirs without importing chromadb.
        paths = []
        for sub in ("autonomy", "providers", "memory", "dashboard", "mcp",
                    "swarm", "learning", "events", "state", "skills", "tests"):
            d = PROJECT_ROOT / sub
            if not d.is_dir():
                continue
            for ext in ("*.sh", "*.py", "*.md"):
                paths.extend(str(p) for p in d.rglob(ext))
        for top in ("SKILL.md", "CLAUDE.md", "autonomy/loki"):
            p = PROJECT_ROOT / top
            if p.exists():
                paths.append(str(p))
        return sorted(set(paths))


def _have_ripgrep() -> bool:
    return shutil.which("rg") is not None


def grep_search(query: str, files: list, top: int = 30) -> tuple:
    """Lexical search over the given files. Returns (results, tool_used).

    Prefers ripgrep; falls back to grep -rn; falls back to a pure-python scan.
    Results are ranked by per-file match count (more matches first), then by
    line number, then file path for determinism. Each result is a dict with
    file (rel path), line, snippet, name, source="grep".
    """
    if not query.strip() or not files:
        return [], "none"

    matches: list = []  # (abs_file, line_no, text)
    tool_used = "none"

    if _have_ripgrep():
        tool_used = "ripgrep"
        try:
            cmd = ["rg", "--no-heading", "--line-number", "--color", "never",
                   "--fixed-strings", "-e", query] + files
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            for line in proc.stdout.splitlines():
                # format: path:line:content
                parts = line.split(":", 2)
                if len(parts) < 3:
                    continue
                fpath, lno, text = parts[0], parts[1], parts[2]
                if not lno.isdigit():
                    continue
                matches.append((fpath, int(lno), text))
        except Exception:
            matches = []
            tool_used = "none"

    if tool_used == "none" and shutil.which("grep"):
        tool_used = "grep"
        try:
            cmd = ["grep", "-rnF", "--", query] + files
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            for line in proc.stdout.splitlines():
                parts = line.split(":", 2)
                if len(parts) < 3:
                    continue
                fpath, lno, text = parts[0], parts[1], parts[2]
                if not lno.isdigit():
                    continue
                matches.append((fpath, int(lno), text))
        except Exception:
            matches = []
            tool_used = "none"

    if tool_used == "none":
        # Pure-python scan as a last resort (no external tools at all).
        tool_used = "python-scan"
        needle = query
        for fpath in files:
            try:
                with open(fpath, "r", errors="replace") as fh:
                    for i, text in enumerate(fh, start=1):
                        if needle in text:
                            matches.append((fpath, i, text.rstrip("\n")))
            except Exception:
                continue

    # Rank by per-file match count desc, then line asc, then path.
    counts: dict = {}
    for fpath, _, _ in matches:
        counts[fpath] = counts.get(fpath, 0) + 1

    def _rel(p: str) -> str:
        try:
            return str(Path(p).resolve().relative_to(PROJECT_ROOT))
        except Exception:
            return p

    matches.sort(key=lambda m: (-counts[m[0]], m[1], m[0]))

    results = []
    for fpath, lno, text in matches[:top]:
        results.append({
            "file": _rel(fpath),
            "line": lno,
            "name": "",
            "snippet": text.strip()[:300],
            "source": "grep",
        })
    return results, tool_used


def semantic_search(query: str, top: int = 30) -> tuple:
    """Semantic search via ChromaDB. Returns (results, available: bool).

    Imports chromadb lazily so a missing dependency or stopped container does
    not break the module. On any failure returns ([], False) so callers can
    fall back to grep-only.
    """
    try:
        import chromadb
        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        client.heartbeat()
        collection = client.get_collection(name=COLLECTION_NAME)
        res = collection.query(
            query_texts=[query],
            n_results=top,
            include=["documents", "metadatas", "distances"],
        )
    except Exception:
        return [], False

    results = []
    ids = res.get("ids", [[]])
    if not ids or not ids[0]:
        return [], True
    for i in range(len(ids[0])):
        meta = res["metadatas"][0][i]
        doc = res["documents"][0][i]
        dist = res["distances"][0][i]
        results.append({
            "file": meta.get("file", ""),
            "line": meta.get("line", 0),
            "name": meta.get("name", ""),
            "snippet": (doc[:300] if doc else ""),
            "relevance": round(max(0.0, 1.0 - dist / 2.0), 4),
            "source": "semantic",
        })
    return results, True


# -----------------------------------------------------------------------------
# Orchestration
# -----------------------------------------------------------------------------

def hybrid_search(query: str, top: int = 10, budget: int = DEFAULT_TOKEN_BUDGET,
                  grep_only: bool = False, semantic_only: bool = False) -> dict:
    """Run hybrid (or single-mode) search and return a structured result dict.

    Returns:
        {
          "query": str,
          "results": [ {file, line, snippet, sources, fused_score}, ... ],
          "grep_tool": str,            # ripgrep | grep | python-scan | none
          "semantic_available": bool,
          "mode": str,                 # hybrid | grep-only | semantic-only
          "fallback": bool,            # True if semantic was requested but down
          "budget": int,
        }
    """
    files = _indexer_files()
    fallback = False

    grep_results: list = []
    grep_tool = "none"
    if not semantic_only:
        grep_results, grep_tool = grep_search(query, files, top=max(top, 30))

    semantic_results: list = []
    semantic_available = False
    if not grep_only:
        semantic_results, semantic_available = semantic_search(query, top=max(top, 30))
        if not semantic_available and not semantic_only:
            # Semantic requested as part of hybrid but unavailable -> grep-only.
            fallback = True

    if semantic_only:
        fused = reciprocal_rank_fusion([], semantic_results)
        mode = "semantic-only"
    elif grep_only:
        fused = reciprocal_rank_fusion(grep_results, [])
        mode = "grep-only"
    else:
        fused = reciprocal_rank_fusion(grep_results, semantic_results)
        mode = "hybrid"

    fused = fused[:top]
    kept = truncate_to_budget(fused, budget)

    out = []
    for item in kept:
        out.append({
            "file": item.get("file", ""),
            "line": item.get("line", 0),
            "name": item.get("name", ""),
            "snippet": item.get("snippet", ""),
            "sources": item.get("_sources", []),
            "fused_score": round(item.get("_fused_score", 0.0), 6),
        })

    return {
        "query": query,
        "results": out,
        "grep_tool": grep_tool,
        "semantic_available": semantic_available,
        "mode": mode,
        "fallback": fallback,
        "budget": budget,
    }


def _render_text(payload: dict) -> str:
    """Render a hybrid_search payload as plain text (no emojis, no dashes)."""
    lines = []
    mode = payload["mode"]
    note = ""
    if payload.get("fallback"):
        note = " (semantic index unavailable, grep-only fallback)"
    grep_tool = payload.get("grep_tool", "none")
    if grep_tool in ("grep", "python-scan") and mode != "semantic-only":
        note += f" (ripgrep not found, using {grep_tool})"
    lines.append(f"hybrid search: {payload['query']!r} [{mode}]{note}")
    lines.append(f"budget: {payload['budget']} tokens, "
                 f"{len(payload['results'])} result(s)")
    lines.append("")
    if not payload["results"]:
        lines.append("no matches.")
        return "\n".join(lines)
    for i, r in enumerate(payload["results"], start=1):
        src = ",".join(r.get("sources", [])) or "?"
        lines.append(f"[{i}] {r['file']}:{r['line']}  "
                     f"(match: {src}, score: {r['fused_score']})")
        snip = (r.get("snippet") or "").strip()
        if snip:
            lines.append(f"    {snip}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Hybrid (grep + semantic) codebase search")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--top", type=int, default=10, help="Max results")
    parser.add_argument("--budget", type=int, default=DEFAULT_TOKEN_BUDGET,
                        help="Token budget for the merged result set")
    parser.add_argument("--grep-only", action="store_true",
                        help="Lexical search only (skip semantic)")
    parser.add_argument("--semantic-only", action="store_true",
                        help="Semantic search only (skip grep)")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    if args.grep_only and args.semantic_only:
        print("error: --grep-only and --semantic-only are mutually exclusive",
              file=sys.stderr)
        return 2

    payload = hybrid_search(
        args.query, top=args.top, budget=args.budget,
        grep_only=args.grep_only, semantic_only=args.semantic_only)

    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(_render_text(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
