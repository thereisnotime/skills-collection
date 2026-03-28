"""
Tests for Memory Importance Scoring System

Tests the importance scoring, decay, and retrieval boost functionality
implemented in storage.py, schemas.py, and retrieval.py.
"""

import os
import sys
import tempfile
import shutil
import unittest
from datetime import datetime, timezone, timedelta

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from memory.schemas import EpisodeTrace, SemanticPattern, ProceduralSkill
from memory.storage import MemoryStorage


class TestSchemasImportanceFields(unittest.TestCase):
    """Test that importance fields are properly added to schemas."""

    def test_episode_trace_has_importance_fields(self):
        """EpisodeTrace should have importance, last_accessed, access_count."""
        episode = EpisodeTrace(
            id="ep-test-001",
            task_id="task-001",
            timestamp=datetime.now(timezone.utc),
            duration_seconds=60,
            agent="test-agent",
            phase="ACT",
            goal="Test episode",
        )

        self.assertEqual(episode.importance, 0.5)
        self.assertIsNone(episode.last_accessed)
        self.assertEqual(episode.access_count, 0)

    def test_episode_trace_validates_importance(self):
        """EpisodeTrace should validate importance is between 0.0 and 1.0."""
        episode = EpisodeTrace(
            id="ep-test-001",
            task_id="task-001",
            timestamp=datetime.now(timezone.utc),
            duration_seconds=60,
            agent="test-agent",
            phase="ACT",
            goal="Test episode",
            importance=1.5,  # Invalid
        )
        errors = episode.validate()
        self.assertTrue(any("importance" in e for e in errors))

    def test_episode_trace_serialization(self):
        """EpisodeTrace should serialize and deserialize importance fields."""
        now = datetime.now(timezone.utc)
        episode = EpisodeTrace(
            id="ep-test-001",
            task_id="task-001",
            timestamp=now,
            duration_seconds=60,
            agent="test-agent",
            phase="ACT",
            goal="Test episode",
            importance=0.8,
            last_accessed=now,
            access_count=5,
        )

        data = episode.to_dict()
        self.assertEqual(data["importance"], 0.8)
        self.assertEqual(data["access_count"], 5)
        self.assertIn("last_accessed", data)

        # Test deserialization
        restored = EpisodeTrace.from_dict(data)
        self.assertEqual(restored.importance, 0.8)
        self.assertEqual(restored.access_count, 5)

    def test_semantic_pattern_has_importance_fields(self):
        """SemanticPattern should have importance, last_accessed, access_count."""
        pattern = SemanticPattern(
            id="sem-test-001",
            pattern="Test pattern",
            category="testing",
        )

        self.assertEqual(pattern.importance, 0.5)
        self.assertIsNone(pattern.last_accessed)
        self.assertEqual(pattern.access_count, 0)

    def test_procedural_skill_has_importance_fields(self):
        """ProceduralSkill should have importance, last_accessed, access_count."""
        skill = ProceduralSkill(
            id="skill-test-001",
            name="Test Skill",
            description="A test skill",
            steps=["Step 1", "Step 2"],
        )

        self.assertEqual(skill.importance, 0.5)
        self.assertIsNone(skill.last_accessed)
        self.assertEqual(skill.access_count, 0)


class TestCalculateImportance(unittest.TestCase):
    """Test calculate_importance function in storage."""

    def setUp(self):
        """Create temporary storage directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage = MemoryStorage(base_path=self.temp_dir)

    def tearDown(self):
        """Clean up temporary directory."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_default_importance(self):
        """Memory with no special factors should return base importance."""
        memory = {"importance": 0.5}
        result = self.storage.calculate_importance(memory)
        self.assertAlmostEqual(result, 0.5, places=2)

    def test_success_outcome_boosts_importance(self):
        """Successful outcome should boost importance."""
        memory = {"importance": 0.5, "outcome": "success"}
        result = self.storage.calculate_importance(memory)
        self.assertGreater(result, 0.5)

    def test_failure_outcome_reduces_importance(self):
        """Failed outcome should reduce importance."""
        memory = {"importance": 0.5, "outcome": "failure"}
        result = self.storage.calculate_importance(memory)
        self.assertLess(result, 0.5)

    def test_error_resolution_boosts_importance(self):
        """Resolving errors (success with errors) should boost importance."""
        memory = {
            "importance": 0.5,
            "outcome": "success",
            "errors_encountered": [{"type": "error1"}, {"type": "error2"}],
        }
        result = self.storage.calculate_importance(memory)
        # Should be higher than just success
        success_only = self.storage.calculate_importance(
            {"importance": 0.5, "outcome": "success"}
        )
        self.assertGreater(result, success_only)

    def test_access_count_boosts_importance(self):
        """Higher access count should boost importance."""
        memory_low = {"importance": 0.5, "access_count": 1}
        memory_high = {"importance": 0.5, "access_count": 100}

        result_low = self.storage.calculate_importance(memory_low)
        result_high = self.storage.calculate_importance(memory_high)

        self.assertGreater(result_high, result_low)

    def test_confidence_factor(self):
        """Confidence should be factored into importance."""
        memory_high_conf = {"importance": 0.5, "confidence": 0.9}
        memory_low_conf = {"importance": 0.5, "confidence": 0.3}

        result_high = self.storage.calculate_importance(memory_high_conf)
        result_low = self.storage.calculate_importance(memory_low_conf)

        self.assertGreater(result_high, result_low)

    def test_importance_capped_at_1(self):
        """Importance should never exceed 1.0."""
        memory = {
            "importance": 0.95,
            "outcome": "success",
            "access_count": 1000,
            "confidence": 1.0,
            "errors_encountered": [{}, {}, {}],
        }
        result = self.storage.calculate_importance(memory)
        self.assertLessEqual(result, 1.0)

    def test_importance_minimum_at_0(self):
        """Importance should never go below 0.0."""
        memory = {"importance": 0.05, "outcome": "failure"}
        result = self.storage.calculate_importance(memory)
        self.assertGreaterEqual(result, 0.0)


class TestApplyDecay(unittest.TestCase):
    """Test apply_decay function in storage."""

    def setUp(self):
        """Create temporary storage directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage = MemoryStorage(base_path=self.temp_dir)

    def tearDown(self):
        """Clean up temporary directory."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_recent_memory_no_significant_decay(self):
        """Very recent memory should have minimal decay."""
        now = datetime.now(timezone.utc)
        memory = {
            "importance": 1.0,
            "last_accessed": now.isoformat() + "Z",
        }
        result = self.storage.apply_decay([memory], decay_rate=0.1)
        self.assertAlmostEqual(result[0]["importance"], 1.0, places=1)

    def test_old_memory_has_significant_decay(self):
        """Memory from 60 days ago should have significant decay."""
        old_time = datetime.now(timezone.utc) - timedelta(days=60)
        memory = {
            "importance": 1.0,
            "last_accessed": old_time.isoformat() + "Z",
        }
        # Using higher decay rate to test decay more visibly
        result = self.storage.apply_decay([memory], decay_rate=0.7, half_life_days=30)
        # After 60 days with decay_rate=0.7, should show significant decay
        self.assertLess(result[0]["importance"], 0.5)

    def test_minimum_importance_after_decay(self):
        """Memory should never decay below 0.01."""
        very_old_time = datetime.now(timezone.utc) - timedelta(days=365)
        memory = {
            "importance": 1.0,
            "timestamp": very_old_time.isoformat() + "Z",
        }
        result = self.storage.apply_decay([memory], decay_rate=0.5, half_life_days=7)
        self.assertGreaterEqual(result[0]["importance"], 0.01)

    def test_decay_uses_multiple_time_fields(self):
        """Decay should work with timestamp, last_accessed, or last_used."""
        old_time = datetime.now(timezone.utc) - timedelta(days=30)

        memory1 = {"importance": 1.0, "timestamp": old_time.isoformat() + "Z"}
        memory2 = {"importance": 1.0, "last_accessed": old_time.isoformat() + "Z"}
        memory3 = {"importance": 1.0, "last_used": old_time.isoformat() + "Z"}

        result1 = self.storage.apply_decay([memory1.copy()])
        result2 = self.storage.apply_decay([memory2.copy()])
        result3 = self.storage.apply_decay([memory3.copy()])

        # All should have decayed
        self.assertLess(result1[0]["importance"], 1.0)
        self.assertLess(result2[0]["importance"], 1.0)
        self.assertLess(result3[0]["importance"], 1.0)


class TestBoostOnRetrieval(unittest.TestCase):
    """Test boost_on_retrieval function in storage."""

    def setUp(self):
        """Create temporary storage directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage = MemoryStorage(base_path=self.temp_dir)

    def tearDown(self):
        """Clean up temporary directory."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_boost_increases_importance(self):
        """Retrieval boost should increase importance."""
        memory = {"importance": 0.5, "access_count": 0}
        result = self.storage.boost_on_retrieval(memory, boost=0.1)
        self.assertGreater(result["importance"], 0.5)

    def test_boost_updates_access_tracking(self):
        """Retrieval should update last_accessed and access_count."""
        memory = {"importance": 0.5, "access_count": 0}
        result = self.storage.boost_on_retrieval(memory)

        self.assertEqual(result["access_count"], 1)
        self.assertIn("last_accessed", result)

    def test_diminishing_returns_for_high_importance(self):
        """Boost should have diminishing returns as importance approaches 1.0."""
        memory_low = {"importance": 0.3, "access_count": 0}
        memory_high = {"importance": 0.9, "access_count": 0}

        boost_low = self.storage.boost_on_retrieval(memory_low.copy())
        boost_high = self.storage.boost_on_retrieval(memory_high.copy())

        # Absolute boost for low importance should be greater
        delta_low = boost_low["importance"] - 0.3
        delta_high = boost_high["importance"] - 0.9

        self.assertGreater(delta_low, delta_high)

    def test_importance_capped_at_1(self):
        """Boosted importance should never exceed 1.0."""
        memory = {"importance": 0.99, "access_count": 0}
        result = self.storage.boost_on_retrieval(memory, boost=0.5)
        self.assertLessEqual(result["importance"], 1.0)

    def test_multiple_boosts_accumulate(self):
        """Multiple retrievals should accumulate boosts."""
        memory = {"importance": 0.5, "access_count": 0}

        for _ in range(5):
            memory = self.storage.boost_on_retrieval(memory, boost=0.05)

        self.assertEqual(memory["access_count"], 5)
        self.assertGreater(memory["importance"], 0.5)


class TestImportanceIntegration(unittest.TestCase):
    """Integration tests for importance scoring system."""

    def setUp(self):
        """Create temporary storage directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage = MemoryStorage(base_path=self.temp_dir)

    def tearDown(self):
        """Clean up temporary directory."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_full_lifecycle(self):
        """Test complete importance lifecycle: create, decay, boost."""
        # Create episode with default importance
        episode = EpisodeTrace.create(
            task_id="task-001",
            agent="test-agent",
            goal="Integration test",
        )
        self.assertEqual(episode.importance, 0.5)

        # Save and load
        episode_id = self.storage.save_episode(episode)
        loaded = self.storage.load_episode(episode_id)

        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.get("importance", 0.5), 0.5)

        # Simulate retrieval boost
        boosted = self.storage.boost_on_retrieval(loaded.copy())
        self.assertGreater(boosted["importance"], 0.5)
        self.assertEqual(boosted["access_count"], 1)

        # Calculate importance with context
        importance = self.storage.calculate_importance(boosted, task_type="debugging")
        self.assertIsInstance(importance, float)
        self.assertGreaterEqual(importance, 0.0)
        self.assertLessEqual(importance, 1.0)


if __name__ == "__main__":
    unittest.main()
