#!/usr/bin/env bash
# No shipped composite action may run the agent in a step that holds a GitHub
# token (BACKLOG 139, S-54; the fix itself landed in 8a714c73, S-41).
#
# THE DEFECT: .github/actions/issue-to-pr/action.yml fetched the issue and ran
# `loki start owner/repo#N` in ONE step with GH_TOKEN in its env, so the agent
# that reads untrusted issue text could also read a write token. The fix split
# it: a fetch step holds the token and writes a PRD file; the agent step gets
# only that file.
#
# WHY MOAT P9 DOES NOT COVER THIS: P9 judges a whole action as one unit and
# asks whether the agent can push. Putting GH_TOKEN back into the agent step
# (without a push command in it) leaves P9 green; measured with P9's own
# scanner on a mutated copy, 0 violations. This test is the step-level wall.
#
# "Holds" means: composite steps inherit the caller's env, so omitting the var
# is NOT enough. Every agent step must explicitly blank all four token vars
# run.sh withholds, and must not interpolate a token expression anywhere.
#
# REWORK (S-54 round 2): a reviewer reproduced two gaps in the first cut.
# (1) Actions to scan were listed by hand, so a new .github/actions/<x>/
#     action.yml (e.g. review/action.yml) shipped unchecked. Fixed by
#     globbing .github/actions/*/action.yml plus root action.yml.
# (2) Detection required the literal command word `loki`/`npx loki-mode`
#     immediately followed by one of a hardcoded subcommand list
#     (start|run|heal), so it missed: a pinned `npx loki-mode@<ver>`, an
#     absolute-path call, a call through a variable holding the binary name,
#     any other subcommand (review/fix/test/...), and a repo script that
#     might itself call loki. Fixed below: detection no longer requires a
#     specific subcommand, and adds path/npx/version, variable, and
#     script-call forms. tests/fixtures/action-agent-step-forms/*.yml proves
#     each of those five forms is now caught (and that a properly-blanked
#     step in each form still passes).
#
# REWORK (S-54 round 3): a reviewer reproduced that round 2's narrowed _SEP
# (statement-boundary anchor) over-corrected: it dropped bare whitespace
# entirely, so it also lost every case where the real command-start boundary
# is a shell keyword or a wrapper rather than punctuation -- `if`/`while`/
# `until`/`elif`/`else`/`then`/`do`, negation (`!`), and a wrapper that execs
# the real command in place (`timeout N`, `env VAR=..`, `nice`, `command`,
# `exec`). A scratch "Agent pass" step made the new test pass while the old
# round-1 test still failed on it. Fixed below: _SEP now requires a genuine
# punctuation boundary first, then allows at most one keyword/negation and
# any number of wrappers before the command, so `if loki start; then ...`,
# `while ! loki start; do ...`, `(loki start)`, `{ loki start; }`, a bare
# pipe, and each wrapper are all detected again, while a stray English "if"
# mid-string (e.g. inside an echo) still cannot anchor on its own because
# nothing before it is a real boundary. New fixtures:
# tests/fixtures/action-agent-step-forms/keyword-prefixes.yml,
# negation-pipe-subshell.yml, wrapper-commands.yml.
#
# Usage: test-action-agent-step-no-token.sh [root]   (root defaults to repo)
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

echo "test-action-agent-step-no-token (root: $ROOT)"
python3 - "$ROOT" <<'PY'
import glob, os, re, sys
import yaml

root = sys.argv[1]
TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
TOKEN_EXPR_RE = re.compile(r"\$\{\{[^}]*(github\.token|github_token|GITHUB_TOKEN|GH_TOKEN)[^}]*\}\}")

# A command-position anchor: start of the run text, a new shell statement
# (after ; && || a bare | ( { a backtick or a $( ), never bare whitespace.
# Bare whitespace would also match mid-argument, e.g. `--provider
# "$LOKI_PROVIDER"`, or a plain assignment value like
# `OUT="$RUNNER_TEMP/loki-out"` -- neither of those runs anything.
#
# ROUND 3: a reviewer reproduced that the round-2 anchor, by dropping bare
# whitespace entirely, also lost every case where the real boundary is a
# shell keyword or wrapper rather than punctuation: `if loki start; then`,
# `while loki start; do`, `until`/`elif`/`else`, negation (`! loki start`),
# and a wrapper that execs the real command in place (`timeout 30 loki
# start`, `env FOO=bar loki start`, `nice`/`command`/`exec loki start`).
# Fixed by requiring a genuine punctuation BOUNDARY first (so a stray
# English "if" mid-sentence, e.g. `echo "check if loki config is valid"`,
# still cannot anchor on its own -- there is no boundary char directly
# before that "if"), then letting an optional keyword AND an optional
# negation stack (so `if ! loki start; then`, the common shell form of a
# negated condition, is caught too -- not just a bare keyword or a bare `!`),
# followed by any number of wrappers, before the real command.
_BOUNDARY = r'(?:\A|\n|;|&&|\|\||\||\(|\{|\$\(|`)'
_KEYWORD = r'(?:if|while|until|elif|else|then|do)\b'
_WRAPPER = (
    r'(?:timeout\b\s+\S+'
    r'|env\b(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S*)+'
    r'|nice\b|command\b|exec\b)'
)
_SEP = rf'{_BOUNDARY}\s*(?:{_KEYWORD}\s+)?(?:!\s+)?(?:{_WRAPPER}\s+)*'

# Any direct invocation of the loki / loki-mode binary: bare word, an
# absolute or ./relative path in front of it, npx with or without a pinned
# @version, and no subcommand restriction -- review/fix/test/heal/a future
# one all run the same agent-capable CLI.
AGENT_RE = re.compile(
    _SEP + r'(?:npx\s+)?(?:(?:/|\./|\.\./)\S*/)?loki(?:-mode)?(?:@\S+)?\b'
)
# A variable plainly naming the loki binary, invoked as the command word
# (quoted or not): `LOKI_BIN=...; "$LOKI_BIN" start`.
VAR_CALL_RE = re.compile(_SEP + r'"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?(?=\s|\Z)')
# A repo script run directly. We can't see inside it, so treat it the same
# as an agent step rather than assume it's safe.
SCRIPT_RE = re.compile(_SEP + r'(?:bash\s+scripts/|sh\s+scripts/|\./)\S+')


def clean_run(step):
    # Drop shell comment lines: prose like "the loki run this job owns" is
    # not an invocation.
    return "\n".join(l for l in str(step.get("run", "")).splitlines()
                      if not l.lstrip().startswith("#"))


def is_agent_run(run):
    if AGENT_RE.search(run) or SCRIPT_RE.search(run):
        return True
    return any("loki" in m.group(1).lower() for m in VAR_CALL_RE.finditer(run))


def agent_steps(path):
    """Yield (name, step_dict) for every agent step in one action.yml."""
    doc = yaml.safe_load(open(path))
    steps = doc["runs"]["steps"]
    for i, st in enumerate(steps):
        if is_agent_run(clean_run(st)):
            yield st.get("name", f"step {i}"), st


def check_step(rel, name, st, out):
    env = st.get("env") or {}
    for v in TOKEN_VARS:
        if v not in env:
            out.append(f"{rel} [{name}]: {v} not explicitly blanked (inherits caller env)")
        elif str(env[v]) != "":
            out.append(f"{rel} [{name}]: agent step holds {v}={env[v]!r}")
    blob = yaml.safe_dump({k: st[k] for k in st if k != "name"})
    m = TOKEN_EXPR_RE.search(blob)
    if m:
        out.append(f"{rel} [{name}]: agent step interpolates a token: {m.group(0)}")


fails = []

# --- Phase 1: every shipped action, discovered by glob, not hand-listed. ---
# EXPECTED is a vacuity guard only (a detector that finds nothing reports
# clean): every agent step known to ship must be found by name.
EXPECTED = {
    ".github/actions/issue-to-pr/action.yml": ["Resolve the issue to a patch"],
    "action.yml": ["Run loki review", "Run loki fix", "Run loki test"],
}
action_files = set(EXPECTED)
for p in glob.glob(os.path.join(root, ".github/actions/*/action.yml")):
    action_files.add(os.path.relpath(p, root))
if os.path.exists(os.path.join(root, "action.yml")):
    action_files.add("action.yml")

shipped_passes = 0
for rel in sorted(action_files):
    path = os.path.join(root, rel)
    try:
        steps = list(agent_steps(path))
    except Exception as e:
        fails.append(f"{rel}: cannot read steps ({e})")
        continue
    names = [n for n, _ in steps]
    for name, st in steps:
        check_step(rel, name, st, fails)
        shipped_passes += 1
    for want in EXPECTED.get(rel, []):
        if not any(n.startswith(want) for n in names):
            fails.append(f"{rel}: expected agent step '{want}' not detected (found {names})")

print(f"  phase 1 (shipped actions, {len(action_files)} file(s) via glob): "
      f"checked {shipped_passes} agent steps")

# --- Phase 2: fixtures proving each previously-missed form is now caught. ---
# Each fixture has one or more "Unblanked ..." steps (each must be flagged)
# and at least one "Blanked ..." step (must not be flagged, so the detector
# isn't just failing every step in a file it touches). Checked by NAME
# against the full step list, not "any() of the detected steps" -- an "any"
# check is satisfied by ONE detected form and stays silent about every other
# named form in the same file that the detector missed, which is exactly how
# a single dropped alternative (e.g. losing brace-group or elif coverage)
# could hide behind neighboring forms that still work.
fixdir = os.path.join(root, "tests/fixtures/action-agent-step-forms")
fixture_files = sorted(glob.glob(os.path.join(fixdir, "*.yml")))
if not fixture_files:
    fails.append(f"no fixtures found under {fixdir} (vacuous phase 2)")

fixture_checks = 0
for path in fixture_files:
    rel = os.path.relpath(path, root)
    all_names = [st.get("name", "") for st in yaml.safe_load(open(path))["runs"]["steps"]]
    detected = dict(agent_steps(path))
    for name in all_names:
        lname = name.lower()
        if not (lname.startswith("unblanked") or lname.startswith("blanked")):
            continue
        if name not in detected:
            fails.append(f"{rel} [{name}]: form not detected as an agent step (regression)")
            continue
        step_fails = []
        check_step(rel, name, detected[name], step_fails)
        fixture_checks += 1
        if lname.startswith("unblanked") and not step_fails:
            fails.append(f"{rel} [{name}]: expected a token-holding failure but none was reported")
        elif lname.startswith("blanked") and step_fails:
            fails.extend(f"{rel} [{name}]: unexpected: {m}" for m in step_fails)

print(f"  phase 2 (missed-form fixtures, {len(fixture_files)} file(s)): "
      f"checked {fixture_checks} steps")

for f in fails:
    print("  FAIL: " + f)
total_checks = shipped_passes + fixture_checks
print(f"  checked {total_checks} steps total, {len(fails)} failures")
sys.exit(1 if fails or total_checks == 0 else 0)
PY
