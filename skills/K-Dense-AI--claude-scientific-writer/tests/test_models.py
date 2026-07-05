"""Tests for scientific_writer.models timestamp behavior."""

from datetime import datetime, timezone

from scientific_writer.models import PaperMetadata, ProgressUpdate


def test_progress_update_timestamp_is_timezone_aware_utc():
    timestamp = ProgressUpdate().timestamp
    parsed = datetime.fromisoformat(timestamp)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 0
    # New contract: explicit offset form, not the legacy naive-utcnow + "Z" suffix
    assert timestamp.endswith("+00:00")
    assert abs((datetime.now(timezone.utc) - parsed).total_seconds()) < 60


def test_paper_metadata_created_at_is_timezone_aware_utc():
    created_at = PaperMetadata().created_at
    parsed = datetime.fromisoformat(created_at)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 0
    assert created_at.endswith("+00:00")
