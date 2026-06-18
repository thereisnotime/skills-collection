#!/usr/bin/env bash
#===============================================================================
# Tests for the wave-4 Docker helpers in autonomy/docker-run.sh:
#   loki_docker_pick_host_port
#   loki_docker_pull_and_prune
#   loki_docker_write_runstate / loki_docker_clear_runstate
#   loki_docker_container_name
#
# Daemon-INDEPENDENT: `docker` is replaced by a shell stub so these run in CI
# with no Docker daemon. The prune stub deliberately emits the REAL id-format
# mismatch (docker inspect -> "sha256:<64hex>", docker images --format
# '{{.ID}}' -> short 12-char, docker ps ImageID -> "sha256:<64hex>") so the
# safety-critical normalization is actually exercised, not hidden.
#
# Self-contained: temp dirs, per-assertion [PASS]/[FAIL], nonzero exit on any
# failure.
#===============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_RUN_SH="${REPO_ROOT}/autonomy/docker-run.sh"

PASS=0
FAIL=0
pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

[ -f "$DOCKER_RUN_SH" ] || { echo "[FAIL] cannot find $DOCKER_RUN_SH"; exit 1; }
# shellcheck source=/dev/null
source "$DOCKER_RUN_SH"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/loki-w4dockertest.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT

#-------------------------------------------------------------------------------
# 1. loki_docker_pick_host_port
#-------------------------------------------------------------------------------
echo "== loki_docker_pick_host_port =="

# Case A: nothing bound -> returns the default port, as a bare number.
_loki_docker_port_free() { return 0; }   # everything free
port_a="$(loki_docker_pick_host_port)"
if [[ "$port_a" =~ ^[0-9]+$ ]]; then
    pass "pick_host_port returns a numeric port ($port_a)"
else
    fail "pick_host_port did not return a number: '$port_a'"
fi
if [ "$port_a" = "57374" ]; then
    pass "pick_host_port returns default 57374 when free"
else
    fail "pick_host_port expected 57374 when free, got '$port_a'"
fi

# Case B: simulate 57374 bound -> must return a DIFFERENT (higher) port.
_loki_docker_port_free() { [ "$1" != "57374" ]; }   # only 57374 is busy
port_b="$(loki_docker_pick_host_port)"
if [ "$port_b" != "57374" ] && [[ "$port_b" =~ ^[0-9]+$ ]] && [ "$port_b" -gt 57374 ]; then
    pass "pick_host_port skips bound 57374 -> $port_b"
else
    fail "pick_host_port should skip bound 57374, got '$port_b'"
fi

# Case C: DASHBOARD_DEFAULT_PORT precedence is honored.
_loki_docker_port_free() { return 0; }
port_c="$(DASHBOARD_DEFAULT_PORT=48080 loki_docker_pick_host_port)"
if [ "$port_c" = "48080" ]; then
    pass "pick_host_port honors DASHBOARD_DEFAULT_PORT precedence"
else
    fail "pick_host_port DASHBOARD_DEFAULT_PORT expected 48080, got '$port_c'"
fi
unset -f _loki_docker_port_free  # restore real probe for any later code

#-------------------------------------------------------------------------------
# 2. loki_docker_pull_and_prune with LOKI_DOCKER_PRUNE=0 -> NO docker calls
#-------------------------------------------------------------------------------
echo "== loki_docker_pull_and_prune (opt-out) =="

DOCKER_CALLS_FILE="${TMP_ROOT}/docker-calls.log"
: > "$DOCKER_CALLS_FILE"
docker() { echo "$*" >> "$DOCKER_CALLS_FILE"; return 0; }

LOKI_DOCKER_PRUNE=0 LOKI_DOCKER_IMAGE="asklokesh/loki-mode:latest" \
    loki_docker_pull_and_prune >/dev/null 2>&1
call_count=$(wc -l < "$DOCKER_CALLS_FILE" | tr -d ' ')
if [ "$call_count" = "0" ]; then
    pass "LOKI_DOCKER_PRUNE=0 makes zero docker calls (no pull, no prune)"
else
    fail "LOKI_DOCKER_PRUNE=0 made $call_count docker calls (expected 0)"
fi

#-------------------------------------------------------------------------------
# 3. SAFETY-CRITICAL: prune computes the rmi set correctly with REAL id formats.
#
# Layout the stub presents:
#   just-pulled :latest        -> inspect Id  sha256:aaaa...(64)  -> short aaaaaaaaaaaa
#   in-use image (running ctr) -> ps ImageID  sha256:bbbb...(64)  -> short bbbbbbbbbbbb
#   old unused loki-mode image -> images ID   cccccccccccc (short)
#   decoy non-loki image       -> NEVER listed by the reference-filtered query
#
# Expected: rmi called ONLY for cccccccccccc. latest (aaaa) excluded by id match
# across the sha256/short boundary; in-use (bbbb) excluded; decoy never touched.
#-------------------------------------------------------------------------------
echo "== loki_docker_pull_and_prune (safety: rmi set) =="

LATEST_FULL="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
LATEST_SHORT="aaaaaaaaaaaa"
INUSE_FULL="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
INUSE_SHORT="bbbbbbbbbbbb"
OLD_SHORT="cccccccccccc"
DECOY_SHORT="dddddddddddd"   # a non-loki-mode image; must never be enumerated

RMI_FILE="${TMP_ROOT}/rmi.log"
: > "$RMI_FILE"

# Stub docker that emits the REAL format mismatch per subcommand.
docker() {
    case "$1" in
        pull)
            return 0
            ;;
        inspect)
            # `docker inspect --format '{{.Id}}' <image>` -> full sha256 form.
            printf '%s\n' "$LATEST_FULL"
            return 0
            ;;
        ps)
            # running container uses the in-use image; ImageID is full sha256.
            printf '%s %s\n' "$INUSE_FULL" "asklokesh/loki-mode:inuse"
            return 0
            ;;
        images)
            # Model docker's reference filter BEHAVIORALLY so the decoy test is
            # non-vacuous: only a query that actually carries
            # reference=asklokesh/loki-mode is scoped to loki-mode images. If the
            # implementation dropped that filter, real docker would surface the
            # decoy (a DIFFERENT repo), so this stub emits the decoy in that case
            # -> the decoy would reach rmi -> the assertion below fails. A correct
            # (filtered) implementation never sees the decoy.
            local _has_ref=0
            printf '%s\n' "$*" | grep -q 'reference=asklokesh/loki-mode' && _has_ref=1
            if printf '%s\n' "$*" | grep -q 'dangling=true'; then
                # No dangling loki-mode images in this scenario. An unfiltered
                # dangling query would still leak the decoy.
                [ "$_has_ref" = "1" ] || printf '%s\n' "$DECOY_SHORT"
                return 0
            fi
            # short-form ids, exactly like real `docker images --format {{.ID}}`
            printf '%s\n' "$LATEST_SHORT"
            printf '%s\n' "$INUSE_SHORT"
            printf '%s\n' "$OLD_SHORT"
            # Decoy belongs to a different repo: present ONLY when the scoping
            # reference filter is missing.
            [ "$_has_ref" = "1" ] || printf '%s\n' "$DECOY_SHORT"
            return 0
            ;;
        rmi)
            shift
            printf '%s\n' "$1" >> "$RMI_FILE"
            return 0
            ;;
        *)
            return 0
            ;;
    esac
}

LOKI_DOCKER_PRUNE=1 LOKI_DOCKER_IMAGE="asklokesh/loki-mode:latest" \
    loki_docker_pull_and_prune >/dev/null 2>&1

# The old, unused image MUST be removed.
if grep -q "^${OLD_SHORT}\$" "$RMI_FILE"; then
    pass "old unused loki-mode image (${OLD_SHORT}) is removed"
else
    fail "old unused loki-mode image (${OLD_SHORT}) was NOT removed"
fi

# The just-pulled :latest MUST be excluded (sha256 vs short normalization).
if grep -q "^${LATEST_SHORT}\$" "$RMI_FILE"; then
    fail "just-pulled :latest (${LATEST_SHORT}) was wrongly removed (normalization bug)"
else
    pass "just-pulled :latest excluded across sha256/short boundary"
fi

# The in-use image MUST be excluded (full sha256 from ps vs short from images).
if grep -q "^${INUSE_SHORT}\$" "$RMI_FILE"; then
    fail "in-use image (${INUSE_SHORT}) was wrongly removed"
else
    pass "in-use image excluded across sha256/short boundary"
fi

# The decoy non-loki-mode image must NEVER reach rmi.
if grep -q "^${DECOY_SHORT}\$" "$RMI_FILE"; then
    fail "decoy non-loki-mode image (${DECOY_SHORT}) was touched"
else
    pass "decoy non-loki-mode image never touched"
fi

# Exactly one rmi (the old image) should have happened.
rmi_count=$(grep -c . "$RMI_FILE" 2>/dev/null || echo 0)
if [ "$rmi_count" = "1" ]; then
    pass "exactly one rmi performed (the old image only)"
else
    fail "expected exactly 1 rmi, got $rmi_count: $(tr '\n' ' ' < "$RMI_FILE")"
fi

# Verify the implementation actually scopes enumeration with the reference
# filter (static guard: the source must filter reference=asklokesh/loki-mode and
# must never call `docker image prune -a`).
if grep -q "reference=asklokesh/loki-mode" "$DOCKER_RUN_SH"; then
    pass "prune enumerates with reference=asklokesh/loki-mode filter"
else
    fail "prune is missing the reference=asklokesh/loki-mode scope filter"
fi
# Match an actual invocation (line begins with optional whitespace then `docker
# image prune -a`), not the prohibition documented in a comment.
if grep -Eq '^[[:space:]]*docker[[:space:]]+image[[:space:]]+prune[[:space:]]+-a' "$DOCKER_RUN_SH"; then
    fail "source contains a forbidden 'docker image prune -a' invocation"
else
    pass "no 'docker image prune -a' invocation in source"
fi

unset -f docker

#-------------------------------------------------------------------------------
# 4. loki_docker_write_runstate + loki_docker_clear_runstate
#-------------------------------------------------------------------------------
echo "== loki_docker_write_runstate / clear_runstate =="

PROJ="${TMP_ROOT}/proj"
mkdir -p "$PROJ"
RUNJSON="${PROJ}/.loki/docker/run.json"

loki_docker_write_runstate "loki-deadbeef1234" "asklokesh/loki-mode:latest" "$PROJ"
wr=$?
if [ "$wr" = "0" ] && [ -f "$RUNJSON" ]; then
    pass "write_runstate created $RUNJSON"
else
    fail "write_runstate did not create run.json (rc=$wr)"
fi

if command -v python3 >/dev/null 2>&1; then
    if python3 -m json.tool "$RUNJSON" >/dev/null 2>&1; then
        pass "run.json is valid JSON"
    else
        fail "run.json is NOT valid JSON"
    fi
    got_container="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["container"])' "$RUNJSON" 2>/dev/null)"
    got_image="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$RUNJSON" 2>/dev/null)"
    got_proj="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["project_dir"])' "$RUNJSON" 2>/dev/null)"
    got_started="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["started_at"])' "$RUNJSON" 2>/dev/null)"
    [ "$got_container" = "loki-deadbeef1234" ] && pass "container field correct" || fail "container field wrong: '$got_container'"
    [ "$got_image" = "asklokesh/loki-mode:latest" ] && pass "image field correct" || fail "image field wrong: '$got_image'"
    [ "$got_proj" = "$PROJ" ] && pass "project_dir field correct" || fail "project_dir field wrong: '$got_proj'"
    if [[ "$got_started" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
        pass "started_at is ISO8601 UTC"
    else
        fail "started_at is not ISO8601 UTC: '$got_started'"
    fi
else
    fail "python3 not available to validate run.json"
fi

loki_docker_clear_runstate "$PROJ"
if [ ! -f "$RUNJSON" ]; then
    pass "clear_runstate removed run.json"
else
    fail "clear_runstate did not remove run.json"
fi
# Idempotent: clearing again must not error.
if loki_docker_clear_runstate "$PROJ"; then
    pass "clear_runstate is idempotent (no error when absent)"
else
    fail "clear_runstate errored when run.json absent"
fi

#-------------------------------------------------------------------------------
# 5. loki_docker_container_name
#-------------------------------------------------------------------------------
echo "== loki_docker_container_name =="

n1="$(loki_docker_container_name /tmp/some/workspace/path)"
n1b="$(loki_docker_container_name /tmp/some/workspace/path)"
n2="$(loki_docker_container_name /tmp/a/different/path)"

if [[ "$n1" =~ ^loki- ]]; then
    pass "container_name has loki- prefix ($n1)"
else
    fail "container_name missing loki- prefix: '$n1'"
fi
if [ "$n1" = "$n1b" ]; then
    pass "container_name is deterministic for the same path"
else
    fail "container_name not stable: '$n1' vs '$n1b'"
fi
if [ "$n1" != "$n2" ]; then
    pass "container_name differs for a different path ($n2)"
else
    fail "container_name collided for different paths: '$n1' == '$n2'"
fi

# Parity with the name build_argv assigns: when a sha tool is present the name
# is loki-<sha12 of path>. Recompute independently and compare.
if command -v shasum >/dev/null 2>&1; then
    expect="loki-$(printf '%s' /tmp/some/workspace/path | shasum -a 256 | cut -c1-12)"
    [ "$n1" = "$expect" ] && pass "container_name matches shasum sha12 form" || fail "container_name sha12 mismatch: '$n1' vs '$expect'"
elif command -v sha256sum >/dev/null 2>&1; then
    expect="loki-$(printf '%s' /tmp/some/workspace/path | sha256sum | cut -c1-12)"
    [ "$n1" = "$expect" ] && pass "container_name matches sha256sum sha12 form" || fail "container_name sha12 mismatch: '$n1' vs '$expect'"
fi

#-------------------------------------------------------------------------------
echo
echo "RESULTS: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
