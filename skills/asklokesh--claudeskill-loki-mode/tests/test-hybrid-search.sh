#!/usr/bin/env bash
# Wrapper for the hybrid codebase retrieval unit tests (Release 3).
# Runs the pure-logic Python tests (manifest diff, staleness, RRF, budget,
# grep-only fallback). chromadb requires python3.12 on this stack; the Python
# tests skip the live-ChromaDB parts cleanly when the container is absent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY=/opt/homebrew/bin/python3.12
if [[ ! -x "$PY" ]]; then
    PY="$(command -v python3 || true)"
fi
if [[ -z "$PY" ]]; then
    echo "python3 not found; cannot run hybrid search tests" >&2
    exit 1
fi

"$PY" "$SCRIPT_DIR/test_hybrid_search.py"
