#!/usr/bin/env bash
# test-prd-reuse-bash-w4.sh
#
# FEAT-PRD-REUSE (bash slice, Agent C). Exercises the REAL function bodies in
# autonomy/run.sh -- persist_user_prd() and decide_generated_prd_action() -- by
# sourcing run.sh (its main() is guarded by a BASH_SOURCE==$0 check, so sourcing
# defines the functions WITHOUT running the orchestrator). No reimplementation:
# the assertions call the actual functions in throwaway temp repos.
#
# Coverage (matches plan AC1-AC7 for the bash route):
#   AC1 user file persists byte-equal into .loki/generated-prd.md, prd-signature
#       source==user, origin_path set.
#   AC2 after AC1, a no-file (empty prd_path) rerun -> decide returns user_owned
#       (NOT generate, NOT update); reuse without re-running codebase analysis.
#   AC3 after AC1, a DIFFERENT file overwrites .loki/generated-prd.md with the
#       new content, source stays user, origin_path updates.
#   AC4 fresh dir, no file -> decide returns generate (analysis mode); source not
#       forced to user.
#   AC7 source=user + a changed codebase signature still returns user_owned (NOT
#       update) -- the LOCK 2 guarantee.
#
# Non-vacuity: AC4 proves the same decide() that returns user_owned for a user
# PRD returns generate with no state; AC7 mutates the tree AFTER persisting to
# prove the user_owned verdict is NOT a stale signature-match accident.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

FAILS=0
pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; FAILS=$((FAILS + 1)); }

[ -f "$RUN_SH" ] || { echo "[FAIL] cannot find $RUN_SH"; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/loki-prdreuse-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Source run.sh from a throwaway dir so any boot-time top-level code writes there,
# never the repo root (hermetic under local-ci). main() is guarded, so nothing
# runs. Silence boot-time log noise.
cd "$TMP" || { echo "[FAIL] cannot cd to temp dir"; exit 1; }
# shellcheck disable=SC1090
source "$RUN_SH" >/dev/null 2>&1

# Confirm the functions under test actually exist (a rename would otherwise make
# this whole test silently vacuous).
type persist_user_prd            >/dev/null 2>&1 || { echo "[FAIL] persist_user_prd not defined by run.sh"; exit 1; }
type decide_generated_prd_action >/dev/null 2>&1 || { echo "[FAIL] decide_generated_prd_action not defined by run.sh"; exit 1; }
type compute_codebase_signature  >/dev/null 2>&1 || { echo "[FAIL] compute_codebase_signature not defined by run.sh"; exit 1; }

# Read a field from prd-signature.json without depending on jq.
sig_field() {
    local file="$1" key="$2"
    LOKI_F="$file" LOKI_K="$key" python3 -c "
import json, os
try:
    print(json.load(open(os.environ['LOKI_F'])).get(os.environ['LOKI_K'],''))
except Exception:
    print('')
" 2>/dev/null
}

# Build a fresh non-git project tree (force the files-signature path so codebase
# mutations are deterministically detectable). Echoes the absolute dir.
make_repo() {
    local d
    d="$(mktemp -d "$TMP/repo.XXXXXX")"
    printf 'name=demo\n' > "$d/manifest.txt"
    printf 'print("v1")\n' > "$d/app.py"
    echo "$d"
}

# =====================================================================
# AC1: user file persists byte-equal + source:user + origin_path set.
# =====================================================================
REPO1="$(make_repo)"
USER_PRD="$TMP/my-prd.md"
printf '# My Product\n\nBuild a thing.\n' > "$USER_PRD"

export TARGET_DIR="$REPO1"
out1="$(persist_user_prd "$USER_PRD")"

if [ "$out1" = ".loki/generated-prd.md" ]; then
    pass "AC1: persist_user_prd echoes canonical path"
else
    fail "AC1: persist_user_prd echoed '$out1', expected '.loki/generated-prd.md'"
fi

if [ -f "$REPO1/.loki/generated-prd.md" ] && cmp -s "$USER_PRD" "$REPO1/.loki/generated-prd.md"; then
    pass "AC1: generated-prd.md byte-equals the user file"
else
    fail "AC1: generated-prd.md missing or not byte-equal to the user file"
fi

SIG1="$REPO1/.loki/state/prd-signature.json"
if [ -f "$SIG1" ]; then
    pass "AC1: prd-signature.json written"
else
    fail "AC1: prd-signature.json not written"
fi

src1="$(sig_field "$SIG1" source)"
if [ "$src1" = "user" ]; then
    pass "AC1: signature source == user"
else
    fail "AC1: signature source == '$src1', expected 'user'"
fi

origin1="$(sig_field "$SIG1" origin_path)"
if [ "$origin1" = "$USER_PRD" ]; then
    pass "AC1: origin_path == the user arg"
else
    fail "AC1: origin_path == '$origin1', expected '$USER_PRD'"
fi

prdsha1="$(sig_field "$SIG1" prd_sha)"
if [ -n "$prdsha1" ]; then
    pass "AC1: prd_sha recorded (non-empty)"
else
    fail "AC1: prd_sha empty"
fi

# =====================================================================
# AC2: no-file rerun -> decide returns user_owned (reuse as-is, no analysis).
# =====================================================================
# TARGET_DIR is still REPO1; decide reads ${TARGET_DIR}/.loki/state/prd-signature.json.
act2="$(decide_generated_prd_action)"
case "$act2" in
    user_owned)
        pass "AC2: decide returns user_owned (reuse, not generate/update)"
        ;;
    *)
        fail "AC2: decide returned '$act2', expected 'user_owned'"
        ;;
esac

# =====================================================================
# AC3: a DIFFERENT file overwrites generated-prd.md; source stays user;
#      origin_path updates.
# =====================================================================
USER_PRD2="$TMP/my-prd-v2.md"
printf '# My Product v2\n\nNow with MORE things and different content.\n' > "$USER_PRD2"

out3="$(persist_user_prd "$USER_PRD2")"
if [ "$out3" = ".loki/generated-prd.md" ] \
   && cmp -s "$USER_PRD2" "$REPO1/.loki/generated-prd.md"; then
    pass "AC3: generated-prd.md overwritten byte-equal with the new file"
else
    fail "AC3: generated-prd.md not overwritten with the new file content"
fi

# Confirm it is NOT the old content anymore (non-vacuity).
if cmp -s "$USER_PRD" "$REPO1/.loki/generated-prd.md"; then
    fail "AC3: generated-prd.md still holds the OLD content"
else
    pass "AC3: old content no longer present (genuine overwrite)"
fi

src3="$(sig_field "$SIG1" source)"
if [ "$src3" = "user" ]; then
    pass "AC3: source stays user after overwrite"
else
    fail "AC3: source == '$src3' after overwrite, expected 'user'"
fi

origin3="$(sig_field "$SIG1" origin_path)"
if [ "$origin3" = "$USER_PRD2" ]; then
    pass "AC3: origin_path updated to the new file"
else
    fail "AC3: origin_path == '$origin3', expected '$USER_PRD2'"
fi

# =====================================================================
# AC4: fresh dir, no file -> decide returns generate; source not forced user.
# =====================================================================
REPO4="$(make_repo)"
export TARGET_DIR="$REPO4"
act4="$(decide_generated_prd_action)"
if [ "$act4" = "generate" ]; then
    pass "AC4: fresh dir, no PRD -> decide returns generate"
else
    fail "AC4: decide returned '$act4', expected 'generate'"
fi
# And no signature file exists (source not fabricated).
if [ ! -f "$REPO4/.loki/state/prd-signature.json" ]; then
    pass "AC4: no prd-signature.json on a fresh dir (source not forced user)"
else
    fail "AC4: unexpected prd-signature.json on a fresh dir"
fi

# =====================================================================
# AC7: source=user + a CHANGED codebase signature still returns user_owned
#      (LOCK 2: a user PRD never enters the update path on codebase drift).
# =====================================================================
REPO7="$(make_repo)"
USER_PRD7="$TMP/my-prd-7.md"
printf '# Locked PRD\n\nUser owned, must never auto-update.\n' > "$USER_PRD7"
export TARGET_DIR="$REPO7"
persist_user_prd "$USER_PRD7" >/dev/null

# Capture the stored signature, then mutate the tree so the live signature
# DIFFERS. Prove the divergence is real before asserting the verdict.
stored7="$(sig_field "$REPO7/.loki/state/prd-signature.json" signature)"
printf 'print("v2 changed")\nextra = True\n' > "$REPO7/app.py"
printf 'brand new module\n' > "$REPO7/newfile.py"
live7="$(compute_codebase_signature "$REPO7")"
if [ -n "$stored7" ] && [ "$stored7" != "$live7" ]; then
    pass "AC7: codebase signature genuinely changed after mutation (non-vacuous)"
else
    fail "AC7: signature did not change after mutation (test would be vacuous): stored='$stored7' live='$live7'"
fi

act7="$(decide_generated_prd_action)"
case "$act7" in
    user_owned)
        pass "AC7: source=user + changed codebase -> user_owned (NOT update)"
        ;;
    *)
        fail "AC7: decide returned '$act7' after codebase change, expected 'user_owned'"
        ;;
esac

unset TARGET_DIR

echo ""
if [ "$FAILS" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
else
    echo "$FAILS assertion(s) FAILED"
    exit 1
fi
