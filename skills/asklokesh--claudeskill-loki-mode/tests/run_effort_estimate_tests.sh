#!/usr/bin/env bash
# Wrapper to invoke the Rank 6 effort-estimator tests (per-build
# effort_estimate in proof.json). Exists so tests/run-all-tests.sh -- which
# expects a single executable file per test entry and invokes it with bash --
# can include this Python suite alongside the bash tests (matches the crash
# scrubber wrapper at tests/crash/run_crash_redact_tests.sh).
#
# The suite is self-contained (unittest.main, exits nonzero on any failure).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 "$SCRIPT_DIR/test_effort_estimate.py"
exit "$?"
