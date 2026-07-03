#!/usr/bin/env python3
"""benchmarks/bench/mergeability_score.py -- scored mergeability for change-mode.

This EXTENDS the R2 change-mode harness (runner.py + bench_schema.py) with a
SCORED verdict on top of its boolean success. It does not fork the harness: it
reuses runner.prepare_workdir / invoke_adapter / _apply_overlay / _run_cmd and
adds a rubric-weighted score computed ONLY from a held-out grader's per-check
output.

WHY a scored layer at all:
  SWE-bench-style tasks answer "did the one test flip?" -- pass/fail. A code
  reviewer's real question is MERGEABILITY: "would a maintainer merge this?".
  That is not binary. A maintainer BLOCKS on some things (a broken build, a
  missing FAIL_TO_PASS test, a security regression) and DOCKS points on others
  (style, a missing edge case, a weak docstring). This module encodes that:

    score = 0                         if ANY blocker check fails
          = sum(weight of PASSED non-blocker checks) / sum(all non-blocker weights)
                                       otherwise (a value in [0, 1])

CREDIBILITY INVARIANT (the whole reason this file exists):
  The scorer is a PURE function of (rubric definitions, held-out grader results).
  It STRUCTURALLY cannot read the adapter-output, the council verdict, an
  LLM-judge, or any Loki self-report. `score_from_results` refuses a results
  dict that smuggles in a judgment key (mirrors bench_schema.ADAPTER_FORBIDDEN
  _KEYS). That is what makes "Loki NEVER grades itself" true here too: the only
  inputs are the maintainer's rubric (authored offline, held out from the agent,
  folded into task_hash) and the pass/fail a grader script produced by running
  held-out checks OUTSIDE the agent.

The rubric lives in task.json under the `rubric` key (unknown to
validate_task_spec, so it does not break the frozen validator; folded into the
task_hash because compute_task_hash hashes the whole spec dict -> reproducible +
held out from the agent, which only ever sees `prompt`). The held-out grader
(acceptance/rubric.py) runs each check and emits {"checks": {id: bool, ...}} on
stdout. This module runs that grader itself (the runner's grade() sends stdout
to DEVNULL and rmtree's the workdir, so we cannot scavenge it after the fact),
captures its JSON, and scores it.

CI-safe + deterministic: score_from_results is pure stdlib arithmetic over a
fixed dict; two calls on the same input are byte-identical (not "within
tolerance" -- exactly equal). Tolerance only matters when a REAL engine run
introduces stochasticity across trials; the instrument itself has none.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from typing import Any, Dict, List, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import runner  # noqa: E402  (reuse prepare_workdir/invoke_adapter/_apply_overlay/_run_cmd)


# ---------------------------------------------------------------------------
# rubric shape (authored by the maintainer, held out from the agent)
# ---------------------------------------------------------------------------
# task.json["rubric"] is a list of check definitions:
#   [{"id": "fail_to_pass", "weight": 0, "blocker": true,
#     "desc": "the reverse-classical FAIL_TO_PASS test passes"},
#    {"id": "handles_empty", "weight": 3, "blocker": false, "desc": "..."},
#    ...]
#
# A blocker's weight is IRRELEVANT to the numeric score (a blocker gates to 0,
# it does not contribute points); by convention we set it to 0 to make that
# explicit. Non-blocker weights are positive and define the weighted sum.

RUBRIC_REQUIRED_KEYS = ("id", "weight", "blocker")

# The scorer is forbidden from consuming any of these -- the same judgment keys
# an adapter may never emit, plus the words a rigged scorer would sneak in. If a
# results dict carries one, score_from_results refuses it: outcome must come from
# the held-out grader's per-CHECK booleans, never a pre-baked verdict.
FORBIDDEN_RESULT_KEYS = frozenset({
    "score", "success", "passed", "verdict", "graded", "won", "winner",
    "council", "rarv", "llm_judge", "self_report", "adapter",
})


class RubricError(ValueError):
    """Raised when a rubric or a results dict is malformed / smuggles judgment."""


def validate_rubric(rubric: Any) -> List[str]:
    """Return a list of problems with a rubric definition. Empty == valid."""
    errs: List[str] = []
    if not isinstance(rubric, list) or not rubric:
        return ["rubric must be a non-empty list of check definitions"]
    seen_ids = set()
    n_nonblocker_weight = 0.0
    for i, chk in enumerate(rubric):
        if not isinstance(chk, dict):
            errs.append("rubric[%d] must be an object" % i)
            continue
        for k in RUBRIC_REQUIRED_KEYS:
            if k not in chk:
                errs.append("rubric[%d] missing required key: %s" % (i, k))
        cid = chk.get("id")
        if not isinstance(cid, str) or not cid.strip():
            errs.append("rubric[%d].id must be a non-empty string" % i)
        elif cid in seen_ids:
            errs.append("rubric[%d].id duplicate: %r" % (i, cid))
        else:
            seen_ids.add(cid)
        if "blocker" in chk and not isinstance(chk["blocker"], bool):
            errs.append("rubric[%d].blocker must be a bool" % i)
        w = chk.get("weight")
        if not isinstance(w, (int, float)) or isinstance(w, bool):
            errs.append("rubric[%d].weight must be a number" % i)
        elif not chk.get("blocker", False):
            if w < 0:
                errs.append("rubric[%d].weight (non-blocker) must be >= 0" % i)
            n_nonblocker_weight += w
    if not errs and n_nonblocker_weight <= 0:
        errs.append("rubric must have at least one non-blocker check with weight > 0")
    return errs


# ---------------------------------------------------------------------------
# the PURE scorer -- the deterministic, CI-safe heart of this module
# ---------------------------------------------------------------------------

def score_from_results(rubric: List[Dict[str, Any]],
                       check_results: Dict[str, Any]) -> Dict[str, Any]:
    """Compute a mergeability score from rubric weights + held-out check results.

    Args:
      rubric:        the maintainer's rubric (list of {id, weight, blocker}).
      check_results: {check_id: bool} produced by the HELD-OUT grader by running
                     each check on the agent's produced repo state. A missing
                     check id is treated as a FAILURE (conservative: an absent
                     signal is never counted as a pass).

    Returns:
      {
        "score": float in [0, 1],       # 0 if any blocker fails
        "blocked": bool,                # true iff >=1 blocker check failed
        "blocker_failures": [id, ...],  # which blockers failed
        "per_check": [{id, blocker, weight, passed, contributed}, ...],
        "nonblocker_weight_total": float,
        "nonblocker_weight_earned": float,
      }

    PURE: no I/O, no adapter, no council. Deterministic -- identical input yields
    a byte-identical dict. This is the structural guarantee that Loki does not
    grade itself: the ONLY inputs are the offline rubric and a grader's booleans.
    """
    rerrs = validate_rubric(rubric)
    if rerrs:
        raise RubricError("invalid rubric: " + "; ".join(rerrs))
    if not isinstance(check_results, dict):
        raise RubricError("check_results must be a dict of {check_id: bool}")
    smuggled = sorted(k for k in check_results.keys() if k in FORBIDDEN_RESULT_KEYS)
    if smuggled:
        raise RubricError(
            "check_results MUST carry only per-check booleans, not a pre-baked "
            "verdict; forbidden keys present: " + ", ".join(smuggled)
        )

    blocker_failures: List[str] = []
    per_check: List[Dict[str, Any]] = []
    weight_total = 0.0
    weight_earned = 0.0

    for chk in rubric:
        cid = chk["id"]
        blocker = bool(chk.get("blocker", False))
        weight = float(chk.get("weight", 0))
        # A missing result is a FAILURE (never silently a pass).
        passed = check_results.get(cid) is True
        contributed = 0.0
        if blocker:
            if not passed:
                blocker_failures.append(cid)
        else:
            weight_total += weight
            if passed:
                weight_earned += weight
                contributed = weight
        per_check.append({
            "id": cid,
            "blocker": blocker,
            "weight": weight,
            "passed": passed,
            "contributed": contributed,
        })

    blocked = len(blocker_failures) > 0
    if blocked:
        score = 0.0
    elif weight_total > 0:
        score = weight_earned / weight_total
    else:
        # validate_rubric guarantees weight_total > 0, so this is unreachable;
        # kept as a defensive, non-crashing fallback.
        score = 0.0

    return {
        "score": round(score, 6),
        "blocked": blocked,
        "blocker_failures": blocker_failures,
        "per_check": per_check,
        "nonblocker_weight_total": round(weight_total, 6),
        "nonblocker_weight_earned": round(weight_earned, 6),
    }


# ---------------------------------------------------------------------------
# held-out grader invocation -- run the rubric.py the agent never saw
# ---------------------------------------------------------------------------

def run_held_out_grader(workdir: str, spec: Dict[str, Any],
                        task_dir: str) -> Dict[str, Any]:
    """Overlay the held-out grader, run it, and return its {check_id: bool} map.

    This mirrors runner.grade's overlay-then-run flow but CAPTURES stdout (the
    per-check JSON), which runner.grade discards. It never sees adapter-output.

    The grader command comes from spec["acceptance"]["grader_cmd"] if present,
    else defaults to running the overlaid `rubric.py` with the same interpreter.
    The grader MUST print a JSON object {"checks": {id: bool, ...}} on stdout.
    """
    acc = spec.get("acceptance", {})
    timeout_s = int(acc.get("timeout_s", 300))

    # Apply the held-out overlay (rubric.py + any held-out tests) into workdir.
    overlay = acc.get("overlay")
    if isinstance(overlay, str) and overlay.strip():
        overlay_dir = os.path.realpath(os.path.join(task_dir, overlay))
        if os.path.isdir(overlay_dir):
            runner._apply_overlay(workdir, overlay_dir)

    # Optional non-gating setup (deps/build). Its exit code does not matter.
    setup_cmd = acc.get("setup_cmd")
    if isinstance(setup_cmd, str) and setup_cmd.strip():
        runner._run_cmd(setup_cmd, workdir, timeout_s)

    grader_cmd = acc.get("grader_cmd") or "%s rubric.py" % _grader_python()
    import subprocess
    try:
        proc = subprocess.run(
            grader_cmd, cwd=workdir, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=timeout_s,
        )
        out = proc.stdout or ""
    except Exception:
        out = ""

    checks = _parse_grader_output(out)
    return checks


def _grader_python() -> str:
    """Interpreter for the held-out grader. Prefer the current one (CI-safe)."""
    return sys.executable or "python3"


def _parse_grader_output(out: str) -> Dict[str, bool]:
    """Parse the grader's stdout for {"checks": {id: bool}}.

    Tolerant: the grader may print log lines before the JSON. We take the LAST
    line that parses as a JSON object carrying a "checks" dict. An unparseable
    output yields {} (every check then counts as a failure -> conservative).
    """
    result: Dict[str, bool] = {}
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("checks"), dict):
            for k, v in obj["checks"].items():
                result[str(k)] = (v is True)
            return result
    return result


# ---------------------------------------------------------------------------
# end-to-end: run an adapter on a mergeability task and score it
# ---------------------------------------------------------------------------

def score_task(task_path: str, adapter_name: str, *,
               trials: int = 1, model: Optional[str] = None,
               adapter: Any = None, runner_fn: Any = None,
               keep_workdir: bool = False) -> Dict[str, Any]:
    """Run one adapter on a mergeability task for N trials and score each.

    Reuses the R2 runner's plumbing (load/validate/prepare/invoke). For each
    trial it invokes the adapter, then runs the HELD-OUT grader itself (to
    capture per-check JSON), then scores with the pure score_from_results.

    Returns a result-row-like dict with a `mergeability` block per trial and a
    headline summary. NEVER reads adapter-output for scoring.
    """
    spec = runner.load_task(task_path)
    rubric = spec.get("rubric")
    rerrs = validate_rubric(rubric)
    if rerrs:
        raise RubricError("task %s has invalid rubric: %s"
                          % (task_path, "; ".join(rerrs)))

    fixture_dir = runner.resolve_fixture_dir(task_path, spec)
    task_dir = os.path.dirname(os.path.abspath(task_path))
    import bench_schema as schema
    task_hash = schema.compute_task_hash(spec, fixture_dir)
    used_model = model or spec.get("default_model", "")

    if adapter is None:
        adapter = runner.load_adapter(adapter_name)

    agent_timeout = int(spec.get("agent_timeout_s", 1800))
    trial_scores: List[Dict[str, Any]] = []
    for i in range(1, max(1, trials) + 1):
        workdir = runner.prepare_workdir(fixture_dir, adapter_name)
        try:
            # Adapter runs; we IGNORE its output for scoring (validated only to
            # enforce the no-judgment boundary).
            runner.invoke_adapter(adapter, workdir, spec, used_model,
                                  agent_timeout, runner_fn=runner_fn)
            checks = run_held_out_grader(workdir, spec, task_dir)
            scored = score_from_results(rubric, checks)
            scored["trial"] = i
            scored["checks_raw"] = checks
            trial_scores.append(scored)
        finally:
            if not keep_workdir:
                shutil.rmtree(workdir, ignore_errors=True)

    return {
        "schema_version": schema.SCHEMA_VERSION,
        "task_id": spec["id"],
        "task_path": runner._store_task_path(task_path),
        "task_hash": task_hash,
        "tool": adapter_name,
        "model": used_model,
        "mergeability_trials": trial_scores,
        "summary": summarize_scores(trial_scores),
    }


def summarize_scores(trial_scores: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-trial mergeability scores into a headline.

    mergeability_pct is the mean score across trials as a percentage. blocked_
    any is true if any trial hit a blocker. Deterministic given the input.
    """
    n = len(trial_scores)
    scores = [t["score"] for t in trial_scores]
    mean = (sum(scores) / n) if n else 0.0
    return {
        "n_trials": n,
        "mergeability_score_mean": round(mean, 6),
        "mergeability_pct": round(mean * 100.0, 4),
        "score_min": round(min(scores), 6) if scores else 0.0,
        "score_max": round(max(scores), 6) if scores else 0.0,
        "blocked_any": any(t["blocked"] for t in trial_scores),
        "n_blocked_trials": sum(1 for t in trial_scores if t["blocked"]),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: List[str]) -> int:
    import argparse
    p = argparse.ArgumentParser(
        prog="mergeability-score",
        description="Scored mergeability for change-mode tasks (0 on any blocker,"
                    " else weighted non-blocker sum; scored only from held-out"
                    " grader output).")
    sub = p.add_subparsers(dest="cmd")

    ps = sub.add_parser("score", help="run an adapter on a task and score it")
    ps.add_argument("task")
    ps.add_argument("--adapter", default="loki")
    ps.add_argument("--trials", type=int, default=1)
    ps.add_argument("--model", default=None)
    ps.add_argument("--out", default=None)

    pv = sub.add_parser("validate-rubric", help="validate a task's rubric block")
    pv.add_argument("task")

    args = p.parse_args(argv)

    if args.cmd == "score":
        row = score_task(args.task, args.adapter, trials=args.trials,
                         model=args.model)
        payload = json.dumps(row, indent=2, sort_keys=True)
        if args.out:
            with open(args.out, "w") as fh:
                fh.write(payload + "\n")
            print("wrote %s" % args.out)
        else:
            print(payload)
        return 0

    if args.cmd == "validate-rubric":
        spec = runner.load_task(args.task)
        errs = validate_rubric(spec.get("rubric"))
        if errs:
            print("INVALID rubric: " + "; ".join(errs))
            return 1
        print("OK: rubric for %s (%d checks)"
              % (spec.get("id", "<no id>"), len(spec["rubric"])))
        return 0

    p.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
