#!/usr/bin/env python3
"""wiki-ask.py -- grounded, cited codebase Q&A for the R5 auto-wiki.

Answers a natural-language question about the project, grounded in the indexed
codebase. Citations are file:line and ALWAYS point at real code:

  1. Deterministically retrieve the top-K relevant chunks (token overlap).
  2. Show the LLM NUMBERED chunks and tell it to cite by index only ([1]..[K]).
  3. Map each [n] back to the real {file,start_line} of the chunk we supplied.
  4. Validate every citation against the filesystem; drop non-resolving ones.

A fabricated citation is structurally impossible: the model can only reference
chunks we handed it, and only those that resolve on disk survive.

LLM is mocked via LOKI_WIKI_LLM_STUB (see wiki_llm.py) so CI makes no paid calls.
With no provider and no stub, an EXTRACTIVE answer is returned (top chunk
snippets with their real citations).

Invoked as a subprocess (hyphen in filename):
  python3 wiki-ask.py --root <project> --question "..." [--k N] [--json] [--quiet]
Exit codes: 0 answered, 2 usage/error, 3 no relevant code found.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import wiki_index  # noqa: E402
from wiki_llm import invoke_llm, map_and_validate_citations  # noqa: E402


def _load_or_build_index(root):
    """Reuse the persisted code-index when present; else build in-memory.

    The persisted index lacks chunk text (kept small), so for retrieval we
    rebuild the full in-memory index. This stays cheap because build_index is
    dependency-free and capped.
    """
    return wiki_index.build_index(root)


def _build_prompt(question, chunks):
    parts = [
        "Answer the question using ONLY the numbered code excerpts below. "
        "Cite the excerpts you use with their index in square brackets, like "
        "[1] or [3]. Cite by index ONLY. Do NOT write file paths yourself. Do "
        "NOT use emojis. Do NOT use em dashes or en dashes. If the excerpts do "
        "not contain the answer, say so plainly.",
        "",
        "QUESTION: " + question,
        "",
        "CODE EXCERPTS:",
    ]
    for i, ch in enumerate(chunks, start=1):
        parts.append("[%d] %s (lines %d-%d):" % (
            i, ch["file"], ch["start_line"], ch["end_line"]))
        parts.append(ch["text"])
        parts.append("")
    return "\n".join(parts)


def _extractive_answer(question, chunks):
    """Deterministic fallback when no LLM is available.

    Returns prose that references the top chunks by index so the same
    citation-mapping path applies (every [n] resolves to a real chunk).
    """
    lines = [
        "No language model was available, so here are the most relevant code "
        "locations for your question:",
        "",
    ]
    for i, ch in enumerate(chunks, start=1):
        snippet = ch["text"].strip().splitlines()[:3]
        preview = " ".join(s.strip() for s in snippet)[:160]
        lines.append("- [%d] %s" % (i, preview))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Grounded cited codebase Q&A.")
    ap.add_argument("--root", default=".")
    ap.add_argument("--question", required=True)
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--json", action="store_true", help="emit JSON")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print("error: not a directory: %s" % root, file=sys.stderr)
        return 2

    index = _load_or_build_index(root)
    chunks = wiki_index.retrieve(index, args.question, k=max(1, args.k))
    if not chunks:
        if args.json:
            print(json.dumps({"answer": "", "citations": [],
                              "note": "no relevant code found"}))
        else:
            print("No relevant code found for that question.")
        return 3

    prompt = _build_prompt(args.question, chunks)
    raw = invoke_llm(prompt)
    if raw is None or not raw.strip():
        raw = _extractive_answer(args.question, chunks)

    answer, citations = map_and_validate_citations(raw, chunks, root)

    if args.json:
        print(json.dumps({
            "question": args.question,
            "answer": answer.strip(),
            "citations": citations,
        }, indent=2))
        return 0

    print(answer.strip())
    if citations:
        print("")
        print("Citations:")
        for c in citations:
            print("  %s:%d" % (c["file"], c["line"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
