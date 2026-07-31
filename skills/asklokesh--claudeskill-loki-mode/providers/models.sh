#!/usr/bin/env bash
# Dynamic model-catalog loader for Loki Mode providers.
#
# Instead of hardcoding dated model IDs (e.g. claude-sonnet-4-5-20250929)
# throughout the codebase, every provider and caller reads from the single
# source of truth at providers/model_catalog.json. When a new model ships,
# update that one JSON file and every provider picks it up.
#
# Usage:
#   source providers/models.sh
#   model=$(loki_latest_model claude planning)   # -> claude-opus-4-8
#
# Env override order: LOKI_<PROVIDER>_MODEL_<TIER> > LOKI_<PROVIDER>_MODEL > catalog latest.

# Resolve catalog path relative to this script, regardless of CWD.
_LOKI_MODELS_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LOKI_MODEL_CATALOG="${LOKI_MODEL_CATALOG:-$_LOKI_MODELS_SH_DIR/model_catalog.json}"

# Return the "latest_<tier>" id for a provider from the catalog.
# Args: $1 provider (claude|codex|cline|aider)
#       $2 tier     (planning|development|fast)
loki_latest_model() {
    local provider="${1:-claude}"
    local tier="${2:-planning}"
    local tier_upper
    tier_upper=$(printf '%s' "$tier" | tr '[:lower:]' '[:upper:]')
    local provider_upper
    # Uppercase AND normalize to a legal shell identifier. A provider named with
    # a hyphen (e.g. "some-new-vendor") would otherwise build
    # LOKI_SOME-NEW-VENDOR_MODEL_DEVELOPMENT, which is not a valid variable name;
    # the indirect expansion below then fails and takes the whole lookup with it,
    # so the provider silently resolves to nothing. Found when adding the generic
    # registry fallback: "notaprovider" worked and "some-new-vendor" did not.
    provider_upper=$(printf '%s' "$provider" \
        | tr '[:lower:]' '[:upper:]' \
        | tr -c 'A-Z0-9_' '_' )

    # Env override chain
    local override="LOKI_${provider_upper}_MODEL_${tier_upper}"
    if [ -n "${!override:-}" ]; then
        printf '%s' "${!override}"
        return 0
    fi
    local generic_override="LOKI_${provider_upper}_MODEL"
    if [ -n "${!generic_override:-}" ]; then
        printf '%s' "${!generic_override}"
        return 0
    fi

    if [ ! -f "$LOKI_MODEL_CATALOG" ]; then
        return 1
    fi
    # Require python3 (all Loki runtimes ship with it).
    python3 - "$LOKI_MODEL_CATALOG" "$provider" "$tier" <<'PY'
import json, sys
catalog_path, provider, tier = sys.argv[1], sys.argv[2], sys.argv[3]
with open(catalog_path) as fh:
    data = json.load(fh)
providers = data.get("providers", {})
p = providers.get(provider)
if not p:
    # REGISTRY FALLBACK (v8.2.0). A fixed table of provider keys means every
    # unknown provider is a fallthrough that resolves to NOTHING -- verified
    # before this change: `loki_latest_model notaprovider development` returned
    # empty with rc=1. That makes "bring your own endpoint" a dead end, which is
    # the opposite of model-agnostic.
    #
    # A "generic" key turns the unknown case into a first-class one. It is the
    # same shape codex already uses (all three tiers collapsed onto one model),
    # so this generalizes an accepted pattern rather than inventing a mechanism.
    #
    # The env-override chain above still wins, so an operator naming a specific
    # model per tier is never overridden by this default.
    p = providers.get("generic")
    if not p:
        sys.exit(1)
model = p.get(f"latest_{tier}")
if not model:
    sys.exit(1)
print(model)
PY
}

# Print full catalog for a provider as lines: <id>\t<tier>\t<alias?>
# Useful for `loki provider models <name>` output.
loki_list_models() {
    local provider="${1:-claude}"
    if [ ! -f "$LOKI_MODEL_CATALOG" ]; then
        return 1
    fi
    python3 - "$LOKI_MODEL_CATALOG" "$provider" <<'PY'
import json, sys
catalog_path, provider = sys.argv[1], sys.argv[2]
with open(catalog_path) as fh:
    data = json.load(fh)
p = data.get("providers", {}).get(provider, {})
for m in p.get("models", []):
    alias = m.get("alias", "")
    print(f"{m.get('id','')}\t{m.get('tier','')}\t{alias}")
PY
}
