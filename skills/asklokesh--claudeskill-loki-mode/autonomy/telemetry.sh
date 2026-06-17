#!/usr/bin/env bash
# Anonymous usage telemetry for Loki Mode
# Collection is OPT-IN and OFF by default. Nothing is sent unless the user opts
# in, so a default install never phones home (air-gapped / GDPR / FedRAMP safe).
# Opt-in:  LOKI_TELEMETRY=on  OR  ~/.loki/config: TELEMETRY_ENABLED=true
# Opt-out (always wins): LOKI_TELEMETRY=off / LOKI_TELEMETRY_DISABLED=true /
#                        DO_NOT_TRACK=1 / ~/.loki/config: TELEMETRY_DISABLED=true
# All calls are fire-and-forget, silent on failure, non-blocking

LOKI_POSTHOG_HOST="${LOKI_TELEMETRY_ENDPOINT:-https://us.i.posthog.com}"
LOKI_POSTHOG_KEY="phc_ya0vGBru41AJWtGNfZZ8H9W4yjoZy4KON0nnayS7s87"

_loki_telemetry_enabled() {
    # Unified OPT-IN gate. Returns 0 (enabled) ONLY when the user opted in AND
    # did not also opt out. Opt-out always wins; default is OFF. This precedence
    # MUST mirror loki_collection_enabled in autonomy/crash.sh and _is_enabled in
    # dashboard/telemetry.py so one model gates BOTH usage telemetry and crash
    # reporting.
    #   1. Any opt-out flag present  -> 1 (hard kill, always wins)
    #   2. Else any opt-in flag present -> 0
    #   3. Else (default)            -> 1 (no egress)
    local _telem_lower
    _telem_lower="$(printf '%s' "${LOKI_TELEMETRY:-}" | tr '[:upper:]' '[:lower:]')"

    # --- 1. Opt-out always wins ---
    [ "$_telem_lower" = "off" ] && return 1
    [ "${LOKI_TELEMETRY_DISABLED:-}" = "true" ] && return 1
    [ "${DO_NOT_TRACK:-}" = "1" ] && return 1
    if [ -f "${HOME}/.loki/config" ] && grep -q "^TELEMETRY_DISABLED=true" "${HOME}/.loki/config" 2>/dev/null; then
        return 1
    fi

    # --- 2. Opt-in required to enable ---
    if [ "$_telem_lower" = "on" ]; then
        command -v curl >/dev/null 2>&1 || return 1
        return 0
    fi
    if [ -f "${HOME}/.loki/config" ] && grep -q "^TELEMETRY_ENABLED=true" "${HOME}/.loki/config" 2>/dev/null; then
        command -v curl >/dev/null 2>&1 || return 1
        return 0
    fi

    # --- 3. Default: OFF ---
    return 1
}

_loki_telemetry_id() {
    local id_file="${HOME}/.loki-telemetry-id"
    if [ -f "$id_file" ] 2>/dev/null; then
        cat "$id_file" 2>/dev/null
        return
    fi
    local new_id
    new_id=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null) || \
    new_id=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]') || \
    new_id="anon-$(date +%s)-$$"
    printf '%s\n' "$new_id" > "$id_file" 2>/dev/null
    printf '%s' "$new_id"
}

_loki_detect_channel() {
    local dir="${PROJECT_DIR:-${SKILL_DIR:-${SCRIPT_DIR:-}}}"
    if [ -f "/.dockerenv" ] 2>/dev/null; then printf 'docker'; return; fi
    case "$dir" in
        */Cellar/*|*/homebrew/*) printf 'homebrew' ;;
        */node_modules/*) printf 'npm' ;;
        */.claude/skills/*) printf 'skill' ;;
        *) printf 'source' ;;
    esac
}

loki_telemetry() {
    _loki_telemetry_enabled || return 0
    local event="$1"; shift
    local distinct_id
    distinct_id=$(_loki_telemetry_id 2>/dev/null) || return 0
    local version
    version=$(cat "${SCRIPT_DIR:-${SKILL_DIR:-}}/VERSION" 2>/dev/null || cat "${SCRIPT_DIR:-${SKILL_DIR:-}}/../VERSION" 2>/dev/null || echo "unknown")
    version=$(echo "$version" | tr -d '[:space:]')
    local channel
    channel=$(_loki_detect_channel 2>/dev/null || echo "unknown")
    local os_name arch
    os_name=$(uname -s 2>/dev/null || echo "unknown")
    arch=$(uname -m 2>/dev/null || echo "unknown")

    # Build JSON payload safely using Python to prevent injection
    local extra_args=""
    for arg in "$@"; do
        extra_args="${extra_args}${extra_args:+ }${arg}"
    done

    local payload
    payload=$(python3 -c "
import json, sys
props = {'os': sys.argv[1], 'arch': sys.argv[2], 'version': sys.argv[3], 'channel': sys.argv[4]}
for arg in sys.argv[5:]:
    if '=' in arg:
        k, v = arg.split('=', 1)
        props[k] = v
print(json.dumps({'api_key': '$LOKI_POSTHOG_KEY', 'event': sys.argv[5] if len(sys.argv) > 5 else '', 'distinct_id': '$distinct_id', 'properties': props}))
" "$os_name" "$arch" "$version" "$channel" $extra_args 2>/dev/null) || return 0
    # Re-inject event and distinct_id properly
    payload=$(python3 -c "
import json, sys
d = json.loads(sys.argv[1])
d['event'] = sys.argv[2]
d['distinct_id'] = sys.argv[3]
print(json.dumps(d))
" "$payload" "$event" "$distinct_id" 2>/dev/null) || return 0

    (curl -sS --max-time 3 -X POST "${LOKI_POSTHOG_HOST}/capture/" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null 2>&1 &) 2>/dev/null
    return 0
}
