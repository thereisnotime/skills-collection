#!/usr/bin/env python3
"""
Orchestration State Manager — Centralized state.json for multi-agent workflow.

Provides file-based shared state so background agents (scorers, DOCX generators,
cover letter writers) can publish results and the main orchestrator can read them
without polling individual output files.

State file lives inside each application folder:
    applications/Takeda - Associate Medical Director/state.json

Thread safety:
    All writes use atomic read-modify-write via os.replace() on a temp file in the
    same directory.  This is safe on Windows (NTFS) and POSIX for concurrent writers.

No external dependencies — stdlib only (json, os, time, tempfile, datetime, argparse).

CLI usage (debugging):
    python orchestration_state.py --read <folder>
    python orchestration_state.py --read "applications/Takeda - Associate Medical Director"
"""

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# ─── Constants ────────────────────────────────────────────────────────────────

STATE_FILENAME = "state.json"

PHASES = (
    "init",
    "scoring_base",
    "writing",
    "scoring_tailored",
    "finalizing",
    "done",
)

# ─── Path Helper ──────────────────────────────────────────────────────────────


def state_path(folder: str) -> str:
    """Return the full path to state.json for a given application folder.

    Parameters
    ----------
    folder : str
        Application output folder (absolute or relative to cwd).

    Returns
    -------
    str
        Absolute path to the state.json file.
    """
    return str(Path(folder).resolve() / STATE_FILENAME)


# ─── Atomic I/O Primitives ───────────────────────────────────────────────────


def _atomic_write(filepath: str, data: dict) -> None:
    """Write *data* as JSON to *filepath* atomically.

    Strategy: write to a temp file in the **same directory** (guarantees same
    filesystem), then ``os.replace`` into place.  ``os.replace`` is atomic on
    both Windows NTFS and POSIX.
    """
    directory = os.path.dirname(filepath)
    os.makedirs(directory, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(suffix=".tmp", prefix=".state_", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, default=str)
        os.replace(tmp_path, filepath)
    except BaseException:
        # Clean up the temp file on any failure so we don't leave debris.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _read_json(filepath: str) -> dict:
    """Read and parse a JSON file.  Returns empty dict if file is missing or
    contains invalid JSON (defensive — never crash the orchestrator)."""
    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


# ─── Public API ───────────────────────────────────────────────────────────────


def init_state(
    folder: str,
    company: str,
    job_title: str,
    jd_path: str,
    base_template: str,
) -> dict:
    """Create a fresh state.json in *folder* with initial metadata.

    If a state.json already exists it is **overwritten** — call this once at
    the start of a new run.

    Parameters
    ----------
    folder : str
        Application output folder (e.g. ``applications/Takeda - Associate Medical Director``).
    company : str
        Company name.
    job_title : str
        Job title / position.
    jd_path : str
        Path to the saved job description text file.
    base_template : str
        Filename of the master resume used as the starting point.

    Returns
    -------
    dict
        The initial state dictionary that was written to disk.
    """
    state = {
        "meta": {
            "company": company,
            "job_title": job_title,
            "jd_path": jd_path,
            "base_template": base_template,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "phase": "init",
        },
        "errors": [],
    }
    _atomic_write(state_path(folder), state)
    return state


def read_state(folder: str) -> dict:
    """Read the current state.json.

    Returns
    -------
    dict
        Current state, or an empty dict if the file does not exist.
    """
    return _read_json(state_path(folder))


def update_state(folder: str, key: str, value) -> dict:
    """Atomically update a single top-level key in state.json.

    Performs a read-modify-write cycle with atomic rename so concurrent
    writers cannot corrupt the file.

    Parameters
    ----------
    folder : str
        Application output folder.
    key : str
        Top-level key to set (e.g. ``"tailored_resume_path"``).
    value
        Any JSON-serializable value.

    Returns
    -------
    dict
        The full state dict after the update.
    """
    fp = state_path(folder)
    state = _read_json(fp)
    state[key] = value
    _atomic_write(fp, state)
    return state


def merge_state(folder: str, updates: dict) -> dict:
    """Atomically merge multiple keys into state.json.

    For nested dicts (e.g. ``meta``), this does a **shallow merge** at the
    top-level key — nested dicts are replaced, not deep-merged.  Use
    ``update_state`` for single-key updates where you control the full value.

    Parameters
    ----------
    folder : str
        Application output folder.
    updates : dict
        Dictionary of key-value pairs to merge.

    Returns
    -------
    dict
        The full state dict after merging.
    """
    fp = state_path(folder)
    state = _read_json(fp)
    state.update(updates)
    _atomic_write(fp, state)
    return state


def set_phase(folder: str, phase: str) -> dict:
    """Update ``meta.phase`` to the given phase name.

    This is a convenience wrapper around the common pattern of updating the
    nested ``meta.phase`` field.

    Parameters
    ----------
    folder : str
        Application output folder.
    phase : str
        One of: ``init``, ``scoring_base``, ``writing``, ``scoring_tailored``,
        ``finalizing``, ``done``.

    Returns
    -------
    dict
        The full state dict after the update.

    Raises
    ------
    ValueError
        If *phase* is not one of the recognised phase names.
    """
    if phase not in PHASES:
        raise ValueError(
            f"Unknown phase {phase!r}. Valid phases: {', '.join(PHASES)}"
        )
    fp = state_path(folder)
    state = _read_json(fp)
    meta = state.get("meta", {})
    meta["phase"] = phase
    state["meta"] = meta
    _atomic_write(fp, state)
    return state


def log_error(folder: str, phase: str, error_msg: str) -> dict:
    """Append an error entry to the ``errors`` list in state.json.

    Parameters
    ----------
    folder : str
        Application output folder.
    phase : str
        Workflow phase where the error occurred (e.g. ``"scoring_base"``).
    error_msg : str
        Human-readable description of what went wrong.

    Returns
    -------
    dict
        The full state dict after appending the error.
    """
    fp = state_path(folder)
    state = _read_json(fp)
    errors = state.get("errors", [])
    errors.append({
        "phase": phase,
        "message": error_msg,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
    })
    state["errors"] = errors
    _atomic_write(fp, state)
    return state


def wait_for_keys(
    folder: str,
    keys: list,
    timeout: int = 120,
    poll_interval: float = 2.0,
) -> dict:
    """Block until all *keys* are present in state.json or *timeout* expires.

    Useful for the orchestrator to wait on background agents that write their
    results (e.g. ``base_scores``, ``cover_letter_path``) asynchronously.

    Parameters
    ----------
    folder : str
        Application output folder.
    keys : list[str]
        Top-level keys that must all be present.
    timeout : int
        Maximum seconds to wait (default 120).
    poll_interval : float
        Seconds between each poll (default 2.0).

    Returns
    -------
    dict
        The state dict once all keys are found.

    Raises
    ------
    TimeoutError
        If the keys are not all present within *timeout* seconds.
    """
    deadline = time.monotonic() + timeout
    while True:
        state = read_state(folder)
        if all(k in state for k in keys):
            return state
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            missing = [k for k in keys if k not in state]
            raise TimeoutError(
                f"Timed out after {timeout}s waiting for keys: {missing}"
            )
        time.sleep(min(poll_interval, remaining))


def cleanup_state(folder: str) -> bool:
    """Delete state.json after a successful run.

    Parameters
    ----------
    folder : str
        Application output folder.

    Returns
    -------
    bool
        True if the file was deleted, False if it did not exist.
    """
    fp = state_path(folder)
    try:
        os.remove(fp)
        return True
    except FileNotFoundError:
        return False


# ─── Score Helpers ────────────────────────────────────────────────────────────


def _parse_score_json(raw_json: str) -> dict:
    """Attempt to parse scorer output.

    Handles both clean JSON strings and strings with leading/trailing noise
    (e.g. log lines before the JSON blob).
    """
    # Fast path: raw string is valid JSON already.
    try:
        return json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        pass

    # Slow path: try to find the first { ... } block.
    if isinstance(raw_json, str):
        start = raw_json.find("{")
        end = raw_json.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw_json[start : end + 1])
            except json.JSONDecodeError:
                pass

    return {}


def write_score_results(folder: str, score_type: str, raw_json: str) -> dict:
    """Parse raw scorer JSON output and write to the appropriate state key.

    This is the main entry point for background scoring agents.  They call
    this once with their results and the state file is updated atomically.

    Parameters
    ----------
    folder : str
        Application output folder.
    score_type : str
        One of:

        * ``"base_ats"`` / ``"base_hr"`` — individual base scores.
        * ``"tailored_ats"`` / ``"tailored_hr"`` — individual tailored scores.
        * ``"base_both"`` — dict with ``ats`` and ``hr`` sub-keys for base.
        * ``"tailored_both"`` — dict with ``ats`` and ``hr`` sub-keys for tailored.
        * ``"base_combined"`` — /score/combined response (ATS + HR + LLM blended).
        * ``"tailored_combined"`` — /score/combined response (ATS + HR + LLM blended).

    raw_json : str
        Raw JSON string from the scorer CLI or API.  May contain surrounding
        log noise — the parser is lenient.

    Returns
    -------
    dict
        The full state dict after the update.

    Raises
    ------
    ValueError
        If *score_type* is not recognised.
    """
    valid_types = (
        "base_ats", "base_hr",
        "tailored_ats", "tailored_hr",
        "base_both", "tailored_both",
        "base_combined", "tailored_combined",
    )
    if score_type not in valid_types:
        raise ValueError(
            f"Unknown score_type {score_type!r}. Valid types: {', '.join(valid_types)}"
        )

    parsed = _parse_score_json(raw_json)
    if not parsed:
        return log_error(
            folder,
            f"parse_{score_type}",
            f"Failed to parse scorer JSON for {score_type}",
        )

    fp = state_path(folder)
    state = _read_json(fp)

    # Determine which top-level key and sub-key(s) to write.
    if score_type.startswith("base_"):
        state_key = "base_scores"
    else:
        state_key = "tailored_scores"

    scores = state.get(state_key, {})

    if score_type.endswith("_combined"):
        # /score/combined returns: combined_ats, combined_hr, rules_ats, rules_hr, llm, blend_details
        scores["rules_ats"] = parsed.get("rules_ats", {})
        scores["rules_hr"] = parsed.get("rules_hr", {})
        scores["llm"] = parsed.get("llm", {})
        scores["combined_ats"] = parsed.get("combined_ats", 0)
        scores["combined_hr"] = parsed.get("combined_hr", 0)
        scores["blend_details"] = parsed.get("blend_details", {})
        # Also set top-level ats/hr to the combined values for backward compat
        scores["ats"] = {"total": parsed.get("combined_ats", 0)}
        scores["hr"] = {"total": parsed.get("combined_hr", 0)}
    elif score_type.endswith("_both"):
        # Expect parsed dict to have "ats" and "hr" sub-keys.
        if "ats" in parsed:
            scores["ats"] = parsed["ats"]
        if "hr" in parsed:
            scores["hr"] = parsed["hr"]
        # If the parsed dict doesn't have those keys, store it wholesale.
        if "ats" not in parsed and "hr" not in parsed:
            scores.update(parsed)
    elif score_type.endswith("_ats"):
        scores["ats"] = parsed
    elif score_type.endswith("_hr"):
        scores["hr"] = parsed

    state[state_key] = scores
    _atomic_write(fp, state)
    return state


# ─── CLI for debugging ───────────────────────────────────────────────────────


def _cli() -> None:
    """Minimal CLI to inspect state.json from the terminal."""
    parser = argparse.ArgumentParser(
        description="Inspect orchestration state.json for a given application folder.",
    )
    parser.add_argument(
        "--read",
        metavar="FOLDER",
        help="Application folder to read state from.",
    )
    parser.add_argument(
        "--keys",
        metavar="KEY",
        nargs="*",
        help="Only print these top-level keys (default: print everything).",
    )
    parser.add_argument(
        "--phase",
        metavar="FOLDER",
        help="Print only the current phase for the given folder.",
    )

    args = parser.parse_args()

    if args.phase:
        state = read_state(args.phase)
        phase = state.get("meta", {}).get("phase", "<no state found>")
        print(phase)
        return

    if not args.read:
        parser.print_help()
        sys.exit(1)

    state = read_state(args.read)
    if not state:
        print(f"No state.json found in: {args.read}", file=sys.stderr)
        sys.exit(1)

    if args.keys:
        filtered = {k: state[k] for k in args.keys if k in state}
        missing = [k for k in args.keys if k not in state]
        print(json.dumps(filtered, indent=2, default=str))
        if missing:
            print(f"\nKeys not found: {missing}", file=sys.stderr)
    else:
        print(json.dumps(state, indent=2, default=str))


if __name__ == "__main__":
    _cli()
