"""
Loki Mode Memory System - Unified Access Layer

Provides a single interface for all components to access the memory system.
Abstracts the complexity of multiple memory types (episodic, semantic, procedural)
and provides high-level operations for context retrieval and interaction recording.

Key features:
- Single entry point for all memory operations
- Task-type-aware context retrieval
- Automatic token budget management
- Suggestion generation based on context

Usage:
    from memory.unified_access import UnifiedMemoryAccess, MemoryContext

    access = UnifiedMemoryAccess()
    context = access.get_relevant_context("implementation", "Build REST API")
    access.record_interaction("cli", {"action": "read_file", "target": "api.py"})
    suggestions = access.get_suggestions("implementing authentication")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from .schemas import EpisodeTrace, SemanticPattern, ProceduralSkill, ActionEntry
from .storage import MemoryStorage
from .engine import MemoryEngine
from .retrieval import MemoryRetrieval, TASK_STRATEGIES
from .token_economics import TokenEconomics, estimate_tokens, estimate_memory_tokens

# Configure logging
logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Data Classes
# -----------------------------------------------------------------------------


@dataclass
class MemoryContext:
    """
    Container for relevant memory context retrieved for a task.

    Attributes:
        relevant_episodes: List of relevant episodic memories
        applicable_patterns: List of applicable semantic patterns
        suggested_skills: List of skills that might be useful
        token_budget: Remaining token budget after retrieval
        task_type: Detected or specified task type
        retrieval_stats: Statistics about the retrieval process
    """

    relevant_episodes: List[Dict[str, Any]] = field(default_factory=list)
    applicable_patterns: List[Dict[str, Any]] = field(default_factory=list)
    suggested_skills: List[Dict[str, Any]] = field(default_factory=list)
    token_budget: int = 0
    task_type: str = "implementation"
    retrieval_stats: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "relevant_episodes": self.relevant_episodes,
            "applicable_patterns": self.applicable_patterns,
            "suggested_skills": self.suggested_skills,
            "token_budget": self.token_budget,
            "task_type": self.task_type,
            "retrieval_stats": self.retrieval_stats,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> MemoryContext:
        """Create from dictionary."""
        return cls(
            relevant_episodes=data.get("relevant_episodes", []),
            applicable_patterns=data.get("applicable_patterns", []),
            suggested_skills=data.get("suggested_skills", []),
            token_budget=data.get("token_budget", 0),
            task_type=data.get("task_type", "implementation"),
            retrieval_stats=data.get("retrieval_stats", {}),
        )

    def is_empty(self) -> bool:
        """Check if the context contains any memories."""
        return (
            len(self.relevant_episodes) == 0
            and len(self.applicable_patterns) == 0
            and len(self.suggested_skills) == 0
        )

    def total_items(self) -> int:
        """Get total number of memory items."""
        return (
            len(self.relevant_episodes)
            + len(self.applicable_patterns)
            + len(self.suggested_skills)
        )

    def estimated_tokens(self) -> int:
        """Estimate tokens used by this context."""
        total = 0
        for ep in self.relevant_episodes:
            total += estimate_memory_tokens(ep)
        for pattern in self.applicable_patterns:
            total += estimate_memory_tokens(pattern)
        for skill in self.suggested_skills:
            total += estimate_memory_tokens(skill)
        return total


# -----------------------------------------------------------------------------
# Unified Memory Access Class
# -----------------------------------------------------------------------------


class UnifiedMemoryAccess:
    """
    Unified interface for all memory system components.

    Provides a single entry point for:
    - Retrieving relevant context based on task type and query
    - Recording interactions and outcomes
    - Getting suggestions based on current context

    Attributes:
        base_path: Base path for memory storage
        engine: MemoryEngine instance
        retrieval: MemoryRetrieval instance
        token_economics: TokenEconomics instance for tracking
        default_token_budget: Default token budget for retrievals
    """

    DEFAULT_TOKEN_BUDGET = 4000

    def __init__(
        self,
        base_path: str = ".loki/memory",
        engine: Optional[MemoryEngine] = None,
        session_id: Optional[str] = None,
    ):
        """
        Initialize the unified memory access layer.

        Args:
            base_path: Base path for memory storage
            engine: Optional pre-configured MemoryEngine instance
            session_id: Optional session ID for token tracking
        """
        self.base_path = base_path
        self._storage = MemoryStorage(base_path)

        # Initialize or use provided engine
        if engine:
            self.engine = engine
        else:
            self.engine = MemoryEngine(storage=self._storage, base_path=base_path)

        # Initialize retrieval system
        self.retrieval = MemoryRetrieval(
            storage=self._storage,
            base_path=base_path,
        )

        # Initialize token economics
        self._session_id = session_id or datetime.now(timezone.utc).strftime(
            "%Y%m%d%H%M%S"
        )
        self.token_economics = TokenEconomics(
            session_id=self._session_id,
            base_path=base_path,
        )

        self.default_token_budget = self.DEFAULT_TOKEN_BUDGET
        self._initialized = False

    def initialize(self) -> None:
        """
        Initialize the memory system.

        Ensures all required directories and files exist.
        Safe to call multiple times.
        """
        if self._initialized:
            return

        try:
            self.engine.initialize()
            self._initialized = True
            logger.debug("UnifiedMemoryAccess initialized successfully")
        except Exception as e:
            logger.error("Failed to initialize memory system: %s", e)
            raise

    def _ensure_initialized(self) -> None:
        """Ensure the memory system is initialized."""
        if not self._initialized:
            self.initialize()

    # -------------------------------------------------------------------------
    # Context Retrieval
    # -------------------------------------------------------------------------

    def get_relevant_context(
        self,
        task_type: str,
        query: str,
        token_budget: Optional[int] = None,
        top_k: int = 5,
    ) -> MemoryContext:
        """
        Get relevant context for a task.

        Retrieves memories from all collections (episodic, semantic, procedural)
        using task-type-aware weighting.

        Args:
            task_type: Type of task (exploration, implementation, debugging,
                       review, refactoring)
            query: Search query or task description
            token_budget: Maximum tokens to use for context (default: 4000)
            top_k: Maximum number of items per category

        Returns:
            MemoryContext with relevant memories and remaining token budget
        """
        self._ensure_initialized()

        budget = token_budget or self.default_token_budget

        # Build context for retrieval
        context = {
            "goal": query,
            "task_type": task_type,
            "phase": self._task_type_to_phase(task_type),
        }

        # Record discovery tokens
        discovery_tokens = estimate_tokens(query)
        self.token_economics.record_discovery(discovery_tokens)

        try:
            # Retrieve from each memory type
            episodes = self._retrieve_episodes(context, top_k)
            patterns = self._retrieve_patterns(context, top_k)
            skills = self._retrieve_skills(context, top_k)

            # Calculate tokens used
            tokens_used = 0
            final_episodes: List[Dict[str, Any]] = []
            final_patterns: List[Dict[str, Any]] = []
            final_skills: List[Dict[str, Any]] = []

            # Add items while respecting token budget
            for ep in episodes:
                ep_tokens = estimate_memory_tokens(ep)
                if tokens_used + ep_tokens <= budget:
                    final_episodes.append(ep)
                    tokens_used += ep_tokens
                    self.token_economics.record_read(ep_tokens, layer=3)

            for pattern in patterns:
                pattern_tokens = estimate_memory_tokens(pattern)
                if tokens_used + pattern_tokens <= budget:
                    final_patterns.append(pattern)
                    tokens_used += pattern_tokens
                    self.token_economics.record_read(pattern_tokens, layer=2)

            for skill in skills:
                skill_tokens = estimate_memory_tokens(skill)
                if tokens_used + skill_tokens <= budget:
                    final_skills.append(skill)
                    tokens_used += skill_tokens
                    self.token_economics.record_read(skill_tokens, layer=2)

            return MemoryContext(
                relevant_episodes=final_episodes,
                applicable_patterns=final_patterns,
                suggested_skills=final_skills,
                token_budget=budget - tokens_used,
                task_type=task_type,
                retrieval_stats={
                    "total_episodes_found": len(episodes),
                    "total_patterns_found": len(patterns),
                    "total_skills_found": len(skills),
                    "tokens_used": tokens_used,
                    "budget_remaining": budget - tokens_used,
                },
            )

        except Exception as e:
            logger.error("Failed to retrieve context: %s", e)
            return MemoryContext(
                token_budget=budget,
                task_type=task_type,
                retrieval_stats={"error": str(e)},
            )

    def _retrieve_episodes(
        self,
        context: Dict[str, Any],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """Retrieve relevant episodic memories."""
        try:
            query = context.get("goal", "")
            results = self.retrieval.retrieve_from_episodic(query, top_k)
            return results
        except Exception as e:
            logger.warning("Failed to retrieve episodes: %s", e)
            return []

    def _retrieve_patterns(
        self,
        context: Dict[str, Any],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """Retrieve relevant semantic patterns."""
        try:
            query = context.get("goal", "")
            results = self.retrieval.retrieve_from_semantic(query, top_k)
            return results
        except Exception as e:
            logger.warning("Failed to retrieve patterns: %s", e)
            return []

    def _retrieve_skills(
        self,
        context: Dict[str, Any],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """Retrieve relevant procedural skills."""
        try:
            query = context.get("goal", "")
            results = self.retrieval.retrieve_from_skills(query, top_k)
            return results
        except Exception as e:
            logger.warning("Failed to retrieve skills: %s", e)
            return []

    def _task_type_to_phase(self, task_type: str) -> str:
        """Map task type to RARV phase."""
        mapping = {
            "exploration": "REASON",
            "implementation": "ACT",
            "debugging": "ACT",
            "review": "REFLECT",
            "refactoring": "ACT",
        }
        return mapping.get(task_type, "ACT")

    # -------------------------------------------------------------------------
    # Interaction Recording
    # -------------------------------------------------------------------------

    def record_interaction(
        self,
        source: str,
        action: Dict[str, Any],
        outcome: Optional[str] = None,
    ) -> None:
        """
        Record an interaction with the system.

        Creates timeline entries and optionally stores episode traces
        for significant interactions.

        Args:
            source: Source of the interaction (cli, api, mcp, agent)
            action: Action details dictionary with:
                - action: Action type (read_file, write_file, etc.)
                - target: Target of the action (file path, etc.)
                - result: Result of the action (optional)
                - goal: Goal of the action (optional)
            outcome: Optional outcome (success, failure, partial)
        """
        self._ensure_initialized()

        try:
            # Build timeline entry
            timeline_action = {
                "type": action.get("action", "unknown"),
                "source": source,
                "target": action.get("target", ""),
                "result": action.get("result", ""),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            if outcome:
                timeline_action["outcome"] = outcome

            # Update timeline
            self._storage.update_timeline(timeline_action)

            # Record tokens for this interaction
            action_tokens = estimate_memory_tokens(action)
            self.token_economics.record_discovery(action_tokens)

            logger.debug("Recorded interaction from %s: %s", source, action.get("action"))

        except Exception as e:
            logger.error("Failed to record interaction: %s", e)

    def record_episode(
        self,
        task_id: str,
        agent: str,
        goal: str,
        actions: List[Dict[str, Any]],
        outcome: str = "success",
        phase: str = "ACT",
        duration_seconds: int = 0,
    ) -> Optional[str]:
        """
        Record a complete episode trace.

        Args:
            task_id: ID of the task being executed
            agent: Agent type that executed the task
            goal: What the task was trying to accomplish
            actions: List of actions taken during the episode
            outcome: Result (success, failure, partial)
            phase: RARV phase
            duration_seconds: How long the episode took

        Returns:
            Episode ID if successful, None otherwise
        """
        self._ensure_initialized()

        try:
            # Convert action dicts to ActionEntry objects
            action_entries = []
            for i, action in enumerate(actions):
                entry = ActionEntry(
                    tool=action.get("action", action.get("tool", "unknown")),
                    input=action.get("target", action.get("input", "")),
                    output=action.get("result", action.get("output", "")),
                    timestamp=action.get("timestamp", i * 10),
                )
                action_entries.append(entry)

            # Use factory method to create episode with proper ID generation
            episode = EpisodeTrace.create(
                task_id=task_id,
                agent=agent,
                goal=goal,
                phase=phase,
            )
            # Update additional fields
            episode.duration_seconds = duration_seconds
            episode.action_log = action_entries
            episode.outcome = outcome

            # Store episode
            episode_id = self.engine.store_episode(episode)
            logger.debug("Recorded episode: %s", episode_id)

            return episode_id

        except Exception as e:
            logger.error("Failed to record episode: %s", e)
            return None

    # -------------------------------------------------------------------------
    # Suggestions
    # -------------------------------------------------------------------------

    def get_suggestions(
        self,
        context: str,
        max_suggestions: int = 5,
    ) -> List[str]:
        """
        Get suggestions based on current context.

        Analyzes the context and retrieves relevant patterns and skills
        to generate actionable suggestions.

        Args:
            context: Current context or task description
            max_suggestions: Maximum number of suggestions to return

        Returns:
            List of suggestion strings
        """
        self._ensure_initialized()

        suggestions: List[str] = []

        try:
            # Detect task type from context
            task_type = self.retrieval.detect_task_type({"goal": context})

            # Get relevant patterns
            patterns = self._retrieve_patterns({"goal": context}, top_k=3)
            for pattern in patterns[:2]:
                if pattern.get("correct_approach"):
                    suggestions.append(
                        f"Pattern: {pattern.get('correct_approach', '')[:100]}"
                    )

            # Get relevant skills
            skills = self._retrieve_skills({"goal": context}, top_k=3)
            for skill in skills[:2]:
                if skill.get("name") and skill.get("steps"):
                    first_step = skill["steps"][0] if skill["steps"] else ""
                    suggestions.append(
                        f"Skill '{skill.get('name', '')}': {first_step[:80]}"
                    )

            # Add task-type-specific suggestions
            task_suggestions = self._get_task_type_suggestions(task_type)
            suggestions.extend(task_suggestions[:2])

        except Exception as e:
            logger.warning("Failed to generate suggestions: %s", e)

        return suggestions[:max_suggestions]

    def _get_task_type_suggestions(self, task_type: str) -> List[str]:
        """Get suggestions specific to a task type."""
        suggestions_by_type = {
            "exploration": [
                "Start by reading the main entry point files",
                "Look for configuration files to understand the project structure",
            ],
            "implementation": [
                "Check for existing patterns in similar files",
                "Write tests alongside implementation",
            ],
            "debugging": [
                "Check logs and error messages first",
                "Add logging to isolate the issue",
            ],
            "review": [
                "Check for edge cases and error handling",
                "Verify test coverage for the changes",
            ],
            "refactoring": [
                "Ensure tests pass before and after changes",
                "Make small, incremental changes",
            ],
        }
        return suggestions_by_type.get(task_type, [])

    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------

    def get_stats(self) -> Dict[str, Any]:
        """
        Get memory system statistics.

        Returns:
            Dictionary with memory counts and token economics
        """
        self._ensure_initialized()

        stats = self.engine.get_stats()
        economics = self.token_economics.get_summary()

        return {
            **stats,
            "token_economics": economics,
            "session_id": self._session_id,
        }

    def save_session(self) -> None:
        """Save current session data including token economics."""
        try:
            self.token_economics.save()
            logger.debug("Session saved successfully")
        except Exception as e:
            logger.error("Failed to save session: %s", e)

    def get_index(self) -> Dict[str, Any]:
        """Get the memory index."""
        self._ensure_initialized()
        return self.engine.get_index()

    def get_timeline(self) -> Dict[str, Any]:
        """Get the memory timeline."""
        self._ensure_initialized()
        return self.engine.get_timeline()
