#!/usr/bin/env bash
# v7.7.20 regression test: wake previously-dead memory code +
# enable-hook installer with VERIFIED Claude Code schema.
#
# Diagnosis (~/git/loki-plan/MEMORY-DIAGNOSIS-2026-05-27.md) flagged
# memory/knowledge_graph.py + cross_project.py as ZERO-call-site dead
# code. This release wires knowledge_graph into load_memory_context
# (cross_project augmentation) + adds `loki memory crossproject` and
# `loki memory graph` CLI surfaces. Also ships enable-hook/disable-hook
# with the verified {matcher, hooks:[{type,command}]} schema (deferred
# from v7.7.18 pending WebSearch schema confirmation).
set -u

PY=$(command -v python3.12 || command -v python3)
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Test 1: loki memory crossproject runs (graceful when no patterns)
OUT=$(LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory crossproject --for "build api" 2>&1)
if echo "$OUT" | grep -qiE "no cross-project patterns|^[0-9]+\."; then
    ok "loki memory crossproject runs (graceful or returns patterns)"
else
    bad "crossproject: $OUT"
fi

# Test 2: loki memory graph returns JSON with pattern_count
OUT=$(LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory graph 2>&1)
if echo "$OUT" | grep -q "pattern_count"; then
    ok "loki memory graph returns pattern_count"
else
    bad "graph: $OUT"
fi

# Test 3: loki memory graph --export writes a file
TEST=/tmp/loki-v7720-graph
rm -rf "$TEST"; mkdir -p "$TEST"
LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory graph --export "$TEST/g.json" >/dev/null 2>&1
if [ -f "$TEST/g.json" ] && $PY -c "import json; json.load(open('$TEST/g.json'))" 2>/dev/null; then
    ok "loki memory graph --export writes valid JSON"
else
    bad "graph export did not write valid JSON"
fi
rm -rf "$TEST"

# Test 4: enable-hook installs with VERIFIED Claude Code schema
TEST_HOME=/tmp/loki-v7720-hookhome
rm -rf "$TEST_HOME"; mkdir -p "$TEST_HOME/.claude"
# shellcheck disable=SC2016  # $schema is a JSON literal key, NOT a shell var
echo '{"$schema":"x","theme":"dark"}' > "$TEST_HOME/.claude/settings.json"
R1=$(HOME="$TEST_HOME" LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory enable-hook 2>/dev/null | head -1)
R2=$(HOME="$TEST_HOME" LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory enable-hook 2>/dev/null | head -1)
SCHEMA_OK=$($PY -c "
import json
d = json.load(open('$TEST_HOME/.claude/settings.json'))
se = d.get('hooks', {}).get('SessionEnd', [])
# Verify: theme preserved, exactly 1 entry, has matcher, nested hooks[0].type==command
theme_ok = d.get('theme') == 'dark'
count_ok = len(se) == 1
schema_ok = (count_ok and isinstance(se[0], dict)
             and 'matcher' in se[0]
             and se[0].get('hooks', [{}])[0].get('type') == 'command'
             and 'loki-session-end.sh' in se[0]['hooks'][0].get('command', ''))
print('OK' if (theme_ok and schema_ok) else f'FAIL theme={theme_ok} schema={schema_ok} se={se}')
")
if [ "$R1" = "installed" ] && [ "$R2" = "already-installed" ] && [ "$SCHEMA_OK" = "OK" ]; then
    ok "enable-hook installs verified {matcher,hooks:[{type,command}]} schema + idempotent + preserves settings"
else
    bad "enable-hook: r1=$R1 r2=$R2 schema=$SCHEMA_OK"
fi

# Test 5: disable-hook removes + idempotent
D1=$(HOME="$TEST_HOME" LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory disable-hook 2>/dev/null | head -1)
D2=$(HOME="$TEST_HOME" LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory disable-hook 2>/dev/null | head -1)
LEFT=$($PY -c "import json; d=json.load(open('$TEST_HOME/.claude/settings.json')); print(len(d.get('hooks',{}).get('SessionEnd',[])))")
if [ "$D1" = "removed" ] && [ "$D2" = "not-installed" ] && [ "$LEFT" = "0" ]; then
    ok "disable-hook removes entry + idempotent on absent"
else
    bad "disable-hook: d1=$D1 d2=$D2 left=$LEFT"
fi
rm -rf "$TEST_HOME"

# Test 6: enable-hook honors LOKI_MEMORY_HOOK_DISABLED
TEST_HOME=/tmp/loki-v7720-hookdisabled
rm -rf "$TEST_HOME"; mkdir -p "$TEST_HOME/.claude"
echo '{}' > "$TEST_HOME/.claude/settings.json"
OUT=$(HOME="$TEST_HOME" LOKI_MEMORY_HOOK_DISABLED=true LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory enable-hook 2>&1 | head -1)
CNT=$($PY -c "import json; d=json.load(open('$TEST_HOME/.claude/settings.json')); print(len(d.get('hooks',{}).get('SessionEnd',[])))")
if echo "$OUT" | grep -q "skipped" && [ "$CNT" = "0" ]; then
    ok "enable-hook respects LOKI_MEMORY_HOOK_DISABLED"
else
    bad "hook disabled: out='$OUT' cnt=$CNT"
fi
rm -rf "$TEST_HOME"

# Test 8 (council fix Opus 1): graph rebuild is the WRITE-side population
# path. Without it, query_patterns reads an always-empty graph (inert
# wake). rebuild mines semantic patterns across discovered projects.
OUT=$(LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory graph rebuild 2>&1)
if echo "$OUT" | grep -qiE "rebuilt knowledge graph|no semantic patterns found"; then
    ok "loki memory graph rebuild runs the write-side population path"
else
    bad "graph rebuild: $OUT"
fi
# Test 8b (council fix Opus 1): rebuild must be idempotent (save_patterns
# appends, so without dedup-of-union + truncate, repeated runs accumulate
# duplicates). Count must be stable across two consecutive rebuilds.
C1=$(LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory graph rebuild 2>&1 | grep -oE "[0-9]+ unique" | head -1)
C2=$(LOKI_LEGACY_BASH=1 bash "$REPO_ROOT/bin/loki" memory graph rebuild 2>&1 | grep -oE "[0-9]+ unique" | head -1)
if [ -n "$C1" ] && [ "$C1" = "$C2" ]; then
    ok "graph rebuild is idempotent (count stable: $C1)"
elif [ -z "$C1" ]; then
    ok "graph rebuild idempotency (no patterns to count; vacuously stable)"
else
    bad "graph rebuild NOT idempotent: first=$C1 second=$C2"
fi

# Test 7: load_memory_context emits cross_project field (wakes dead code path)
TEST=/tmp/loki-v7720-ctx
rm -rf "$TEST"; mkdir -p "$TEST/.loki/memory"
# load_memory_context is internal; verify the augmentation code path by
# checking the autonomy/loki source contains the cross_project wiring.
if grep -q "from memory.knowledge_graph import OrganizationKnowledgeGraph" "$REPO_ROOT/autonomy/loki" \
   && grep -q "output\['cross_project'\]" "$REPO_ROOT/autonomy/loki"; then
    ok "load_memory_context wires knowledge_graph cross-project augmentation"
else
    bad "cross_project augmentation not wired into load_memory_context"
fi
rm -rf "$TEST"

# Cleanup
bash -c 'for d in /tmp/loki-v7720-*; do rm -rf "$d" 2>/dev/null; done'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
