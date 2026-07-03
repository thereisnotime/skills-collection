#!/usr/bin/env python3
"""
Wave-6 regression tests for defensive-robustness bugs in memory/retrieval.py.

These are corrupt-file / hand-edited-record hardening fixes: no live writer
emits null per schema validation, but a corrupt or hand-edited record can carry
null fields (or a non-dict element), and the retrieval scoring paths must not
crash on them.

Covers:
  (H2) _keyword_search_anti_patterns: a None element and a {"what_fails": None}
       record in the legacy anti_patterns list must not crash (the old loop
       lacked the isinstance guard the sibling loop has and called .lower() on
       a None field).
  (M1) _keyword_search_semantic: a pattern with {"confidence": None} matching a
       keyword must not crash (score *= None -> TypeError).
  (M3) _score_result: a record with {"importance": None, "confidence": None}
       must not crash (0.7 + 0.3 * None -> TypeError). Also asserts a present
       0.0 is preserved (distinct from the missing/None default).
  (M4) Layer-2 progressive disclosure admits a TRIMMED summary set when the set
       exceeds the remaining budget, not all-or-nothing.

NOTE ON DISCOVERY: this file's name is hyphenated, so pytest's default
`python_files` (test_*.py / *_test.py) will NOT collect it by recursion. Run
it by explicit path (`python3 -m pytest tests/test-memory-retrieval-wave6-bugs.py`)
or standalone (`python3 tests/test-memory-retrieval-wave6-bugs.py`). The
__main__ block below runs every test so a green here is real, not a false-green
from a 0-collected discovery miss.
"""

import os
import sys

# Make the repo root importable so `import memory.*` resolves regardless of cwd.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# Self-skip if the memory package (or an optional dep it pulls in) is absent,
# so the suite degrades to a clean skip rather than a hard error on a stripped
# environment. The retrieval path used here is pure-stdlib today; the guard is
# defense-in-depth for environments that vendor a lighter memory package.
try:
    from memory.retrieval import MemoryRetrieval
    from memory.token_economics import estimate_memory_tokens
    _DEPS_OK = True
    _DEPS_ERR = None
except Exception as _exc:  # noqa: BLE001 - report the reason on skip
    MemoryRetrieval = None  # type: ignore[assignment]
    estimate_memory_tokens = None  # type: ignore[assignment]
    _DEPS_OK = False
    _DEPS_ERR = _exc


class _FakeStorage:
    """In-memory storage exposing only the methods the retriever touches.

    json_by_path maps a storage-relative path (e.g. "semantic/patterns.json")
    to the object read_json should return. Unknown paths return None, which is
    what the real storage returns for a missing file.
    """

    def __init__(self, json_by_path=None):
        self._json = json_by_path or {}

    def read_json(self, rel_path):
        return self._json.get(rel_path)

    def list_files(self, collection, pattern="*"):
        return []


def test_anti_patterns_handles_none_element_and_null_field():
    """(H2) None element + {"what_fails": None} must not crash the legacy loop.

    Non-vacuity: against the OLD code, the legacy anti_patterns loop had no
    isinstance guard and did `anti.get("what_fails", "").lower()`. A None
    element raises AttributeError on `.get`, and a present null field returns
    None so `None.lower()` raises AttributeError. Either crashes before the
    function returns. The fix adds the isinstance guard plus (x or "").
    """
    storage = _FakeStorage({
        "semantic/anti-patterns.json": {
            "anti_patterns": [
                None,  # non-dict element
                {"what_fails": None, "why": None, "prevention": None},
                {"what_fails": "deploy without tests", "why": "x",
                 "prevention": "y"},
            ]
        },
        # patterns.json is read by the sibling bridge loop; keep it empty.
        "semantic/patterns.json": {"patterns": []},
    })
    retriever = MemoryRetrieval(storage=storage)

    # "deploy" matches the third (well-formed) record; the bad records must be
    # skipped without crashing.
    results = retriever._keyword_search_anti_patterns(["deploy"])

    assert isinstance(results, list), "expected a list of results"
    assert len(results) == 1, (
        "only the well-formed 'deploy' record should score; bad records must "
        "be skipped, got %d" % len(results)
    )


def test_semantic_search_handles_null_confidence():
    """(M1) A matching pattern with confidence=None must not crash.

    Non-vacuity: against the OLD code `confidence = pattern.get("confidence",
    0.5); score *= confidence`. A present null confidence makes score *= None
    raise TypeError once the keyword matches (score > 0). The fix uses
    0.5 only when the value is missing/null.
    """
    storage = _FakeStorage({
        "semantic/patterns.json": {
            "patterns": [
                {"pattern": "always deploy with tests", "confidence": None},
            ]
        },
    })
    retriever = MemoryRetrieval(storage=storage)

    results = retriever._keyword_search_semantic(["deploy"])

    assert isinstance(results, list), "expected a list of results"
    assert len(results) == 1, (
        "the matching pattern should survive the null-confidence guard, got %d"
        % len(results)
    )
    # 0.5 default applied: score (1 keyword hit in pattern_text == 1.0) * 0.5.
    assert results[0]["_score"] == 0.5, (
        "expected score 1.0 * 0.5 default = 0.5, got %r" % results[0]["_score"]
    )


def test_score_result_handles_null_importance_and_confidence():
    """(M3) A record with importance=None and confidence=None must not crash.

    Non-vacuity: against the OLD code `importance = result.get("importance",
    0.5)` returns None for a present null, then `0.7 + 0.3 * None` raises
    TypeError. Same for confidence in `score * ... * confidence`. The fix
    substitutes the default only on missing/null.
    """
    retriever = MemoryRetrieval(storage=_FakeStorage())
    weights = {"semantic": 1.0}

    record = {
        "_source": "semantic",
        "_score": 1.0,
        "importance": None,
        "confidence": None,
    }
    score = retriever._score_result(record, weights)

    # importance default 0.5 -> factor 0.7 + 0.3*0.5 = 0.85; confidence
    # default 1.0; weight 1.0; base 1.0 -> 0.85.
    assert abs(score - 0.85) < 1e-9, (
        "expected 1.0 * 1.0 * 0.85 * 1.0 = 0.85, got %r" % score
    )


def test_score_result_preserves_legitimate_zero_importance():
    """(M3-guard) A present 0.0 importance must be preserved, not defaulted.

    Non-vacuity: if the fix had used `result.get("importance") or 0.5`, a real
    0.0 would be replaced by 0.5 (factor 0.85). The correct `is None` guard
    keeps 0.0 -> factor 0.7. This asserts 0.0 is distinct from missing.
    """
    retriever = MemoryRetrieval(storage=_FakeStorage())
    weights = {"semantic": 1.0}

    record = {
        "_source": "semantic",
        "_score": 1.0,
        "importance": 0.0,
        "confidence": 1.0,
    }
    score = retriever._score_result(record, weights)

    # importance 0.0 -> factor 0.7 + 0.3*0.0 = 0.7 (NOT the 0.85 default would
    # give).
    assert abs(score - 0.7) < 1e-9, (
        "a real importance=0.0 must yield factor 0.7 (score 0.7), not the "
        "default 0.85; got %r" % score
    )


def test_layer2_admits_trimmed_summary_set_not_all_or_nothing():
    """(M4) Layer 2 admits a trimmed set when summaries exceed budget.

    Setup: a FakeStorage with an empty index.json so Layer 1 selects nothing
    and budget_remaining == token_budget. We stub _get_topic_summaries to
    return several large summaries whose total exceeds the budget, and stub
    retrieve_task_aware (Layer 3) to return nothing so only Layer 2 is under
    test. With a small budget, optimize_context must trim the set.

    Non-vacuity: against the OLD code, Layer 2 admitted summaries
    all-or-nothing (`if layer2_tokens <= budget_remaining`). When the set
    exceeds budget, the old code admitted ZERO layer-2 summaries. The fix
    trims via optimize_context, so at least one (but not all) is admitted and
    the admitted tokens stay within budget.
    """
    storage = _FakeStorage({"index.json": {"topics": []}})
    retriever = MemoryRetrieval(storage=storage)

    # Build several summaries; each is large enough that the full set blows the
    # budget but a single one fits.
    big_text = "x" * 400
    summaries = [
        {"id": "s%d" % i, "summary": big_text, "type": "episodic"}
        for i in range(5)
    ]
    per_summary_tokens = estimate_memory_tokens(summaries[0])
    total_tokens = per_summary_tokens * len(summaries)

    # Budget holds some but not all summaries.
    token_budget = per_summary_tokens * 2 + per_summary_tokens // 2
    assert token_budget < total_tokens, "test setup: budget must be < total"
    assert token_budget >= per_summary_tokens, (
        "test setup: budget must hold at least one summary"
    )

    retriever._get_topic_summaries = lambda topics, query, weights: list(summaries)
    # Layer 3: return nothing so only Layer 2 contributes.
    retriever.retrieve_task_aware = lambda context, top_k=10, **kw: []
    # Avoid touching the filesystem for the total-available estimate.
    retriever._estimate_total_available_tokens = lambda: 100_000

    result = retriever._progressive_retrieve(
        {"goal": "anything"}, token_budget, "implementation"
    )

    layer2 = [m for m in result["memories"] if m.get("_layer") == 2]

    assert len(layer2) >= 1, (
        "Layer 2 should admit a TRIMMED non-empty set when summaries exceed "
        "budget; the old all-or-nothing gate admitted 0. Got %d" % len(layer2)
    )
    assert len(layer2) < len(summaries), (
        "Layer 2 must NOT admit the whole oversized set; expected a trim. "
        "Got %d of %d" % (len(layer2), len(summaries))
    )
    admitted_tokens = sum(estimate_memory_tokens(m) for m in layer2)
    assert admitted_tokens <= token_budget, (
        "admitted layer-2 tokens (%d) must stay within budget (%d)"
        % (admitted_tokens, token_budget)
    )


def test_filter_relevant_topics_ranks_on_real_writer_keys():
    """(L3) Topic relevance must score against the writer's real keys.

    The index.json writer emits topics keyed by "id"/"summary" (not the
    "topic"/"type"/"last_updated" the old scorer read), so word overlap and
    type weighting were silent no-ops: every real topic scored 0 on overlap.

    Non-vacuity: against the OLD code (`topic.get("topic", "")` for the name),
    both topics below score 0 word-overlap (the "topic" key is absent) and
    differ only by the constant type weight, so the query-relevant topic does
    NOT rank first by overlap. The fix scores against id+summary, so the topic
    whose summary matches the query ranks ahead.
    """
    retriever = MemoryRetrieval(storage=_FakeStorage())
    weights = {"implementation": 0.5}

    topics = [
        # Real writer shape: id is a phase/category slug, summary is prose.
        {"id": "implementation",
         "summary": "implement the payment checkout flow"},
        {"id": "implementation",
         "summary": "write release notes for the docs site"},
    ]
    query = "payment checkout"

    scored = retriever._filter_relevant_topics(topics, query, weights)

    assert len(scored) == 2, "both topics score > 0 via type weight, got %d" % len(scored)
    assert scored[0]["summary"].startswith("implement the payment checkout"), (
        "the topic whose summary matches the query must rank first; the old "
        "code scored 0 word-overlap on the absent 'topic' key. Got order: %s"
        % [t["summary"] for t in scored]
    )
    # The matching topic must have a strictly higher relevance score (overlap
    # of 2 words * 0.3 = +0.6 over the non-matching one).
    assert scored[0]["_relevance_score"] > scored[1]["_relevance_score"], (
        "word overlap must differentiate the two topics; got %r vs %r"
        % (scored[0]["_relevance_score"], scored[1]["_relevance_score"])
    )


def test_progressive_retrieve_dedups_ids_across_layers():
    """(wave-4) The same memory id must not appear in both Layer 2 and Layer 3.

    A Layer-2 summary is built from the same episode/pattern/skill that the
    Layer-3 retrieve_task_aware later surfaces, so both carry the SAME "id".
    Every other merge path dedups by id (_merge_results seen_ids); this one
    did not, so the same id leaked into selected_memories twice (once as a
    thin summary, once as the full record).

    Non-vacuity: against the OLD code (no cross-layer dedup), ids "ep-1" and
    "ep-2" each appear twice -- once at _layer==2 and once at _layer==3 --
    so len(result["memories"]) == 5 (topic + 2 summaries + 2 full) and each
    id's count is 2. The fix collapses each id to a single entry and keeps the
    fuller Layer-3 record, so each id appears at most once and the surviving
    record is the Layer-3 (richer) one.

    Setup: index.json with one topic so Layer 1 admits it (a distinct id,
    "impl", that must survive unchanged). _get_topic_summaries returns thin
    Layer-2 summaries; retrieve_task_aware returns richer Layer-3 records that
    reuse the same ids. Both layers get a generous budget so no trimming
    interferes with the dedup assertion.
    """
    from collections import Counter

    storage = _FakeStorage({
        "index.json": {"topics": [{"id": "impl", "summary": "auth work"}]}
    })
    retriever = MemoryRetrieval(storage=storage)

    # Layer 2: thin summaries keyed by episode id.
    summaries = [
        {"id": "ep-1", "topic": "auth", "goal": "add login",
         "outcome": "success", "_source": "episodic"},
        {"id": "ep-2", "topic": "auth", "goal": "add logout",
         "outcome": "success", "_source": "episodic"},
    ]
    # Layer 3: SAME ids, richer records (extra fields present only here).
    full = [
        {"id": "ep-1", "topic": "auth", "goal": "add login",
         "outcome": "success", "context": {"goal": "add login"},
         "learnings": ["use bcrypt"], "_source": "episodic"},
        {"id": "ep-2", "topic": "auth", "goal": "add logout",
         "outcome": "success", "context": {"goal": "add logout"},
         "_source": "episodic"},
    ]

    retriever._get_topic_summaries = lambda topics, query, weights: [
        dict(s) for s in summaries
    ]
    retriever.retrieve_task_aware = lambda context, top_k=10, **kw: [
        dict(f) for f in full
    ]
    retriever._estimate_total_available_tokens = lambda: 100_000

    # Generous budget so neither layer is trimmed; the only thing under test is
    # cross-layer dedup.
    result = retriever._progressive_retrieve(
        {"goal": "auth"}, 5000, "implementation"
    )
    memories = result["memories"]

    ids = [m.get("id") for m in memories if m.get("id") is not None]
    counts = Counter(ids)
    duped = {k: v for k, v in counts.items() if v > 1}
    assert not duped, (
        "no memory id may appear more than once across layers; the old code "
        "leaked Layer-2 summary + Layer-3 full for the same id. Duplicates: %r"
        % duped
    )

    # The Layer-1 topic id must survive unchanged (distinct id, no collision).
    assert "impl" in counts, "the Layer-1 topic id must be preserved"

    # For each reused id, the surviving record must be the fuller Layer-3 one.
    for reused in ("ep-1", "ep-2"):
        recs = [m for m in memories if m.get("id") == reused]
        assert len(recs) == 1, (
            "id %r must appear exactly once after dedup, got %d"
            % (reused, len(recs))
        )
        assert recs[0].get("_layer") == 3, (
            "the fuller Layer-3 record must win over the Layer-2 summary for "
            "id %r; got _layer=%r" % (reused, recs[0].get("_layer"))
        )

    # The richest fields survive: ep-1's Layer-3 record carries "learnings"
    # that the Layer-2 summary never had.
    ep1 = next(m for m in memories if m.get("id") == "ep-1")
    assert "learnings" in ep1, (
        "keeping the Layer-3 record must preserve its richer fields "
        "(learnings); the summary lacked them"
    )


def test_progressive_retrieve_keeps_records_without_id():
    """(wave-4 guard) Records lacking an id are never collapsed together.

    Mirrors _merge_results: only id-bearing records dedup; id-less records
    each keep their own slot. Two distinct id-less summaries must both survive.

    Non-vacuity: a naive dedup keyed on `m.get("id")` (which returns None for
    both) would collapse the two id-less records into one. The correct guard
    (skip dedup when id is None) keeps both.
    """
    storage = _FakeStorage({"index.json": {"topics": []}})
    retriever = MemoryRetrieval(storage=storage)

    summaries = [
        {"topic": "auth", "goal": "one", "_source": "episodic"},
        {"topic": "auth", "goal": "two", "_source": "episodic"},
    ]
    retriever._get_topic_summaries = lambda topics, query, weights: [
        dict(s) for s in summaries
    ]
    retriever.retrieve_task_aware = lambda context, top_k=10, **kw: []
    retriever._estimate_total_available_tokens = lambda: 100_000

    result = retriever._progressive_retrieve(
        {"goal": "auth"}, 5000, "implementation"
    )
    idless = [m for m in result["memories"] if m.get("id") is None]
    assert len(idless) == 2, (
        "both id-less records must survive (never collapsed together); got %d"
        % len(idless)
    )


def _run_all():
    tests = [
        test_anti_patterns_handles_none_element_and_null_field,
        test_semantic_search_handles_null_confidence,
        test_score_result_handles_null_importance_and_confidence,
        test_score_result_preserves_legitimate_zero_importance,
        test_layer2_admits_trimmed_summary_set_not_all_or_nothing,
        test_filter_relevant_topics_ranks_on_real_writer_keys,
        test_progressive_retrieve_dedups_ids_across_layers,
        test_progressive_retrieve_keeps_records_without_id,
    ]
    if not _DEPS_OK:
        print("SKIP: memory deps unavailable (%s: %s)"
              % (type(_DEPS_ERR).__name__, _DEPS_ERR))
        return 0

    failures = 0
    for fn in tests:
        try:
            fn()
            print("PASS: %s" % fn.__name__)
        except Exception as exc:  # noqa: BLE001 - report-and-continue for CLI run
            failures += 1
            print("FAIL: %s -> %s: %s" % (fn.__name__, type(exc).__name__, exc))
    print("\n%d passed, %d failed" % (len(tests) - failures, failures))
    return failures


if __name__ == "__main__":
    sys.exit(1 if _run_all() else 0)
