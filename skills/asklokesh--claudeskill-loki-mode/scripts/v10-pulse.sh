#!/usr/bin/env bash
# scripts/v10-pulse.sh -- deterministic anti-drift status/violation reporter
# for the v10 swarm (docs/v10/SWARM.md, docs/v10/BOARD.md, docs/v10/CONTROL.md).
# No model calls. Prints a status block to stdout, then a NEXT ACTIONS block
# if any VIOLATION fired.
#
# Exit codes:
#   0 -- clean (no violation, every metric known)
#   1 -- at least one VIOLATION fired
#   2 -- no VIOLATION, but at least one metric came back UNKNOWN (a crashed
#        or timed-out sub-check must never read as clean)
# ponytail: a hook wrapper (`bash scripts/v10-pulse.sh || true`) is a
# separate step's job, not this script's -- this script's own contract only
# needs to be honest about 0 vs 1 vs 2.
#
# This is a thin bash wrapper around one embedded python3 -E program: all
# parsing, date math, stat calls and subprocess timeouts live there, so bash
# 3.2 (macOS default /bin/bash) is trivially safe -- there is almost nothing
# here for a bashism to break.
#
# Every external data source is env-var overridable, matching this repo's
# ${VAR:-default} convention (see autonomy/run.sh: LOKI_SESSION_MODEL,
# LOKI_ORIGINAL_SCRIPT_DIR), so tests fully control inputs with no real
# npm/gh/git network or wall-clock dependency:
#   BOARD_MD            path to BOARD.md (default: docs/v10/BOARD.md)
#   CONTROL_MD          path to CONTROL.md (default: docs/v10/CONTROL.md)
#   PULSE_REPO_ROOT     repo root for git operations (default: this repo)
#   PULSE_MAIN_REF      the ref to treat as "main" (default: main) -- used for
#                       CI status, unreleased-merge age and the moat baseline,
#                       so this script gives an honest answer about the swarm's
#                       main line even when run from a builder worktree whose
#                       own HEAD is a feature branch.
#   PULSE_NPM_CMD       npm command to run (default: npm view loki-mode time --json)
#   PULSE_GH_CMD        gh command to run (default: gh run list --branch main
#                       --commit <main-sha> --json status,conclusion,workflowName --limit 20)
#   PULSE_WORKTREE_CMD  git worktree list command (default: git worktree list --porcelain)
#   PULSE_MOAT_RESULT   path to a file holding the real captured stdout of a
#                       `bash tests/moat/run.sh` run (its own summary lines
#                       are parsed: "moat: N of 9 properties proven" and, on
#                       failure, "moat suite: FAIL (K rule failure(s))").
#                       This is the ONLY source MOAT_REGRESSION trusts: the
#                       pending.txt-derived count is ratchet-only (its id set
#                       can only shrink release over release, per
#                       tests/moat/run.sh's own contract) and so can never by
#                       itself register a real regression -- it is shown as
#                       informational context only. With no PULSE_MOAT_RESULT
#                       (or an unreadable/unparseable one), MOAT_REGRESSION
#                       reports UNKNOWN rather than silently falling back to
#                       the pending-derived count.
#                       SHA pinning (BACKLOG 133): a result file alone is not
#                       enough -- it must also prove which commit it was
#                       measured against. The writer MUST also write a
#                       sidecar file at "<PULSE_MOAT_RESULT>.sha" holding
#                       exactly the full 40-char SHA the tree was at when
#                       `tests/moat/run.sh` was run (no trailing content, no
#                       short SHA, no ref name -- compared byte-for-byte,
#                       never re-resolved through git). Capture the SHA and
#                       require a clean tree BEFORE running the suite, not
#                       after: `tests/moat/run.sh` takes minutes, in which
#                       time HEAD can move (another process, a background
#                       swarm run) and a dirty tree means HEAD's SHA does not
#                       actually describe what was measured. Typical use:
#                         git diff --quiet HEAD || exit 1
#                         moat_sha="$(git rev-parse HEAD)"
#                         bash tests/moat/run.sh > moat-result.txt
#                         printf '%s\n' "$moat_sha" > moat-result.txt.sha
#                         PULSE_MOAT_RESULT=moat-result.txt bash scripts/v10-pulse.sh
#                       This script compares that sidecar's contents against
#                       PULSE_MAIN_REF's current resolved HEAD. A missing/
#                       empty sidecar (an older-style capture with no
#                       provenance) or a mismatched SHA (a stale capture from
#                       an earlier commit) both report UNKNOWN with a clear
#                       reason -- never a confident clean/regression verdict
#                       from input that cannot be proven current.
#   PULSE_SWARM_START   swarm start time override, epoch seconds or ISO8601
#   PULSE_NOW           "now" override, epoch seconds or ISO8601
#   PULSE_PYTHON        python3 interpreter to use (default: python3)
#   PULSE_DEADLINE_SECS network-call time budget in seconds for npm+gh
#                       together (default: 6; git/worktree calls use a
#                       separate small fixed cap so the 10-second script
#                       budget holds regardless of this value),
#                       shared across every npm/gh/git-worktree call so the
#                       10-second script budget cannot be exceeded by adding
#                       up several full per-call timeouts.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

PULSE_PYTHON="${PULSE_PYTHON:-python3}"
PULSE_REPO_ROOT="${PULSE_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
BOARD_MD="${BOARD_MD:-$DEFAULT_REPO_ROOT/docs/v10/BOARD.md}"
CONTROL_MD="${CONTROL_MD:-$DEFAULT_REPO_ROOT/docs/v10/CONTROL.md}"

export PULSE_REPO_ROOT BOARD_MD CONTROL_MD
export PULSE_MAIN_REF="${PULSE_MAIN_REF:-main}"
export PULSE_NPM_CMD="${PULSE_NPM_CMD:-}"
export PULSE_GH_CMD="${PULSE_GH_CMD:-}"
export PULSE_WORKTREE_CMD="${PULSE_WORKTREE_CMD:-}"
export PULSE_MOAT_RESULT="${PULSE_MOAT_RESULT:-}"
export PULSE_SWARM_START="${PULSE_SWARM_START:-}"
export PULSE_NOW="${PULSE_NOW:-}"
export PULSE_DEADLINE_SECS="${PULSE_DEADLINE_SECS:-6}"

# `-` (read the program from stdin) rather than a real path: sys.path[0] is
# then '' as usual for stdin programs, and the scrub at the very top of the
# heredoc (D7 pattern: never trust an importable cwd or env-injected
# PYTHONPATH) removes it before any other import runs.
exec "$PULSE_PYTHON" -E - <<'PULSE_PY'
import sys, os
sys.path = [p for p in sys.path if p not in ("", os.getcwd())]


def _pulse_excepthook(exc_type, exc, tb):
    # Every check below routes crashes through safe() into UNKNOWN, but
    # module-level code between those calls (an env-var parse, a shlex.split
    # on an operator-supplied command string, the ci_status/board name
    # bindings) is NOT inside any function safe() can wrap. An uncaught
    # exception there would otherwise be a bare traceback and exit 1 -- a
    # false VIOLATION for a script bug, not a real one. This is the
    # backstop: never let a crash anywhere in this program read as anything
    # but exit 2 (could not check).
    try:
        print("PULSE ERROR: %s: %s" % (exc_type.__name__, exc))
        sys.stdout.flush()
    except Exception:
        pass
    os._exit(2)


sys.excepthook = _pulse_excepthook

import calendar
import json
import re
import shlex
import signal
import subprocess
import time

REPO_ROOT = os.environ["PULSE_REPO_ROOT"]
BOARD_MD = os.environ["BOARD_MD"]
CONTROL_MD = os.environ["CONTROL_MD"]
MAIN_REF = os.environ.get("PULSE_MAIN_REF", "main") or "main"

# Two deadlines, not one shared pool. A single pool meant a hung npm call
# alone (with nothing else slow) spent the ENTIRE budget and left every
# later check (gh, git describe/log/show, worktree list) returned as an
# instant TIMEOUT with no process ever started -- CI_RED, MOAT_REGRESSION,
# UNRELEASED_MERGE and IDLE_BUILDERS all silently going dark behind one slow
# network call. Instead:
#   NETWORK_DEADLINE -- npm and gh (the only network calls) run concurrently
#     (Popen now, communicate later) against this shared wall-clock deadline,
#     so one hanging does not starve the other, and both together cost at
#     most this much, not the sum of two full timeouts.
#   HARD_DEADLINE -- the absolute wall-clock point (script start + ~9s) nothing
#     may run past. Every git call and the worktree-list call gets a small
#     fixed per-call cap, further capped by whatever is left of this.
T0 = time.monotonic()
NETWORK_DEADLINE = T0 + float(os.environ.get("PULSE_DEADLINE_SECS", "6") or "6")
HARD_DEADLINE = T0 + 9.0
GIT_CALL_CAP = 2.0


def time_left(deadline):
    return max(0.0, deadline - time.monotonic())


def safe(fn, *args, **kwargs):
    """Run a metric check, turning any uncaught exception into None (which
    every caller below already treats as UNKNOWN-for-that-metric) instead of
    letting it propagate and crash the whole script into a false exit 1."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        print("pulse: %s raised %s: %s" % (getattr(fn, "__name__", fn), type(exc).__name__, exc), file=sys.stderr)
        return None


# Env vars this process must never forward to a git subprocess: a pre-push
# git hook (this script's eventual caller) exports GIT_DIR, and a value
# inherited here would make git resolve against the hook's repo instead of
# PULSE_REPO_ROOT. Same rationale as tests/moat/run.sh's own unset block.
_GIT_ENV_STRIP = (
    "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
)


def _clean_env():
    env = dict(os.environ)
    for k in _GIT_ENV_STRIP:
        env.pop(k, None)
    # C locale: moat_baseline_at_last_release() matches git's stderr text
    # ("No names found") to tell "no tag exists" apart from "the call
    # failed/timed out". git localizes that text; tests/moat/run.sh sets
    # LC_ALL=C for the same reason.
    env["LC_ALL"] = "C"
    return env


def start_proc(argv, cwd=None, env=None):
    """Start argv in its own process group (for a clean killpg on timeout),
    or return None if it could not even start."""
    try:
        return subprocess.Popen(
            argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except (OSError, ValueError):
        return None


def finish_proc(proc, timeout):
    """Wait up to timeout for proc, killing its whole process group on
    expiry. Returns (rc, stdout, stderr); rc is None on timeout.
    subprocess.run's own timeout= only signals the direct child; npm spawns
    node as a grandchild that can hold the pipe open past the deadline, so
    this manages the process group explicitly (start_new_session=True at
    start_proc + os.killpg here), the same scoping discipline as D14-D17:
    never an unscoped kill, only this process's own child group."""
    if proc is None:
        return (None, "", "SPAWN_FAILED")
    try:
        # A floor, not a bare max(0.0, ...): communicate(timeout=0.0) can
        # raise TimeoutExpired on its first internal check before ever
        # reading the pipe, even when the process already exited with its
        # output fully buffered (e.g. gh finishing in 10ms while npm, started
        # alongside it, used up the whole shared network deadline). A near-
        # zero floor gives every process at least one real chance to be
        # reaped and read before this gives up on it.
        out, err = proc.communicate(timeout=max(0.25, timeout))
        return (proc.returncode, out.decode("utf-8", "replace"),
                err.decode("utf-8", "replace"))
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            proc.communicate(timeout=0.5)
        except Exception:
            pass
        return (None, "", "TIMEOUT")


def run_capped(argv, cwd=None, env=None):
    """A single-shot run for git/worktree calls: capped at GIT_CALL_CAP,
    further capped by whatever is left of the hard deadline. Fails fast as a
    timeout without starting the process if the hard deadline is already
    gone, so one slow call cannot let a later one run unbounded."""
    budget = min(GIT_CALL_CAP, time_left(HARD_DEADLINE))
    if budget <= 0.05:
        return (None, "", "TIMEOUT")
    proc = start_proc(argv, cwd=cwd, env=env)
    return finish_proc(proc, budget)


def git(args):
    return run_capped(["git"] + list(args), cwd=REPO_ROOT, env=_clean_env())


def parse_time_value(raw):
    """Accept an epoch-seconds string or an ISO8601 'YYYY-MM-DDTHH:MMZ'
    (the BOARD.md timestamp format) and return epoch seconds, or None."""
    if raw is None or raw == "":
        return None
    raw = raw.strip()
    if re.match(r"^-?\d+(\.\d+)?$", raw):
        return float(raw)
    m = re.match(
        r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$", raw,
    )
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x) if x else 0 for x in m.groups(default="0"))
    # All timestamps this parses (BOARD.md, PULSE_NOW/PULSE_SWARM_START
    # overrides) are explicit UTC ('Z' suffix). calendar.timegm treats the
    # tuple as UTC directly -- time.mktime() - time.timezone is WRONG here:
    # time.timezone is always the STANDARD offset, so it is off by an hour
    # under DST (verified: EDT reports time.timezone=18000, the EST value,
    # while the live offset is 14400).
    return float(calendar.timegm((y, mo, d, h, mi, se, 0, 0, 0)))


def now_epoch():
    override = parse_time_value(os.environ.get("PULSE_NOW", ""))
    return override if override is not None else time.time()


NOW = now_epoch()

# Fixed priority order for every VIOLATION this script can raise, matching
# the spec exactly. Printed in this order regardless of check order, because
# docs/v10/CONTROL.md's Rule says the first action of every turn addresses
# the TOP violation -- an accidental ordering-by-discovery would misrank it.
VIOLATION_PRIORITY = [
    "CI_RED", "MOAT_REGRESSION", "UNRELEASED_MERGE", "REVIEW_STALE",
    "IDLE_BUILDERS", "LOW_READY", "NO_RECENT_RELEASE", "LOW_RELEASE_VOLUME",
    "CONTROL_OVERSIZE",
]

violations = []          # list of (code, text)
unknown_metrics = []      # list of metric names that came back UNKNOWN
lines = []                # status block lines, printed verbatim


def add_violation(code, text):
    violations.append((code, text))


def mark_unknown(name):
    unknown_metrics.append(name)


def emit(line=""):
    lines.append(line)


def sorted_violations():
    def rank(item):
        code = item[0]
        try:
            return VIOLATION_PRIORITY.index(code)
        except ValueError:
            return len(VIOLATION_PRIORITY)
    return sorted(violations, key=rank)


# --- main SHA, then npm + gh started CONCURRENTLY against one network ------
# deadline (metrics 1 and 2). Started together and finished together so one
# hanging network call cannot starve the other's whole timeout budget.
_CI_FAILURE_CONCLUSIONS = ("failure", "timed_out", "startup_failure")
_CI_OK_CONCLUSIONS = ("success", "skipped", "neutral")


def resolve_main_sha():
    rc, out, _ = git(["rev-parse", MAIN_REF])
    if rc != 0:
        return None
    return out.strip()


main_sha = safe(resolve_main_sha)

_npm_argv = shlex.split(os.environ["PULSE_NPM_CMD"]) if os.environ.get("PULSE_NPM_CMD") else [
    "npm", "view", "loki-mode", "time", "--json",
]
_gh_argv = None
if main_sha is not None:
    if os.environ.get("PULSE_GH_CMD"):
        _gh_argv = shlex.split(os.environ["PULSE_GH_CMD"])
    else:
        _gh_argv = [
            "gh", "run", "list", "--branch", MAIN_REF, "--commit", main_sha,
            "--json", "status,conclusion,workflowName", "--limit", "20",
        ]

_npm_proc = safe(start_proc, _npm_argv, REPO_ROOT)
# gh resolves its repo through git, so it must see the same scrubbed
# environment as every direct git call -- a GIT_DIR inherited from the
# eventual pre-push hook would misdirect gh's repo detection too.
_gh_proc = safe(start_proc, _gh_argv, REPO_ROOT, _clean_env()) if _gh_argv is not None else None

_npm_rc, _npm_out, _npm_err = safe(finish_proc, _npm_proc, time_left(NETWORK_DEADLINE)) or (None, "", "")
_gh_rc, _gh_out, _gh_err = (
    safe(finish_proc, _gh_proc, time_left(NETWORK_DEADLINE)) or (None, "", "")
    if _gh_proc is not None else (None, "", "")
)


# --- 1. releases in the last 24h / minutes since last release -------------
def parse_npm_releases(rc, out):
    if rc != 0 or not out.strip():
        return None
    try:
        data = json.loads(out)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    # 'created' and 'modified' are metadata, not releases; excluding them
    # matters because 'modified' updates on every publish including the
    # current one and would otherwise always read as "just released".
    stamps = []
    for key, val in data.items():
        if key in ("created", "modified"):
            continue
        if not isinstance(val, str):
            continue
        t = parse_time_value(val)
        if t is None:
            # npm's own ISO8601 has seconds + fractional, always UTC ('Z'
            # suffix) -- calendar.timegm, not time.mktime()-time.timezone
            # (see parse_time_value's comment on the DST bug that caused).
            try:
                t = float(calendar.timegm(time.strptime(val[:19], "%Y-%m-%dT%H:%M:%S")))
            except ValueError:
                t = None
        if t is not None:
            stamps.append(t)
    if not stamps:
        return None
    stamps.sort()
    last = stamps[-1]
    count_24h = sum(1 for t in stamps if NOW - t <= 24 * 3600)
    return {"last_release_epoch": last, "count_24h": count_24h}


npm_result = safe(parse_npm_releases, _npm_rc, _npm_out)
if npm_result is None:
    mark_unknown("releases_24h")
    mark_unknown("minutes_since_release")
    emit("Releases (24h): UNKNOWN (npm check failed or timed out)")
    emit("Minutes since last release: UNKNOWN")
else:
    mins_since = (NOW - npm_result["last_release_epoch"]) / 60.0
    emit("Releases (24h): %d" % npm_result["count_24h"])
    emit("Minutes since last release: %.1f" % mins_since)


# --- 2. main CI status for PULSE_MAIN_REF's head SHA -----------------------
# A run-completion status alone is not enough: 'cancelled' is routine here
# (a push during a release cancels its own Tests run -- see feedback in
# project memory) and must never read as red. A failure ANYWHERE in the run
# set wins over "still pending" -- a failed lint job sitting next to a still
# -running Tests job is a real CI_RED, not a "wait and see".
def parse_main_ci(rc, out):
    if rc != 0 or not out.strip():
        return None, None
    try:
        runs = json.loads(out)
    except (ValueError, TypeError):
        return None, None
    if not isinstance(runs, list) or not runs:
        return None, None
    parsed = [r for r in runs if isinstance(r, dict)]
    failing = [r.get("workflowName") or "unknown workflow" for r in parsed
               if r.get("conclusion") in _CI_FAILURE_CONCLUSIONS]
    if failing:
        return "red", failing
    if any(r.get("status") not in ("completed",) for r in parsed):
        return "pending", None
    if all(r.get("conclusion") in _CI_OK_CONCLUSIONS for r in parsed):
        return "green", None
    # Everything completed, nothing actually failed, but not cleanly all-ok
    # either (e.g. all cancelled/stale/action_required) -- not evidence of
    # red, and not evidence of green: report UNKNOWN rather than guess.
    return None, None


ci_status = None
if main_sha is None:
    mark_unknown("main_ci")
    emit("Main CI (%s): UNKNOWN (could not resolve %s SHA)" % (MAIN_REF, MAIN_REF))
else:
    _ci_parsed = safe(parse_main_ci, _gh_rc, _gh_out)
    ci_status, ci_failing_workflows = _ci_parsed if _ci_parsed is not None else (None, None)
    if ci_status is None:
        mark_unknown("main_ci")
        emit("Main CI (%s @ %s): UNKNOWN (gh check failed, timed out, or inconclusive)" % (MAIN_REF, main_sha[:8]))
    else:
        emit("Main CI (%s @ %s): %s" % (MAIN_REF, main_sha[:8], ci_status.upper()))
        if ci_status == "red":
            workflows = ", ".join(sorted(set(ci_failing_workflows or []))) or "unknown workflow"
            add_violation("CI_RED", "main CI is RED at %s (%s)" % (main_sha[:8], workflows))


# --- 3/4. BOARD.md status counts + review-pending age ----------------------
STATUS_TOKEN_RE = re.compile(
    r"^(ready|building|review|review-blocked|blocked|approved|merged|released|rejected|parked)"
    r"@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)$"
)
ID_RE = re.compile(r"^(GF|PF|S)-\d+$")


def parse_board(path):
    """Parse BOARD.md's pipe table rows. Cell position varies (some rows
    omit the Acceptance-checks column), so this finds the Status cell by
    matching the normalized token@timestamp pattern rather than trusting a
    fixed column index."""
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    rows = []
    unparsed = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        row_id = cells[0]
        if not ID_RE.match(row_id):
            continue
        status_cell = None
        for cell in cells[1:]:
            m = STATUS_TOKEN_RE.match(cell)
            if m:
                status_cell = (m.group(1), m.group(2))
                break
        if status_cell is None:
            unparsed.append(row_id)
            continue
        rows.append((row_id, status_cell[0], status_cell[1]))
    return {"rows": rows, "unparsed": unparsed}


board = safe(parse_board, BOARD_MD)
board_rows = []
if board is None:
    mark_unknown("board_counts")
    mark_unknown("review_pending_age")
    emit("BOARD.md: UNKNOWN (could not read %s)" % BOARD_MD)
else:
    board_rows = board["rows"]
    counts = {}
    ready_ids = []
    for row_id, token, _ts in board_rows:
        norm = "blocked" if token == "review-blocked" else token
        counts[norm] = counts.get(norm, 0) + 1
        if norm == "ready":
            ready_ids.append(row_id)
    order = ["ready", "building", "review", "blocked", "approved", "merged", "released"]
    emit("BOARD status counts: " + ", ".join(
        "%s=%d" % (tok, counts.get(tok, 0)) for tok in order
    ))
    other_tokens = sorted(set(counts) - set(order))
    if other_tokens:
        emit("BOARD other tokens: " + ", ".join(
            "%s=%d" % (tok, counts[tok]) for tok in other_tokens
        ))
    if board["unparsed"]:
        emit("BOARD unparsed rows (no status token found): " + ", ".join(board["unparsed"]))

    # Every review-pending slice over the 45-minute budget, oldest first.
    stale_reviews = []
    all_reviews = []  # (row_id, age) for every parseable review-pending row
    for row_id, token, ts in board_rows:
        if token in ("review", "review-blocked"):
            t = parse_time_value(ts)
            if t is None:
                continue
            age = (NOW - t) / 60.0
            all_reviews.append((row_id, age))
            if age > 45:
                stale_reviews.append((row_id, age))
    if all_reviews:
        oldest = max(all_reviews, key=lambda pair: pair[1])
        emit("Oldest review-pending slice: %s (%.1f min)" % (oldest[0], oldest[1]))
    else:
        emit("Oldest review-pending slice: none")
    if stale_reviews:
        stale_reviews.sort(key=lambda pair: -pair[1])
        ids_desc = ", ".join("%s (%.1f min)" % (rid, age) for rid, age in stale_reviews)
        add_violation(
            "REVIEW_STALE",
            "review-pending past 45 minutes: %s" % ids_desc,
        )

    ready_count = counts.get("ready", 0)
    if ready_count < 8:
        add_violation(
            "LOW_READY",
            "only %d ready slice(s) on BOARD (want at least 8); cut %d more"
            % (ready_count, 8 - ready_count),
        )


# --- 5. IDLE_BUILDERS: fewer than 6 active builder worktrees while ready ----
# active_worktrees is computed below (metric 6); this violation is added
# after that so it can key on real worktree activity rather than BOARD's
# `building` cells, which the swarm's own docs (BOARD.md's Status-format
# section) warn go stale between edits -- the same reason the unreleased-
# merge age cross-checks git instead of trusting a table cell.


# --- 4b. merged-but-unreleased age, cross-checked against git --------------
def check_unreleased_merge_age():
    # Pin to MAIN_REF explicitly: with no ref argument, `git describe` walks
    # from the CALLING PROCESS'S OWN HEAD, which is wrong whenever this script
    # runs from a builder worktree checked out somewhere other than main (the
    # documented, and intended, way to run it) -- see PULSE_MAIN_REF's header
    # comment. Reviewer-reproduced from a scratch checkout at an older tag.
    rc, out, _ = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", MAIN_REF])
    if rc != 0:
        return None
    tag = out.strip()
    # --first-parent: without it, this walks INTO a merged branch's own
    # history and finds commits' ORIGINAL authorship/commit timestamps, which
    # can be much older than when they actually landed on MAIN_REF via merge.
    # That produced a false UNRELEASED_MERGE positive on ordinary swarm
    # `merge:` commits whose source branch had older pre-merge commits.
    # --first-parent restricts the walk to MAIN_REF's own direct history, so
    # "oldest commit since the tag" reflects real merge order/time.
    rc, out, _ = git(["log", "--first-parent", "%s..%s" % (tag, MAIN_REF), "--format=%H %ct"])
    if rc != 0:
        return None
    commits = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            commits.append((parts[0], float(parts[1])))
    if not commits:
        return {"tag": tag, "unreleased_commits": 0, "oldest_age_min": None, "oldest_sha": None}
    oldest_sha, oldest_t = min(commits, key=lambda pair: pair[1])
    return {
        "tag": tag,
        "unreleased_commits": len(commits),
        "oldest_age_min": (NOW - oldest_t) / 60.0,
        "oldest_sha": oldest_sha,
    }


unreleased = safe(check_unreleased_merge_age)
if unreleased is None:
    mark_unknown("unreleased_merge_age")
    emit("Merged-but-unreleased age: UNKNOWN (git tag/log check failed)")
else:
    if unreleased["unreleased_commits"] == 0:
        emit("Merged-but-unreleased age: none (all commits released at %s)" % unreleased["tag"])
        merged_rows = [rid for rid, tok, _ in board_rows if tok == "merged"]
        if merged_rows:
            emit(
                "BOARD note: %s marked 'merged' but git shows nothing unreleased on %s since %s "
                "(stale BOARD cell, not treated as a violation)"
                % (", ".join(merged_rows), MAIN_REF, unreleased["tag"])
            )
    else:
        age = unreleased["oldest_age_min"]
        emit(
            "Merged-but-unreleased age: %.1f min (%d commit(s) since %s, oldest %s)"
            % (age, unreleased["unreleased_commits"], unreleased["tag"], unreleased["oldest_sha"][:8])
        )
        if age > 30 and ci_status == "green":
            merged_rows = [rid for rid, tok, _ in board_rows if tok == "merged"]
            merged_desc = (", ".join(merged_rows) + " " ) if merged_rows else ""
            add_violation(
                "UNRELEASED_MERGE",
                "%s%d commit(s) merged but unreleased for %.1f minutes since %s (oldest %s) while CI is green"
                % (merged_desc, unreleased["unreleased_commits"], age, unreleased["tag"], unreleased["oldest_sha"][:8]),
            )


# --- 5. moat proven count vs last release ----------------------------------
def list_pending_ids(text):
    ids = set()
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        ids.add(s.split()[0])
    return ids


def proven_properties(ids):
    """Set of property numbers (1..9) with zero pending ids -- i.e. proven,
    by the same "no pending case for this Pn" rule tests/moat/run.sh uses
    for its own PROVEN verdict, just without re-running the suite."""
    proven = set()
    for n in range(1, 10):
        prefix = "P%d." % n
        if not any(i.startswith(prefix) for i in ids):
            proven.add(n)
    return proven


# Sentinel distinct from None: moat_baseline_at_last_release returns this
# when the git calls themselves failed or timed out (UNKNOWN), as opposed to
# returning None when git affirmatively reports no matching tag exists (a
# real "no prior release", not a measurement failure). Conflating the two
# used to let a git timeout silently print "no prior release to compare"
# and disable MOAT_REGRESSION with no UNKNOWN ever recorded.
_BASELINE_UNKNOWN = object()


def moat_baseline_at_last_release():
    # Pin to MAIN_REF for the same reason as check_unreleased_merge_age: with
    # no ref argument, `git describe` follows the calling process's own HEAD,
    # not the swarm's actual main line, which flips the baseline count when
    # run from a builder worktree at an older tag/branch.
    rc, out, err = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", MAIN_REF])
    if rc != 0:
        no_tag = ("no names found" in err.lower()) or ("no tags can describe" in err.lower())
        return None if no_tag else _BASELINE_UNKNOWN
    tag = out.strip()
    rc2, out2, err2 = git(["show", "%s:tests/moat/pending.txt" % tag])
    if rc2 != 0:
        return _BASELINE_UNKNOWN
    return proven_properties(list_pending_ids(out2))


def moat_pending_count_at(ref):
    """Pending-derived proven count read via `git show REF:...`, never a raw
    working-tree file read -- the informational count must reflect
    PULSE_MAIN_REF, not whatever the calling process's own working tree
    happens to hold (finding 1 applies here too: a builder worktree's HEAD
    can be a feature branch checked out at a different commit than main)."""
    rc, out, _ = git(["show", "%s:tests/moat/pending.txt" % ref])
    if rc != 0:
        return None
    return len(proven_properties(list_pending_ids(out)))


# tests/moat/pending.txt's own documented invariant (see tests/moat/run.sh) is
# a ratchet: a property's failing-case IDs are removed once truly fixed, never
# added back, so the SET of pending ids can only shrink release over release.
# That means a "proven" count inferred purely from "zero pending ids for Pn"
# can only ever stay flat or INCREASE from an older ref to a newer one -- it
# is structurally unable to register a real regression, even while
# tests/moat/run.sh itself reports a live FAIL with an unlisted
# "REGRESSION: ... FAIL but not listed in tests/moat/pending.txt" line (a
# property can have zero pending.txt lines at BOTH the baseline tag and HEAD
# while its suite fails live in between -- verified on this repo: pulse's old
# pending-only heuristic read "3 of 9 proven" while `bash tests/moat/run.sh`
# reported "2 of 9 proven, FAIL (3 rule failures)" for the identical commit,
# because P7 has no pending.txt line at either ref).
#
# So MOAT_REGRESSION below never uses the pending-derived count as its source
# of truth -- only PULSE_MOAT_RESULT, which must point to a file holding the
# real captured stdout of a `tests/moat/run.sh` run (its own summary lines are
# parsed verbatim: "moat: N of 9 properties proven" and, when the suite
# failed, "moat suite: FAIL (K rule failure(s))"). Typical use (SHA captured
# BEFORE the run, see the header comment's BACKLOG 133 note on why):
#   git diff --quiet HEAD || exit 1
#   moat_sha="$(git rev-parse HEAD)"
#   bash tests/moat/run.sh > /path/to/moat-result.txt   # takes minutes
#   printf '%s\n' "$moat_sha" > /path/to/moat-result.txt.sha
#   PULSE_MOAT_RESULT=/path/to/moat-result.txt bash scripts/v10-pulse.sh
# Re-running the suite inside this script's own ~9s budget is not an option
# (the suite alone takes minutes), so when no result file is supplied, or it
# cannot be read, or its summary lines cannot be parsed, MOAT_REGRESSION is
# reported UNKNOWN rather than silently falling back to the pending-derived
# approximation as if it were a real measurement -- that fallback was the
# original bug. The pending-derived count is still shown, but only as
# informational context, explicitly labelled as not suite-verified, and it
# never feeds a violation.
#
# BACKLOG 133 (SHA pinning): a real, parseable PULSE_MOAT_RESULT is still not
# enough on its own -- nothing ties it to the commit it was measured against,
# so a stale capture from an earlier commit would read as clean today. The
# required sidecar "<PULSE_MOAT_RESULT>.sha" (see the header comment) must
# hold exactly the full SHA `tests/moat/run.sh` was measured at; this script
# compares it byte-for-byte against `git rev-parse MAIN_REF`'s current
# resolved HEAD (never re-resolved through git -- a ref name or short SHA in
# the sidecar simply fails the equality check rather than being trusted). A
# missing/empty sidecar or a mismatch both demote an otherwise-parseable
# result to UNKNOWN, deliberately fail-closed: a capture with no provenance,
# or provably stale provenance, must never register as a confident verdict.
_MOAT_COUNT_RE = re.compile(r"moat:\s*(\d+)\s*of\s*9\s*properties\s*proven", re.IGNORECASE)
_MOAT_FAIL_RE = re.compile(r"moat suite:\s*FAIL\s*\((\d+)\s*rule failure", re.IGNORECASE)
# tests/moat/run.sh's own terminal verdict lines (see its final echo calls):
# exactly one of these three appears on any run that reached a real verdict.
# Requiring one of them (not just the count line) guards against a truncated
# or could-not-check capture that happens to contain a "moat: N of 9" count
# substring from something else (e.g. a mid-run progress line) without ever
# reaching run.sh's actual conclusion.
_MOAT_VERDICT_RE = re.compile(
    r"moat suite:\s*(?:FAIL\s*\(\d+\s*rule failure|all 9 properties proven|no rule failed)",
    re.IGNORECASE,
)


def parse_moat_result(text):
    """Parse tests/moat/run.sh's own captured stdout. Returns
    {"count": int, "suite_failed": bool, "rule_failures": int or None} or
    None if the count line or a recognized terminal verdict line is missing
    (an unparseable, truncated, or unrelated file -- never guessed at)."""
    m = _MOAT_COUNT_RE.search(text)
    if not m or not _MOAT_VERDICT_RE.search(text):
        return None
    count = int(m.group(1))
    fm = _MOAT_FAIL_RE.search(text)
    return {
        "count": count,
        "suite_failed": fm is not None,
        "rule_failures": int(fm.group(1)) if fm else None,
    }


def check_moat_pending():
    """Informational-only pending-derived count at MAIN_REF (see the ratchet
    comment below check_unreleased_merge_age/moat_baseline_at_last_release):
    read via `git show`, never the raw working tree, for the same reason as
    finding 1 -- this script is meant to run from a builder worktree whose
    own HEAD can differ from MAIN_REF."""
    return moat_pending_count_at(MAIN_REF)


def check_moat_regression():
    """The only source of truth for MOAT_REGRESSION: PULSE_MOAT_RESULT. Kept
    entirely independent of check_moat_pending so a `git show`/pending-read
    failure never silently blanks this check (and vice versa) -- each is
    wrapped in its own safe() call below."""
    result_path = os.environ.get("PULSE_MOAT_RESULT", "")
    baseline = moat_baseline_at_last_release()
    baseline_unknown = baseline is _BASELINE_UNKNOWN
    baseline_set = None if baseline_unknown else baseline
    at_release = len(baseline_set) if baseline_set is not None else None

    measured = None
    measured_error = None
    if result_path:
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                result_text = f.read()
        except OSError as exc:
            measured_error = "could not read PULSE_MOAT_RESULT file: %s" % exc
        else:
            measured = parse_moat_result(result_text)
            if measured is None:
                measured_error = (
                    "PULSE_MOAT_RESULT file did not contain a parseable 'moat: N of 9' "
                    "count line plus one of run.sh's terminal verdict lines"
                )
            else:
                # BACKLOG 133: a parseable result is not yet a TRUSTABLE one --
                # it must also prove it was measured against the commit this
                # pulse is reporting on. Sidecar path convention, see header.
                sha_path = result_path + ".sha"
                try:
                    with open(sha_path, "r", encoding="utf-8") as f:
                        measured_sha = f.read().strip()
                except OSError:
                    measured_sha = ""
                if not measured_sha:
                    measured = None
                    measured_error = (
                        "PULSE_MOAT_RESULT has no provenance: expected a sidecar file at "
                        "%s holding the SHA it was measured against (run "
                        "`git rev-parse HEAD > %s` BEFORE running the suite); a result with "
                        "no recorded SHA cannot be trusted to be current" % (sha_path, sha_path)
                    )
                elif main_sha is None:
                    measured = None
                    measured_error = (
                        "could not verify PULSE_MOAT_RESULT's provenance: %s's current HEAD "
                        "could not be resolved" % MAIN_REF
                    )
                elif measured_sha != main_sha:
                    measured = None
                    measured_error = (
                        "moat result is stale, measured against %s but %s is now at %s"
                        % (measured_sha[:8], MAIN_REF, main_sha[:8])
                    )

    return {
        "at_last_release": at_release,
        "baseline_unknown": baseline_unknown,
        "measured": measured,
        "measured_error": measured_error,
        "result_path": result_path,
    }


pending_count = safe(check_moat_pending)
if pending_count is None:
    mark_unknown("moat_proven")
    emit("Moat proven (pending-derived, informational, NOT suite-verified): UNKNOWN (git show against %s failed)" % MAIN_REF)
else:
    emit(
        "Moat proven (pending-derived, informational, NOT suite-verified): %d of 9"
        % pending_count
    )

regression = safe(check_moat_regression)
if regression is None:
    mark_unknown("moat_regression")
    emit("Moat regression check: UNKNOWN (could not evaluate PULSE_MOAT_RESULT or the baseline tag)")
else:
    if regression["baseline_unknown"]:
        mark_unknown("moat_baseline")

    if regression["measured"] is not None:
        m = regression["measured"]
        emit("Moat proven (measured, PULSE_MOAT_RESULT): %d of 9" % m["count"])
        if regression["at_last_release"] is not None:
            emit("Moat proven at last release (pending-derived baseline): %d of 9" % regression["at_last_release"])
        if m["suite_failed"]:
            add_violation(
                "MOAT_REGRESSION",
                "measured moat suite reports FAIL (%s rule failure(s)) -- a live suite failure is always a "
                "regression regardless of the proven count (see %s)"
                % (m["rule_failures"] if m["rule_failures"] is not None else "unknown", regression["result_path"]),
            )
        elif regression["at_last_release"] is not None and m["count"] < regression["at_last_release"]:
            add_violation(
                "MOAT_REGRESSION",
                "measured moat proven count dropped to %d of 9 (was %d of 9 pending-derived at last release)"
                % (m["count"], regression["at_last_release"]),
            )
    else:
        # No real measurement available. This is the load-bearing fix for
        # finding 3: never treat the pending-derived count as if it were a
        # measured result, and never let MOAT_REGRESSION silently read as
        # clean just because nothing was supplied -- route it through
        # UNKNOWN, per this script's own "never silently read as clean"
        # contract (see the header).
        mark_unknown("moat_regression")
        if regression["measured_error"]:
            emit("Moat regression check: UNKNOWN (%s)" % regression["measured_error"])
        else:
            emit(
                "Moat regression check: UNKNOWN (no PULSE_MOAT_RESULT supplied; capture "
                "`git rev-parse HEAD` BEFORE running `bash tests/moat/run.sh > FILE`, write it to "
                "FILE.sha, and pass PULSE_MOAT_RESULT=FILE for a real measurement)"
            )


# --- 6. live builder worktrees (mtime, no find walk) ------------------------
def check_worktrees():
    wt_cmd_raw = os.environ.get("PULSE_WORKTREE_CMD", "")
    argv = shlex.split(wt_cmd_raw) if wt_cmd_raw else ["git", "worktree", "list", "--porcelain"]
    if argv[0] == "git":
        rc, out, _ = run_capped(argv, cwd=REPO_ROOT, env=_clean_env())
    else:
        rc, out, _ = run_capped(argv, cwd=REPO_ROOT)
    if rc != 0:
        return None
    worktrees = []
    cur_path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            cur_path = line[len("worktree "):].strip()
        elif line.strip() == "" and cur_path:
            worktrees.append(cur_path)
            cur_path = None
    if cur_path:
        worktrees.append(cur_path)
    if not worktrees:
        # Fall back to plain `git worktree list` output (path is column 1).
        for line in out.splitlines():
            parts = line.split()
            if parts:
                worktrees.append(parts[0])
    if not worktrees:
        return {"checked": 0, "active": 0}

    # git worktree list (both --porcelain and plain) always lists the
    # primary/main worktree first. Skip it by position, not by path
    # comparison against REPO_ROOT -- this script is meant to run FROM a
    # builder worktree, where REPO_ROOT (that worktree) is never the primary
    # one, so a path-equality exclusion would exclude nothing there.
    builder_worktrees = worktrees[1:]

    active = 0
    checked = 0
    for wt_path in builder_worktrees:
        git_marker = os.path.join(wt_path, ".git")
        gitdir = git_marker
        if os.path.isfile(git_marker):
            with open(git_marker, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content.startswith("gitdir:"):
                gitdir = content.split(":", 1)[1].strip()
        if not os.path.isdir(gitdir):
            continue
        checked += 1
        # ponytail: mtime of the worktree's own .git-file/directory reflects
        # its CREATION time, not last activity -- that would read every
        # builder as idle. Use the freshest of the files git actually
        # rewrites on commit/checkout activity (index, HEAD, logs/HEAD)
        # instead of a find(1) walk, which would blow the 10s budget across
        # ~40 worktrees. Ceiling: a worktree with uncommitted-only edits (no
        # commit, no checkout) since these files last changed reads as idle
        # even if a builder is actively editing it.
        candidates = [gitdir, os.path.join(gitdir, "index"),
                      os.path.join(gitdir, "HEAD"), os.path.join(gitdir, "logs", "HEAD")]
        best = None
        for c in candidates:
            try:
                mt = os.stat(c).st_mtime
            except OSError:
                continue
            if best is None or mt > best:
                best = mt
        if best is not None and (NOW - best) <= 30 * 60:
            active += 1
    return {"checked": checked, "active": active}


worktrees = safe(check_worktrees)
if worktrees is None:
    mark_unknown("active_worktrees")
    emit("Active builder worktrees: UNKNOWN (git worktree list failed or timed out)")
else:
    emit(
        "Active builder worktrees (last 30 min): %d of %d checked"
        % (worktrees["active"], worktrees["checked"])
    )
    # IDLE_BUILDERS keys on real worktree activity, not BOARD's `building`
    # cells (which BOARD.md's own Status-format section warns can go stale
    # between edits) -- same reasoning as UNRELEASED_MERGE cross-checking
    # git instead of trusting a table cell. If the worktree check itself
    # came back UNKNOWN, this violation simply does not fire (never a false
    # positive from a metric we could not measure).
    if board is not None:
        ready_count = sum(1 for _rid, tok, _ts in board_rows if tok == "ready")
        if worktrees["active"] < 6 and ready_count > 0:
            ready_ids = [rid for rid, tok, _ts in board_rows if tok == "ready"]
            add_violation(
                "IDLE_BUILDERS",
                "only %d active builder worktree(s) while %d ready slice(s) exist on BOARD (%s)"
                % (worktrees["active"], ready_count, ", ".join(ready_ids)),
            )


# --- 7. release cadence violations (needs npm_result) -----------------------
def swarm_start_epoch():
    override = parse_time_value(os.environ.get("PULSE_SWARM_START", ""))
    if override is not None:
        return override
    # Wave 0 (docs/v10/BOARD.md Wave log): "setup, 2026-09-26". A fixed
    # fallback, not derived from git history at runtime (SWARM.md's own add
    # commit is 2026-09-26T15:21:31Z UTC) -- this script never shells out
    # beyond what PULSE_MAIN_REF/PULSE_REPO_ROOT already cover, and a fixed
    # constant is simpler than adding another git call for one rarely-hit
    # fallback. Deliberately later than the real add time, so on the day this
    # fallback is reachable at all it stays on the side of suppressing the
    # 24h-volume check rather than false-firing it, matching the spec's
    # "suppress until 24h of swarm operation" intent.
    return parse_time_value("2026-09-26T23:59Z")


def check_release_cadence():
    if npm_result is None:
        return
    mins_since = (NOW - npm_result["last_release_epoch"]) / 60.0
    if mins_since > 90:
        add_violation(
            "NO_RECENT_RELEASE",
            "no release in the last 90 minutes (%.1f minutes since last release)" % mins_since,
        )
    start = swarm_start_epoch()
    hours_running = (NOW - start) / 3600.0 if start else 0
    if hours_running >= 24 and npm_result["count_24h"] < 30:
        add_violation(
            "LOW_RELEASE_VOLUME",
            "only %d release(s) in the last 24h (want at least 30) after %.1f hours of swarm operation"
            % (npm_result["count_24h"], hours_running),
        )


safe(check_release_cadence)


# --- 8. CONTROL.md line budget ----------------------------------------------
def check_control_md():
    with open(CONTROL_MD, "r", encoding="utf-8") as f:
        return sum(1 for _ in f)


control_lines = safe(check_control_md)
if control_lines is None:
    mark_unknown("control_md_lines")
    emit("CONTROL.md line count: UNKNOWN (could not read %s)" % CONTROL_MD)
else:
    emit("CONTROL.md line count: %d (budget: 40)" % control_lines)
    if control_lines > 40:
        add_violation(
            "CONTROL_OVERSIZE",
            "docs/v10/CONTROL.md is %d lines (budget is 40); trim %d line(s)"
            % (control_lines, control_lines - 40),
        )


_NEXT_ACTION_TEXT = {
    "CI_RED": "investigate and fix the red main CI run before anything else",
    "MOAT_REGRESSION": "identify which moat property regressed and revert or fix it before any further merge",
    "UNRELEASED_MERGE": "cut a release now, main has been unreleased past the 30-minute budget",
    "REVIEW_STALE": "escalate or finish review for the named slice(s), they have exceeded the 45-minute budget",
    "IDLE_BUILDERS": "dispatch more builders against the named ready slice(s) in docs/v10/BOARD.md",
    "LOW_READY": "the Product Owner should cut the named number of additional slices onto the ready queue",
    "NO_RECENT_RELEASE": "cut a release now, none has shipped in over 90 minutes",
    "LOW_RELEASE_VOLUME": "investigate why release throughput is below the 30/day target",
    "CONTROL_OVERSIZE": "trim docs/v10/CONTROL.md back under its 40-line budget",
}


# --- print status block ------------------------------------------------------
# Wrapped as the final safety net: everything above already routes crashes
# through safe() into an UNKNOWN metric, but if formatting itself somehow
# raises, this must still exit 2 (could-not-check), never exit 1 (a false
# VIOLATION) and never an uncaught traceback with exit code 1.
def render_and_exit():
    print("=== v10-pulse status (%s) ===" % time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(NOW)))
    for l in lines:
        print(l)

    if unknown_metrics:
        print("UNKNOWN metrics: " + ", ".join(sorted(set(unknown_metrics))))

    print("")
    ordered = sorted_violations()
    if ordered:
        print("=== VIOLATIONS ===")
        for code, text in ordered:
            print("VIOLATION: %s: %s" % (code, text))
        print("")
        print("=== NEXT ACTIONS ===")
        for code, text in ordered:
            action = _NEXT_ACTION_TEXT.get(code, "address the violation above")
            print("NEXT ACTION: %s: %s -- %s" % (code, action, text))
        return 1

    if unknown_metrics:
        return 2
    return 0


try:
    sys.exit(render_and_exit())
except SystemExit:
    raise
except Exception as exc:
    print("PULSE ERROR: %s: %s" % (type(exc).__name__, exc))
    sys.exit(2)
PULSE_PY
