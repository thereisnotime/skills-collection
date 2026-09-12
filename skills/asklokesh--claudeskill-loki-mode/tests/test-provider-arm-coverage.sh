#!/usr/bin/env bash
# Every provider the CLI ACCEPTS must have a dispatch arm everywhere it dispatches.
#
# THE DEFECT, reproduced through the real entrypoint: `loki provider set opencode`
# printed "Provider set to: opencode" with no warning, wrote .loki/state/provider,
# and then `loki agent run <any-type>` printed the persona banner and died with
# "Unknown provider: opencode". The phase dispatcher already had a working
# opencode arm, so this was a plain omission in cmd_agent, not an unsupported
# provider. `agent review` was missing BOTH opencode and aider.
#
# WHY A TEST AND NOT JUST THE FIX: this is the cross-cutting-registration shape
# that broke main for three releases when the 5th provider shipped. A new
# provider must be added to EVERY dispatch site, and nothing enforced that.
#
# WHAT IS LOAD-BEARING: assert each provider arm INDIVIDUALLY, never a count.
# A count cannot say WHICH provider vanished and picks up slack it was never
# meant to have.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-provider-arm-coverage"

# The providers the CLI actually accepts. Derived from the provider files that
# ship, so adding providers/<x>.sh without wiring it is what this catches.
PROVIDERS="claude codex cline aider opencode"

# Extract a case block by the line range between a start anchor and its esac.
_block() {
    awk -v start="$1" 'index($0,start){f=1} f{print} f&&/^[[:space:]]*esac/{exit}' autonomy/loki
}

# 1-2. `loki agent run` and `loki agent review` must dispatch every provider.
#      Comments are stripped first: a text guard that matches the comment
#      explaining its own fix passes on broken code.
for site in 'agent_exit=$?' 'review_prompt'; do
    case "$site" in
        'agent_exit=$?') label="agent run";    anchor='full_prompt' ;;
        *)               label="agent review"; anchor='review_prompt' ;;
    esac
    blk="$(_block "$anchor" | sed 's/#.*//')"
    if [ -z "$blk" ]; then
        fail "$label: could not locate the provider case block (unmeasured, not clean)"
        continue
    fi
    for p in $PROVIDERS; do
        if printf '%s' "$blk" | grep -qE "^[[:space:]]*${p}\)"; then
            pass "$label dispatches $p"
        else
            fail "$label has no '$p)' arm; that provider dies with Unknown provider"
        fi
    done
done

# 3. GUARD AGAINST VACUITY: opencode must really be an accepted provider, or
#    every assertion above is guarding a provider nobody can select.
if grep -qE '^\s*opencode\)' autonomy/loki && [ -f providers/opencode.sh ]; then
    pass "opencode is a real, selectable provider (so the arms above matter)"
else
    fail "opencode is not selectable; these assertions would be vacuous"
fi

# 4. The helper the new arms call must actually exist.
if grep -q '^provider_invoke()' providers/opencode.sh; then
    pass "providers/opencode.sh defines provider_invoke"
else
    fail "provider_invoke missing; the opencode arms would call nothing"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
