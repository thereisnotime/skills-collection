"""
Unit tests for the failure-memory ErrorEntry mapping (Connector A).

Implementation: autonomy/run.sh `auto_capture_episode`, the crash-field ->
ErrorEntry mapping inside the Python heredoc (search for "CONNECTOR A").
Plan: docs/FAILURE-MEMORY-PLAN.md, "New tests" -> Test 3 (mapping unit) and
the ErrorEntry field-mapping table.

The mapping lives as inline Python-in-bash inside run.sh, so it is not directly
importable. This module therefore:

  1. Mirrors the mapping as a pure function `map_crash_to_error_entry` whose body
     is a line-for-line transcription of the run.sh heredoc, and tests it against
     every crash shape (IterationError, Friction, ScrubError-minimal, and the
     no-file fallback).
  2. Adds a DRIFT GUARD (`test_run_sh_mapping_lines_present`) that asserts the
     load-bearing lines still exist verbatim in run.sh. If the implementation
     changes, the mirror would silently diverge and "pass" while proving nothing;
     the drift guard fails instead, forcing this file to be updated in lockstep.

The privacy guarantee is also asserted here: with non-sensitive inputs (the
whitelisted crash fields or the phase/exit fallback) the composed message
contains no home path, email, or IP.
"""

import re
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from memory.schemas import ErrorEntry  # noqa: E402


# ---------------------------------------------------------------------------
# Mirror of the run.sh Connector A mapping. Transcribed line-for-line from
# autonomy/run.sh (the `if ... outcome == 'failure':` block). Kept honest by
# test_run_sh_mapping_lines_present below.
# ---------------------------------------------------------------------------
def map_crash_to_error_entry(crash, rarv_phase, exit_code):
    """Return the ErrorEntry that run.sh would attach.

    `crash` is the parsed scrubbed crash dict, or None to model "no crash file"
    (telemetry off). `rarv_phase` / `exit_code` are the iteration's values.
    """
    _err_type = "IterationError"
    _message = ""
    if crash is not None:
        _err_type = crash.get("error_class") or crash.get("friction_kind") or "IterationError"
        _sig = crash.get("stack_signature") or []
        _sig_str = " > ".join(str(s) for s in _sig[:5]) if isinstance(_sig, list) else str(_sig)
        _phase = crash.get("rarv_phase") or rarv_phase or ""
        _parts = []
        if _phase:
            _parts.append("phase=" + str(_phase))
        if crash.get("friction_kind"):
            _parts.append("friction=" + str(crash["friction_kind"]))
        if _sig_str:
            _parts.append("signature: " + _sig_str)
        if crash.get("fingerprint"):
            _parts.append("fp=" + str(crash["fingerprint"])[:12])
        _message = "; ".join(_parts) or "iteration failed"
    else:
        _message = "phase=" + str(rarv_phase or "") + "; exit=" + str(exit_code)
    return ErrorEntry(error_type=str(_err_type), message=_message, resolution="")


# ---------------------------------------------------------------------------
# Crash-shape fixtures (post-scrub whitelist dicts, as written to disk).
# ---------------------------------------------------------------------------
def _iteration_error_crash():
    return {
        "error_class": "IterationError",
        "stack_signature": ["handle", "parse", "loads"],
        "rarv_phase": "ACT",
        "exit_code": 1,
        "friction_kind": None,
        "fingerprint": "d9e1058f4fe38c84f10d37c9c5b28c6c",
    }


def _friction_crash():
    return {
        "error_class": "Friction",
        "friction_kind": "timeout",
        "stack_signature": ["wait", "poll"],
        "rarv_phase": "VERIFY",
        "exit_code": 1,
        "fingerprint": "abc123def456789",
    }


def _scruberror_minimal_crash():
    # The minimal shape crash_capture writes when scrub fails: no fingerprint,
    # no stack_signature, no rarv_phase.
    return {
        "error_class": "ScrubError",
        "rules_version": "1.0",
        "redactions_count": 0,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_iteration_error_mapping():
    e = map_crash_to_error_entry(_iteration_error_crash(), "ACT", 1)
    assert e.error_type == "IterationError"
    assert e.resolution == ""
    # message is composed from whitelisted fields: phase, signature, fp.
    assert "phase=ACT" in e.message
    assert "signature: handle > parse > loads" in e.message
    assert "fp=d9e1058f4fe3" in e.message  # first 12 chars only
    assert "friction=" not in e.message  # friction_kind is None for this shape


def test_fingerprint_truncated_to_12_chars():
    e = map_crash_to_error_entry(_iteration_error_crash(), "ACT", 1)
    m = re.search(r"fp=([0-9a-f]+)", e.message)
    assert m is not None
    assert len(m.group(1)) == 12


def test_signature_capped_at_five_frames():
    crash = _iteration_error_crash()
    crash["stack_signature"] = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"]
    e = map_crash_to_error_entry(crash, "ACT", 1)
    assert "f5" in e.message
    assert "f6" not in e.message  # [:5] cap


def test_friction_error_type_and_kind():
    e = map_crash_to_error_entry(_friction_crash(), "ACT", 1)
    # error_class wins for error_type ("Friction").
    assert e.error_type == "Friction"
    # friction_kind is surfaced inside the message.
    assert "friction=timeout" in e.message
    # rarv_phase from the crash file ("VERIFY") wins over the passed phase.
    assert "phase=VERIFY" in e.message


def test_error_class_absent_falls_back_to_friction_kind():
    crash = {"friction_kind": "lock_contention", "rarv_phase": "ACT", "fingerprint": "x" * 20}
    e = map_crash_to_error_entry(crash, "ACT", 1)
    # error_class missing -> friction_kind is the error_type.
    assert e.error_type == "lock_contention"


def test_scruberror_minimal_shape():
    # No fingerprint, no signature, no phase in the crash file; the passed
    # rarv_phase fills in. Message must still be non-empty and valid.
    e = map_crash_to_error_entry(_scruberror_minimal_crash(), "REASON", 1)
    assert e.error_type == "ScrubError"
    assert "phase=REASON" in e.message
    assert "signature:" not in e.message
    assert "fp=" not in e.message
    assert e.message != ""


def test_no_crash_file_fallback():
    # Telemetry-off path: crash is None.
    e = map_crash_to_error_entry(None, "VERIFY", 1)
    assert e.error_type == "IterationError"
    assert e.message == "phase=VERIFY; exit=1"
    assert e.resolution == ""


def test_fallback_uses_only_non_sensitive_fields():
    # The fallback must reference ONLY phase + exit, nothing else.
    e = map_crash_to_error_entry(None, "ACT", 42)
    assert e.message == "phase=ACT; exit=42"


def test_empty_resolution_always():
    for crash in (_iteration_error_crash(), _friction_crash(),
                  _scruberror_minimal_crash(), None):
        e = map_crash_to_error_entry(crash, "ACT", 1)
        assert e.resolution == ""


@pytest.mark.parametrize("crash", [
    _iteration_error_crash(),
    _friction_crash(),
    _scruberror_minimal_crash(),
    None,
])
def test_no_sensitive_data_in_message(crash):
    # All inputs are whitelisted or the non-sensitive fallback, so the composed
    # message must never carry a home path, email, or IP.
    e = map_crash_to_error_entry(crash, "ACT", 1)
    blob = f"{e.error_type} {e.message} {e.resolution}"
    assert "/Users/" not in blob
    assert "/home/" not in blob
    assert not re.search(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", blob)
    assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", blob)


def test_run_sh_mapping_lines_present():
    """Drift guard: the mirror above is only valid if run.sh still contains the
    load-bearing mapping lines. If the implementation changes, update both."""
    run_sh = (_REPO_ROOT / "autonomy" / "run.sh").read_text(encoding="utf-8")
    required = [
        "if os.environ.get('_LOKI_FAILURE_MEMORY', '1') != '0' and outcome == 'failure':",
        "_err_type = (_crash.get('error_class')",
        "or _crash.get('friction_kind') or 'IterationError')",
        "_sig_str = ' > '.join(str(s) for s in _sig[:5])",
        "_parts.append('friction=' + str(_crash['friction_kind']))",
        "_parts.append('signature: ' + _sig_str)",
        "_parts.append('fp=' + str(_crash['fingerprint'])[:12])",
        "_message = '; '.join(_parts) or 'iteration failed'",
        "_message = 'phase=' + str(rarv_phase or '') + '; exit=' + str(_ec)",
        "trace.errors_encountered.append(ErrorEntry(",
    ]
    missing = [line for line in required if line not in run_sh]
    assert not missing, (
        "Connector A mapping in run.sh changed; the mirror in this test is now "
        "stale. Update map_crash_to_error_entry to match. Missing lines: "
        + repr(missing)
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
