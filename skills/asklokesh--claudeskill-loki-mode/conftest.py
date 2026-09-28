import os

import pytest

# Tests always run headless: loki never opens a browser under this (S-103).
os.environ.setdefault("LOKI_NO_BROWSER", "1")

# Register pytest-asyncio plugin at the top level (required by newer pytest versions)
pytest_plugins = ["pytest_asyncio"]
