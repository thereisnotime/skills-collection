"""Tests for reviewer calibration tracking module."""

import json
import os
import tempfile
import unittest
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'swarm'))

from calibration import CalibrationTracker


class TestCalibrationTrackerInit(unittest.TestCase):
    """Tests for CalibrationTracker initialization."""

    def test_init_creates_empty_data(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = os.path.join(tmpdir, 'cal.json')
            tracker = CalibrationTracker(cal_file)
            self.assertEqual(tracker._data, {'reviewers': {}, 'rounds': []})

    def test_init_loads_existing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = os.path.join(tmpdir, 'cal.json')
            data = {
                'reviewers': {'r1': {'total_reviews': 5, 'calibration_score': 0.8}},
                'rounds': [],
            }
            with open(cal_file, 'w') as f:
                json.dump(data, f)
            tracker = CalibrationTracker(cal_file)
            self.assertEqual(tracker._data['reviewers']['r1']['total_reviews'], 5)

    def test_init_handles_corrupt_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = os.path.join(tmpdir, 'cal.json')
            with open(cal_file, 'w') as f:
                f.write('not json')
            tracker = CalibrationTracker(cal_file)
            self.assertEqual(tracker._data, {'reviewers': {}, 'rounds': []})


class TestRecordRound(unittest.TestCase):
    """Tests for record_round method."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.cal_file = os.path.join(self.tmpdir, 'council', 'cal.json')
        self.tracker = CalibrationTracker(self.cal_file)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_record_round_creates_reviewer_entries(self):
        votes = [
            {'reviewer_id': 'r1', 'verdict': 'approve'},
            {'reviewer_id': 'r2', 'verdict': 'reject'},
        ]
        self.tracker.record_round(1, votes, 'approve')
        self.assertIn('r1', self.tracker._data['reviewers'])
        self.assertIn('r2', self.tracker._data['reviewers'])

    def test_record_round_increments_total_reviews(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        self.tracker.record_round(2, votes, 'approve')
        self.assertEqual(self.tracker._data['reviewers']['r1']['total_reviews'], 2)

    def test_record_round_tracks_agreement(self):
        votes = [
            {'reviewer_id': 'r1', 'verdict': 'approve'},
            {'reviewer_id': 'r2', 'verdict': 'reject'},
        ]
        self.tracker.record_round(1, votes, 'approve')
        self.assertEqual(self.tracker._data['reviewers']['r1']['agreements_with_final'], 1)
        self.assertEqual(self.tracker._data['reviewers']['r2']['disagreements_with_final'], 1)

    def test_calibration_score_updates_via_ema(self):
        """Calibration score should update using exponential moving average."""
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]

        # Initial score is 0.5, alpha is 0.1
        # After agreeing: 0.5 * 0.9 + 1.0 * 0.1 = 0.55
        self.tracker.record_round(1, votes, 'approve')
        score = self.tracker._data['reviewers']['r1']['calibration_score']
        self.assertAlmostEqual(score, 0.55, places=5)

        # After disagreeing: 0.55 * 0.9 + 0.0 * 0.1 = 0.495
        votes_disagree = [{'reviewer_id': 'r1', 'verdict': 'reject'}]
        self.tracker.record_round(2, votes_disagree, 'approve')
        score = self.tracker._data['reviewers']['r1']['calibration_score']
        self.assertAlmostEqual(score, 0.495, places=5)

    def test_record_round_appends_to_rounds(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        self.assertEqual(len(self.tracker._data['rounds']), 1)
        self.assertEqual(self.tracker._data['rounds'][0]['iteration'], 1)

    def test_rounds_capped_at_100(self):
        """Should keep only the last 100 rounds."""
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        for i in range(110):
            self.tracker.record_round(i, votes, 'approve')
        self.assertEqual(len(self.tracker._data['rounds']), 100)
        # The oldest round should be iteration 10 (0-9 were trimmed)
        self.assertEqual(self.tracker._data['rounds'][0]['iteration'], 10)

    def test_missing_reviewer_id_defaults_to_unknown(self):
        votes = [{'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        self.assertIn('unknown', self.tracker._data['reviewers'])


class TestUpdateGroundTruth(unittest.TestCase):
    """Tests for update_ground_truth method."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.cal_file = os.path.join(self.tmpdir, 'cal.json')
        self.tracker = CalibrationTracker(self.cal_file)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_update_ground_truth_sets_value(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(5, votes, 'approve')
        self.tracker.update_ground_truth(5, 'reject')
        self.assertEqual(self.tracker._data['rounds'][0]['ground_truth'], 'reject')

    def test_update_ground_truth_tracks_correct_predictions(self):
        votes = [
            {'reviewer_id': 'r1', 'verdict': 'approve'},
            {'reviewer_id': 'r2', 'verdict': 'reject'},
        ]
        self.tracker.record_round(1, votes, 'approve')
        self.tracker.update_ground_truth(1, 'approve')
        self.assertEqual(self.tracker._data['reviewers']['r1']['correct_predictions'], 1)
        self.assertEqual(self.tracker._data['reviewers']['r2']['false_negatives'], 1)

    def test_update_ground_truth_tracks_false_positives(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        self.tracker.update_ground_truth(1, 'reject')
        self.assertEqual(self.tracker._data['reviewers']['r1']['false_positives'], 1)

    def test_update_nonexistent_iteration_does_nothing(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        self.tracker.update_ground_truth(999, 'reject')
        # Should not crash, and round 1 should be unmodified
        self.assertIsNone(self.tracker._data['rounds'][0]['ground_truth'])


class TestGetWeightedVote(unittest.TestCase):
    """Tests for get_weighted_vote method."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.cal_file = os.path.join(self.tmpdir, 'cal.json')
        self.tracker = CalibrationTracker(self.cal_file)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_new_reviewer_gets_default_weight(self):
        """New reviewers with fewer than 5 reviews should get weight 1.0."""
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        weight = self.tracker.get_weighted_vote('r1')
        self.assertEqual(weight, 1.0)

    def test_unknown_reviewer_gets_default_weight(self):
        weight = self.tracker.get_weighted_vote('nonexistent')
        self.assertEqual(weight, 1.0)

    def test_experienced_reviewer_gets_calibration_score(self):
        """Reviewer with 5+ reviews should get their calibration score."""
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        for i in range(6):
            self.tracker.record_round(i, votes, 'approve')
        weight = self.tracker.get_weighted_vote('r1')
        # Should be the calibration_score, not 1.0
        stats = self.tracker.get_reviewer_stats('r1')
        self.assertEqual(weight, stats['calibration_score'])
        self.assertNotEqual(weight, 1.0)


class TestSaveAndLoad(unittest.TestCase):
    """Tests for persistence."""

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = os.path.join(tmpdir, 'council', 'cal.json')

            # Save data
            tracker1 = CalibrationTracker(cal_file)
            votes = [
                {'reviewer_id': 'r1', 'verdict': 'approve'},
                {'reviewer_id': 'r2', 'verdict': 'reject'},
            ]
            tracker1.record_round(1, votes, 'approve')
            tracker1.save()

            # Load data in new tracker
            tracker2 = CalibrationTracker(cal_file)
            self.assertIn('r1', tracker2._data['reviewers'])
            self.assertIn('r2', tracker2._data['reviewers'])
            self.assertEqual(len(tracker2._data['rounds']), 1)

    def test_save_creates_parent_directories(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = os.path.join(tmpdir, 'deep', 'nested', 'cal.json')
            tracker = CalibrationTracker(cal_file)
            tracker.record_round(1, [{'reviewer_id': 'r1', 'verdict': 'approve'}], 'approve')
            tracker.save()
            self.assertTrue(os.path.exists(cal_file))


class TestGetStats(unittest.TestCase):
    """Tests for stats methods."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.cal_file = os.path.join(self.tmpdir, 'cal.json')
        self.tracker = CalibrationTracker(self.cal_file)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_get_reviewer_stats_returns_none_for_unknown(self):
        self.assertIsNone(self.tracker.get_reviewer_stats('nonexistent'))

    def test_get_reviewer_stats_returns_dict(self):
        votes = [{'reviewer_id': 'r1', 'verdict': 'approve'}]
        self.tracker.record_round(1, votes, 'approve')
        stats = self.tracker.get_reviewer_stats('r1')
        self.assertIsNotNone(stats)
        self.assertEqual(stats['total_reviews'], 1)

    def test_get_all_stats(self):
        votes = [
            {'reviewer_id': 'r1', 'verdict': 'approve'},
            {'reviewer_id': 'r2', 'verdict': 'reject'},
        ]
        self.tracker.record_round(1, votes, 'approve')
        all_stats = self.tracker.get_all_stats()
        self.assertEqual(len(all_stats), 2)
        self.assertIn('r1', all_stats)
        self.assertIn('r2', all_stats)


if __name__ == '__main__':
    unittest.main()
