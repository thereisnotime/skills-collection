#!/usr/bin/env python3
"""
Manage Elasticsearch environments configuration.

Stores per-environment settings (URL, index pattern, optional credentials)
in environments.json so the skill can query different clusters by name
(e.g. dev, rc, prod). At least one environment must remain configured.
"""

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent.parent
CONFIG_LOCATIONS = [
    SCRIPT_DIR / "environments.json",
    Path.home() / ".config" / "claude" / "elastic-search-logs-environments.json",
]
DEFAULT_INDEX_PATTERN = "app-logs-*"


def find_config() -> Optional[Path]:
    for path in CONFIG_LOCATIONS:
        if path.exists():
            return path
    return None


def default_config_path() -> Path:
    return CONFIG_LOCATIONS[0]


def load_config(path: Optional[Path] = None) -> tuple[dict, Path]:
    """Load the config or return an empty one. Returns (config, path_used)."""
    resolved = path or find_config() or default_config_path()
    if not resolved.exists() or resolved.stat().st_size == 0:
        return {"environments": []}, resolved
    validate_config_permissions(resolved)
    with open(resolved) as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error: {resolved} is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)
    if not isinstance(data, dict) or not isinstance(data.get("environments"), list):
        print(
            f"Error: {resolved} must be an object with an 'environments' array.",
            file=sys.stderr,
        )
        sys.exit(1)
    return data, resolved


def save_config(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    if os.name != "nt":
        os.chmod(path, 0o600)


def validate_config_permissions(path: Path) -> None:
    """Warn if config has insecure permissions (Unix only)."""
    if os.name == "nt":
        return
    mode = path.stat().st_mode
    if bool(mode & stat.S_IRWXG) or bool(mode & stat.S_IRWXO):
        print(
            f"WARNING: {path} is readable by group/other. Run: chmod 600 {path}",
            file=sys.stderr,
        )


def find_env(config: dict, name: str) -> Optional[dict]:
    for env in config["environments"]:
        if env.get("name", "").lower() == name.lower():
            return env
    return None


def env_names(config: dict) -> list[str]:
    return [e.get("name", "") for e in config["environments"]]


def print_env(env: dict) -> None:
    print(f"  [{env['name']}]")
    print(f"    URL:           {env.get('url', '(missing)')}")
    print(f"    Index pattern: {env.get('index_pattern', DEFAULT_INDEX_PATTERN)}")
    if env.get("description"):
        print(f"    Description:   {env['description']}")
    if env.get("username"):
        print(f"    Username:      {env['username']}")
    if env.get("password"):
        print(f"    Password:      ********")


def cmd_list(args: argparse.Namespace) -> None:
    config, path = load_config(args.config)
    envs = config["environments"]
    print(f"Config: {path}")
    if not envs:
        print("\nNo environments configured.")
        print(
            f"Add one with: python3 {Path(sys.argv[0]).name} add <name> --url <url>"
        )
        return
    print(f"\nConfigured environments ({len(envs)}):\n")
    for env in envs:
        print_env(env)
        print()


def cmd_add(args: argparse.Namespace) -> None:
    config, path = load_config(args.config)
    if find_env(config, args.name):
        print(
            f"Error: env '{args.name}' already exists. Use `update` to modify it.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not args.url:
        print("Error: --url is required.", file=sys.stderr)
        sys.exit(1)

    new_env: dict = {"name": args.name, "url": args.url}
    if args.index_pattern:
        new_env["index_pattern"] = args.index_pattern
    if args.description:
        new_env["description"] = args.description
    if args.username:
        new_env["username"] = args.username
    if args.password:
        new_env["password"] = args.password

    config["environments"].append(new_env)
    save_config(config, path)
    print(f"Added env '{args.name}'.")
    print(f"Config: {path}")


def cmd_update(args: argparse.Namespace) -> None:
    config, path = load_config(args.config)
    env = find_env(config, args.name)
    if not env:
        print(f"Error: env '{args.name}' not found.", file=sys.stderr)
        print(f"Available: {', '.join(env_names(config)) or '(none)'}", file=sys.stderr)
        sys.exit(1)

    updates = {
        "url": args.url,
        "index_pattern": args.index_pattern,
        "description": args.description,
        "username": args.username,
        "password": args.password,
    }
    applied = {k: v for k, v in updates.items() if v is not None}
    if not applied:
        print(
            "Error: pass at least one of --url, --index-pattern, --description, --username, --password.",
            file=sys.stderr,
        )
        sys.exit(1)

    env.update(applied)
    save_config(config, path)
    print(f"Updated env '{args.name}': {', '.join(applied.keys())}.")


def cmd_remove(args: argparse.Namespace) -> None:
    config, path = load_config(args.config)
    env = find_env(config, args.name)
    if not env:
        print(f"Error: env '{args.name}' not found.", file=sys.stderr)
        print(f"Available: {', '.join(env_names(config)) or '(none)'}", file=sys.stderr)
        sys.exit(1)
    if len(config["environments"]) == 1:
        print(
            f"Error: cannot remove '{args.name}' — it is the only configured env. "
            "Add another env first, then remove this one.",
            file=sys.stderr,
        )
        sys.exit(1)
    config["environments"] = [
        e for e in config["environments"] if e.get("name", "").lower() != args.name.lower()
    ]
    save_config(config, path)
    print(f"Removed env '{args.name}'.")


def cmd_get(args: argparse.Namespace) -> None:
    config, path = load_config(args.config)
    env = find_env(config, args.name)
    if not env:
        print(f"Error: env '{args.name}' not found.", file=sys.stderr)
        print(f"Available: {', '.join(env_names(config)) or '(none)'}", file=sys.stderr)
        sys.exit(1)

    if args.format == "json":
        print(json.dumps(env, indent=2))
        return

    if args.format == "export":
        url = env.get("url", "")
        idx = env.get("index_pattern", DEFAULT_INDEX_PATTERN)
        default_username = os.environ.get(
            "ES_DEFAULT_USERNAME", os.environ.get("ES_USERNAME", "")
        )
        default_password = os.environ.get(
            "ES_DEFAULT_PASSWORD", os.environ.get("ES_PASSWORD", "")
        )
        effective_username = env.get("username", default_username)
        effective_password = env.get("password", default_password)
        lines = [
            f'export ES_BASE_URL={shell_quote(url)}',
            f'export ES_INDEX_PATTERN={shell_quote(idx)}',
            f'export ES_DEFAULT_USERNAME={shell_quote(default_username)}',
            f'export ES_DEFAULT_PASSWORD={shell_quote(default_password)}',
            f'export ES_USERNAME={shell_quote(effective_username)}',
            f'export ES_PASSWORD={shell_quote(effective_password)}',
        ]
        print("\n".join(lines))
        return

    print(f"Name:          {env['name']}")
    print(f"URL:           {env.get('url', '(missing)')}")
    print(f"Index pattern: {env.get('index_pattern', DEFAULT_INDEX_PATTERN)}")
    if env.get("description"):
        print(f"Description:   {env['description']}")
    if env.get("username"):
        print(f"Username:      {env['username']}")
    if env.get("password"):
        print(f"Password:      ********")


def shell_quote(value: str) -> str:
    """Single-quote a string for safe shell embedding."""
    return "'" + value.replace("'", "'\\''") + "'"


def require_at_least_one_env(args: argparse.Namespace) -> None:
    """Used by `check` to verify the skill has a usable config."""
    config, path = load_config(args.config)
    if not config["environments"]:
        print(
            f"Error: no environments configured at {path}. "
            f"At least one env is required. Run: python3 {Path(sys.argv[0]).name} add <name> --url <url>",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"OK: {len(config['environments'])} env(s) configured at {path}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage Elasticsearch environments for the elastic-search-logs skill.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list
  %(prog)s add dev --url https://es-dev.example.com:9243
  %(prog)s add prod --url https://es-prod.example.com:9243 --index-pattern app-logs-* --description "Production cluster"
  %(prog)s update dev --url https://es-dev-new.example.com:9243
  %(prog)s remove rc
  %(prog)s get dev
  %(prog)s get dev --format export
        """,
    )
    parser.add_argument("--config", "-c", type=Path, help="Path to environments.json")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List configured environments")
    p_list.set_defaults(func=cmd_list)

    p_add = sub.add_parser("add", help="Add a new environment")
    p_add.add_argument("name", help="Environment name (e.g. dev, rc, prod)")
    p_add.add_argument("--url", required=True, help="Elasticsearch base URL")
    p_add.add_argument("--index-pattern", help=f"Index pattern (default: {DEFAULT_INDEX_PATTERN})")
    p_add.add_argument("--description", help="Optional description for auto-selection")
    p_add.add_argument("--username", help="Optional per-env username (overrides ES_USERNAME)")
    p_add.add_argument("--password", help="Optional per-env password (overrides ES_PASSWORD)")
    p_add.set_defaults(func=cmd_add)

    p_update = sub.add_parser("update", help="Update an existing environment")
    p_update.add_argument("name", help="Environment name to update")
    p_update.add_argument("--url", help="New Elasticsearch base URL")
    p_update.add_argument("--index-pattern", help="New index pattern")
    p_update.add_argument("--description", help="New description")
    p_update.add_argument("--username", help="New per-env username")
    p_update.add_argument("--password", help="New per-env password")
    p_update.set_defaults(func=cmd_update)

    p_remove = sub.add_parser("remove", help="Remove an environment (cannot remove the only env)")
    p_remove.add_argument("name", help="Environment name to remove")
    p_remove.set_defaults(func=cmd_remove)

    p_get = sub.add_parser("get", help="Get an environment's settings")
    p_get.add_argument("name", help="Environment name")
    p_get.add_argument(
        "--format",
        choices=["human", "json", "export"],
        default="human",
        help="Output format (default: human). 'export' prints shell export statements.",
    )
    p_get.set_defaults(func=cmd_get)

    p_check = sub.add_parser(
        "check",
        help="Verify at least one environment is configured (exit 1 otherwise)",
    )
    p_check.set_defaults(func=require_at_least_one_env)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
