"""Dependency-free, network-free tests for the generate-image helper CLI."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[2] / "skills" / "generate-image"
SCRIPT = SKILL_ROOT / "scripts" / "generate_image.py"


def load_module():
    """Import the CLI under a unique name so it cannot collide with other skills.

    Bytecode writing is suppressed: a __pycache__ left inside the skill directory
    would ship as an artifact the agent never loads.
    """
    spec = importlib.util.spec_from_file_location("generate_image_skill_cli", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


gi = load_module()


def make_args(**overrides) -> argparse.Namespace:
    defaults = dict(
        prompt="a prompt",
        model=gi.DEFAULT_MODEL,
        output=None,
        input=None,
        n=None,
        aspect_ratio=None,
        resolution=None,
        size=None,
        quality=None,
        output_format=None,
        background=None,
        output_compression=None,
        seed=None,
    )
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


class CliSurfaceTests(unittest.TestCase):
    def test_help_exits_zero(self):
        completed = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--help"],
            text=True, capture_output=True, timeout=20, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("usage:", completed.stdout.lower())

    def test_missing_prompt_is_an_error(self):
        completed = subprocess.run(
            [sys.executable, "-B", str(SCRIPT)],
            text=True, capture_output=True, timeout=20, check=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("prompt is required", completed.stderr)

    def test_targets_the_images_endpoint_not_chat_completions(self):
        self.assertEqual(gi.IMAGES_URL, "https://openrouter.ai/api/v1/images")
        self.assertEqual(gi.MODELS_URL, "https://openrouter.ai/api/v1/images/models")
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("chat/completions", source)
        self.assertNotIn("modalities", source)

    def test_uses_only_the_standard_library(self):
        source = SCRIPT.read_text(encoding="utf-8")
        for third_party in ("import requests", "import httpx", "from requests"):
            self.assertNotIn(third_party, source)


class ApiKeyResolutionTests(unittest.TestCase):
    def test_explicit_key_wins(self):
        self.assertEqual(gi.find_api_key("explicit-key"), "explicit-key")

    def test_environment_variable_is_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous = os.getcwd()
            os.chdir(tmp)
            try:
                os.environ["OPENROUTER_API_KEY"] = "env-key"
                self.assertEqual(gi.find_api_key(None), "env-key")
            finally:
                os.environ.pop("OPENROUTER_API_KEY", None)
                os.chdir(previous)

    def test_dotenv_is_read_when_environment_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / ".env").write_text(
                "# comment\nOTHER=1\nOPENROUTER_API_KEY=\"dotenv-key\"\n", encoding="utf-8"
            )
            previous = os.getcwd()
            os.chdir(tmp)
            try:
                os.environ.pop("OPENROUTER_API_KEY", None)
                self.assertEqual(gi.find_api_key(None), "dotenv-key")
            finally:
                os.chdir(previous)

    def test_absent_key_raises_with_guidance(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous = os.getcwd()
            os.chdir(tmp)
            try:
                os.environ.pop("OPENROUTER_API_KEY", None)
                with self.assertRaises(gi.ApiError) as caught:
                    gi.find_api_key(None)
                self.assertIn("OPENROUTER_API_KEY", str(caught.exception))
            finally:
                os.chdir(previous)


class PayloadTests(unittest.TestCase):
    def test_unset_parameters_are_omitted(self):
        payload = gi.build_payload(make_args())
        self.assertEqual(set(payload), {"model", "prompt"})

    def test_set_parameters_are_included(self):
        payload = gi.build_payload(make_args(aspect_ratio="16:9", seed=42, n=3))
        self.assertEqual(payload["aspect_ratio"], "16:9")
        self.assertEqual(payload["seed"], 42)
        self.assertEqual(payload["n"], 3)
        self.assertNotIn("quality", payload)

    def test_zero_seed_survives_omission_filtering(self):
        payload = gi.build_payload(make_args(seed=0))
        self.assertEqual(payload["seed"], 0)

    def test_references_use_the_input_references_shape(self):
        payload = gi.build_payload(make_args(input=["https://example.com/a.png"]))
        self.assertEqual(
            payload["input_references"],
            [{"type": "image_url", "image_url": {"url": "https://example.com/a.png"}}],
        )


class ReferenceEncodingTests(unittest.TestCase):
    def test_urls_and_data_urls_pass_through(self):
        for value in ("https://e.com/a.png", "http://e.com/a.png", "data:image/png;base64,AAA"):
            self.assertEqual(gi.encode_reference(value), value)

    def test_local_file_becomes_a_data_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pic.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\nfake")
            encoded = gi.encode_reference(str(path))
            self.assertTrue(encoded.startswith("data:image/png;base64,"))
            self.assertEqual(
                base64.b64decode(encoded.split(",", 1)[1]), b"\x89PNG\r\n\x1a\nfake"
            )

    def test_jpeg_extension_maps_to_jpeg_mime(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pic.jpg"
            path.write_bytes(b"jpegbytes")
            self.assertTrue(gi.encode_reference(str(path)).startswith("data:image/jpeg;base64,"))

    def test_missing_file_raises(self):
        with self.assertRaises(gi.ApiError):
            gi.encode_reference("/nonexistent/nope.png")

    def test_unsupported_extension_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pic.tiff"
            path.write_bytes(b"x")
            with self.assertRaises(gi.ApiError):
                gi.encode_reference(str(path))


class OutputPathTests(unittest.TestCase):
    def test_default_name_follows_media_type(self):
        self.assertEqual(gi.output_paths(None, "image/png", 1), [Path("generated_image.png")])
        self.assertEqual(gi.output_paths(None, "image/svg+xml", 1), [Path("generated_image.svg")])
        self.assertEqual(gi.output_paths(None, "image/jpeg", 1), [Path("generated_image.jpg")])

    def test_unknown_media_type_falls_back_to_png(self):
        self.assertEqual(gi.output_paths(None, "image/unheard-of", 1), [Path("generated_image.png")])

    def test_explicit_output_is_respected(self):
        self.assertEqual(gi.output_paths("art.png", "image/png", 1), [Path("art.png")])

    def test_multiple_images_are_numbered(self):
        self.assertEqual(
            gi.output_paths("out.png", "image/png", 3),
            [Path("out_1.png"), Path("out_2.png"), Path("out_3.png")],
        )


class SaveImageTests(unittest.TestCase):
    def test_saves_base64_payload(self):
        payload = base64.b64encode(b"imagebytes").decode("ascii")
        response = {"data": [{"b64_json": payload, "media_type": "image/png"}]}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "out.png"
            written = gi.save_images(response, str(target))
            self.assertEqual(written, [target])
            self.assertEqual(target.read_bytes(), b"imagebytes")

    def test_creates_missing_parent_directories(self):
        payload = base64.b64encode(b"x").decode("ascii")
        response = {"data": [{"b64_json": payload, "media_type": "image/png"}]}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "nested" / "dir" / "out.png"
            gi.save_images(response, str(target))
            self.assertTrue(target.is_file())

    def test_empty_data_raises(self):
        with self.assertRaises(gi.ApiError):
            gi.save_images({"data": []}, None)


class SkillDocumentTests(unittest.TestCase):
    def test_frontmatter_version_matches_expected(self):
        text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertRegex(text, r'\n  version: "\d+\.\d+"\n')

    def test_documented_default_model_matches_the_script(self):
        text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn(gi.DEFAULT_MODEL, text)

    def test_reference_file_is_present(self):
        self.assertTrue((SKILL_ROOT / "references" / "models.md").is_file())


if __name__ == "__main__":
    unittest.main()
