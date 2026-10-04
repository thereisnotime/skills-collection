#!/usr/bin/env bash
# test-project-health.sh — functional tests for scripts/project_health.py.
#
# Self-contained: each case states its input and expected output, so nothing
# needs looking up elsewhere — a shipped skill never has a spec document to
# point at. AC-n labels are stable IDs for reading test output, not citations.
#
# Focus is file classification, which is the part with no visible failure mode:
# a misclassified file does not crash, it silently skews every ratio built on it.
# Measurement accuracy (comment splitting, doc prose) is covered by
# --explain and by the numbers printed on a real repository.
#
# Product / test / doc / generated classification:
#   AC-1  .ts source                      → product code
#   AC-2  .js with a sibling .ts          → generated, excluded
#   AC-3  .d.ts declaration               → generated, excluded
#   AC-4  .min.js minified                → generated, excluded
#   AC-5  .js with no sibling .ts         → product code
#   AC-6  file under tests/               → test lines, not product
#   AC-7  *.test.ts                      → test lines, not product
#   AC-8  markdown                       → doc prose, not code
#   AC-9  package-lock.json              → neither (no recognised language)
#   AC-10 sourcemap comment in .js       → generated, excluded
#
# Ratchet behaviour:
#   AC-11 no baseline                    → exit 2, "unbaselined"
#   AC-12 unchanged repo                 → exit 0
#   AC-13 comment deletion               → exit 1 (band, both directions)
#   AC-14 zero baseline, metric appeared → exit 0, status "new", not FAIL
#
# Repo-authored ignore config:
#   AC-15 ignorePaths exclude files, counted not hidden
#   AC-16 a slashless glob does not swallow nested paths
#   AC-17 malformed config applies nothing and says so
#   AC-18 non-list ignorePaths is rejected rather than ignored

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$SCRIPT_DIR/project_health.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }

# fixture <name> — create a repo and echo its path
fixture() {
  local dir="$WORK/$1"
  mkdir -p "$dir"
  echo "$dir"
}

# metric <repo> <key> — read one metric from --json output. Prints the literal
# string TOOL_ERROR rather than a traceback when the tool fails, so a broken tool
# reports as one clear failing case instead of a wall of stack traces.
metric() {
  python3 "$TOOL" --repo "$1" --json 2>/dev/null \
    | python3 -c "
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print('TOOL_ERROR'); raise SystemExit(0)
try:
    print(json.loads(raw)['metrics'].get('$2'))
except Exception as exc:
    print('TOOL_ERROR: %s' % exc)
"
}

check_metric() {
  local label="$1" repo="$2" key="$3" expected="$4"
  local actual
  actual="$(metric "$repo" "$key")"
  if [ "$actual" = "$expected" ]; then
    ok "$label"
  else
    bad "$label" "$expected" "$actual"
  fi
}

check_status() {
  local label="$1" repo="$2" metric_key="$3" expected="$4"
  local actual
  # --check is required: the ratchet section only appears in --json output when
  # a check actually ran.
  actual="$(python3 "$TOOL" --repo "$repo" --check --json 2>/dev/null \
    | python3 -c "
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print('TOOL_ERROR'); raise SystemExit(0)
rows = json.loads(raw).get('ratchet', {}).get('results', [])
print(next((r['status'] for r in rows if r['metric'] == '$metric_key'), 'absent'))
")"
  if [ "$actual" = "$expected" ]; then
    ok "$label"
  else
    bad "$label" "$expected" "$actual"
  fi
}

echo "AC-1  ordinary .ts source counts as product code"
r="$(fixture ac1)"; printf 'const a = 1;\nconst b = 2;\n' > "$r/main.ts"
check_metric "AC-1  productCodeLines == 2" "$r" productCodeLines 2
check_metric "AC-1  generatedFiles == 0"    "$r" generatedFiles 0

echo "AC-2  committed bundle with a .ts sibling is excluded"
r="$(fixture ac2)"; printf 'const a = 1;\n' > "$r/service.ts"
printf 'var a=1;\nvar b=2;\nvar c=3;\nvar d=4;\n' > "$r/service.js"
check_metric "AC-2  bundle not counted as product" "$r" productCodeLines 1
check_metric "AC-2  bundle counted as generated"  "$r" generatedFiles 1
check_metric "AC-2  bundle lines reported"         "$r" generatedLines 4

echo "AC-3  TypeScript declaration output is excluded"
r="$(fixture ac3)"; printf 'export declare const a: number;\n' > "$r/types.d.ts"
printf 'const a = 1;\n' > "$r/main.ts"
check_metric "AC-3  .d.ts excluded"        "$r" generatedFiles 1
check_metric "AC-3  product unaffected"   "$r" productCodeLines 1

echo "AC-4  minified output is excluded"
r="$(fixture ac4)"; printf 'const a=1;\n' > "$r/app.ts"
printf 'var a=1;var b=2;\n' > "$r/app.min.js"
check_metric "AC-4  .min.js excluded"      "$r" generatedFiles 1
check_metric "AC-4  product unaffected"   "$r" productCodeLines 1

echo "AC-5  .js with no .ts sibling stays product code"
r="$(fixture ac5)"; printf 'var a = 1;\nvar b = 2;\n' > "$r/legacy.js"
check_metric "AC-5  plain .js is product" "$r" productCodeLines 2
check_metric "AC-5  not excluded"         "$r" generatedFiles 0

echo "AC-6  file under tests/ counts as a test, not product"
r="$(fixture ac6)"; mkdir -p "$r/tests"
printf 'const a = 1;\nconst b = 2;\nconst c = 3;\n' > "$r/tests/helper.ts"
check_metric "AC-6  testLines == 3"        "$r" testLines 3
check_metric "AC-6  productCodeLines == 0" "$r" productCodeLines 0

echo "AC-7  *.test.ts counts as a test, not product"
r="$(fixture ac7)"
printf 'import {it,expect} from "vitest";\nit("works", () => { expect(1).toBe(1); });\n' > "$r/thing.test.ts"
check_metric "AC-7  testCases == 1"        "$r" testCases 1
check_metric "AC-7  productCodeLines == 0" "$r" productCodeLines 0
# describe() is a suite container, not a case. Counting it inflated a real
# monorepo's case count by 21%.
r2="$(fixture ac7b)"
printf 'describe("suite", () => {\n  it("a", () => {});\n  it("b", () => {});\n});\n' > "$r2/s.test.ts"
check_metric "AC-7  2 it() blocks == 2 cases, describe() not counted" "$r2" testCases 2

echo "AC-8  markdown counts as prose, not code"
r="$(fixture ac8)"; printf '# Title\n\nSome prose here.\n' > "$r/README.md"
check_metric "AC-8  allDocProseLines == 2" "$r" allDocProseLines 2
check_metric "AC-8  productCodeLines == 0" "$r" productCodeLines 0

echo "AC-9  lockfile is neither product nor generated"
r="$(fixture ac9)"; printf '{"lockfileVersion":3}\n' > "$r/package-lock.json"
printf 'const a = 1;\n' > "$r/main.ts"
check_metric "AC-9  lockfile not product" "$r" productCodeLines 1
check_metric "AC-9  lockfile not generated" "$r" generatedFiles 0

echo "AC-10 sourcemap comment marks a bundle with no sibling"
r="$(fixture ac10)"
printf 'var a=1;\nvar b=2;\nvar c=3;\n//# sourceMappingURL=app.js.map\n' > "$r/bundle.js"
check_metric "AC-10 excluded via sourcemap comment" "$r" generatedFiles 1
check_metric "AC-10 product unaffected"              "$r" productCodeLines 0

echo "AC-11 a repo with no baseline reports unbaselined, not a pass"
r="$(fixture ac11)"; printf 'const a = 1;\n' > "$r/main.ts"
out="$(python3 "$TOOL" --repo "$r" --check 2>&1)"; code=$?
if [ "$code" -eq 2 ] && printf '%s' "$out" | grep -qi 'unbaselined'; then
  ok "AC-11 exit 2 and says unbaselined"
else
  bad "AC-11 exit 2 and says unbaselined" "exit 2, 'unbaselined'" "exit $code: $out"
fi

echo "AC-12 an unchanged repo passes against its own baseline"
r="$(fixture ac12)"; printf 'const a = 1;\n// note\n' > "$r/main.ts"
python3 "$TOOL" --repo "$r" --update >/dev/null 2>&1
if [ -f "$r/.project-health/baseline.json" ]; then
  ok "AC-12 baseline written to the repo, not the skill directory"
else
  bad "AC-12 baseline written to the repo" "$r/.project-health/baseline.json" "not found"
fi
python3 "$TOOL" --repo "$r" --check >/dev/null 2>&1
[ $? -eq 0 ] && ok "AC-12 unchanged repo exits 0" || bad "AC-12 unchanged repo exits 0" "exit 0" "exit $?"

echo "AC-13 deleting every comment fails both directions of the band"
r="$(fixture ac13)"
printf 'const a = 1;\n// why\nconst b = 2;\n' > "$r/main.ts"
python3 "$TOOL" --repo "$r" --update >/dev/null 2>&1
printf 'const a = 1;\nconst b = 2;\n' > "$r/main.ts"
out="$(python3 "$TOOL" --repo "$r" --check 2>&1)"; code=$?
if [ "$code" -eq 1 ] \
  && printf '%s' "$out" | grep -q 'commentRatio' \
  && printf '%s' "$out" | grep -q 'productCommentLines'; then
  ok "AC-13 comment deletion exits 1 on both metrics"
else
  bad "AC-13 comment deletion exits 1 on both metrics" "exit 1, ratio+lines" "exit $code: $out"
fi

echo "AC-14 a metric absent at baseline reports 'new', not FAIL"
r="$(fixture ac14)"; printf 'const a = 1;\n' > "$r/main.ts"
python3 "$TOOL" --repo "$r" --update >/dev/null 2>&1
printf 'def test_x():\n    assert True\n' > "$r/test_x.py"
check_status "AC-14 testCases reports new" "$r" testCases new
python3 "$TOOL" --repo "$r" --check >/dev/null 2>&1
[ $? -eq 0 ] && ok "AC-14 adoption does not fail the gate" || bad "AC-14 adoption does not fail the gate" "exit 0" "exit $?"

echo "AC-15 repo config ignorePaths exclude matching files, counted not hidden"
r="$(fixture ac15)"; mkdir -p "$r/.project-health" "$r/data/raw" "$r/src"
printf 'const a = 1;\n// note\n' > "$r/src/main.ts"
for i in 1 2 3; do printf 'raw data %s\nsecond line\n' "$i" > "$r/data/raw/f$i.bin"; done
printf '{"ignorePaths": ["data/**"]}\n' > "$r/.project-health/config.json"
check_metric "AC-15 ignored files counted"  "$r" ignoredFiles 3
check_metric "AC-15 ignored lines counted"  "$r" ignoredLines 6
check_metric "AC-15 ignored data is not product" "$r" productCodeLines 1
out="$(python3 "$TOOL" --repo "$r" 2>/dev/null)"
printf '%s' "$out" | grep -q 'data/\*\*' \
  && ok "AC-15 the applied pattern is named in the output" \
  || bad "AC-15 the applied pattern is named in the output" "data/** named" "not present"

echo "AC-16 a slashless glob does not swallow nested paths"
r="$(fixture ac16)"; mkdir -p "$r/src/nested" "$r/.project-health"
printf 'const a = 1;\n' > "$r/src/a.ts"
printf 'const b = 2;\n' > "$r/src/nested/b.ts"
printf '{"ignorePaths": ["src/*"]}\n' > "$r/.project-health/config.json"
check_metric "AC-16 direct child ignored, nested kept" "$r" productCodeLines 1
check_metric "AC-16 one file ignored" "$r" ignoredFiles 1

echo "AC-17 a malformed config applies nothing and says so"
r="$(fixture ac17)"; mkdir -p "$r/.project-health"
printf 'const a = 1;\n' > "$r/main.ts"
printf '{"ignorePaths": [ this is not json\n' > "$r/.project-health/config.json"
out="$(python3 "$TOOL" --repo "$r" 2>/dev/null)"
printf '%s' "$out" | grep -qi 'not valid JSON' \
  && ok "AC-17 malformed config is reported loudly" \
  || bad "AC-17 malformed config is reported loudly" "warning present" "silent"
check_metric "AC-17 nothing ignored despite bad config" "$r" ignoredFiles 0

echo "AC-18 a non-list ignorePaths is rejected rather than ignored"
r="$(fixture ac18)"; mkdir -p "$r/.project-health"
printf 'const a = 1;\n' > "$r/main.ts"
printf '{"ignorePaths": "data/**"}\n' > "$r/.project-health/config.json"
out="$(python3 "$TOOL" --repo "$r" 2>/dev/null)"
printf '%s' "$out" | grep -qi 'non-list ignorePaths' \
  && ok "AC-18 non-list ignorePaths is reported" \
  || bad "AC-18 non-list ignorePaths is reported" "warning present" "silent"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]