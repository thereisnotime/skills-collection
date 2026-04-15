"""Unit tests for check_data_access_level.py lint script."""
import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve().parent / "check_data_access_level.py"


def _run(root: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SCRIPT.parent) + (
        os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""
    )
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--path", str(root)],
        capture_output=True,
        text=True,
        env=env,
    )


def _write_skill(root: Path, name: str, frontmatter_body: str) -> None:
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\n{frontmatter_body}---\n\n# {name}\n",
        encoding="utf-8",
    )


class TestLintScript(unittest.TestCase):
    def test_missing_field_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(
                root,
                "example-skill",
                textwrap.dedent(
                    """\
                    name: example-skill
                    description: "test"
                    metadata:
                      version: "1.0"
                      status: active
                    """
                ),
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("data_access_level", result.stdout + result.stderr)

    def test_invalid_value_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(
                root,
                "example-skill",
                textwrap.dedent(
                    """\
                    name: example-skill
                    description: "test"
                    metadata:
                      version: "1.0"
                      status: active
                      data_access_level: public
                    """
                ),
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("public", result.stdout + result.stderr)

    def test_valid_value_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, level in [
                ("a", "raw"),
                ("b", "redacted"),
                ("c", "verified_only"),
            ]:
                _write_skill(
                    root,
                    name,
                    textwrap.dedent(
                        f"""\
                        name: {name}
                        description: "test"
                        metadata:
                          version: "1.0"
                          status: active
                          data_access_level: {level}
                        """
                    ),
                )
            result = _run(root)
            self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_malformed_yaml_reports_on_stdout(self) -> None:
        """FrontmatterError detail must appear on stdout, not only stderr."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = root / "bad-skill"
            skill_dir.mkdir()
            # Deliberately invalid YAML: tab character where spaces are required
            (skill_dir / "SKILL.md").write_text(
                "---\nkey: valid\n\tbad_indent: boom\n---\n\n# bad-skill\n",
                encoding="utf-8",
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            # The yaml.YAMLError detail must be on stdout so CI stdout-only
            # capture preserves the root cause.
            self.assertIn("malformed YAML frontmatter", result.stdout)
            # Nothing about this error should leak only to stderr.
            self.assertNotIn("malformed YAML frontmatter", result.stderr)


if __name__ == "__main__":
    unittest.main()
