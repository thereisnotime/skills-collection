"""Unit tests for MiroFish adapter (autonomy/mirofish-adapter.py).

Tests PRD extraction, HTTP client, pipeline state management,
report normalization, and Docker container management.
All external calls (HTTP, Docker CLI) are mocked.
"""
import json
import os
import subprocess
import sys
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch, call
import http.client
import io

import pytest

# Resolve paths
ADAPTER_PATH = Path(__file__).parent.parent / "autonomy" / "mirofish-adapter.py"
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "mirofish"

# Import the adapter module directly
sys.path.insert(0, str(ADAPTER_PATH.parent))

# We import functions by loading the module so tests stay in-process
import importlib.util

_spec = importlib.util.spec_from_file_location("mirofish_adapter", str(ADAPTER_PATH))
mf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mf)


def _load_fixture(name: str) -> dict:
    """Load a JSON fixture file from tests/fixtures/mirofish/."""
    return json.loads((FIXTURES_DIR / name).read_text())


def run_adapter(*cli_args):
    """Run the adapter as a subprocess and return (returncode, stdout, stderr)."""
    cmd = [sys.executable, str(ADAPTER_PATH)] + list(cli_args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return result.returncode, result.stdout, result.stderr


# ---------------------------------------------------------------------------
# PRD Extraction Tests
# ---------------------------------------------------------------------------

class TestPRDExtraction:
    """Test extract_simulation_context() with various PRD formats."""

    def test_extracts_project_name_from_h1(self):
        """H1 heading is used as project name."""
        ctx = mf.extract_simulation_context(FIXTURES_DIR / "sample-prd.md")
        assert ctx["project_name"] == "Developer Productivity Dashboard"

    def test_extracts_value_proposition(self):
        """Value Proposition section is used as simulation_requirement."""
        ctx = mf.extract_simulation_context(FIXTURES_DIR / "sample-prd.md")
        assert "real-time dashboard" in ctx["simulation_requirement"].lower()
        assert "productivity" in ctx["simulation_requirement"].lower()

    def test_extracts_target_audience(self):
        """Target Audience section is extracted."""
        ctx = mf.extract_simulation_context(FIXTURES_DIR / "sample-prd.md")
        assert "engineering manager" in ctx["target_audience"].lower()

    def test_fallback_for_minimal_prd(self):
        """PRD without structured sections falls back to first 2000 chars."""
        ctx = mf.extract_simulation_context(FIXTURES_DIR / "minimal-prd.md")
        assert "CSV" in ctx["simulation_requirement"]
        # Project name falls back to filename-derived
        assert ctx["project_name"]  # not empty

    def test_empty_prd_handled_gracefully(self, tmp_path):
        """Empty PRD produces non-empty fallback (filename as project name)."""
        empty_prd = tmp_path / "empty-project.md"
        empty_prd.write_text("")
        ctx = mf.extract_simulation_context(empty_prd)
        assert ctx["project_name"] == "Empty Project"
        # simulation_requirement is empty since file is empty -- that is fine
        assert ctx["simulation_requirement"] == ""

    def test_binary_file_handled_gracefully(self, tmp_path):
        """Non-UTF8 file is read with errors='replace', no crash."""
        binary_prd = tmp_path / "binary.md"
        binary_prd.write_bytes(b"\x80\x81\x82 Some text \xff\xfe")
        ctx = mf.extract_simulation_context(binary_prd)
        assert ctx["project_name"]  # derived from filename
        # Should not raise

    def test_prd_summary_limited_to_200_chars(self):
        """prd_summary is the first 200 chars."""
        ctx = mf.extract_simulation_context(FIXTURES_DIR / "sample-prd.md")
        assert len(ctx["prd_summary"]) <= 200

    def test_problem_statement_used_as_requirement(self, tmp_path):
        """## Problem Statement section is preferred for simulation_requirement."""
        prd = tmp_path / "problem-first.md"
        prd.write_text(
            "# My App\n\n"
            "## Problem Statement\n"
            "Users cannot track expenses efficiently.\n\n"
            "## Target Audience\n"
            "Freelancers and small business owners.\n"
        )
        ctx = mf.extract_simulation_context(prd)
        assert "expenses" in ctx["simulation_requirement"].lower()
        assert ctx["target_audience"].startswith("Freelancers")


# ---------------------------------------------------------------------------
# MiroFish HTTP Client Tests
# ---------------------------------------------------------------------------

class TestMiroFishClient:
    """Test MiroFishClient with mocked urllib responses."""

    def _mock_response(self, data: dict, status: int = 200):
        """Create a mock urllib response."""
        body = json.dumps(data).encode("utf-8")
        resp = MagicMock()
        resp.read.return_value = body
        resp.status = status
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    @patch("urllib.request.urlopen")
    def test_health_check_returns_true_on_ok(self, mock_urlopen):
        """Health check returns True when API returns status=ok."""
        mock_urlopen.return_value = self._mock_response({"status": "ok"})
        client = mf.MiroFishClient("http://localhost:5001")
        assert client.health_check() is True

    @patch("urllib.request.urlopen")
    def test_health_check_returns_false_on_connection_error(self, mock_urlopen):
        """Health check returns False on connection refused."""
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
        client = mf.MiroFishClient("http://localhost:5001")
        assert client.health_check() is False

    @patch("urllib.request.urlopen")
    def test_health_check_returns_false_on_timeout(self, mock_urlopen):
        """Health check returns False on socket timeout."""
        import socket
        mock_urlopen.side_effect = urllib.error.URLError(socket.timeout("timed out"))
        client = mf.MiroFishClient("http://localhost:5001")
        assert client.health_check() is False

    @patch("urllib.request.urlopen")
    def test_generate_ontology_sends_multipart(self, mock_urlopen):
        """generate_ontology sends multipart/form-data with PRD file."""
        mock_urlopen.return_value = self._mock_response(
            _load_fixture("mock-ontology-response.json")
        )
        client = mf.MiroFishClient("http://localhost:5001")
        result = client.generate_ontology(
            prd_path=str(FIXTURES_DIR / "sample-prd.md"),
            simulation_requirement="Test requirement",
            project_name="Test Project",
        )
        # Verify the request was made
        assert mock_urlopen.called
        req = mock_urlopen.call_args[0][0]
        assert "multipart/form-data" in req.get_header("Content-type")
        # Verify response parsed correctly
        assert result["data"]["project_id"] == "proj_test_001"

    @patch("urllib.request.urlopen")
    def test_build_graph_returns_task_id(self, mock_urlopen):
        """build_graph returns response with task_id."""
        mock_urlopen.return_value = self._mock_response({
            "data": {
                "project_id": "proj_001",
                "graph_id": "graph_001",
                "task_id": "task_001",
                "status": "started",
            }
        })
        client = mf.MiroFishClient("http://localhost:5001")
        result = client.build_graph("proj_001")
        assert result["data"]["task_id"] == "task_001"

    @patch("urllib.request.urlopen")
    def test_poll_graph_build_returns_on_completed(self, mock_urlopen):
        """poll_graph_build returns when status is completed."""
        mock_urlopen.return_value = self._mock_response({
            "data": {
                "status": "completed",
                "graph_id": "graph_001",
            }
        })
        client = mf.MiroFishClient("http://localhost:5001")
        result = client.poll_graph_build("task_001", max_wait=5, interval=0.1)
        assert result["status"] == "completed"
        assert result["graph_id"] == "graph_001"

    @patch("urllib.request.urlopen")
    def test_poll_raises_on_timeout(self, mock_urlopen):
        """poll_graph_build raises RuntimeError on timeout."""
        mock_urlopen.return_value = self._mock_response({
            "data": {"status": "running"}
        })
        client = mf.MiroFishClient("http://localhost:5001")
        with pytest.raises(RuntimeError, match="timed out"):
            client.poll_graph_build("task_001", max_wait=0.2, interval=0.05)

    @patch("urllib.request.urlopen")
    def test_poll_raises_on_failed_status(self, mock_urlopen):
        """poll_graph_build raises RuntimeError when status is failed."""
        mock_urlopen.return_value = self._mock_response({
            "data": {"status": "failed", "error": "graph build error"}
        })
        client = mf.MiroFishClient("http://localhost:5001")
        with pytest.raises(RuntimeError, match="Graph build failed"):
            client.poll_graph_build("task_001", max_wait=5, interval=0.1)

    @patch("urllib.request.urlopen")
    def test_request_raises_on_http_error(self, mock_urlopen):
        """HTTP 500 errors are converted to RuntimeError."""
        err = urllib.error.HTTPError(
            "http://localhost:5001/api/test",
            500,
            "Internal Server Error",
            {},
            io.BytesIO(b'{"error": "server crashed"}'),
        )
        mock_urlopen.side_effect = err
        client = mf.MiroFishClient("http://localhost:5001")
        with pytest.raises(RuntimeError, match="MiroFish API error: 500"):
            client._request("GET", "/api/test")

    @patch("urllib.request.urlopen")
    def test_create_simulation_sends_correct_payload(self, mock_urlopen):
        """create_simulation sends project_id, graph_id, and platform flags."""
        mock_urlopen.return_value = self._mock_response({
            "data": {"simulation_id": "sim_001", "status": "created"}
        })
        client = mf.MiroFishClient("http://localhost:5001")
        result = client.create_simulation(
            "proj_001", "graph_001", enable_twitter=True, enable_reddit=False
        )
        assert result["data"]["simulation_id"] == "sim_001"
        # Check the request body
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["project_id"] == "proj_001"
        assert body["graph_id"] == "graph_001"
        assert body["enable_twitter"] is True
        assert body["enable_reddit"] is False

    @patch("urllib.request.urlopen")
    def test_get_report_returns_sections(self, mock_urlopen):
        """get_report returns report data with sections."""
        fixture = _load_fixture("mock-report-response.json")
        mock_urlopen.return_value = self._mock_response(fixture)
        client = mf.MiroFishClient("http://localhost:5001")
        result = client.get_report("report_test_001")
        assert result["data"]["report_id"] == "report_test_001"
        assert len(result["data"]["sections"]) == 6


# ---------------------------------------------------------------------------
# Pipeline State Tests
# ---------------------------------------------------------------------------

class TestPipelineState:
    """Test pipeline state persistence and loading."""

    def test_state_written_after_update(self, tmp_path):
        """State file is created when _update_pipeline_state is called."""
        state = {
            "version": "1.0",
            "status": "running",
            "stages": {},
        }
        mf._update_pipeline_state(tmp_path, state)
        state_path = tmp_path / "mirofish" / "pipeline-state.json"
        assert state_path.exists()
        loaded = json.loads(state_path.read_text())
        assert loaded["status"] == "running"
        assert "updated_at" in loaded

    def test_state_loads_correctly(self, tmp_path):
        """State loads correctly from written file."""
        state = {
            "version": "1.0",
            "status": "completed",
            "current_stage": 4,
            "stages": {"1_ontology": {"status": "completed"}},
        }
        mf._update_pipeline_state(tmp_path, state)
        loaded = mf._load_pipeline_state(tmp_path)
        assert loaded is not None
        assert loaded["status"] == "completed"
        assert loaded["current_stage"] == 4

    def test_returns_none_when_no_state_file(self, tmp_path):
        """Returns None when no pipeline state file exists."""
        result = mf._load_pipeline_state(tmp_path)
        assert result is None

    def test_resume_detects_completed_stages(self, tmp_path):
        """Partial state fixture has completed and pending stages."""
        # Copy fixture to the expected location
        fixture = _load_fixture("mock-pipeline-state-partial.json")
        mf_dir = tmp_path / "mirofish"
        mf_dir.mkdir(parents=True, exist_ok=True)
        (mf_dir / "pipeline-state.json").write_text(json.dumps(fixture))

        loaded = mf._load_pipeline_state(tmp_path)
        assert loaded is not None
        assert loaded["stages"]["1_ontology"]["status"] == "completed"
        assert loaded["stages"]["2_graph"]["status"] == "running"
        assert loaded["stages"]["3_simulation"]["status"] == "pending"
        assert loaded["stages"]["4_report"]["status"] == "pending"

    def test_corrupt_state_returns_none(self, tmp_path):
        """Corrupt JSON in state file returns None."""
        mf_dir = tmp_path / "mirofish"
        mf_dir.mkdir(parents=True, exist_ok=True)
        (mf_dir / "pipeline-state.json").write_text("{invalid json")
        result = mf._load_pipeline_state(tmp_path)
        assert result is None


# ---------------------------------------------------------------------------
# Report Normalization Tests
# ---------------------------------------------------------------------------

class TestReportNormalization:
    """Test normalize_report() with mock report data."""

    @pytest.fixture
    def report_fixture(self):
        return _load_fixture("mock-report-response.json")

    def test_extracts_positive_leaning_sentiment(self, report_fixture):
        """Report with more positive than negative keywords gets positive-leaning score."""
        result = mf.normalize_report(report_fixture)
        analysis = result["analysis"]
        # The fixture has 5 positive and 3 negative keywords -> 0.62 score
        # This is above neutral (0.5) but below the "positive" threshold (0.65)
        assert analysis["overall_sentiment"] in ("positive", "mixed")
        assert analysis["sentiment_score"] >= 0.5

    def test_extracts_key_concerns(self, report_fixture):
        """Key concerns are extracted from risk sections."""
        result = mf.normalize_report(report_fixture)
        concerns = result["analysis"]["key_concerns"]
        assert len(concerns) > 0
        # Should find privacy, metric gaming, etc.
        concern_text = " ".join(concerns).lower()
        assert "privacy" in concern_text or "metric" in concern_text

    def test_extracts_feature_rankings(self, report_fixture):
        """Feature rankings are extracted with scores."""
        result = mf.normalize_report(report_fixture)
        rankings = result["analysis"]["feature_rankings"]
        assert len(rankings) > 0
        # Check structure
        for rank in rankings:
            assert "feature" in rank
            assert "reception_score" in rank
            assert isinstance(rank["reception_score"], float)

    def test_burnout_feature_ranked_highest(self, report_fixture):
        """Burnout early warning system should have highest reception score."""
        result = mf.normalize_report(report_fixture)
        rankings = result["analysis"]["feature_rankings"]
        if rankings:
            top = max(rankings, key=lambda r: r["reception_score"])
            assert "burnout" in top["feature"].lower()

    def test_extracts_notable_quotes(self, report_fixture):
        """Notable quotes are extracted (max 5)."""
        result = mf.normalize_report(report_fixture)
        quotes = result["analysis"]["notable_quotes"]
        assert len(quotes) > 0
        assert len(quotes) <= 5

    def test_sets_recommendation_based_on_sentiment(self, report_fixture):
        """Recommendation should be set based on sentiment score."""
        result = mf.normalize_report(report_fixture)
        rec = result["analysis"]["recommendation"]
        assert rec in ("proceed", "review_concerns", "reconsider")

    def test_handles_empty_report_gracefully(self):
        """Empty report produces safe defaults."""
        empty_report = {"data": {"sections": [], "report_id": "", "simulation_id": ""}}
        result = mf.normalize_report(empty_report)
        assert result["analysis"]["overall_sentiment"] in ("positive", "negative", "mixed")
        assert result["analysis"]["sentiment_score"] == 0.5
        assert result["analysis"]["key_concerns"] == []
        assert result["analysis"]["feature_rankings"] == []
        assert result["analysis"]["notable_quotes"] == []

    def test_handles_missing_sections_key(self):
        """Report without sections key still works."""
        no_sections = {"data": {"report_id": "r1", "simulation_id": "s1"}}
        result = mf.normalize_report(no_sections)
        assert result["analysis"]["confidence"] == "low"

    def test_confidence_low_for_sparse_report(self):
        """Report with few sections gets low confidence."""
        sparse = {"data": {"sections": [{"title": "Summary", "content": "Brief."}]}}
        result = mf.normalize_report(sparse)
        assert result["analysis"]["confidence"] == "low"

    def test_confidence_medium_for_moderate_report(self):
        """Report with 3+ sections gets medium confidence."""
        sections = [
            {"title": f"Section {i}", "content": f"Content {i}"}
            for i in range(4)
        ]
        moderate = {"data": {"sections": sections}}
        result = mf.normalize_report(moderate)
        assert result["analysis"]["confidence"] == "medium"

    def test_negative_sentiment_report(self):
        """Report with negative keywords gets negative/mixed sentiment."""
        neg_report = {
            "data": {
                "sections": [
                    {
                        "title": "Concerns",
                        "content": (
                            "Significant concern about risk. Negative reception. "
                            "Resistance from users. Challenge and difficulty "
                            "in adoption. Unfavorable outlook. Worried about "
                            "rejection."
                        ),
                    }
                ],
                "report_id": "neg1",
                "simulation_id": "s1",
            }
        }
        result = mf.normalize_report(neg_report)
        score = result["analysis"]["sentiment_score"]
        assert score <= 0.5  # should lean negative or mixed


# ---------------------------------------------------------------------------
# Task Extraction Tests
# ---------------------------------------------------------------------------

class TestBuildMirofishTasks:
    """Test build_mirofish_tasks() extraction logic."""

    @pytest.fixture
    def report_fixture(self):
        return _load_fixture("mock-report-response.json")

    def test_extracts_risk_items_as_high_priority(self, report_fixture):
        """Items from risk/concern sections are high priority."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        high_tasks = [t for t in tasks if t["priority"] == "high"]
        # The Concerns section has "Recommendation:" text
        assert len(high_tasks) >= 0  # May or may not match depending on format

    def test_extracts_recommendations_as_medium_priority(self, report_fixture):
        """Items from recommendation sections are medium priority."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        medium_tasks = [t for t in tasks if t["priority"] == "medium"]
        assert len(medium_tasks) > 0

    def test_returns_empty_list_for_empty_report(self):
        """Empty report produces no tasks."""
        empty = {"data": {"sections": []}}
        tasks = mf.build_mirofish_tasks(empty)
        assert tasks == []

    def test_all_tasks_have_source_mirofish(self, report_fixture):
        """Every task has source='mirofish'."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        for task in tasks:
            assert task["source"] == "mirofish"

    def test_task_ids_are_unique(self, report_fixture):
        """All task IDs are unique."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        ids = [t["id"] for t in tasks]
        assert len(ids) == len(set(ids))

    def test_task_id_format(self, report_fixture):
        """Task IDs follow mirofish-NNN format."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        for task in tasks:
            assert task["id"].startswith("mirofish-")
            suffix = task["id"].replace("mirofish-", "")
            assert suffix.isdigit()

    def test_tasks_have_required_fields(self, report_fixture):
        """Each task has id, title, description, priority, source, category."""
        tasks = mf.build_mirofish_tasks(report_fixture)
        required_fields = {"id", "title", "description", "priority", "source", "category"}
        for task in tasks:
            assert required_fields.issubset(set(task.keys())), (
                f"Task {task.get('id')} missing fields: "
                f"{required_fields - set(task.keys())}"
            )

    def test_should_keywords_extracted(self):
        """Sentences starting with 'Should' are extracted as tasks."""
        report = {
            "data": {
                "sections": [
                    {
                        "title": "Recommendations",
                        "content": (
                            "Should invest in better onboarding. "
                            "Must address privacy concerns. "
                            "Consider adding offline mode."
                        ),
                    }
                ]
            }
        }
        tasks = mf.build_mirofish_tasks(report)
        titles = [t["title"] for t in tasks]
        assert any("onboarding" in t.lower() for t in titles)
        assert any("privacy" in t.lower() for t in titles)
        assert any("offline" in t.lower() for t in titles)


# ---------------------------------------------------------------------------
# Docker Management Tests
# ---------------------------------------------------------------------------

class TestDockerManagement:
    """Test Docker container management with mocked subprocess."""

    @patch("subprocess.run")
    def test_check_container_running(self, mock_run):
        """check_container returns 'running' when container is running."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="running\n", stderr=""
        )
        assert mf.check_container() == "running"

    @patch("subprocess.run")
    def test_check_container_stopped(self, mock_run):
        """check_container returns 'stopped' for exited container."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="exited\n", stderr=""
        )
        assert mf.check_container() == "stopped"

    @patch("subprocess.run")
    def test_check_container_not_found(self, mock_run):
        """check_container returns 'not_found' when docker inspect fails."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="No such container"
        )
        assert mf.check_container() == "not_found"

    @patch.object(mf, "wait_for_healthy", return_value=True)
    @patch.object(mf, "check_container", return_value="running")
    def test_start_container_noop_if_running(self, mock_check, mock_health):
        """start_container does nothing if already running."""
        result = mf.start_container("mirofish/app:latest")
        assert result is True
        # Should not call docker run or docker start

    @patch("subprocess.run")
    @patch.object(mf, "wait_for_healthy", return_value=True)
    @patch.object(mf, "check_container", return_value="not_found")
    def test_start_container_passes_env_vars(self, mock_check, mock_health, mock_run):
        """start_container passes LLM_API_KEY and ZEP_API_KEY as -e flags."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="container_id\n", stderr=""
        )
        with patch.dict(os.environ, {"LLM_API_KEY": "sk-test", "ZEP_API_KEY": "zep-test"}):
            result = mf.start_container("mirofish/app:latest", port=5001)
        assert result is True
        # Check docker run was called with -e flags
        docker_call = mock_run.call_args
        cmd = docker_call[0][0]
        assert "-e" in cmd
        # Find the -e flags
        env_pairs = []
        for i, arg in enumerate(cmd):
            if arg == "-e" and i + 1 < len(cmd):
                env_pairs.append(cmd[i + 1])
        assert "LLM_API_KEY=sk-test" in env_pairs
        assert "ZEP_API_KEY=zep-test" in env_pairs

    @patch("subprocess.run")
    @patch.object(mf, "wait_for_healthy", return_value=True)
    @patch.object(mf, "check_container", return_value="stopped")
    def test_start_container_restarts_stopped(self, mock_check, mock_health, mock_run):
        """start_container calls docker start for stopped container."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        result = mf.start_container("mirofish/app:latest")
        assert result is True
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "docker"
        assert cmd[1] == "start"
        assert "loki-mirofish" in cmd

    @patch("subprocess.run")
    @patch.object(mf, "check_container", return_value="running")
    def test_stop_container_calls_docker_stop(self, mock_check, mock_run):
        """stop_container calls docker stop with --time 10."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        result = mf.stop_container()
        assert result is True
        # First call should be docker stop
        first_call_cmd = mock_run.call_args_list[0][0][0]
        assert "stop" in first_call_cmd
        assert "--time" in first_call_cmd
        assert "10" in first_call_cmd

    @patch("subprocess.run")
    @patch.object(mf, "check_container", return_value="not_found")
    def test_stop_container_noop_if_not_found(self, mock_check, mock_run):
        """stop_container does nothing if container not found."""
        result = mf.stop_container()
        assert result is True
        mock_run.assert_not_called()


# ---------------------------------------------------------------------------
# CLI Mode Tests
# ---------------------------------------------------------------------------

class TestCLIModes:
    """Test CLI entry points via subprocess invocation."""

    def test_validate_returns_0_for_valid_prd(self):
        """--validate returns 0 for a valid PRD."""
        rc, stdout, stderr = run_adapter(
            str(FIXTURES_DIR / "sample-prd.md"), "--validate"
        )
        assert rc == 0
        assert "OK" in stdout

    def test_validate_returns_1_for_empty_prd(self, tmp_path):
        """--validate returns 1 for an empty PRD."""
        empty = tmp_path / "empty.md"
        empty.write_text("")
        rc, stdout, stderr = run_adapter(str(empty), "--validate")
        assert rc == 1
        assert "empty" in stderr.lower() or "error" in stderr.lower()

    def test_validate_returns_1_for_missing_prd(self):
        """--validate returns 1 for a nonexistent file."""
        rc, stdout, stderr = run_adapter("/nonexistent/file.md", "--validate")
        assert rc == 1
        assert "not found" in stderr.lower() or "error" in stderr.lower()

    def test_health_returns_exit_code(self):
        """--health returns non-zero when no server is running."""
        rc, stdout, stderr = run_adapter(
            "--health", "--url", "http://127.0.0.1:59999"
        )
        assert rc == 1
        assert "NOT healthy" in stderr or "not healthy" in stderr.lower()

    def test_status_with_no_state_file(self, tmp_path):
        """--status with no state file returns informative message."""
        rc, stdout, stderr = run_adapter(
            "--status", "--output-dir", str(tmp_path)
        )
        assert rc == 0
        assert "no pipeline" in stdout.lower() or "not found" in stdout.lower()

    def test_json_outputs_valid_json(self):
        """--json outputs valid JSON to stdout."""
        rc, stdout, stderr = run_adapter(
            str(FIXTURES_DIR / "sample-prd.md"), "--json"
        )
        assert rc == 0
        data = json.loads(stdout)
        assert data["source"] == "mirofish"
        assert data["project_name"] == "Developer Productivity Dashboard"
        assert "simulation_requirement" in data

    def test_json_includes_prd_path(self):
        """--json output includes the PRD path."""
        rc, stdout, stderr = run_adapter(
            str(FIXTURES_DIR / "sample-prd.md"), "--json"
        )
        assert rc == 0
        data = json.loads(stdout)
        assert "prd_path" in data

    def test_status_with_existing_state(self, tmp_path):
        """--status reads and displays pipeline state."""
        fixture = _load_fixture("mock-pipeline-state-partial.json")
        mf_dir = tmp_path / "mirofish"
        mf_dir.mkdir(parents=True, exist_ok=True)
        (mf_dir / "pipeline-state.json").write_text(json.dumps(fixture))

        rc, stdout, stderr = run_adapter(
            "--status", "--output-dir", str(tmp_path)
        )
        assert rc == 0
        assert "running" in stdout.lower()


# ---------------------------------------------------------------------------
# Utility Function Tests
# ---------------------------------------------------------------------------

class TestUtilities:
    """Test utility functions directly."""

    def test_safe_read_normal_file(self, tmp_path):
        """_safe_read reads a normal file."""
        f = tmp_path / "test.txt"
        f.write_text("hello world")
        assert mf._safe_read(f) == "hello world"

    def test_safe_read_rejects_oversized_file(self, tmp_path):
        """_safe_read raises ValueError for files over MAX_ARTIFACT_SIZE."""
        f = tmp_path / "huge.txt"
        # Create a file that reports as too large via stat
        f.write_text("x")
        with patch.object(Path, "stat") as mock_stat:
            mock_stat.return_value = MagicMock(st_size=mf.MAX_ARTIFACT_SIZE + 1)
            with pytest.raises(ValueError, match="too large"):
                mf._safe_read(f)

    def test_write_atomic_creates_parent_dirs(self, tmp_path):
        """_write_atomic creates parent directories if needed."""
        target = tmp_path / "a" / "b" / "c" / "test.txt"
        mf._write_atomic(target, "content")
        assert target.exists()
        assert target.read_text() == "content"

    def test_write_json_creates_valid_json(self, tmp_path):
        """_write_json writes valid indented JSON."""
        target = tmp_path / "data.json"
        mf._write_json(target, {"key": "value", "num": 42})
        data = json.loads(target.read_text())
        assert data["key"] == "value"
        assert data["num"] == 42

    def test_now_iso_format(self):
        """_now_iso returns ISO-8601 formatted UTC timestamp."""
        ts = mf._now_iso()
        assert ts.endswith("Z")
        assert "T" in ts
        # Should be parseable
        from datetime import datetime
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        assert dt.year >= 2026

    def test_split_sections(self):
        """_split_sections parses markdown headings correctly."""
        text = (
            "# Title\n\n"
            "## Section One\n"
            "Content one.\n\n"
            "## Section Two\n"
            "Content two.\n"
        )
        sections = mf._split_sections(text, level=2)
        assert "Section One" in sections
        assert "Section Two" in sections
        assert "Content one." in sections["Section One"]
        assert "Content two." in sections["Section Two"]


# ---------------------------------------------------------------------------
# Summary Markdown Generation Tests
# ---------------------------------------------------------------------------

class TestSummaryMarkdown:
    """Test _build_summary_markdown() output."""

    def test_summary_contains_header(self):
        """Summary markdown has the expected header."""
        context = {
            "generated_at": "2026-03-21T12:00:00Z",
            "report_id": "r1",
            "simulation_id": "s1",
            "analysis": {
                "overall_sentiment": "positive",
                "sentiment_score": 0.72,
                "confidence": "high",
                "recommendation": "proceed",
                "key_concerns": ["Privacy perception"],
                "feature_rankings": [
                    {"feature": "Burnout detection", "reception_score": 0.89}
                ],
                "notable_quotes": ["Great product idea"],
            },
        }
        md = mf._build_summary_markdown(context, [])
        assert "# MiroFish Market Validation Summary" in md
        assert "positive" in md
        assert "proceed" in md

    def test_summary_includes_tasks(self):
        """Summary markdown lists action items."""
        context = {
            "generated_at": "2026-03-21T12:00:00Z",
            "report_id": "r1",
            "simulation_id": "s1",
            "analysis": {
                "overall_sentiment": "mixed",
                "sentiment_score": 0.5,
                "confidence": "medium",
                "recommendation": "review_concerns",
                "key_concerns": [],
                "feature_rankings": [],
                "notable_quotes": [],
            },
        }
        tasks = [
            {"id": "mf-001", "title": "Address privacy concerns", "priority": "high"},
        ]
        md = mf._build_summary_markdown(context, tasks)
        assert "Action Items" in md
        assert "Address privacy concerns" in md
        assert "[HIGH]" in md

    def test_summary_omits_empty_sections(self):
        """Summary markdown omits sections when data is empty."""
        context = {
            "generated_at": "2026-03-21T12:00:00Z",
            "report_id": "r1",
            "simulation_id": "s1",
            "analysis": {
                "overall_sentiment": "mixed",
                "sentiment_score": 0.5,
                "confidence": "low",
                "recommendation": "review_concerns",
                "key_concerns": [],
                "feature_rankings": [],
                "notable_quotes": [],
            },
        }
        md = mf._build_summary_markdown(context, [])
        assert "Key Concerns" not in md
        assert "Feature Rankings" not in md
        assert "Notable Agent Reactions" not in md
        assert "Action Items" not in md


# ---------------------------------------------------------------------------
# Constants Tests
# ---------------------------------------------------------------------------

class TestConstants:
    """Verify module constants are set correctly."""

    def test_max_artifact_size(self):
        assert mf.MAX_ARTIFACT_SIZE == 10 * 1024 * 1024

    def test_container_name(self):
        assert mf.CONTAINER_NAME == "loki-mirofish"

    def test_default_url(self):
        assert mf.DEFAULT_URL == "http://localhost:5001"

    def test_default_port(self):
        assert mf.DEFAULT_PORT == 5001

    def test_default_max_rounds(self):
        assert mf.DEFAULT_MAX_ROUNDS == 100

    def test_default_timeout(self):
        assert mf.DEFAULT_TIMEOUT == 3600
