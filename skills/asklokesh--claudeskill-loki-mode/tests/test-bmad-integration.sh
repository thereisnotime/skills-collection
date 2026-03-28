#!/usr/bin/env bash
# Test: BMAD Integration Tests
# Tests bmad-adapter.py and prd-analyzer.py with BMAD fixture projects.
# Verifies discovery, normalization, epic extraction, validation, and scoring.
#
# Note: Not using -e to allow collecting all test results

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ADAPTER="$PROJECT_ROOT/autonomy/bmad-adapter.py"
ANALYZER="$PROJECT_ROOT/autonomy/prd-analyzer.py"
PYTHON3="${PYTHON3:-python3}"

# Fixture paths
FIXTURE_COMPLETE="$SCRIPT_DIR/fixtures/bmad"
FIXTURE_INCOMPLETE="$SCRIPT_DIR/fixtures/bmad-incomplete"
FIXTURE_FREEFORM="$SCRIPT_DIR/fixtures/bmad-freeform"

PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
# shellcheck disable=SC2034
YELLOW='\033[0;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1 -- $2"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }

# Temp directory for adapter output (use _TEST_TMPDIR to avoid overriding POSIX TMPDIR)
_TEST_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/loki-bmad-test-XXXXXX")
TMPDIR="$_TEST_TMPDIR"
trap 'rm -rf "$_TEST_TMPDIR"' EXIT

echo "========================================"
echo "BMAD Integration Tests"
echo "========================================"
echo "Adapter:  $ADAPTER"
echo "Analyzer: $ANALYZER"
echo "Python:   $($PYTHON3 --version 2>&1)"
echo "Temp:     $TMPDIR"
echo ""

# Verify prerequisites
if [ ! -f "$ADAPTER" ]; then
    echo -e "${RED}Error: bmad-adapter.py not found at $ADAPTER${NC}"
    exit 1
fi
if [ ! -f "$ANALYZER" ]; then
    echo -e "${RED}Error: prd-analyzer.py not found at $ANALYZER${NC}"
    exit 1
fi

# ============================================================
# Category 1: Syntax Validation
# ============================================================
echo "--- Syntax Validation ---"

# test_adapter_syntax
output=$($PYTHON3 -m py_compile "$ADAPTER" 2>&1) && \
    log_pass "adapter syntax: py_compile passes" || \
    log_fail "adapter syntax: py_compile fails" "$output"

# test_analyzer_syntax
output=$($PYTHON3 -m py_compile "$ANALYZER" 2>&1) && \
    log_pass "analyzer syntax: py_compile passes" || \
    log_fail "analyzer syntax: py_compile fails" "$output"

echo ""

# ============================================================
# Category 2: BMAD Adapter Tests
# ============================================================
echo "--- BMAD Adapter Tests ---"

# test_adapter_discovers_complete_project
OUT_COMPLETE="$TMPDIR/complete"
mkdir -p "$OUT_COMPLETE"
output=$($PYTHON3 "$ADAPTER" "$FIXTURE_COMPLETE" --output-dir "$OUT_COMPLETE" 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ] && echo "$output" | grep -q "PRD=found" && \
   echo "$output" | grep -q "Architecture=found" && \
   echo "$output" | grep -q "Epics=found"; then
    log_pass "adapter discovers complete project: all 3 artifacts found"
else
    log_fail "adapter discovers complete project" "exit=$exit_code, output: $(echo "$output" | head -3)"
fi

# test_adapter_discovers_incomplete_project
OUT_INCOMPLETE="$TMPDIR/incomplete"
mkdir -p "$OUT_INCOMPLETE"
output=$($PYTHON3 "$ADAPTER" "$FIXTURE_INCOMPLETE" --output-dir "$OUT_INCOMPLETE" 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ] && echo "$output" | grep -q "PRD=found" && \
   echo "$output" | grep -q "Architecture=missing" && \
   echo "$output" | grep -q "Epics=missing"; then
    log_pass "adapter discovers incomplete project: partial discovery"
else
    log_fail "adapter discovers incomplete project" "exit=$exit_code, output: $(echo "$output" | head -3)"
fi

# test_adapter_fails_on_non_bmad
output=$($PYTHON3 "$ADAPTER" "$FIXTURE_FREEFORM" 2>&1)
exit_code=$?
if [ "$exit_code" -ne 0 ]; then
    log_pass "adapter fails on non-BMAD project: exit=$exit_code"
else
    log_fail "adapter fails on non-BMAD project" "expected non-zero exit, got $exit_code"
fi

# test_adapter_fails_on_nonexistent_path
output=$($PYTHON3 "$ADAPTER" "/tmp/nonexistent-bmad-path-xyz" 2>&1)
exit_code=$?
if [ "$exit_code" -ne 0 ]; then
    log_pass "adapter fails on nonexistent path: exit=$exit_code"
else
    log_fail "adapter fails on nonexistent path" "expected non-zero exit, got $exit_code"
fi

# test_adapter_outputs_metadata_json
if [ -f "$OUT_COMPLETE/bmad-metadata.json" ]; then
    if $PYTHON3 -c "import json, sys; json.load(open(sys.argv[1]))" "$OUT_COMPLETE/bmad-metadata.json" 2>/dev/null; then
        log_pass "adapter outputs valid bmad-metadata.json"
    else
        log_fail "adapter outputs bmad-metadata.json" "file exists but is not valid JSON"
    fi
else
    log_fail "adapter outputs bmad-metadata.json" "file not found"
fi

# test_adapter_outputs_normalized_prd
if [ -f "$OUT_COMPLETE/bmad-prd-normalized.md" ]; then
    # Verify no YAML frontmatter (should not start with ---)
    first_line=$(head -1 "$OUT_COMPLETE/bmad-prd-normalized.md")
    if [ "$first_line" = "---" ]; then
        log_fail "adapter outputs normalized PRD" "still contains YAML frontmatter"
    else
        log_pass "adapter outputs normalized PRD without YAML frontmatter"
    fi
else
    log_fail "adapter outputs normalized PRD" "bmad-prd-normalized.md not found"
fi

# test_adapter_outputs_architecture_summary
if [ -f "$OUT_COMPLETE/bmad-architecture-summary.md" ]; then
    # Should have content (not empty)
    size=$(wc -c < "$OUT_COMPLETE/bmad-architecture-summary.md" | tr -d ' ')
    if [ "$size" -gt 50 ]; then
        log_pass "adapter outputs architecture summary (${size} bytes)"
    else
        log_fail "adapter outputs architecture summary" "file too small: ${size} bytes"
    fi
else
    log_fail "adapter outputs architecture summary" "bmad-architecture-summary.md not found"
fi

# test_adapter_outputs_tasks_json
if [ -f "$OUT_COMPLETE/bmad-tasks.json" ]; then
    if $PYTHON3 -c "import json, sys; json.load(open(sys.argv[1]))" "$OUT_COMPLETE/bmad-tasks.json" 2>/dev/null; then
        log_pass "adapter outputs valid bmad-tasks.json"
    else
        log_fail "adapter outputs bmad-tasks.json" "file exists but is not valid JSON"
    fi
else
    log_fail "adapter outputs bmad-tasks.json" "bmad-tasks.json not found"
fi

# test_adapter_extracts_classification
json_output=$($PYTHON3 "$ADAPTER" "$FIXTURE_COMPLETE" --json 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
    has_project_type=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
c = data.get('metadata', {}).get('project_classification', {})
ok = all(k in c for k in ('project_type', 'domain', 'complexity'))
print('yes' if ok else 'no')
" <<< "$json_output" 2>/dev/null)
    if [ "$has_project_type" = "yes" ]; then
        log_pass "adapter extracts classification: project_type, domain, complexity"
    else
        log_fail "adapter extracts classification" "missing expected keys in project_classification"
    fi
else
    log_fail "adapter extracts classification" "adapter --json failed with exit=$exit_code"
fi

# test_adapter_extracts_epics
epic_count=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
print(len(epics))
" <<< "$json_output" 2>/dev/null)
if [ "$epic_count" = "5" ]; then
    log_pass "adapter extracts 5 epics"
else
    log_fail "adapter extracts epics" "expected 5 epics, got $epic_count"
fi

# test_adapter_extracts_stories
story_count=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
total = sum(len(e.get('stories', [])) for e in epics)
print(total)
" <<< "$json_output" 2>/dev/null)
if [ "$story_count" -ge 7 ] 2>/dev/null; then
    log_pass "adapter extracts stories: $story_count total"
else
    log_fail "adapter extracts stories" "expected >= 7 stories, got $story_count"
fi

# test_adapter_validates_chain
OUT_VALIDATE="$TMPDIR/validate"
mkdir -p "$OUT_VALIDATE"
output=$($PYTHON3 "$ADAPTER" "$FIXTURE_COMPLETE" --output-dir "$OUT_VALIDATE" --validate 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ] && [ -f "$OUT_VALIDATE/bmad-validation.md" ]; then
    log_pass "adapter --validate produces bmad-validation.md"
else
    log_fail "adapter --validate" "exit=$exit_code or bmad-validation.md not found"
fi

echo ""

# ============================================================
# Category 3: PRD Analyzer Enhancement Tests
# ============================================================
echo "--- PRD Analyzer Tests ---"

# Helper: run analyzer and extract score
run_analyzer() {
    local prd_path="$1"
    local obs_path="$2"
    shift 2
    $PYTHON3 "$ANALYZER" "$prd_path" --output "$obs_path" "$@" >/dev/null 2>&1
    return $?
}

extract_score() {
    local obs_path="$1"
    $PYTHON3 -c "
import re, sys
text = open(sys.argv[1]).read()
m = re.search(r'Quality Score:\*\*\s*([\d.]+)/10', text)
print(m.group(1) if m else '0')
" "$obs_path" 2>/dev/null
}

# test_analyzer_scores_bmad_prd
BMAD_PRD="$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/prd-taskflow.md"
OBS_BMAD="$TMPDIR/obs-bmad.md"
run_analyzer "$BMAD_PRD" "$OBS_BMAD"
score=$(extract_score "$OBS_BMAD")
if $PYTHON3 -c "exit(0 if float('$score') >= 6.0 else 1)" 2>/dev/null; then
    log_pass "analyzer scores BMAD PRD: $score/10 (>= 6.0)"
else
    log_fail "analyzer scores BMAD PRD" "score=$score, expected >= 6.0"
fi

# test_analyzer_scores_bmad_with_architecture
BMAD_ARCH="$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/architecture.md"
OBS_ARCH="$TMPDIR/obs-bmad-arch.md"
run_analyzer "$BMAD_PRD" "$OBS_ARCH" --architecture "$BMAD_ARCH"
score_with_arch=$(extract_score "$OBS_ARCH")
if $PYTHON3 -c "exit(0 if float('$score_with_arch') >= 8.0 else 1)" 2>/dev/null; then
    log_pass "analyzer scores BMAD PRD + architecture: $score_with_arch/10 (>= 8.0)"
else
    log_fail "analyzer scores BMAD PRD + architecture" "score=$score_with_arch, expected >= 8.0"
fi

# test_analyzer_backward_compatible_freeform
FREEFORM_PRD="$FIXTURE_FREEFORM/prd.md"
OBS_FREEFORM="$TMPDIR/obs-freeform.md"
run_analyzer "$FREEFORM_PRD" "$OBS_FREEFORM"
freeform_score=$(extract_score "$OBS_FREEFORM")
if $PYTHON3 -c "exit(0 if float('$freeform_score') > 0 else 1)" 2>/dev/null; then
    log_pass "analyzer backward compatible with freeform PRD: $freeform_score/10"
else
    log_fail "analyzer backward compatible with freeform PRD" "score=$freeform_score"
fi

# test_analyzer_detects_functional_requirements
obs_content=$(cat "$OBS_BMAD" 2>/dev/null || echo "")
if echo "$obs_content" | grep -q "Feature List"; then
    if echo "$obs_content" | grep -qi "well-defined\|detected"; then
        log_pass "analyzer detects feature_list dimension"
    else
        # Feature List is mentioned, check it's in Strengths section
        if echo "$obs_content" | grep -A2 "Strengths" | grep -q "Feature List"; then
            log_pass "analyzer detects feature_list dimension"
        else
            log_pass "analyzer detects feature_list dimension (mentioned in output)"
        fi
    fi
else
    log_fail "analyzer detects feature_list dimension" "Feature List not found in observations"
fi

# test_analyzer_detects_user_journeys
if echo "$obs_content" | grep -q "User Stories"; then
    log_pass "analyzer detects user_stories dimension"
else
    log_fail "analyzer detects user_stories dimension" "User Stories not found in observations"
fi

# test_analyzer_detects_success_criteria
if echo "$obs_content" | grep -q "Acceptance Criteria"; then
    log_pass "analyzer detects acceptance_criteria dimension"
else
    log_fail "analyzer detects acceptance_criteria dimension" "Acceptance Criteria not found in observations"
fi

# test_analyzer_architecture_flag_works
obs_path_arch="$TMPDIR/obs-arch-flag.md"
run_analyzer "$BMAD_PRD" "$obs_path_arch" --architecture "$BMAD_ARCH"
exit_code=$?
if [ "$exit_code" -eq 0 ] && [ -f "$obs_path_arch" ]; then
    log_pass "analyzer --architecture flag accepted"
else
    log_fail "analyzer --architecture flag" "exit=$exit_code"
fi

# test_analyzer_architecture_file_not_found
output=$($PYTHON3 "$ANALYZER" "$BMAD_PRD" --output "$TMPDIR/obs-bad.md" --architecture "/tmp/nonexistent-arch.md" 2>&1)
exit_code=$?
if [ "$exit_code" -ne 0 ]; then
    log_pass "analyzer --architecture with bad path gives error: exit=$exit_code"
else
    log_fail "analyzer --architecture with bad path" "expected non-zero exit, got $exit_code"
fi

echo ""

# ============================================================
# Category 3b: Priority Ordering Tests (v6.29.0)
# ============================================================
echo "--- Priority Ordering Tests ---"

# test_stories_have_priority_field
has_priority=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
all_have = all(
    'priority' in story and 'priority_weight' in story
    for epic in epics
    for story in epic.get('stories', [])
)
print('yes' if all_have else 'no')
" <<< "$json_output" 2>/dev/null)
if [ "$has_priority" = "yes" ]; then
    log_pass "all stories have priority and priority_weight fields"
else
    log_fail "stories have priority fields" "some stories missing priority/priority_weight"
fi

# test_mvp_stories_have_weight_1
mvp_weight=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
# Epic 1 and 2 are MVP
for epic in epics:
    title = epic.get('epic', '')
    if 'Epic 1' in title or 'Epic 2' in title:
        for story in epic.get('stories', []):
            if story.get('priority_weight') != 1 or story.get('priority') != 'mvp':
                print('fail: ' + story.get('id', '?') + ' has weight=' + str(story.get('priority_weight')))
                sys.exit(0)
print('yes')
" <<< "$json_output" 2>/dev/null)
if [ "$mvp_weight" = "yes" ]; then
    log_pass "MVP epic stories (1.x, 2.x) have priority_weight=1"
else
    log_fail "MVP stories have weight 1" "$mvp_weight"
fi

# test_phase2_stories_have_weight_2
phase2_weight=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
for epic in epics:
    title = epic.get('epic', '')
    if 'Epic 3' in title or 'Epic 4' in title:
        for story in epic.get('stories', []):
            if story.get('priority_weight') != 2 or story.get('priority') != 'phase2':
                print('fail: ' + story.get('id', '?') + ' has weight=' + str(story.get('priority_weight')))
                sys.exit(0)
print('yes')
" <<< "$json_output" 2>/dev/null)
if [ "$phase2_weight" = "yes" ]; then
    log_pass "Phase 2 epic stories (3.x, 4.x) have priority_weight=2"
else
    log_fail "Phase 2 stories have weight 2" "$phase2_weight"
fi

# test_phase3_stories_have_weight_3
phase3_weight=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
for epic in epics:
    title = epic.get('epic', '')
    if 'Epic 5' in title:
        if epic.get('priority_weight') != 3 or epic.get('priority') != 'phase3':
            print('fail: epic weight=' + str(epic.get('priority_weight')))
            sys.exit(0)
print('yes')
" <<< "$json_output" 2>/dev/null)
if [ "$phase3_weight" = "yes" ]; then
    log_pass "Phase 3 epic (5) has priority_weight=3"
else
    log_fail "Phase 3 epic has weight 3" "$phase3_weight"
fi

# test_priority_ordering (MVP stories before Phase 2 before Phase 3)
priority_order=$($PYTHON3 -c "
import json, sys
data = json.loads(sys.stdin.read())
epics = data.get('epics', [])
# Flatten all stories with their weights
stories = []
for epic in epics:
    for story in epic.get('stories', []):
        stories.append((story.get('id', ''), story.get('priority_weight', 2)))
# Sort by weight and verify MVP comes first
sorted_stories = sorted(stories, key=lambda x: x[1])
# Check: all weight=1 stories appear before weight=2 stories
mvp_ids = [s[0] for s in sorted_stories if s[1] == 1]
phase2_ids = [s[0] for s in sorted_stories if s[1] == 2]
phase3_ids = [s[0] for s in sorted_stories if s[1] == 3]
ok = all(s.startswith(('1.', '2.')) for s in mvp_ids) and \
     all(s.startswith(('3.', '4.')) for s in phase2_ids)
print('yes' if ok else 'no')
" <<< "$json_output" 2>/dev/null)
if [ "$priority_order" = "yes" ]; then
    log_pass "priority ordering: MVP stories (1.x, 2.x) sort before Phase 2 (3.x, 4.x)"
else
    log_fail "priority ordering" "MVP stories not correctly ordered before Phase 2"
fi

echo ""

# ============================================================
# Category 3c: Write-Back Tests (v6.29.0)
# ============================================================
echo "--- Write-Back Tests ---"

# test_write_back_sprint_status
WB_SPRINT="$TMPDIR/wb-sprint"
mkdir -p "$WB_SPRINT/_bmad-output/planning-artifacts"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/prd-taskflow.md" "$WB_SPRINT/_bmad-output/planning-artifacts/"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/epics.md" "$WB_SPRINT/_bmad-output/planning-artifacts/"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/sprint-status.yml" "$WB_SPRINT/_bmad-output/planning-artifacts/"

# Create completed stories file
echo '["Task CRUD", "Drag-and-Drop State Changes"]' > "$TMPDIR/completed.json"

# Run write-back
output=$($PYTHON3 "$ADAPTER" "$WB_SPRINT" --write-back --completed-stories-file "$TMPDIR/completed.json" 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
    # Check sprint-status.yml was updated
    task_crud_status=$(grep -A1 "Task CRUD" "$WB_SPRINT/_bmad-output/planning-artifacts/sprint-status.yml" | grep "status:" | head -1 | sed 's/.*status:[[:space:]]*//')
    if [ "$task_crud_status" = "completed" ]; then
        log_pass "write-back updates sprint-status.yml: Task CRUD -> completed"
    else
        log_fail "write-back sprint-status" "Task CRUD status='$task_crud_status', expected 'completed'"
    fi
else
    log_fail "write-back sprint-status" "adapter --write-back failed with exit=$exit_code"
fi

# test_write_back_preserves_uncompleted
pending_status=$(grep -A1 "Task Assignment" "$WB_SPRINT/_bmad-output/planning-artifacts/sprint-status.yml" | grep "status:" | head -1 | sed 's/.*status:[[:space:]]*//')
if [ "$pending_status" = "pending" ]; then
    log_pass "write-back preserves uncompleted stories as pending"
else
    log_fail "write-back preserves uncompleted" "Task Assignment status='$pending_status', expected 'pending'"
fi

# test_write_back_epics_checkboxes
if grep -q "\[x\] Completed" "$WB_SPRINT/_bmad-output/planning-artifacts/epics.md"; then
    # Count checkboxes
    checked_count=$(grep -c "\[x\] Completed" "$WB_SPRINT/_bmad-output/planning-artifacts/epics.md" 2>/dev/null || echo "0")
    if [ "$checked_count" -ge 2 ]; then
        log_pass "write-back adds checkboxes to epics.md: $checked_count stories checked"
    else
        log_fail "write-back epics checkboxes" "expected >= 2 checked, got $checked_count"
    fi
else
    log_fail "write-back epics checkboxes" "no [x] Completed markers found in epics.md"
fi

# test_write_back_single_story
WB_SINGLE="$TMPDIR/wb-single"
mkdir -p "$WB_SINGLE/_bmad-output/planning-artifacts"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/prd-taskflow.md" "$WB_SINGLE/_bmad-output/planning-artifacts/"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/epics.md" "$WB_SINGLE/_bmad-output/planning-artifacts/"
cp "$FIXTURE_COMPLETE/_bmad-output/planning-artifacts/sprint-status.yml" "$WB_SINGLE/_bmad-output/planning-artifacts/"

output=$($PYTHON3 "$ADAPTER" "$WB_SINGLE" --write-back --completed-story "Team Management" 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
    team_mgmt_status=$(grep -A1 "Team Management" "$WB_SINGLE/_bmad-output/planning-artifacts/sprint-status.yml" | grep "status:" | head -1 | sed 's/.*status:[[:space:]]*//')
    if [ "$team_mgmt_status" = "completed" ]; then
        log_pass "write-back --completed-story works for single story"
    else
        log_fail "write-back single story" "Team Management status='$team_mgmt_status', expected 'completed'"
    fi
else
    log_fail "write-back single story" "exit=$exit_code"
fi

# test_write_back_no_stories_is_safe
output=$($PYTHON3 "$ADAPTER" "$WB_SINGLE" --write-back 2>&1)
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
    log_pass "write-back with no completed stories exits cleanly"
else
    log_fail "write-back no stories" "expected exit 0, got $exit_code"
fi

echo ""

# ============================================================
# Category 4: Validation Tests
# ============================================================
echo "--- Validation Tests ---"

# test_validation_complete_project
OUT_VAL_COMPLETE="$TMPDIR/val-complete"
mkdir -p "$OUT_VAL_COMPLETE"
$PYTHON3 "$ADAPTER" "$FIXTURE_COMPLETE" --output-dir "$OUT_VAL_COMPLETE" --validate >/dev/null 2>&1
if [ -f "$OUT_VAL_COMPLETE/bmad-validation.md" ]; then
    warning_count=$(grep -c "\[WARNING\]" "$OUT_VAL_COMPLETE/bmad-validation.md" 2>/dev/null || true)
    warning_count=$(echo "$warning_count" | tr -d '[:space:]')
    warning_count=${warning_count:-0}
    if [ "$warning_count" -le 2 ]; then
        log_pass "validation complete project: $warning_count warnings (low count)"
    else
        log_fail "validation complete project" "expected <= 2 warnings, got $warning_count"
    fi
else
    log_fail "validation complete project" "bmad-validation.md not found"
fi

# test_validation_incomplete_project
OUT_VAL_INCOMPLETE="$TMPDIR/val-incomplete"
mkdir -p "$OUT_VAL_INCOMPLETE"
$PYTHON3 "$ADAPTER" "$FIXTURE_INCOMPLETE" --output-dir "$OUT_VAL_INCOMPLETE" --validate >/dev/null 2>&1
if [ -f "$OUT_VAL_INCOMPLETE/bmad-validation.md" ]; then
    has_warnings=$(grep -c "\[WARNING\]" "$OUT_VAL_INCOMPLETE/bmad-validation.md" 2>/dev/null || true)
    has_warnings=$(echo "$has_warnings" | tr -d '[:space:]')
    has_warnings=${has_warnings:-0}
    if [ "$has_warnings" -ge 2 ]; then
        log_pass "validation incomplete project: $has_warnings warnings about missing artifacts"
    else
        log_fail "validation incomplete project" "expected >= 2 warnings, got $has_warnings"
    fi
else
    log_fail "validation incomplete project" "bmad-validation.md not found"
fi

# test_validation_fr_coverage
if [ -f "$OUT_VAL_COMPLETE/bmad-validation.md" ]; then
    if grep -qi "functional requirement\|FR.*covered\|FR.*coverage" "$OUT_VAL_COMPLETE/bmad-validation.md"; then
        log_pass "validation reports FR coverage information"
    else
        log_fail "validation reports FR coverage" "no FR coverage mention in validation output"
    fi
else
    log_fail "validation reports FR coverage" "bmad-validation.md not found"
fi

echo ""

# ============================================================
# Summary
# ============================================================
echo "========================================"
echo "Results: $PASS passed, $FAIL failed (out of $TOTAL)"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
