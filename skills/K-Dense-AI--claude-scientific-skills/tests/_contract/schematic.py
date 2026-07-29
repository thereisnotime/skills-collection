"""Shared tests for the AI schematic generator bundled by three skills.

`scientific-schematics`, `latex-posters`, and `literature-review` each ship a
byte-identical `scripts/generate_schematic.py` (a thin CLI) and
`scripts/generate_schematic_ai.py` (the generator). Rather than write the same
tests three times, each suite instantiates `schematic_test_case()` against its
own copy; `tests/_meta` separately pins the copies together.

The behaviour worth testing offline is the environment allowlist. The CLI
re-executes the generator as a subprocess, and it deliberately forwards a
named set of variables rather than the whole parent environment -- copying
everything would hand the child every unrelated secret exported in the calling
shell. Nothing here makes a network call or needs an API key.
"""

from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from unittest import mock


def schematic_test_case(skill_root: Path) -> type[unittest.TestCase]:
    """Build the shared schematic-generator TestCase for one skill."""
    scripts = skill_root / "scripts"

    def load():
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        return importlib.import_module("generate_schematic")

    class SchematicContractTests(unittest.TestCase):
        maxDiff = None

        def setUp(self) -> None:
            self.module = load()

        def test_only_allowlisted_variables_reach_the_subprocess(self) -> None:
            environment = {
                "PATH": "/usr/bin",
                "HOME": "/home/someone",
                "AWS_SECRET_ACCESS_KEY": "should-not-be-forwarded",
                "GITHUB_TOKEN": "also-not",
            }
            with mock.patch.dict("os.environ", environment, clear=True):
                built = self.module.build_subprocess_env(None)

            self.assertEqual(built["PATH"], "/usr/bin")
            self.assertEqual(built["HOME"], "/home/someone")
            self.assertNotIn("AWS_SECRET_ACCESS_KEY", built)
            self.assertNotIn("GITHUB_TOKEN", built)

        def test_the_api_key_is_injected_under_the_expected_name(self) -> None:
            with mock.patch.dict("os.environ", {"PATH": "/usr/bin"}, clear=True):
                built = self.module.build_subprocess_env("sk-or-test")
            self.assertEqual(built["OPENROUTER_API_KEY"], "sk-or-test")

        def test_no_key_means_no_key_variable_rather_than_an_empty_one(self) -> None:
            # An empty OPENROUTER_API_KEY would look configured to the child and
            # fail deep inside the request instead of at the boundary.
            with mock.patch.dict("os.environ", {"PATH": "/usr/bin"}, clear=True):
                for value in (None, ""):
                    with self.subTest(value=value):
                        self.assertNotIn(
                            "OPENROUTER_API_KEY", self.module.build_subprocess_env(value)
                        )

        def test_absent_variables_are_omitted_not_blanked(self) -> None:
            with mock.patch.dict("os.environ", {"PATH": "/usr/bin"}, clear=True):
                built = self.module.build_subprocess_env(None)
            self.assertEqual(set(built), {"PATH"})

        def test_the_allowlist_covers_proxies_tls_and_windows_startup(self) -> None:
            forwarded = set(self.module.FORWARDED_ENV_VARS)
            # Dropping any of these breaks the child in a way that looks like a
            # model failure rather than a configuration one.
            for required in (
                "PATH", "HOME",
                "HTTPS_PROXY", "https_proxy",
                "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE",
                "SYSTEMROOT", "COMSPEC",
            ):
                with self.subTest(variable=required):
                    self.assertIn(required, forwarded)

        def test_the_allowlist_carries_no_credential_variables(self) -> None:
            forwarded = " ".join(self.module.FORWARDED_ENV_VARS).upper()
            for banned in ("SECRET", "TOKEN", "PASSWORD", "API_KEY", "CREDENTIAL"):
                with self.subTest(term=banned):
                    self.assertNotIn(banned, forwarded)

        def test_the_allowlist_has_no_duplicates(self) -> None:
            forwarded = self.module.FORWARDED_ENV_VARS
            self.assertEqual(len(set(forwarded)), len(forwarded))

        def test_the_generator_script_is_shipped_alongside_the_cli(self) -> None:
            self.assertTrue((scripts / "generate_schematic_ai.py").is_file())

    SchematicContractTests.__qualname__ = f"SchematicContractTests[{skill_root.name}]"
    return SchematicContractTests
