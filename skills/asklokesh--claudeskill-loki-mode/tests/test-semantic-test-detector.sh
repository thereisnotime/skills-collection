#!/usr/bin/env bash
# Tests for tests/detect-semantic-test-problems.sh (Quality Gate #10).
# Verifies the semantic test-authenticity detector:
#   1. A genuinely-fake test (literal echoed through a variable) -> flagged HIGH.
#   2. A legitimate test (real computed assertion) -> NOT flagged (clean).
#   3. LOKI_SCAN_DIR redirect: the detector scans the target dir, not its repo.
#   4. Mock-return echo -> flagged MEDIUM (not HIGH; non-blocking under --strict).
#
# Mock / local only. No network, no paid calls. Uses an isolated temp dir.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTOR="$SCRIPT_DIR/detect-semantic-test-problems.sh"

PASS=0
FAIL=0
WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-semantic-test-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
no() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

# --- Fixture A: genuinely-fake test (literal echoed through a variable) -------
mkdir -p "$WORK/fake"
cat > "$WORK/fake/fake.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest';

describe('fake suite', () => {
  it('asserts a literal echoed through a variable', () => {
    const x = "hello";
    expect(x).toBe("hello");
  });

  it('echoes a numeric literal too', () => {
    const n = 42;
    expect(n).toBe(42);
  });

  it('echoes a hyphenated string literal (operator chars in content)', () => {
    const slug = "loki-mode";
    expect(slug).toBe("loki-mode");
  });
});
EOF

# --- Fixture B: legitimate test (real computed assertion) --------------------
# Includes the exact false-positive we were warned about: expect(add(2,2)).toBe(4)
mkdir -p "$WORK/legit"
cat > "$WORK/legit/legit.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest';
import { add } from '../src/math';

describe('legit suite', () => {
  it('asserts a genuinely computed result', () => {
    expect(add(2, 2)).toBe(4);
  });

  it('asserts a transformed variable', () => {
    const input = "hello";
    const result = input.toUpperCase();
    expect(result).toBe("HELLO");
  });

  it('binds a literal but asserts a real call on it', () => {
    const greeting = "hi";
    expect(greeting.length).toBe(2);
  });
});
EOF

# --- Fixture C: mock-return echo (should be MEDIUM, not HIGH) -----------------
mkdir -p "$WORK/mockecho"
cat > "$WORK/mockecho/mock.test.ts" <<'EOF'
import { describe, it, expect, vi } from 'vitest';

describe('mock echo suite', () => {
  it('asserts the mock return value', () => {
    const svc = { fetch: vi.fn() };
    svc.fetch.mockReturnValue("canned");
    const result = svc.fetch();
    expect(result).toBe("canned");
  });
});
EOF

# === Test 1: fake fixture is flagged HIGH ===================================
out_fake=$(LOKI_SCAN_DIR="$WORK/fake" bash "$DETECTOR" 2>&1)
rc_fake_strict=0
LOKI_SCAN_DIR="$WORK/fake" bash "$DETECTOR" --strict >/dev/null 2>&1 || rc_fake_strict=$?

if echo "$out_fake" | grep -q '\[HIGH\]'; then
    ok "fake fixture: prints a [HIGH] token"
else
    no "fake fixture: expected a [HIGH] token, got none"
fi

if echo "$out_fake" | grep -q "Literal echo"; then
    ok "fake fixture: identifies literal-echo pattern"
else
    no "fake fixture: expected 'Literal echo' message"
fi

# Recall on string literals containing operator characters (e.g. "loki-mode").
if echo "$out_fake" | grep -q "loki-mode"; then
    ok "fake fixture: flags hyphenated string literal (operator-char content)"
else
    no "fake fixture: missed hyphenated literal 'loki-mode' (recall gap)"
fi

if [ "$rc_fake_strict" -eq 1 ]; then
    ok "fake fixture: --strict exits 1 on HIGH"
else
    no "fake fixture: --strict expected exit 1, got $rc_fake_strict"
fi

# === Test 2: legit fixture is NOT flagged (clean) ==========================
out_legit=$(LOKI_SCAN_DIR="$WORK/legit" bash "$DETECTOR" 2>&1)
rc_legit_strict=0
LOKI_SCAN_DIR="$WORK/legit" bash "$DETECTOR" --strict >/dev/null 2>&1 || rc_legit_strict=$?

if echo "$out_legit" | grep -qE '\[(CRITICAL|HIGH)\]'; then
    no "legit fixture: false positive -- got a CRITICAL/HIGH finding"
    echo "$out_legit" | grep -E '\[(CRITICAL|HIGH)\]'
else
    ok "legit fixture: no false-positive CRITICAL/HIGH (add(2,2)==4 stays clean)"
fi

if [ "$rc_legit_strict" -eq 0 ]; then
    ok "legit fixture: --strict exits 0 (clean)"
else
    no "legit fixture: --strict expected exit 0, got $rc_legit_strict"
fi

# === Test 3: LOKI_SCAN_DIR redirect honored ================================
# Run with cwd elsewhere; the scan must target LOKI_SCAN_DIR, not cwd/repo.
out_redirect=$(cd / && LOKI_SCAN_DIR="$WORK/fake" bash "$DETECTOR" 2>&1)
if echo "$out_redirect" | grep -q "fake.test.ts"; then
    ok "LOKI_SCAN_DIR redirect: scans the target dir regardless of cwd"
else
    no "LOKI_SCAN_DIR redirect: did not scan target dir (no fake.test.ts in output)"
fi

# Negative redirect: pointing at the clean dir yields no HIGH even from / cwd.
out_redirect_clean=$(cd / && LOKI_SCAN_DIR="$WORK/legit" bash "$DETECTOR" 2>&1)
if echo "$out_redirect_clean" | grep -qE '\[(CRITICAL|HIGH)\]'; then
    no "LOKI_SCAN_DIR redirect: clean target unexpectedly flagged HIGH"
else
    ok "LOKI_SCAN_DIR redirect: clean target stays clean"
fi

# === Test 4: mock-return echo is MEDIUM (non-blocking under --strict) =======
out_mock=$(LOKI_SCAN_DIR="$WORK/mockecho" bash "$DETECTOR" 2>&1)
rc_mock_strict=0
LOKI_SCAN_DIR="$WORK/mockecho" bash "$DETECTOR" --strict >/dev/null 2>&1 || rc_mock_strict=$?

if echo "$out_mock" | grep -q '\[MEDIUM\]'; then
    ok "mock-echo fixture: flagged MEDIUM"
else
    no "mock-echo fixture: expected a [MEDIUM] token"
fi

if echo "$out_mock" | grep -q '\[HIGH\]'; then
    no "mock-echo fixture: should be MEDIUM not HIGH (over-flagging)"
else
    ok "mock-echo fixture: not promoted to HIGH (conservative)"
fi

if [ "$rc_mock_strict" -eq 0 ]; then
    ok "mock-echo fixture: --strict exits 0 (MEDIUM does not block)"
else
    no "mock-echo fixture: --strict expected exit 0, got $rc_mock_strict"
fi

# --- Summary ----------------------------------------------------------------
echo ""
echo "=========================================="
echo "Results: $((PASS + FAIL)) test(s) -- $PASS passed, $FAIL failed"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
