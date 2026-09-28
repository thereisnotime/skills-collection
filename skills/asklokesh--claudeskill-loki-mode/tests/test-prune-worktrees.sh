#!/usr/bin/env bash
# tests/test-prune-worktrees.sh (S-154, GUARDS 5)
#
# scripts/prune-worktrees.sh must count a cherry-picked branch (every commit
# patch-equivalent on main, `git cherry` shows no "+" line) as merged, keep a
# branch with a unique commit, keep locked and dirty worktrees, and remove only
# through `git worktree remove`. It must never use file-age signals.
#
# PRUNE_WORKTREES_SCRIPT overrides the script under test (red/mutation proofs).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNE="${PRUNE_WORKTREES_SCRIPT:-$SCRIPT_DIR/../scripts/prune-worktrees.sh}"

PASS=0; FAIL=0
pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

TMP_ROOT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
WORK="$(mktemp -d "$TMP_ROOT/loki-test-prune-worktrees.XXXXXX")" || exit 1
trap 'rm -rf -- "$WORK"' EXIT

# Isolate git from the host's global/system config (hooks, signing).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

REPO="$WORK/repo"
WT="$REPO/.claude/worktrees"
g() { git -C "$REPO" "$@" >/dev/null 2>&1; }

git init -q -b main "$REPO" || exit 1
printf 'base\n' >"$REPO/base.txt"
printf '.claude/\n' >"$REPO/.gitignore"
g add base.txt .gitignore && g commit -q -m base
g commit -q --allow-empty -m "main moves on"

# add_wt NAME: branch NAME from the first commit with one commit touching NAME.txt.
add_wt() {
    g worktree add -q -b "$1" "$WT/$1" main~1
    printf '%s\n' "$1" >"$WT/$1/$1.txt"
    git -C "$WT/$1" add "$1.txt" >/dev/null 2>&1
    git -C "$WT/$1" commit -q -m "$1 change" >/dev/null 2>&1
}

# Cherry-picked onto main: not an ancestor, but patch-equivalent.
for n in picked locked dirty; do
    add_wt "$n"
    g cherry-pick "refs/heads/$n"
done
add_wt unique                       # one commit main never received
g worktree lock "$WT/locked"
printf 'wip\n' >"$WT/dirty/wip.txt" # untracked file makes it dirty
# Plain ancestor case still counts as merged.
g worktree add -q -b ancestor "$WT/ancestor" main~1

# Sanity: the cherry-picked branch really is not an ancestor of main.
if git -C "$REPO" merge-base --is-ancestor refs/heads/picked refs/heads/main; then
    fail "fixture: picked must not be an ancestor of main"
fi

out="$(cd "$REPO" && bash "$PRUNE" 2>&1)"; rc=$?
printf '%s\n' "$out" | sed 's/^/    | /'

[ "$rc" -eq 0 ] && pass "dry run exits 0" || fail "dry run exits 0 (rc=$rc)"
line_for() { printf '%s\n' "$out" | grep -F "$WT/$1 " || printf '%s\n' "$out" | grep -F "$WT/$1"; }
expect() { # expect NAME VERB
    case "$(line_for "$1")" in
        *"$2"*) pass "$1 -> $2" ;;
        *) fail "$1 -> $2 (got: $(line_for "$1"))" ;;
    esac
}
expect picked WOULD-REMOVE
expect ancestor WOULD-REMOVE
expect unique KEEP
expect locked SKIP
expect dirty KEEP

# --apply removes only the removable ones, through git worktree remove
# (which also drops the admin entry, so nothing is left "prunable").
out="$(cd "$REPO" && bash "$PRUNE" --apply 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "--apply exits 0" || fail "--apply exits 0 (rc=$rc)"
list="$(git -C "$REPO" worktree list --porcelain)"
for n in picked ancestor; do
    if [ ! -e "$WT/$n" ] && ! printf '%s\n' "$list" | grep -qF "$WT/$n"; then
        pass "--apply removed $n (dir and worktree entry gone)"
    else
        fail "--apply removed $n"
    fi
done
for n in unique locked dirty; do
    if [ -d "$WT/$n" ] && printf '%s\n' "$list" | grep -qF "$WT/$n"; then
        pass "--apply kept $n"
    else
        fail "--apply kept $n"
    fi
done
[ -f "$WT/dirty/wip.txt" ] && pass "dirty worktree's uncommitted file survives" \
    || fail "dirty worktree's uncommitted file survives"

# Removal path: git worktree remove only, never rm -rf (comment lines excluded:
# the header documents that it never uses rm -rf).
if grep -nvE '^[[:space:]]*#' "$PRUNE" | grep -E 'rm[[:space:]]+-[A-Za-z]*r'; then
    fail "script deletes with rm -r instead of git worktree remove"
else
    pass "script never deletes with rm -r"
fi
grep -q 'git worktree remove' "$PRUNE" && pass "script removes via git worktree remove" \
    || fail "script removes via git worktree remove"

# GUARDS 5: no file-age signals (stat, mtime, -mmin, -newer) anywhere in it.
if grep -nE '(^|[^A-Za-z0-9_-])(stat|mtime|-mmin|-newer)([^A-Za-z0-9_]|$)' "$PRUNE"; then
    fail "script uses a file-age signal (GUARDS 5)"
else
    pass "script uses no file-age signal (GUARDS 5)"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
