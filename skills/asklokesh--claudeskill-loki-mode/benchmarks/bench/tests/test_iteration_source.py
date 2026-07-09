"""Regression: bench iterations metric reads events.jsonl 'iteration_complete'
as the CANONICAL source (matching speed-benchmark.sh len(completes)), with
session.json only as a fallback. Prevents the two harnesses disagreeing, which
would corrupt every iterations before/after comparison in the loop-efficiency
bench. Run: python3 -m pytest benchmarks/bench/tests/test_iteration_source.py
(or: python3 benchmarks/bench/tests/test_iteration_source.py)."""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from adapters.loki import _read_iteration_count, _count_iteration_completes  # noqa: E402


def _write_events(d, types):
    with open(os.path.join(d, "events.jsonl"), "w") as f:
        for t in types:
            f.write(json.dumps({"type": t, "data": {}}) + "\n")


def test_events_jsonl_is_canonical_and_beats_session_json():
    d = tempfile.mkdtemp()
    try:
        _write_events(d, [
            "iteration_start", "iteration_complete",
            "iteration_start", "iteration_complete",
            "other", "iteration_complete",
        ])
        with open(os.path.join(d, "session.json"), "w") as f:
            json.dump({"iteration": 99}, f)  # must be ignored
        assert _count_iteration_completes(d) == 3
        assert _read_iteration_count(d) == 3
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_falls_back_to_session_json_when_no_events():
    d = tempfile.mkdtemp()
    try:
        with open(os.path.join(d, "session.json"), "w") as f:
            json.dump({"iteration": 7}, f)
        assert _count_iteration_completes(d) is None
        assert _read_iteration_count(d) == 7
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_empty_is_honest_none():
    d = tempfile.mkdtemp()
    try:
        assert _read_iteration_count(d) is None
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    test_events_jsonl_is_canonical_and_beats_session_json()
    test_falls_back_to_session_json_when_no_events()
    test_empty_is_honest_none()
    print("ALL GREEN")
