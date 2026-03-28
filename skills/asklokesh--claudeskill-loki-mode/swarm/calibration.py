"""Reviewer calibration tracking over time.

Tracks the accuracy and consistency of individual reviewers,
allowing the system to weight votes by historical reliability.
"""

import json
import os
from pathlib import Path
from datetime import datetime, timezone


class CalibrationTracker:
    """Tracks reviewer accuracy across review rounds."""

    def __init__(self, calibration_file=None):
        self.calibration_file = Path(calibration_file or '.loki/council/calibration.json')
        self._data = self._load()

    def _load(self):
        if self.calibration_file.exists():
            try:
                with open(self.calibration_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {'reviewers': {}, 'rounds': []}

    def save(self):
        self.calibration_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.calibration_file, 'w') as f:
            json.dump(self._data, f, indent=2)

    def record_round(self, iteration, votes, final_decision, ground_truth=None):
        """Record a review round for calibration tracking.

        Args:
            iteration: RARV iteration number
            votes: List of vote dicts with 'reviewer_id' and 'verdict'
            final_decision: The final council decision ('approve' or 'reject')
            ground_truth: Optional actual outcome (used to calibrate later)
        """
        round_entry = {
            'iteration': iteration,
            'timestamp': datetime.now(timezone.utc).isoformat() + 'Z',
            'final_decision': final_decision,
            'ground_truth': ground_truth,
            'votes': [],
        }

        for vote in votes:
            reviewer_id = vote.get('reviewer_id', 'unknown')
            verdict = vote.get('verdict', '').lower()

            # Initialize reviewer if new
            if reviewer_id not in self._data['reviewers']:
                self._data['reviewers'][reviewer_id] = {
                    'total_reviews': 0,
                    'agreements_with_final': 0,
                    'disagreements_with_final': 0,
                    'correct_predictions': 0,
                    'false_positives': 0,
                    'false_negatives': 0,
                    'calibration_score': 0.5,
                    'first_seen': datetime.now(timezone.utc).isoformat() + 'Z',
                    'last_seen': datetime.now(timezone.utc).isoformat() + 'Z',
                }

            reviewer = self._data['reviewers'][reviewer_id]
            reviewer['total_reviews'] += 1
            reviewer['last_seen'] = datetime.now(timezone.utc).isoformat() + 'Z'

            agreed = (verdict == final_decision)
            if agreed:
                reviewer['agreements_with_final'] += 1
            else:
                reviewer['disagreements_with_final'] += 1

            # Update calibration score (exponential moving average)
            alpha = 0.1  # Learning rate
            match_score = 1.0 if agreed else 0.0
            reviewer['calibration_score'] = (
                (1 - alpha) * reviewer['calibration_score'] + alpha * match_score
            )

            round_entry['votes'].append({
                'reviewer_id': reviewer_id,
                'verdict': verdict,
                'agreed_with_final': agreed,
            })

        self._data['rounds'].append(round_entry)

        # Keep only last 100 rounds
        if len(self._data['rounds']) > 100:
            self._data['rounds'] = self._data['rounds'][-100:]

    def update_ground_truth(self, iteration, ground_truth):
        """Update a round with actual outcome (e.g., did the approval lead to success?)."""
        for round_entry in reversed(self._data['rounds']):
            if round_entry['iteration'] == iteration:
                round_entry['ground_truth'] = ground_truth
                # Update reviewer accuracy based on ground truth
                for vote_entry in round_entry['votes']:
                    reviewer_id = vote_entry['reviewer_id']
                    if reviewer_id in self._data['reviewers']:
                        reviewer = self._data['reviewers'][reviewer_id]
                        verdict = vote_entry['verdict']
                        if verdict == ground_truth:
                            reviewer['correct_predictions'] += 1
                        elif verdict == 'approve' and ground_truth == 'reject':
                            reviewer['false_positives'] += 1
                        elif verdict == 'reject' and ground_truth == 'approve':
                            reviewer['false_negatives'] += 1
                break

    def get_reviewer_stats(self, reviewer_id):
        """Get calibration stats for a specific reviewer."""
        return self._data['reviewers'].get(reviewer_id)

    def get_all_stats(self):
        """Get stats for all reviewers."""
        return dict(self._data['reviewers'])

    def get_weighted_vote(self, reviewer_id):
        """Get the vote weight for a reviewer based on calibration score."""
        stats = self.get_reviewer_stats(reviewer_id)
        if not stats or stats['total_reviews'] < 5:
            return 1.0  # Default weight for new reviewers
        return stats['calibration_score']
