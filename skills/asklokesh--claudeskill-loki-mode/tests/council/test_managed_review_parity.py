"""
T5 Phase 3: parity test.

With `providers.managed.run_council` stubbed to return synthetic verdicts,
invoke the `council_verdicts_to_txt_files` shell helper (as run.sh does
after a successful managed council run) and assert the legacy
`.loki/quality/reviews/<id>/<reviewer>.txt` files are produced in the
format the existing aggregation loop parses:

    VERDICT: PASS|FAIL
    FINDINGS:
    - [severity] description

Dashboard-panel single-writer invariant: only these .txt files exist for
this review_id; no duplicate writes from any other code path.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_SH = REPO_ROOT / "autonomy" / "run.sh"


class ManagedReviewParityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="loki-t5-parity-"))
        (self.tmp / ".loki").mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _invoke_helper(self, review_id: str, verdicts_json: str) -> subprocess.CompletedProcess:
        # Tee a minimal driver: source only the helper function out of
        # run.sh, then call it. Because run.sh has top-level side effects,
        # we use a bash subshell with a TRAP to stop after function
        # definitions -- simpler: use bash -c and extract the function
        # with a small Perl-like awk parse.
        #
        # Actually, the cleanest path: create a tiny driver that defines
        # a minimal emit_event_json stub and then includes just the
        # council_verdicts_to_txt_files body we need. We extract it from
        # run.sh at test time.
        driver = textwrap.dedent(
            f"""
            #!/usr/bin/env bash
            set -eu
            TARGET_DIR="{self.tmp}"
            export TARGET_DIR
            PROJECT_DIR="{REPO_ROOT}"
            export PROJECT_DIR

            # Minimal logger stubs so the helper's `log_*` callers don't
            # fail when called standalone.
            log_info() {{ :; }}
            log_warn() {{ :; }}
            log_error() {{ :; }}
            log_header() {{ :; }}
            log_step() {{ :; }}

            emit_event_json() {{
                mkdir -p "$TARGET_DIR/.loki"
                printf '{{"event":"%s"}}\\n' "$1" >> "$TARGET_DIR/.loki/events.jsonl"
            }}

            # Source the helper function only. Extract it via sed between
            # its opening and closing braces.
            helper_src=$(awk '/^council_verdicts_to_txt_files\\(\\) \\{{/,/^\\}}/' "{RUN_SH}")
            eval "$helper_src"

            council_verdicts_to_txt_files "{review_id}" "$1"
            """
        )
        driver_path = self.tmp / "driver.sh"
        driver_path.write_text(driver)
        driver_path.chmod(0o755)
        return subprocess.run(
            ["bash", str(driver_path), verdicts_json],
            env={**os.environ, "TARGET_DIR": str(self.tmp)},
            cwd=str(self.tmp),
            capture_output=True,
            text=True,
        )

    def test_synthetic_verdicts_produce_legacy_txt_files(self) -> None:
        review_id = "review-20260423T000000Z-0"
        payload = {
            "status": "ok",
            "verdicts": [
                {
                    "agent_id": "ag_sec_001",
                    "pool_name": "security-sentinel",
                    "verdict": "APPROVE",
                    "rationale": "No SQL injection found. Auth paths clean.",
                    "severity": None,
                },
                {
                    "agent_id": "ag_test_002",
                    "pool_name": "test-coverage-auditor",
                    "verdict": "REQUEST_CHANGES",
                    "rationale": "Missing edge case tests for nullable input.",
                    "severity": "medium",
                },
                {
                    "agent_id": "ag_perf_003",
                    "pool_name": "performance-oracle",
                    "verdict": "APPROVE",
                    "rationale": "",
                    "severity": None,
                },
            ],
        }
        proc = self._invoke_helper(review_id, json.dumps(payload))
        self.assertEqual(
            proc.returncode,
            0,
            msg=f"helper exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}",
        )

        review_dir = self.tmp / ".loki" / "quality" / "reviews" / review_id
        self.assertTrue(review_dir.exists(), f"{review_dir} not created")

        txts = {p.name: p.read_text(encoding="utf-8") for p in review_dir.glob("*.txt")}
        self.assertEqual(
            sorted(txts.keys()),
            sorted(
                [
                    "security-sentinel.txt",
                    "test-coverage-auditor.txt",
                    "performance-oracle.txt",
                ]
            ),
        )

        sec = txts["security-sentinel.txt"]
        self.assertTrue(sec.startswith("VERDICT: PASS"))
        self.assertIn("FINDINGS:", sec)

        test = txts["test-coverage-auditor.txt"]
        self.assertTrue(test.startswith("VERDICT: FAIL"))
        self.assertIn("FINDINGS:", test)
        self.assertIn("[Medium]", test)
        self.assertIn("nullable input", test)

        perf = txts["performance-oracle.txt"]
        self.assertTrue(perf.startswith("VERDICT: PASS"))
        self.assertIn("- None", perf)

    def test_abstain_verdict_maps_to_pass(self) -> None:
        review_id = "review-20260423T000001Z-0"
        payload = {
            "status": "ok",
            "verdicts": [
                {
                    "agent_id": "ag_x",
                    "pool_name": "security-sentinel",
                    "verdict": "ABSTAIN",
                    "rationale": "",
                },
            ],
        }
        proc = self._invoke_helper(review_id, json.dumps(payload))
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        content = (
            self.tmp / ".loki" / "quality" / "reviews" / review_id / "security-sentinel.txt"
        ).read_text()
        self.assertTrue(content.startswith("VERDICT: PASS"))

    def test_pool_name_is_sanitized(self) -> None:
        review_id = "review-20260423T000002Z-0"
        payload = {
            "status": "ok",
            "verdicts": [
                {
                    "agent_id": "ag_y",
                    "pool_name": "weird/../name with spaces",
                    "verdict": "APPROVE",
                    "rationale": "",
                },
            ],
        }
        proc = self._invoke_helper(review_id, json.dumps(payload))
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        review_dir = self.tmp / ".loki" / "quality" / "reviews" / review_id
        files = [p.name for p in review_dir.glob("*.txt")]
        self.assertEqual(len(files), 1)
        # No slashes, no "..", no whitespace in filename.
        self.assertNotIn("/", files[0])
        self.assertNotIn("..", files[0])
        self.assertNotIn(" ", files[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
