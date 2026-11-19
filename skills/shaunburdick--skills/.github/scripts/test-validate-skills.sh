#!/usr/bin/env bash
# test-validate-skills.sh — cases for validate-skills.py.
#
# Each case states its input and expected output, so nothing needs looking up
# elsewhere. AC-n labels are stable IDs for reading test output.
#
#   AC-1  well-formed frontmatter           → exit 0
#   AC-2  unquoted ": " inside description  → exit 1, "not valid YAML"
#   AC-3  name differs from its directory   → exit 1, names the mismatch
#   AC-4  no SKILL.md under the root        → exit 1, not a silent pass

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$SCRIPT_DIR/validate-skills.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }

# skill <root> <name> <description> — write a SKILL.md under that root
skill() {
  mkdir -p "$1/skills/$2"
  printf -- '---\nname: %s\ndescription: %s\nlicense: MIT\n---\n\n# Title\n' \
    "$2" "$3" > "$1/skills/$2/SKILL.md"
}

run() { python3 "$TOOL" "$1" 2>&1; }

echo "AC-1  a well-formed skill passes"
r="$WORK/ac1"; skill "$r" demo "Does a demo thing. Use when demonstrating."
out="$(run "$r/skills")"; code=$?
if [ "$code" -eq 0 ] && printf '%s' "$out" | grep -q 'valid: 1 SKILL.md files'; then
  ok "AC-1  exit 0 and reports one valid file"
else
  bad "AC-1  exit 0 and reports one valid file" "exit 0, 'valid: 1 SKILL.md files'" "exit $code: $out"
fi

echo "AC-2  an unquoted ': ' inside description fails the parse"
r="$WORK/ac2"; mkdir -p "$r/skills/demo"
printf -- '---\nname: demo\ndescription: Two questions route the work: a spec exists only when a contract changes.\n---\n' \
  > "$r/skills/demo/SKILL.md"
out="$(run "$r/skills")"; code=$?
if [ "$code" -eq 1 ] \
  && printf '%s' "$out" | grep -q 'not valid YAML' \
  && printf '%s' "$out" | grep -q 'skills/demo/SKILL.md'; then
  ok "AC-2  exit 1 and names the file"
else
  bad "AC-2  exit 1 and names the file" "exit 1, 'not valid YAML', path" "exit $code: $out"
fi

echo "AC-3  a name that differs from its directory is rejected"
r="$WORK/ac3"; skill "$r" demo "Does a demo thing."
sed -i 's/^name: demo$/name: other/' "$r/skills/demo/SKILL.md"
out="$(run "$r/skills")"; code=$?
if [ "$code" -eq 1 ] && printf '%s' "$out" | grep -q "must match its directory"; then
  ok "AC-3  exit 1 and reports the mismatch"
else
  bad "AC-3  exit 1 and reports the mismatch" "exit 1, 'must match its directory'" "exit $code: $out"
fi

echo "AC-4  a root with no SKILL.md fails instead of passing silently"
r="$WORK/ac4"; mkdir -p "$r/skills"
out="$(run "$r/skills")"; code=$?
if [ "$code" -eq 1 ] && printf '%s' "$out" | grep -q 'no SKILL.md files'; then
  ok "AC-4  exit 1 and says nothing was checked"
else
  bad "AC-4  exit 1 and says nothing was checked" "exit 1, 'no SKILL.md files'" "exit $code: $out"
fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
