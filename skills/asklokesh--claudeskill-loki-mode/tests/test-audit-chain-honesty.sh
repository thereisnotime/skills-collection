#!/usr/bin/env bash
# The audit chain must not be described as tamper-proof, because it is not.
#
# MEASURED, not argued: both chain implementations accept a fully re-forged
# history. The hash is unkeyed and the genesis is a constant, so every input to
# the hash is available to whoever can write the log. Reproduced here, and
# documented in docs/AUDIT-CHAIN-THREAT-MODEL.md.
#
# This suite guards two things:
#   1. The PROPERTY. If someone later adds a keyed MAC or an external witness,
#      case 1 turns red and this file must be rewritten to match the new truth.
#      That is the intended behaviour: the test tracks reality, not a wish.
#   2. The CLAIM. Buyer-facing surfaces must not call it tamper-proof.
#
# Case 1 asserts entries were ACTUALLY CHECKED, never merely that a verdict came
# back. A first version of this reproduction guessed the entry schema, and the
# verifier returned valid=false with entries_checked=0 -- it had rejected the
# probe, not detected tampering. Asserting the verdict alone would have recorded
# a false all-clear.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-audit-chain-honesty"

# 1. The dashboard chain accepts a re-forged history. If this ever stops being
#    true the claim may be strengthened -- and this test must be updated with it.
if ! command -v python3 >/dev/null 2>&1; then
    echo "  SKIP: python3 unavailable; cannot run the forgery reproduction"
else
    FORGE_OUT="$(python3 - <<'PY' 2>&1
import os, json, hashlib, tempfile, importlib.util
try:
    spec = importlib.util.spec_from_file_location("audit", "dashboard/audit.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
except Exception as e:
    print("UNREADABLE %s" % type(e).__name__)
    raise SystemExit

d = tempfile.mkdtemp()
f = os.path.join(d, "audit-forged.jsonl")

# Forge with the writer's EXACT recipe (dashboard/audit.py:369-371).
prev = "0" * 64
out = []
for what in ["NEVER HAPPENED", "ALSO FORGED"]:
    entry = {"timestamp": "2020-01-01T00:00:00Z", "user": "system", "action": what}
    ej = json.dumps(entry, sort_keys=True, default=str)
    entry["_integrity_hash"] = hashlib.sha256((prev + ej).encode()).hexdigest()
    prev = entry["_integrity_hash"]
    out.append(json.dumps(entry))
open(f, "w").write("\n".join(out) + "\n")

r = m.verify_log_integrity(f)
# entries_checked is load-bearing: a schema rejection also yields valid=False.
print("VERDICT %s %s" % (r.get("valid"), r.get("entries_checked")))
PY
)"
    case "$FORGE_OUT" in
        "VERDICT True 2")
            pass "re-forged history is accepted (valid=True over 2 checked entries): the chain is NOT tamper-proof"
            ;;
        "VERDICT False "*)
            fail "the chain now REJECTS a re-forge ($FORGE_OUT). If a keyed MAC or witness was added, update this suite AND the docs, which currently say it is not tamper-proof"
            ;;
        "UNREADABLE"*)
            fail "could not load dashboard/audit.py to measure the property ($FORGE_OUT) -- unmeasured, not clean"
            ;;
        *)
            fail "forgery probe produced no usable verdict: $FORGE_OUT"
            ;;
    esac
fi

# 2. Buyer-facing surfaces must not assert tamper-proofness. Marker-PRESENCE on
#    the honest caveat, not phrase-absence: a bare grep for "tamper" fires on
#    the caveat text itself, which is the trap that shipped in v9.28.0.
for f in wiki/Enterprise.md wiki/Security.md wiki/Home.md; do
    if [ ! -f "$f" ]; then
        fail "$f is missing; cannot verify its claim"
    elif grep -q 'AUDIT-CHAIN-THREAT-MODEL' "$f"; then
        pass "$f points at the threat model"
    else
        fail "$f describes the audit chain without pointing at the threat model"
    fi
done

# 3. Nothing anywhere may CLAIM tamper-proof. Delegated to
#    tests/lib/scan-tamper-claims.py, which matches per OCCURRENCE rather than
#    per line. A line-level negative filter is exploitable and was: inserting
#    "tamper-proof" into a line that already read "not tamper-proof against ..."
#    exempted the whole line and the mutation test stayed GREEN.
#    Exit contract: 0 clean, 1 claims found, 2 UNMEASURED (never read as clean).
if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: the tamper-proof claim scan did not run (unmeasured, not clean)"
else
    TP="$(python3 tests/lib/scan-tamper-claims.py . 2>&1)"; TP_RC=$?
    case "$TP_RC" in
        0) pass "no surface claims the chain is tamper-proof" ;;
        1) fail "tamper-proof claim found: $(printf '%s' "$TP" | head -2 | tr '\n' ' ')" ;;
        *) fail "claim scan could not run (rc=$TP_RC): $TP -- unmeasured, not clean" ;;
    esac
fi

# 4. The threat model itself must carry the reproduction, not just an assertion.
#    A threat model that only asserts is the same defect one level up.
if [ ! -f docs/AUDIT-CHAIN-THREAT-MODEL.md ]; then
    fail "docs/AUDIT-CHAIN-THREAT-MODEL.md is missing"
elif grep -q 'NEVER HAPPENED' docs/AUDIT-CHAIN-THREAT-MODEL.md \
     && grep -q 'entries_checked' docs/AUDIT-CHAIN-THREAT-MODEL.md; then
    pass "the threat model carries the reproduction and the entries_checked caveat"
else
    fail "the threat model does not show the reproduced forgery"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
