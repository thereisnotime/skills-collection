#!/usr/bin/env python3
"""Find skill pairs whose descriptions compete for the same user request.

An agent picks a skill from its description alone. When two descriptions are
near-duplicates, the router cannot reliably choose between them and misroutes
-- "skill collision". This scores every pair by TF-IDF cosine similarity over
description + slug and reports the ones close enough to collide.

A high score is NOT automatically a defect. Some near-twins are legitimately
distinct (Linux vs Windows CIS hardening; red-team DCSync vs blue-team DCSync
detection). Those belong in tools/collision-allowlist.json with a reason, which
is also a record of WHY they differ -- exactly the wording their negative
triggers need.

Pure stdlib; no numpy/sklearn required.

Usage:
    python tools/detect-collisions.py
    python tools/detect-collisions.py --threshold 0.5
    python tools/detect-collisions.py --json
    python tools/detect-collisions.py --max-unreviewed 60   # CI gate
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from skill_frontmatter import description_of, iter_skill_dirs, load_frontmatter, FrontmatterError

ALLOWLIST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "collision-allowlist.json")
DEFAULT_THRESHOLD = 0.45

# Words too common in this corpus to carry signal.
STOPWORDS = set("""
the a an and or of to for in on with using use uses used when this that is are be by
from as it its into via at not skill security detect detects detecting analyze analyzes
analyzing perform performs performing implement implements implementing
""".split())

# A term appearing in more than this many skills is treated as a domain-wide
# background word and skipped when pairing (keeps the comparison O(usable pairs)).
MAX_DOCS_PER_TERM = 60


# A negative trigger names the sibling skill on purpose ("Do not use for X -
# use other-skill."). Scoring that text would inject the sibling's own slug
# tokens into this skill's vector, so correctly disambiguating a pair would
# RAISE its similarity score -- the metric would punish the fix. Strip the
# disambiguation scaffolding and score only the descriptive part.
DISAMBIGUATION_RE = re.compile(r"\b(?:do\s+not\s+use|don'?t\s+use|avoid\s+(?:this\s+)?(?:skill\s+)?for)\b.*",
                               re.IGNORECASE | re.DOTALL)
KEYWORDS_LABEL_RE = re.compile(r"\bkeywords\s*:", re.IGNORECASE)


def strip_disambiguation(text: str) -> str:
    """Drop negative-trigger sentences and the literal 'Keywords:' label.

    The keyword TERMS stay -- they are real content. Only the label is removed,
    since it would otherwise be a shared token across every fixed skill.
    """
    text = DISAMBIGUATION_RE.sub("", text)
    return KEYWORDS_LABEL_RE.sub(" ", text)


def tokenize(text: str) -> Counter:
    return Counter(w for w in re.findall(r"[a-z0-9]+", text.lower())
                   if w not in STOPWORDS and len(w) > 2)


def build_vectors(skills_dir: str) -> dict[str, dict[str, float]]:
    """L2-normalized TF-IDF vectors keyed by slug."""
    docs: dict[str, Counter] = {}
    for slug, skill_dir in iter_skill_dirs(skills_dir):
        try:
            frontmatter = load_frontmatter(os.path.join(skill_dir, "SKILL.md"))
        except FrontmatterError:
            continue
        described = strip_disambiguation(description_of(frontmatter))
        docs[slug] = tokenize(f"{described} {slug.replace('-', ' ')}")

    doc_freq: Counter = Counter()
    for counts in docs.values():
        doc_freq.update(counts.keys())

    total = len(docs)
    vectors: dict[str, dict[str, float]] = {}
    for slug, counts in docs.items():
        weights = {term: (1 + math.log(freq)) * math.log(total / doc_freq[term])
                   for term, freq in counts.items()}
        norm = math.sqrt(sum(w * w for w in weights.values())) or 1.0
        vectors[slug] = {term: w / norm for term, w in weights.items()}
    return vectors


def score_pairs(vectors: dict[str, dict[str, float]], threshold: float):
    """Cosine similarity for every pair sharing at least one discriminating term."""
    postings: dict[str, list[str]] = {}
    for slug, vector in vectors.items():
        for term in vector:
            postings.setdefault(term, []).append(slug)

    sims: dict[tuple[str, str], float] = {}
    for term, slugs in postings.items():
        if len(slugs) > MAX_DOCS_PER_TERM:
            continue
        weight_by_slug = {s: vectors[s][term] for s in slugs}
        for a, b in itertools.combinations(sorted(slugs), 2):
            sims[(a, b)] = sims.get((a, b), 0.0) + weight_by_slug[a] * weight_by_slug[b]

    return sorted(((s, p) for p, s in sims.items() if s >= threshold), reverse=True)


def load_allowlist() -> dict[tuple[str, str], str]:
    if not os.path.isfile(ALLOWLIST_PATH):
        return {}
    with open(ALLOWLIST_PATH, encoding="utf-8") as handle:
        data = json.load(handle)
    out: dict[tuple[str, str], str] = {}
    for entry in data.get("reviewed_distinct", []):
        pair = tuple(sorted(entry["pair"]))
        out[pair] = entry.get("reason", "")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--max-unreviewed", type=int, default=None,
                        help="exit 1 if unreviewed colliding pairs exceed this")
    parser.add_argument("--skills-dir", default="skills")
    args = parser.parse_args()

    if not os.path.isdir(args.skills_dir):
        print(f"ERROR: '{args.skills_dir}' not found. Run from the repository root.")
        return 1

    vectors = build_vectors(args.skills_dir)
    pairs = score_pairs(vectors, args.threshold)
    allowlist = load_allowlist()

    unreviewed = [(s, p) for s, p in pairs if p not in allowlist]
    reviewed = [(s, p) for s, p in pairs if p in allowlist]
    involved = {slug for _, pair in unreviewed for slug in pair}

    if args.as_json:
        print(json.dumps({
            "threshold": args.threshold,
            "total_pairs": len(pairs),
            "unreviewed": [{"score": round(s, 3), "pair": list(p)} for s, p in unreviewed],
            "reviewed_distinct": [{"score": round(s, 3), "pair": list(p),
                                   "reason": allowlist[p]} for s, p in reviewed],
            "skills_involved": sorted(involved),
        }, indent=2))
    else:
        print(f"Colliding pairs at cosine >= {args.threshold}: {len(pairs)} "
              f"({len(reviewed)} reviewed-distinct, {len(unreviewed)} unreviewed)")
        print(f"Skills involved in an unreviewed collision: {len(involved)} "
              f"of {len(vectors)}\n")
        for score, (a, b) in unreviewed:
            print(f"  {score:.2f}  {a}\n        {b}")
        if reviewed:
            print(f"\nReviewed as legitimately distinct ({len(reviewed)}):")
            for score, (a, b) in reviewed:
                print(f"  {score:.2f}  {a} || {b}\n        reason: {allowlist[(a, b)]}")

    if args.max_unreviewed is not None and len(unreviewed) > args.max_unreviewed:
        print(f"\nERROR: {len(unreviewed)} unreviewed colliding pairs "
              f"exceeds --max-unreviewed {args.max_unreviewed}.")
        print("Either disambiguate the descriptions or record the pair in "
              f"{os.path.relpath(ALLOWLIST_PATH)} with a reason.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
