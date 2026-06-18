#!/usr/bin/env bash
# tests/test-spec-interrogation-bughunt-w4.sh
#
# Bug-hunt Wave-4 regression tests for autonomy/spec-interrogation.sh. Covers
# three confirmed bugs:
#   H4: external DB-conflict check matched driver tokens (e.g. the 2-char "pg")
#       as UNANCHORED substrings of the whole manifest blob, so "pg" matched
#       "upgrade" in package.json scripts and wrote a bogus high/contradictory
#       ledger entry on a CLEAN spec (never auto-acked -> gate never cleared ->
#       run grinds to max-iterations). Fix matches dependency NAMES (exact /
#       name-prefix), so "upgrade" no longer fires AND a real "pg" / "mysql2" /
#       "psycopg2-binary" driver still triggers (no false negative).
#   M5: reworded honest negatives ("No major concerns here") were persisted as
#       findings. Fix broadens negative detection with a proximity rule while
#       KEEPING real missing-feature findings ("No rate limiting ...").
#   M6: "* item" / "N)" / bullet-glyph finding lines were silently dropped. Fix
#       broadens the marker parser and counts unparsed lines.
#
# Self-contained: uses temp dirs, cleans up, prints [PASS]/[FAIL] per assertion,
# exits nonzero on any failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE="$SCRIPT_DIR/../autonomy/spec-interrogation.sh"

FAILURES=0
pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# Source the module under test (provides the functions; its own log_* fallbacks
# write to stderr which we keep quiet during assertions).
# shellcheck disable=SC1090
. "$MODULE" 2>/dev/null || { echo "[FAIL] could not source $MODULE"; exit 1; }

# Each test runs in its own TARGET_DIR so ledger writes are isolated.
make_workdir() { mktemp -d "${TMPDIR:-/tmp}/loki-specint-test.XXXXXX"; }

# Count high/contradictory external-check ledger entries in $1/.loki/assumptions.
count_external_contradictions() {
    local dir="$1/.loki/assumptions"
    [ -d "$dir" ] || { printf '0'; return 0; }
    local n=0 p
    for p in "$dir"/a-*.json; do
        [ -f "$p" ] || continue
        if grep -q '"source": "external-check"' "$p" 2>/dev/null \
           && grep -q '"class": "contradictory"' "$p" 2>/dev/null \
           && grep -q '"severity": "high"' "$p" 2>/dev/null; then
            n=$((n + 1))
        fi
    done
    printf '%s' "$n"
}

# ===========================================================================
# H4-1: clean spec must NOT false-fire.
# Repo has a package.json whose scripts contain "upgrade" (the "pg" substring
# trap) and NO mysql/postgres driver. Spec names mysql. The OLD code wrote a
# bogus high/contradictory external entry; the FIX must write none.
# ===========================================================================
test_h4_clean_no_false_positive() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/package.json" <<'JSON'
{
  "name": "demo-app",
  "version": "1.0.0",
  "scripts": {
    "upgrade": "npm-check-updates -u",
    "build": "webpack",
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  }
}
JSON
    cat > "$wd/spec.md" <<'SPEC'
# Order Service

The order service stores records in a MySQL database. All writes go through
the orders table. We expose a REST API for creating and listing orders.
SPEC
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_external_check "$wd/spec.md" ) >/dev/null 2>&1
    local n; n="$(count_external_contradictions "$wd")"
    if [ "$n" = "0" ]; then
        pass "H4-1 clean spec (scripts.upgrade, no driver) writes NO external contradiction"
    else
        fail "H4-1 clean spec false-fired: $n external contradiction(s) written (the 'pg'/'mysql' substring bug)"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# H4-2: real conflict must STILL fire (no false negative / over-correction).
# Repo declares a real "pg" dependency (postgres driver); spec names mysql and
# does NOT name postgres. That is an unambiguous spec-vs-repo conflict.
# ===========================================================================
test_h4_real_pg_conflict_still_fires() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/package.json" <<'JSON'
{
  "name": "store",
  "version": "1.0.0",
  "dependencies": {
    "pg": "^8.11.0",
    "express": "^4.18.0"
  }
}
JSON
    cat > "$wd/spec.md" <<'SPEC'
# Inventory Service

Persist inventory in a MySQL database. The schema lives in the products table.
SPEC
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_external_check "$wd/spec.md" ) >/dev/null 2>&1
    local n; n="$(count_external_contradictions "$wd")"
    if [ "$n" = "1" ]; then
        pass "H4-2 real 'pg' driver + mysql spec STILL fires the external contradiction"
    else
        fail "H4-2 real conflict did not fire (expected 1, got $n) -- over-correction / false negative"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# H4-3: name-PREFIX driver variant must still match (mysql2 / psycopg2-binary).
# Guards against a -w / exact-only over-correction that would pass H4-2 but miss
# versioned driver package names. Repo declares "mysql2"; spec names postgres.
# ===========================================================================
test_h4_prefix_variant_fires() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/package.json" <<'JSON'
{
  "name": "svc",
  "version": "1.0.0",
  "dependencies": {
    "mysql2": "^3.6.0"
  }
}
JSON
    cat > "$wd/spec.md" <<'SPEC'
# Reporting Service

Store reporting aggregates in a PostgreSQL database.
SPEC
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_external_check "$wd/spec.md" ) >/dev/null 2>&1
    local n; n="$(count_external_contradictions "$wd")"
    if [ "$n" = "1" ]; then
        pass "H4-3 name-prefix driver variant 'mysql2' still matches the mysql engine"
    else
        fail "H4-3 prefix variant 'mysql2' did not match (expected 1, got $n) -- anchoring over-corrected"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# H4-4: requirements.txt prefix variant (psycopg2-binary) must match postgres.
# ===========================================================================
test_h4_requirements_prefix_fires() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/requirements.txt" <<'REQ'
flask==2.3.0
psycopg2-binary==2.9.9
gunicorn==21.2.0
REQ
    cat > "$wd/spec.md" <<'SPEC'
# Billing Service

The billing service uses a MySQL database for invoices.
SPEC
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_external_check "$wd/spec.md" ) >/dev/null 2>&1
    local n; n="$(count_external_contradictions "$wd")"
    if [ "$n" = "1" ]; then
        pass "H4-4 requirements.txt 'psycopg2-binary' matches postgres (mysql spec conflict fires)"
    else
        fail "H4-4 'psycopg2-binary' prefix did not match (expected 1, got $n)"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M5: reworded honest negative under a security section is NOT persisted.
# "No major concerns here" must be skipped (clean spec stays clean).
# Also assert a real missing-feature finding ("No rate limiting ...") IS kept.
# ===========================================================================
test_m5_negative_skipped_realfinding_kept() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
## Grill findings

### Security blind spots

1. No major concerns here.
2. No rate limiting on the login endpoint.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    # Negative skipped: no entry whose gap is the "No major concerns" line.
    if ! grep -rqi 'no major concerns' "$dir" 2>/dev/null; then
        pass "M5 'No major concerns here' is skipped (not persisted)"
    else
        fail "M5 'No major concerns here' was persisted as a finding"
    fi
    # Real missing-feature finding kept.
    if grep -rqi 'rate limiting' "$dir" 2>/dev/null; then
        pass "M5 real finding 'No rate limiting ...' is KEPT (disambiguation correct)"
    else
        fail "M5 real finding 'No rate limiting ...' was wrongly dropped"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M5-b: a couple more reworded negatives are skipped.
# ===========================================================================
test_m5_more_negatives_skipped() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

1. Nothing stands out here.
2. This section looks complete.
3. No security issues identified.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    local total=0 p
    if [ -d "$dir" ]; then
        for p in "$dir"/a-*.json; do [ -f "$p" ] && total=$((total + 1)); done
    fi
    if [ "$total" = "0" ]; then
        pass "M5-b reworded negatives (nothing stands out / looks complete / no security issues) all skipped"
    else
        fail "M5-b expected 0 persisted findings, got $total"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6: "* something ambiguous" bullet line is parsed (persisted), not dropped.
# ===========================================================================
test_m6_star_bullet_parsed() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

* The retention window for audit logs is not specified anywhere.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    if grep -rqi 'retention window' "$dir" 2>/dev/null; then
        pass "M6 '* ...' bullet finding is parsed (not silently dropped)"
    else
        fail "M6 '* ...' bullet finding was silently dropped"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6-b: numbered ")" and ":" forms parse; indented "  - " parses.
# ===========================================================================
test_m6_other_markers_parsed() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

1) The pagination page size default is undefined.
2: The currency for prices is not stated.
  - Indented dash item about timezone handling.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    local ok=0
    grep -rqi 'pagination page size' "$dir" 2>/dev/null && ok=$((ok + 1))
    grep -rqi 'currency for prices' "$dir" 2>/dev/null && ok=$((ok + 1))
    grep -rqi 'timezone handling' "$dir" 2>/dev/null && ok=$((ok + 1))
    if [ "$ok" = "3" ]; then
        pass "M6-b 'N)' / 'N:' / indented '  - ' markers all parsed (3/3)"
    else
        fail "M6-b broadened markers parsed only $ok/3"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6-c: existing "N. " and "- " behavior unchanged (regression guard).
# ===========================================================================
test_m6_existing_markers_unchanged() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

1. The classic numbered finding about webhook retries.
- The classic dash finding about idempotency keys.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    local ok=0
    grep -rqi 'webhook retries' "$dir" 2>/dev/null && ok=$((ok + 1))
    grep -rqi 'idempotency keys' "$dir" 2>/dev/null && ok=$((ok + 1))
    if [ "$ok" = "2" ]; then
        pass "M6-c existing 'N. ' and '- ' markers still parse (2/2)"
    else
        fail "M6-c existing markers regressed ($ok/2)"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6-e: "+ " markdown bullet parses (newly supported marker).
# ===========================================================================
test_m6_plus_bullet_parsed() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

+ The plus-bullet finding about soft-delete semantics.
MD
    ( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" ) >/dev/null 2>&1
    local dir="$wd/.loki/assumptions"
    if grep -rqi 'soft-delete semantics' "$dir" 2>/dev/null; then
        pass "M6-e '+ ' markdown bullet finding is parsed"
    else
        fail "M6-e '+ ' bullet finding was not parsed"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6-f: an exotic Unicode bullet glyph is NOT silently lost -- it falls through
# to the unparsed counter and is warned (we deliberately do NOT glob-match
# multibyte glyphs on bash 3.2; the counter is the safety net).
# ===========================================================================
test_m6_unicode_glyph_counted() {
    local wd; wd="$(make_workdir)"
    # U+2022 BULLET followed by a space, then finding text.
    printf '### Ambiguities\n\n\xe2\x80\xa2 Unicode-bullet finding about cache TTL.\n' > "$wd/report.md"
    local out
    out="$( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" 2>&1 )"
    if printf '%s' "$out" | grep -qi 'did not match a known list marker'; then
        pass "M6-f exotic Unicode bullet glyph is counted + warned (not silently lost)"
    else
        fail "M6-f Unicode bullet glyph was neither parsed nor surfaced via the counter"
    fi
    rm -rf "$wd"
}

# ===========================================================================
# M6-d: unparsed-line counter warns (non-empty section line with no marker).
# ===========================================================================
test_m6_unparsed_counter_warns() {
    local wd; wd="$(make_workdir)"
    cat > "$wd/report.md" <<'MD'
### Ambiguities

This is a prose line under a finding heading with no list marker at all.
MD
    local out
    out="$( cd "$wd" && TARGET_DIR="$wd" spec_interrogation_classify_report "$wd/report.md" 2>&1 )"
    if printf '%s' "$out" | grep -qi 'did not match a known list marker'; then
        pass "M6-d unparsed prose line under a section is counted + warned (no silent loss)"
    else
        fail "M6-d unparsed line was not surfaced via the warn counter"
    fi
    rm -rf "$wd"
}

echo "=== spec-interrogation bug-hunt W4 ==="
test_h4_clean_no_false_positive
test_h4_real_pg_conflict_still_fires
test_h4_prefix_variant_fires
test_h4_requirements_prefix_fires
test_m5_negative_skipped_realfinding_kept
test_m5_more_negatives_skipped
test_m6_star_bullet_parsed
test_m6_other_markers_parsed
test_m6_existing_markers_unchanged
test_m6_plus_bullet_parsed
test_m6_unicode_glyph_counted
test_m6_unparsed_counter_warns

echo "==="
if [ "$FAILURES" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
else
    echo "$FAILURES assertion(s) FAILED"
    exit 1
fi
