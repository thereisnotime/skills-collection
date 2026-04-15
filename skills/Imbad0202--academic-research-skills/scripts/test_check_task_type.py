# scripts/test_check_task_type.py
"""Unit tests for check_task_type.py lint script."""
import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve().parent / "check_task_type.py"


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


class TestTaskTypeLint(unittest.TestCase):
    def test_missing_field_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(
                root, "example",
                textwrap.dedent("""\
                    name: example
                    description: "test"
                    metadata:
                      version: "1.0"
                      status: active
                    """),
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("task_type", result.stdout + result.stderr)

    def test_invalid_value_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(
                root, "example",
                textwrap.dedent("""\
                    name: example
                    description: "test"
                    metadata:
                      version: "1.0"
                      status: active
                      task_type: experimental
                    """),
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("experimental", result.stdout + result.stderr)

    def test_valid_value_passes(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, value in [("a", "open-ended"), ("b", "outcome-gradable")]:
                _write_skill(
                    root, name,
                    textwrap.dedent(f"""\
                        name: {name}
                        description: "test"
                        metadata:
                          version: "1.0"
                          status: active
                          task_type: {value}
                        """),
                )
            result = _run(root)
            self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_malformed_yaml_reports_on_stdout(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = root / "broken"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(
                "---\nname: broken\nmetadata:\n\tversion: \"1.0\"\n---\n",
                encoding="utf-8",
            )
            result = _run(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("malformed YAML frontmatter", result.stdout)
            self.assertNotIn("malformed YAML frontmatter", result.stderr)


if __name__ == "__main__":
    unittest.main()
