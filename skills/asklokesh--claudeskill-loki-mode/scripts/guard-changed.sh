#!/usr/bin/env bash
# Run the test suites that guard the files you actually changed.
#
# Why this exists. The FAST tier is the release gate, and it DEFERS the 282-suite
# shell run. Three releases in one cycle (v9.25.0, v9.25.1, v9.26.0) failed to
# publish because a check guarding a file we edited lived in a deferred suite:
# CI found it 25 minutes later, one cycle at a time. CLAUDE.md already states the
# rule -- "a check that guards the shipped artifact must run in the FAST tier" --
# but nothing enforced it for suites outside the trust core.
#
# This is the targeted middle ground: not the 26-minute FULL tier, just the
# suites that mention the files in your diff.
#
# What it CANNOT catch: a failure that depends on the CI environment differing
# from yours. v9.26.2 failed on a suite this script selects and runs, because
# `yq` is preinstalled on the ubuntu-24.04 runner and absent on macOS, so the
# assertion passed locally and failed there. Running the right suite is
# necessary, not sufficient -- an environment-conditional assertion has to name
# its condition (`command -v yq`) rather than assume the author's machine.
#
# Usage:
#   bash scripts/guard-changed.sh              # vs origin/main
#   bash scripts/guard-changed.sh HEAD~3       # vs an explicit base
#
# Exit: 0 when every matched suite passes (or none matched), 1 otherwise.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

BASE="${1:-origin/main}"

# Files excluded from suite selection. Two groups, both deliberate:
#
#   - tests/docs/wiki/CHANGELOG: a changed test guards itself (handled below);
#     prose has no behavioral suite.
#   - VERSION / package*.json / Dockerfile* / server.json / plugin.json /
#     __init__.py / dist: release-churn files touched by EVERY release. They are
#     named in hundreds of suites, so including them made a routine version bump
#     select ~all 282 suites -- slower than the FULL tier this exists to avoid,
#     and a gate nobody will run is a gate that does not protect anything.
#     Their content is already checked by the FAST tier (dist freshness, npm
#     pack contents, server.json currency, plugin.json currency).
SKIP_RE='^(tests/|docs/|wiki/|CHANGELOG|VERSION$|package\.json$|package-lock\.json$|server\.json$|Dockerfile|loki-ts/dist/|.*/__init__\.py$|plugins/.*/plugin\.json$|SKILL\.md$|CLAUDE\.md$)'

# Only source files can be "guarded by" a suite. A changed test guards itself and
# is run directly; version/doc churn has no behavioral suite to find.
# NOTE: no `mapfile` -- macOS ships bash 3.2, where it does not exist. The repo
# already guards this class of failure (tests/test-bash32-parse.sh).
CHANGED=()
while IFS= read -r _f; do [ -n "$_f" ] && CHANGED+=("$_f"); done < <(
    git diff --name-only "$BASE"...HEAD 2>/dev/null | grep -vE "$SKIP_RE" || true
)
CHANGED_TESTS=()
while IFS= read -r _f; do [ -n "$_f" ] && CHANGED_TESTS+=("$_f"); done < <(
    git diff --name-only "$BASE"...HEAD 2>/dev/null | grep -E '^tests/test.*\.sh$' || true
)

if [ "${#CHANGED[@]}" -eq 0 ] && [ "${#CHANGED_TESTS[@]}" -eq 0 ]; then
    echo "guard-changed: no source or test changes vs $BASE -- nothing to guard."
    exit 0
fi

echo "guard-changed: base=$BASE  changed source files=${#CHANGED[@]}"

# Collect suites that reference any changed source file, by path and by basename.
# Basename matters: a suite typically greps "verify.sh", not "autonomy/verify.sh".
declare -a SUITES=()
add_suite() {
    local s="$1" existing
    [ -f "$s" ] || return 0
    for existing in "${SUITES[@]:-}"; do [ "$existing" = "$s" ] && return 0; done
    SUITES+=("$s")
}

# Match on the repo-relative PATH only, never the bare basename. Basename
# matching sounded more thorough and was measurably worse: "loki" appears in
# nearly every suite, so `autonomy/loki` pulled in 486 suites -- more than the
# FULL tier -- while path-only pulls 143 and still catches the failures that
# actually broke v9.25.0 (test-caveman-loki-coverage.sh) and v9.25.1
# (test-doc-scope-generator.sh). Measured worst case: ~135s.
for f in "${CHANGED[@]:-}"; do
    [ -n "$f" ] || continue
    while IFS= read -r s; do add_suite "$s"; done < <(
        grep -rlF -- "$f" tests/test*.sh 2>/dev/null || true
    )
done

# A changed test guards itself.
for t in "${CHANGED_TESTS[@]:-}"; do [ -n "$t" ] && add_suite "$t"; done

if [ "${#SUITES[@]}" -eq 0 ]; then
    echo "guard-changed: no suite references the changed files. Nothing to run."
    echo "guard-changed: NOTE -- that is itself a signal: this change is unguarded."
    exit 0
fi

echo "guard-changed: running ${#SUITES[@]} guarding suite(s)"
echo

# ShellCheck the changed shell files directly. This is NOT covered by suite
# selection: the repo-wide lint lives in tests/run-shellcheck.sh, which no suite
# "references" by path, and it is what actually failed v9.26.0 (SC2034 on a dead
# local in autonomy/verify.sh) -- blocking that release from publishing. Linting
# only the changed files keeps this near-instant versus the ~118s repo-wide run.
sc_fail=0
if command -v shellcheck >/dev/null 2>&1; then
    for f in "${CHANGED[@]:-}"; do
        [ -n "$f" ] || continue
        case "$f" in (*.sh|*/loki) ;; (*) continue ;; esac
        [ -f "$f" ] || continue
        if ! sc_out="$(shellcheck -S warning "$f" 2>&1)"; then
            sc_fail=1
            printf '  FAIL  shellcheck %s\n' "$f"
            printf '%s\n' "$sc_out" | head -14 | sed 's/^/        /'
        else
            printf '  PASS  shellcheck %s\n' "$f"
        fi
    done
else
    echo "  SKIP  shellcheck (not installed) -- CI still runs it repo-wide"
fi

pass=0; fail=0; failed=()
for s in "${SUITES[@]}"; do
    if out="$(timeout 300 bash "$s" 2>&1)"; then
        pass=$((pass+1)); printf '  PASS  %s\n' "$s"
    else
        fail=$((fail+1)); failed+=("$s"); printf '  FAIL  %s\n' "$s"
        printf '%s\n' "$out" | tail -12 | sed 's/^/        /'
    fi
done

echo
echo "guard-changed: $pass passed, $fail failed (shellcheck: $([ "$sc_fail" -eq 0 ] && echo clean || echo FAILED))"
if [ "$sc_fail" -ne 0 ]; then
    echo "guard-changed: shellcheck failed on a changed file -- this is what blocked v9.26.0."
    exit 1
fi
if [ "$fail" -gt 0 ]; then
    printf 'guard-changed: FAILING SUITES:\n'
    printf '  %s\n' "${failed[@]}"
    exit 1
fi
exit 0
