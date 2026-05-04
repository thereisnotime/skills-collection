#!/usr/bin/env bash
# Wrapper to invoke the pytest suite for /api/quality/architecture (v7.5.15).
# Exists so tests/run-all-tests.sh -- which expects a single executable file
# per test entry -- can include this Python suite alongside the bash tests.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -m pytest -q "$SCRIPT_DIR/test_quality_architecture_endpoint.py"
