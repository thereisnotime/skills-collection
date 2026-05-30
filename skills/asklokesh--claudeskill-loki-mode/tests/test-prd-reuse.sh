#!/usr/bin/env bash
# v7.8.1 regression test: staleness-aware generated-PRD reuse.
# The codebase signature + decision logic decides reuse|update|generate on a
# no-PRD run so the generated PRD is reused when the codebase is unchanged and
# only updated (not regenerated) when it changed.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/autonomy/run.sh"

# --- static wiring -----------------------------------------------------------
grep -q 'compute_codebase_signature()' "$SRC" \
  && ok "run.sh defines compute_codebase_signature" || bad "no compute_codebase_signature"
grep -q 'decide_generated_prd_action()' "$SRC" \
  && ok "run.sh defines decide_generated_prd_action" || bad "no decide_generated_prd_action"
grep -q 'persist_prd_signature_if_present "\$exit_code"' "$SRC" \
  && ok "run.sh CALLS persist_prd_signature_if_present post-iteration" || bad "persist not called"
grep -q 'GENERATED_PRD_UPDATE_MODE' "$SRC" \
  && ok "run.sh has the incremental update_instruction" || bad "no update_instruction"
grep -q 'three passes' "$SRC" \
  && ok "run.sh has the improved 3-pass analysis instruction" || bad "analysis instruction not improved"
grep -q 'regen-prd' "$REPO_ROOT/autonomy/loki" \
  && grep -q 'export LOKI_PRD_REGEN=1' "$REPO_ROOT/autonomy/loki" \
  && ok "loki --regen-prd exports LOKI_PRD_REGEN=1" || bad "--regen-prd not wired"

bash -n "$SRC" && ok "autonomy/run.sh passes bash -n" || bad "run.sh syntax error"
bash -n "$REPO_ROOT/autonomy/loki" && ok "autonomy/loki passes bash -n" || bad "loki syntax error"

# --- functional: load the helpers and exercise them --------------------------
eval "$(awk '/^_loki_hash_stdin\(\)/,/^}/' "$SRC")"
eval "$(awk '/^compute_codebase_signature\(\)/,/^}/' "$SRC")"
eval "$(awk '/^decide_generated_prd_action\(\)/,/^}/' "$SRC")"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/loki-prdreuse-XXXXXX")
( cd "$WORK" && git init -q && git config user.email t@t && git config user.name t \
  && echo "print(1)" > app.py && git add app.py && git commit -qm init ) 2>/dev/null
mkdir -p "$WORK/.loki/state"

SIG1=$(compute_codebase_signature "$WORK")
SIG2=$(compute_codebase_signature "$WORK")
[ -n "$SIG1" ] && [ "$SIG1" = "$SIG2" ] && ok "signature is deterministic" || bad "signature not stable ($SIG1 vs $SIG2)"

# .loki churn must NOT change the signature
mkdir -p "$WORK/.loki/logs"; echo noise > "$WORK/.loki/logs/x.log"; echo s > "$WORK/.loki/state/y.json"
SIG_AFTER_CHURN=$(compute_codebase_signature "$WORK")
[ "$SIG1" = "$SIG_AFTER_CHURN" ] && ok "signature ignores .loki churn" || bad "signature changed on .loki churn"

# a real edit (uncommitted) must change the signature
echo "y=2" >> "$WORK/app.py"
SIG_EDIT=$(compute_codebase_signature "$WORK")
[ "$SIG1" != "$SIG_EDIT" ] && ok "signature detects an uncommitted edit" || bad "signature missed an edit"
( cd "$WORK" && git checkout -q app.py ) 2>/dev/null

# an untracked NEW file must change the signature (no false reuse)
echo "new" > "$WORK/newfile.py"
SIG_UNTRACKED=$(compute_codebase_signature "$WORK")
[ "$SIG1" != "$SIG_UNTRACKED" ] && ok "signature detects an untracked new file" || bad "signature missed an untracked file"
rm -f "$WORK/newfile.py"

# decision: no generated PRD -> generate
[ "$(TARGET_DIR="$WORK" decide_generated_prd_action)" = "generate" ] \
  && ok "decision: no generated PRD -> generate" || bad "decision: expected generate (first run)"

# generated PRD, no signature -> update
echo "# prd" > "$WORK/.loki/generated-prd.md"
[ "$(TARGET_DIR="$WORK" decide_generated_prd_action)" = "update" ] \
  && ok "decision: PRD present but no signature -> update" || bad "decision: expected update (no provenance)"

# matching signature -> reuse
CUR=$(compute_codebase_signature "$WORK")
printf '{"signature":"%s"}\n' "$CUR" > "$WORK/.loki/state/prd-signature.json"
[ "$(TARGET_DIR="$WORK" decide_generated_prd_action)" = "reuse" ] \
  && ok "decision: signature matches -> reuse" || bad "decision: expected reuse (unchanged)"

# codebase changed -> update
echo "z=3" >> "$WORK/app.py"
[ "$(TARGET_DIR="$WORK" decide_generated_prd_action)" = "update" ] \
  && ok "decision: codebase changed -> update" || bad "decision: expected update (changed)"
( cd "$WORK" && git checkout -q app.py ) 2>/dev/null

# force regen
[ "$(TARGET_DIR="$WORK" LOKI_PRD_REGEN=1 decide_generated_prd_action)" = "generate" ] \
  && ok "decision: LOKI_PRD_REGEN=1 -> generate (force)" || bad "decision: expected generate (forced)"

# back-to-back with no change -> still reuse (no perpetual update)
printf '{"signature":"%s"}\n' "$(compute_codebase_signature "$WORK")" > "$WORK/.loki/state/prd-signature.json"
[ "$(TARGET_DIR="$WORK" decide_generated_prd_action)" = "reuse" ] \
  && ok "decision: back-to-back unchanged -> reuse (no perpetual update)" || bad "decision: perpetual update detected"

# --- non-git fallback: prunes .loki, deterministic ---------------------------
NG=$(mktemp -d "${TMPDIR:-/tmp}/loki-prdreuse-ng-XXXXXX")
echo "a" > "$NG/a.py"; mkdir -p "$NG/.loki/state"
NG1=$(compute_codebase_signature "$NG")
echo "noise" > "$NG/.loki/state/churn.json"
NG2=$(compute_codebase_signature "$NG")
case "$NG1" in files:*) ok "non-git fallback uses files: mode" ;; *) bad "non-git mode wrong: $NG1" ;; esac
[ "$NG1" = "$NG2" ] && ok "non-git fallback prunes .loki (stable)" || bad "non-git .loki not pruned"
echo "b" > "$NG/b.py"
NG3=$(compute_codebase_signature "$NG")
[ "$NG1" != "$NG3" ] && ok "non-git fallback detects a new file" || bad "non-git missed a new file"
rm -rf "$NG"

rm -rf "$WORK"

# --- no em dashes ------------------------------------------------------------
if grep -lP '\xe2\x80\x94' "$SRC" "$REPO_ROOT/autonomy/loki" "$SCRIPT_DIR/test-prd-reuse.sh" >/dev/null 2>&1; then
    bad "em dash found in changed files"
else
    ok "no em dashes in changed files"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
