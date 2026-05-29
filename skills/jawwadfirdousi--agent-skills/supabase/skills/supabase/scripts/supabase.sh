#!/usr/bin/env bash
# Supabase CLI - Management SQL helpers + environment management
set -euo pipefail

CLI_SUPABASE_ENV=""
REMAINING_ARGS=()

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PRIMARY="${SKILL_DIR}/environments.json"
CONFIG_FALLBACK="${HOME}/.config/claude/supabase-environments.json"

require_jq() {
    if ! command -v jq >/dev/null 2>&1; then
        echo "Error: jq is required" >&2
        exit 1
    fi
}

# Active config path: first existing, else the primary (skill-local) path.
config_path() {
    if [[ -f "$CONFIG_PRIMARY" ]]; then
        echo "$CONFIG_PRIMARY"
    elif [[ -f "$CONFIG_FALLBACK" ]]; then
        echo "$CONFIG_FALLBACK"
    else
        echo "$CONFIG_PRIMARY"
    fi
}

# Emit the config JSON (empty skeleton if missing/empty); validates JSON.
read_config() {
    local p
    p="$(config_path)"
    if [[ -s "$p" ]]; then
        jq . "$p" 2>/dev/null || {
            echo "Error: $p is not valid JSON" >&2
            exit 1
        }
    else
        echo '{"environments":[]}'
    fi
}

# Atomic write + chmod 600 (config may hold tokens).
write_config() {
    require_jq
    local p tmp
    p="$(config_path)"
    mkdir -p "$(dirname "$p")"
    tmp="$(mktemp)"
    printf '%s\n' "$1" > "$tmp"
    mv "$tmp" "$p"
    chmod 600 "$p" 2>/dev/null || true
}

env_names_csv() {
    echo "$1" | jq -r '[.environments[].name] | join(", ")'
}

env_exists() {
    echo "$1" | jq -e --arg n "$2" '.environments[] | select(.name == $n)' >/dev/null 2>&1
}

# Render one environment object ($1) in the given format ($2): human|json|export.
emit_env() {
    local env_json="$1" fmt="$2"
    case "$fmt" in
        json)
            echo "$env_json" | jq .
            ;;
        export)
            echo "$env_json" | jq -r '
                "export SUPABASE_URL=\((.url // "") | @sh)\n" +
                "export SUPABASE_ACCESS_TOKEN=\((.access_token // env.SUPABASE_ACCESS_TOKEN // "") | @sh)"'
            ;;
        *)
            echo "$env_json" | jq -r '
                "Name:          \(.name)\n" +
                "URL:           \(.url // "(missing)")" +
                (if .description then "\nDescription:   \(.description)" else "" end) +
                (if .access_token then "\nAccess token:  ********"
                 else "\nAccess token:  (from SUPABASE_ACCESS_TOKEN shell var)" end)'
            ;;
    esac
}

# --- env subcommands ------------------------------------------------------

# Parse <name> plus --url / --access-token / --description into ENV_* globals.
parse_env_args() {
    ENV_NAME=""
    ENV_URL=""
    ENV_TOKEN=""
    ENV_DESC=""
    while (( $# > 0 )); do
        case "$1" in
            --url)
                [[ -n "${2:-}" ]] || { echo "Error: --url requires a value" >&2; exit 1; }
                ENV_URL="$2"; shift 2 ;;
            --access-token)
                [[ -n "${2:-}" ]] || { echo "Error: --access-token requires a value" >&2; exit 1; }
                ENV_TOKEN="$2"; shift 2 ;;
            --description)
                [[ -n "${2:-}" ]] || { echo "Error: --description requires a value" >&2; exit 1; }
                ENV_DESC="$2"; shift 2 ;;
            -*)
                echo "Error: Unknown option: $1" >&2; exit 1 ;;
            *)
                if [[ -z "$ENV_NAME" ]]; then
                    ENV_NAME="$1"; shift
                else
                    echo "Error: unexpected argument: $1" >&2; exit 1
                fi ;;
        esac
    done
}

cmd_env_list() {
    require_jq
    local cfg p count
    cfg="$(read_config)"
    p="$(config_path)"
    count="$(echo "$cfg" | jq '.environments | length')"
    echo "Config: $p"
    if [[ "$count" -eq 0 ]]; then
        echo
        echo "No environments configured."
        echo "Add one with: supabase.sh env add <name> --url <url>"
        return
    fi
    echo
    echo "Configured environments ($count):"
    echo
    echo "$cfg" | jq -r '.environments[] |
        "  [\(.name)]\n    URL:           \(.url // "(missing)")" +
        (if .description then "\n    Description:   \(.description)" else "" end) +
        (if .access_token then "\n    Access token:  ********"
         else "\n    Access token:  (from SUPABASE_ACCESS_TOKEN shell var)" end) + "\n"'
}

cmd_env_add() {
    require_jq
    parse_env_args "$@"
    [[ -n "$ENV_NAME" ]] || { echo "Error: env name required" >&2; exit 1; }
    [[ -n "$ENV_URL" ]] || { echo "Error: --url is required." >&2; exit 1; }

    local cfg new
    cfg="$(read_config)"
    if env_exists "$cfg" "$ENV_NAME"; then
        echo "Error: env '$ENV_NAME' already exists. Use 'env update' to modify it." >&2
        exit 1
    fi
    new="$(echo "$cfg" | jq \
        --arg n "$ENV_NAME" --arg u "$ENV_URL" --arg d "$ENV_DESC" --arg t "$ENV_TOKEN" '
        .environments += [
            ({name: $n, url: $u}
             + (if $d != "" then {description: $d} else {} end)
             + (if $t != "" then {access_token: $t} else {} end))
        ]')"
    write_config "$new"
    echo "Added env '$ENV_NAME'."
    echo "Config: $(config_path)"
    if [[ -z "$ENV_TOKEN" ]]; then
        echo "Note: no access token stored; SUPABASE_ACCESS_TOKEN must be set in the shell."
    fi
}

cmd_env_update() {
    require_jq
    parse_env_args "$@"
    [[ -n "$ENV_NAME" ]] || { echo "Error: env name required" >&2; exit 1; }

    local cfg new
    cfg="$(read_config)"
    if ! env_exists "$cfg" "$ENV_NAME"; then
        echo "Error: env '$ENV_NAME' not found." >&2
        echo "Available: $(env_names_csv "$cfg")" >&2
        exit 1
    fi
    if [[ -z "$ENV_URL" && -z "$ENV_TOKEN" && -z "$ENV_DESC" ]]; then
        echo "Error: pass at least one of --url, --access-token, --description." >&2
        exit 1
    fi
    new="$(echo "$cfg" | jq \
        --arg n "$ENV_NAME" --arg u "$ENV_URL" --arg d "$ENV_DESC" --arg t "$ENV_TOKEN" '
        .environments |= map(
            if .name == $n then
                . + (if $u != "" then {url: $u} else {} end)
                  + (if $d != "" then {description: $d} else {} end)
                  + (if $t != "" then {access_token: $t} else {} end)
            else . end)')"
    write_config "$new"
    echo "Updated env '$ENV_NAME'."
}

cmd_env_remove() {
    require_jq
    local name="${1:-}"
    [[ -n "$name" ]] || { echo "Error: env name required" >&2; exit 1; }

    local cfg count new
    cfg="$(read_config)"
    if ! env_exists "$cfg" "$name"; then
        echo "Error: env '$name' not found." >&2
        echo "Available: $(env_names_csv "$cfg")" >&2
        exit 1
    fi
    count="$(echo "$cfg" | jq '.environments | length')"
    if [[ "$count" -eq 1 ]]; then
        echo "Error: cannot remove '$name' — it is the only configured env. Add another first." >&2
        exit 1
    fi
    new="$(echo "$cfg" | jq --arg n "$name" '.environments |= map(select(.name != $n))')"
    write_config "$new"
    echo "Removed env '$name'."
}

cmd_env_get() {
    require_jq
    local name="" fmt="human"
    while (( $# > 0 )); do
        case "$1" in
            --format)
                [[ -n "${2:-}" ]] || { echo "Error: --format requires a value" >&2; exit 1; }
                fmt="$2"; shift 2 ;;
            -*)
                echo "Error: Unknown option: $1" >&2; exit 1 ;;
            *)
                if [[ -z "$name" ]]; then name="$1"; shift; else
                    echo "Error: unexpected argument: $1" >&2; exit 1
                fi ;;
        esac
    done
    [[ -n "$name" ]] || { echo "Error: env name required" >&2; exit 1; }
    case "$fmt" in human|json|export) ;; *)
        echo "Error: --format must be human, json, or export" >&2; exit 1 ;;
    esac

    local cfg env_json
    cfg="$(read_config)"
    env_json="$(echo "$cfg" | jq -e --arg n "$name" '.environments[] | select(.name == $n)')" || {
        echo "Error: env '$name' not found." >&2
        echo "Available: $(env_names_csv "$cfg")" >&2
        exit 1
    }
    emit_env "$env_json" "$fmt"
}

cmd_env_check() {
    require_jq
    local cfg p count
    cfg="$(read_config)"
    p="$(config_path)"
    count="$(echo "$cfg" | jq '.environments | length')"
    if [[ "$count" -eq 0 ]]; then
        echo "Error: no environments configured at $p." >&2
        echo "Run: supabase.sh env add <name> --url <url>" >&2
        exit 1
    fi
    echo "OK: $count env(s) configured at $p."
}

env_usage() {
    cat << 'USAGE'
Usage: supabase.sh env <subcommand> [args]

Subcommands:
  list                                    List configured environments
  add <name> --url <url> [opts]           Add an environment
  update <name> [opts]                    Update fields on an environment
  remove <name>                           Remove an environment (blocked on the last one)
  get <name> [--format human|json|export] Inspect one environment
  check                                   Verify at least one env is configured

Options for add/update:
  --url <url>             Supabase project URL (https://<ref>.supabase.co)
  --access-token <tok>    Management API token (sbp_...); falls back to $SUPABASE_ACCESS_TOKEN
  --description <text>    Optional description

Config: environments.json at the skill root (gitignored, chmod 600).
USAGE
}

cmd_env() {
    local sub="${1:-}"
    shift || true
    case "$sub" in
        list)   cmd_env_list "$@" ;;
        add)    cmd_env_add "$@" ;;
        update) cmd_env_update "$@" ;;
        remove) cmd_env_remove "$@" ;;
        get)    cmd_env_get "$@" ;;
        check)  cmd_env_check "$@" ;;
        ""|help|-h|--help) env_usage ;;
        *)
            echo "Unknown env subcommand: $sub" >&2
            env_usage
            exit 1 ;;
    esac
}

# --- environment resolution for SQL --------------------------------------

# Print export statements for a chosen env. With a name, that env (error if not
# found). Without a name, the only env (error if zero or multiple).
resolve_env_export() {
    require_jq
    local name="$1" cfg count env_json
    cfg="$(read_config)"
    count="$(echo "$cfg" | jq '.environments | length')"

    if [[ -n "$name" ]]; then
        env_json="$(echo "$cfg" | jq -e --arg n "$name" '.environments[] | select(.name == $n)')" || {
            echo "Error: env '$name' not found." >&2
            echo "Available: $(env_names_csv "$cfg")" >&2
            exit 1
        }
        emit_env "$env_json" export
        return
    fi

    if [[ "$count" -eq 0 ]]; then
        echo "Error: no environments configured at $(config_path)." >&2
        echo "Add one: supabase.sh env add <name> --url https://<ref>.supabase.co --access-token sbp_..." >&2
        exit 1
    fi
    if [[ "$count" -gt 1 ]]; then
        echo "Error: multiple environments configured ($(env_names_csv "$cfg")). Specify one with --env <name>." >&2
        exit 1
    fi
    emit_env "$(echo "$cfg" | jq '.environments[0]')" export
}

# Resolve SUPABASE_URL / SUPABASE_ACCESS_TOKEN. Explicit --env wins; otherwise
# already-exported vars are used; failing that, the single configured env.
load_env_if_needed() {
    local exports
    if [[ -n "$CLI_SUPABASE_ENV" ]]; then
        exports="$(resolve_env_export "$CLI_SUPABASE_ENV")" || exit 1
        eval "$exports"
        return
    fi
    if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
        return
    fi
    exports="$(resolve_env_export "")" || exit 1
    eval "$exports"
}

ensure_env() {
    load_env_if_needed

    if [[ -z "${SUPABASE_URL:-}" ]]; then
        echo "Error: SUPABASE_URL not set" >&2
        echo "Hint: supabase.sh env add <name> --url https://<ref>.supabase.co --access-token sbp_..." >&2
        exit 1
    fi
    if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
        echo "Error: SUPABASE_ACCESS_TOKEN not set (required for management SQL)" >&2
        echo "Hint: store it on the env (env add/update --access-token) or export SUPABASE_ACCESS_TOKEN." >&2
        exit 1
    fi
}

project_ref() {
    local ref
    ref="${SUPABASE_URL#https://}"
    ref="${ref#http://}"
    ref="${ref%%.supabase.co*}"
    if [[ -z "$ref" ]]; then
        echo "Error: Unable to derive project ref from SUPABASE_URL" >&2
        exit 1
    fi
    echo "$ref"
}

# --- sql commands ---------------------------------------------------------

parse_shared_options() {
    CLI_SUPABASE_ENV=""
    while (( $# > 0 )); do
        case "$1" in
            --env)
                [[ -n "${2:-}" ]] || { echo "Error: --env requires a value" >&2; exit 1; }
                CLI_SUPABASE_ENV="$2"; shift 2 ;;
            --)
                shift; break ;;
            -*)
                echo "Error: Unknown option: $1" >&2; exit 1 ;;
            *)
                break ;;
        esac
    done
    REMAINING_ARGS=( "$@" )
}

execute_sql() {
    local sql="$1"
    if [[ -z "$sql" ]]; then
        echo "Error: SQL query required" >&2
        exit 1
    fi

    ensure_env
    require_jq

    local ref payload
    ref="$(project_ref)"
    payload=$(jq -n --arg q "$sql" '{query: $q}')
    curl -s -X POST "https://api.supabase.com/v1/projects/${ref}/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$payload" | jq .
}

cmd_sql() {
    parse_shared_options "$@"
    local sql="${REMAINING_ARGS[*]-}"
    execute_sql "$sql"
}

cmd_sql_file() {
    parse_shared_options "$@"
    local path="${REMAINING_ARGS[0]-}"
    if [[ -z "$path" ]]; then
        echo "Error: SQL file path required" >&2
        exit 1
    fi
    if [[ ! -f "$path" ]]; then
        echo "Error: SQL file not found: $path" >&2
        exit 1
    fi
    local sql
    sql="$(cat "$path")"
    if [[ -z "$sql" ]]; then
        echo "Error: SQL file is empty: $path" >&2
        exit 1
    fi
    execute_sql "$sql"
}

usage() {
    cat << 'USAGE'
Usage: supabase.sh <command> [args]

Commands:
  sql [--env <name>] <sql>        Run raw SQL via Supabase management API
  sql-file [--env <name>] <path>  Run raw SQL from a file via Supabase management API
  env <subcommand>                Manage environments (list/add/update/remove/get/check)
  help                            Show this help

Environment selection for sql / sql-file:
  1) --env <name> selects that env from environments.json
  2) else if SUPABASE_URL and SUPABASE_ACCESS_TOKEN are exported, they are used
  3) else the single configured env is auto-selected (error if multiple exist)

Examples:
  supabase.sh env add dev --url https://<ref>.supabase.co --access-token sbp_...
  supabase.sh env list
  supabase.sh sql --env dev "SELECT * FROM users LIMIT 5"
  supabase.sh sql --env prod "SELECT count(*) FROM users"
  supabase.sh sql-file --env dev ./migrations/001_init.sql
USAGE
}

case "${1:-help}" in
    sql)
        shift; cmd_sql "$@" ;;
    sql-file)
        shift; cmd_sql_file "$@" ;;
    env)
        shift; cmd_env "$@" ;;
    help|--help|-h)
        usage ;;
    *)
        echo "Unknown command: $1" >&2
        usage
        exit 1 ;;
esac
