#!/usr/bin/env bash
# Install Loki Mode's git hooks (committed under .githooks/) by pointing
# git at the directory. Idempotent.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
git config core.hooksPath .githooks
echo "[install-hooks] core.hooksPath -> .githooks"
echo "[install-hooks] hooks active:"
ls -1 .githooks
