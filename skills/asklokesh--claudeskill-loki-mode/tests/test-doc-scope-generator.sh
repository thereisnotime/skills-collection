#!/usr/bin/env bash
# tests/test-doc-scope-generator.sh -- verifies the GENERATOR + GATE halves of
# F52 doc-scope in autonomy/run.sh (companion to test-doc-scope-build-prompt.sh,
# which covers the prompt half).
#
# The prompt half tells the agent "simple -> README + USAGE only". But the
# architecture suite for a simple project was actually produced by a SEPARATE
# unconditional path: auto_generate_docs_if_needed() -> 'loki docs generate',
# which runs the provider agentically and writes ARCHITECTURE/API/COMPONENTS/
# DECISIONS/SETUP/TESTING to the project (~270s of pure burn for a 5-line CLI).
# Two guards close it:
#   1. auto_generate_docs_if_needed(): DETECTED_COMPLEXITY==simple -> return 0
#      WITHOUT invoking 'loki docs generate' (no architecture suite generated).
#   2. run_doc_quality_gate(): DETECTED_COMPLEXITY==simple -> score on
#      README + USAGE only (do NOT penalize the intentionally-absent .loki/docs/
#      manifest or API.md), so skipping generation does not fail Gate 7.
#
# standard/complex tiers keep the full suite + the full gate (quality at any
# complexity is preserved).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0
FAIL=0
TMPROOT=""

ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup() {
    [ -n "$TMPROOT" ] && [ -d "$TMPROOT" ] && rm -rf "$TMPROOT"
}
trap cleanup EXIT

TMPROOT=$(mktemp -d -t loki-doc-scope-gen-XXXX)

# ---------------------------------------------------------------------------
# Harness: build a fake project dir with a fake 'loki' binary whose only job is
# to record that 'docs generate' was invoked (touch a sentinel). This lets us
# assert the generator is/ isn't called WITHOUT a real provider round-trip.
# ---------------------------------------------------------------------------
make_project() {
    local dir="$1"
    rm -rf "$dir"; mkdir -p "$dir/.loki/state" "$dir/bin"
    # git repo so rev-list calls inside the functions do not error out.
    git -C "$dir" init -q 2>/dev/null
    git -C "$dir" config user.email t@t.t 2>/dev/null
    git -C "$dir" config user.name t 2>/dev/null
    # A README + USAGE (what the SIMPLE prompt yields).
    printf '# proj\ninstall + run\n' > "$dir/README.md"
    printf '# Usage\nrun it\n'        > "$dir/USAGE.md"
    # package.json so run_doc_quality_gate's "package -> needs API.md" check fires.
    printf '{"name":"p"}\n'           > "$dir/package.json"
    git -C "$dir" add -A 2>/dev/null; git -C "$dir" commit -qm init 2>/dev/null
}

# Fake 'loki' that records invocation of 'docs generate' AND (like the real
# agentic path) writes an architecture-suite file to the project, so we can
# prove it was NOT called for simple tier.
install_fake_loki() {
    local dir="$1"
    cat > "$dir/bin/loki" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "docs" ] && [ "$2" = "generate" ]; then
    proj="$3"
    echo "GENERATED" > "$proj/.docs_generate_called"
    mkdir -p "$proj/.loki/docs"
    printf '{"git_sha":"deadbeef"}' > "$proj/.loki/docs/docs-manifest.json"
    printf '# API\n' > "$proj/API.md"           # simulates agentic root pollution
    printf '# Architecture\n' > "$proj/ARCHITECTURE.md"
fi
exit 0
FAKE
    chmod +x "$dir/bin/loki"
}

# run_gen <project_dir> <complexity> -- source run.sh, point SCRIPT_DIR at the
# fake loki, set DETECTED_COMPLEXITY, call auto_generate_docs_if_needed.
run_gen() {
    local dir="$1" complexity="$2"
    (
        # shellcheck disable=SC1090
        source "$RUN_SH" >/dev/null 2>&1
        SCRIPT_DIR="$dir/bin"          # so "$SCRIPT_DIR/loki" is the fake
        TARGET_DIR="$dir"
        DETECTED_COMPLEXITY="$complexity"
        LOKI_AUTO_DOCS="true"
        auto_generate_docs_if_needed >/dev/null 2>&1
    )
}

# run_gate <project_dir> <complexity> -- returns the gate's exit status.
run_gate() {
    local dir="$1" complexity="$2"
    (
        # shellcheck disable=SC1090
        source "$RUN_SH" >/dev/null 2>&1
        TARGET_DIR="$dir"
        DETECTED_COMPLEXITY="$complexity"
        LOKI_AUTO_DOCS="true"
        run_doc_quality_gate "$dir" >/dev/null 2>&1
    )
}

# ---------------------------------------------------------------------------
# GENERATOR: simple tier must NOT invoke 'loki docs generate'
# ---------------------------------------------------------------------------
P="$TMPROOT/simple"
make_project "$P"; install_fake_loki "$P"
run_gen "$P" "simple"
if [ -f "$P/.docs_generate_called" ]; then
    bad "generator simple: 'loki docs generate' WAS called (architecture suite generated for trivial project)"
else
    ok "generator simple: architecture suite skipped (no 'loki docs generate')"
fi

# GENERATOR: standard tier MUST still invoke it (quality at any complexity)
P="$TMPROOT/standard"
make_project "$P"; install_fake_loki "$P"
run_gen "$P" "standard"
if [ -f "$P/.docs_generate_called" ]; then
    ok "generator standard: architecture suite still generated"
else
    bad "generator standard: suite NOT generated (regression -- full-tier docs weakened)"
fi

# GENERATOR: complex tier MUST still invoke it
P="$TMPROOT/complex"
make_project "$P"; install_fake_loki "$P"
run_gen "$P" "complex"
if [ -f "$P/.docs_generate_called" ]; then
    ok "generator complex: architecture suite still generated"
else
    bad "generator complex: suite NOT generated (regression)"
fi

# ---------------------------------------------------------------------------
# GATE: simple tier passes on README + USAGE alone (NO .loki/docs suite),
# so skipping generation does not fail Gate 7.
# ---------------------------------------------------------------------------
P="$TMPROOT/gate-simple"
make_project "$P"                 # README + USAGE + package.json, NO .loki/docs
if run_gate "$P" "simple"; then
    ok "gate simple: PASS on README + USAGE (no architecture suite required)"
else
    bad "gate simple: FAILED despite README + USAGE present (would force wasted iterations)"
fi

# GATE: simple tier with README present but USAGE missing -> still >=70 (only
# -20 for USAGE) so PASS, but a simple project MISSING README must fail.
P="$TMPROOT/gate-simple-noreadme"
make_project "$P"; rm -f "$P/README.md"; rm -f "$P/USAGE.md"
if run_gate "$P" "simple"; then
    bad "gate simple: PASS with BOTH README and USAGE missing (score should be 60 < 70)"
else
    ok "gate simple: FAIL when both README and USAGE missing (score 60 < 70)"
fi

# GATE: standard tier still enforces the full-suite checks -- a standard project
# with NO .loki/docs manifest AND a package.json (no API.md) scores 100-10-15=75
# (PASS) but the full-suite code path (not the simple short-circuit) must run.
# Assert standard still PASSES with a manifest+API present (full path healthy).
P="$TMPROOT/gate-standard"
make_project "$P"
mkdir -p "$P/.loki/docs"
printf '{"git_sha":"%s"}' "$(git -C "$P" rev-parse HEAD)" > "$P/.loki/docs/docs-manifest.json"
printf '# API\n' > "$P/.loki/docs/API.md"
if run_gate "$P" "standard"; then
    ok "gate standard: PASS with full .loki/docs suite (full-tier gate healthy)"
else
    bad "gate standard: FAILED with full suite present (regression)"
fi

echo
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
