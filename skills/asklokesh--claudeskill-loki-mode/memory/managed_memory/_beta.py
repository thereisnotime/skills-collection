"""
Loki Managed Agents Memory - Beta Header (v6.83.0 Phase 1).

Single source of truth for the anthropic-beta header required by Claude
Managed Agents. All callers in memory/managed_memory/ import BETA_HEADER
from here. Update this constant to roll to a new beta.
"""

# Pin to the public Managed Agents beta channel current as of v6.83.0.
# This value is sent as the `anthropic-beta` HTTP header on every request.
BETA_HEADER = "managed-agents-2026-04-01"
