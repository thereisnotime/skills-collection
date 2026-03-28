"""Agent Performance Scoring - Per-agent-type tracking across runs.

Tracks task completion quality and duration for each agent type,
enabling data-driven agent selection in future compositions.

Storage: .loki/memory/agent-performance.json
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_STORAGE_PATH = ".loki/memory/agent-performance.json"

# Number of recent scores to keep per agent type
MAX_RECENT_SCORES = 20


class AgentPerformanceTracker:
    """Tracks per-agent-type performance across runs.

    Stores average quality scores, task durations, and recent score
    history. Used by SwarmComposer to prefer high-performing agent
    types when composing teams.
    """

    def __init__(self, storage_path: Optional[str] = None):
        """Initialize the tracker.

        Args:
            storage_path: Path to the JSON storage file. Defaults to
                .loki/memory/agent-performance.json
        """
        self.storage_path = Path(storage_path or DEFAULT_STORAGE_PATH)
        self._data: Dict[str, Dict[str, Any]] = {}
        self.load()

    def record_task_completion(
        self,
        agent_type: str,
        quality_score: float,
        duration_seconds: float,
    ) -> None:
        """Record a task completion for an agent type.

        Updates running averages and recent score history.

        Args:
            agent_type: The agent type identifier (e.g., "eng-frontend").
            quality_score: Quality score between 0.0 and 1.0.
            duration_seconds: Task duration in seconds.
        """
        quality_score = max(0.0, min(1.0, quality_score))
        duration_seconds = max(0.0, duration_seconds)

        if agent_type not in self._data:
            self._data[agent_type] = {
                "total_tasks": 0,
                "avg_quality": 0.0,
                "avg_duration": 0.0,
                "recent_scores": [],
                "last_updated": "",
            }

        entry = self._data[agent_type]
        n = entry["total_tasks"]

        # Update running averages
        entry["avg_quality"] = (entry["avg_quality"] * n + quality_score) / (n + 1)
        entry["avg_duration"] = (entry["avg_duration"] * n + duration_seconds) / (n + 1)
        entry["total_tasks"] = n + 1

        # Round for cleaner storage
        entry["avg_quality"] = round(entry["avg_quality"], 4)
        entry["avg_duration"] = round(entry["avg_duration"], 2)

        # Maintain recent scores window
        entry["recent_scores"].append(round(quality_score, 4))
        if len(entry["recent_scores"]) > MAX_RECENT_SCORES:
            entry["recent_scores"] = entry["recent_scores"][-MAX_RECENT_SCORES:]

        entry["last_updated"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def get_performance_scores(self) -> Dict[str, Dict[str, Any]]:
        """Get performance scores for all tracked agent types.

        Returns:
            Dict mapping agent_type to performance data including
            avg_quality, avg_duration, task_count, and trend.
        """
        result = {}
        for agent_type, entry in self._data.items():
            trend = self._compute_trend(entry.get("recent_scores", []))
            result[agent_type] = {
                "avg_quality": entry.get("avg_quality", 0.0),
                "avg_duration": entry.get("avg_duration", 0.0),
                "task_count": entry.get("total_tasks", 0),
                "trend": trend,
            }
        return result

    def get_recommended_agents(
        self,
        candidate_types: List[str],
        top_n: int = 5,
    ) -> List[str]:
        """Return top-N agents from candidates ranked by performance.

        Agents without performance data are ranked neutrally (score 0.5).

        Args:
            candidate_types: List of agent type identifiers to consider.
            top_n: Maximum number of agents to return.

        Returns:
            List of agent type identifiers, best performers first.
        """
        scored: List[tuple] = []
        for agent_type in candidate_types:
            entry = self._data.get(agent_type)
            if entry and entry.get("total_tasks", 0) > 0:
                # Combine quality and trend for ranking
                quality = entry.get("avg_quality", 0.5)
                trend = self._compute_trend(entry.get("recent_scores", []))
                # Trend bonus: positive trend adds up to 0.1, negative subtracts
                score = quality + (trend * 0.1)
            else:
                # No data: neutral score
                score = 0.5
            scored.append((agent_type, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [agent_type for agent_type, _ in scored[:top_n]]

    def _compute_trend(self, recent_scores: List[float]) -> float:
        """Compute a trend indicator from recent scores.

        Positive values indicate improving performance, negative
        values indicate declining performance.

        Args:
            recent_scores: List of recent quality scores.

        Returns:
            Trend value roughly in [-1.0, 1.0].
        """
        if len(recent_scores) < 2:
            return 0.0

        # Compare recent half to older half
        mid = len(recent_scores) // 2
        older = recent_scores[:mid]
        newer = recent_scores[mid:]

        if not older or not newer:
            return 0.0

        older_avg = sum(older) / len(older)
        newer_avg = sum(newer) / len(newer)

        # Difference clamped to [-1, 1]
        diff = newer_avg - older_avg
        return max(-1.0, min(1.0, round(diff, 4)))

    def save(self) -> None:
        """Persist performance data to disk (atomic write)."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.storage_path.parent), suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f, indent=2)
            os.replace(tmp_path, str(self.storage_path))
        except BaseException:
            # Clean up temp file on failure
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def load(self) -> None:
        """Load performance data from disk."""
        if self.storage_path.exists():
            try:
                with open(self.storage_path, "r") as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._data = {}
        else:
            self._data = {}

    def clear(self) -> None:
        """Clear all performance data."""
        self._data = {}

    def get_agent_data(self, agent_type: str) -> Optional[Dict[str, Any]]:
        """Get raw performance data for a specific agent type.

        Args:
            agent_type: The agent type identifier.

        Returns:
            Performance data dict or None if not tracked.
        """
        return self._data.get(agent_type)
